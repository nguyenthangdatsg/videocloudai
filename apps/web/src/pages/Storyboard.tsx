import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { storyboardApi, imageApi, ttsApi, settingsApi, musicApi } from '../lib/api';
import type { StoryboardSegment, StoryboardPromptItem, VoiceInfo, MotionEffect, EpidemicTrack } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { Spinner } from '../components/ui/Spinner';
import {
  Film, Mic, Image, ArrowRight, ArrowUp, ArrowDown,
  X, Download, CheckCircle, Clock, FileText, Upload, Trash2,
  Wand2, GripVertical, RefreshCw, Pencil, Play, Square, FileUp, Save,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Tag, Copy, Volume2, Globe, SlidersHorizontal, ZoomIn, Shuffle, Move, Pause, SkipBack, SkipForward, Video, Music,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useImageGenStore } from '../store/image-generation';
import type { GenImage, GenMediaType } from '../store/image-generation';

type WorkflowStep = 'topics' | 'script' | 'audio' | 'prompts' | 'images' | 'timeline' | 'metadata' | 'assemble';

interface TranscriptEntry {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
  startMs: number;
  endMs: number;
}

/** Merge adjacent transcript entries into complete sentences, then split overly long ones.
 *  Step 1: Join entries until sentence-ending punctuation is found (fixes Whisper mid-sentence splits).
 *  Step 2: Split any segment longer than ~2 sentences at internal sentence boundaries,
 *          distributing time proportionally by character count. */
function mergeToSentences(entries: TranscriptEntry[]): TranscriptEntry[] {
  if (entries.length <= 1) return entries;

  // Step 1: Merge fragments into complete sentences
  const merged: TranscriptEntry[] = [];
  let acc: TranscriptEntry | null = null;
  for (const e of entries) {
    if (!acc) {
      acc = { ...e };
    } else {
      acc.text = acc.text + ' ' + e.text;
      acc.endTime = e.endTime;
      acc.endMs = e.endMs;
    }
    if (/[.!?…。！？]\s*$/.test(acc.text.trim())) {
      acc.index = merged.length + 1;
      merged.push(acc);
      acc = null;
    }
  }
  if (acc) {
    acc.index = merged.length + 1;
    merged.push(acc);
  }

  // Step 2: Split long segments at sentence boundaries
  // Target: each segment should be 1-2 sentences, max ~15s or ~150 chars
  const MAX_CHARS = 150;
  const MAX_MS = 15000;
  const result: TranscriptEntry[] = [];

  for (const seg of merged) {
    if (seg.text.length <= MAX_CHARS && (seg.endMs - seg.startMs) <= MAX_MS) {
      seg.index = result.length + 1;
      result.push(seg);
      continue;
    }
    // Split text at sentence boundaries
    const sentences = seg.text.match(/[^.!?…。！？]*[.!?…。！？]+\s*/g) || [seg.text];
    if (sentences.length <= 1) {
      seg.index = result.length + 1;
      result.push(seg);
      continue;
    }
    // Group sentences into chunks under the limit
    const totalChars = seg.text.length;
    const totalMs = seg.endMs - seg.startMs;
    let chunkText = '';
    let chunkStartMs = seg.startMs;
    let charsSoFar = 0;

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i].trim();
      if (!s) continue;
      const wouldBe = chunkText ? chunkText + ' ' + s : s;
      // Start new chunk if adding this sentence exceeds limits (unless chunk is empty)
      if (chunkText && (wouldBe.length > MAX_CHARS)) {
        const chunkEndMs = seg.startMs + Math.round((charsSoFar / totalChars) * totalMs);
        result.push({
          index: result.length + 1,
          startTime: '', endTime: '', // will be recalculated
          text: chunkText.trim(),
          startMs: chunkStartMs,
          endMs: chunkEndMs,
        });
        chunkStartMs = chunkEndMs;
        chunkText = s;
        charsSoFar += s.length;
      } else {
        chunkText = wouldBe;
        charsSoFar += s.length;
      }
    }
    // Push remaining
    if (chunkText.trim()) {
      result.push({
        index: result.length + 1,
        startTime: '', endTime: '',
        text: chunkText.trim(),
        startMs: chunkStartMs,
        endMs: seg.endMs,
      });
    }
  }

  // Recalculate startTime/endTime strings
  for (const r of result) {
    r.startTime = msToTimeStr(r.startMs);
    r.endTime = msToTimeStr(r.endMs);
  }
  return result;
}

function msToTimeStr(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = ms % 1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(rem).padStart(3,'0')}`;
}

interface StagePart { label: string; content: string }

// Color themes for prompt part blocks — cycles through these
const PART_COLORS = [
  { border: 'border-blue-700/40', bg: 'bg-blue-950/20', headerBg: 'bg-blue-950/40', label: 'text-blue-300', dim: 'text-blue-400/50', icon: 'text-blue-400/60', focusBg: 'focus:bg-blue-950/30', dot: 'bg-blue-400' },
  { border: 'border-emerald-700/40', bg: 'bg-emerald-950/20', headerBg: 'bg-emerald-950/40', label: 'text-emerald-300', dim: 'text-emerald-400/50', icon: 'text-emerald-400/60', focusBg: 'focus:bg-emerald-950/30', dot: 'bg-emerald-400' },
  { border: 'border-amber-700/40', bg: 'bg-amber-950/20', headerBg: 'bg-amber-950/40', label: 'text-amber-300', dim: 'text-amber-400/50', icon: 'text-amber-400/60', focusBg: 'focus:bg-amber-950/30', dot: 'bg-amber-400' },
  { border: 'border-rose-700/40', bg: 'bg-rose-950/20', headerBg: 'bg-rose-950/40', label: 'text-rose-300', dim: 'text-rose-400/50', icon: 'text-rose-400/60', focusBg: 'focus:bg-rose-950/30', dot: 'bg-rose-400' },
  { border: 'border-violet-700/40', bg: 'bg-violet-950/20', headerBg: 'bg-violet-950/40', label: 'text-violet-300', dim: 'text-violet-400/50', icon: 'text-violet-400/60', focusBg: 'focus:bg-violet-950/30', dot: 'bg-violet-400' },
  { border: 'border-cyan-700/40', bg: 'bg-cyan-950/20', headerBg: 'bg-cyan-950/40', label: 'text-cyan-300', dim: 'text-cyan-400/50', icon: 'text-cyan-400/60', focusBg: 'focus:bg-cyan-950/30', dot: 'bg-cyan-400' },
];

/** Collapsible editable block for a single prompt part with color coding */
function PromptPartBlock({
  part, colorIdx, defaultOpen, onEdit, onDelete, onRename,
}: {
  part: StagePart;
  colorIdx: number;
  defaultOpen?: boolean;
  onEdit: (content: string) => void;
  onDelete?: () => void;
  onRename?: (label: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(part.label);
  const c = PART_COLORS[colorIdx % PART_COLORS.length];
  const wordCount = part.content.trim() ? part.content.trim().split(/\s+/).length : 0;

  return (
    <div className={clsx('border rounded-lg overflow-hidden', c.border)}>
      <div className={clsx('px-2.5 py-1.5 flex items-center gap-2', c.headerBg)}>
        <span className={clsx('w-2 h-2 rounded-full shrink-0', c.dot)} />
        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={() => { onRename?.(labelDraft.trim() || part.label); setEditingLabel(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { onRename?.(labelDraft.trim() || part.label); setEditingLabel(false); } if (e.key === 'Escape') setEditingLabel(false); }}
            className="text-[10px] font-semibold uppercase tracking-wide bg-transparent border-b border-white/30 outline-none flex-1 text-white px-0.5"
          />
        ) : (
          <button
            onClick={() => setOpen(!open)}
            onDoubleClick={() => { if (onRename) { setLabelDraft(part.label); setEditingLabel(true); } }}
            className="flex-1 text-left flex items-center gap-2"
          >
            <span className={clsx('text-[10px] font-semibold flex-1 uppercase tracking-wide', c.label)}>
              {part.label}
            </span>
          </button>
        )}
        <span className={clsx('text-[9px] shrink-0', c.dim)}>{wordCount} w</span>
        <button
          onClick={() => setOpen(!open)}
          className="p-1 -m-1 shrink-0"
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
        >
          {open
            ? <ChevronUp className={clsx('w-3.5 h-3.5', c.icon)} />
            : <ChevronDown className={clsx('w-3.5 h-3.5', c.icon)} />
          }
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1 -m-1 shrink-0 hover:text-red-400 transition-colors"
            aria-label="Delete prompt part"
          >
            <X className={clsx('w-3.5 h-3.5', c.icon)} />
          </button>
        )}
      </div>
      {open && (
        <textarea
          value={part.content}
          onChange={(e) => onEdit(e.target.value)}
          className={clsx('text-[11px] font-mono border-t w-full min-h-[80px] max-h-[250px] resize-y p-2.5 text-c-secondary focus:outline-none', c.border, c.bg, c.focusBg)}
        />
      )}
    </div>
  );
}

/** Prompt editor shown at each step — color-coded editable parts + full combined prompt + save */
function StagePromptEditor({
  label,
  stageParts,
  value,
  onChange,
  onPartsChange,
  onSave,
  saving,
  placeholder,
  t,
}: {
  label: string;
  stageParts?: StagePart[];
  value: string;
  onChange: (v: string) => void;
  onPartsChange?: (parts: StagePart[]) => void;
  onSave?: () => void;
  saving?: boolean;
  placeholder?: string;
  t: (key: string) => string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'parts' | 'full'>('parts');

  const allParts = stageParts || [];

  const recompose = (parts: StagePart[]) => {
    const composed = parts
      .filter(p => p.content.trim())
      .map(p => `--- ${p.label} ---\n${p.content}`)
      .join('\n\n');
    onChange(composed);
  };

  const handlePartEdit = (idx: number, newContent: string) => {
    if (!onPartsChange) return;
    const updated = allParts.map((p, i) => i === idx ? { ...p, content: newContent } : p);
    onPartsChange(updated);
    recompose(updated);
  };

  const handlePartDelete = (idx: number) => {
    if (!onPartsChange) return;
    const updated = allParts.filter((_, i) => i !== idx);
    onPartsChange(updated);
    recompose(updated);
  };

  const handlePartRename = (idx: number, newLabel: string) => {
    if (!onPartsChange) return;
    const updated = allParts.map((p, i) => i === idx ? { ...p, label: newLabel } : p);
    onPartsChange(updated);
    recompose(updated);
  };

  const handleAddPart = () => {
    if (!onPartsChange) return;
    const updated = [...allParts, { label: `Custom Part ${allParts.length + 1}`, content: '' }];
    onPartsChange(updated);
  };

  const partsWithContent = allParts.filter(p => p.content.trim());

  return (
    <div className="border border-purple-800/30 rounded-xl bg-purple-900/10 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-purple-900/20 transition-colors"
        aria-expanded={!collapsed}
      >
        <Wand2 className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-[11px] font-medium text-purple-300 flex-1">
          {label}
          {allParts.length > 0 && (
            <span className="ml-2 text-[9px] text-green-400 font-normal flex-inline items-center gap-1">
              {allParts.map((_, i) => (
                <span key={i} className={clsx('inline-block w-1.5 h-1.5 rounded-full mr-0.5', PART_COLORS[i % PART_COLORS.length].dot)} />
              ))}
              <span className="ml-1">{partsWithContent.length} {t('storyboard.promptParts')}</span>
            </span>
          )}
        </span>
        {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-purple-400" /> : <ChevronUp className="w-3.5 h-3.5 text-purple-400" />}
      </button>
      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 border-t border-purple-800/20">
          {/* Tab switcher + Save */}
          <div className="flex gap-1 mt-2 items-center" role="tablist">
            <button
              onClick={() => setTab('parts')}
              role="tab"
              aria-selected={tab === 'parts'}
              className={clsx(
                'text-[10px] px-2.5 py-1 rounded-lg border transition-colors',
                tab === 'parts'
                  ? 'bg-purple-900/40 border-purple-600/50 text-purple-300 font-medium'
                  : 'border-transparent text-c-dim hover:text-purple-300',
              )}
            >
              {t('storyboard.promptPartsTab')}
            </button>
            <button
              onClick={() => setTab('full')}
              role="tab"
              aria-selected={tab === 'full'}
              className={clsx(
                'text-[10px] px-2.5 py-1 rounded-lg border transition-colors',
                tab === 'full'
                  ? 'bg-purple-900/40 border-purple-600/50 text-purple-300 font-medium'
                  : 'border-transparent text-c-dim hover:text-purple-300',
              )}
            >
              {t('storyboard.fullPrompt')}
            </button>
            {onSave && (
              <button
                onClick={onSave}
                disabled={saving}
                className="ml-auto text-[10px] px-3 py-1 rounded-lg bg-green-700/60 hover:bg-green-700/80 text-green-200 font-medium flex items-center gap-1 disabled:opacity-50 transition-colors"
              >
                <Save className="w-3 h-3" />
                {saving ? t('storyboard.saving') : t('storyboard.savePrompt')}
              </button>
            )}
          </div>

          {tab === 'parts' && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-purple-300/60 mb-1">{t('storyboard.promptPartsHint')}</div>
              {allParts.length > 0 ? (
                allParts.map((part, i) => (
                  <PromptPartBlock
                    key={`${i}-${part.label}`}
                    part={part}
                    colorIdx={i}
                    defaultOpen={i > 0 && i < allParts.length - 1}
                    onEdit={(content) => handlePartEdit(i, content)}
                    onDelete={allParts.length > 1 ? () => handlePartDelete(i) : undefined}
                    onRename={(label) => handlePartRename(i, label)}
                  />
                ))
              ) : (
                <div className="text-[11px] text-c-dim italic p-3">{t('storyboard.noPromptSection')}</div>
              )}
              {onPartsChange && (
                <button
                  onClick={handleAddPart}
                  className="w-full text-[10px] py-1.5 rounded-lg border border-dashed border-purple-700/40 text-purple-400 hover:bg-purple-900/20 hover:text-purple-300 transition-colors flex items-center justify-center gap-1"
                >
                  + {t('storyboard.addPart')}
                </button>
              )}
            </div>
          )}

          {tab === 'full' && (
            <div>
              <div className="text-[10px] text-purple-300/60 mb-1">{t('storyboard.fullPromptHint')}</div>
              <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || t('storyboard.noPromptSection')}
                rows={12}
                className="input text-[11px] w-full font-mono resize-y min-h-[150px] bg-purple-950/20 border-purple-800/30 focus:border-purple-600/50"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

function MusicPanel({
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

  // Audio preview
  const [previewTrack, setPreviewTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Epidemic Sound search
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

  // Cleanup audio on unmount
  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  const togglePreview = useCallback((filename: string) => {
    if (previewTrack === filename) {
      audioRef.current?.pause();
      setPreviewTrack(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
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

      {/* Pinned track display */}
      {bgMusicFilename && (() => {
        const pinnedTrack = cachedTracks.find(t => t.filename === bgMusicFilename);
        const pinnedDur = pinnedTrack?.duration ?? 0;
        return (
          <div className="px-2.5 py-1.5 bg-pink-500/10 border border-pink-500/50 rounded-lg space-y-1">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => togglePreview(bgMusicFilename)}
                className="shrink-0 text-pink-400 hover:text-white transition-colors"
              >
                {previewTrack === bgMusicFilename
                  ? <Pause className="w-3.5 h-3.5" />
                  : <Play className="w-3.5 h-3.5" />}
              </button>
              <span className="truncate text-pink-300 flex-1 text-left text-[11px]">
                {bgMusicFilename}
              </span>
              <button
                onClick={() => { setBgMusicFilename(''); if (previewTrack === bgMusicFilename) { audioRef.current?.pause(); setPreviewTrack(null); } }}
                className="shrink-0 text-c-dim hover:text-red-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {pinnedDur > 0 && totalDuration > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-c-dim">
                <Music className="w-3 h-3 shrink-0" />
                <span>{fmtDur(pinnedDur)}</span>
                <span className="text-c-border">→</span>
                <span>{fmtDur(totalDuration)}</span>
                <span className="ml-auto text-pink-400/70">
                  {pinnedDur >= totalDuration ? t('editor.musicTrimmed') : `${Math.ceil(totalDuration / pinnedDur)}× ${t('editor.musicLooped')}`}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Volume controls — always visible */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 flex-1">
          <Mic className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-[10px] text-c-dim shrink-0">{t('storyboard.voice')}</span>
          <input
            type="range" min="0" max="200" step="5"
            value={voiceVolume * 100}
            onChange={(e) => setVoiceVolume(Number(e.target.value) / 100)}
            className="flex-1 h-1 accent-cyan-400"
          />
          <input
            type="number" min="0" max="200" step="5"
            value={Math.round(voiceVolume * 100)}
            onChange={(e) => setVoiceVolume(Math.min(200, Math.max(0, Number(e.target.value))) / 100)}
            className="w-14 text-[10px] text-center bg-c-surface border border-c-border rounded px-1 py-0.5"
          />
          <span className="text-[10px] text-c-dim">%</span>
        </div>
        <div className="flex items-center gap-2 flex-1">
          <Music className="w-3.5 h-3.5 text-pink-400 shrink-0" />
          <span className="text-[10px] text-c-dim shrink-0">{t('storyboard.musicLabel')}</span>
          <input
            type="range" min="0" max="100" step="5"
            value={musicVolume * 100}
            onChange={(e) => setMusicVolume(Number(e.target.value) / 100)}
            className="flex-1 h-1 accent-pink-400"
            disabled={!bgMusicFilename}
          />
          <input
            type="number" min="0" max="100" step="5"
            value={Math.round(musicVolume * 100)}
            onChange={(e) => setMusicVolume(Math.min(100, Math.max(0, Number(e.target.value))) / 100)}
            className="w-14 text-[10px] text-center bg-c-surface border border-c-border rounded px-1 py-0.5"
            disabled={!bgMusicFilename}
          />
          <span className="text-[10px] text-c-dim">%</span>
        </div>
      </div>

      {/* Music picker */}
      {showPicker && (
        <div className="border-t border-c-border pt-2 space-y-2.5">
          {/* Cached tracks */}
          {cachedTracks.length > 0 && (
            <div>
              <div className="text-[10px] text-c-dim mb-1">{t('editor.cachedTracks')}</div>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {cachedTracks.map((track) => {
                  const isActive = bgMusicFilename === track.filename;
                  const isPlaying = previewTrack === track.filename;
                  return (
                    <div
                      key={track.id}
                      className={clsx(
                        'flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg border transition-colors',
                        isActive
                          ? 'bg-pink-900/20 border-pink-500/50 text-pink-300'
                          : 'border-c-border text-c-muted hover:border-pink-800/40'
                      )}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePreview(track.filename); }}
                        className={clsx(
                          'shrink-0 transition-colors',
                          isPlaying ? 'text-pink-400' : 'text-c-dim hover:text-c-text'
                        )}
                      >
                        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={() => setBgMusicFilename(isActive ? '' : track.filename)}
                        className="flex-1 text-left truncate"
                      >
                        {track.filename}
                      </button>
                      <span className="shrink-0 text-c-dim">
                        {track.duration > 0 ? fmtDur(track.duration) : `${track.sizeKB}KB`}
                      </span>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (isActive) setBgMusicFilename('');
                          if (previewTrack === track.filename) { audioRef.current?.pause(); setPreviewTrack(null); }
                          await musicApi.deleteTrack(track.filename);
                          await loadTracks();
                        }}
                        className="shrink-0 text-c-dim hover:text-red-400 transition-colors"
                      >
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

          {/* Upload local music */}
          <div>
            <input type="file" ref={fileInputRef} accept=".mp3,.wav,.ogg,.m4a,.aac,.flac" onChange={handleUpload} className="hidden" />
            <label
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-2 py-1.5 border border-dashed border-c-border rounded-lg cursor-pointer hover:border-pink-500/50 transition-colors"
            >
              {uploading ? <Spinner size="sm" /> : <Upload className="w-3.5 h-3.5 text-c-dim shrink-0" />}
              <span className="text-c-muted text-[10px]">{t('storyboard.uploadMusic')}</span>
            </label>
          </div>

          {/* Epidemic Sound search */}
          <div>
            <div className="text-[10px] text-c-dim mb-1">{t('editor.searchEpidemicSound')}</div>
            <div className="flex gap-1 mb-1">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={t('editor.searchPlaceholder')}
                className="flex-1 text-[10px] bg-c-surface border border-c-border rounded px-1.5 py-1 text-c-text placeholder:text-c-dim min-w-0"
              />
              <select
                value={searchMood}
                onChange={(e) => setSearchMood(e.target.value)}
                className="w-20 text-[10px] bg-c-surface border border-c-border rounded px-1 py-1 text-c-text"
              >
                <option value="">{t('editor.anyMood')}</option>
                {MUSIC_MOODS.map(({ value, labelKey }) => (
                  <option key={value} value={value}>{t(labelKey)}</option>
                ))}
              </select>
              <button
                onClick={handleSearch}
                disabled={isSearching}
                className="px-2 py-1 bg-c-elevated border border-c-border rounded text-c-muted hover:text-c-text transition-colors"
              >
                {isSearching ? <Spinner size="sm" /> : <RefreshCw className="w-3 h-3" />}
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
                {searchResults.map((track) => {
                  const isPlaying = previewTrack === `es:${track.id}`;
                  return (
                    <div
                      key={track.id}
                      className="flex items-center gap-1.5 px-2 py-1 border border-c-border rounded-lg text-[10px]"
                    >
                      <button
                        onClick={() => {
                          const key = `es:${track.id}`;
                          if (previewTrack === key) {
                            audioRef.current?.pause();
                            setPreviewTrack(null);
                          } else {
                            audioRef.current?.pause();
                            const audio = new Audio(track.previewUrl);
                            audio.volume = 0.5;
                            audio.onended = () => setPreviewTrack(null);
                            audio.play();
                            audioRef.current = audio;
                            setPreviewTrack(key);
                          }
                        }}
                        className={clsx(
                          'shrink-0 transition-colors',
                          isPlaying ? 'text-pink-400' : 'text-c-dim hover:text-c-text'
                        )}
                      >
                        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-c-text truncate">{track.title}</div>
                        <div className="text-c-dim truncate">{track.artist} · {fmtDur(track.duration)}</div>
                      </div>
                      <button
                        onClick={() => handleDownload(track)}
                        disabled={!!downloadingId}
                        className="shrink-0 text-[10px] px-2 py-0.5 bg-pink-600 hover:bg-pink-500 text-white rounded transition-colors disabled:opacity-50"
                      >
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

export function Storyboard() {
  const { t } = useTranslation();
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState('');
  const [projectLoaded, setProjectLoaded] = useState(false);

  const [step, setStep] = useState<WorkflowStep>('topics');

  // Template
  const [templateText, setTemplateText] = useState('');
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [templateSections, setTemplateSections] = useState<Record<string, string>>({});
  const [templateStageParts, setTemplateStageParts] = useState<Record<string, StagePart[]>>({});
  const [showTemplate, setShowTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const templateFileRef = useRef<HTMLInputElement>(null);

  // Per-step editable prompts (extracted from template, editable by user)
  const [topicsPrompt, setTopicsPrompt] = useState('');
  const [scriptPrompt, setScriptPrompt] = useState('');
  const [imagePromptPrompt, setImagePromptPrompt] = useState('');
  const [metadataPrompt, setMetadataPrompt] = useState('');
  const [savingPrompt, setSavingPrompt] = useState<string | null>(null);

  // Step 0: Topics
  const [topicIdeas, setTopicIdeas] = useState<string[]>([]);
  const [generatingTopics, setGeneratingTopics] = useState(false);

  // Step 1: Script
  const [scriptText, setScriptText] = useState('');
  const [scriptTopic, setScriptTopic] = useState('');
  const [scriptDuration, setScriptDuration] = useState(600);
  const [generatingScript, setGeneratingScript] = useState(false);

  // Step 2: Audio + Transcribe — full TTS options
  const [voice, setVoice] = useState('en-US-GuyNeural');
  const [langFilter, setLangFilter] = useState('all');
  const [ttsRate, setTtsRate] = useState(0);
  const [ttsPitch, setTtsPitch] = useState(0);
  const [ttsVolume, setTtsVolume] = useState(0);
  const [ttsStyle, setTtsStyle] = useState('');
  const [voicePreviewLoading, setVoicePreviewLoading] = useState(false);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);
  const [voicePreviewPlaying, setVoicePreviewPlaying] = useState(false);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState<string[]>([]);
  const [audioFile, setAudioFile] = useState<{ filename: string; url: string; duration: number } | null>(null);
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);

  // Step 3: Image prompts
  const [prompts, setPrompts] = useState<StoryboardPromptItem[]>([]);
  const [generatingPrompts, setGeneratingPrompts] = useState(false);
  const [promptProgress, setPromptProgress] = useState<string[]>([]);
  const [editingPromptIdx, setEditingPromptIdx] = useState<number | null>(null);

  // Step 4: Image generation (global store — survives navigation)
  const imageGenStore = useImageGenStore();
  const bgTask = useImageGenStore((s) => projectId ? s.tasks.get(projectId) : undefined);
  const [generatedImages, setGeneratedImages] = useState<GenImage[]>([]);
  const generatingImages = bgTask?.running ?? false;
  const imageProgress = bgTask?.progress ?? [];
  const [provider, setProvider] = useState('auto');
  const [imageModel, setImageModel] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [uploadingZip, setUploadingZip] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const imageCardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [imageTab, setImageTab] = useState<'generate' | 'upload' | 'flow'>('generate');
  const [flowAvailable, setFlowAvailable] = useState(false);
  const [flowProvider, setFlowProvider] = useState<'google-flow' | 'grok' | 'chatgpt'>('google-flow');
  const [mediaType, setMediaType] = useState<GenMediaType>('image');
  const [videoDuration, setVideoDuration] = useState(5); // seconds per clip

  // Fetch available image providers (with models)
  const { data: imageProviders } = useQuery({
    queryKey: ['image', 'providers'],
    queryFn: imageApi.providers,
    staleTime: 60_000,
  });
  const selectedProviderInfo = imageProviders?.find((p) => p.id === provider);

  // Step 5: Timeline
  const [segments, setSegments] = useState<StoryboardSegment[]>([]);
  const [timeFormat, setTimeFormat] = useState<'seconds' | 'minutes'>('seconds');
  const [trackZoom, setTrackZoom] = useState(150); // px per second
  const [trackHeight, setTrackHeight] = useState(224); // track height in px
  const [frameHoldTime, setFrameHoldTime] = useState(0); // extra seconds to hold frame after voice ends
  const [frameTransition, setFrameTransition] = useState<'voice' | 'hold'>('voice'); // 'voice' = change on voice end, 'hold' = add hold time
  const trackDragRef = useRef<{ startX: number; scrollLeft: number; raf: number | null } | null>(null);
  const [trackGrabbing, setTrackGrabbing] = useState(false);
  const manualScrolling = useRef(false); // suppress auto-scroll during manual drag

  // Background music
  const [bgMusicFilename, setBgMusicFilename] = useState<string>('');
  const [voiceVolume, setVoiceVolume] = useState(1.0);
  const [musicVolume, setMusicVolume] = useState(0.3);

  // Step 6: Metadata
  const [generatingMetadata, setGeneratingMetadata] = useState(false);
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataDesc, setMetadataDesc] = useState('');
  const [metadataTags, setMetadataTags] = useState<string[]>([]);

  // Step 7: Assemble
  const [assembling, setAssembling] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [assembleProgress, setAssembleProgress] = useState<string[]>([]);
  const audioLogRef = useRef<HTMLDivElement>(null);
  const promptLogRef = useRef<HTMLDivElement>(null);
  const assembleLogRef = useRef<HTMLDivElement>(null);
  const [assembleStep, setAssembleStep] = useState<string>('');
  const [assembleClipProgress, setAssembleClipProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [result, setResult] = useState<{ filename: string; url: string; sizeKB: number; duration: number } | null>(null);
  // Auto-scroll progress logs to latest message
  useEffect(() => { if (audioLogRef.current) audioLogRef.current.scrollTop = audioLogRef.current.scrollHeight; }, [audioProgress]);
  useEffect(() => { if (promptLogRef.current) promptLogRef.current.scrollTop = promptLogRef.current.scrollHeight; }, [promptProgress]);
  useEffect(() => { if (assembleLogRef.current) assembleLogRef.current.scrollTop = assembleLogRef.current.scrollHeight; }, [assembleProgress]);

  const allEffects: MotionEffect[] = ['static', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'];
  const [randomEffects, setRandomEffects] = useState<Set<MotionEffect>>(new Set(['zoom-in', 'zoom-out', 'pan-left', 'pan-right']));
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [playingSegment, setPlayingSegment] = useState<number | null>(null);
  const [playheadTime, setPlayheadTime] = useState<number | null>(null); // current playback time in seconds
  const segAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgMusicAudioRef = useRef<HTMLAudioElement | null>(null);
  const segAudioTimerRef = useRef<number | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // Drag & drop reorder — only swaps images between slots (preserves text/timing)
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragAllowed = useRef(false);
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    if (!dragAllowed.current) { e.preventDefault(); return; }
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };
  const handleDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    dragAllowed.current = false;
    if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    setSegments(prev => {
      const copy = [...prev];
      const fromImg = copy[dragIdx].imageFilename;
      const fromUrl = copy[dragIdx].imageUrl;
      copy[dragIdx] = { ...copy[dragIdx], imageFilename: copy[toIdx].imageFilename, imageUrl: copy[toIdx].imageUrl };
      copy[toIdx] = { ...copy[toIdx], imageFilename: fromImg, imageUrl: fromUrl };
      return copy;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // Auto-merge: when segment time extends past neighbor, absorb it
  const updateSegmentTimeAutoMerge = (idx: number, field: 'startTime' | 'endTime', value: number) => {
    setSegments(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };

      // Merge forward: if endTime >= next segment's endTime, absorb next
      while (field === 'endTime' && idx < copy.length - 1 && value >= copy[idx + 1].endTime) {
        copy[idx] = { ...copy[idx], endTime: copy[idx + 1].endTime, text: [copy[idx].text, copy[idx + 1].text].filter(Boolean).join(' ') };
        copy.splice(idx + 1, 1);
      }
      // Merge backward: if startTime <= prev segment's startTime, absorb prev
      while (field === 'startTime' && idx > 0 && value <= copy[idx - 1].startTime) {
        copy[idx] = { ...copy[idx], startTime: copy[idx - 1].startTime, text: [copy[idx - 1].text, copy[idx].text].filter(Boolean).join(' ') };
        copy.splice(idx - 1, 1);
        idx--;
      }
      return copy;
    });
  };

  // Drag edge on overview track to adjust boundary between segments
  const trackEdgeRef = useRef<{ idx: number; startX: number; origTime: number; pxPerSec: number; raf: number | null } | null>(null);
  const handleTrackEdgeDrag = (e: React.MouseEvent, boundaryIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const segs = segmentsRef.current;
    if (boundaryIdx < 0 || boundaryIdx >= segs.length - 1) return;
    const scrollEl = timelineTrackRef.current;
    if (!scrollEl) return;
    const totalDur = segs[segs.length - 1]?.endTime || 1;
    const trackInnerW = scrollEl.scrollWidth;
    const pxPerSec = trackInnerW / totalDur;
    const origTime = segs[boundaryIdx].endTime;
    trackEdgeRef.current = { idx: boundaryIdx, startX: e.clientX, origTime, pxPerSec, raf: null };

    let pendingTime: number | null = null;

    const applyUpdate = () => {
      if (trackEdgeRef.current) trackEdgeRef.current.raf = null;
      if (pendingTime === null) return;
      const t = pendingTime;
      pendingTime = null;
      setSegments(prev => {
        const copy = [...prev];
        const idx = trackEdgeRef.current?.idx ?? boundaryIdx;
        if (idx < 0 || idx >= copy.length - 1) return prev;
        copy[idx] = { ...copy[idx], endTime: t };
        copy[idx + 1] = { ...copy[idx + 1], startTime: t };
        return copy;
      });
    };

    const onMove = (me: MouseEvent) => {
      if (!trackEdgeRef.current) return;
      const { startX, origTime: ot, pxPerSec: pps, idx } = trackEdgeRef.current;
      const dx = me.clientX - startX;
      const dtSec = dx / pps;
      const curSegs = segmentsRef.current;
      const minDur = 0.3;
      const minBound = curSegs[idx].startTime + minDur;
      const maxBound = curSegs[idx + 1].endTime - minDur;
      // Fine precision: round to 0.01s for smooth dragging
      pendingTime = Math.round(Math.max(minBound, Math.min(maxBound, ot + dtSec)) * 100) / 100;
      if (!trackEdgeRef.current.raf) {
        trackEdgeRef.current.raf = requestAnimationFrame(applyUpdate);
      }
    };
    const onUp = () => {
      if (trackEdgeRef.current?.raf) cancelAnimationFrame(trackEdgeRef.current.raf);
      // Snap to 0.1s on release for clean values
      if (pendingTime !== null) {
        pendingTime = Math.round(pendingTime * 10) / 10;
        applyUpdate();
      }
      setSegments(prev => prev.map(s => ({
        ...s,
        startTime: Math.round(s.startTime * 10) / 10,
        endTime: Math.round(s.endTime * 10) / 10,
      })));
      trackEdgeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Drag-to-resize on card duration bar
  const cardResizeRef = useRef<{ idx: number; startX: number; origEnd: number; origStart: number; maxEnd: number; barWidth: number } | null>(null);
  const handleCardResizeStart = (e: React.MouseEvent, idx: number, barEl: HTMLDivElement) => {
    e.preventDefault();
    const seg = segments[idx];
    const maxEnd = idx < segments.length - 1 ? segments[segments.length - 1].endTime : seg.endTime + 10;
    const barRect = barEl.getBoundingClientRect();
    cardResizeRef.current = { idx, startX: e.clientX, origEnd: seg.endTime, origStart: seg.startTime, maxEnd, barWidth: barRect.width };
    const onMove = (me: MouseEvent) => {
      if (!cardResizeRef.current) return;
      const { startX, origEnd, origStart, maxEnd: mEnd, barWidth } = cardResizeRef.current;
      const dx = me.clientX - startX;
      const totalRange = mEnd - origStart;
      const dtSec = (dx / barWidth) * totalRange;
      const minDur = 0.3;
      const newEnd = Math.round(Math.max(origStart + minDur, Math.min(mEnd, origEnd + dtSec)) * 10) / 10;
      updateSegmentTimeAutoMerge(cardResizeRef.current.idx, 'endTime', newEnd);
    };
    const onUp = () => {
      cardResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const [isAudioPaused, setIsAudioPaused] = useState(false);

  // Helper: start/sync background music alongside voice
  const syncBgMusic = useCallback((time: number, play: boolean) => {
    if (!bgMusicFilename) {
      if (bgMusicAudioRef.current) { bgMusicAudioRef.current.pause(); bgMusicAudioRef.current = null; }
      return;
    }
    if (!bgMusicAudioRef.current) {
      bgMusicAudioRef.current = new Audio();
      bgMusicAudioRef.current.loop = true;
    }
    const bgAudio = bgMusicAudioRef.current;
    const streamUrl = musicApi.streamUrl(bgMusicFilename);
    if (!bgAudio.src.includes(encodeURIComponent(bgMusicFilename))) {
      bgAudio.src = streamUrl;
    }
    bgAudio.volume = musicVolume;
    // Modulo loop position if duration is known
    if (bgAudio.duration && isFinite(bgAudio.duration)) {
      bgAudio.currentTime = time % bgAudio.duration;
    } else {
      bgAudio.currentTime = 0;
    }
    if (play) bgAudio.play().catch(() => {});
    else bgAudio.pause();
  }, [bgMusicFilename, musicVolume]);

  // Keep bg music volume in sync with slider
  useEffect(() => {
    if (bgMusicAudioRef.current) bgMusicAudioRef.current.volume = musicVolume;
  }, [musicVolume]);

  // Keep voice volume in sync with slider
  useEffect(() => {
    if (segAudioRef.current) segAudioRef.current.volume = voiceVolume;
  }, [voiceVolume]);

  // Start the polling interval for playhead sync
  const startPlaybackPoll = useCallback(() => {
    if (segAudioTimerRef.current) clearInterval(segAudioTimerRef.current);
    const audio = segAudioRef.current;
    if (!audio) return;
    segAudioTimerRef.current = window.setInterval(() => {
      const segs = segmentsRef.current;
      const endTime = segs[segs.length - 1]?.endTime || 0;
      if (audio.currentTime >= endTime) {
        audio.pause();
        bgMusicAudioRef.current?.pause();
        if (segAudioTimerRef.current) clearInterval(segAudioTimerRef.current);
        segAudioTimerRef.current = null;
        setPlayingSegment(null);
        setPlayheadTime(null);
        setIsAudioPaused(false);
      } else {
        const ct = audio.currentTime;
        setPlayheadTime(ct);
        const activeIdx = segs.findIndex((s, si) =>
          ct >= s.startTime && (si === segs.length - 1 ? ct <= s.endTime : ct < s.endTime)
        );
        if (activeIdx >= 0) setPlayingSegment(activeIdx);
        // Scroll track so current time aligns with center (red line)
        if (!manualScrolling.current) {
          const scrollEl = timelineTrackRef.current;
          if (scrollEl) {
            const playheadX = (ct / endTime) * scrollEl.scrollWidth;
            scrollEl.scrollLeft = playheadX - scrollEl.clientWidth / 2;
          }
        }
      }
    }, 50);
  }, []);

  const playSegmentAudio = useCallback((idx: number) => {
    if (!audioFile) return;
    const seg = segments[idx];
    if (!seg) return;

    // Stop current
    if (segAudioTimerRef.current) { clearInterval(segAudioTimerRef.current); segAudioTimerRef.current = null; }

    // Toggle off if same segment playing
    if (playingSegment === idx && !isAudioPaused) {
      segAudioRef.current?.pause();
      syncBgMusic(0, false);
      setPlayingSegment(null);
      setPlayheadTime(null);
      setIsAudioPaused(false);
      return;
    }

    if (!segAudioRef.current) {
      segAudioRef.current = new Audio();
    }
    const audio = segAudioRef.current;
    audio.src = audioFile.url;
    audio.volume = voiceVolume;
    audio.currentTime = seg.startTime;
    audio.play();
    syncBgMusic(seg.startTime, true);
    setPlayingSegment(idx);
    setPlayheadTime(seg.startTime);
    setIsAudioPaused(false);
    startPlaybackPoll();
  }, [audioFile, segments, playingSegment, isAudioPaused, startPlaybackPoll, syncBgMusic, voiceVolume]);

  const pauseAudio = useCallback(() => {
    if (!segAudioRef.current) return;
    segAudioRef.current.pause();
    bgMusicAudioRef.current?.pause();
    if (segAudioTimerRef.current) { clearInterval(segAudioTimerRef.current); segAudioTimerRef.current = null; }
    setIsAudioPaused(true);
  }, []);

  const resumeAudio = useCallback(() => {
    const audio = segAudioRef.current;
    if (!audio || !audioFile) return;
    audio.play();
    bgMusicAudioRef.current?.play().catch(() => {});
    setIsAudioPaused(false);
    startPlaybackPoll();
  }, [audioFile, startPlaybackPoll]);

  const stopAudio = useCallback(() => {
    if (segAudioTimerRef.current) { clearInterval(segAudioTimerRef.current); segAudioTimerRef.current = null; }
    segAudioRef.current?.pause();
    bgMusicAudioRef.current?.pause();
    setPlayingSegment(null);
    setPlayheadTime(null);
    setIsAudioPaused(false);
  }, []);

  // Skip to prev/next segment
  const skipSegment = useCallback((dir: -1 | 1) => {
    if (!audioFile || segments.length === 0) return;
    const current = playingSegment ?? 0;
    const next = Math.max(0, Math.min(segments.length - 1, current + dir));
    playSegmentAudio(next);
  }, [audioFile, segments, playingSegment, playSegmentAudio]);

  // Seek to a time position (for scrubber click)
  const seekToTime = useCallback((time: number) => {
    if (!audioFile) return;
    if (!segAudioRef.current) {
      segAudioRef.current = new Audio();
    }
    const audio = segAudioRef.current;
    audio.src = audioFile.url;
    audio.volume = voiceVolume;
    audio.currentTime = time;
    setPlayheadTime(time);

    const segs = segmentsRef.current;
    const activeIdx = segs.findIndex((s, si) =>
      time >= s.startTime && (si === segs.length - 1 ? time <= s.endTime : time < s.endTime)
    );
    if (activeIdx >= 0) setPlayingSegment(activeIdx);

    audio.play();
    syncBgMusic(time, true);
    setIsAudioPaused(false);
    startPlaybackPoll();
  }, [audioFile, startPlaybackPoll, syncBgMusic, voiceVolume]);

  // Check if Google Flow extension bridge is available
  useEffect(() => {
    const onPong = () => setFlowAvailable(true);
    window.addEventListener('Han2YT_flow_pong', onPong);
    window.dispatchEvent(new CustomEvent('Han2YT_flow_ping'));
    const timer = setTimeout(() => window.dispatchEvent(new CustomEvent('Han2YT_flow_ping')), 1500);
    return () => {
      window.removeEventListener('Han2YT_flow_pong', onPong);
      clearTimeout(timer);
    };
  }, []);

  // Cleanup segment audio on unmount
  useEffect(() => {
    return () => {
      if (segAudioTimerRef.current) clearInterval(segAudioTimerRef.current);
      segAudioRef.current?.pause();
      bgMusicAudioRef.current?.pause();
      bgMusicAudioRef.current = null;
      setPlayheadTime(null);
    };
  }, []);

  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleSaveStagePrompt = async (stage: string, prompt: string) => {
    setSavingPrompt(stage);
    try {
      if (projectTemplateId) {
        await storyboardApi.saveTemplatePrompt(projectTemplateId, stage, prompt);
      } else {
        await storyboardApi.savePrompt(stage, prompt);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingPrompt(null);
    }
  };

  // Voices query
  const { data: voices } = useQuery({
    queryKey: ['tts', 'voices'],
    queryFn: ttsApi.voices,
  });

  // Settings query — apply voice defaults once
  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  const [settingsApplied, setSettingsApplied] = useState(false);
  useEffect(() => {
    if (!appSettings || settingsApplied || projectLoaded) return;
    if (appSettings.default_voice) setVoice(appSettings.default_voice);
    if (appSettings.default_tts_rate) setTtsRate(Number(appSettings.default_tts_rate) || 0);
    if (appSettings.default_tts_pitch) setTtsPitch(Number(appSettings.default_tts_pitch) || 0);
    if (appSettings.default_tts_volume) setTtsVolume(Number(appSettings.default_tts_volume) || 0);
    if (appSettings.default_tts_style) setTtsStyle(appSettings.default_tts_style);
    setSettingsApplied(true);
  }, [appSettings, settingsApplied, projectLoaded]);

  // Track which template this project uses
  const [projectTemplateId, setProjectTemplateId] = useState<string | null>(null);

  // Load template: prefer project's linked template, fall back to global
  const { data: linkedTemplate } = useQuery({
    queryKey: ['storyboard', 'templates', projectTemplateId],
    queryFn: () => storyboardApi.getTemplateById(projectTemplateId!),
    enabled: !!projectTemplateId,
    staleTime: 0, // always refetch to pick up template edits
  });

  // Shared: apply parsed sections + stageParts to state
  const applySections = useCallback((sections: Record<string, string>, stageParts?: Record<string, StagePart[]>) => {
    setTemplateSections(sections);
    setTemplateStageParts(stageParts || {});
    setTemplateLoaded(true);
    if (sections.topicsSystemPrompt) setTopicsPrompt(sections.topicsSystemPrompt);
    if (sections.scriptSystemPrompt) setScriptPrompt(sections.scriptSystemPrompt);
    if (sections.imagePromptSystemPrompt) setImagePromptPrompt(sections.imagePromptSystemPrompt);
    if (sections.metadataSystemPrompt) setMetadataPrompt(sections.metadataSystemPrompt);
  }, []);

  // Apply linked template — prompts are owned by the template (niche), not the project.
  // stagePrompts is the pre-computed single source of truth for generation.
  // Always applies when linkedTemplate arrives (overrides any global template that loaded first).
  const [linkedTemplateApplied, setLinkedTemplateApplied] = useState(false);
  useEffect(() => {
    if (!linkedTemplate || linkedTemplateApplied) return;
    const sp = linkedTemplate.stagePrompts;
    const hasContent = linkedTemplate.templateText || sp?.topics || sp?.script || sp?.prompts || sp?.metadata;
    if (!hasContent) return; // wait for backend to populate fallback prompts on next refetch
    if (linkedTemplate.templateText) {
      setTemplateText(linkedTemplate.templateText);
      setTemplateSections(linkedTemplate.sections);
      setTemplateStageParts(linkedTemplate.stageParts || {});
    }
    setTemplateLoaded(true);
    setLinkedTemplateApplied(true);
    setTopicsPrompt(sp?.topics || linkedTemplate.sections.topicsSystemPrompt || '');
    setScriptPrompt(sp?.script || linkedTemplate.sections.scriptSystemPrompt || '');
    setImagePromptPrompt(sp?.prompts || linkedTemplate.sections.imagePromptSystemPrompt || '');
    setMetadataPrompt(sp?.metadata || linkedTemplate.sections.metadataSystemPrompt || '');
  }, [linkedTemplate, linkedTemplateApplied]);

  // Fallback: apply global template if linked template is empty or absent
  // Only apply after project has loaded so we know whether a template is linked
  const linkedTemplateEmpty = linkedTemplate && !linkedTemplate.templateText
    && !linkedTemplate.stagePrompts?.topics && !linkedTemplate.stagePrompts?.script
    && !linkedTemplate.stagePrompts?.prompts && !linkedTemplate.stagePrompts?.metadata;
  const { data: savedTemplate } = useQuery({
    queryKey: ['storyboard', 'template'],
    queryFn: storyboardApi.getTemplate,
    enabled: !projectTemplateId || !!linkedTemplateEmpty,
  });
  useEffect(() => {
    if (projectLoaded && (!projectTemplateId || linkedTemplateEmpty) && savedTemplate?.template && !templateLoaded) {
      setTemplateText(savedTemplate.template);
      applySections(savedTemplate.sections, savedTemplate.stageParts);
    }
  }, [savedTemplate, projectTemplateId, projectLoaded, templateLoaded, applySections, linkedTemplateEmpty]);

  // ── Load project from DB on mount ──
  useEffect(() => {
    if (!projectId || projectLoaded) return;
    (async () => {
      try {
        const p = await storyboardApi.getProject(projectId);
        setProjectName(p.name);
        if (p.templateId) setProjectTemplateId(p.templateId);
        setStep(p.currentStep as WorkflowStep);
        if (p.topic) setScriptTopic(p.topic);
        if (p.script) setScriptText(p.script);
        if (p.scriptDuration) setScriptDuration(p.scriptDuration);
        if (p.voice) setVoice(p.voice);
        if (p.audioFilename) setAudioFile({ filename: p.audioFilename, url: `/api/tts/audio/${p.audioFilename}`, duration: p.audioDuration || 0 });
        if (p.transcriptEntries?.length) setTranscriptEntries(p.transcriptEntries);
        if (p.prompts?.length) setPrompts(p.prompts);
        if (p.generatedImages?.length) setGeneratedImages(p.generatedImages.map((img) => ({ ...img, status: (img.status as 'done' | 'pending' | 'generating' | 'error') })));
        if (p.segments?.length) setSegments(p.segments.map((s) => ({ ...s, motion: s.motion || 'static' })));
        if (p.metadataTitle) setMetadataTitle(p.metadataTitle);
        if (p.metadataDesc) setMetadataDesc(p.metadataDesc);
        if (p.metadataTags?.length) setMetadataTags(p.metadataTags);
        if (p.resultFilename) setResult({ filename: p.resultFilename, url: p.resultUrl || '', sizeKB: p.resultSizeKB || 0, duration: p.audioDuration || 0 });
        if (p.bgMusicFilename) setBgMusicFilename(p.bgMusicFilename);
        if (p.voiceVolume != null) setVoiceVolume(p.voiceVolume);
        if (p.musicVolume != null) setMusicVolume(p.musicVolume);
        // Load project-level prompts as initial values.
        // If a linked template has prompts, they will override these when applied.
        if (p.topicsPrompt) setTopicsPrompt(p.topicsPrompt);
        if (p.scriptPrompt) setScriptPrompt(p.scriptPrompt);
        if (p.imagePromptPrompt) setImagePromptPrompt(p.imagePromptPrompt);
        if (p.metadataPrompt) setMetadataPrompt(p.metadataPrompt);
        if (p.stageParts && Object.keys(p.stageParts).length) setTemplateStageParts(p.stageParts);
      } catch {
        navigate('/storyboard');
      } finally {
        setProjectLoaded(true);
      }
    })();
  }, [projectId, projectLoaded, navigate]);

  // ── Sync background image generation task into local state ──
  useEffect(() => {
    if (!bgTask) return;
    setGeneratedImages(bgTask.images);
    if (!bgTask.running && bgTask.images.some((i) => i.status === 'done')) {
      setStep('images');
    }
    // Auto-scroll to the currently generating image
    if (bgTask.running) {
      const genIdx = bgTask.images.findIndex((i) => i.status === 'generating');
      if (genIdx >= 0) {
        imageCardRefs.current[genIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [bgTask]);

  // ── Auto-save project state after step transitions ──
  const saveProject = useCallback(async (updates: Record<string, unknown>) => {
    if (!projectId) return;
    try {
      await storyboardApi.updateProject(projectId, updates as never);
    } catch { /* silent — best effort */ }
  }, [projectId]);

  // Save template to backend + reload parsed sections
  const saveAndApplyTemplate = async (text: string) => {
    setSavingTemplate(true);
    try {
      if (projectTemplateId) {
        // Save to linked template
        await storyboardApi.updateTemplate(projectTemplateId, { templateText: text.trim() } as never);
        const loaded = await storyboardApi.getTemplateById(projectTemplateId);
        setTemplateText(loaded.templateText);
        applySections(loaded.sections, loaded.stageParts);
        // Apply pre-computed stagePrompts (these include custom_prompts overrides)
        const sp = loaded.stagePrompts;
        if (sp?.topics) setTopicsPrompt(sp.topics);
        if (sp?.script) setScriptPrompt(sp.script);
        if (sp?.prompts) setImagePromptPrompt(sp.prompts);
        if (sp?.metadata) setMetadataPrompt(sp.metadata);
      } else {
        // Save to global template
        await storyboardApi.saveTemplate(text.trim());
        const loaded = await storyboardApi.getTemplate();
        setTemplateText(loaded.template);
        applySections(loaded.sections, loaded.stageParts);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSaveTemplate = () => {
    if (!templateText.trim()) return;
    saveAndApplyTemplate(templateText);
  };

  const handleTemplateFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setTemplateText(text);
      setShowTemplate(true);
      // Auto-save on file load so sections are parsed immediately
      saveAndApplyTemplate(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  // ── Step 0: Generate Topics ──
  const handleGenerateTopics = async () => {
    setGeneratingTopics(true);
    setError(null);
    try {
      const topics = await storyboardApi.generateTopics(5, topicsPrompt.trim() || undefined, projectTemplateId, topicIdeas);
      setTopicIdeas(prev => [...prev, ...topics]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingTopics(false);
    }
  };

  const handlePickTopic = (topic: string) => {
    setScriptTopic(topic);
    setStep('script');
    saveProject({ topic, currentStep: 'script' });
  };

  // ── Step 1: Generate Script ──
  const handleGenerateScript = async () => {
    if (!scriptTopic.trim()) return;
    setGeneratingScript(true);
    setError(null);
    try {
      const script = await storyboardApi.generateScript({
        topic: scriptTopic.trim(),
        duration: scriptDuration,
        systemPrompt: scriptPrompt.trim() || undefined,
      });
      setScriptText(script);
      saveProject({ script, scriptDuration });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingScript(false);
    }
  };

  // ── Step 2: Generate TTS + Transcribe ──
  const fmtRate = ttsRate >= 0 ? `+${ttsRate}%` : `${ttsRate}%`;
  const fmtPitch = ttsPitch >= 0 ? `+${ttsPitch}Hz` : `${ttsPitch}Hz`;
  const fmtVolume = ttsVolume >= 0 ? `+${ttsVolume}%` : `${ttsVolume}%`;

  const handleVoicePreview = async () => {
    // Stop if already playing
    if (voicePreviewPlaying && voicePreviewRef.current) {
      voicePreviewRef.current.pause();
      voicePreviewRef.current = null;
      setVoicePreviewPlaying(false);
      return;
    }
    setVoicePreviewLoading(true);
    try {
      const blob = await ttsApi.preview({
        voice,
        rate: fmtRate,
        pitch: fmtPitch,
        volume: fmtVolume,
        style: ttsStyle || undefined,
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      voicePreviewRef.current = audio;
      audio.onended = () => { setVoicePreviewPlaying(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setVoicePreviewPlaying(false); URL.revokeObjectURL(url); };
      await audio.play();
      setVoicePreviewPlaying(true);
    } catch (err) {
      console.error('Voice preview failed:', err);
    } finally {
      setVoicePreviewLoading(false);
    }
  };

  const handleGenerateAudio = async () => {
    if (!scriptText.trim()) return;
    setGeneratingAudio(true);
    setAudioProgress([]);
    setError(null);
    try {
      const { audio, entries } = await storyboardApi.generateTts(
        {
          text: scriptText.trim(),
          voice,
          rate: fmtRate,
          pitch: fmtPitch,
          volume: fmtVolume,
          style: ttsStyle || undefined,
        },
        (_step, detail) => { if (detail) setAudioProgress((p) => [...p, detail]); },
      );
      setAudioFile(audio);
      const mergedEntries = mergeToSentences(entries);
      setTranscriptEntries(mergedEntries);
      setStep('audio');
      saveProject({ voice, audioFilename: audio.filename, audioDuration: audio.duration, transcriptEntries: mergedEntries, currentStep: 'audio' });

      // Auto-sync existing timeline segments to new audio timestamps
      if (segments.length > 0 && entries.length > 0) {
        const doneImages = generatedImages.filter((img) => img.status === 'done' && img.filename && img.url);
        if (doneImages.length > 0) {
          try {
            const matched = await storyboardApi.match({
              segments: entries.map((e) => ({ startMs: e.startMs, endMs: e.endMs, text: e.text })),
              images: doneImages.map((img) => ({ filename: img.filename, url: img.url, timestamp: img.timestamp })),
            });
            // Preserve motion effects from old segments
            const synced = matched.map((seg, i) => ({
              ...seg,
              motion: segments[i]?.motion || seg.motion,
            }));
            setSegments(synced);
            saveProject({ segments: synced });
          } catch { /* silent — user can rebuild manually */ }
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingAudio(false);
    }
  };

  // ── Step 3: Generate Image Prompts ──
  const handleGeneratePrompts = async () => {
    if (!transcriptEntries.length) return;
    setGeneratingPrompts(true);
    setPromptProgress([]);
    setError(null);

    const segs = transcriptEntries.map((e) => {
      const ms = e.startMs;
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return {
        timestamp: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
        text: e.text,
      };
    });

    try {
      const result = await storyboardApi.generatePrompts(
        { segments: segs, styleTemplate: imagePromptPrompt.trim() || undefined, visualStyle: linkedTemplate?.visualStyle || undefined, aspectRatio },
        (_step, detail) => { if (detail) setPromptProgress((p) => [...p, detail]); },
      );
      setPrompts(result);
      setStep('prompts');
      saveProject({ prompts: result, currentStep: 'prompts' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingPrompts(false);
    }
  };

  // ── Step 4: Batch Generate Images ──
  const handleGenerateImages = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    imageGenStore.startGeneration(
      projectId,
      prompts.map((p) => ({ timestamp: p.timestamp, prompt: p.prompt })),
      aspectRatio,
      provider,
      imageModel || undefined,
    );
  };

  const handleGenerateVideos = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    imageGenStore.startFlowGeneration(
      projectId,
      prompts.map((p) => ({ timestamp: p.timestamp, prompt: p.prompt })),
      'video',
      undefined,
      flowProvider,
    );
  };

  const handleStopImages = () => {
    if (projectId) imageGenStore.stopGeneration(projectId);
  };

  const handleUploadZip = async (file: File) => {
    if (!file || !projectId) return;
    setUploadingZip(true);
    setError(null);
    try {
      const { images, count } = await imageApi.uploadZip(file);
      // Map extracted images to prompts by index order
      const mapped: GenImage[] = images.map((img, i) => ({
        timestamp: prompts[i]?.timestamp || `${String(i + 1).padStart(3, '0')}`,
        filename: img.filename,
        url: img.url,
        status: 'done' as const,
      }));
      setGeneratedImages(mapped);
      saveProject({ generatedImages: mapped, currentStep: 'images' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingZip(false);
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  };

  // ── Step 4b: Generate via Extension (Google Flow / Grok / ChatGPT) ──
  // Smart generate: if images already exist, only generate missing/failed ones (resume behavior)
  const handleFlowGenerate = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    // If we already have images, skip the done ones
    if (generatedImages.length > 0 && generatedImages.some((i) => i.status === 'done')) {
      const pendingPrompts = prompts
        .filter((_, i) => {
          const img = generatedImages[i];
          return !img || img.status !== 'done';
        })
        .map((p) => ({ timestamp: p.timestamp, prompt: p.prompt }));
      if (!pendingPrompts.length) return; // all done
      imageGenStore.startFlowGeneration(projectId, pendingPrompts, 'image', generatedImages, flowProvider);
    } else {
      imageGenStore.startFlowGeneration(
        projectId,
        prompts.map((p) => ({ timestamp: p.timestamp, prompt: p.prompt })),
        'image',
        undefined,
        flowProvider,
      );
    }
  };

  // Regenerate ALL images from scratch (clears existing, sends all prompts)
  const handleFlowRegenerateAll = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    // Clear prompt cache for these prompts
    const promptTexts = prompts.map(p => p.prompt).filter(Boolean);
    if (promptTexts.length) imageApi.clearPromptCache(promptTexts);
    imageGenStore.startFlowGeneration(
      projectId,
      prompts.map((p) => ({ timestamp: p.timestamp, prompt: p.prompt })),
      'image',
      undefined,
      flowProvider,
    );
  };

  // ── Step 4b-resume: Resume failed/pending images via Extension ──
  const failedImageCount = generatedImages.filter((i) => i.status === 'error' || i.status === 'pending').length;
  const scrollToFirstPending = () => {
    const idx = generatedImages.findIndex((i) => i.status === 'error' || i.status === 'pending');
    if (idx >= 0) {
      requestAnimationFrame(() => {
        imageCardRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  };
  const handleFlowResume = () => {
    if (!prompts.length || !projectId) return;
    setError(null);
    const failedPrompts = prompts
      .filter((_, i) => {
        const img = generatedImages[i];
        return !img || img.status === 'error' || img.status === 'pending';
      })
      .map((p) => ({ timestamp: p.timestamp, prompt: p.prompt }));
    if (!failedPrompts.length) return;
    imageGenStore.startFlowGeneration(projectId, failedPrompts, 'image', generatedImages, flowProvider);
    scrollToFirstPending();
  };

  // ── Step 4c: Regenerate single image via Google Flow ──
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [editingImageIdx, setEditingImageIdx] = useState<number | null>(null);
  const [editingImagePrompt, setEditingImagePrompt] = useState('');

  const handleRegenSingle = (idx: number, overrideProvider?: 'google-flow' | 'grok' | 'chatgpt') => {
    if (!projectId || !prompts[idx]) return;
    const useProvider = overrideProvider ?? flowProvider;
    // If previous regen is stuck, force reset
    if (regenIndex !== null) {
      setGeneratedImages((prev) =>
        prev.map((img, i) => i === regenIndex && img.status === 'generating' ? { ...img, status: 'error' as const } : img),
      );
    }
    setRegenIndex(idx);

    // Mark as generating
    setGeneratedImages((prev) =>
      prev.map((img, i) => i === idx ? { ...img, status: 'generating' as const } : img),
    );

    const onProgress = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.index !== 0) return;
    };
    const onImage = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.index !== 0) return;
      if (d.status === 'done') {
        setGeneratedImages((prev) => {
          const updated = prev.map((img, i) => i === idx ? { ...img, filename: d.filename, url: d.url, status: 'done' as const } : img);
          saveProject({ generatedImages: updated });
          return updated;
        });
      } else {
        setGeneratedImages((prev) =>
          prev.map((img, i) => i === idx ? { ...img, status: 'error' as const } : img),
        );
      }
    };
    const cleanup = () => {
      window.removeEventListener('Han2YT_flow_progress', onProgress);
      window.removeEventListener('Han2YT_flow_image', onImage);
      window.removeEventListener('Han2YT_flow_done', onDone);
      window.removeEventListener('Han2YT_flow_error', onError);
      setRegenIndex(null);
    };
    const onDone = () => {
      cleanup();
    };
    const onError = () => {
      setGeneratedImages((prev) =>
        prev.map((img, i) => i === idx ? { ...img, status: 'error' as const } : img),
      );
      cleanup();
    };

    window.addEventListener('Han2YT_flow_progress', onProgress);
    window.addEventListener('Han2YT_flow_image', onImage);
    window.addEventListener('Han2YT_flow_done', onDone);
    window.addEventListener('Han2YT_flow_error', onError);

    window.dispatchEvent(new CustomEvent('Han2YT_flow_start', {
      detail: {
        prompts: [{ timestamp: prompts[idx].timestamp, prompt: prompts[idx].prompt }],
        delayMin: 0,
        delayMax: 0,
        mediaType,
        provider: useProvider,
      },
    }));
  };

  const handleDropImage = (idx: number) => {
    setGeneratedImages((prev) => {
      const updated = prev.map((img, i) =>
        i === idx ? { ...img, filename: '', url: '', status: 'pending' as const } : img,
      );
      saveProject({ generatedImages: updated });
      return updated;
    });
  };

  const handleStartEditPrompt = (idx: number) => {
    setEditingImageIdx(idx);
    setEditingImagePrompt(prompts[idx]?.prompt || '');
  };

  const handleSaveEditedPrompt = (idx: number) => {
    if (editingImageIdx !== idx) return;
    const updated = prompts.map((p, i) =>
      i === idx ? { ...p, prompt: editingImagePrompt } : p,
    );
    setPrompts(updated);
    saveProject({ prompts: updated });
    setEditingImageIdx(null);
  };

  // ── Step 5: Auto-match to timeline ──
  const handleBuildTimeline = async () => {
    const doneImages = generatedImages.filter((img) => img.status === 'done' && img.filename && img.url);
    if (!doneImages.length) return;
    setError(null);

    try {
      // If images match prompts count (expanded), build segments from prompts timestamps
      // so we get 1 segment per image instead of losing images to fewer transcript entries
      let segSource: Array<{ startMs: number; endMs: number; text: string }>;

      if (doneImages.length > transcriptEntries.length && prompts.length >= doneImages.length) {
        // Use prompts as segment source — parse timestamps into ms
        const audioDurationMs = (audioFile?.duration || 0) * 1000;
        segSource = prompts.map((p, i) => {
          const parts = p.timestamp.split(':').map(Number);
          const startMs = parts.length === 3 ? (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
            : (parts[0] * 60 + parts[1]) * 1000;
          // End = next prompt's start, or audio end
          const nextP = prompts[i + 1];
          let endMs: number;
          if (nextP) {
            const np = nextP.timestamp.split(':').map(Number);
            endMs = np.length === 3 ? (np[0] * 3600 + np[1] * 60 + np[2]) * 1000
              : (np[0] * 60 + np[1]) * 1000;
          } else {
            endMs = audioDurationMs || startMs + 5000;
          }
          return { startMs, endMs: Math.max(endMs, startMs + 500), text: p.text };
        });
      } else if (transcriptEntries.length > 0) {
        segSource = transcriptEntries.map((e) => ({ startMs: e.startMs, endMs: e.endMs, text: e.text }));
      } else {
        // No transcript — evenly distribute images over audio duration
        const totalMs = (audioFile?.duration || doneImages.length * 5) * 1000;
        const step = totalMs / doneImages.length;
        segSource = doneImages.map((_, i) => ({
          startMs: Math.round(i * step),
          endMs: Math.round((i + 1) * step),
          text: prompts[i]?.text || '',
        }));
      }

      if (frameTransition === 'voice') {
        // Frame changes exactly when next voice starts — extend each segment to fill gaps
        segSource = segSource.map((seg, i, arr) => {
          const nextStart = arr[i + 1]?.startMs;
          return { ...seg, endMs: nextStart != null ? nextStart : seg.endMs };
        });
      } else if (frameTransition === 'hold' && frameHoldTime > 0) {
        // Keep frame visible for extra time after voice ends
        const holdMs = frameHoldTime * 1000;
        segSource = segSource.map((seg, i, arr) => {
          const voiceEnd = seg.endMs;
          const nextStart = arr[i + 1]?.startMs;
          const maxEnd = nextStart != null ? nextStart : voiceEnd + holdMs;
          return { ...seg, endMs: Math.min(voiceEnd + holdMs, maxEnd) };
        });
      }

      const matched = await storyboardApi.match({
        segments: segSource,
        images: doneImages.map((img) => {
          const isVideo = img.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(img.filename || '');
          return {
            filename: img.filename, url: img.url, timestamp: img.timestamp,
            mediaType: isVideo ? 'video' as const : img.mediaType,
            videoFilename: isVideo ? img.filename : undefined,
            videoUrl: isVideo ? img.url : undefined,
          };
        }),
      });
      setSegments(matched);
      setStep('timeline');
      saveProject({ segments: matched, currentStep: 'timeline' });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // ── Time format helpers ──
  const fmtTime = (sec: number): string => {
    if (timeFormat === 'seconds') return sec.toFixed(1);
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return `${m}:${s.padStart(4, '0')}`;
  };
  const parseTimeInput = (val: string): number => {
    if (timeFormat === 'seconds') return parseFloat(val) || 0;
    // Parse m:ss.s format
    const parts = val.split(':');
    if (parts.length === 2) return (parseFloat(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
    return parseFloat(val) || 0;
  };

  // ── Segment adjustment ──
  const moveSegment = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= segments.length) return;
    setSegments((prev) => {
      const copy = [...prev];
      const tmpImg = copy[idx].imageFilename;
      const tmpUrl = copy[idx].imageUrl;
      copy[idx] = { ...copy[idx], imageFilename: copy[next].imageFilename, imageUrl: copy[next].imageUrl };
      copy[next] = { ...copy[next], imageFilename: tmpImg, imageUrl: tmpUrl };
      return copy;
    });
  };

  const updateSegmentTime = (idx: number, field: 'startTime' | 'endTime', value: number) => {
    setSegments((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const updateSegmentMotion = (idx: number, motion: MotionEffect) => {
    setSegments((prev) => {
      const updated = prev.map((s, i) => i === idx ? { ...s, motion } : s);
      saveProject({ segments: updated });
      return updated;
    });
  };

  const setAllMotion = (motion: MotionEffect) => {
    setSegments((prev) => {
      const updated = prev.map((s) => ({ ...s, motion }));
      saveProject({ segments: updated });
      return updated;
    });
  };

  const toggleRandomEffect = (effect: MotionEffect) => {
    setRandomEffects((prev) => {
      const next = new Set(prev);
      if (next.has(effect)) next.delete(effect); else next.add(effect);
      return next;
    });
  };

  const randomizeMotion = () => {
    const pool = Array.from(randomEffects);
    if (!pool.length) return;
    setSegments((prev) => {
      const updated = prev.map((s) => ({ ...s, motion: pool[Math.floor(Math.random() * pool.length)] }));
      saveProject({ segments: updated });
      return updated;
    });
  };

  // ── Step 6: Generate Metadata ──
  const handleGenerateMetadata = async () => {
    if (!scriptText.trim()) return;
    setGeneratingMetadata(true);
    setError(null);
    try {
      const meta = await storyboardApi.generateMetadata({
        script: scriptText.trim(),
        topic: scriptTopic.trim() || undefined,
        systemPrompt: metadataPrompt.trim() || undefined,
      });
      setMetadataTitle(meta.title);
      setMetadataDesc(meta.description);
      setMetadataTags(meta.tags);
      saveProject({ metadataTitle: meta.title, metadataDesc: meta.description, metadataTags: meta.tags, currentStep: 'metadata' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingMetadata(false);
    }
  };

  // ── Step 7: Assemble ──
  const handleAssemble = async () => {
    if (!segments.length || !audioFile) return;
    setAssembling(true);
    setAssembleProgress([]);
    setAssembleStep('');
    setAssembleClipProgress({ current: 0, total: 0 });
    setResult(null);
    setError(null);

    try {
      const res = await storyboardApi.assemble(
        { segments, audioFilename: audioFile.filename, aspectRatio, bgMusicFilename: bgMusicFilename || undefined, voiceVolume, musicVolume, outputName: scriptTopic.trim() || projectName.trim() || undefined },
        (step, detail) => {
          if (step) setAssembleStep(step);
          if (detail) {
            setAssembleProgress((p) => [...p, detail]);
            // Parse "Encoding clip X/Y" to track progress
            const clipMatch = detail.match(/clip (\d+)\/(\d+)/i);
            if (clipMatch) setAssembleClipProgress({ current: parseInt(clipMatch[1]), total: parseInt(clipMatch[2]) });
          }
        },
      );
      setResult(res);
      setStep('assemble');
      saveProject({ resultFilename: res.filename, resultUrl: res.url, resultSizeKB: res.sizeKB, currentStep: 'assemble', status: 'completed' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAssembling(false);
    }
  };

  // ── Step navigation ──
  const allSteps: Array<{ key: WorkflowStep; label: string; icon: React.ElementType; done: boolean }> = [
    { key: 'topics', label: t('storyboard.stepTopics'), icon: Wand2, done: !!scriptTopic.trim() },
    { key: 'script', label: t('storyboard.stepScript'), icon: FileText, done: !!scriptText.trim() },
    { key: 'audio', label: t('storyboard.stepAudio'), icon: Mic, done: !!audioFile },
    { key: 'prompts', label: t('storyboard.stepPrompts'), icon: Wand2, done: prompts.length > 0 },
    { key: 'images', label: t('storyboard.stepImages'), icon: Image, done: generatedImages.some((i) => i.status === 'done') },
    { key: 'timeline', label: t('storyboard.stepTimeline'), icon: Clock, done: segments.length > 0 },
    { key: 'metadata', label: t('storyboard.stepMetadata'), icon: Tag, done: !!metadataTitle },
    { key: 'assemble', label: t('storyboard.stepAssemble'), icon: Film, done: !!result },
  ];
  const stepOrder: WorkflowStep[] = allSteps.map((s) => s.key);
  const currentIdx = stepOrder.indexOf(step);

  const doneImageCount = generatedImages.filter((i) => i.status === 'done').length;
  const errorImageCount = generatedImages.filter((i) => i.status === 'error').length;
  const pendingImageCount = generatedImages.filter((i) => i.status === 'pending').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title={projectName || t('storyboard.title')} subtitle={t('storyboard.subtitle')} />

      {/* Project name & niche badge */}
      {projectId && (
        <div className="border-b border-c-border bg-c-surface/50 px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center gap-2.5">
            <Film className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-sm font-medium text-c-text truncate">{projectName || t('storyboard.untitled')}</span>
            {linkedTemplate && (
              <>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full border shrink-0"
                  style={{
                    borderColor: `${linkedTemplate.color || '#6366f1'}50`,
                    backgroundColor: `${linkedTemplate.color || '#6366f1'}15`,
                    color: linkedTemplate.color || '#6366f1',
                  }}
                >
                  {linkedTemplate.niche || linkedTemplate.name}
                </span>
                {linkedTemplate.visualStyle && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-400 shrink-0">
                    {linkedTemplate.visualStyle}
                  </span>
                )}
              </>
            )}
            {scriptTopic && (
              <>
                <span className="text-c-dim text-xs">·</span>
                <span className="text-xs text-c-muted truncate max-w-md" title={scriptTopic}>{scriptTopic}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Step indicator */}
      <nav className="border-b border-c-border bg-c-surface px-4 py-2.5 overflow-x-auto" aria-label="Workflow steps">
        <div className="max-w-7xl mx-auto flex items-center gap-1">
          {allSteps.map((s, i) => {
            const isAccessible = i <= currentIdx || s.done;
            return (
              <div key={s.key} className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => isAccessible ? setStep(s.key) : undefined}
                  aria-current={step === s.key ? 'step' : undefined}
                  disabled={!isAccessible}
                  className={clsx(
                    'flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full transition-colors whitespace-nowrap',
                    step === s.key
                      ? 'bg-cyan-900/40 text-cyan-300 font-medium'
                      : s.done
                        ? 'text-green-400 cursor-pointer hover:bg-green-900/20'
                        : 'text-c-dim cursor-default disabled:opacity-50',
                  )}
                >
                  {s.done && step !== s.key ? <CheckCircle className="w-3.5 h-3.5" /> : <s.icon className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < allSteps.length - 1 && <ArrowRight className="w-2.5 h-2.5 text-c-dim shrink-0" />}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-5">

          {/* TEMPLATE */}
          <div className="border border-c-border rounded-xl bg-c-surface overflow-hidden">
            <button
              onClick={() => setShowTemplate(!showTemplate)}
              className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-c-elevated/50 transition-colors"
              aria-expanded={showTemplate}
            >
              <FileUp className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-medium text-c-text flex-1">
                {t('storyboard.template')}
                {templateLoaded && (
                  <span className="ml-2 text-[10px] text-green-400 font-normal">
                    ({Object.keys(templateSections).filter((k) => !k.endsWith('SystemPrompt')).length} {t('storyboard.sectionsLoaded')})
                  </span>
                )}
              </span>
              {showTemplate ? <ChevronUp className="w-3.5 h-3.5 text-c-dim" /> : <ChevronDown className="w-3.5 h-3.5 text-c-dim" />}
            </button>

            {showTemplate && (
              <div className="px-4 pb-4 space-y-3 border-t border-c-border">
                <div className="text-[11px] text-c-dim mt-3">{t('storyboard.templateHint')}</div>

                <div className="flex gap-2">
                  <button
                    onClick={() => templateFileRef.current?.click()}
                    className="btn-secondary text-xs flex items-center gap-1.5"
                  >
                    <Upload className="w-3 h-3" /> {t('storyboard.loadFile')}
                  </button>
                  <input ref={templateFileRef} type="file" accept=".txt,.md,.text" onChange={handleTemplateFile} className="hidden" />
                  <span className="flex-1" />
                  <button
                    onClick={handleSaveTemplate}
                    disabled={!templateText.trim() || savingTemplate}
                    className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {savingTemplate ? <Spinner size="sm" /> : <Save className="w-3 h-3" />}
                    {t('storyboard.saveTemplate')}
                  </button>
                </div>

                <textarea
                  value={templateText}
                  onChange={(e) => setTemplateText(e.target.value)}
                  placeholder={t('storyboard.templatePlaceholder')}
                  rows={12}
                  className="input text-[11px] w-full font-mono resize-y min-h-[150px]"
                />

                {Object.keys(templateSections).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.keys(templateSections).filter((k) => !k.endsWith('SystemPrompt')).map((key) => (
                      <span key={key} className="text-[9px] bg-cyan-900/30 text-cyan-300/80 px-2 py-0.5 rounded-full">
                        {key}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* STEP 0: TOPICS */}
          {step === 'topics' && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-cyan-400" />
                {t('storyboard.stepTopics')}
              </h3>

              {!templateLoaded && (
                <div className="border border-yellow-800/30 rounded-xl p-3 bg-yellow-900/10 text-xs text-yellow-300">
                  {t('storyboard.loadTemplateFirst')}
                </div>
              )}

              {/* Stage prompt editor */}
              <StagePromptEditor
                label={`Stage 1: ${t('storyboard.stepTopics')} — ${t('storyboard.stagePrompt')}`}
                stageParts={templateStageParts.topics}
                value={topicsPrompt}
                onChange={setTopicsPrompt}
                onPartsChange={(parts) => setTemplateStageParts(p => ({ ...p, topics: parts }))}
                onSave={() => handleSaveStagePrompt('topics', topicsPrompt)}
                saving={savingPrompt === 'topics'}
                t={t}
              />

              <div className="flex gap-2">
                <button
                  onClick={handleGenerateTopics}
                  disabled={!templateLoaded || generatingTopics}
                  className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {generatingTopics ? <Spinner size="sm" /> : <Wand2 className="w-3.5 h-3.5" />}
                  {t('storyboard.generateTopics')}
                </button>
                <span className="text-xs text-c-dim self-center">{t('common.or')}</span>
                <input
                  type="text"
                  value={scriptTopic}
                  onChange={(e) => setScriptTopic(e.target.value)}
                  placeholder={t('storyboard.topicPlaceholder')}
                  className="input text-sm flex-1"
                  onKeyDown={(e) => { if (e.key === 'Enter' && scriptTopic.trim()) handlePickTopic(scriptTopic.trim()); }}
                />
                <button
                  onClick={() => handlePickTopic(scriptTopic.trim())}
                  disabled={!scriptTopic.trim()}
                  className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50"
                >
                  {t('storyboard.useTopic')} <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              {topicIdeas.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-c-muted">{t('storyboard.pickTopic')}</div>
                  {topicIdeas.map((topic, i) => (
                    <button
                      key={i}
                      onClick={() => handlePickTopic(topic)}
                      className="w-full text-left flex items-center gap-3 p-3 rounded-xl border border-c-border bg-c-surface hover:border-cyan-700/50 transition-colors"
                    >
                      <span className="text-sm font-medium text-cyan-400 shrink-0 w-6">{i + 1}</span>
                      <span className="text-sm text-c-text flex-1">{topic}</span>
                      <ArrowRight className="w-4 h-4 text-c-dim shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 1: SCRIPT */}
          {step === 'script' && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" />
                {t('storyboard.stepScript')}
              </h3>

              {/* Stage prompt editor */}
              <StagePromptEditor
                label={`Stage 2: ${t('storyboard.stepScript')} — ${t('storyboard.stagePrompt')}`}
                stageParts={templateStageParts.script}
                value={scriptPrompt}
                onChange={setScriptPrompt}
                onPartsChange={(parts) => setTemplateStageParts(p => ({ ...p, script: parts }))}
                onSave={() => handleSaveStagePrompt('script', scriptPrompt)}
                saving={savingPrompt === 'script'}
                t={t}
              />

              {/* Selected topic + generate */}
              <div className="border border-c-border rounded-xl p-4 bg-c-surface space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-[10px] text-c-dim mb-0.5">{t('storyboard.selectedTopic')}</div>
                    <div className="text-sm font-medium text-c-text">{scriptTopic || '—'}</div>
                  </div>
                  <button onClick={() => setStep('topics')} className="text-[10px] text-cyan-400 hover:underline shrink-0">{t('storyboard.changeTopic')}</button>
                </div>
                <div className="flex items-center gap-3">
                  <div>
                    <label className="text-[10px] text-c-muted mb-0.5 block">{t('storyboard.videoDuration')}</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={scriptDuration}
                        onChange={(e) => setScriptDuration(Number(e.target.value))}
                        className="input text-sm w-20"
                        min={30}
                        max={1800}
                      />
                      <span className="text-xs text-c-dim">sec</span>
                      {scriptDuration > 120 && (
                        <span className="text-[10px] text-amber-400/80 ml-1">
                          {Math.ceil(scriptDuration / 90)} {t('storyboard.scriptChunks')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="self-end">
                    <button
                      onClick={handleGenerateScript}
                      disabled={!scriptTopic.trim() || generatingScript}
                      className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {generatingScript ? <Spinner size="sm" /> : <Wand2 className="w-3.5 h-3.5" />}
                      {generatingScript && scriptDuration > 120
                        ? t('storyboard.generatingChunked')
                        : t('storyboard.generateScript')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Script text editor */}
              <div>
                <label className="text-xs text-c-muted mb-1.5 block">{t('storyboard.scriptLabel')}</label>
                <textarea
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder={t('storyboard.scriptPlaceholder')}
                  rows={16}
                  className="input text-sm w-full resize-y min-h-[200px] font-mono"
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-c-dim">{scriptText.split(/\s+/).filter(Boolean).length} {t('storyboard.words')}</span>
                  <button
                    onClick={() => { setStep('audio'); saveProject({ script: scriptText, scriptDuration, currentStep: 'audio' }); }}
                    disabled={!scriptText.trim()}
                    className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
                  >
                    {t('common.next')} <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: AUDIO + TRANSCRIBE */}
          {step === 'audio' && (() => {
            const allVoices = voices?.voices ?? {};
            const allLanguages = voices?.languages ?? {};
            const currentVoice: VoiceInfo | undefined = allVoices[voice];
            const availableStyles = currentVoice?.styles ?? [];

            // Build language list
            const langList = Object.values(allVoices).reduce<Record<string, string>>((acc, v) => {
              if (!acc[v.lang]) acc[v.lang] = v.flag;
              return acc;
            }, {});

            // Filter & group voices
            const filtered = Object.entries(allVoices).filter(([, info]) =>
              langFilter === 'all' || info.lang === langFilter,
            );
            const grouped: Record<string, [string, VoiceInfo][]> = {};
            for (const entry of filtered) {
              const lang = entry[1].lang;
              if (!grouped[lang]) grouped[lang] = [];
              grouped[lang].push(entry);
            }

            return (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
                <Mic className="w-4 h-4 text-cyan-400" />
                {t('storyboard.stepAudio')} — {t('storyboard.ttsSubtitle')}
              </h3>

              {/* Language & Voice select */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
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
                        {flag} {allLanguages[code] ?? code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Mic className="w-3.5 h-3.5 text-cyan-400" />
                    <label className="text-xs text-c-muted">{t('tts.searchVoices')}</label>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={voice}
                      onChange={(e) => { setVoice(e.target.value); setTtsStyle(''); if (voicePreviewRef.current) { voicePreviewRef.current.pause(); voicePreviewRef.current = null; setVoicePreviewPlaying(false); } }}
                      className="input text-sm flex-1"
                    >
                      {Object.entries(grouped).map(([lang, entries]) => (
                        <optgroup key={lang} label={`${entries[0]?.[1]?.flag ?? ''} ${allLanguages[lang] ?? lang}`}>
                          {entries.map(([id, info]) => (
                            <option key={id} value={id}>
                              {info.flag} {info.label} ({info.gender === 'male' ? '\u2642' : '\u2640'})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button
                      onClick={handleVoicePreview}
                      disabled={voicePreviewLoading}
                      className={clsx(
                        'shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center transition-all',
                        voicePreviewPlaying
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                          : 'border-c-border text-c-muted hover:text-cyan-300 hover:border-cyan-500/50',
                        voicePreviewLoading && 'opacity-50 cursor-wait',
                      )}
                      title={t('tts.previewVoice')}
                    >
                      {voicePreviewLoading ? <Spinner size="sm" /> : voicePreviewPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Voice controls — speed, pitch, volume */}
              <div className="border border-[#22d3ee20] rounded-xl p-4 space-y-4 bg-[#22d3ee05]">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-medium text-c-text">{t('tts.voiceControls')}</span>
                  {currentVoice && (
                    <span className="ml-auto text-[10px] text-cyan-300 bg-cyan-900/20 px-2 py-0.5 rounded-full">
                      {currentVoice.flag} {currentVoice.label}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {/* Speed */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs text-c-muted">{t('tts.speed')}</label>
                      <div className="flex items-center gap-0.5">
                        <input type="number" min={-50} max={100} step={5} value={ttsRate}
                          onChange={(e) => setTtsRate(Math.min(100, Math.max(-50, Number(e.target.value) || 0)))}
                          className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                        <span className="text-xs text-c-dim">%</span>
                      </div>
                    </div>
                    <input type="range" min={-50} max={100} step={5} value={ttsRate}
                      onChange={(e) => setTtsRate(Number(e.target.value))}
                      className="w-full accent-cyan-500 h-1.5" />
                  </div>

                  {/* Pitch */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs text-c-muted">{t('tts.pitch')}</label>
                      <div className="flex items-center gap-0.5">
                        <input type="number" min={-50} max={50} step={5} value={ttsPitch}
                          onChange={(e) => setTtsPitch(Math.min(50, Math.max(-50, Number(e.target.value) || 0)))}
                          className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                        <span className="text-xs text-c-dim">Hz</span>
                      </div>
                    </div>
                    <input type="range" min={-50} max={50} step={5} value={ttsPitch}
                      onChange={(e) => setTtsPitch(Number(e.target.value))}
                      className="w-full accent-cyan-500 h-1.5" />
                  </div>

                  {/* Volume */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs text-c-muted">{t('tts.volume')}</label>
                      <div className="flex items-center gap-0.5">
                        <input type="number" min={-50} max={100} step={5} value={ttsVolume}
                          onChange={(e) => setTtsVolume(Math.min(100, Math.max(-50, Number(e.target.value) || 0)))}
                          className="w-14 text-xs text-cyan-300 font-mono bg-transparent border border-c-border rounded px-1 py-0.5 text-right" />
                        <span className="text-xs text-c-dim">%</span>
                      </div>
                    </div>
                    <input type="range" min={-50} max={100} step={5} value={ttsVolume}
                      onChange={(e) => setTtsVolume(Number(e.target.value))}
                      className="w-full accent-cyan-500 h-1.5" />
                  </div>
                </div>

                {/* Emotion/Style */}
                {availableStyles.length > 0 && (
                  <div>
                    <label className="text-xs text-c-muted mb-1.5 block">{t('tts.emotion')}</label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setTtsStyle('')}
                        className={clsx(
                          'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                          !ttsStyle
                            ? 'bg-cyan-900/30 border-cyan-600/50 text-cyan-300'
                            : 'border-c-border text-c-muted hover:border-c-border-hi',
                        )}
                      >
                        {t('tts.neutral')}
                      </button>
                      {availableStyles.map((s) => (
                        <button
                          key={s}
                          onClick={() => setTtsStyle(s)}
                          className={clsx(
                            'text-xs px-2.5 py-1 rounded-lg border transition-colors capitalize',
                            ttsStyle === s
                              ? 'bg-amber-900/30 border-amber-600/50 text-amber-300'
                              : 'border-c-border text-c-muted hover:border-c-border-hi',
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reset */}
                <button
                  onClick={() => { setTtsRate(0); setTtsPitch(0); setTtsVolume(0); setTtsStyle(''); }}
                  className="text-[10px] text-c-dim hover:text-c-muted"
                >
                  {t('tts.resetParams')}
                </button>
              </div>

              {/* Generate button */}
              <button
                onClick={handleGenerateAudio}
                disabled={!scriptText.trim() || generatingAudio}
                className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {generatingAudio ? <Spinner size="sm" /> : <Mic className="w-3.5 h-3.5" />}
                {t('storyboard.generateAudio')}
              </button>

              {/* Progress */}
              {audioProgress.length > 0 && (
                <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10">
                  <div className="flex items-center gap-2 mb-1">
                    {generatingAudio ? <Spinner size="sm" /> : <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
                    <span className="text-xs text-cyan-300">{generatingAudio ? t('storyboard.generatingAudio') : t('storyboard.audioDone')}</span>
                  </div>
                  <div ref={audioLogRef} className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                    {audioProgress.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                </div>
              )}

              {/* Audio result */}
              {audioFile && (
                <div className="border border-green-800/30 bg-green-900/10 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span className="text-xs font-medium text-c-text">{audioFile.filename}</span>
                    <span className="text-[10px] text-c-dim">{audioFile.duration.toFixed(1)}s</span>
                  </div>
                  <audio src={audioFile.url} controls className="w-full h-8" />
                </div>
              )}

              {/* Transcript segments */}
              {transcriptEntries.length > 0 && (
                <div className="border border-c-border rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-c-border bg-c-surface flex items-center justify-between">
                    <span className="text-xs font-medium text-c-text">{transcriptEntries.length} {t('storyboard.segments')}</span>
                    <button onClick={() => { setStep('prompts'); saveProject({ currentStep: 'prompts' }); }} className="btn-primary text-xs flex items-center gap-1">
                      {t('storyboard.generatePrompts')} <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="max-h-[250px] overflow-auto divide-y divide-c-border">
                    {transcriptEntries.map((e) => (
                      <div key={e.index} className="px-3 py-1.5 flex gap-3 items-start">
                        <span className="text-[10px] font-mono text-cyan-300/70 shrink-0 w-24">{e.startTime} → {e.endTime}</span>
                        <span className="text-xs text-c-muted">{e.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {/* STEP 3: IMAGE PROMPTS */}
          {step === 'prompts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-cyan-400" />
                  {t('storyboard.stepPrompts')} ({prompts.length})
                </h3>
                <div className="flex gap-2">
                  {prompts.length > 0 && (
                    <>
                      <button
                        onClick={() => { setPrompts([]); saveProject({ prompts: [] }); }}
                        className="btn-secondary text-xs flex items-center gap-1 text-red-400 hover:text-red-300"
                        title={t('storyboard.clearPrompts')}
                      >
                        <Trash2 className="w-3 h-3" />
                        {t('storyboard.clearPrompts')}
                      </button>
                      <button
                        onClick={() => {
                          const lines = prompts.map((p, i) => `[${p.timestamp}] ${p.prompt}`).join('\n\n');
                          navigator.clipboard.writeText(lines);
                          setCopiedField('prompts-text');
                          setTimeout(() => setCopiedField(null), 2000);
                        }}
                        className="btn-secondary text-xs flex items-center gap-1"
                        title={t('storyboard.exportPromptsText')}
                      >
                        <Copy className="w-3 h-3" />
                        {copiedField === 'prompts-text' ? t('storyboard.copied') : t('storyboard.exportPromptsText')}
                      </button>
                      <button
                        onClick={() => {
                          const data = {
                            projectName: projectName,
                            totalPrompts: prompts.length,
                            prompts: prompts.map((p, i) => ({
                              index: i + 1,
                              timestamp: p.timestamp,
                              narration: p.text,
                              imagePrompt: p.prompt,
                            })),
                          };
                          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${(projectName || 'prompts').replace(/\s+/g, '_')}_prompts.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="btn-secondary text-xs flex items-center gap-1"
                        title={t('storyboard.exportPromptsJSON')}
                      >
                        <Download className="w-3 h-3" />
                        JSON
                      </button>
                      <button
                        onClick={() => { setStep('images'); saveProject({ currentStep: 'images' }); }}
                        className="btn-primary text-xs flex items-center gap-1"
                      >
                        {t('storyboard.generateImages')} <ArrowRight className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Stage prompt editor */}
              <StagePromptEditor
                label={`Stage 3: ${t('storyboard.stepPrompts')} — ${t('storyboard.stagePrompt')}`}
                stageParts={templateStageParts.prompts}
                value={imagePromptPrompt}
                onChange={setImagePromptPrompt}
                onPartsChange={(parts) => setTemplateStageParts(p => ({ ...p, prompts: parts }))}
                onSave={() => handleSaveStagePrompt('prompts', imagePromptPrompt)}
                saving={savingPrompt === 'prompts'}
                t={t}
              />

              {/* Transcript preview */}
              {transcriptEntries.length > 0 && (
                <div className="border border-c-border rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-c-border bg-c-surface flex items-center justify-between">
                    <span className="text-xs font-medium text-c-text">{t('storyboard.transcriptPreview')} ({transcriptEntries.length})</span>
                  </div>
                  <div className="max-h-[200px] overflow-auto divide-y divide-c-border">
                    {transcriptEntries.map((e) => (
                      <div key={e.index} className="px-3 py-1.5 flex gap-3 items-start">
                        <span className="text-[10px] font-mono text-cyan-300/70 shrink-0 w-24">{e.startTime} &rarr; {e.endTime}</span>
                        <span className="text-xs text-c-muted">{e.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Generate prompts */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-c-muted">{t('image.aspectRatio')}:</label>
                  <div className="flex rounded-lg border border-c-border overflow-hidden">
                    {(['16:9', '9:16', '1:1'] as const).map(ar => (
                      <button
                        key={ar}
                        onClick={() => setAspectRatio(ar)}
                        className={clsx(
                          'px-2.5 py-1 text-xs font-medium transition-colors',
                          aspectRatio === ar ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text',
                        )}
                      >
                        {ar}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleGeneratePrompts}
                  disabled={!transcriptEntries.length || generatingPrompts}
                  className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {generatingPrompts ? <Spinner size="sm" /> : <Wand2 className="w-3.5 h-3.5" />}
                  {generatingPrompts ? t('storyboard.generatingPrompts') : t('storyboard.generatePrompts')}
                </button>
              </div>

              {promptProgress.length > 0 && generatingPrompts && (
                <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10">
                  <div className="flex items-center gap-2 mb-1">
                    <Spinner size="sm" />
                    <span className="text-xs text-cyan-300">{t('storyboard.generatingPrompts')}</span>
                  </div>
                  <div ref={promptLogRef} className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                    {promptProgress.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                </div>
              )}

              {/* Editable prompt list */}
              {prompts.length > 0 && (
                <div className="space-y-3">
                  {prompts.map((p, i) => (
                    <div key={i} className="border border-violet-800/30 rounded-xl bg-c-surface overflow-hidden">
                      {/* Header: index + timestamp + narration text */}
                      <div className="px-3 py-2 border-b border-c-border bg-violet-900/10 flex items-center gap-2">
                        <span className="text-[10px] font-bold text-violet-400 bg-violet-900/30 rounded-full w-5 h-5 flex items-center justify-center shrink-0">{i + 1}</span>
                        <span className="text-[10px] font-mono text-cyan-300/70">[{p.timestamp}]</span>
                        <span className="text-[10px] text-c-dim italic truncate">{p.text}</span>
                        <button
                          onClick={() => setEditingPromptIdx(editingPromptIdx === i ? null : i)}
                          className="ml-auto p-1 text-c-muted hover:text-cyan-400 shrink-0"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                      {/* Prompt body */}
                      <div className="p-3">
                        {editingPromptIdx === i ? (
                          <textarea
                            value={p.prompt}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPrompts((prev) => prev.map((pp, j) => j === i ? { ...pp, prompt: val } : pp));
                            }}
                            rows={4}
                            className="input text-[11px] w-full font-mono resize-y"
                            autoFocus
                          />
                        ) : (
                          <div className="text-xs text-c-muted cursor-pointer hover:text-c-text" onClick={() => setEditingPromptIdx(i)}>
                            {p.prompt}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 4: IMAGE / VIDEO GENERATION */}
          {step === 'images' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
                  {mediaType === 'video' ? <Video className="w-4 h-4 text-violet-400" /> : <Image className="w-4 h-4 text-cyan-400" />}
                  {mediaType === 'video' ? t('storyboard.stepVideos') : t('storyboard.stepImages')}
                  <span className="text-xs font-normal text-c-muted">
                    {generatedImages.length > 0 ? (
                      <>
                        <span className="text-emerald-400">{doneImageCount} {t('storyboard.imgDone')}</span>
                        {errorImageCount > 0 && <> · <span className="text-red-400">{errorImageCount} {t('storyboard.imgFailed')}</span></>}
                        {pendingImageCount > 0 && <> · <span className="text-yellow-400">{pendingImageCount} {t('storyboard.imgPending')}</span></>}
                        <span className="text-c-dim"> / {prompts.length} {t('storyboard.total')}</span>
                      </>
                    ) : (
                      <>({prompts.length} {t('storyboard.stepPrompts').toLowerCase()})</>
                    )}
                  </span>
                </h3>
                {!generatingImages && generatedImages.length > 0 && (
                  <div className="flex items-center gap-2">
                    {/* Resume failed */}
                    {flowAvailable && failedImageCount > 0 && regenIndex === null && (
                      <button
                        onClick={handleFlowResume}
                        className="text-xs py-1.5 px-3 rounded-lg font-medium flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" /> {t('storyboard.resumeFailed', { count: failedImageCount })}
                      </button>
                    )}
                    {/* Clear all */}
                    {doneImageCount > 0 && (
                      <button
                        onClick={() => {
                          if (!confirm(t('storyboard.clearImagesConfirm'))) return;
                          const cleared = generatedImages.map(img => ({ ...img, status: 'pending' as const, filename: '', url: '' }));
                          setGeneratedImages(cleared);
                          const clearedSegments = segments.map(s => ({ ...s, imageFilename: '', imageUrl: '', videoFilename: '', videoUrl: '' }));
                          setSegments(clearedSegments);
                          saveProject({ generatedImages: cleared, segments: clearedSegments });
                          const promptTexts = prompts.map(p => p.prompt).filter(Boolean);
                          if (promptTexts.length) imageApi.clearPromptCache(promptTexts);
                        }}
                        className="text-xs py-1.5 px-3 rounded-lg font-medium flex items-center gap-1.5 bg-red-600/10 text-red-400 hover:bg-red-600/20 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" /> {t('storyboard.clearAllImages')} ({doneImageCount})
                      </button>
                    )}
                    {/* Build timeline */}
                    {doneImageCount > 0 && (
                      <button onClick={handleBuildTimeline} className="btn-primary text-xs flex items-center gap-1">
                        {t('storyboard.buildTimeline')} <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Progress bar */}
              {generatedImages.length > 0 && (
                <div className="w-full h-2 rounded-full bg-c-elevated overflow-hidden flex">
                  {doneImageCount > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${(doneImageCount / generatedImages.length) * 100}%` }} />}
                  {errorImageCount > 0 && <div className="bg-red-500 transition-all" style={{ width: `${(errorImageCount / generatedImages.length) * 100}%` }} />}
                  {pendingImageCount > 0 && <div className="bg-yellow-500/40 transition-all" style={{ width: `${(pendingImageCount / generatedImages.length) * 100}%` }} />}
                </div>
              )}

              {/* Media Type Toggle: Image / Video */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-c-muted">{t('storyboard.mediaType')}:</span>
                <div className="flex rounded-lg border border-c-border overflow-hidden">
                  <button
                    onClick={() => setMediaType('image')}
                    className={clsx(
                      'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                      mediaType === 'image' ? 'bg-cyan-600/20 text-cyan-400 border-r border-c-border' : 'text-c-muted hover:text-c-text border-r border-c-border',
                    )}
                  >
                    <Image className="w-3.5 h-3.5" /> {t('storyboard.imageMode')}
                  </button>
                  <button
                    onClick={() => { setMediaType('video'); setImageTab('generate'); }}
                    className={clsx(
                      'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                      mediaType === 'video' ? 'bg-violet-600/20 text-violet-400' : 'text-c-muted hover:text-c-text',
                    )}
                  >
                    <Video className="w-3.5 h-3.5" /> {t('storyboard.videoMode')}
                  </button>
                </div>
              </div>

              {/* Video mode: generate via Extension */}
              {mediaType === 'video' ? (
                <div className="space-y-3">
                  {!flowAvailable ? (
                    <div className="border-2 border-dashed border-violet-700/30 rounded-xl p-8 flex flex-col items-center justify-center gap-3">
                      <Globe className="w-8 h-8 text-violet-400/50" />
                      <span className="text-sm text-c-text font-medium">Extension Not Detected</span>
                      <span className="text-xs text-c-dim text-center max-w-md">
                        Install the <b>Han2YT</b> Chrome extension and reload this page.
                        Open Google Flow, switch to <b>Video mode</b>, then come back here to generate.
                      </span>
                    </div>
                  ) : (
                    <div className="border border-violet-800/30 rounded-xl p-4 bg-violet-900/10 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-xs font-medium text-violet-300">
                          <Film className="w-4 h-4 inline mr-1" /> Extension Connected — Video Mode
                        </span>
                      </div>
                      <div className="text-[11px] text-c-dim space-y-1">
                        <p>The extension will type each prompt into Google Flow, wait for the generated <b>video</b>, and upload it back here.</p>
                        <p className="text-amber-300/80">Make sure Google Flow is set to <b>Video mode</b>. Close DevTools (F12) on the target tab.</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={generatingImages ? handleStopImages : handleGenerateVideos}
                          disabled={!prompts.length && !generatingImages}
                          className={clsx(
                            'text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5',
                            generatingImages ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50',
                          )}
                        >
                          {generatingImages
                            ? <><Square className="w-3 h-3" /> {t('image.stop')}</>
                            : <><Video className="w-3.5 h-3.5" /> Generate {prompts.length} videos via Flow</>
                          }
                        </button>
                        {!generatingImages && failedImageCount > 0 && (
                          <button
                            onClick={handleFlowResume}
                            className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Resume {failedImageCount} failed
                          </button>
                        )}
                        <span className="text-[10px] text-c-dim">{prompts.length} prompts queued</span>
                      </div>
                    </div>
                  )}

                  {imageProgress.length > 0 && (
                    <div className="border border-violet-800/30 rounded-xl p-3 bg-violet-900/10">
                      <div className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                        {imageProgress.slice(-10).map((line, i) => (
                          <div key={i} className={line.includes('Failed') || line.includes('Stopped') ? 'text-red-400' : line.includes('Done') ? 'text-green-400' : ''}>{line}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
              <>
              {/* Aspect Ratio (shared across all image tabs) */}
              <div className="flex items-center gap-2">
                <label className="text-xs text-c-muted">{t('image.aspectRatio')}:</label>
                <div className="flex rounded-lg border border-c-border overflow-hidden">
                  {(['16:9', '9:16', '1:1'] as const).map(ar => (
                    <button
                      key={ar}
                      onClick={() => setAspectRatio(ar)}
                      className={clsx(
                        'px-3 py-1 text-xs font-medium transition-colors',
                        aspectRatio === ar ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text',
                      )}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tabs: Generate / Google Flow / Upload (image mode only) */}
              <div className="flex gap-0 border-b border-c-border">
                <button
                  onClick={() => setImageTab('generate')}
                  className={clsx(
                    'px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
                    imageTab === 'generate' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-c-muted hover:text-c-text',
                  )}
                >
                  <Wand2 className="w-3.5 h-3.5" /> {t('storyboard.generateAllImages')}
                </button>
                <button
                  onClick={() => setImageTab('flow')}
                  className={clsx(
                    'px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
                    imageTab === 'flow' ? 'border-violet-400 text-violet-400' : 'border-transparent text-c-muted hover:text-c-text',
                  )}
                >
                  <Globe className="w-3.5 h-3.5" /> Extension
                  {flowAvailable && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                </button>
                <button
                  onClick={() => setImageTab('upload')}
                  className={clsx(
                    'px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
                    imageTab === 'upload' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-c-muted hover:text-c-text',
                  )}
                >
                  <Upload className="w-3.5 h-3.5" /> {t('storyboard.uploadZip')}
                </button>
              </div>

              {/* Tab: Generate */}
              {imageTab === 'generate' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <label className="text-xs text-c-muted mb-1 block">{t('image.provider')}</label>
                      <select
                        value={provider}
                        onChange={(e) => { setProvider(e.target.value); setImageModel(''); }}
                        className="input text-sm"
                      >
                        <option value="auto">{t('storyboard.autoProvider')}</option>
                        {imageProviders?.map((p) => (
                          <option key={p.id} value={p.id} disabled={!p.available && p.needsKey}>
                            {p.name}{p.free ? ' (Free)' : ''}{!p.available && p.needsKey ? ` — ${t('storyboard.keyNeeded')}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedProviderInfo?.models && selectedProviderInfo.models.length > 0 && (
                      <div>
                        <label className="text-xs text-c-muted mb-1 block">{t('image.model')}</label>
                        <select value={imageModel} onChange={(e) => setImageModel(e.target.value)} className="input text-sm">
                          <option value="">{t('image.defaultModel')}</option>
                          {selectedProviderInfo.models.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="self-end">
                      <button
                        onClick={generatingImages ? handleStopImages : handleGenerateImages}
                        disabled={!prompts.length && !generatingImages}
                        className={clsx(
                          'text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5',
                          generatingImages ? 'bg-red-600 hover:bg-red-700 text-white' : 'btn-primary disabled:opacity-50',
                        )}
                      >
                        {generatingImages
                          ? <><Square className="w-3 h-3" /> {t('image.stop')}</>
                          : <><Image className="w-3.5 h-3.5" /> {t('storyboard.generateAllImages')}</>
                        }
                      </button>
                    </div>
                  </div>

                  {imageProgress.length > 0 && (
                    <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10">
                      <div className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                        {imageProgress.slice(-10).map((line, i) => (
                          <div key={i} className={line.includes('Failed') || line.includes('Stopped') ? 'text-red-400' : line.includes('Done') ? 'text-green-400' : ''}>{line}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Extension (Google Flow / Grok / ChatGPT) */}
              {imageTab === 'flow' && (
                <div className="space-y-3">
                  {/* Provider selector */}
                  <div className="flex rounded-lg border border-c-border overflow-hidden">
                    {([
                      { id: 'google-flow' as const, label: 'Google Flow' },
                      { id: 'grok' as const, label: 'Grok' },
                      { id: 'chatgpt' as const, label: 'ChatGPT' },
                    ]).map(fp => (
                      <button
                        key={fp.id}
                        onClick={() => setFlowProvider(fp.id)}
                        className={clsx(
                          'flex-1 py-1.5 text-xs font-medium transition-colors',
                          flowProvider === fp.id
                            ? 'bg-violet-600/20 text-violet-400 border-b-2 border-violet-400'
                            : 'text-c-muted hover:bg-c-elevated hover:text-c-text',
                        )}
                      >
                        {fp.label}
                      </button>
                    ))}
                  </div>

                  {!flowAvailable ? (
                    <div className="border-2 border-dashed border-violet-700/30 rounded-xl p-8 flex flex-col items-center justify-center gap-3">
                      <Globe className="w-8 h-8 text-violet-400/50" />
                      <span className="text-sm text-c-text font-medium">Extension Not Detected</span>
                      <span className="text-xs text-c-dim text-center max-w-md">
                        Install the <b>Han2YT</b> Chrome extension and reload this page.
                        The extension will open {flowProvider === 'google-flow' ? 'Google Flow' : flowProvider === 'grok' ? 'Grok' : 'ChatGPT'}, type each prompt, wait for the image, and send it back here automatically.
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="border border-violet-800/30 rounded-xl p-4 bg-violet-900/10 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                          <span className="text-xs font-medium text-violet-300">Extension Connected — {flowProvider === 'google-flow' ? 'Google Flow' : flowProvider === 'grok' ? 'Grok' : 'ChatGPT'}</span>
                        </div>
                        <div className="text-[11px] text-c-dim space-y-1">
                          <p>The extension will open {flowProvider === 'google-flow' ? 'Google Flow' : flowProvider === 'grok' ? 'Grok' : 'ChatGPT'} tab, type each prompt one by one, wait for the generated image, and upload it back here.</p>
                          <p className="text-amber-300/80">Close DevTools (F12) on the target tab and do not dismiss the yellow &quot;debugging&quot; bar while running.</p>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          {generatingImages ? (
                            <button
                              onClick={handleStopImages}
                              className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white"
                            >
                              <Square className="w-3 h-3" /> Stop
                            </button>
                          ) : doneImageCount > 0 && failedImageCount === 0 && pendingImageCount === 0 ? (
                            /* All done — show Regenerate All */
                            <button
                              onClick={handleFlowRegenerateAll}
                              disabled={!prompts.length}
                              className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                            >
                              <RefreshCw className="w-3.5 h-3.5" /> Regenerate all {prompts.length} images
                            </button>
                          ) : failedImageCount > 0 || pendingImageCount > 0 ? (
                            /* Some failed/pending — show Resume (skips done) */
                            <button
                              onClick={handleFlowResume}
                              disabled={!prompts.length}
                              className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                            >
                              <RefreshCw className="w-3.5 h-3.5" /> Resume {failedImageCount + pendingImageCount} remaining
                            </button>
                          ) : (
                            /* No images yet — show Generate */
                            <button
                              onClick={handleFlowGenerate}
                              disabled={!prompts.length}
                              className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                            >
                              <Globe className="w-3.5 h-3.5" /> Generate {prompts.length} images via {flowProvider === 'google-flow' ? 'Flow' : flowProvider === 'grok' ? 'Grok' : 'ChatGPT'}
                            </button>
                          )}
                          {/* Always show Regenerate All as secondary when there are partial results */}
                          {!generatingImages && doneImageCount > 0 && (failedImageCount > 0 || pendingImageCount > 0) && (
                            <button
                              onClick={handleFlowRegenerateAll}
                              className="text-xs py-2 px-3 rounded-lg font-medium flex items-center gap-1.5 border border-violet-600/50 text-violet-300 hover:bg-violet-600/20 transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" /> Regenerate all
                            </button>
                          )}
                          <span className="text-[10px] text-c-dim">
                            {doneImageCount > 0
                              ? `${doneImageCount}/${prompts.length} done`
                              : `${prompts.length} prompts queued`}
                          </span>
                        </div>
                      </div>

                      {imageProgress.length > 0 && (
                        <div className="border border-violet-800/30 rounded-xl p-3 bg-violet-900/10">
                          <div className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                            {imageProgress.slice(-10).map((line, i) => (
                              <div key={i} className={line.includes('Error') || line.includes('Failed') ? 'text-red-400' : line.includes('Done') ? 'text-green-400' : ''}>{line}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Tab: Upload Zip */}
              {imageTab === 'upload' && (
                <div className="space-y-3">
                  <input
                    ref={zipInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadZip(f); }}
                  />
                  <div
                    onClick={() => !uploadingZip && zipInputRef.current?.click()}
                    className={clsx(
                      'border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors',
                      uploadingZip ? 'border-cyan-600/40 bg-cyan-950/20' : 'border-c-border hover:border-cyan-600/50 hover:bg-cyan-950/10',
                    )}
                  >
                    {uploadingZip ? (
                      <>
                        <Spinner size="md" />
                        <span className="text-sm text-cyan-400">{t('storyboard.uploadingZip')}</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-8 h-8 text-c-muted" />
                        <span className="text-sm text-c-text font-medium">{t('storyboard.uploadZip')}</span>
                        <span className="text-xs text-c-dim text-center">{t('storyboard.uploadZipHint')}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
              </>
              )}

              {/* Stop button while generating */}
              {(generatingImages || regenIndex !== null) && (
                <div className="flex items-center gap-3 border border-amber-800/30 rounded-xl p-3 bg-amber-900/10">
                  <Spinner size="sm" />
                  <span className="text-xs text-amber-300 flex-1">
                    {regenIndex !== null
                      ? `Regenerating image #${regenIndex + 1}...`
                      : `Generating images (${generatedImages.filter((im) => im.status === 'done').length}/${generatedImages.length})...`
                    }
                  </span>
                  <button
                    onClick={() => {
                      handleStopImages();
                      if (regenIndex !== null) {
                        setGeneratedImages((prev) =>
                          prev.map((im, idx) => idx === regenIndex && im.status === 'generating' ? { ...im, status: 'error' as const } : im),
                        );
                        setRegenIndex(null);
                      }
                    }}
                    className="text-xs py-1.5 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium flex items-center gap-1.5"
                  >
                    <Square className="w-3 h-3" /> Stop
                  </button>
                </div>
              )}

              {generatedImages.length > 0 && flowAvailable && !generatingImages && regenIndex === null && failedImageCount > 0 && (
                <div className="flex items-center gap-2 text-[10px] text-c-dim">
                  <span>Retry with:</span>
                  {(['google-flow', 'grok', 'chatgpt'] as const).map(fp => (
                    <button
                      key={fp}
                      onClick={() => setFlowProvider(fp)}
                      className={clsx(
                        'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                        flowProvider === fp ? 'bg-violet-600 text-white' : 'bg-c-elevated text-c-muted hover:text-c-text',
                      )}
                    >
                      {fp === 'google-flow' ? 'Flow' : fp === 'grok' ? 'Grok' : 'ChatGPT'}
                    </button>
                  ))}
                  <button
                    onClick={handleFlowResume}
                    className="ml-auto px-3 py-0.5 rounded text-[10px] font-medium bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1"
                  >
                    <RefreshCw className="w-2.5 h-2.5" /> Resume {failedImageCount} failed
                  </button>
                </div>
              )}

              {generatedImages.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {generatedImages.map((img, i) => {
                    const isEditing = editingImageIdx === i;
                    const prompt = prompts[i];
                    return (
                    <div key={i} ref={(el) => { imageCardRefs.current[i] = el; }} className={clsx(
                      'rounded-xl border overflow-hidden group/card',
                      img.status === 'done' ? 'border-green-800/30' : img.status === 'generating' ? 'border-cyan-800/30' : img.status === 'error' ? 'border-red-800/30' : 'border-c-border',
                    )}>
                      {/* Media area */}
                      {img.status === 'done' && img.url ? (() => {
                        const isVid = img.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(img.url || '') || /\.(mp4|webm|mov)$/i.test(img.filename || '');
                        return (
                        <div className="relative cursor-pointer group" onClick={() => setLightboxUrl(img.url)}>
                          {isVid ? (
                            <video src={`${img.url}#t=0.1`} className={clsx('w-full object-cover', aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video')} muted loop playsInline preload="metadata" onMouseEnter={(e) => (e.target as HTMLVideoElement).play()} onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }} />
                          ) : (
                            <img src={img.url} alt={`Generated image ${img.timestamp}`} className={clsx('w-full object-cover', aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video')} loading="lazy" />
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <ZoomIn className="w-5 h-5 text-white" />
                          </div>
                          {/* Action buttons overlay */}
                          {!generatingImages && regenIndex === null && (
                            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-all">
                              {flowAvailable && (
                                <>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRegenSingle(i, 'google-flow'); }}
                                    className="p-1 rounded-md bg-black/60 text-blue-300 hover:text-white hover:bg-blue-600/80"
                                    title="Regenerate via Google Flow"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRegenSingle(i, 'grok'); }}
                                    className="p-1 rounded-md bg-black/60 text-orange-300 hover:text-white hover:bg-orange-600/80"
                                    title="Regenerate via Grok"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRegenSingle(i, 'chatgpt'); }}
                                    className="p-1 rounded-md bg-black/60 text-green-300 hover:text-white hover:bg-green-600/80"
                                    title="Regenerate via ChatGPT"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDropImage(i); }}
                                className="p-1 rounded-md bg-black/60 text-white/80 hover:text-white hover:bg-red-600/80"
                                title="Remove image"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                        );
                      })() : (
                        <div className={clsx('flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-c-elevated to-c-bg', aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video')}>
                          {img.status === 'generating' ? (
                            <Spinner size="sm" />
                          ) : img.status === 'error' ? (
                            <>
                              <X className="w-4 h-4 text-red-400" />
                              {flowAvailable && regenIndex === null && (
                                <div className="flex flex-wrap justify-center gap-1">
                                  <button
                                    onClick={() => handleRegenSingle(i, 'google-flow')}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-blue-600/80 hover:bg-blue-600 text-white flex items-center gap-0.5 transition-colors"
                                    title="Retry with Google Flow"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5" /> Google
                                  </button>
                                  <button
                                    onClick={() => handleRegenSingle(i, 'grok')}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-orange-600/80 hover:bg-orange-600 text-white flex items-center gap-0.5 transition-colors"
                                    title="Retry with Grok"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5" /> Grok
                                  </button>
                                  <button
                                    onClick={() => handleRegenSingle(i, 'chatgpt')}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-green-600/80 hover:bg-green-600 text-white flex items-center gap-0.5 transition-colors"
                                    title="Retry with ChatGPT"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5" /> GPT
                                  </button>
                                </div>
                              )}
                              <button
                                onClick={() => handleDropImage(i)}
                                className="text-[9px] px-2 py-0.5 rounded bg-red-800/60 hover:bg-red-700 text-white flex items-center gap-1 transition-colors"
                              >
                                <Trash2 className="w-2.5 h-2.5" /> Drop
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="w-4 h-4 rounded-full border-2 border-c-dim" />
                              {flowAvailable && regenIndex === null && (
                                <div className="flex flex-wrap justify-center gap-1">
                                  <button
                                    onClick={() => handleRegenSingle(i, 'google-flow')}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-blue-600/60 hover:bg-blue-600 text-white flex items-center gap-0.5 transition-colors"
                                    title="Generate with Google Flow"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5" /> Google
                                  </button>
                                  <button
                                    onClick={() => handleRegenSingle(i, 'grok')}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-orange-600/60 hover:bg-orange-600 text-white flex items-center gap-0.5 transition-colors"
                                    title="Generate with Grok"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5" /> Grok
                                  </button>
                                  <button
                                    onClick={() => handleRegenSingle(i, 'chatgpt')}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-green-600/60 hover:bg-green-600 text-white flex items-center gap-0.5 transition-colors"
                                    title="Generate with ChatGPT"
                                  >
                                    <RefreshCw className="w-2.5 h-2.5" /> GPT
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {/* Footer: timestamp + prompt edit */}
                      <div className="px-2 py-1.5 bg-c-bg/50 space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-cyan-400 font-mono shrink-0">[{img.timestamp}]</span>
                          <span className="text-[9px] text-c-dim font-medium shrink-0">#{i + 1}</span>
                          <span className="flex-1" />
                          <button
                            onClick={() => isEditing ? handleSaveEditedPrompt(i) : handleStartEditPrompt(i)}
                            className="p-0.5 rounded text-c-dim hover:text-c-text transition-colors"
                            title={isEditing ? 'Save prompt' : 'Edit prompt'}
                          >
                            {isEditing ? <CheckCircle className="w-3 h-3 text-green-400" /> : <Pencil className="w-3 h-3" />}
                          </button>
                          {isEditing && (
                            <button
                              onClick={() => setEditingImageIdx(null)}
                              className="p-0.5 rounded text-c-dim hover:text-red-400 transition-colors"
                              title="Cancel"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {isEditing ? (
                          <textarea
                            value={editingImagePrompt}
                            onChange={(e) => setEditingImagePrompt(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleSaveEditedPrompt(i); if (e.key === 'Escape') setEditingImageIdx(null); }}
                            className="w-full text-[10px] bg-c-bg border border-c-border rounded p-1 text-c-text resize-y min-h-[40px] max-h-[100px] focus:outline-none focus:border-violet-600/50"
                            autoFocus
                          />
                        ) : (
                          <div className="text-[9px] text-c-muted line-clamp-2 leading-tight cursor-pointer hover:text-c-text" onClick={() => handleStartEditPrompt(i)}>
                            {prompt?.prompt || '—'}
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 5: TIMELINE */}
          {step === 'timeline' && (() => {
            const totalDuration = segments.length > 0 ? segments[segments.length - 1]?.endTime || 0 : 0;
            const maxSegDuration = segments.length > 0 ? Math.max(...segments.map(s => s.endTime - s.startTime)) : 1;
            return (
            <div className="space-y-3">
              {/* Header card */}
              <div className="border border-c-border rounded-xl bg-c-surface p-4 space-y-3">
                {/* Title row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-base font-medium text-c-text flex items-center gap-2">
                    <Clock className="w-4.5 h-4.5 text-cyan-400" />
                    {t('storyboard.stepTimeline')}
                  </h3>
                  <span className="text-xs text-c-dim bg-c-bg rounded-full px-3 py-0.5 border border-c-border">{segments.length} {t('storyboard.segments')}</span>
                  {segments.length > 0 && (
                    <span className="text-xs text-c-dim bg-c-bg rounded-full px-3 py-0.5 border border-c-border">
                      {fmtTime(totalDuration)} {t('storyboard.total')}
                    </span>
                  )}
                  <div className="flex items-center gap-2 ml-auto">
                    <select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value as 'seconds' | 'minutes')} className="input text-xs py-1 w-auto">
                      <option value="seconds">{t('storyboard.timeSeconds')}</option>
                      <option value="minutes">{t('storyboard.timeMinutes')}</option>
                    </select>
                    <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="input text-xs py-1">
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                      <option value="1:1">1:1</option>
                    </select>
                  </div>
                </div>

                {/* Background Music & Volume Controls */}
                <MusicPanel
                  bgMusicFilename={bgMusicFilename}
                  setBgMusicFilename={(f) => { setBgMusicFilename(f); saveProject({ bgMusicFilename: f }); }}
                  voiceVolume={voiceVolume}
                  setVoiceVolume={(v) => { setVoiceVolume(v); saveProject({ voiceVolume: v }); }}
                  musicVolume={musicVolume}
                  setMusicVolume={(v) => { setMusicVolume(v); saveProject({ musicVolume: v }); }}
                  totalDuration={totalDuration}
                  t={t}
                />

                {/* CapCut-style visual timeline track */}
                {segments.length > 0 && totalDuration > 0 && (() => {
                  const pxPerSec = trackZoom;
                  const trackWidth = totalDuration * pxPerSec;
                  // Time ruler ticks
                  const tickInterval = totalDuration <= 10 ? 1 : totalDuration <= 30 ? 2 : totalDuration <= 60 ? 5 : 10;
                  const ticks: number[] = [];
                  for (let t = 0; t <= totalDuration; t += tickInterval) ticks.push(t);
                  if (ticks[ticks.length - 1] < totalDuration) ticks.push(totalDuration);
                  return (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-c-dim font-medium">{t('storyboard.timelineOverview')}</span>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-c-dim">W</span>
                          <button
                            onClick={() => setTrackZoom(z => Math.max(30, z - 30))}
                            className="w-5 h-5 rounded flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors border border-c-border text-[10px] font-bold"
                          >−</button>
                          <button
                            onClick={() => setTrackZoom(z => Math.min(400, z + 30))}
                            className="w-5 h-5 rounded flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors border border-c-border text-[10px] font-bold"
                          >+</button>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-c-dim">H</span>
                          <button
                            onClick={() => setTrackHeight(h => Math.max(80, h - 40))}
                            className="w-5 h-5 rounded flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors border border-c-border text-[10px] font-bold"
                          >−</button>
                          <button
                            onClick={() => setTrackHeight(h => Math.min(500, h + 40))}
                            className="w-5 h-5 rounded flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors border border-c-border text-[10px] font-bold"
                          >+</button>
                        </div>
                      </div>
                    </div>
                    <div className="relative border border-c-border rounded-xl bg-c-bg overflow-hidden">
                      {/* Fixed center playhead — stays in middle, track scrolls underneath */}
                      {playheadTime !== null && (
                        <div className="absolute left-1/2 top-0 bottom-0 z-30 pointer-events-none -translate-x-1/2">
                          <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full shadow-md shadow-red-500/40 border-2 border-white/80" />
                          <div className="w-0.5 h-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)] mx-auto" />
                        </div>
                      )}
                      <div
                        className={clsx('overflow-x-auto scrollbar-thin', trackGrabbing ? 'cursor-grabbing' : 'cursor-grab')}
                        ref={timelineTrackRef}
                        style={{ scrollBehavior: 'auto' }}
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).closest('[data-edge-handle]')) return;
                          const el = timelineTrackRef.current;
                          if (!el) return;
                          e.preventDefault();
                          manualScrolling.current = true;
                          trackDragRef.current = { startX: e.clientX, scrollLeft: el.scrollLeft, raf: null };
                          setTrackGrabbing(true);
                          let targetScroll = el.scrollLeft;
                          const onMove = (me: MouseEvent) => {
                            if (!trackDragRef.current) return;
                            targetScroll = trackDragRef.current.scrollLeft - (me.clientX - trackDragRef.current.startX);
                            if (!trackDragRef.current.raf) {
                              trackDragRef.current.raf = requestAnimationFrame(() => {
                                if (trackDragRef.current) trackDragRef.current.raf = null;
                                el.scrollLeft = targetScroll;
                              });
                            }
                          };
                          const onUp = () => {
                            if (trackDragRef.current?.raf) cancelAnimationFrame(trackDragRef.current.raf);
                            trackDragRef.current = null;
                            setTrackGrabbing(false);
                            // Seek audio to where the center red line now points
                            const centerTime = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth * totalDuration;
                            const clampedTime = Math.max(0, Math.min(totalDuration, centerTime));
                            if (segAudioRef.current && playingSegment !== null) {
                              segAudioRef.current.currentTime = clampedTime;
                            }
                            setPlayheadTime(clampedTime);
                            const segs = segmentsRef.current;
                            const ai = segs.findIndex((s, si) => clampedTime >= s.startTime && (si === segs.length - 1 ? clampedTime <= s.endTime : clampedTime < s.endTime));
                            if (ai >= 0) setPlayingSegment(ai);
                            manualScrolling.current = false;
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                          };
                          window.addEventListener('mousemove', onMove);
                          window.addEventListener('mouseup', onUp);
                        }}
                        onTouchStart={(e) => {
                          const el = timelineTrackRef.current;
                          if (!el) return;
                          manualScrolling.current = true;
                          const touch = e.touches[0];
                          trackDragRef.current = { startX: touch.clientX, scrollLeft: el.scrollLeft, raf: null };
                          let targetScroll = el.scrollLeft;
                          const onMove = (te: TouchEvent) => {
                            if (!trackDragRef.current) return;
                            targetScroll = trackDragRef.current.scrollLeft - (te.touches[0].clientX - trackDragRef.current.startX);
                            if (!trackDragRef.current.raf) {
                              trackDragRef.current.raf = requestAnimationFrame(() => {
                                if (trackDragRef.current) trackDragRef.current.raf = null;
                                el.scrollLeft = targetScroll;
                              });
                            }
                          };
                          const onEnd = () => {
                            if (trackDragRef.current?.raf) cancelAnimationFrame(trackDragRef.current.raf);
                            trackDragRef.current = null;
                            const centerTime = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth * totalDuration;
                            const clampedTime = Math.max(0, Math.min(totalDuration, centerTime));
                            if (segAudioRef.current && playingSegment !== null) {
                              segAudioRef.current.currentTime = clampedTime;
                            }
                            setPlayheadTime(clampedTime);
                            const segs = segmentsRef.current;
                            const ai = segs.findIndex((s, si) => clampedTime >= s.startTime && (si === segs.length - 1 ? clampedTime <= s.endTime : clampedTime < s.endTime));
                            if (ai >= 0) setPlayingSegment(ai);
                            manualScrolling.current = false;
                            window.removeEventListener('touchmove', onMove);
                            window.removeEventListener('touchend', onEnd);
                          };
                          window.addEventListener('touchmove', onMove, { passive: true });
                          window.addEventListener('touchend', onEnd);
                        }}
                      >
                        <div className="relative" style={{ width: `${trackWidth}px`, minWidth: '100%' }}>
                          {/* Time ruler */}
                          <div className="relative h-5 border-b border-c-border/60 bg-c-surface/50">
                            {ticks.map((tick) => (
                              <div key={tick} className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${(tick / totalDuration) * 100}%` }}>
                                <div className="w-px h-2 bg-c-dim/40" />
                                <span className="text-[8px] font-mono text-c-dim/70 mt-px leading-none">{fmtTime(tick)}</span>
                              </div>
                            ))}
                          </div>
                          {/* Video track — thumbnail strip with draggable edges */}
                          <div className="relative flex" style={{ height: `${trackHeight}px` }}>
                            {segments.map((seg, i) => {
                              const dur = seg.endTime - seg.startTime;
                              const widthPct = (dur / totalDuration) * 100;
                              const isHovered = hoveredSegment === i;
                              const isPlaying = playingSegment === i;
                              return (
                                <div key={i} className="relative h-full shrink-0 grow-0" style={{ width: `${widthPct}%`, minWidth: '4px' }}>
                                  {/* Segment body */}
                                  <button
                                    className={clsx(
                                      'relative w-full h-full flex flex-col justify-between overflow-hidden transition-shadow duration-150 group/track',
                                      isPlaying ? 'ring-2 ring-inset ring-cyan-400 z-10 brightness-150 saturate-150' :
                                      isHovered ? 'ring-2 ring-inset ring-cyan-500/40 z-10' : '',
                                    )}
                                    style={{
                                      background: `hsl(${(i * 30 + 200) % 360}, ${isPlaying ? '60%' : '45%'}, ${isPlaying ? '35%' : isHovered ? '28%' : '18%'})`,
                                      boxShadow: isPlaying ? `inset 0 0 20px rgba(6, 182, 212, 0.3), 0 0 12px rgba(6, 182, 212, 0.2)` : undefined,
                                    }}
                                    onMouseEnter={() => setHoveredSegment(i)}
                                    onMouseLeave={() => setHoveredSegment(null)}
                                    onClick={() => {
                                      setHoveredSegment(i);
                                      if (audioFile) playSegmentAudio(i);
                                    }}
                                    aria-label={t('storyboard.segmentOf', { current: i + 1, total: segments.length })}
                                  >
                                    {/* Thumbnail fill */}
                                    {(() => {
                                      const segIsVideo = seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '');
                                      const videoSrc = seg.videoUrl || (segIsVideo ? seg.imageUrl : '');
                                      if (segIsVideo && videoSrc) {
                                        return <video src={`${videoSrc}#t=0.1`} className={clsx(
                                          'absolute inset-0 w-full h-full object-cover transition-opacity duration-150',
                                          isPlaying ? 'opacity-80' : 'opacity-50 group-hover/track:opacity-70'
                                        )} muted preload="metadata" />;
                                      }
                                      if (seg.imageUrl) {
                                        return <img src={seg.imageUrl} alt="" className={clsx(
                                          'absolute inset-0 w-full h-full object-cover transition-opacity duration-150',
                                          isPlaying ? 'opacity-80' : 'opacity-50 group-hover/track:opacity-70'
                                        )} />;
                                      }
                                      return null;
                                    })()}
                                    {/* Top: time range */}
                                    <div className="relative z-10 flex items-center justify-between px-1.5 pt-1 w-full">
                                      <span className="text-[9px] font-mono text-white/60 drop-shadow">{fmtTime(seg.startTime)}</span>
                                      <span className="text-[9px] font-mono text-white/60 drop-shadow">{fmtTime(seg.endTime)}</span>
                                    </div>
                                    {/* Bottom: segment number + duration */}
                                    <div className="relative z-10 flex items-center gap-1 px-1.5 pb-1 w-full">
                                      <span className="text-[10px] font-bold text-white/90 drop-shadow-md">{i + 1}</span>
                                      <span className="text-[9px] font-mono text-white/70 drop-shadow truncate">{dur.toFixed(1)}s</span>
                                    </div>
                                  </button>
                                  {/* Draggable right edge handle (between this and next segment) */}
                                  {i < segments.length - 1 && (
                                    <div
                                      data-edge-handle
                                      className="absolute top-0 -right-[5px] w-[10px] h-full z-20 cursor-col-resize flex items-center justify-center group/edge"
                                      onMouseDown={(e) => handleTrackEdgeDrag(e, i)}
                                      title={t('storyboard.dragToResize')}
                                    >
                                      <div className="w-[3px] h-8 rounded-full bg-white/20 group-hover/edge:bg-cyan-400 group-hover/edge:h-12 group-hover/edge:shadow-[0_0_8px_rgba(6,182,212,0.5)] transition-all" />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {/* Audio track hint */}
                          {audioFile && (
                            <div className="relative h-6 border-t border-c-border/40 bg-c-surface/30 flex items-center px-2 gap-1.5">
                              <Volume2 className="w-3 h-3 text-cyan-400/60 shrink-0" />
                              <div className="flex-1 h-2 rounded-full bg-cyan-500/15 overflow-hidden">
                                <div className="h-full bg-cyan-500/30 rounded-full" style={{ width: '100%' }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })()}

                {/* Player transport controls */}
                {audioFile && segments.length > 0 && (
                  <div className="flex items-center gap-3 bg-c-bg rounded-lg border border-c-border px-3 py-2">
                    {/* Play / Pause / Skip */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => skipSegment(-1)}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors"
                        aria-label="Previous segment"
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (playingSegment === null) {
                            playSegmentAudio(0);
                          } else if (isAudioPaused) {
                            resumeAudio();
                          } else {
                            pauseAudio();
                          }
                        }}
                        className={clsx(
                          'w-9 h-9 rounded-full flex items-center justify-center transition-all',
                          playingSegment !== null && !isAudioPaused
                            ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/30 hover:bg-cyan-400'
                            : 'bg-c-elevated border border-c-border text-c-text hover:bg-c-hover hover:border-cyan-500/50'
                        )}
                        aria-label={playingSegment !== null && !isAudioPaused ? t('storyboard.pausePlayback') : t('storyboard.playAll')}
                      >
                        {playingSegment !== null && !isAudioPaused
                          ? <Pause className="w-4 h-4" />
                          : <Play className="w-4 h-4 ml-0.5" />
                        }
                      </button>
                      <button
                        onClick={() => skipSegment(1)}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors"
                        aria-label="Next segment"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Time display */}
                    <span className="text-[11px] font-mono text-c-muted tabular-nums w-20 text-center shrink-0">
                      {fmtTime(playheadTime ?? 0)} / {fmtTime(totalDuration)}
                    </span>

                    {/* Scrubber */}
                    <div
                      className="flex-1 h-6 flex items-center cursor-pointer group/scrub"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        seekToTime(pct * totalDuration);
                      }}
                    >
                      <div className="relative w-full h-1.5 bg-c-border rounded-full group-hover/scrub:h-2 transition-all">
                        {/* Progress fill */}
                        <div
                          className="absolute inset-y-0 left-0 bg-cyan-500 rounded-full transition-[width] duration-75"
                          style={{ width: `${totalDuration > 0 ? ((playheadTime ?? 0) / totalDuration) * 100 : 0}%` }}
                        />
                        {/* Scrub handle */}
                        {playheadTime !== null && (
                          <div
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-full shadow-md opacity-0 group-hover/scrub:opacity-100 transition-opacity"
                            style={{ left: `${(playheadTime / totalDuration) * 100}%` }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Segment indicator */}
                    <span className="text-[10px] text-c-dim shrink-0">
                      {playingSegment !== null
                        ? t('storyboard.segmentOf', { current: playingSegment + 1, total: segments.length })
                        : `${segments.length} ${t('storyboard.segments')}`
                      }
                    </span>

                    {/* Volume icon */}
                    <Volume2 className="w-3.5 h-3.5 text-c-dim shrink-0" />
                  </div>
                )}

                {/* Bulk motion controls */}
                {segments.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap border-t border-c-border pt-3">
                    <Move className="w-3.5 h-3.5 text-c-dim shrink-0" />
                    <span className="text-[10px] text-c-dim font-medium shrink-0">{t('storyboard.bulkMotion')}:</span>
                    <select
                      onChange={(e) => { if (e.target.value) setAllMotion(e.target.value as MotionEffect); }}
                      className="input text-[10px] py-0.5 w-24"
                      defaultValue=""
                    >
                      <option value="" disabled>{t('storyboard.motionAll')}</option>
                      {allEffects.map((fx) => (
                        <option key={fx} value={fx}>{t(`storyboard.motion${fx.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}` as any)}</option>
                      ))}
                    </select>
                    <button
                      onClick={randomizeMotion}
                      disabled={randomEffects.size === 0}
                      className="btn-ghost text-[10px] py-0.5 px-2 flex items-center gap-1 disabled:opacity-40"
                    >
                      <Shuffle className="w-3 h-3" /> {t('storyboard.randomize')}
                    </button>
                    <div className="hidden sm:flex items-center gap-1 ml-1 flex-wrap">
                      {allEffects.filter(fx => fx !== 'static').map((fx) => (
                        <label key={fx} className="flex items-center gap-0.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={randomEffects.has(fx)}
                            onChange={() => toggleRandomEffect(fx)}
                            className="w-2.5 h-2.5 rounded accent-cyan-500"
                          />
                          <span className="text-[9px] text-c-dim">{t(`storyboard.motion${fx.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}` as any)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Frame transition controls */}
                <div className="flex items-center gap-3 flex-wrap border-t border-c-border pt-3">
                  <Clock className="w-3.5 h-3.5 text-c-dim shrink-0" />
                  <span className="text-[10px] text-c-dim font-medium shrink-0">{t('storyboard.frameChange')}:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="frameTransition"
                      checked={frameTransition === 'voice'}
                      onChange={() => setFrameTransition('voice')}
                      className="w-3 h-3 accent-cyan-500"
                    />
                    <span className="text-[10px] text-c-text">{t('storyboard.onVoiceEnd')}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="frameTransition"
                      checked={frameTransition === 'hold'}
                      onChange={() => setFrameTransition('hold')}
                      className="w-3 h-3 accent-cyan-500"
                    />
                    <span className="text-[10px] text-c-text">{t('storyboard.holdAfterVoice')}</span>
                  </label>
                  {frameTransition === 'hold' && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-c-dim">{t('storyboard.holdTimeSec')}:</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={frameHoldTime}
                        onChange={(e) => setFrameHoldTime(Math.max(0, Math.min(10, parseFloat(e.target.value) || 0)))}
                        className="input text-[10px] w-14 py-0.5 font-mono text-center"
                      />
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleBuildTimeline}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> {t('storyboard.syncTimeline')}
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => { setStep('metadata'); saveProject({ currentStep: 'metadata' }); }}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                  >
                    {t('storyboard.stepMetadata')} <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleAssemble}
                    disabled={assembling || !segments.length}
                    className="btn-primary text-xs py-1.5 px-4 flex items-center gap-2 disabled:opacity-50"
                  >
                    {assembling ? <Spinner size="sm" /> : <Film className="w-4 h-4" />}
                    {t('storyboard.assemble')}
                  </button>
                </div>
              </div>

              {/* Empty state */}
              {segments.length === 0 && (
                <div className="text-center py-12 space-y-2">
                  <Clock className="w-10 h-10 mx-auto text-c-dim" />
                  <p className="text-sm text-c-dim">{t('storyboard.noSegments')}</p>
                </div>
              )}

              {/* Segment cards — drag & drop reorder */}
              <div className="max-h-[calc(100vh-340px)] overflow-y-auto space-y-2 pr-1">
                {segments.map((seg, i) => {
                  const dur = seg.endTime - seg.startTime;
                  const durPct = maxSegDuration > 0 ? (dur / maxSegDuration) * 100 : 0;
                  const isHovered = hoveredSegment === i;
                  const isDragOver = dragOverIdx === i && dragIdx !== i;
                  return (
                  <div
                    key={i}
                    ref={(el) => { segmentRefs.current[i] = el; }}
                    draggable
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragEnd={() => { dragAllowed.current = false; setDragIdx(null); setDragOverIdx(null); }}
                    onDrop={(e) => handleDrop(e, i)}
                    className={clsx(
                      'rounded-lg border bg-c-surface transition-all duration-150 group',
                      isDragOver ? 'border-cyan-400 border-dashed shadow-[0_0_16px_rgba(6,182,212,0.2)]' :
                      playingSegment === i ? 'border-cyan-500/60 shadow-[0_0_16px_rgba(6,182,212,0.15)]' :
                      isHovered ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.1)]' : 'border-c-border hover:border-cyan-800/40',
                      dragIdx === i && 'opacity-40',
                    )}
                    onMouseEnter={() => setHoveredSegment(i)}
                    onMouseLeave={() => setHoveredSegment(null)}
                  >
                    <div className="flex items-start gap-3 p-3">
                      {/* Index + drag handle */}
                      <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                        <span className={clsx(
                          'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors',
                          isHovered ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-c-bg text-c-dim border border-c-border'
                        )}>{i + 1}</span>
                        <div
                          className="cursor-grab active:cursor-grabbing p-1.5 -m-1 rounded hover:bg-c-hover transition-colors"
                          onMouseDown={() => { dragAllowed.current = true; }}
                          title={t('storyboard.dragToReorder')}
                        >
                          <GripVertical className="w-4 h-4 text-c-dim/50 hover:text-c-muted" />
                        </div>
                      </div>

                      {/* Thumbnail + audio play */}
                      {(() => {
                        const thumbIsVid = seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '');
                        const thumbVidSrc = seg.videoUrl || (thumbIsVid ? seg.imageUrl : '');
                        return (
                      <div className="shrink-0 relative">
                        <button
                          className="w-24 h-16 md:w-28 md:h-[4.5rem] rounded-md overflow-hidden relative group/thumb"
                          onClick={() => setLightboxUrl(thumbIsVid ? (thumbVidSrc || seg.imageUrl) : seg.imageUrl)}
                          aria-label={t('storyboard.segmentOf', { current: i + 1, total: segments.length })}
                        >
                          {thumbIsVid && thumbVidSrc ? (
                            <video src={`${thumbVidSrc}#t=0.1`} className="w-full h-full object-cover" muted preload="metadata" />
                          ) : (
                            <img src={seg.imageUrl} alt={seg.text || `Segment ${i + 1}`} className="w-full h-full object-cover" />
                          )}
                          {thumbIsVid && <div className="absolute top-0.5 right-0.5 bg-violet-600/80 rounded px-1 text-[7px] text-white z-10">VID</div>}
                          <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover/thumb:opacity-100">
                            <ZoomIn className="w-4 h-4 text-white drop-shadow" />
                          </div>
                        </button>
                        {audioFile && (
                          <button
                            onClick={() => playSegmentAudio(i)}
                            className={clsx(
                              'absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center shadow-md transition-all',
                              playingSegment === i
                                ? 'bg-cyan-500 text-white scale-110'
                                : 'bg-c-elevated border border-c-border text-c-muted hover:text-cyan-400 hover:border-cyan-500/50'
                            )}
                            aria-label={playingSegment === i ? t('storyboard.stopPreview') : t('storyboard.previewAudio')}
                          >
                            {playingSegment === i
                              ? <Pause className="w-3 h-3" />
                              : <Play className="w-3 h-3 ml-0.5" />
                            }
                          </button>
                        )}
                      </div>
                        );
                      })()}

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-2">
                        {/* Text */}
                        <div className="text-xs text-c-text leading-relaxed line-clamp-2" title={seg.text}>{seg.text || '—'}</div>

                        {/* Draggable duration bar — drag right edge to resize, auto-merges */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2.5 bg-c-bg rounded-full overflow-visible relative group/dur" ref={(el) => { if (el) el.dataset.segIdx = String(i); }}>
                            <div
                              className="h-full rounded-full relative"
                              style={{
                                width: `${durPct}%`,
                                background: `hsl(${(i * 30 + 200) % 360}, 55%, 50%)`,
                                minWidth: '12px',
                              }}
                            >
                              {/* Drag handle on right edge */}
                              <div
                                className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-6 cursor-col-resize flex items-center justify-center group/handle"
                                onMouseDown={(e) => {
                                  const bar = (e.currentTarget as HTMLElement).closest('[data-seg-idx]') as HTMLDivElement;
                                  if (bar) handleCardResizeStart(e, i, bar);
                                }}
                                title={t('storyboard.dragToResize')}
                              >
                                <div className="w-1.5 h-4 bg-white/30 group-hover/handle:bg-cyan-400 group-hover/handle:w-1.5 group-hover/handle:h-5 rounded-full transition-all shadow-sm" />
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] font-mono text-c-dim shrink-0 w-10 text-right">{dur.toFixed(1)}s</span>
                        </div>

                        {/* Controls row */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Time inputs — auto-merge when extended past neighbor */}
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={fmtTime(seg.startTime)}
                              onChange={(e) => updateSegmentTimeAutoMerge(i, 'startTime', parseTimeInput(e.target.value))}
                              className="input text-[10px] w-14 py-0.5 font-mono text-center"
                              aria-label={`${t('storyboard.start')} ${i + 1}`}
                            />
                            <span className="text-[10px] text-c-dim">–</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={fmtTime(seg.endTime)}
                              onChange={(e) => updateSegmentTimeAutoMerge(i, 'endTime', parseTimeInput(e.target.value))}
                              className="input text-[10px] w-14 py-0.5 font-mono text-center"
                              aria-label={`${t('storyboard.end')} ${i + 1}`}
                            />
                          </div>

                          {/* Motion select — disabled for video clips */}
                          {(seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '')) ? (
                            <span className="text-[10px] text-violet-400 flex items-center gap-1"><Video className="w-3 h-3" /> {t('storyboard.videoClip')}</span>
                          ) : (
                            <select
                              value={seg.motion || 'static'}
                              onChange={(e) => updateSegmentMotion(i, e.target.value as MotionEffect)}
                              className="input text-[10px] py-0.5 w-24 shrink-0"
                              aria-label={`${t('storyboard.motion')} ${i + 1}`}
                            >
                              <option value="static">{t('storyboard.motionStatic')}</option>
                              <option value="zoom-in">{t('storyboard.motionZoomIn')}</option>
                              <option value="zoom-out">{t('storyboard.motionZoomOut')}</option>
                              <option value="pan-left">{t('storyboard.motionPanLeft')}</option>
                              <option value="pan-right">{t('storyboard.motionPanRight')}</option>
                              <option value="pan-up">{t('storyboard.motionPanUp')}</option>
                              <option value="pan-down">{t('storyboard.motionPanDown')}</option>
                            </select>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

            </div>
            );
          })()}

          {/* STEP 6: METADATA */}
          {step === 'metadata' && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
                <Tag className="w-4 h-4 text-cyan-400" />
                {t('storyboard.stepMetadata')}
              </h3>

              {/* Stage prompt editor */}
              <StagePromptEditor
                label={`Stage 4: ${t('storyboard.stepMetadata')} — ${t('storyboard.stagePrompt')}`}
                stageParts={templateStageParts.metadata}
                value={metadataPrompt}
                onChange={setMetadataPrompt}
                onPartsChange={(parts) => setTemplateStageParts(p => ({ ...p, metadata: parts }))}
                onSave={() => handleSaveStagePrompt('metadata', metadataPrompt)}
                saving={savingPrompt === 'metadata'}
                t={t}
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={handleGenerateMetadata}
                  disabled={!scriptText.trim() || generatingMetadata}
                  className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  {generatingMetadata ? <Spinner size="sm" /> : <Wand2 className="w-3.5 h-3.5" />}
                  {generatingMetadata ? t('storyboard.generatingMetadata') : t('storyboard.generateMetadata')}
                </button>
                {metadataTitle && (
                  <span className="text-[10px] text-green-400 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> {t('storyboard.metadataDone')}
                  </span>
                )}
              </div>

              {/* Metadata fields */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('storyboard.metadataTitle')}</label>
                  <input
                    type="text"
                    value={metadataTitle}
                    onChange={(e) => setMetadataTitle(e.target.value)}
                    className="input text-sm w-full"
                    placeholder={t('storyboard.titlePlaceholder')}
                  />
                </div>
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('storyboard.metadataDescription')}</label>
                  <textarea
                    value={metadataDesc}
                    onChange={(e) => setMetadataDesc(e.target.value)}
                    rows={6}
                    className="input text-sm w-full resize-y min-h-[100px]"
                    placeholder={t('storyboard.descriptionPlaceholder')}
                  />
                </div>
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('storyboard.metadataTags')} ({metadataTags.length})</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {metadataTags.map((tag, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-cyan-900/30 text-cyan-300 px-2 py-0.5 rounded-full">
                        {tag}
                        <button onClick={() => setMetadataTags((prev) => prev.filter((_, j) => j !== i))} className="p-0.5 -m-0.5 hover:text-red-400 transition-colors" aria-label={`Remove tag ${tag}`}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder={t('storyboard.addTagPlaceholder')}
                    className="input text-sm w-full"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                        setMetadataTags((prev) => [...prev, (e.target as HTMLInputElement).value.trim()]);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                  />
                </div>
              </div>

              {/* Copy all metadata */}
              {metadataTitle && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const text = `Title: ${metadataTitle}\n\nDescription:\n${metadataDesc}\n\nTags: ${metadataTags.join(', ')}`;
                      navigator.clipboard.writeText(text);
                    }}
                    className="btn-secondary text-xs flex items-center gap-1.5"
                  >
                    <Copy className="w-3 h-3" /> {t('storyboard.copyAll')}
                  </button>
                  <button
                    onClick={() => { setStep('assemble'); saveProject({ currentStep: 'assemble' }); }}
                    className="btn-primary text-xs flex items-center gap-1"
                  >
                    {t('storyboard.assemble')} <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 7: ASSEMBLE */}
          {step === 'assemble' && (
            <div className="space-y-4">
              {!assembling && (
                <>
                  {/* Motion effect checkboxes + randomize */}
                  <div className="border border-c-border rounded-xl p-3 bg-c-surface space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-c-dim font-medium">{t('storyboard.motionEffects')}:</span>
                      {allEffects.map((fx) => (
                        <label key={fx} className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={randomEffects.has(fx)}
                            onChange={() => toggleRandomEffect(fx)}
                            className="w-3 h-3 rounded accent-cyan-500"
                          />
                          <span className="text-[10px] text-c-text">{t(`storyboard.motion${fx.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}` as any)}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="input text-xs">
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                      </select>
                      <button
                        onClick={randomizeMotion}
                        disabled={randomEffects.size === 0}
                        className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <RefreshCw className="w-3 h-3" /> {t('storyboard.randomize')}
                      </button>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-c-dim">{t('storyboard.motionAll')}:</span>
                        <select
                          onChange={(e) => setAllMotion(e.target.value as MotionEffect)}
                          className="input text-[10px] py-0.5"
                          defaultValue=""
                        >
                          <option value="" disabled>—</option>
                          {allEffects.map((fx) => (
                            <option key={fx} value={fx}>{t(`storyboard.motion${fx.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}` as any)}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={handleAssemble}
                        disabled={assembling || !segments.length}
                        className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50 ml-auto"
                      >
                        <Film className="w-3.5 h-3.5" />
                        {result ? t('storyboard.reAssemble') : t('storyboard.assemble')}
                      </button>
                    </div>
                  </div>

                  {/* Segment list with motion per clip */}
                  <div className="space-y-1.5 max-h-[400px] overflow-auto">
                    {segments.map((seg, i) => (
                      <div key={i} className="flex items-center gap-2 border border-c-border rounded-lg bg-c-surface p-1.5">
                        {(() => {
                          const segIsVid = seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '');
                          const vidSrc = seg.videoUrl || (segIsVid ? seg.imageUrl : '');
                          return (
                          <div className="w-14 h-10 shrink-0 rounded overflow-hidden relative cursor-pointer group" onClick={() => !segIsVid && setLightboxUrl(seg.imageUrl)}>
                            {segIsVid && vidSrc ? (
                              <video src={`${vidSrc}#t=0.1`} className="w-full h-full object-cover" muted preload="metadata" />
                            ) : (
                              <img src={seg.imageUrl} alt={seg.text || `Segment ${i + 1}`} className="w-full h-full object-cover" />
                            )}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                            <div className="absolute top-0 left-0 bg-black/60 rounded-br px-1 text-[8px] font-mono text-white">{i + 1}</div>
                            {segIsVid && <div className="absolute bottom-0 right-0 bg-violet-600/80 rounded-tl px-1 text-[7px] text-white">VID</div>}
                          </div>
                          );
                        })()}
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-c-text truncate">{seg.text || '—'}</div>
                          <div className="text-[9px] text-c-dim">{seg.startTime.toFixed(1)}s → {seg.endTime.toFixed(1)}s</div>
                        </div>
                        {(seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '')) ? (
                          <span className="text-[10px] text-violet-400 flex items-center gap-1"><Video className="w-3 h-3" /></span>
                        ) : (
                          <select
                            value={seg.motion || 'static'}
                            onChange={(e) => updateSegmentMotion(i, e.target.value as MotionEffect)}
                            className="input text-[10px] py-0.5 w-24"
                          >
                            <option value="static">{t('storyboard.motionStatic')}</option>
                            <option value="zoom-in">{t('storyboard.motionZoomIn')}</option>
                            <option value="zoom-out">{t('storyboard.motionZoomOut')}</option>
                            <option value="pan-left">{t('storyboard.motionPanLeft')}</option>
                            <option value="pan-right">{t('storyboard.motionPanRight')}</option>
                            <option value="pan-up">{t('storyboard.motionPanUp')}</option>
                            <option value="pan-down">{t('storyboard.motionPanDown')}</option>
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {assembling && (
                <div className="border border-cyan-800/30 rounded-xl p-4 bg-cyan-900/10 space-y-3">
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <span className="text-xs text-cyan-300 font-medium">{t('storyboard.assembling')}</span>
                    {assembleStep && (
                      <span className="text-[10px] text-cyan-400/70 ml-auto capitalize">{assembleStep}</span>
                    )}
                  </div>
                  {assembleClipProgress.total > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-c-dim">
                        <span>{t('storyboard.encodingClip', { current: assembleClipProgress.current, total: assembleClipProgress.total })}</span>
                        <span>{Math.round((assembleClipProgress.current / assembleClipProgress.total) * 100)}%</span>
                      </div>
                      <div className="w-full bg-cyan-900/30 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-cyan-400 rounded-full transition-all duration-300"
                          style={{ width: `${(assembleClipProgress.current / assembleClipProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div ref={assembleLogRef} className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[160px] overflow-auto">
                    {assembleProgress.map((line, i) => (
                      <div key={i} className={i === assembleProgress.length - 1 ? 'text-cyan-300' : ''}>{line}</div>
                    ))}
                  </div>
                </div>
              )}

              {result && !assembling && (
                <div className="space-y-4">
                  <div className="border border-green-800/30 rounded-xl p-3 bg-green-900/10 flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-c-text">{t('storyboard.done')}</div>
                      <div className="text-xs text-c-dim">{result.sizeKB > 0 ? `${result.sizeKB} KB | ` : ''}{result.duration > 0 ? `${result.duration.toFixed(1)}s` : ''}</div>
                    </div>
                    <a href={result.url} download={`${(metadataTitle || scriptTopic || projectName || 'video').replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_')}.mp4`} className="btn-primary text-xs flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5" /> {t('common.download')}
                    </a>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-c-border bg-black">
                    <video ref={videoRef} src={result.url} controls className="w-full max-h-[500px]" />
                  </div>
                  {metadataTitle && (
                    <div className="border border-c-border rounded-xl overflow-hidden bg-c-surface">
                      <div className="px-4 py-2 border-b border-c-border bg-c-bg flex items-center justify-between">
                        <span className="text-xs font-medium text-c-text flex items-center gap-1.5">
                          <Tag className="w-3.5 h-3.5 text-orange-400" /> {t('storyboard.stepMetadata')}
                        </span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(`${metadataTitle}\n\n${metadataDesc}\n\n${metadataTags.join(', ')}`); }}
                          className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> {t('storyboard.copyAll')}
                        </button>
                      </div>
                      <div className="p-4 space-y-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-c-dim uppercase">{t('storyboard.metadataTitle')}</span>
                            <button onClick={() => navigator.clipboard.writeText(metadataTitle)} className="p-1 -m-1 text-c-dim hover:text-cyan-400" aria-label={t('storyboard.copyAll')}><Copy className="w-3.5 h-3.5" /></button>
                          </div>
                          <div className="text-sm font-medium text-c-text">{metadataTitle}</div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-c-dim uppercase">{t('storyboard.metadataDescription')}</span>
                            <button onClick={() => navigator.clipboard.writeText(metadataDesc)} className="p-1 -m-1 text-c-dim hover:text-cyan-400" aria-label={t('storyboard.copyAll')}><Copy className="w-3.5 h-3.5" /></button>
                          </div>
                          <div className="text-[11px] text-c-muted whitespace-pre-wrap leading-relaxed">{metadataDesc}</div>
                        </div>
                        {metadataTags.length > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] text-c-dim uppercase">{t('storyboard.metadataTags')}</span>
                              <button onClick={() => navigator.clipboard.writeText(metadataTags.join(', '))} className="p-1 -m-1 text-c-dim hover:text-cyan-400" aria-label={t('storyboard.copyAll')}><Copy className="w-3.5 h-3.5" /></button>
                            </div>
                            <div className="flex flex-wrap gap-1 cursor-pointer group/tags" onClick={() => navigator.clipboard.writeText(metadataTags.join(', '))} title="Click to copy all tags">
                              {metadataTags.map((tag, i) => (
                                <span key={i} className="text-[9px] bg-cyan-900/30 text-cyan-300/80 px-2 py-0.5 rounded-full group-hover/tags:bg-cyan-800/40 group-hover/tags:text-cyan-200 transition-colors">{tag}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="border border-c-border rounded-xl overflow-hidden bg-c-surface">
                    <div className="px-4 py-2 border-b border-c-border bg-c-bg">
                      <span className="text-xs font-medium text-c-text flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-emerald-400" /> {t('storyboard.projectSummary')}
                      </span>
                    </div>
                    <div className="p-4 space-y-3">
                      {scriptTopic && (
                        <div>
                          <span className="text-[10px] text-c-dim uppercase block mb-0.5">{t('storyboard.selectedTopic')}</span>
                          <div className="text-xs text-c-text">{scriptTopic}</div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-4">
                        {audioFile && (
                          <div>
                            <span className="text-[10px] text-c-dim uppercase block mb-0.5">{t('storyboard.stepAudio')}</span>
                            <div className="text-xs text-c-text flex items-center gap-1"><Mic className="w-3 h-3 text-amber-400" /> {audioFile.duration.toFixed(1)}s — {voice}</div>
                          </div>
                        )}
                        <div>
                          <span className="text-[10px] text-c-dim uppercase block mb-0.5">{t('storyboard.stepImages')}</span>
                          <div className="text-xs text-c-text flex items-center gap-1"><Image className="w-3 h-3 text-cyan-400" /> {generatedImages.filter(i => i.status === 'done').length} {t('storyboard.images')}</div>
                        </div>
                        <div>
                          <span className="text-[10px] text-c-dim uppercase block mb-0.5">{t('storyboard.stepTimeline')}</span>
                          <div className="text-xs text-c-text flex items-center gap-1"><Clock className="w-3 h-3 text-rose-400" /> {segments.length} {t('storyboard.segments')}</div>
                        </div>
                      </div>
                      {scriptText && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-c-dim uppercase">{t('storyboard.stepScript')}</span>
                            <button onClick={() => navigator.clipboard.writeText(scriptText)} className="p-1 -m-1 text-c-dim hover:text-cyan-400" aria-label={t('storyboard.copyAll')}><Copy className="w-3.5 h-3.5" /></button>
                          </div>
                          <div className="text-[11px] text-c-muted whitespace-pre-wrap leading-relaxed max-h-[150px] overflow-auto">{scriptText}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="border border-red-800/30 rounded-xl p-3 bg-red-900/10 text-sm text-red-300 flex items-center gap-2">
              <X className="w-4 h-4 shrink-0" />
              {error}
              <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="w-3 h-3" /></button>
            </div>
          )}

        </div>
      </div>

      {/* Lightbox modal */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center animate-in fade-in duration-200"
          onClick={() => setLightboxUrl(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setLightboxUrl(null); }}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors"
            aria-label="Close preview"
            autoFocus
          >
            <X className="w-6 h-6" />
          </button>
          {/\.(mp4|webm|mov)(\?|$)/i.test(lightboxUrl) ? (
            <video src={lightboxUrl} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" controls autoPlay onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={lightboxUrl} alt="Preview" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          )}
          <div className="absolute bottom-4 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = lightboxUrl; a.download = lightboxUrl.split('/').pop() || (/\.(mp4|webm|mov)/i.test(lightboxUrl) ? 'video.mp4' : 'image.png'); a.click(); }}
              className="px-3 py-2 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> {t('common.download')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
