import { useEffect, useState, type FormEvent } from 'react';
import { Check, KeyRound, Play, Square, Trash2 } from 'lucide-react';
import {
  YOUTUBE_INGEST_PRESETS,
  type PublicStreamState,
  type StreamMode,
} from '../shared/countdown';
import { UI_COPY, type UiLang } from '../utils/i18n';

interface YouTubePanelProps {
  streamState: PublicStreamState;
  lang: UiLang;
  onSaveYouTube: (payload: {
    ingestUrl?: string;
    streamKey?: string;
    clearStreamKey?: boolean;
    streamMode?: StreamMode;
  }) => Promise<{ ok: boolean; error?: string }>;
  onStartStream: (mode: StreamMode) => Promise<{ ok: boolean; error?: string }>;
  onStopStream: () => Promise<{ ok: boolean; error?: string }>;
}

export function YouTubePanel({
  streamState,
  lang,
  onSaveYouTube,
  onStartStream,
  onStopStream,
}: YouTubePanelProps) {
  const copy = UI_COPY[lang];
  const [streamMode, setStreamMode] = useState<StreamMode>(streamState.streamMode);
  const [ingestUrl, setIngestUrl] = useState(streamState.ingestUrl);
  const [streamKeyInput, setStreamKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setStreamMode(streamState.streamMode);
    setIngestUrl(streamState.ingestUrl);
  }, [streamState.streamMode, streamState.ingestUrl]);

  const isStreaming = streamState.desiredStatus === 'streaming';

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavedNotice(null);
    setSaving(true);

    const res = await onSaveYouTube({
      ingestUrl: ingestUrl.trim(),
      streamKey: streamKeyInput.trim() || undefined,
      streamMode,
    });
    setSaving(false);

    if (!res.ok) {
      setErrorMsg(res.error ?? 'Could not save YouTube settings.');
      return;
    }

    setStreamKeyInput('');
    setSavedNotice('YouTube configuration saved on server.');
    window.setTimeout(() => setSavedNotice(null), 3500);
  };

  const handleClearKey = async () => {
    setErrorMsg(null);
    setSaving(true);
    const res = await onSaveYouTube({ clearStreamKey: true });
    setSaving(false);
    if (!res.ok) {
      setErrorMsg(res.error ?? 'Could not clear stream key.');
    } else {
      setSavedNotice('Stream key removed from server.');
      window.setTimeout(() => setSavedNotice(null), 3000);
    }
  };

  const handleStart = async () => {
    setErrorMsg(null);
    setSavedNotice(null);

    if (streamKeyInput.trim()) {
      const saveRes = await onSaveYouTube({
        ingestUrl: ingestUrl.trim(),
        streamKey: streamKeyInput.trim(),
        streamMode,
      });
      if (!saveRes.ok) {
        setErrorMsg(saveRes.error ?? 'Failed to save stream settings.');
        return;
      }
      setStreamKeyInput('');
    }

    const startRes = await onStartStream(streamMode);
    if (!startRes.ok) {
      setErrorMsg(startRes.error ?? 'Unable to start stream.');
    }
  };

  const handleStopConfirmed = async () => {
    setConfirmingStop(false);
    setErrorMsg(null);
    const res = await onStopStream();
    if (!res.ok) {
      setErrorMsg(res.error ?? 'Unable to stop stream.');
    }
  };

  return (
    <div id="youtube" className="space-y-5">
      <form onSubmit={handleSaveSettings} className="space-y-4">
        <div>
          <span className="block text-xs font-medium text-slate-300">{copy.modeLabel}</span>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded-lg border border-slate-800 bg-[#0B0F17] p-1">
            <button
              type="button"
              onClick={() => setStreamMode('youtube')}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                streamMode === 'youtube'
                  ? 'bg-red-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {copy.modeYouTube}
            </button>
            <button
              type="button"
              onClick={() => setStreamMode('preview')}
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                streamMode === 'preview'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {copy.modePreview}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="ingest-preset-select" className="block text-xs font-medium text-slate-300">
            {copy.ingestLabel}
          </label>
          <select
            id="ingest-preset-select"
            value={
              YOUTUBE_INGEST_PRESETS.some((p) => p.url === ingestUrl) ? ingestUrl : 'custom'
            }
            onChange={(e) => {
              if (e.target.value !== 'custom') {
                setIngestUrl(e.target.value);
              }
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none"
          >
            {YOUTUBE_INGEST_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.url}>
                {preset.label}
              </option>
            ))}
            <option value="custom">Custom RTMP / RTMPS Endpoint</option>
          </select>

          <input
            id="ingest-url-input"
            aria-label="RTMP Ingest URL"
            type="text"
            value={ingestUrl}
            onChange={(e) => setIngestUrl(e.target.value)}
            placeholder="rtmps://a.rtmps.youtube.com:443/live2"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 font-mono text-xs text-slate-200 placeholder-slate-500 focus:border-red-500 focus:outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="stream-key-input" className="block text-xs font-medium text-slate-300">
              {copy.streamKeyLabel}
            </label>
            {streamState.hasStreamKey ? (
              <span
                data-testid="masked-stream-key"
                className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400"
              >
                <KeyRound className="h-3 w-3" aria-hidden="true" />
                {streamState.maskedStreamKey}
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="stream-key-input"
              type="password"
              autoComplete="off"
              value={streamKeyInput}
              onChange={(e) => {
                setStreamKeyInput(e.target.value);
                if (e.target.value.trim()) {
                  setStreamMode('youtube');
                }
              }}
              placeholder={
                streamState.hasStreamKey
                  ? 'Enter new key to replace saved key'
                  : 'Paste YouTube Studio stream key (xxxx-xxxx-xxxx-xxxx)'
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 font-mono text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
            />
            {streamState.hasStreamKey ? (
              <button
                type="button"
                onClick={handleClearKey}
                aria-label="Clear saved YouTube stream key"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-red-500/50 hover:text-red-300 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{copy.clearKey}</span>
              </button>
            ) : null}
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
        >
          {saving ? copy.saving : copy.saveYouTube}
        </button>
      </form>

      {errorMsg || streamState.lastError ? (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-300"
        >
          {errorMsg || streamState.lastError}
        </p>
      ) : null}

      {savedNotice ? (
        <p className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{savedNotice}</span>
        </p>
      ) : null}

      {/* Persistent Stream Primary Control */}
      <div className="space-y-2.5 border-t border-slate-800 pt-4">
        {isStreaming && streamState.streamMode === 'preview' && streamState.hasStreamKey ? (
          <button
            type="button"
            onClick={() => onStartStream('youtube')}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500"
          >
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            <span>Push Live Stream to YouTube Now</span>
          </button>
        ) : null}

        {!isStreaming ? (
          <button
            type="button"
            data-testid="start-persistent-stream-btn"
            onClick={handleStart}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500"
          >
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            <span>
              {streamMode === 'youtube' ? 'Start Persistent YouTube Stream' : 'Start Persistent Server Broadcast'}
            </span>
          </button>
        ) : confirmingStop ? (
          <div className="space-y-2 rounded-lg border border-red-500/40 bg-red-950/30 p-3">
            <p className="text-xs text-slate-200">
              Stop the server-side stream now? Viewers on YouTube will be disconnected.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="confirm-stop-stream-btn"
                onClick={handleStopConfirmed}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500"
              >
                {copy.confirmStop}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingStop(false)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
              >
                {copy.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="stop-persistent-stream-btn"
            onClick={() => setConfirmingStop(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/50 bg-red-600/15 px-4 py-3 text-sm font-semibold text-red-300 transition-colors hover:bg-red-600 hover:text-white"
          >
            <Square className="h-4 w-4 fill-current" aria-hidden="true" />
            <span>{copy.stopStream}</span>
          </button>
        )}
      </div>

      {/* Compact YouTube Studio Setup Steps */}
      <div className="border-t border-slate-800 pt-4 text-xs text-slate-400">
        <p className="font-semibold text-slate-200">How to connect YouTube Studio</p>
        <ol className="mt-2 list-inside list-decimal space-y-1.5 leading-relaxed">
          <li>Open YouTube Studio and click Create → Go Live.</li>
          <li>Copy the Stream URL and Stream Key, paste above, and click Save.</li>
          <li>Start the stream here — you can close this app or turn off your device anytime.</li>
        </ol>
      </div>
    </div>
  );
}
