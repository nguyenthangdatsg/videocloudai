import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ttsApi, settingsApi } from '../lib/api';
import type { VoiceInfo } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { Spinner } from '../components/ui/Spinner';
import {
  Mic, Volume2, Download, Play, Pause, Clock, FileAudio,
  Search, SlidersHorizontal, Globe, Trash2,
} from 'lucide-react';
import { clsx } from 'clsx';

export function TextToSpeech() {
  const { t } = useTranslation();

  // --- Text ---
  const [text, setText] = useState('');

  // --- Voice selection ---
  const [selectedVoice, setSelectedVoice] = useState('en-US-GuyNeural');
  const [langFilter, setLangFilter] = useState('all');


  // --- Voice params ---
  const [rate, setRate] = useState(0);       // -100 to +100
  const [pitch, setPitch] = useState(0);     // -50 to +50 Hz
  const [volume, setVolume] = useState(0);   // -50 to +100
  const [style, setStyle] = useState('');

  // --- Selection ---
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // --- Playback ---
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Data ---
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const { data: ttsData } = useQuery({
    queryKey: ['tts', 'voices'],
    queryFn: ttsApi.voices,
  });

  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ['tts', 'history'],
    queryFn: ttsApi.history,
  });

  const voices = ttsData?.voices ?? {};
  const languages = ttsData?.languages ?? {};

  // Set default voice from settings on mount
  useEffect(() => {
    if (settingsData?.default_voice && settingsData.default_voice in voices) {
      setSelectedVoice(settingsData.default_voice);
    }
  }, [settingsData?.default_voice, voices]);

  // Current voice info
  const currentVoice: VoiceInfo | undefined = voices[selectedVoice];
  const availableStyles = currentVoice?.styles ?? [];

  // Reset style when switching to a voice without styles
  useEffect(() => {
    if (style && !availableStyles.includes(style)) {
      setStyle('');
    }
  }, [selectedVoice]);

  // --- Build unique language list with flags ---
  const langList = Object.values(voices).reduce<Record<string, string>>((acc, v) => {
    if (!acc[v.lang]) acc[v.lang] = v.flag;
    return acc;
  }, {});

  // --- Filter voices ---
  const filteredVoices = Object.entries(voices).filter(([id, info]) => {
    if (langFilter !== 'all' && info.lang !== langFilter) return false;

    return true;
  });

  // Group by language
  const groupedVoices: Record<string, [string, VoiceInfo][]> = {};
  for (const entry of filteredVoices) {
    const lang = entry[1].lang;
    if (!groupedVoices[lang]) groupedVoices[lang] = [];
    groupedVoices[lang].push(entry);
  }

  // --- Format params ---
  const fmtRate = rate >= 0 ? `+${rate}%` : `${rate}%`;
  const fmtPitch = pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`;
  const fmtVolume = volume >= 0 ? `+${volume}%` : `${volume}%`;

  // --- Audio controls ---
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (progressTimer.current) clearInterval(progressTimer.current);
    setPlayingUrl(null);
    setAudioProgress(0);
  }, []);

  const startProgressTimer = useCallback(() => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      if (audioRef.current) {
        setAudioProgress(audioRef.current.currentTime);
        setAudioDuration(audioRef.current.duration || 0);
      }
    }, 100);
  }, []);

  const playAudio = useCallback((url: string) => {
    // Same URL: toggle pause/resume
    if (playingUrl === url && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play();
        startProgressTimer();
      } else {
        audioRef.current.pause();
        if (progressTimer.current) clearInterval(progressTimer.current);
      }
      return;
    }
    stopAudio();
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play();
      setPlayingUrl(url);
      startProgressTimer();
    }
  }, [playingUrl, stopAudio, startProgressTimer]);

  const seekFromEvent = useCallback((e: MouseEvent | React.MouseEvent, bar: HTMLDivElement) => {
    if (!audioRef.current || !audioDuration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * audioDuration;
  }, [audioDuration]);

  const handleSeekStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = e.currentTarget;
    seekFromEvent(e, bar);

    const onMove = (ev: MouseEvent) => seekFromEvent(ev, bar);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [seekFromEvent]);

  // --- Preview voice ---
  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const blob = await ttsApi.preview({
        voice: selectedVoice, rate: fmtRate, pitch: fmtPitch, volume: fmtVolume,
        style: style || undefined,
      });
      const url = URL.createObjectURL(blob);
      stopAudio();
      playAudio(url);
    } finally {
      setPreviewLoading(false);
    }
  };

  // --- Generate ---
  const [generateProgress, setGenerateProgress] = useState<string[]>([]);
  const progressLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (progressLogRef.current) {
      const el = progressLogRef.current;
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }, [generateProgress]);
  const generateMutation = useMutation({
    mutationFn: () => {
      setGenerateProgress([]);
      return ttsApi.generateStream(
        { text, voice: selectedVoice, rate: fmtRate, pitch: fmtPitch, volume: fmtVolume, style: style || undefined },
        (step, detail) => setGenerateProgress((prev) => [...prev, `[${step}] ${detail ?? ''}`]),
      );
    },
    onSuccess: (data) => {
      refetchHistory();
      playAudio(data.url);
    },
  });

  // --- Delete ---
  const deleteMutation = useMutation({
    mutationFn: (filename: string) => ttsApi.delete(filename),
    onSuccess: () => refetchHistory(),
  });

  const handleDelete = (filename: string, url: string) => {
    if (!confirm(t('tts.confirmDelete'))) return;
    if (playingUrl === url) stopAudio();
    deleteMutation.mutate(filename);
  };

  // --- Selection helpers ---
  const toggleSelect = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!history) return;
    if (selected.size === history.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(history.map((f) => f.filename)));
    }
  };

  const handleBulkDelete = () => {
    if (selected.size === 0) return;
    if (!confirm(t('tts.confirmBulkDelete', { count: selected.size }))) return;
    stopAudio();
    for (const filename of selected) {
      deleteMutation.mutate(filename);
    }
    setSelected(new Set());
  };

  const handleBulkDownload = () => {
    if (!history) return;
    for (const file of history) {
      if (selected.has(file.filename)) {
        handleDownload(file.url, file.filename);
      }
    }
  };

  // --- Download ---
  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title={t('tts.title')} subtitle={t('tts.subtitle')} />

      <div className="flex-1 grid grid-cols-[1fr_320px] gap-0 min-h-0">
        {/* ═══ Left: Main area ═══ */}
        <div className="flex flex-col overflow-auto">
          <div className="p-6 space-y-5">
            {/* Text input */}
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('tts.textInput')}</label>
              <textarea
                className="input h-40 resize-y font-mono text-sm leading-relaxed"
                placeholder={t('tts.textPlaceholder')}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-c-dim">
                  {wordCount} {t('scriptEditor.words')} · {text.length} {t('tts.chars')}
                </span>
                <button onClick={() => setText('')} className="text-xs text-c-dim hover:text-c-muted">
                  {t('scriptEditor.clear')}
                </button>
              </div>
            </div>

            {/* ═══ Language & Voice select ═══ */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <label className="text-xs text-c-muted">{t('tts.selectLanguage')}</label>
                </div>
                <select
                  value={langFilter}
                  onChange={(e) => setLangFilter(e.target.value)}
                  className="input text-sm w-full"
                >
                  <option value="all">{t('tts.allLanguages')}</option>
                  {Object.entries(langList).map(([code, flag]) => (
                    <option key={code} value={code}>
                      {flag} {languages[code] ?? code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Search className="w-4 h-4 text-cyan-400" />
                  <label className="text-xs text-c-muted">{t('tts.searchVoices')}</label>
                </div>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="input text-sm w-full"
                >
                  {Object.entries(groupedVoices).map(([lang, entries]) => (
                    <optgroup key={lang} label={`${entries[0]?.[1]?.flag ?? ''} ${languages[lang] ?? lang}`}>
                      {entries.map(([id, info]) => (
                        <option key={id} value={id}>
                          {info.flag} {info.label} ({info.gender === 'male' ? '♂' : '♀'})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            {/* ═══ Voice controls ═══ */}
            <div className="border border-[#22d3ee20] rounded-xl p-4 space-y-4 bg-[#22d3ee05]">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium text-c-text">{t('tts.voiceControls')}</span>
                {currentVoice && (
                  <span className="ml-auto text-xs text-cyan-300 bg-cyan-900/20 px-2 py-0.5 rounded-full">
                    {currentVoice.flag} {currentVoice.label}
                  </span>
                )}
              </div>

              {/* Sliders grid */}
              <div className="grid grid-cols-3 gap-4">
                {/* Speed */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-c-muted">{t('tts.speed')}</label>
                    <div className="flex items-center gap-0.5">
                      <input type="number" min={-50} max={100} step={5} value={rate}
                        onChange={(e) => setRate(Math.min(100, Math.max(-50, Number(e.target.value) || 0)))}
                        className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                      <span className="text-xs text-c-dim">%</span>
                    </div>
                  </div>
                  <input type="range" min={-50} max={100} step={5} value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    className="w-full accent-cyan-500 h-1.5" />
                </div>

                {/* Pitch */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-c-muted">{t('tts.pitch')}</label>
                    <div className="flex items-center gap-0.5">
                      <input type="number" min={-50} max={50} step={5} value={pitch}
                        onChange={(e) => setPitch(Math.min(50, Math.max(-50, Number(e.target.value) || 0)))}
                        className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                      <span className="text-xs text-c-dim">Hz</span>
                    </div>
                  </div>
                  <input type="range" min={-50} max={50} step={5} value={pitch}
                    onChange={(e) => setPitch(Number(e.target.value))}
                    className="w-full accent-cyan-500 h-1.5" />
                </div>

                {/* Volume */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-c-muted">{t('tts.volume')}</label>
                    <div className="flex items-center gap-0.5">
                      <input type="number" min={-50} max={100} step={5} value={volume}
                        onChange={(e) => setVolume(Math.min(100, Math.max(-50, Number(e.target.value) || 0)))}
                        className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                      <span className="text-xs text-c-dim">%</span>
                    </div>
                  </div>
                  <input type="range" min={-50} max={100} step={5} value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-full accent-cyan-500 h-1.5" />
                </div>
              </div>

              {/* Emotion/Style (only for supported voices) */}
              {availableStyles.length > 0 && (
                <div>
                  <label className="text-xs text-c-muted mb-1.5 block">{t('tts.emotion')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setStyle('')}
                      className={clsx(
                        'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                        !style
                          ? 'bg-cyan-900/30 border-cyan-600/50 text-cyan-300'
                          : 'border-c-border text-c-muted hover:border-c-border-hi'
                      )}
                    >
                      {t('tts.neutral')}
                    </button>
                    {availableStyles.map((s) => (
                      <button
                        key={s}
                        onClick={() => setStyle(s)}
                        className={clsx(
                          'text-xs px-2.5 py-1 rounded-lg border transition-colors capitalize',
                          style === s
                            ? 'bg-amber-900/30 border-amber-600/50 text-amber-300'
                            : 'border-c-border text-c-muted hover:border-c-border-hi'
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Reset params */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setRate(0); setPitch(0); setVolume(0); setStyle(''); }}
                  className="text-xs text-c-dim hover:text-c-muted"
                >
                  {t('tts.resetParams')}
                </button>
              </div>
            </div>

            {/* ═══ Action bar ═══ */}
            <div className="flex gap-3">
              <button
                onClick={handlePreview}
                disabled={previewLoading}
                className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
              >
                {previewLoading ? <Spinner size="sm" /> : <Volume2 className="w-4 h-4" />}
                {t('tts.previewVoice')}
              </button>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={!text.trim() || generateMutation.isPending}
                className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {generateMutation.isPending ? <Spinner size="sm" /> : <Mic className="w-4 h-4" />}
                {generateMutation.isPending ? t('tts.generating') : t('tts.generate')}
              </button>
            </div>

            {/* ═══ Progress log ═══ */}
            {generateMutation.isPending && generateProgress.length > 0 && (
              <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10 space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <Spinner size="sm" />
                  <span className="text-xs font-medium text-cyan-300">{t('tts.generating')}</span>
                </div>
                <div ref={progressLogRef} className="max-h-28 overflow-y-auto font-mono text-[11px] text-c-dim space-y-0.5">
                  {generateProgress.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ Audio player (generated result) ═══ */}
            {generateMutation.data && (
              <div className="border border-green-800/30 rounded-xl p-4 bg-green-900/10 space-y-3">
                <div className="flex items-center gap-2">
                  <FileAudio className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium text-green-300">{t('tts.generated')}</span>
                  <span className="text-xs text-c-dim ml-auto">
                    {generateMutation.data.duration.toFixed(1)}s
                  </span>
                </div>

                {/* Progress bar */}
                {playingUrl === generateMutation.data.url && audioDuration > 0 && (
                  <div className="space-y-1">
                    <div
                      className="h-2 bg-c-bg rounded-full cursor-grab active:cursor-grabbing overflow-hidden select-none"
                      onMouseDown={handleSeekStart}
                    >
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-100"
                        style={{ width: `${(audioProgress / audioDuration) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-c-dim">
                      <span>{fmtTime(audioProgress)}</span>
                      <span>{fmtTime(audioDuration)}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => playAudio(generateMutation.data!.url)}
                    className="btn-secondary flex items-center gap-1.5 text-xs"
                  >
                    {playingUrl === generateMutation.data.url
                      ? <><Pause className="w-3.5 h-3.5" /> {t('tts.pause')}</>
                      : <><Play className="w-3.5 h-3.5" /> {t('tts.play')}</>}
                  </button>
                  <button
                    onClick={() => handleDownload(generateMutation.data!.url, generateMutation.data!.filename)}
                    className="btn-secondary flex items-center gap-1.5 text-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t('tts.download')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ Right sidebar: History ═══ */}
        <div className="flex flex-col border-l border-c-border overflow-hidden">
          <div className="px-4 py-4 border-b border-c-border">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-c-text">{t('tts.history')}</h2>
                <p className="text-xs text-c-muted mt-0.5">{history?.length ?? 0} {t('tts.files')}</p>
              </div>
              {history && history.length > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={history.length > 0 && selected.size === history.length}
                    onChange={toggleSelectAll}
                    className="accent-cyan-500 w-3.5 h-3.5"
                  />
                  <span className="text-xs text-c-muted">{t('tts.selectAll')}</span>
                </label>
              )}
            </div>
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="px-3 py-2 border-b border-c-border bg-cyan-900/10 flex items-center gap-2">
              <span className="text-xs text-cyan-300">{selected.size} {t('tts.selected')}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={handleBulkDownload}
                  className="text-xs text-c-muted hover:text-c-text flex items-center gap-1 px-2 py-1 rounded border border-c-border hover:border-c-border-hi transition-colors"
                >
                  <Download className="w-3 h-3" />
                  {t('tts.download')}
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="text-xs text-red-400/80 hover:text-red-400 flex items-center gap-1 px-2 py-1 rounded border border-red-800/30 hover:border-red-600/50 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  {t('tts.deleteFile')}
                </button>
              </div>
            </div>
          )}

          {!history || history.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
              <FileAudio className="w-8 h-8 text-c-dim mb-3" />
              <div className="text-xs text-c-muted">{t('tts.noHistory')}</div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-3 space-y-1.5">
              {history.map((file) => {
                const isPlaying = playingUrl === file.url;
                return (
                  <div
                    key={file.filename}
                    className={clsx(
                      'bg-c-surface border rounded-lg p-2.5 transition-colors',
                      isPlaying ? 'border-cyan-600/40' : 'border-c-border'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(file.filename)}
                        onChange={() => toggleSelect(file.filename)}
                        className="accent-cyan-500 w-3.5 h-3.5 shrink-0"
                      />
                      <button
                        onClick={() => playAudio(file.url)}
                        className={clsx(
                          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                          isPlaying
                            ? 'bg-cyan-900/40 text-cyan-300'
                            : 'bg-c-bg text-c-muted hover:text-c-text'
                        )}
                      >
                        {isPlaying
                          ? <Pause className="w-3 h-3" />
                          : <Play className="w-3 h-3" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-c-dim truncate">
                          {file.duration > 0 ? fmtTime(file.duration) : '--:--'} · {file.sizeKB} KB
                        </div>
                        <div className="text-xs text-c-dim flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {new Date(file.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleDownload(file.url, file.filename)}
                          className="text-c-dim hover:text-c-muted p-0.5"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(file.filename, file.url)}
                          className="text-c-dim hover:text-red-400 p-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Player bar when this item is playing */}
                    {isPlaying && audioDuration > 0 && (
                      <div className="mt-2 space-y-1">
                        <div
                          className="h-1.5 bg-c-bg rounded-full cursor-grab active:cursor-grabbing overflow-hidden select-none"
                          onMouseDown={handleSeekStart}
                        >
                          <div
                            className="h-full bg-cyan-500 rounded-full transition-all duration-100"
                            style={{ width: `${(audioProgress / audioDuration) * 100}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-c-dim">
                          <span>{fmtTime(audioProgress)}</span>
                          <span>{fmtTime(audioDuration)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        onEnded={stopAudio}
      />
    </div>
  );
}

function fmtTime(s: number): string {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
