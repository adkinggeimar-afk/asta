import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Check, Music, Trash2, Upload, Volume2 } from 'lucide-react';
import {
  MUSIC_PRESETS,
  toLocalDateTimeInputValue,
  type BackdropThemeId,
  type CountdownConfig,
  type MusicMode,
} from '../shared/countdown';
import { BACKDROP_THEMES } from '../utils/themes';
import { UI_COPY, type UiLang } from '../utils/i18n';

interface CountdownFormProps {
  config: CountdownConfig;
  lang: UiLang;
  onSave: (nextConfig: Partial<CountdownConfig>) => Promise<{ ok: boolean; error?: string }>;
  onUploadMusic: (file: File) => Promise<{ ok: boolean; error?: string }>;
  onRemoveMusic: () => Promise<{ ok: boolean; error?: string }>;
}

export function CountdownForm({
  config,
  lang,
  onSave,
  onUploadMusic,
  onRemoveMusic,
}: CountdownFormProps) {
  const copy = UI_COPY[lang];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(config.title);
  const [details, setDetails] = useState(config.details);
  const [targetLocal, setTargetLocal] = useState(() => toLocalDateTimeInputValue(config.targetIso));
  const [themeId, setThemeId] = useState<BackdropThemeId>(config.themeId);
  const [completionText, setCompletionText] = useState(config.completionText);
  const [youtubeWatchUrl, setYoutubeWatchUrl] = useState(config.youtubeWatchUrl);
  const [musicMode, setMusicMode] = useState<MusicMode>(config.musicMode);
  const [musicVolume, setMusicVolume] = useState<number>(config.musicVolume);

  const [saving, setSaving] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    setTitle(config.title);
    setDetails(config.details);
    setTargetLocal(toLocalDateTimeInputValue(config.targetIso));
    setThemeId(config.themeId);
    setCompletionText(config.completionText);
    setYoutubeWatchUrl(config.youtubeWatchUrl);
    setMusicMode(config.musicMode);
    setMusicVolume(config.musicVolume);
  }, [
    config.title,
    config.details,
    config.targetIso,
    config.themeId,
    config.completionText,
    config.youtubeWatchUrl,
    config.musicMode,
    config.musicVolume,
  ]);

  const applyPresetHours = (hoursToAdd: number) => {
    const next = new Date(Date.now() + hoursToAdd * 3600 * 1000);
    next.setSeconds(0, 0);
    setTargetLocal(toLocalDateTimeInputValue(next.toISOString()));
    setErrorMsg(null);
  };

  const applyTomorrowEvening = () => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(20, 0, 0, 0);
    setTargetLocal(toLocalDateTimeInputValue(next.toISOString()));
    setErrorMsg(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavedFeedback(false);

    if (!title.trim()) {
      setErrorMsg('Please enter an event title.');
      return;
    }

    const parsedDate = new Date(targetLocal);
    if (!targetLocal || !Number.isFinite(parsedDate.getTime())) {
      setErrorMsg('Please choose a valid target date and time.');
      return;
    }

    const timezoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    setSaving(true);
    const result = await onSave({
      title: title.trim(),
      details: details.trim(),
      targetIso: parsedDate.toISOString(),
      timezoneLabel,
      themeId,
      completionText: completionText.trim() || 'Broadcast Starting Now',
      youtubeWatchUrl: youtubeWatchUrl.trim(),
      musicMode,
      musicVolume,
    });
    setSaving(false);

    if (!result.ok) {
      setErrorMsg(result.error ?? 'Failed to save broadcast details.');
      return;
    }

    setSavedFeedback(true);
    window.setTimeout(() => setSavedFeedback(false), 3500);
  };

  const handleAudioFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg(null);
    setSavedFeedback(false);
    setUploadingAudio(true);
    const res = await onUploadMusic(file);
    setUploadingAudio(false);

    if (!res.ok) {
      setErrorMsg(res.error ?? 'Failed to upload background music.');
      return;
    }

    setMusicMode('custom');
    setSavedFeedback(true);
    window.setTimeout(() => setSavedFeedback(false), 3500);
  };

  const handleRemoveCustomAudio = async () => {
    setErrorMsg(null);
    setUploadingAudio(true);
    const res = await onRemoveMusic();
    setUploadingAudio(false);
    if (!res.ok) {
      setErrorMsg(res.error ?? 'Could not remove custom audio.');
      return;
    }
    if (musicMode === 'custom') {
      setMusicMode('none');
    }
  };

  return (
    <form id="schedule" onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="event-title-input" className="block text-xs font-medium text-slate-300">
          {copy.eventTitleLabel}
        </label>
        <input
          id="event-title-input"
          type="text"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Grand Product Launch 2027"
          className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="event-details-input" className="block text-xs font-medium text-slate-300">
          {copy.detailsLabel}
        </label>
        <textarea
          id="event-details-input"
          rows={2}
          maxLength={280}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Explain what viewers are counting down to..."
          className="mt-1.5 w-full resize-none rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="target-datetime-input" className="block text-xs font-medium text-slate-300">
          {copy.targetDateLabel}
        </label>

        <input
          id="target-datetime-input"
          type="datetime-local"
          value={targetLocal}
          onChange={(e) => setTargetLocal(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 font-mono text-sm text-white focus:border-red-500 focus:outline-none"
        />

        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { label: '+1 Hour', action: () => applyPresetHours(1) },
            { label: '+6 Hours', action: () => applyPresetHours(6) },
            { label: '+24 Hours', action: () => applyPresetHours(24) },
            { label: 'Tomorrow 8 PM', action: applyTomorrowEvening },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={preset.action}
              className="rounded-md border border-slate-700/80 bg-slate-800/70 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white whitespace-nowrap shrink-0"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="completion-text-input" className="block text-xs font-medium text-slate-300">
            {copy.completionLabel}
          </label>
          <input
            id="completion-text-input"
            type="text"
            maxLength={100}
            value={completionText}
            onChange={(e) => setCompletionText(e.target.value)}
            placeholder="Broadcast Starting Now"
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="youtube-watch-input" className="block text-xs font-medium text-slate-300">
            {copy.youtubeLinkLabel}
          </label>
          <input
            id="youtube-watch-input"
            type="text"
            maxLength={300}
            value={youtubeWatchUrl}
            onChange={(e) => setYoutubeWatchUrl(e.target.value)}
            placeholder="https://youtube.com/live/..."
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <span className="block text-xs font-medium text-slate-300">{copy.backdropLabel}</span>
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          {BACKDROP_THEMES.map((theme) => {
            const active = themeId === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => setThemeId(theme.id)}
                aria-pressed={active}
                className={`group flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors ${
                  active
                    ? 'border-red-500 bg-red-500/10 text-white'
                    : 'border-slate-800 bg-[#0B0F17] text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className={`h-8 w-12 shrink-0 overflow-hidden rounded border border-slate-700 ${theme.swatchClass}`}>
                  {theme.imageUrl ? (
                    <img
                      src={theme.imageUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <span className="truncate text-xs font-medium">
                  {lang === 'bn' ? theme.nameBn : theme.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Background Music Selector & Upload */}
      <div className="space-y-3 border-t border-slate-800 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <Music className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span>{copy.musicLabel}</span>
          </span>
          {musicMode !== 'none' ? (
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {musicVolume}%
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {MUSIC_PRESETS.map((preset) => {
            const active = musicMode === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                data-testid={`music-mode-${preset.id}`}
                onClick={() => {
                  if (preset.id === 'custom' && !config.customMusicName) {
                    fileInputRef.current?.click();
                  } else {
                    setMusicMode(preset.id);
                  }
                }}
                className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                  active
                    ? 'border-red-500 bg-red-500/10 text-white'
                    : 'border-slate-800 bg-[#0B0F17] text-slate-300 hover:border-slate-700'
                }`}
              >
                <span className="block truncate">
                  {lang === 'bn' ? preset.labelBn : preset.label}
                </span>
              </button>
            );
          })}
        </div>

        <input
          ref={fileInputRef}
          id="music-upload-input"
          type="file"
          tabIndex={-1}
          aria-hidden="true"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
          onChange={handleAudioFileSelected}
          className="sr-only"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2">
          <div className="min-w-0 flex-1">
            {config.customMusicName ? (
              <p
                data-testid="uploaded-music-name"
                className="truncate font-mono text-xs text-emerald-400"
                title={config.customMusicName}
              >
                {config.customMusicName}
              </p>
            ) : (
              <p className="text-xs text-slate-400">MP3, WAV, M4A, AAC, OGG (max 25 MB)</p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={uploadingAudio}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-60"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{uploadingAudio ? copy.uploadingAudio : copy.uploadAudioBtn}</span>
            </button>

            {config.customMusicName ? (
              <button
                type="button"
                disabled={uploadingAudio}
                onClick={handleRemoveCustomAudio}
                aria-label={copy.removeAudioBtn}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-red-500/50 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{copy.removeAudioBtn}</span>
              </button>
            ) : null}
          </div>
        </div>

        {musicMode !== 'none' ? (
          <div>
            <label htmlFor="music-volume-slider" className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Volume2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              <span>{copy.musicVolumeLabel}</span>
            </label>
            <input
              id="music-volume-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={musicVolume}
              onChange={(e) => setMusicVolume(Number(e.target.value))}
              className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-red-500"
            />
          </div>
        ) : null}
      </div>

      {errorMsg ? (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-xs text-red-300">
          {errorMsg}
        </p>
      ) : null}

      {savedFeedback ? (
        <p className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{copy.savedNotice}</span>
        </p>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-white disabled:opacity-60"
      >
        {saving ? copy.saving : copy.saveDetails}
      </button>
    </form>
  );
}
