import { Server } from 'lucide-react';
import type { StreamLogEntry } from '../shared/countdown';
import { UI_COPY, type UiLang } from '../utils/i18n';

interface StreamLogPanelProps {
  logs: StreamLogEntry[];
  lang: UiLang;
}

export function StreamLogPanel({ logs, lang }: StreamLogPanelProps) {
  const copy = UI_COPY[lang];

  return (
    <section id="logs" aria-label="Persistent Server Activity" className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
        <div className="flex items-start gap-3">
          <Server className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" aria-hidden="true" />
          <div>
            <h2 className="font-display text-sm font-semibold text-white">
              {copy.persistenceHeadline}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {copy.persistenceBody}
            </p>
            <p className="mt-2 border-t border-slate-800/80 pt-2 text-xs leading-relaxed text-slate-400">
              {copy.persistenceEnvTip}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
        <h3 className="font-display text-sm font-semibold text-white">{copy.activityTitle}</h3>
        {logs.length === 0 ? (
          <p className="mt-3 text-xs text-slate-400">{copy.emptyLogs}</p>
        ) : (
          <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
            {logs.slice(0, 12).map((entry) => {
              const timeStr = new Date(entry.timestampIso).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              const levelStyle =
                entry.level === 'error'
                  ? 'text-red-400'
                  : entry.level === 'warning'
                    ? 'text-amber-400'
                    : 'text-slate-300';

              return (
                <li
                  key={entry.id}
                  className="flex items-baseline gap-3 border-b border-slate-800/70 pb-2 text-xs last:border-b-0 last:pb-0"
                >
                  <span className="shrink-0 font-mono text-[11px] text-slate-500 tabular-nums">
                    {timeStr}
                  </span>
                  <span className={levelStyle}>{entry.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
