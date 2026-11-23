import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { ensurePresetAudioFiles } from './audioAssets.ts';
import {
  computeCountdownParts,
  containsBengaliScript,
  createDefaultConfig,
  DEFAULT_YOUTUBE_INGEST_URL,
  isStreamStalled,
  maskStreamKey,
  normalizeYouTubeIngestUrl,
  parseFfmpegFrameCount,
  scrubSecret,
  shouldAutoResumeFromEnv,
  validateAudioUploadMeta,
  validateCountdownInput,
  validateRtmpUrl,
  validateStreamKey,
  type BackdropThemeId,
  type CountdownConfig,
  type DesiredStreamStatus,
  type EncoderStatus,
  type PublicStreamState,
  type StreamLogEntry,
  type StreamMode,
} from '../shared/countdown.ts';

interface PersistedState {
  config: CountdownConfig;
  configUpdatedAtIso: string | null;
  desiredStatus: DesiredStreamStatus;
  streamMode: StreamMode;
  ingestUrl: string;
  streamKey: string;
  startedAtIso: string | null;
  userStopped?: boolean;
  keyClearedByUser?: boolean;
  customMusicFile?: string;
}

const STALL_THRESHOLD_MS = 25_000;
const ENCODER_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

const FONT_MONO_BOLD = '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf';
const FONT_MONO_MEDIUM = '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf';
const FONT_SANS_BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
const FONT_SANS_REGULAR = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
const FONT_BENGALI = '/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf';

const THEME_IMAGE_FILES: Record<BackdropThemeId, string | null> = {
  obsidian: 'src/assets/images/backdrop_obsidian_studio_1795365224809.jpg',
  midnight: 'src/assets/images/backdrop_midnight_horizon_1795365224383.jpg',
  amber: 'src/assets/images/backdrop_amber_stage_1795365224327.jpg',
  minimal: null,
};

function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string {
  const clean = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return ' ';
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
      }
      current = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine - 1) + '…' : word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines.slice(0, maxLines).join('\n') || ' ';
}

export class StreamManager {
  private readonly dataDir: string;
  private readonly audioDir: string;
  private readonly presetAudioPaths: { ambientPath: string; horizonPath: string };
  private readonly statePath: string;
  private readonly snapshotPath: string;
  private readonly textPaths: {
    kicker: string;
    title: string;
    details: string;
    clock: string;
    dayVal: string;
    hourVal: string;
    minVal: string;
    secVal: string;
    dayLbl: string;
    hourLbl: string;
    minLbl: string;
    secLbl: string;
    units: string;
  };

  private state: PersistedState;
  private encoderStatus: EncoderStatus = 'idle';
  private reconnectCount = 0;
  private lastError: string | null = null;
  private lastFrameUpdatedAt: string | null = null;
  private logs: StreamLogEntry[] = [];

  private ffmpegProc: ChildProcess | null = null;
  private intentionallyStoppedProcs = new WeakSet<ChildProcess>();
  private lastProgressTimeMs = 0;
  private encoderStartedAtMs = 0;
  private tickerTimer: NodeJS.Timeout | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private liveConfirmTimer: NodeJS.Timeout | null = null;
  private snapshotPromise: Promise<Buffer> | null = null;
  private lastSnapshotTimeMs = 0;

  constructor(rootDir: string = process.cwd()) {
    this.dataDir = path.resolve(rootDir, 'data');
    this.audioDir = path.join(this.dataDir, 'audio');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.presetAudioPaths = ensurePresetAudioFiles(this.audioDir);

    this.statePath = path.join(this.dataDir, 'stream-state.json');
    this.snapshotPath = path.join(this.dataDir, 'live-frame.jpg');
    this.textPaths = {
      kicker: path.join(this.dataDir, 'text_kicker.txt'),
      title: path.join(this.dataDir, 'text_title.txt'),
      details: path.join(this.dataDir, 'text_details.txt'),
      clock: path.join(this.dataDir, 'text_clock.txt'),
      dayVal: path.join(this.dataDir, 'text_day.txt'),
      hourVal: path.join(this.dataDir, 'text_hour.txt'),
      minVal: path.join(this.dataDir, 'text_min.txt'),
      secVal: path.join(this.dataDir, 'text_sec.txt'),
      dayLbl: path.join(this.dataDir, 'text_day_lbl.txt'),
      hourLbl: path.join(this.dataDir, 'text_hour_lbl.txt'),
      minLbl: path.join(this.dataDir, 'text_min_lbl.txt'),
      secLbl: path.join(this.dataDir, 'text_sec_lbl.txt'),
      units: path.join(this.dataDir, 'text_units.txt'),
    };

    this.state = this.loadPersistedState();
    this.syncTextFiles();
  }

  public init(): void {
    this.startTicker();
    if (this.state.desiredStatus === 'streaming') {
      this.addLog('info', 'Restored active persistent broadcast state after server boot.');
      this.startKeepalive();
      this.startWorker();
    } else {
      this.addLog('info', 'Studio initialized in standby mode.');
    }
  }

  public shutdown(): void {
    if (this.tickerTimer) {
      clearInterval(this.tickerTimer);
      this.tickerTimer = null;
    }
    this.stopKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.liveConfirmTimer) {
      clearTimeout(this.liveConfirmTimer);
      this.liveConfirmTimer = null;
    }
    this.stopFfmpegProcess();
  }

  private resolveEnvDefaults(): { envKey: string; envIngestUrl: string } {
    const rawEnvKey = process.env.YOUTUBE_STREAM_KEY?.trim() ?? '';
    const keyCheck = rawEnvKey ? validateStreamKey(rawEnvKey) : { ok: false as const };
    const envKey = keyCheck.ok ? keyCheck.cleanKey : '';

    const rawEnvIngest = process.env.YOUTUBE_INGEST_URL?.trim() ?? '';
    const ingestCheck = rawEnvIngest
      ? validateRtmpUrl(normalizeYouTubeIngestUrl(rawEnvIngest))
      : { ok: false as const };
    const envIngestUrl = ingestCheck.ok ? ingestCheck.normalizedUrl : DEFAULT_YOUTUBE_INGEST_URL;

    return { envKey, envIngestUrl };
  }

  private loadPersistedState(): PersistedState {
    const { envKey, envIngestUrl } = this.resolveEnvDefaults();
    const envShouldAutoStart = shouldAutoResumeFromEnv({
      streamKey: envKey,
      autoStart: process.env.AUTO_START_STREAM,
    });

    const fallback: PersistedState = {
      config: createDefaultConfig(),
      configUpdatedAtIso: null,
      desiredStatus: envShouldAutoStart ? 'streaming' : 'stopped',
      streamMode: 'youtube',
      ingestUrl: envIngestUrl,
      streamKey: envKey,
      startedAtIso: envShouldAutoStart ? new Date().toISOString() : null,
      userStopped: false,
      keyClearedByUser: false,
    };

    if (!fs.existsSync(this.statePath)) {
      this.savePersistedState(fallback);
      return fallback;
    }

    try {
      const raw = fs.readFileSync(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const validatedConfig = validateCountdownInput(parsed.config ?? {});
      const rawIngest = parsed.ingestUrl ?? envIngestUrl;
      const validatedUrl = validateRtmpUrl(normalizeYouTubeIngestUrl(rawIngest));
      const savedKey = typeof parsed.streamKey === 'string' ? parsed.streamKey : '';
      const keyClearedByUser = parsed.keyClearedByUser === true;
      const userStopped = parsed.userStopped === true;
      const effectiveKey = savedKey || (keyClearedByUser ? '' : envKey);

      const shouldAutoResume =
        parsed.desiredStatus === 'streaming' ||
        (!userStopped &&
          shouldAutoResumeFromEnv({
            streamKey: effectiveKey,
            autoStart: process.env.AUTO_START_STREAM,
          }));

      return {
        config: validatedConfig.ok ? validatedConfig.value : fallback.config,
        configUpdatedAtIso:
          typeof parsed.configUpdatedAtIso === 'string' && Number.isFinite(Date.parse(parsed.configUpdatedAtIso))
            ? parsed.configUpdatedAtIso
            : null,
        desiredStatus: shouldAutoResume ? 'streaming' : 'stopped',
        streamMode: parsed.streamMode === 'preview' && !shouldAutoResumeFromEnv({ streamKey: effectiveKey, autoStart: process.env.AUTO_START_STREAM }) ? 'preview' : parsed.streamMode === 'preview' ? 'preview' : 'youtube',
        ingestUrl: validatedUrl.ok ? validatedUrl.normalizedUrl : envIngestUrl,
        streamKey: effectiveKey,
        startedAtIso:
          typeof parsed.startedAtIso === 'string' && Number.isFinite(Date.parse(parsed.startedAtIso))
            ? parsed.startedAtIso
            : shouldAutoResume
              ? new Date().toISOString()
              : null,
        userStopped,
        keyClearedByUser,
        customMusicFile: typeof parsed.customMusicFile === 'string' ? path.basename(parsed.customMusicFile) : undefined,
      };
    } catch {
      return fallback;
    }
  }

  private savePersistedState(nextState: PersistedState): void {
    const tmpPath = `${this.statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(nextState, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, this.statePath);
  }

  private writeAtomicText(filePath: string, content: string): void {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  }

  private addLog(level: StreamLogEntry['level'], rawMessage: string): void {
    const safeMessage = scrubSecret(rawMessage, this.state.streamKey).trim();
    if (!safeMessage) return;
    const entry: StreamLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestampIso: new Date().toISOString(),
      level,
      message: safeMessage,
    };
    this.logs = [entry, ...this.logs].slice(0, 40);
  }

  public getPublicState(): PublicStreamState {
    return {
      config: this.state.config,
      desiredStatus: this.state.desiredStatus,
      streamMode: this.state.streamMode,
      encoderStatus: this.encoderStatus,
      ingestUrl: this.state.ingestUrl,
      hasStreamKey: Boolean(this.state.streamKey),
      maskedStreamKey: maskStreamKey(this.state.streamKey),
      startedAtIso: this.state.startedAtIso,
      reconnectCount: this.reconnectCount,
      lastError: this.lastError,
      lastFrameUpdatedAt: this.lastFrameUpdatedAt,
      configUpdatedAtIso: this.state.configUpdatedAtIso,
      serverTimeIso: new Date().toISOString(),
      logs: this.logs,
    };
  }

  public updateConfig(input: Partial<CountdownConfig>): { ok: true; state: PublicStreamState } | { ok: false; error: string } {
    const prevTheme = this.state.config.themeId;
    const prevMusicMode = this.state.config.musicMode;
    const prevMusicVolume = this.state.config.musicVolume;

    const validated = validateCountdownInput({
      ...this.state.config,
      ...input,
      customMusicName: this.state.config.customMusicName,
    });
    if (!validated.ok) {
      return validated;
    }

    if (validated.value.musicMode === 'custom' && !this.getCustomMusicAbsolutePath()) {
      return {
        ok: false,
        error: 'Please upload an audio file first before selecting Custom Audio Upload.',
      };
    }

    this.state = {
      ...this.state,
      config: validated.value,
      configUpdatedAtIso: new Date().toISOString(),
    };
    this.savePersistedState(this.state);
    this.syncTextFiles();
    this.lastSnapshotTimeMs = 0;

    this.addLog('info', `Updated broadcast details: "${validated.value.title}"`);

    const audioChanged =
      prevMusicMode !== validated.value.musicMode || prevMusicVolume !== validated.value.musicVolume;

    if (
      this.state.desiredStatus === 'streaming' &&
      this.state.streamMode === 'youtube' &&
      (prevTheme !== validated.value.themeId || audioChanged)
    ) {
      this.addLog('info', 'Broadcast scene or audio updated while live; refreshing encoder.');
      this.restartFfmpegWorker();
    }

    return { ok: true, state: this.getPublicState() };
  }

  private getCustomMusicAbsolutePath(): string | null {
    if (!this.state.customMusicFile) return null;
    const safeBase = path.basename(this.state.customMusicFile);
    const fullPath = path.join(this.audioDir, safeBase);
    return fs.existsSync(fullPath) ? fullPath : null;
  }

  public getActiveMusicFilePath(): string | null {
    switch (this.state.config.musicMode) {
      case 'preset-ambient':
        return fs.existsSync(this.presetAudioPaths.ambientPath) ? this.presetAudioPaths.ambientPath : null;
      case 'preset-horizon':
        return fs.existsSync(this.presetAudioPaths.horizonPath) ? this.presetAudioPaths.horizonPath : null;
      case 'custom':
        return this.getCustomMusicAbsolutePath();
      default:
        return null;
    }
  }

  public getMusicAudioInfo(): { filePath: string; contentType: string } | null {
    const filePath = this.getActiveMusicFilePath();
    if (!filePath) return null;
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === '.mp3'
        ? 'audio/mpeg'
        : ext === '.wav'
          ? 'audio/wav'
          : ext === '.m4a' || ext === '.aac'
            ? 'audio/mp4'
            : ext === '.ogg'
              ? 'audio/ogg'
              : ext === '.flac'
                ? 'audio/flac'
                : 'application/octet-stream';
    return { filePath, contentType };
  }

  private probeAudioStream(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = spawn(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath],
        { shell: false, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let stdout = '';
      probe.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      probe.on('error', () => resolve(false));
      probe.on('exit', (code) => {
        resolve(code === 0 && stdout.trim().includes('audio'));
      });
    });
  }

  public async saveCustomAudioUpload(
    filename: string,
    mimeType: string,
    fileBuffer: Buffer,
  ): Promise<{ ok: true; state: PublicStreamState } | { ok: false; error: string }> {
    const metaCheck = validateAudioUploadMeta(filename, mimeType, fileBuffer.length);
    if (!metaCheck.ok) {
      return metaCheck;
    }

    const tmpPath = path.join(this.audioDir, `upload-${Date.now()}.tmp${metaCheck.ext}`);
    fs.writeFileSync(tmpPath, fileBuffer);

    const hasAudio = await this.probeAudioStream(tmpPath);
    if (!hasAudio) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup error
      }
      return {
        ok: false,
        error: 'The uploaded file does not contain a readable audio stream.',
      };
    }

    const prevPath = this.getCustomMusicAbsolutePath();
    const targetName = `custom-track${metaCheck.ext}`;
    const targetPath = path.join(this.audioDir, targetName);
    fs.renameSync(tmpPath, targetPath);

    if (prevPath && prevPath !== targetPath && fs.existsSync(prevPath)) {
      try {
        fs.unlinkSync(prevPath);
      } catch {
        // ignore cleanup error
      }
    }

    this.state = {
      ...this.state,
      customMusicFile: targetName,
      config: {
        ...this.state.config,
        musicMode: 'custom',
        customMusicName: metaCheck.cleanName,
      },
      configUpdatedAtIso: new Date().toISOString(),
    };
    this.savePersistedState(this.state);
    this.addLog('info', `Uploaded background music: "${metaCheck.cleanName}"`);

    if (this.state.desiredStatus === 'streaming' && this.state.streamMode === 'youtube') {
      this.addLog('info', 'Background music updated while live; refreshing audio encoder.');
      this.restartFfmpegWorker();
    }

    return { ok: true, state: this.getPublicState() };
  }

  public removeCustomAudio(): { ok: true; state: PublicStreamState } {
    const prevPath = this.getCustomMusicAbsolutePath();
    if (prevPath && fs.existsSync(prevPath)) {
      try {
        fs.unlinkSync(prevPath);
      } catch {
        // ignore cleanup error
      }
    }

    const wasCustom = this.state.config.musicMode === 'custom';
    this.state = {
      ...this.state,
      customMusicFile: undefined,
      config: {
        ...this.state.config,
        musicMode: wasCustom ? 'none' : this.state.config.musicMode,
        customMusicName: '',
      },
      configUpdatedAtIso: new Date().toISOString(),
    };
    this.savePersistedState(this.state);
    this.addLog('info', 'Removed custom background music track.');

    if (wasCustom && this.state.desiredStatus === 'streaming' && this.state.streamMode === 'youtube') {
      this.restartFfmpegWorker();
    }

    return { ok: true, state: this.getPublicState() };
  }

  public updateYouTubeSettings(input: {
    ingestUrl?: string;
    streamKey?: string;
    clearStreamKey?: boolean;
    streamMode?: StreamMode;
  }): { ok: true; state: PublicStreamState } | { ok: false; error: string } {
    const prevMode = this.state.streamMode;
    const prevIngestUrl = this.state.ingestUrl;
    const prevKey = this.state.streamKey;

    let nextIngestUrl = this.state.ingestUrl;
    if (typeof input.ingestUrl === 'string') {
      const normalizedCandidate = normalizeYouTubeIngestUrl(input.ingestUrl);
      const urlCheck = validateRtmpUrl(normalizedCandidate);
      if (!urlCheck.ok) {
        return urlCheck;
      }
      nextIngestUrl = urlCheck.normalizedUrl;
    }

    let nextKey = this.state.streamKey;
    let nextKeyCleared = this.state.keyClearedByUser ?? false;
    const hasNewKey = typeof input.streamKey === 'string' && input.streamKey.trim() !== '';
    if (input.clearStreamKey) {
      nextKey = '';
      nextKeyCleared = true;
    } else if (hasNewKey) {
      const keyCheck = validateStreamKey(input.streamKey!);
      if (!keyCheck.ok) {
        return keyCheck;
      }
      nextKey = keyCheck.cleanKey;
      nextKeyCleared = false;
    }

    let nextMode: StreamMode =
      input.streamMode === 'youtube' || input.streamMode === 'preview'
        ? input.streamMode
        : this.state.streamMode;

    if (hasNewKey && input.streamMode !== 'preview') {
      nextMode = 'youtube';
    }

    if (nextMode === 'youtube' && !nextKey && this.state.desiredStatus === 'streaming') {
      return {
        ok: false,
        error: 'Cannot switch to YouTube Live while streaming without a saved Stream Key.',
      };
    }

    this.state = {
      ...this.state,
      ingestUrl: nextIngestUrl,
      streamKey: nextKey,
      streamMode: nextMode,
      keyClearedByUser: nextKeyCleared,
    };
    this.savePersistedState(this.state);
    this.addLog('info', `Updated YouTube settings (mode: ${nextMode}).`);

    if (
      this.state.desiredStatus === 'streaming' &&
      (nextMode !== prevMode || nextIngestUrl !== prevIngestUrl || nextKey !== prevKey)
    ) {
      this.lastError = null;
      this.reconnectCount = 0;
      this.restartFfmpegWorker();
    }

    return { ok: true, state: this.getPublicState() };
  }

  public startStream(requestedMode?: StreamMode): { ok: true; state: PublicStreamState } | { ok: false; error: string } {
    const mode: StreamMode =
      requestedMode === 'youtube' || requestedMode === 'preview' ? requestedMode : this.state.streamMode;

    if (mode === 'youtube') {
      if (!this.state.streamKey) {
        return {
          ok: false,
          error: 'Please save your YouTube Stream Key before starting a YouTube Live stream.',
        };
      }
      const urlCheck = validateRtmpUrl(this.state.ingestUrl);
      if (!urlCheck.ok) {
        return urlCheck;
      }
    }

    this.state = {
      ...this.state,
      desiredStatus: 'streaming',
      streamMode: mode,
      startedAtIso: this.state.startedAtIso ?? new Date().toISOString(),
      userStopped: false,
    };
    this.lastError = null;
    this.reconnectCount = 0;
    this.savePersistedState(this.state);
    this.syncTextFiles();
    this.startKeepalive();
    this.startWorker();

    this.addLog(
      'info',
      mode === 'youtube'
        ? 'Persistent YouTube Live stream started. Safe to close browser or power off device.'
        : 'Persistent server broadcast started. Safe to close browser or power off device.',
    );

    return { ok: true, state: this.getPublicState() };
  }

  public stopStream(): { ok: true; state: PublicStreamState } {
    this.stopKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.liveConfirmTimer) {
      clearTimeout(this.liveConfirmTimer);
      this.liveConfirmTimer = null;
    }

    this.state = {
      ...this.state,
      desiredStatus: 'stopped',
      startedAtIso: null,
      userStopped: true,
    };
    this.encoderStatus = 'idle';
    this.reconnectCount = 0;
    this.lastError = null;
    this.savePersistedState(this.state);
    this.stopFfmpegProcess();

    this.addLog('info', 'Broadcast stopped by user command.');
    return { ok: true, state: this.getPublicState() };
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    const rawAppUrl = process.env.APP_URL?.trim();
    if (!rawAppUrl || !/^https?:\/\//i.test(rawAppUrl)) {
      return;
    }
    let healthEndpoint: string;
    try {
      const parsed = new URL(rawAppUrl);
      healthEndpoint = `${parsed.origin}/api/health`;
    } catch {
      return;
    }

    this.keepaliveTimer = setInterval(() => {
      if (this.state.desiredStatus !== 'streaming') {
        this.stopKeepalive();
        return;
      }
      fetch(healthEndpoint, { signal: AbortSignal.timeout(5000) }).catch(() => {
        // Ignore transient network errors during keepalive
      });
    }, 45_000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private startTicker(): void {
    if (this.tickerTimer) {
      clearInterval(this.tickerTimer);
    }
    this.tickerTimer = setInterval(() => {
      this.syncTextFiles();
      if (this.state.desiredStatus === 'streaming') {
        const nowMs = Date.now();
        this.lastFrameUpdatedAt = new Date(nowMs).toISOString();
        if (this.state.streamMode === 'youtube') {
          if (!this.ffmpegProc && !this.reconnectTimer) {
            this.addLog('warning', 'Encoder watchdog detected idle worker; restarting stream.');
            this.scheduleReconnect();
          } else if (
            this.ffmpegProc &&
            isStreamStalled(this.lastProgressTimeMs, nowMs, STALL_THRESHOLD_MS)
          ) {
            this.addLog('warning', 'Stream socket stalled; recycling FFmpeg connection.');
            this.restartFfmpegWorker();
          } else if (
            this.ffmpegProc &&
            this.encoderStartedAtMs > 0 &&
            nowMs - this.encoderStartedAtMs >= ENCODER_REFRESH_INTERVAL_MS
          ) {
            this.addLog('info', 'Performing scheduled 6-hour encoder refresh for continuous stability.');
            this.restartFfmpegWorker();
          }
        }
      }
    }, 1000);
  }

  private syncTextFiles(): void {
    const parts = computeCountdownParts(this.state.config.targetIso);
    const targetDate = new Date(this.state.config.targetIso);
    const targetReadable = Number.isFinite(targetDate.getTime())
      ? `TARGET · ${targetDate.toUTCString().replace(':00 GMT', ' UTC')}`
      : 'LIVE COUNTDOWN';

    this.writeAtomicText(this.textPaths.kicker, targetReadable);
    this.writeAtomicText(this.textPaths.title, wrapLines(this.state.config.title, 44, 2));
    this.writeAtomicText(
      this.textPaths.details,
      wrapLines(this.state.config.details || 'Live broadcast countdown', 68, 2),
    );
    this.writeAtomicText(
      this.textPaths.clock,
      parts.isCompleted ? wrapLines(this.state.config.completionText, 24, 1) : ' ',
    );
    this.writeAtomicText(this.textPaths.dayVal, parts.isCompleted ? ' ' : String(parts.days).padStart(2, '0'));
    this.writeAtomicText(this.textPaths.hourVal, parts.isCompleted ? ' ' : String(parts.hours).padStart(2, '0'));
    this.writeAtomicText(this.textPaths.minVal, parts.isCompleted ? ' ' : String(parts.minutes).padStart(2, '0'));
    this.writeAtomicText(this.textPaths.secVal, parts.isCompleted ? ' ' : String(parts.seconds).padStart(2, '0'));
    this.writeAtomicText(this.textPaths.dayLbl, parts.isCompleted ? ' ' : 'DAYS');
    this.writeAtomicText(this.textPaths.hourLbl, parts.isCompleted ? ' ' : 'HOURS');
    this.writeAtomicText(this.textPaths.minLbl, parts.isCompleted ? ' ' : 'MINUTES');
    this.writeAtomicText(this.textPaths.secLbl, parts.isCompleted ? ' ' : 'SECONDS');
    this.writeAtomicText(this.textPaths.units, parts.isCompleted ? 'EVENT LIVE' : ' ');
  }

  private buildVideoFilter(): string {
    const { title, details, themeId } = this.state.config;
    const parts = computeCountdownParts(this.state.config.targetIso);

    const titleFont = containsBengaliScript(title) && fs.existsSync(FONT_BENGALI) ? FONT_BENGALI : FONT_SANS_BOLD;
    const detailsFont =
      containsBengaliScript(details) && fs.existsSync(FONT_BENGALI) ? FONT_BENGALI : FONT_SANS_REGULAR;
    const clockFont =
      parts.isCompleted && containsBengaliScript(this.state.config.completionText) && fs.existsSync(FONT_BENGALI)
        ? FONT_BENGALI
        : FONT_MONO_BOLD;

    const layers: string[] = [
      'scale=1280:720:force_original_aspect_ratio=increase',
      'crop=1280:720',
      themeId === 'minimal' ? 'drawbox=x=0:y=0:w=1280:h=720:color=#0B0F17@1.0:t=fill' : 'drawbox=x=0:y=0:w=1280:h=720:color=black@0.52:t=fill',
      'drawbox=x=96:y=328:w=1088:h=2:color=white@0.16:t=fill',
      `drawtext=fontfile=${FONT_MONO_MEDIUM}:textfile=${this.textPaths.kicker}:reload=1:fontcolor=#94A3B8:fontsize=20:x=(w-text_w)/2:y=118`,
      `drawtext=fontfile=${titleFont}:textfile=${this.textPaths.title}:reload=1:fontcolor=#F8FAFC:fontsize=46:line_spacing=10:x=(w-text_w)/2:y=164`,
      `drawtext=fontfile=${detailsFont}:textfile=${this.textPaths.details}:reload=1:fontcolor=#CBD5E1:fontsize=24:line_spacing=8:x=(w-text_w)/2:y=260`,
      // 4 aligned columns centered at x = 310, 530, 750, 970
      `drawtext=fontfile=${FONT_MONO_BOLD}:textfile=${this.textPaths.dayVal}:reload=1:fontcolor=#FFFFFF:fontsize=88:x=310-(text_w/2):y=384`,
      `drawtext=fontfile=${FONT_MONO_BOLD}:textfile=${this.textPaths.hourVal}:reload=1:fontcolor=#FFFFFF:fontsize=88:x=530-(text_w/2):y=384`,
      `drawtext=fontfile=${FONT_MONO_BOLD}:textfile=${this.textPaths.minVal}:reload=1:fontcolor=#FFFFFF:fontsize=88:x=750-(text_w/2):y=384`,
      `drawtext=fontfile=${FONT_MONO_BOLD}:textfile=${this.textPaths.secVal}:reload=1:fontcolor=#FFFFFF:fontsize=88:x=970-(text_w/2):y=384`,
      `drawtext=fontfile=${FONT_MONO_MEDIUM}:textfile=${this.textPaths.dayLbl}:reload=1:fontcolor=#94A3B8:fontsize=18:x=310-(text_w/2):y=496`,
      `drawtext=fontfile=${FONT_MONO_MEDIUM}:textfile=${this.textPaths.hourLbl}:reload=1:fontcolor=#94A3B8:fontsize=18:x=530-(text_w/2):y=496`,
      `drawtext=fontfile=${FONT_MONO_MEDIUM}:textfile=${this.textPaths.minLbl}:reload=1:fontcolor=#94A3B8:fontsize=18:x=750-(text_w/2):y=496`,
      `drawtext=fontfile=${FONT_MONO_MEDIUM}:textfile=${this.textPaths.secLbl}:reload=1:fontcolor=#94A3B8:fontsize=18:x=970-(text_w/2):y=496`,
      // Completion banner text (empty when active countdown is running)
      `drawtext=fontfile=${clockFont}:textfile=${this.textPaths.clock}:reload=1:fontcolor=#FFFFFF:fontsize=56:x=(w-text_w)/2:y=416`,
      `drawtext=fontfile=${FONT_MONO_MEDIUM}:textfile=${this.textPaths.units}:reload=1:fontcolor=#94A3B8:fontsize=18:x=(w-text_w)/2:y=502`,
    ];

    return layers.join(',');
  }

  private getBackdropInputArgs(): string[] {
    const relPath = THEME_IMAGE_FILES[this.state.config.themeId];
    if (relPath) {
      const absPath = path.resolve(process.cwd(), relPath);
      if (fs.existsSync(absPath)) {
        return ['-loop', '1', '-framerate', '1', '-i', absPath];
      }
    }
    return ['-f', 'lavfi', '-i', 'color=c=#0B0F17:s=1280x720:r=1'];
  }

  private startWorker(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopFfmpegProcess();

    if (this.state.desiredStatus !== 'streaming') {
      this.encoderStatus = 'idle';
      return;
    }

    if (this.state.streamMode === 'preview') {
      this.encoderStatus = 'live';
      this.lastFrameUpdatedAt = new Date().toISOString();
      return;
    }

    // Real YouTube RTMP/RTMPS stream via FFmpeg
    const effectiveIngest = normalizeYouTubeIngestUrl(this.state.ingestUrl);
    const rtmpTarget = `${effectiveIngest}/${this.state.streamKey}`;
    this.encoderStatus = this.reconnectCount > 0 ? 'reconnecting' : 'starting';

    const activeMusicPath = this.getActiveMusicFilePath();
    const volumeScale = (this.state.config.musicVolume / 100).toFixed(2);
    const audioInputArgs = activeMusicPath
      ? ['-re', '-stream_loop', '-1', '-i', activeMusicPath]
      : ['-re', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
    const audioFilterArgs = activeMusicPath
      ? ['-af', `volume=${volumeScale},aresample=async=1:first_pts=0`]
      : [];

    const args = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-stats',
      '-re',
      ...this.getBackdropInputArgs(),
      ...audioInputArgs,
      '-vf',
      `${this.buildVideoFilter()},fps=30`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-b:v',
      '2500k',
      '-maxrate',
      '2500k',
      '-bufsize',
      '5000k',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '60',
      ...audioFilterArgs,
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-max_muxing_queue_size',
      '1024',
      '-flvflags',
      'no_duration_filesize',
      '-f',
      'flv',
      rtmpTarget,
    ];

    const proc = spawn('ffmpeg', args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    this.ffmpegProc = proc;
    const spawnedAt = Date.now();
    this.lastProgressTimeMs = spawnedAt;
    this.encoderStartedAtMs = spawnedAt;
    let confirmedLive = false;

    const confirmLive = () => {
      if (confirmedLive) return;
      if (this.ffmpegProc === proc && this.state.desiredStatus === 'streaming') {
        confirmedLive = true;
        this.encoderStatus = 'live';
        this.lastError = null;
        this.reconnectCount = 0;
        this.addLog('info', 'Connected to YouTube Live ingest — streaming 720p30 countdown.');
      }
    };

    if (this.liveConfirmTimer) {
      clearTimeout(this.liveConfirmTimer);
      this.liveConfirmTimer = null;
    }

    const confirmTimer = setTimeout(() => {
      confirmLive();
    }, 8000);
    this.liveConfirmTimer = confirmTimer;

    let stderrTail = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = scrubSecret(chunk.toString('utf8'), this.state.streamKey);
      stderrTail = `${stderrTail}${text}`.slice(-1200);
      const frameCount = parseFfmpegFrameCount(text);
      if (frameCount !== null) {
        if (this.ffmpegProc === proc) {
          this.lastProgressTimeMs = Date.now();
        }
        if (frameCount >= 20) {
          clearTimeout(confirmTimer);
          if (this.liveConfirmTimer === confirmTimer) {
            this.liveConfirmTimer = null;
          }
          confirmLive();
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(confirmTimer);
      if (this.liveConfirmTimer === confirmTimer) {
        this.liveConfirmTimer = null;
      }
      if (this.intentionallyStoppedProcs.has(proc)) {
        return;
      }
      if (this.ffmpegProc === proc) {
        this.ffmpegProc = null;
        this.lastProgressTimeMs = 0;
        this.encoderStartedAtMs = 0;
      }
      const msg = scrubSecret(err.message, this.state.streamKey);
      this.lastError = `Encoder launch failed: ${msg}`;
      this.encoderStatus = 'error';
      this.addLog('error', this.lastError);
      this.scheduleReconnect();
    });

    proc.on('exit', (code, signal) => {
      clearTimeout(confirmTimer);
      if (this.liveConfirmTimer === confirmTimer) {
        this.liveConfirmTimer = null;
      }
      if (this.intentionallyStoppedProcs.has(proc)) {
        return;
      }
      if (this.ffmpegProc === proc) {
        this.ffmpegProc = null;
        this.lastProgressTimeMs = 0;
        this.encoderStartedAtMs = 0;
      }
      if (this.state.desiredStatus !== 'streaming') {
        this.encoderStatus = 'idle';
        return;
      }

      const cleanedDetail = stderrTail
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('frame='))
        .slice(-2)
        .join(' | ');

      if (/pull function|Input\/output error/i.test(cleanedDetail)) {
        this.lastError =
          'YouTube closed the RTMPS connection. Check that your Stream Key is valid and your YouTube Studio Live control room is ready.';
      } else if (/timed out|ETIMEDOUT/i.test(cleanedDetail)) {
        this.lastError =
          'Connection to YouTube timed out. Select "YouTube Primary RTMPS (Port 443)" as your ingest server.';
      } else {
        this.lastError = cleanedDetail
          ? `YouTube stream disconnected (${cleanedDetail})`
          : `FFmpeg exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'})`;
      }

      this.addLog('warning', this.lastError);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.state.desiredStatus !== 'streaming') return;
    this.reconnectCount += 1;
    this.encoderStatus = 'reconnecting';
    const delayMs = Math.min(30_000, 3000 * Math.pow(2, Math.min(4, this.reconnectCount - 1)));
    this.addLog('info', `Auto-reconnecting stream in ${Math.round(delayMs / 1000)}s (attempt ${this.reconnectCount}).`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.state.desiredStatus === 'streaming') {
        this.startWorker();
      }
    }, delayMs);
  }

  private restartFfmpegWorker(): void {
    this.stopFfmpegProcess();
    if (this.state.desiredStatus === 'streaming') {
      this.startWorker();
    }
  }

  private stopFfmpegProcess(): void {
    if (this.liveConfirmTimer) {
      clearTimeout(this.liveConfirmTimer);
      this.liveConfirmTimer = null;
    }
    this.lastProgressTimeMs = 0;
    this.encoderStartedAtMs = 0;
    if (!this.ffmpegProc) return;
    const proc = this.ffmpegProc;
    this.ffmpegProc = null;
    this.intentionallyStoppedProcs.add(proc);
    try {
      proc.kill('SIGTERM');
    } catch {
      // process already terminated
    }
  }

  public async renderSnapshotJpeg(): Promise<Buffer> {
    const now = Date.now();
    if (now - this.lastSnapshotTimeMs < 900 && fs.existsSync(this.snapshotPath)) {
      return fs.readFileSync(this.snapshotPath);
    }

    if (this.snapshotPromise) {
      return this.snapshotPromise;
    }

    this.snapshotPromise = new Promise<Buffer>((resolve, reject) => {
      this.syncTextFiles();
      const tmpFrame = `${this.snapshotPath}.tmp.jpg`;
      const args = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        ...this.getBackdropInputArgs(),
        '-vf',
        this.buildVideoFilter(),
        '-frames:v',
        '1',
        '-q:v',
        '3',
        tmpFrame,
      ];

      const snapProc = spawn('ffmpeg', args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
      let errOut = '';
      snapProc.stderr?.on('data', (d: Buffer) => {
        errOut += d.toString('utf8');
      });

      snapProc.on('error', (err) => {
        this.snapshotPromise = null;
        reject(err);
      });

      snapProc.on('exit', (code) => {
        this.snapshotPromise = null;
        if (code === 0 && fs.existsSync(tmpFrame)) {
          fs.renameSync(tmpFrame, this.snapshotPath);
          this.lastSnapshotTimeMs = Date.now();
          this.lastFrameUpdatedAt = new Date().toISOString();
          resolve(fs.readFileSync(this.snapshotPath));
        } else {
          reject(new Error(errOut || `Snapshot FFmpeg exited with code ${code}`));
        }
      });
    });

    return this.snapshotPromise;
  }
}
