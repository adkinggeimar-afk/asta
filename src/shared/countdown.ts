export type BackdropThemeId = 'obsidian' | 'midnight' | 'amber' | 'minimal';

export type MusicMode = 'none' | 'preset-ambient' | 'preset-horizon' | 'custom';

export type StreamMode = 'youtube' | 'preview';

export type DesiredStreamStatus = 'stopped' | 'streaming';

export type EncoderStatus = 'idle' | 'starting' | 'live' | 'reconnecting' | 'error';

export interface CountdownConfig {
  title: string;
  details: string;
  targetIso: string;
  timezoneLabel: string;
  themeId: BackdropThemeId;
  completionText: string;
  youtubeWatchUrl: string;
  musicMode: MusicMode;
  musicVolume: number;
  customMusicName: string;
}

export interface StreamLogEntry {
  id: string;
  timestampIso: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface PublicStreamState {
  config: CountdownConfig;
  desiredStatus: DesiredStreamStatus;
  streamMode: StreamMode;
  encoderStatus: EncoderStatus;
  ingestUrl: string;
  hasStreamKey: boolean;
  maskedStreamKey: string;
  startedAtIso: string | null;
  reconnectCount: number;
  lastError: string | null;
  lastFrameUpdatedAt: string | null;
  configUpdatedAtIso: string | null;
  serverTimeIso: string;
  logs: StreamLogEntry[];
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  isCompleted: boolean;
  isValid: boolean;
  formattedClock: string;
  formattedCompact: string;
}

export const DEFAULT_YOUTUBE_INGEST_URL = 'rtmps://a.rtmps.youtube.com:443/live2';

export const YOUTUBE_INGEST_PRESETS = [
  {
    id: 'primary-rtmps',
    label: 'YouTube Primary RTMPS (Port 443 · Recommended)',
    url: 'rtmps://a.rtmps.youtube.com:443/live2',
  },
  {
    id: 'backup-rtmps',
    label: 'YouTube Backup RTMPS (Port 443)',
    url: 'rtmps://b.rtmps.youtube.com:443/live2?backup=1',
  },
  {
    id: 'primary-rtmp',
    label: 'YouTube Standard RTMP (Port 1935)',
    url: 'rtmp://a.rtmp.youtube.com/live2',
  },
] as const;

export function normalizeYouTubeIngestUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (
    trimmed === 'rtmp://a.rtmp.youtube.com/live2' ||
    trimmed === 'rtmps://a.rtmp.youtube.com:443/live2' ||
    trimmed === 'rtmps://a.rtmp.youtube.com/live2'
  ) {
    return 'rtmps://a.rtmps.youtube.com:443/live2';
  }
  if (
    trimmed === 'rtmp://b.rtmp.youtube.com/live2?backup=1' ||
    trimmed === 'rtmps://b.rtmp.youtube.com:443/live2?backup=1'
  ) {
    return 'rtmps://b.rtmps.youtube.com:443/live2?backup=1';
  }
  return trimmed;
}

export const VALID_THEME_IDS: ReadonlyArray<BackdropThemeId> = [
  'obsidian',
  'midnight',
  'amber',
  'minimal',
];

export const VALID_MUSIC_MODES: ReadonlyArray<MusicMode> = [
  'none',
  'preset-ambient',
  'preset-horizon',
  'custom',
];

export const MUSIC_PRESETS = [
  { id: 'none' as const, label: 'No Music (Silent)', labelBn: 'মিউজিক ছাড়া (নীরব)' },
  { id: 'preset-ambient' as const, label: 'Warm Studio Pad', labelBn: 'ওয়ার্ম স্টুডিও প্যাড' },
  { id: 'preset-horizon' as const, label: 'Soft Horizon Chords', labelBn: 'সফট হরাইজন কর্ডস' },
  { id: 'custom' as const, label: 'Custom Audio Upload', labelBn: 'নিজের অডিও আপলোড' },
] as const;

export const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ALLOWED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'] as const;

export function normalizeMusicVolume(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return 35;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function validateAudioUploadMeta(
  filename: string,
  mimeType: string,
  sizeBytes: number,
): { ok: true; ext: string; cleanName: string } | { ok: false; error: string } {
  const baseName = filename.replace(/[/\\]/g, '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!baseName) {
    return { ok: false, error: 'Audio filename is missing.' };
  }
  const dotIdx = baseName.lastIndexOf('.');
  const ext = dotIdx >= 0 ? baseName.slice(dotIdx).toLowerCase() : '';
  if (!ALLOWED_AUDIO_EXTENSIONS.includes(ext as (typeof ALLOWED_AUDIO_EXTENSIONS)[number])) {
    return {
      ok: false,
      error: 'Unsupported audio format. Please upload MP3, WAV, M4A, AAC, OGG, or FLAC.',
    };
  }

  const normalizedMime = mimeType.split(';')[0].trim().toLowerCase();
  if (
    normalizedMime &&
    normalizedMime !== 'application/octet-stream' &&
    !normalizedMime.startsWith('audio/') &&
    normalizedMime !== 'video/mp4'
  ) {
    return { ok: false, error: 'Uploaded file must be a valid audio track.' };
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes < 128) {
    return { ok: false, error: 'Uploaded audio file is empty or too small.' };
  }
  if (sizeBytes > MAX_AUDIO_UPLOAD_BYTES) {
    return { ok: false, error: 'Audio file must be 25 MB or smaller.' };
  }

  return {
    ok: true,
    ext,
    cleanName: baseName.slice(0, 80),
  };
}

export function createDefaultConfig(nowMs: number = Date.now()): CountdownConfig {
  const defaultTarget = new Date(nowMs + 48 * 60 * 60 * 1000);
  defaultTarget.setSeconds(0, 0);
  return {
    title: 'Annual Global Keynote & Live Launch',
    details: 'Countdown to our live worldwide broadcast premiere. Stay tuned as we go live on schedule.',
    targetIso: defaultTarget.toISOString(),
    timezoneLabel: 'UTC',
    themeId: 'obsidian',
    completionText: 'Broadcast Starting Now',
    youtubeWatchUrl: '',
    musicMode: 'none',
    musicVolume: 35,
    customMusicName: '',
  };
}

export function padTwo(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, '0');
}

export function computeCountdownParts(targetIso: string, nowMs: number = Date.now()): CountdownParts {
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalMs: 0,
      isCompleted: false,
      isValid: false,
      formattedClock: '00 : 00 : 00 : 00',
      formattedCompact: '00:00:00:00',
    };
  }

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalMs: 0,
      isCompleted: true,
      isValid: true,
      formattedClock: '00 : 00 : 00 : 00',
      formattedCompact: '00:00:00:00',
    };
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const dStr = String(days).padStart(2, '0');
  const hStr = padTwo(hours);
  const mStr = padTwo(minutes);
  const sStr = padTwo(seconds);

  return {
    days,
    hours,
    minutes,
    seconds,
    totalMs: diffMs,
    isCompleted: false,
    isValid: true,
    formattedClock: `${dStr} : ${hStr} : ${mStr} : ${sStr}`,
    formattedCompact: `${dStr}:${hStr}:${mStr}:${sStr}`,
  };
}

export function maskStreamKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) {
    return '••••';
  }
  const suffix = trimmed.slice(-4);
  return `••••-••••-${suffix}`;
}

export function scrubSecret(input: string, secret: string): string {
  if (!secret || !secret.trim()) return input;
  return input.split(secret.trim()).join('[REDACTED]');
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '::1' ||
    lower === '[::1]' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  return false;
}

export function validateRtmpUrl(rawUrl: string): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: 'RTMP ingest URL is required.' };
  }
  if (/[\s"'`$;|&<>\\]/.test(trimmed)) {
    return { ok: false, error: 'RTMP URL contains invalid characters or whitespace.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid RTMP URL format.' };
  }

  if (parsed.protocol !== 'rtmp:' && parsed.protocol !== 'rtmps:') {
    return { ok: false, error: 'Ingest URL must start with rtmp:// or rtmps://.' };
  }

  if (!parsed.hostname || isPrivateOrLoopbackHost(parsed.hostname)) {
    return { ok: false, error: 'Private or loopback RTMP destinations are not allowed.' };
  }

  const normalized = trimmed.replace(/\/+$/, '');
  return { ok: true, normalizedUrl: normalized };
}

export function validateStreamKey(rawKey: string): { ok: true; cleanKey: string } | { ok: false; error: string } {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return { ok: false, error: 'YouTube Stream Key cannot be empty.' };
  }
  if (trimmed.length < 4 || trimmed.length > 256) {
    return { ok: false, error: 'Stream Key length must be between 4 and 256 characters.' };
  }
  if (/[^a-zA-Z0-9\-_.~?=&#/]/.test(trimmed)) {
    return { ok: false, error: 'Stream Key contains unsupported characters.' };
  }
  return { ok: true, cleanKey: trimmed };
}

export function validateCountdownInput(
  input: Partial<CountdownConfig>,
): { ok: true; value: CountdownConfig } | { ok: false; error: string } {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) {
    return { ok: false, error: 'Event title is required.' };
  }
  if (title.length > 120) {
    return { ok: false, error: 'Event title must be 120 characters or fewer.' };
  }

  const details = typeof input.details === 'string' ? input.details.trim() : '';
  if (details.length > 280) {
    return { ok: false, error: 'Countdown details must be 280 characters or fewer.' };
  }

  const targetIso = typeof input.targetIso === 'string' ? input.targetIso.trim() : '';
  const parsedTarget = Date.parse(targetIso);
  if (!targetIso || !Number.isFinite(parsedTarget)) {
    return { ok: false, error: 'Please select a valid target date and time.' };
  }

  const themeId =
    typeof input.themeId === 'string' && VALID_THEME_IDS.includes(input.themeId as BackdropThemeId)
      ? (input.themeId as BackdropThemeId)
      : 'obsidian';

  const timezoneLabel =
    typeof input.timezoneLabel === 'string' && input.timezoneLabel.trim()
      ? input.timezoneLabel.trim().slice(0, 64)
      : 'UTC';

  const completionText =
    typeof input.completionText === 'string' && input.completionText.trim()
      ? input.completionText.trim().slice(0, 100)
      : 'Broadcast Starting Now';

  const youtubeWatchUrl =
    typeof input.youtubeWatchUrl === 'string' ? input.youtubeWatchUrl.trim().slice(0, 300) : '';

  if (youtubeWatchUrl) {
    const id = extractYouTubeVideoId(youtubeWatchUrl);
    if (!id) {
      return { ok: false, error: 'YouTube Live link must be a valid youtube.com or youtu.be URL or video ID.' };
    }
  }

  const musicMode =
    typeof input.musicMode === 'string' && VALID_MUSIC_MODES.includes(input.musicMode as MusicMode)
      ? (input.musicMode as MusicMode)
      : 'none';

  const musicVolume = normalizeMusicVolume(input.musicVolume);
  const customMusicName =
    typeof input.customMusicName === 'string'
      ? input.customMusicName.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80)
      : '';

  return {
    ok: true,
    value: {
      title,
      details,
      targetIso: new Date(parsedTarget).toISOString(),
      timezoneLabel,
      themeId,
      completionText,
      youtubeWatchUrl,
      musicMode,
      musicVolume,
      customMusicName,
    },
  };
}

export function extractYouTubeVideoId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const candidate = url.pathname.replace(/^\/+/, '').split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
    }
    if (host.endsWith('youtube.com')) {
      const vParam = url.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
        return vParam;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'shorts') && parts[1]) {
        return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function formatUptime(startedAtIso: string | null, nowMs: number = Date.now()): string {
  if (!startedAtIso) return '00:00:00';
  const startMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startMs) || nowMs < startMs) return '00:00:00';
  const totalSec = Math.floor((nowMs - startMs) / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const hms = `${padTwo(hours)}:${padTwo(minutes)}:${padTwo(seconds)}`;
  return days > 0 ? `${days}d ${hms}` : hms;
}

export function containsBengaliScript(text: string): boolean {
  return /[\u0980-\u09FF]/.test(text);
}

export function toLocalDateTimeInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = padTwo(date.getMonth() + 1);
  const day = padTwo(date.getDate());
  const hours = padTwo(date.getHours());
  const minutes = padTwo(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseFfmpegFrameCount(stderrChunk: string): number | null {
  const matches = [...stderrChunk.matchAll(/frame=\s*(\d+)/g)];
  if (matches.length === 0) return null;
  const last = Number(matches[matches.length - 1][1]);
  return Number.isFinite(last) ? last : null;
}

export function isStreamStalled(
  lastProgressMs: number,
  nowMs: number = Date.now(),
  stallThresholdMs: number = 25_000,
): boolean {
  if (!Number.isFinite(lastProgressMs) || lastProgressMs <= 0) return false;
  return nowMs - lastProgressMs > stallThresholdMs;
}

export function shouldAutoResumeFromEnv(env: {
  streamKey?: string;
  autoStart?: string;
}): boolean {
  const keyOk = Boolean(env.streamKey && env.streamKey.trim().length >= 4);
  const flag = (env.autoStart ?? '').trim().toLowerCase();
  return keyOk && (flag === 'true' || flag === '1' || flag === 'yes');
}

