import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Radio, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import {
  computeCountdownParts,
  extractYouTubeVideoId,
  formatUptime,
  padTwo,
  type PublicStreamState,
} from '../shared/countdown';
import { getThemeMeta } from '../utils/themes';
import { UI_COPY, type UiLang } from '../utils/i18n';

interface BroadcastMonitorProps {
  streamState: PublicStreamState;
  clockOffsetMs: number;
  lang: UiLang;
  onOpenCleanView: () => void;
}

export function BroadcastMonitor({
  streamState,
  clockOffsetMs,
  lang,
  onOpenCleanView,
}: BroadcastMonitorProps) {
  const copy = UI_COPY[lang];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now() + clockOffsetMs);
  const [showEncoderFrame, setShowEncoderFrame] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [frameBust, setFrameBust] = useState(() => Date.now());
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now() + clockOffsetMs);
    }, 250);
    return () => window.clearInterval(timer);
  }, [clockOffsetMs]);

  useEffect(() => {
    if (!showEncoderFrame) return;
    setFrameBust(Date.now());
    const timer = window.setInterval(() => {
      setFrameBust(Date.now());
    }, 2000);
    return () => window.clearInterval(timer);
  }, [showEncoderFrame]);

  useEffect(() => {
    setImgFailed(false);
  }, [streamState.config.themeId]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, streamState.config.musicVolume / 100));
    if (streamState.config.musicMode === 'none') {
      el.pause();
      setAudioPlaying(false);
    } else if (audioPlaying) {
      el.load();
      void el.play().catch(() => {
        setAudioPlaying(false);
      });
    }
  }, [
    streamState.config.musicMode,
    streamState.config.musicVolume,
    streamState.config.customMusicName,
    streamState.configUpdatedAtIso,
  ]);

  const toggleAudioPreview = async () => {
    const el = audioRef.current;
    if (!el || streamState.config.musicMode === 'none') return;
    if (audioPlaying) {
      el.pause();
      setAudioPlaying(false);
    } else {
      el.volume = Math.max(0, Math.min(1, streamState.config.musicVolume / 100));
      try {
        await el.play();
        setAudioPlaying(true);
      } catch {
        setAudioPlaying(false);
      }
    }
  };

  const { config, desiredStatus, streamMode, encoderStatus, startedAtIso } = streamState;
  const theme = getThemeMeta(config.themeId);
  const parts = computeCountdownParts(config.targetIso, nowMs);
  const uptimeText = formatUptime(startedAtIso, nowMs);
  const videoId = extractYouTubeVideoId(config.youtubeWatchUrl);

  const targetDateObj = new Date(config.targetIso);
  const formattedTargetDate = Number.isFinite(targetDateObj.getTime())
    ? new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(targetDateObj)
    : 'Invalid Date';

  const statusMeta = (() => {
    if (desiredStatus !== 'streaming') {
      return {
        label: copy.statusStandby,
        dotColor: '',
        textColor: 'text-slate-400',
        isLive: false,
      };
    }
    if (encoderStatus === 'live') {
      return {
        label: streamMode === 'youtube' ? copy.statusLiveYouTube : copy.statusLivePreview,
        dotColor: streamMode === 'youtube' ? 'bg-red-500' : 'bg-emerald-500',
        textColor: streamMode === 'youtube' ? 'text-red-400' : 'text-emerald-400',
        isLive: true,
      };
    }
    if (encoderStatus === 'reconnecting') {
      return {
        label: copy.statusReconnecting,
        dotColor: 'bg-amber-500',
        textColor: 'text-amber-400',
        isLive: true,
      };
    }
    if (encoderStatus === 'error') {
      return {
        label: copy.statusError,
        dotColor: 'bg-red-500',
        textColor: 'text-red-400',
        isLive: false,
      };
    }
    return {
      label: copy.statusStarting,
      dotColor: 'bg-amber-500',
      textColor: 'text-amber-400',
      isLive: true,
    };
  })();

  return (
    <section id="monitor" aria-label="Broadcast Monitor" className="space-y-4">
      <div
        data-testid="broadcast-canvas"
        data-stream-status={desiredStatus}
        data-encoder-status={encoderStatus}
        className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-[#0B0F17]"
      >
        {showEncoderFrame ? (
          <div className="relative h-full w-full bg-black">
            <img
              src={`/api/stream/snapshot.jpg?t=${frameBust}`}
              alt="Server FFmpeg rendered broadcast frame"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div className="absolute bottom-3 right-3 rounded bg-black/75 px-2.5 py-1 font-mono text-xs text-slate-300">
              FFmpeg 1280×720 Snapshot
            </div>
          </div>
        ) : (
          <>
            {theme.imageUrl && !imgFailed ? (
              <img
                src={theme.imageUrl}
                alt={theme.name}
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className={`absolute inset-0 ${theme.swatchClass}`} />
            )}

            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/45 to-black/80" />

            <div className="relative z-10 flex h-full flex-col items-center justify-between px-3.5 py-2.5 text-center sm:px-10 sm:py-8">
              {/* Top details block: explains what the countdown is for */}
              <div className="max-w-2xl space-y-0.5 sm:space-y-2">
                <p className="font-mono text-[10px] tracking-wide text-slate-300 sm:text-xs">
                  <span>{formattedTargetDate}</span>
                </p>

                <h1 className="font-display text-sm font-bold leading-snug text-white line-clamp-1 sm:line-clamp-2 sm:text-3xl sm:leading-tight [text-wrap:balance]">
                  {config.title}
                </h1>

                {config.details ? (
                  <p className="mx-auto max-w-xl text-[11px] leading-snug text-slate-200/90 line-clamp-1 sm:line-clamp-2 sm:text-sm sm:leading-relaxed">
                    {config.details}
                  </p>
                ) : null}
              </div>

              {/* Divider */}
              <div className="h-px w-full max-w-xl bg-white/15" />

              {/* Hero Tabular Countdown */}
              {parts.isCompleted ? (
                <div className="py-1 sm:py-2">
                  <p
                    data-testid="countdown-completed-text"
                    className="font-display text-lg font-bold tracking-tight text-white sm:text-4xl"
                  >
                    {config.completionText}
                  </p>
                </div>
              ) : (
                <div
                  data-testid="countdown-clock"
                  className="grid grid-cols-4 gap-3 sm:gap-6"
                >
                  {[
                    { value: padTwo(parts.days), label: copy.days },
                    { value: padTwo(parts.hours), label: copy.hours },
                    { value: padTwo(parts.minutes), label: copy.minutes },
                    { value: padTwo(parts.seconds), label: copy.seconds },
                  ].map((unit) => (
                    <div key={unit.label} className="flex flex-col items-center">
                      <span className="font-mono text-2xl font-bold leading-none tracking-tight text-white tabular-nums sm:text-5xl md:text-6xl">
                        {unit.value}
                      </span>
                      <span className="mt-1 font-mono text-[9px] tracking-wide text-slate-300 sm:text-xs">
                        {unit.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Subtle bottom line */}
              <div className="flex w-full items-center justify-between text-[10px] text-slate-300/80 sm:text-xs">
                <span className="font-mono truncate max-w-[60%]">
                  {desiredStatus === 'streaming'
                    ? streamMode === 'youtube'
                      ? 'YouTube RTMP Stream Active'
                      : 'Persistent Server Broadcast'
                    : 'Broadcast Preview'}
                </span>
                <span className="font-mono tabular-nums">
                  {desiredStatus === 'streaming' ? `Uptime ${uptimeText}` : '720p30 H.264'}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Monitor Telemetry & Actions Row */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#111827] px-4 py-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            {statusMeta.isLive ? (
              <span
                aria-hidden="true"
                className={`inline-block h-2.5 w-2.5 rounded-full ${statusMeta.dotColor} animate-pulse`}
              />
            ) : (
              <Radio className="h-4 w-4 text-slate-400" aria-hidden="true" />
            )}
            <span data-testid="stream-status-label" className={statusMeta.textColor}>
              {statusMeta.label}
            </span>
          </div>

          <span aria-hidden="true" className="text-slate-700">
            ·
          </span>

          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="text-slate-400">{copy.serverUptime}:</span>
            <span data-testid="server-uptime" className="font-mono font-semibold text-white tabular-nums">
              {uptimeText}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {config.musicMode !== 'none' ? (
            <>
              <audio
                ref={audioRef}
                loop
                preload="none"
                src={`/api/stream/music/file?v=${encodeURIComponent(streamState.configUpdatedAtIso ?? config.musicMode)}`}
              />
              <button
                type="button"
                data-testid="toggle-audio-preview-btn"
                onClick={toggleAudioPreview}
                aria-pressed={audioPlaying}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  audioPlaying
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {audioPlaying ? (
                  <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{audioPlaying ? copy.audioPreviewMute : copy.audioPreviewPlay}</span>
              </button>
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setShowEncoderFrame((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{showEncoderFrame ? copy.liveCanvasView : copy.previewServerFrame}</span>
          </button>

          {videoId ? (
            <a
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Open YouTube</span>
            </a>
          ) : null}

          <button
            type="button"
            onClick={onOpenCleanView}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.cleanView}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
