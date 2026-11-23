import { useCallback, useEffect, useState } from 'react';
import {
  createDefaultConfig,
  DEFAULT_YOUTUBE_INGEST_URL,
  type CountdownConfig,
  type PublicStreamState,
  type StreamMode,
} from './shared/countdown';
import { BroadcastMonitor } from './components/BroadcastMonitor';
import { CountdownForm } from './components/CountdownForm';
import { YouTubePanel } from './components/YouTubePanel';
import { StreamLogPanel } from './components/StreamLogPanel';
import { CleanBroadcastView } from './components/CleanBroadcastView';
import { UI_COPY, type UiLang } from './utils/i18n';

const BACKUP_STORAGE_KEY = 'chronocast_config_backup_v1';

const INITIAL_FALLBACK_STATE: PublicStreamState = {
  config: createDefaultConfig(),
  desiredStatus: 'stopped',
  streamMode: 'youtube',
  encoderStatus: 'idle',
  ingestUrl: DEFAULT_YOUTUBE_INGEST_URL,
  hasStreamKey: false,
  maskedStreamKey: '',
  startedAtIso: null,
  reconnectCount: 0,
  lastError: null,
  lastFrameUpdatedAt: null,
  configUpdatedAtIso: null,
  serverTimeIso: new Date().toISOString(),
  logs: [],
};

type ControlTab = 'schedule' | 'youtube';

export default function App() {
  const [streamState, setStreamState] = useState<PublicStreamState>(INITIAL_FALLBACK_STATE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [activeTab, setActiveTab] = useState<ControlTab>('schedule');
  const [lang, setLang] = useState<UiLang>('en');
  const [cleanView, setCleanView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'broadcast';
  });
  const [headerStopModalOpen, setHeaderStopModalOpen] = useState(false);

  const copy = UI_COPY[lang];

  const applyServerState = useCallback((next: PublicStreamState) => {
    setStreamState(next);
    const serverMs = Date.parse(next.serverTimeIso);
    if (Number.isFinite(serverMs)) {
      setClockOffsetMs(serverMs - Date.now());
    }
    setLoadError(null);
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/stream/state', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = (await res.json()) as PublicStreamState;

      if (data.configUpdatedAtIso === null) {
        const rawBackup = window.localStorage.getItem(BACKUP_STORAGE_KEY);
        if (rawBackup) {
          try {
            const parsed = JSON.parse(rawBackup) as Partial<CountdownConfig>;
            if (parsed.title && parsed.targetIso) {
              const restoreRes = await fetch('/api/stream/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed),
              });
              if (restoreRes.ok) {
                const restored = (await restoreRes.json()) as PublicStreamState;
                applyServerState(restored);
                return;
              }
            }
          } catch {
            // Ignore malformed local backup
          }
        }
      }

      applyServerState(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to sync with broadcast server.');
    } finally {
      setLoading(false);
    }
  }, [applyServerState]);

  useEffect(() => {
    void fetchState();
    const poll = window.setInterval(() => {
      void fetchState();
    }, 3000);
    return () => window.clearInterval(poll);
  }, [fetchState]);

  const handleSaveConfig = async (
    nextConfig: Partial<CountdownConfig>,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/stream/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to save configuration.' };
      }
      const saved = data as PublicStreamState;
      try {
        window.localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(saved.config));
      } catch {
        // Ignore storage quota errors
      }
      applyServerState(saved);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while saving configuration.' };
    }
  };

  const handleUploadMusic = async (
    file: File,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/stream/music/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to upload audio track.' };
      }
      const saved = data as PublicStreamState;
      try {
        window.localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(saved.config));
      } catch {
        // Ignore storage quota errors
      }
      applyServerState(saved);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while uploading audio file.' };
    }
  };

  const handleRemoveMusic = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/stream/music', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to remove custom audio.' };
      }
      const saved = data as PublicStreamState;
      try {
        window.localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(saved.config));
      } catch {
        // Ignore storage quota errors
      }
      applyServerState(saved);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while removing custom audio.' };
    }
  };

  const handleSaveYouTube = async (payload: {
    ingestUrl?: string;
    streamKey?: string;
    clearStreamKey?: boolean;
    streamMode?: StreamMode;
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/stream/youtube', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to save YouTube settings.' };
      }
      applyServerState(data as PublicStreamState);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while saving YouTube settings.' };
    }
  };

  const handleStartStream = async (
    mode: StreamMode,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Unable to start stream.' };
      }
      applyServerState(data as PublicStreamState);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while starting stream.' };
    }
  };

  const handleStopStream = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/stream/stop', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Unable to stop stream.' };
      }
      applyServerState(data as PublicStreamState);
      setHeaderStopModalOpen(false);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while stopping stream.' };
    }
  };

  const handleHeaderPrimaryAction = async () => {
    if (streamState.desiredStatus === 'streaming') {
      setHeaderStopModalOpen(true);
      return;
    }

    if (streamState.streamMode === 'youtube' && !streamState.hasStreamKey) {
      setActiveTab('youtube');
      document.getElementById('studio-controls')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    const res = await handleStartStream(streamState.streamMode);
    if (!res.ok) {
      setActiveTab('youtube');
    }
  };

  const handleNavClick = (section: 'monitor' | 'schedule' | 'youtube' | 'logs') => {
    if (section === 'schedule') {
      setActiveTab('schedule');
      document.getElementById('studio-controls')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (section === 'youtube') {
      setActiveTab('youtube');
      document.getElementById('studio-controls')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' });
  };

  if (cleanView) {
    return (
      <CleanBroadcastView
        streamState={streamState}
        clockOffsetMs={clockOffsetMs}
        lang={lang}
        onExit={() => setCleanView(false)}
      />
    );
  }

  const isStreaming = streamState.desiredStatus === 'streaming';

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="border-b border-slate-800/90 bg-[#0B0F17]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1380px] items-center justify-between gap-8 px-6 py-4">
          <a
            href="/"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            ChronoCast
          </a>

          <nav aria-label="Primary" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <button
              type="button"
              onClick={() => handleNavClick('monitor')}
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              {copy.navMonitor}
            </button>
            <button
              type="button"
              onClick={() => handleNavClick('schedule')}
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              {copy.navSchedule}
            </button>
            <button
              type="button"
              onClick={() => handleNavClick('youtube')}
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              {copy.navYouTube}
            </button>
            <button
              type="button"
              onClick={() => handleNavClick('logs')}
              className="transition-colors hover:text-white whitespace-nowrap shrink-0"
            >
              {copy.navLogs}
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              data-testid="header-stream-action-btn"
              onClick={handleHeaderPrimaryAction}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isStreaming
                  ? 'border border-red-500/60 bg-red-600/20 text-red-200 hover:bg-red-600 hover:text-white'
                  : 'bg-red-600 text-white hover:bg-red-500'
              }`}
            >
              {isStreaming ? copy.stopStream : copy.startStream}
            </button>
          </div>
        </div>
      </header>

      {/* Main Studio Workspace */}
      <main className="mx-auto max-w-[1380px] px-6 py-8">
        {loadError ? (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {loadError}
          </div>
        ) : null}

        {loading ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-7">
              <div className="aspect-video w-full animate-pulse rounded-xl border border-slate-800 bg-slate-900/70" />
              <div className="h-14 w-full animate-pulse rounded-xl border border-slate-800 bg-slate-900/70" />
            </div>
            <div className="lg:col-span-5">
              <div className="h-[520px] w-full animate-pulse rounded-xl border border-slate-800 bg-slate-900/70" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
            {/* Top-Left on Desktop, First on Mobile: 16:9 Live Broadcast Monitor */}
            <div className="lg:col-span-7">
              <BroadcastMonitor
                streamState={streamState}
                clockOffsetMs={clockOffsetMs}
                lang={lang}
                onOpenCleanView={() => setCleanView(true)}
              />
            </div>

            {/* Right on Desktop (spanning 2 rows), Second on Mobile: Studio Controls */}
            <aside
              id="studio-controls"
              aria-label="Studio Controls"
              className="rounded-xl border border-slate-800 bg-[#111827] p-5 lg:col-span-5 lg:row-span-2"
            >
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
                <div role="tablist" aria-label="Studio configuration tabs" className="flex items-center gap-1 rounded-lg bg-[#0B0F17] p-1">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'schedule'}
                    onClick={() => setActiveTab('schedule')}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      activeTab === 'schedule'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {copy.tabSchedule}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'youtube'}
                    onClick={() => setActiveTab('youtube')}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      activeTab === 'youtube'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {copy.tabYouTube}
                  </button>
                </div>

                {/* Language Switcher inside Workspace Toolbar */}
                <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0B0F17] p-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setLang('en')}
                    className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                      lang === 'en' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    onClick={() => setLang('bn')}
                    className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                      lang === 'bn' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    বাংলা
                  </button>
                </div>
              </div>

              {activeTab === 'schedule' ? (
                <CountdownForm
                  config={streamState.config}
                  lang={lang}
                  onSave={handleSaveConfig}
                  onUploadMusic={handleUploadMusic}
                  onRemoveMusic={handleRemoveMusic}
                />
              ) : (
                <YouTubePanel
                  streamState={streamState}
                  lang={lang}
                  onSaveYouTube={handleSaveYouTube}
                  onStartStream={handleStartStream}
                  onStopStream={handleStopStream}
                />
              )}
            </aside>

            {/* Bottom-Left on Desktop, Third on Mobile: Persistent Server Info & Activity */}
            <div className="lg:col-span-7">
              <StreamLogPanel logs={streamState.logs} lang={lang} />
            </div>
          </div>
        )}
      </main>

      {/* Stop Stream Confirmation Dialog */}
      {headerStopModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stop-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#111827] p-6">
            <h2 id="stop-dialog-title" className="font-display text-base font-bold text-white">
              Stop Persistent Broadcast?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Your stream is currently running on the server and stays live even if your device is off. Are you sure you want to stop it now?
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setHeaderStopModalOpen(false)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
              >
                {copy.cancel}
              </button>
              <button
                type="button"
                onClick={handleStopStream}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500"
              >
                {copy.confirmStop}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
