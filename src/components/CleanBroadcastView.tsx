import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { computeCountdownParts, padTwo, type PublicStreamState } from '../shared/countdown';
import { getThemeMeta } from '../utils/themes';
import { UI_COPY, type UiLang } from '../utils/i18n';

interface CleanBroadcastViewProps {
  streamState: PublicStreamState;
  clockOffsetMs: number;
  lang: UiLang;
  onExit: () => void;
}

export function CleanBroadcastView({
  streamState,
  clockOffsetMs,
  lang,
  onExit,
}: CleanBroadcastViewProps) {
  const copy = UI_COPY[lang];
  const [nowMs, setNowMs] = useState(() => Date.now() + clockOffsetMs);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now() + clockOffsetMs);
    }, 250);
    return () => window.clearInterval(timer);
  }, [clockOffsetMs]);

  const { config } = streamState;
  const theme = getThemeMeta(config.themeId);
  const parts = computeCountdownParts(config.targetIso, nowMs);

  const targetDateObj = new Date(config.targetIso);
  const formattedTargetDate = Number.isFinite(targetDateObj.getTime())
    ? new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(targetDateObj)
    : '';

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-[#0B0F17] px-6 py-12 text-center">
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

      <button
        type="button"
        onClick={onExit}
        className="fixed left-6 top-6 z-20 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/60 px-3.5 py-2 text-xs font-medium text-slate-200 backdrop-blur-sm transition-colors hover:bg-black/80"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{copy.exitCleanView}</span>
      </button>

      <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center space-y-8">
        <div className="space-y-3">
          {formattedTargetDate ? (
            <p className="font-mono text-sm tracking-wide text-slate-300">
              <span>{formattedTargetDate}</span>
            </p>
          ) : null}

          <h1 className="font-display text-4xl font-bold leading-tight text-white [text-wrap:balance] sm:text-6xl">
            {config.title}
          </h1>

          {config.details ? (
            <p className="mx-auto max-w-3xl text-base leading-relaxed text-slate-200 sm:text-xl">
              {config.details}
            </p>
          ) : null}
        </div>

        <div className="h-px w-full max-w-2xl bg-white/15" />

        {parts.isCompleted ? (
          <p className="font-display text-4xl font-bold text-white sm:text-6xl">
            {config.completionText}
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-6 sm:gap-12">
            {[
              { value: padTwo(parts.days), label: copy.days },
              { value: padTwo(parts.hours), label: copy.hours },
              { value: padTwo(parts.minutes), label: copy.minutes },
              { value: padTwo(parts.seconds), label: copy.seconds },
            ].map((unit) => (
              <div key={unit.label} className="flex flex-col items-center">
                <span className="font-mono text-5xl font-bold tracking-tight text-white tabular-nums sm:text-8xl">
                  {unit.value}
                </span>
                <span className="mt-2 font-mono text-xs tracking-wider text-slate-300 sm:text-sm">
                  {unit.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
