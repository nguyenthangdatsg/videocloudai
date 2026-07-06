import { useState, useRef, useCallback, useEffect } from 'react';
import { Music, Mic, Play, Pause, Upload, Download, RefreshCw, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { musicApi } from '../../../lib/api';
import type { EpidemicTrack } from '../../../lib/api';
import { Spinner } from '../../../components/ui/Spinner';

const MUSIC_MOODS = [
  { value: 'dramatic',    labelKey: 'editor.moodDramatic' },
  { value: 'energetic',   labelKey: 'editor.moodEnergetic' },
  { value: 'hopeful',     labelKey: 'editor.moodHopeful' },
  { value: 'calm',        labelKey: 'editor.moodCalm' },
  { value: 'uplifting',   labelKey: 'editor.moodUplifting' },
  { value: 'sad',         labelKey: 'editor.moodSad' },
  { value: 'mysterious',  labelKey: 'editor.moodMysterious' },
  { value: 'romantic',    labelKey: 'editor.moodRomantic' },
  { value: 'dark',        labelKey: 'editor.moodDark' },
  { value: 'tense',       labelKey: 'editor.moodTense' },
  { value: 'melancholic', labelKey: 'editor.moodMelancholic' },
  { value: 'euphoric',    labelKey: 'editor.moodEuphoric' },
];

export function MusicPanel({
  bgMusicFilename, setBgMusicFilename,
  voiceVolume, setVoiceVolume,
  musicVolume, setMusicVolume,
  totalDuration,
  t,
}: {
  bgMusicFilename: string;
  setBgMusicFilename: (f: string) => void;
  voiceVolume: number;
  setVoiceVolume: (v: number) => void;
  musicVolume: number;
  setMusicVolume: (v: number) => void;
  totalDuration: number;
  t: (k: string) => string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [cachedTracks, setCachedTracks] = useState<Array<{ id: string; filename: string; sizeKB: number; duration: number }>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewTrack, setPreviewTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [searchMood, setSearchMood] = useState('dramatic');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<EpidemicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const loadTracks = useCallback(async () => {
    const tracks = await musicApi.cached();
    setCachedTracks(tracks);
  }, []);

  useEffect(() => { if (showPicker) loadTracks(); }, [showPicker, loadTracks]);
  useEffect(() => { return () => { audioRef.current?.pause(); }; }, []);

  const togglePreview = useCallback((filename: string) => {
    if (previewTrack === filename) {
      audioRef.current?.pause();
      setPreviewTrack(null);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(musicApi.streamUrl(filename));
    audio.volume = 0.5;
    audio.onended = () => setPreviewTrack(null);
    audio.play();
    audioRef.current = audio;
    setPreviewTrack(filename);
  }, [previewTrack]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await musicApi.upload(file);
      setBgMusicFilename(result.filename);
      await loadTracks();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      const tracks = await musicApi.epidemicSearch(searchMood, searchTerm || undefined, 12);
      setSearchResults(tracks);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownload = async (track: EpidemicTrack) => {
    setDownloadingId(track.id);
    try {
      const { filename } = await musicApi.epidemicDownload(track);
      setBgMusicFilename(filename);
      await loadTracks();
    } finally {
      setDownloadingId(null);
    }
  };

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  return (
    <div className="border border-c-border rounded-lg bg-c-bg p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Music className="w-4 h-4 text-pink-400" />
        <span className="text-xs font-medium text-c-text">{t('storyboard.bgMusic')}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {bgMusicFilename && (
            <button
              onClick={() => { setBgMusicFilename(''); if (previewTrack) { audioRef.current?.pause(); setPreviewTrack(null); } }}
              className="text-[10px] px-2 py-0.5 rounded border border-c-border text-c-dim hover:text-red-400 hover:border-red-800/50 transition-colors"
            >
              {t('storyboard.removeMusic')}
            </button>
          )}
          <button
            onClick={() => setShowPicker(!showPicker)}
            className={clsx(
              'text-[10px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors',
              showPicker ? 'bg-pink-900/30 border-pink-600/50 text-pink-300' : 'border-c-border text-c-dim hover:text-pink-300',
            )}
          >
            <Music className="w-3 h-3" />
            {t('storyboard.pickMusic')}
          </button>
        </div>
      </div>

      {bgMusicFilename && (() => {
        const pinnedTrack = cachedTracks.find(t => t.filename === bgMusicFilename);
        const pinnedDur = pinnedTrack?.duration ?? 0;
        return (
          <div className="px-2.5 py-1.5 bg-pink-500/10 border border-pink-500/50 rounded-lg space-y-1">
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => togglePreview(bgMusicFilename)} className="shrink-0 text-pink-400 hover:text-white transition-colors">
                {previewTrack === bgMusicFilename ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <span className="truncate text-pink-300 flex-1 text-left text-[11px]">{bgMusicFilename}</span>
              <button onClick={() => { setBgMusicFilename(''); if (previewTrack === bgMusicFilename) { audioRef.current?.pause(); setPreviewTrack(null); } }} className="shrink-0 text-c-dim hover:text-red-400 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
            {pinnedDur > 0 && totalDuration > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-c-dim">
                <Music className="w-3 h-3 shrink-0" />
                <span>{fmtDur(pinnedDur)}</span>
                <span className="text-c-border">&rarr;</span>
                <span>{fmtDur(totalDuration)}</span>
                <span className="ml-auto text-pink-400/70">
                  {pinnedDur >= totalDuration ? t('editor.musicTrimmed') : `${Math.ceil(totalDuration / pinnedDur)}× ${t('editor.musicLooped')}`}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 flex-1">
          <Mic className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-[10px] text-c-dim shrink-0">{t('storyboard.voice')}</span>
          <input type="range" min="0" max="200" step="5" value={voiceVolume * 100} onChange={(e) => setVoiceVolume(Number(e.target.value) / 100)} className="flex-1 h-1 accent-cyan-400" />
          <input type="number" min="0" max="200" step="5" value={Math.round(voiceVolume * 100)} onChange={(e) => setVoiceVolume(Math.min(200, Math.max(0, Number(e.target.value))) / 100)} className="w-14 text-[10px] text-center bg-c-surface border border-c-border rounded px-1 py-0.5" />
          <span className="text-[10px] text-c-dim">%</span>
        </div>
        <div className="flex items-center gap-2 flex-1">
          <Music className="w-3.5 h-3.5 text-pink-400 shrink-0" />
          <span className="text-[10px] text-c-dim shrink-0">{t('storyboard.musicLabel')}</span>
          <input type="range" min="0" max="100" step="5" value={musicVolume * 100} onChange={(e) => setMusicVolume(Number(e.target.value) / 100)} className="flex-1 h-1 accent-pink-400" disabled={!bgMusicFilename} />
          <input type="number" min="0" max="100" step="5" value={Math.round(musicVolume * 100)} onChange={(e) => setMusicVolume(Math.min(100, Math.max(0, Number(e.target.value))) / 100)} className="w-14 text-[10px] text-center bg-c-surface border border-c-border rounded px-1 py-0.5" disabled={!bgMusicFilename} />
          <span className="text-[10px] text-c-dim">%</span>
        </div>
      </div>

      {showPicker && (
        <div className="border-t border-c-border pt-2 space-y-2.5">
          {cachedTracks.length > 0 && (
            <div>
              <div className="text-[10px] text-c-dim mb-1">{t('editor.cachedTracks')}</div>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {cachedTracks.map((track) => {
                  const isActive = bgMusicFilename === track.filename;
                  const isPlaying = previewTrack === track.filename;
                  return (
                    <div key={track.id} className={clsx('flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg border transition-colors', isActive ? 'bg-pink-900/20 border-pink-500/50 text-pink-300' : 'border-c-border text-c-muted hover:border-pink-800/40')}>
                      <button onClick={(e) => { e.stopPropagation(); togglePreview(track.filename); }} className={clsx('shrink-0 transition-colors', isPlaying ? 'text-pink-400' : 'text-c-dim hover:text-c-text')}>
                        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      </button>
                      <button onClick={() => setBgMusicFilename(isActive ? '' : track.filename)} className="flex-1 text-left truncate">{track.filename}</button>
                      <span className="shrink-0 text-c-dim">{track.duration > 0 ? fmtDur(track.duration) : `${track.sizeKB}KB`}</span>
                      <button onClick={async (e) => { e.stopPropagation(); if (isActive) setBgMusicFilename(''); if (previewTrack === track.filename) { audioRef.current?.pause(); setPreviewTrack(null); } await musicApi.deleteTrack(track.filename); await loadTracks(); }} className="shrink-0 text-c-dim hover:text-red-400 transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {cachedTracks.length === 0 && !uploading && (
            <div className="text-[10px] text-c-dim italic py-1">{t('storyboard.noMusicCached')}</div>
          )}

          <div>
            <input type="file" ref={fileInputRef} accept=".mp3,.wav,.ogg,.m4a,.aac,.flac" onChange={handleUpload} className="hidden" />
            <label onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-2 py-1.5 border border-dashed border-c-border rounded-lg cursor-pointer hover:border-pink-500/50 transition-colors">
              {uploading ? <Spinner size="sm" /> : <Upload className="w-3.5 h-3.5 text-c-dim shrink-0" />}
              <span className="text-c-muted text-[10px]">{t('storyboard.uploadMusic')}</span>
            </label>
          </div>

          <div>
            <div className="text-[10px] text-c-dim mb-1">{t('editor.searchEpidemicSound')}</div>
            <div className="flex gap-1 mb-1">
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder={t('editor.searchPlaceholder')} className="flex-1 text-[10px] bg-c-surface border border-c-border rounded px-1.5 py-1 text-c-text placeholder:text-c-dim min-w-0" />
              <select value={searchMood} onChange={(e) => setSearchMood(e.target.value)} className="w-20 text-[10px] bg-c-surface border border-c-border rounded px-1 py-1 text-c-text">
                <option value="">{t('editor.anyMood')}</option>
                {MUSIC_MOODS.map(({ value, labelKey }) => (
                  <option key={value} value={value}>{t(labelKey)}</option>
                ))}
              </select>
              <button onClick={handleSearch} disabled={isSearching} className="px-2 py-1 bg-c-elevated border border-c-border rounded text-c-muted hover:text-c-text transition-colors">
                {isSearching ? <Spinner size="sm" /> : <RefreshCw className="w-3 h-3" />}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
                {searchResults.map((track) => {
                  const isPlaying = previewTrack === `es:${track.id}`;
                  return (
                    <div key={track.id} className="flex items-center gap-1.5 px-2 py-1 border border-c-border rounded-lg text-[10px]">
                      <button onClick={() => { const key = `es:${track.id}`; if (previewTrack === key) { audioRef.current?.pause(); setPreviewTrack(null); } else { audioRef.current?.pause(); const audio = new Audio(track.previewUrl); audio.volume = 0.5; audio.onended = () => setPreviewTrack(null); audio.play(); audioRef.current = audio; setPreviewTrack(key); } }} className={clsx('shrink-0 transition-colors', isPlaying ? 'text-pink-400' : 'text-c-dim hover:text-c-text')}>
                        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-c-text truncate">{track.title}</div>
                        <div className="text-c-dim truncate">{track.artist} · {fmtDur(track.duration)}</div>
                      </div>
                      <button onClick={() => handleDownload(track)} disabled={!!downloadingId} className="shrink-0 text-[10px] px-2 py-0.5 bg-pink-600 hover:bg-pink-500 text-white rounded transition-colors disabled:opacity-50">
                        {downloadingId === track.id ? <Spinner size="sm" /> : <Download className="w-3 h-3" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
