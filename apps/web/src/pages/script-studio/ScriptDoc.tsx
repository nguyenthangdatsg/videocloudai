import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, ChevronDown, ChevronUp, AlertTriangle, Info, Check,
  Play, Loader2, BarChart2, Video, Mic, Settings, RefreshCw, X,
  Volume2, Film, Square, ChevronRight, ChevronLeft, Pencil, Music2,
  List, Rows3, Wand2, Zap, FileText, ExternalLink, Sparkles, Scissors, Plus, Trash2, Image, Upload, Columns, Maximize2, Merge, Type as TypeIcon, Copy,
} from 'lucide-react';
import { scriptStudioApi, queueApi, ttsApi, musicApi, type SubtitleStyle } from '../../lib/api';
import { useAppStore } from '../../store';
import { SubtitlePanel } from '../storyboard/components/SubtitlePanel';

// ── Types ──

interface ScriptBlock {
  id: string;
  blockIndex: number;
  segmentIndex: number;
  segmentName: string;
  sceneNumber: number;
  narration: string;
  pexelsQuery: string | null;
  chartSpec: any | null;
  overlays: string[];
  overlayStyle: {
    color?: string;
    bgEnabled?: boolean;
    bgColor?: string;
    bgOpacity?: number;
    fontSize?: 'sm' | 'md' | 'lg' | 'xl';
    position?: 'center' | 'top' | 'bottom';
  } | null;
  paceHint: 'slow' | 'fast' | null;
  contentHash: string | null;
  audioPath: string | null;
  audioDurationMs: number | null;
  audioEngine: string | null;
  words: Array<{ word: string; offset_ms: number; duration_ms: number }> | null;
  visualType: string;
  clipAssetPath: string | null;
  clips: Array<{ assetPath: string; startSec: number; endSec: number | null; sourceDurationSec?: number; label?: string }>;
  clipsJson: string | null;
  motion: string;
  renderedClipPath: string | null;
  status: 'pending' | 'audio_ready' | 'clip_ready' | 'rendered' | 'error';
  errorMsg: string | null;
  aiPrompt: string | null;
  aiAssetPath: string | null;
  voiceConfig: string | null;
  clipStartSec: number | null;
  clipEndSec: number | null;
  displayNumber: number | null;
  openingText: string | null;
}

interface LogEntry { ts: string; level: string; message: string; operation?: string; }

const STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-gray-500/15 text-gray-400',
  parsed: 'bg-blue-500/15 text-blue-400',
  narration_copied: 'bg-indigo-500/15 text-indigo-400',
  aligned: 'bg-purple-500/15 text-purple-400',
  producing: 'bg-orange-500/15 text-orange-400',
  ready: 'bg-green-500/15 text-green-400',
  published: 'bg-emerald-500/15 text-emerald-400',
};

const MOTION_EFFECTS = ['static', 'slow-zoom', 'ken-burns-in', 'ken-burns-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'];

// ── Step Indicator ──

function StepIndicator({ step, totalBlocks, audioReady, rendered, isProducing, hasResult, onStepClick, settingsOpen, onToggleSettings, missingClips }: {
  step: 1 | 2 | 3 | 4;
  totalBlocks: number;
  audioReady: number;
  rendered: number;
  isProducing: boolean;
  hasResult: boolean;
  onStepClick: (s: 1 | 2 | 3 | 4) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  missingClips: number;
}) {
  const steps = [
    { num: 1 as const, label: 'Structure', sublabel: `${totalBlocks} blocks`, enabled: true },
    { num: 2 as const, label: 'Review', sublabel: missingClips > 0 ? `${missingClips} missing clips` : `${totalBlocks} ready`, enabled: true },
    { num: 3 as const, label: 'Produce', sublabel: isProducing ? `${rendered}/${totalBlocks} rendered` : rendered > 0 ? `${rendered}/${totalBlocks} done` : 'generate video', enabled: true },
    { num: 4 as const, label: 'Result', sublabel: hasResult ? 'video ready' : 'pending', enabled: hasResult },
  ];

  return (
    <div className="flex items-center gap-0 px-4 py-3 border-b border-c-border bg-c-surface shrink-0">
      {steps.map((s, i) => {
        const isActive = step === s.num;
        const isDone = (step > s.num && s.num < 3) || (s.num === 3 && hasResult && step !== 3);
        return (
          <div key={s.num} className="flex items-center">
            <button
              className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-all ${
                isActive ? 'bg-c-accent/10' : s.enabled ? 'hover:bg-c-elevated cursor-pointer' : 'opacity-40 cursor-default'
              }`}
              onClick={() => s.enabled && onStepClick(s.num)}
              disabled={!s.enabled}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all ${
                isDone
                  ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                  : isActive
                    ? 'bg-c-accent text-white'
                    : 'bg-c-elevated text-c-dim border border-c-border'
              }`}>
                {isDone ? <Check className="w-3 h-3" /> : s.num}
              </div>
              <div className="hidden sm:block">
                <p className={`text-xs font-semibold leading-tight ${isActive ? 'text-c-text' : isDone ? 'text-green-400' : s.enabled ? 'text-c-muted' : 'text-c-dim'}`}>
                  {s.label}
                </p>
                <p className={`text-xs leading-tight ${s.num === 3 && hasResult ? 'text-green-400' : 'text-c-dim'}`}>{s.sublabel}</p>
              </div>
            </button>
            {i < steps.length - 1 && (
              <ChevronRight className={`w-4 h-4 shrink-0 mx-1 ${step > s.num ? 'text-green-400/50' : 'text-c-border'}`} />
            )}
          </div>
        );
      })}

      {/* Progress pills + Settings gear */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-c-dim hidden md:block">
          <span className={audioReady === totalBlocks && totalBlocks > 0 ? 'text-blue-400' : 'text-c-dim'}>
            {audioReady}/{totalBlocks}
          </span>
          {' '}audio
        </span>
        <span className="text-xs text-c-dim hidden md:block">·</span>
        <span className="text-xs text-c-dim hidden md:block">
          <span className={rendered === totalBlocks && totalBlocks > 0 ? 'text-green-400' : 'text-c-dim'}>
            {rendered}/{totalBlocks}
          </span>
          {' '}rendered
        </span>
        <button
          className={`ml-1 p-1.5 rounded-lg border transition-all cursor-pointer ${
            settingsOpen
              ? 'bg-c-accent/15 border-c-accent/40 text-c-accent'
              : 'bg-c-elevated border-c-border text-c-muted hover:text-c-text hover:border-c-border-hover'
          }`}
          onClick={onToggleSettings}
          title="Produce Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Block Status Pipeline ──

function BlockStatusPipeline({ status }: { status: ScriptBlock['status'] }) {
  const stages = ['pending', 'audio_ready', 'clip_ready', 'rendered'] as const;
  const stageIdx = stages.indexOf(status as any);

  const stageInfo = [
    { icon: <Mic className="w-2.5 h-2.5" />, label: 'Audio', color: 'bg-blue-500' },
    { icon: <Video className="w-2.5 h-2.5" />, label: 'Clip', color: 'bg-purple-500' },
    { icon: <Film className="w-2.5 h-2.5" />, label: 'Render', color: 'bg-green-500' },
  ];

  if (status === 'error') {
    return (
      <div className="flex items-center gap-1">
        <AlertTriangle className="w-3 h-3 text-red-400" />
        <span className="text-xs text-red-400">error</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {stageInfo.map((stage, i) => {
        const done = stageIdx > i;
        const active = stageIdx === i + 1;
        return (
          <div
            key={i}
            className={`flex items-center justify-center w-4 h-4 rounded-sm transition-all ${
              done ? stage.color : active ? `${stage.color} opacity-60` : 'bg-c-elevated'
            }`}
            title={stage.label}
          >
            <span className={done || active ? 'text-white' : 'text-c-dim'}>
              {stage.icon}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Activity Log ──

function ActivityLog({ logs, expanded, onToggle, onClear }: {
  logs: LogEntry[];
  expanded: boolean;
  onToggle: () => void;
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, expanded]);

  const levelIcon = (level: string) => {
    if (level === 'warn') return <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />;
    if (level === 'error') return <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />;
    if (level === 'success') return <Check className="w-3 h-3 text-green-400 shrink-0" />;
    return <Info className="w-3 h-3 text-blue-400 shrink-0" />;
  };

  return (
    <div className="border-t border-c-border bg-c-surface shrink-0">
      <div className="flex items-center px-4 py-2.5">
        <button
          className="flex-1 flex items-center gap-2 text-sm font-medium text-c-muted hover:text-c-text transition-colors cursor-pointer"
          onClick={onToggle}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          {t('scriptStudio.activityLog')} ({logs.length})
        </button>
        {expanded && logs.length > 0 && onClear && (
          <button
            className="text-xs text-c-dim hover:text-c-text px-2 py-1 rounded hover:bg-c-elevated transition-colors cursor-pointer"
            onClick={onClear}
          >
            {t('scriptStudio.clearLogs')}
          </button>
        )}
      </div>
      {expanded && (
        <div ref={scrollRef} className="h-44 overflow-y-auto px-4 pb-3 font-mono text-xs space-y-0.5">
          {logs.length === 0 && <p className="text-c-dim py-3">{t('scriptStudio.noLogs')}</p>}
          {logs.map((log, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className="text-c-dim whitespace-nowrap shrink-0">{new Date(log.ts).toLocaleTimeString()}</span>
              {levelIcon(log.level)}
              <span className="text-c-text">{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Mirror of server-side buildFlowPrompt — used to pre-fill the AI prompt textarea. */
function autoFlowPrompt(block: ScriptBlock, orientation: 'landscape' | 'portrait'): string {
  const parts: string[] = [];
  if (block.narration?.trim()) parts.push(block.narration.trim());
  if (block.pexelsQuery?.trim()) parts.push(block.pexelsQuery.trim());
  if (block.segmentName && !/^segment\s+\d+$/i.test(block.segmentName)) {
    parts.push(block.segmentName);
  }
  const base = parts.join('. ').replace(/\.\.\s*/g, '. ').trim();
  const aspect = orientation === 'portrait' ? '9:16 vertical portrait' : '16:9 widescreen';
  return `${base} — documentary realism, natural lighting, ${aspect}, no text, no captions, no logos`;
}

// ── Block Step Editor (one-by-one preview + edit) ──

function BlockStepEditor({ blocks, docId, orientation, onBlockUpdated, initialIdx = 0, ttsEngine, onTtsEngineChange, voice, rate }: {
  blocks: ScriptBlock[];
  docId: string;
  orientation: 'landscape' | 'portrait';
  onBlockUpdated: () => void;
  initialIdx?: number;
  ttsEngine: 'omnivoice' | 'edge-tts';
  onTtsEngineChange: (engine: 'omnivoice' | 'edge-tts') => void;
  voice?: string;
  rate?: string;
}) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(initialIdx);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [fetchingPexels, setFetchingPexels] = useState(false);
  const [fetchingPixabay, setFetchingPixabay] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [generatingTts, setGeneratingTts] = useState(false);
  const [ttsAllRunning, setTtsAllRunning] = useState(false);
  const [ttsAllProgress, setTtsAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [actionLog, setActionLog] = useState<{ level: string; msg: string }[]>([]);

  // Stock picker state
  const [showPexelsPicker, setShowPexelsPicker] = useState(false);
  const [remotionRendering, setRemotionRendering] = useState(false);
  const [pickerService, setPickerService] = useState<'pexels' | 'pixabay' | 'mixkit' | 'images'>('pexels');
  const [pickerOrientation, setPickerOrientation] = useState<'landscape' | 'portrait'>(orientation);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerCandidates, setPickerCandidates] = useState<Array<{
    id: number; thumbnail: string; previewUrl?: string | null;
    downloadUrl?: string; duration: number; width: number; height: number;
    pageUrl?: string; title?: string; source?: string;
  }>>([]);
  const [loadingPicker, setLoadingPicker] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [applyingPexelsId, setApplyingPexelsId] = useState<number | null>(null);
  const [regenningQuery, setRegenningQuery] = useState(false);
  const [imageZoomEffect, setImageZoomEffect] = useState<'zoom-in' | 'zoom-out'>('zoom-in');
  const [pastingImage, setPastingImage] = useState(false);
  // Split screen state
  const [showSplitPanel, setShowSplitPanel] = useState(false);
  const [splitRendering, setSplitRendering] = useState(false);
  const [splitLeftClip, setSplitLeftClip] = useState('');
  const [splitRightClip, setSplitRightClip] = useState('');
  const [splitMiddleText, setSplitMiddleText] = useState('VS');
  const [splitMiddleStyle, setSplitMiddleStyle] = useState<'vs' | 'line' | 'glow' | 'badge' | 'fire' | 'neon' | 'slash' | 'clean' | 'none'>('vs');
  const [splitAccentColor, setSplitAccentColor] = useState('#7c6af5');
  const [splitLeftLabel, setSplitLeftLabel] = useState('');
  const [splitRightLabel, setSplitRightLabel] = useState('');
  const [splitLabelPosition, setSplitLabelPosition] = useState<'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'>('top-center');
  const [splitRightLabelPosition, setSplitRightLabelPosition] = useState<'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'>('top-center');
  const [splitLabelStyle, setSplitLabelStyle] = useState<'badge' | 'outline' | 'shadow' | 'banner'>('badge');
  const [splitLabelFontSize, setSplitLabelFontSize] = useState(28);
  // Split stock search per side
  const [splitSearchSide, setSplitSearchSide] = useState<'left' | 'right' | null>(null);
  const [splitSearchService, setSplitSearchService] = useState<'pexels' | 'pixabay' | 'mixkit'>('pexels');
  const [splitSearchOrientation, setSplitSearchOrientation] = useState<'landscape' | 'portrait'>(orientation === 'portrait' ? 'landscape' : 'portrait');
  const [splitSearchQuery, setSplitSearchQuery] = useState('');
  const [splitSearchResults, setSplitSearchResults] = useState<Array<{ id: number; thumbnail: string; previewUrl?: string | null; downloadUrl?: string; duration: number; width: number; height: number; pageUrl?: string; title?: string }>>([]);
  const [splitSearchLoading, setSplitSearchLoading] = useState(false);
  const [splitDownloading, setSplitDownloading] = useState<number | null>(null);
  // Lightbox state
  const [lightbox, setLightbox] = useState<{ type: 'video' | 'image'; src: string; title?: string } | null>(null);
  const [trimStart, setTrimStart] = useState<string>('');
  const [trimEnd, setTrimEnd] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const clampedIdx = Math.min(idx, blocks.length - 1);
  const block = blocks[clampedIdx];
  const [audioElDuration, setAudioElDuration] = useState<number | null>(null);
  const [audioTime, setAudioTime] = useState(0);
  const [activeClipIdx, setActiveClipIdx] = useState(0);
  // Per-clip source durations (loaded from video metadata or stored in clip)
  const [clipSourceDurations, setClipSourceDurations] = useState<Record<string, number>>({});
  // Which trim handle is being dragged: null | { clipIdx, edge: 'start'|'end' }
  const [trimDrag, setTrimDrag] = useState<{ clipIdx: number; edge: 'start' | 'end' } | null>(null);
  const [narrationExpanded, setNarrationExpanded] = useState(false);
  const [playerCollapsed, setPlayerCollapsed] = useState(false);
  // Draggable audio range on the main player timeline
  const [audioRangeDragStart, setAudioRangeDragStart] = useState<number | null>(null);
  const audioRangeDragOffsetRef = useRef(0);

  // Multi-clip support: use clips array, fall back to legacy single clipAssetPath
  const blockClips = block?.clipsJson === '[]'
    ? []
    : (block?.clips?.length > 0
      ? block.clips
      : (block?.clipAssetPath ? [{ assetPath: block.clipAssetPath, startSec: block.clipStartSec ?? 0, endSec: block.clipEndSec, sourceDurationSec: block.audioDurationMs ? block.audioDurationMs / 1000 : undefined }] : []));
  const safeClipIdx = Math.min(activeClipIdx, Math.max(0, blockClips.length - 1));
  const activeClip = blockClips[safeClipIdx] ?? null;

  // Compute per-clip effective durations and total timeline
  const clipEffDurations = blockClips.map((c, i) => {
    const srcDur = c.sourceDurationSec ?? clipSourceDurations[c.assetPath] ?? videoDuration ?? null;
    const start = c.startSec ?? 0;
    const end = c.endSec ?? srcDur;
    return end != null ? Math.max(0, end - start) : (srcDur != null ? srcDur - start : 0);
  });
  const totalClipsDuration = clipEffDurations.reduce((a, b) => a + b, 0);
  // Cumulative start offsets on the unified timeline
  const clipTimelineOffsets = clipEffDurations.reduce<number[]>((acc, d, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + clipEffDurations[i - 1]);
    return acc;
  }, []);

  // Map a unified timeline position to { clipIdx, localSeekTime }
  const timelineToClip = useCallback((pos: number) => {
    let acc = 0;
    for (let i = 0; i < blockClips.length; i++) {
      if (pos < acc + clipEffDurations[i]) {
        return { clipIdx: i, localTime: blockClips[i].startSec + (pos - acc) };
      }
      acc += clipEffDurations[i];
    }
    const last = blockClips.length - 1;
    return { clipIdx: Math.max(0, last), localTime: (blockClips[last]?.endSec ?? blockClips[last]?.startSec ?? 0) };
  }, [blockClips, clipEffDurations]);

  const getRenderedUrl = (absolutePath: string | null | undefined): string | null => {
    if (!absolutePath) return null;
    const cleanPath = absolutePath.replace(/\\/g, '/');
    const index = cleanPath.indexOf('/renders/');
    if (index !== -1) return cleanPath.substring(index);
    const rIndex = cleanPath.indexOf('renders/');
    if (rIndex !== -1) return '/' + cleanPath.substring(rIndex);
    const cIndex = cleanPath.indexOf('/cache/');
    if (cIndex !== -1) return cleanPath.substring(cIndex);
    const cIndex2 = cleanPath.indexOf('cache/');
    if (cIndex2 !== -1) return '/' + cleanPath.substring(cIndex2);
    return null;
  };

  const renderedUrl = getRenderedUrl(block?.renderedClipPath);

  // Computed playback values
  const effectiveClipStart = renderedUrl ? 0 : (activeClip?.startSec ?? (block?.clipStartSec ?? 0));
  const audioDurSec = (block?.audioDurationMs && block.audioDurationMs > 0) ? block.audioDurationMs / 1000 : null;
  const playDurSec = totalClipsDuration > 0
    ? totalClipsDuration
    : (audioDurSec ?? audioElDuration ?? (videoDuration != null ? videoDuration - effectiveClipStart : null));

  // Stop playback and auto-open stock picker when block changes
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setVideoDuration(null);
    setAudioElDuration(null);
    setAudioTime(0);
    setActiveClipIdx(0);
    setClipSourceDurations({});
    setTrimDrag(null);
    setPickerCandidates([]);
    setPickerError(null);
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    // Sync trim inputs from block data
    const b = blocks[clampedIdx];
    setTrimStart(b?.clipStartSec != null ? String(b.clipStartSec) : '');
    setTrimEnd(b?.clipEndSec != null ? String(b.clipEndSec) : '');
    // Auto-open Pexels picker for every block, close split panel
    setPickerService('pexels');
    setPickerOrientation(orientation);
    setShowPexelsPicker(true);
    setShowSplitPanel(false);
    // Seek video to clipStartSec without auto-playing
    setTimeout(() => {
      if (videoRef.current) {
        const cs = b?.clipStartSec ?? 0;
        videoRef.current.currentTime = cs;
      }
    }, 150);
  }, [clampedIdx]);

  // Auto-fetch Pexels stock when navigating to a new block
  useEffect(() => {
    const currentBlock = blocks[clampedIdx];
    if (!currentBlock) return;
    const q = currentBlock.pexelsQuery || currentBlock.narration.split(/\s+/).slice(0, 5).join(' ');
    if (!q) return;
    setPickerQuery(q);
    fetchPickerCandidates('pexels', q, orientation);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedIdx]);

  // Auto-generate TTS when navigating to a block without audio, or when voice/rate/engine changes
  useEffect(() => {
    const currentBlock = blocks[clampedIdx];
    if (!currentBlock || !currentBlock.narration?.trim()) return;
    let cancelled = false;
    setGeneratingTts(true);
    scriptStudioApi.ttsBlock(docId, currentBlock.blockIndex, { engine: ttsEngine, voice, rate }).then((data: any) => {
      if (cancelled) return;
      if (!data.cached) {
        const eng = data.engine ? ` [${data.engine}]` : '';
        setActionLog([{ level: 'success', msg: `TTS ready (${(data.audioDurationMs / 1000).toFixed(1)}s)${eng}` }]);
        onBlockUpdated();
      }
    }).catch((err) => {
      if (cancelled) return;
      setActionLog([{ level: 'error', msg: `TTS failed: ${err.message ?? 'unknown'}` }]);
    }).finally(() => {
      if (!cancelled) setGeneratingTts(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedIdx, docId, voice, rate, ttsEngine]);

  // Stop audio when it ends
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnd = () => { setPlaying(false); if (videoRef.current) videoRef.current.pause(); };
    audio.addEventListener('ended', onEnd);
    return () => audio.removeEventListener('ended', onEnd);
  }, []);

  // Seek the video player to the right clip + local time for a given timeline position
  const seekToTimeline = useCallback((pos: number) => {
    if (blockClips.length === 0) return;
    const { clipIdx, localTime } = timelineToClip(pos);
    const clip = blockClips[clipIdx];
    if (!clip) return;
    const video = videoRef.current;
    // Switch source if clip changed
    if (clipIdx !== safeClipIdx) {
      setActiveClipIdx(clipIdx);
      // Source will update via React; seek after load
      setTimeout(() => {
        if (videoRef.current) videoRef.current.currentTime = localTime;
      }, 50);
    } else if (video) {
      video.currentTime = localTime;
    }
    setCurrentTime(pos);
  }, [blockClips, timelineToClip, safeClipIdx]);

  // Track current playback time via requestAnimationFrame (multi-clip aware)
  useEffect(() => {
    const tick = () => {
      const video = videoRef.current;
      const audio = audioRef.current;
      const dur = playDurSec;

      // Always track audio time independently
      if (audio && audio.readyState >= 1 && !audio.paused) {
        setAudioTime(audio.currentTime);
      }

      if (dur && dur > 0) {
        // Compute timeline position from active clip's video time
        let timelinePos = currentTime;
        if (video && video.readyState >= 1 && blockClips.length > 0) {
          const localElapsed = video.currentTime - (blockClips[safeClipIdx]?.startSec ?? 0);
          timelinePos = (clipTimelineOffsets[safeClipIdx] ?? 0) + Math.max(0, localElapsed);
        } else if (audio && audio.readyState >= 1 && blockClips.length === 0) {
          timelinePos = audio.currentTime;
        }
        timelinePos = Math.max(0, Math.min(timelinePos, dur));
        setCurrentTime(timelinePos);

        // Check if current clip ended → advance to next or stop
        if (video && blockClips.length > 0) {
          const clipDur = clipEffDurations[safeClipIdx] ?? 0;
          const localElapsed = video.currentTime - (blockClips[safeClipIdx]?.startSec ?? 0);
          if (clipDur > 0.1 && localElapsed >= clipDur - 0.05) {
            const nextIdx = safeClipIdx + 1;
            if (nextIdx < blockClips.length) {
              // Advance to next clip
              setActiveClipIdx(nextIdx);
              setTimeout(() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = blockClips[nextIdx].startSec;
                  videoRef.current.play().catch(() => {});
                }
              }, 50);
            } else {
              // End of all clips
              video.pause();
              audio?.pause();
              setPlaying(false);
              setCurrentTime(0);
              setActiveClipIdx(0);
              setTimeout(() => { if (videoRef.current) videoRef.current.currentTime = blockClips[0]?.startSec ?? 0; }, 50);
            }
          }
        }
        // Audio-only: stop at end
        if (blockClips.length === 0 && audio && timelinePos >= dur - 0.05) {
          audio.pause();
          setPlaying(false);
          audio.currentTime = 0;
          setCurrentTime(0);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    if (playing) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, playDurSec, safeClipIdx, blockClips, clipEffDurations, clipTimelineOffsets, currentTime]);

  // Scrub on the playback progress bar
  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubBarRef.current || !playDurSec) return;
    const rect = scrubBarRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = fraction * playDurSec;
    if (blockClips.length > 0) {
      seekToTimeline(seekTime);
    } else {
      if (audioRef.current) audioRef.current.currentTime = seekTime;
      setCurrentTime(seekTime);
    }
  };

  const handleScrubDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    handleScrub(e);
  };

  // Timeline trim: drag clip edges to adjust startSec / endSec
  // We accumulate changes in a ref during drag, only save on mouseup
  const trimPendingRef = useRef<{ clipIdx: number; startSec: number; endSec: number | null } | null>(null);

  useEffect(() => {
    if (!trimDrag) return;
    const { clipIdx, edge } = trimDrag;
    const clip = blockClips[clipIdx];
    if (!clip) { setTrimDrag(null); return; }
    const srcDur = clip.sourceDurationSec ?? clipSourceDurations[clip.assetPath] ?? null;
    if (srcDur == null) { setTrimDrag(null); return; }

    const onMove = (e: MouseEvent) => {
      if (!timelineRef.current || totalClipsDuration <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const timelinePos = frac * totalClipsDuration;
      const clipOffset = clipTimelineOffsets[clipIdx] ?? 0;
      const localPos = timelinePos - clipOffset; // position within this clip's span

      let newStart = clip.startSec;
      let newEnd = clip.endSec ?? srcDur;
      if (edge === 'start') {
        newStart = Math.max(0, Math.min(newEnd - 0.2, clip.startSec + localPos));
      } else {
        newEnd = Math.max(clip.startSec + 0.2, Math.min(srcDur, clip.startSec + localPos));
      }
      trimPendingRef.current = { clipIdx, startSec: parseFloat(newStart.toFixed(2)), endSec: parseFloat(newEnd.toFixed(2)) };
    };

    const onUp = () => {
      setTrimDrag(null);
      const pending = trimPendingRef.current;
      if (pending && block) {
        const updated = blockClips.map((c, i) => i === pending.clipIdx ? { ...c, startSec: pending.startSec, endSec: pending.endSec } : c);
        scriptStudioApi.updateBlockClips(docId, block.blockIndex, updated).then(() => onBlockUpdated());
      }
      trimPendingRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [trimDrag, blockClips, clipTimelineOffsets, totalClipsDuration, clipSourceDurations, docId, block, onBlockUpdated]);

  // Cut clip at current playhead position
  const cutAtPlayhead = useCallback(() => {
    if (blockClips.length === 0 || !playDurSec) return;
    const { clipIdx, localTime } = timelineToClip(currentTime);
    const clip = blockClips[clipIdx];
    if (!clip) return;
    const end = clip.endSec ?? clip.sourceDurationSec ?? clipSourceDurations[clip.assetPath] ?? null;
    if (end == null || localTime <= clip.startSec + 0.2 || localTime >= end - 0.2) return; // too close to edges
    const leftClip = { ...clip, endSec: parseFloat(localTime.toFixed(2)) };
    const rightClip = { ...clip, startSec: parseFloat(localTime.toFixed(2)), endSec: end };
    const updated = [...blockClips.slice(0, clipIdx), leftClip, rightClip, ...blockClips.slice(clipIdx + 1)];
    scriptStudioApi.updateBlockClips(docId, block!.blockIndex, updated).then(() => onBlockUpdated());
  }, [blockClips, playDurSec, currentTime, timelineToClip, clipSourceDurations, docId, block, onBlockUpdated]);

  const togglePlay = () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (playing) {
      video?.pause();
      audio?.pause();
      setPlaying(false);
    } else {
      // If at end, reset to start
      if (playDurSec && currentTime >= playDurSec - 0.05) {
        setActiveClipIdx(0);
        setCurrentTime(0);
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.currentTime = blockClips[0]?.startSec ?? 0;
            videoRef.current.play().catch(() => {});
          }
          audio?.play().catch(() => {});
        }, 50);
        setPlaying(true);
        return;
      }
      video?.play().catch(() => {});
      audio?.play().catch(() => {});
      setPlaying(true);
    }
  };

  // Jump to next block that has an error or no clip for quick triage
  const jumpToIssue = () => {
    const start = clampedIdx + 1;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[(start + i) % blocks.length];
      if (b.status === 'error' || (!b.openingText && !b.clipAssetPath && b.narration)) {
        setIdx(blocks.indexOf(b));
        return;
      }
    }
  };

  // Shared: fetch candidates for the given service + query + orientation
  const fetchPickerCandidates = async (service: 'pexels' | 'pixabay' | 'mixkit' | 'images', query: string, orient: 'landscape' | 'portrait') => {
    setLoadingPicker(true);
    setPickerCandidates([]);
    setPickerError(null);
    try {
      const data = await scriptStudioApi.getAlternatives(docId, query, orient, 12, service);
      setPickerCandidates((data.candidates ?? []).map((c: any) => ({
        id: (c.pexelsId ?? c.pixabayId ?? c.mixkitId ?? c.imageId ?? 0) as number,
        thumbnail: c.thumbnail,
        previewUrl: c.previewUrl,
        downloadUrl: c.downloadUrl,
        duration: c.duration ?? 0,
        width: c.width,
        height: c.height,
        pageUrl: c.pexelsUrl ?? c.pageURL ?? c.pageUrl,
        title: c.title,
        source: c.source,
      })));
    } catch (err: any) {
      setPickerError(err.response?.data?.error ?? err.message ?? 'Search failed');
    }
    setLoadingPicker(false);
  };

  // Open stock picker for a given service
  const openPicker = async (service: 'pexels' | 'pixabay' | 'mixkit') => {
    const query = block.pexelsQuery || block.narration.split(/\s+/).slice(0, 5).join(' ');
    setPickerQuery(query);
    setPickerService(service);
    setShowPexelsPicker(true);
    await fetchPickerCandidates(service, query, pickerOrientation);
  };

  const switchPickerService = async (service: 'pexels' | 'pixabay' | 'mixkit' | 'images') => {
    if (service === pickerService) return;
    setPickerService(service);
    await fetchPickerCandidates(service, pickerQuery, pickerOrientation);
  };

  const switchPickerOrientation = async (orient: 'landscape' | 'portrait') => {
    if (orient === pickerOrientation) return;
    setPickerOrientation(orient);
    await fetchPickerCandidates(pickerService, pickerQuery, orient);
  };

  const searchPicker = async () => {
    const q = pickerQuery.trim();
    if (!q) return;
    await fetchPickerCandidates(pickerService, q, pickerOrientation);
  };

  const regenPickerQuery = async () => {
    setRegenningQuery(true);
    try {
      const data = await scriptStudioApi.regenQuery(docId, block.blockIndex);
      setPickerQuery(data.query);
      await fetchPickerCandidates(pickerService, data.query, pickerOrientation);
    } catch (err: any) {
      setPickerError(err.response?.data?.error ?? err.message ?? 'Failed to regenerate query');
    }
    setRegenningQuery(false);
  };

  const applyPexelsVideo = async (candidate: typeof pickerCandidates[0]) => {
    setApplyingPexelsId(candidate.id);
    try {
      let data: any;
      if (pickerService === 'images') {
        data = await scriptStudioApi.applyStockImage(docId, block.blockIndex, candidate.downloadUrl!, candidate.source || 'pexels', candidate.width, candidate.height, imageZoomEffect, orientation);
      } else if (pickerService === 'pexels') {
        data = await scriptStudioApi.applyPexelsById(docId, block.blockIndex, candidate.id);
      } else if (pickerService === 'mixkit') {
        data = await scriptStudioApi.applyMixkitFromUrl(docId, block.blockIndex, candidate.downloadUrl!, candidate.duration, candidate.width, candidate.height);
      } else {
        data = await scriptStudioApi.applyPixabayFromUrl(docId, block.blockIndex, candidate.downloadUrl!, candidate.duration, candidate.width, candidate.height);
      }
      const newAssetPath = data.filename ?? data.clipAssetPath ?? block.clipAssetPath;
      if (newAssetPath) {
        const srcDur = data.duration ?? candidate.duration ?? null;
        const newClip = { assetPath: newAssetPath, startSec: 0, endSec: srcDur as number | null, sourceDurationSec: srcDur as number | undefined, label: `${pickerService}:${candidate.id}` };
        // Chart blocks: replace all clips with the new composite; regular blocks: append
        const updatedClips = block.chartSpec ? [newClip] : [...blockClips, newClip];
        await scriptStudioApi.updateBlockClips(docId, block.blockIndex, updatedClips);
        setActiveClipIdx(updatedClips.length - 1);
        if (srcDur) setClipSourceDurations(prev => ({ ...prev, [newAssetPath]: srcDur }));
      }
      setActionLog([{ level: 'success', msg: `Clip added (${data.duration ?? candidate.duration}s)` }]);
      setShowPexelsPicker(false);
      onBlockUpdated();
    } catch (err: any) {
      setActionLog([{ level: 'error', msg: err.response?.data?.error ?? err.message }]);
    }
    setApplyingPexelsId(null);
  };

  // Handle pasted/dropped image file in Image tab
  const handlePasteImage = async (file: File) => {
    if (pastingImage) return;
    setPastingImage(true);
    setActionLog([{ level: 'info', msg: 'Converting image to clip...' }]);
    try {
      const data = await scriptStudioApi.pasteImage(docId, block.blockIndex, file, imageZoomEffect, orientation);
      const newClip = { assetPath: data.filename, startSec: 0, endSec: null as number | null };
      const merged = blockClips.length > 0 ? [...blockClips, newClip] : [newClip];
      await scriptStudioApi.updateBlockClips(docId, block.blockIndex, merged);
      setActiveClipIdx(merged.length - 1);
      onBlockUpdated();
      setActionLog([{ level: 'success', msg: `Image clip added (${data.duration}s)` }]);
    } catch (err: any) {
      setActionLog([{ level: 'error', msg: err.response?.data?.error ?? err.message }]);
    }
    setPastingImage(false);
  };

  // Handle split screen render via Remotion
  const handleSplitScreen = async () => {
    if (splitRendering || !splitLeftClip || !splitRightClip) return;
    setSplitRendering(true);
    setActionLog([{ level: 'info', msg: 'Rendering split screen...' }]);
    try {
      const data = await scriptStudioApi.splitScreen(docId, block.blockIndex, splitLeftClip, splitRightClip, {
        middleText: splitMiddleText,
        middleStyle: splitMiddleStyle,
        accentColor: splitAccentColor,
        leftLabel: splitLeftLabel || undefined,
        rightLabel: splitRightLabel || undefined,
        labelPosition: splitLabelPosition,
        rightLabelPosition: splitRightLabelPosition,
        labelStyle: splitLabelStyle,
        labelFontSize: splitLabelFontSize,
        orientation,
      });
      const newClip = {
        assetPath: data.filename, startSec: 0, endSec: null as number | null,
        splitSources: [splitLeftClip, splitRightClip],
        splitConfig: {
          middleText: splitMiddleText,
          middleStyle: splitMiddleStyle,
          accentColor: splitAccentColor,
          leftLabel: splitLeftLabel,
          rightLabel: splitRightLabel,
          labelPosition: splitLabelPosition,
          rightLabelPosition: splitRightLabelPosition,
          labelStyle: splitLabelStyle,
          labelFontSize: splitLabelFontSize,
        },
      };
      // Split clip must be the FIRST clip so clip_asset_path points to it for production
      const merged = [newClip];
      await scriptStudioApi.updateBlockClips(docId, block.blockIndex, merged);
      setActiveClipIdx(merged.length - 1);
      onBlockUpdated();
      setActionLog([{ level: 'success', msg: `Split screen rendered (${data.duration}s)` }]);
    } catch (err: any) {
      setActionLog([{ level: 'error', msg: err.response?.data?.error ?? err.message }]);
    }
    setSplitRendering(false);
  };

  // Auto-populate split screen clips from current block clips
  const openSplitPanel = () => {
    // Restore split sources and config from existing split clip if available
    const existingSplit = blockClips.find((c: any) => c.splitSources?.length === 2);
    setSplitLeftClip((existingSplit as any)?.splitSources?.[0] || '');
    setSplitRightClip((existingSplit as any)?.splitSources?.[1] || '');
    // Restore split config (style, text, colors, labels)
    const cfg = (existingSplit as any)?.splitConfig;
    if (cfg) {
      setSplitMiddleText(cfg.middleText ?? 'VS');
      setSplitMiddleStyle(cfg.middleStyle ?? 'vs');
      setSplitAccentColor(cfg.accentColor ?? '#7c6af5');
      setSplitLeftLabel(cfg.leftLabel ?? '');
      setSplitRightLabel(cfg.rightLabel ?? '');
      setSplitLabelPosition(cfg.labelPosition ?? 'top-center');
      setSplitRightLabelPosition(cfg.rightLabelPosition ?? cfg.labelPosition ?? 'top-center');
      setSplitLabelStyle(cfg.labelStyle ?? 'badge');
      setSplitLabelFontSize(cfg.labelFontSize ?? 28);
    }
    setSplitSearchSide(null);
    setSplitSearchResults([]);
    setSplitSearchService('pexels');
    setSplitSearchOrientation(orientation === 'portrait' ? 'landscape' : 'portrait');
    const q = block.pexelsQuery || block.narration.split(/\s+/).slice(0, 5).join(' ');
    setSplitSearchQuery(q);
    setShowSplitPanel(true);
    setShowPexelsPicker(false);
    // Auto-search
    if (q) splitStockSearch(q, 'pexels');
  };

  // Search stock for split panel
  const splitStockSearch = async (query: string, service?: 'pexels' | 'pixabay' | 'mixkit') => {
    if (!query.trim()) return;
    const svc = service ?? splitSearchService;
    setSplitSearchLoading(true);
    setSplitSearchResults([]);
    try {
      const data = await scriptStudioApi.getAlternatives(docId, query.trim(), splitSearchOrientation, 12, svc);
      setSplitSearchResults((data.candidates ?? []).map((c: any) => ({
        id: c.pexelsId ?? c.pixabayId ?? c.mixkitId ?? 0,
        thumbnail: c.thumbnail,
        previewUrl: c.previewUrl,
        downloadUrl: c.downloadUrl,
        duration: c.duration ?? 0,
        width: c.width,
        height: c.height,
        pageUrl: c.pexelsUrl ?? c.pageURL,
        title: c.title,
      })));
    } catch { /* ignore */ }
    setSplitSearchLoading(false);
  };

  // Download a stock clip for split panel and assign to a side
  const splitSelectStock = async (candidate: typeof splitSearchResults[0], side: 'left' | 'right') => {
    if (splitDownloading) return;
    setSplitDownloading(candidate.id);
    setSplitSearchSide(side);
    try {
      const data = await scriptStudioApi.downloadStock(docId, splitSearchService, candidate);
      if (side === 'left') setSplitLeftClip(data.filename);
      else setSplitRightClip(data.filename);
      const sideLabel = isPortrait ? (side === 'left' ? 'top' : 'bottom') : side;
      setActionLog([{ level: 'success', msg: `${sideLabel} clip ready (${data.duration}s)` }]);
    } catch (err: any) {
      setActionLog([{ level: 'error', msg: err.response?.data?.error ?? err.message }]);
    }
    setSplitDownloading(null);
  };

  // Fetch top Pexels clip and apply it to this block (kept for direct use)
  const fetchPexels = async () => {
    setFetchingPexels(true);
    setActionLog([]);
    try {
      const data = await scriptStudioApi.fetchBlockPexels(docId, block.blockIndex, orientation);
      setActionLog([{ level: 'success', msg: `Fetched Pexels clip (${data.duration}s) → ${data.filename}` }]);
      onBlockUpdated();
    } catch (err: any) {
      const msg = err.response?.data?.error ?? err.message;
      setActionLog([{ level: 'error', msg }]);
    }
    setFetchingPexels(false);
  };

  // Fetch top Pixabay clip and apply it to this block
  const fetchPixabay = async () => {
    setFetchingPixabay(true);
    setActionLog([]);
    try {
      const data = await scriptStudioApi.fetchBlockPixabay(docId, block.blockIndex, orientation);
      setActionLog([{ level: 'success', msg: `Fetched Pixabay clip (${data.duration}s) → ${data.filename}` }]);
      onBlockUpdated();
    } catch (err: any) {
      const msg = err.response?.data?.error ?? err.message;
      setActionLog([{ level: 'error', msg }]);
    }
    setFetchingPixabay(false);
  };

  // Stream-generate AI clip for this block
  const generateAiBlock = async () => {
    setGeneratingAi(true);
    setActionLog([]);
    try {
      const res = await fetch(
        `/api/script-studio/docs/${docId}/blocks/${block.blockIndex}/generate-ai`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiPrompt: block.aiPrompt, orientation }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const flush = (line: string) => {
        if (!line.trim()) return;
        try {
          const p = JSON.parse(line);
          if (p.type === 'log') setActionLog((prev) => [...prev, { level: p.level, msg: p.message }]);
          if (p.type === 'error') throw new Error(p.error);
        } catch { /* ignore malformed */ }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        lines.forEach(flush);
      }
      if (buf.trim()) flush(buf);
      onBlockUpdated();
    } catch (err: any) {
      setActionLog([{ level: 'error', msg: err.message }]);
    }
    setGeneratingAi(false);
  };

  // Reset action log when block changes
  useEffect(() => { setActionLog([]); }, [clampedIdx]);

  if (!block) return null;

  const isPortrait = orientation === 'portrait';
  const clipUrl = renderedUrl || (activeClip
    ? `/renders/storyboard/doc_${docId}/` + activeClip.assetPath
    : null);
  const audioUrl = block.audioPath ? `/cache/block_audio/${block.audioPath}` : null;
  const audioTotalSec = audioDurSec ?? audioElDuration ?? 0;
  const audioBarPct = (audioTotalSec > 0 && playDurSec && playDurSec > 0) ? Math.min(100, (audioTotalSec / playDurSec) * 100) : 0;

  const hasIssue = block.status === 'error' || (!block.clipAssetPath && !!block.narration);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Navigation bar (sticky) ── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-c-border bg-c-surface shrink-0 z-10">
        <button
          className="p-1.5 rounded-lg hover:bg-c-elevated text-c-muted hover:text-c-text transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={clampedIdx === 0}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Block pills grouped by segment */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
          {blocks.map((b, i) => {
            const isActive = i === clampedIdx;
            const hasErr = b.status === 'error';
            const isChart = !!b.chartSpec;
            const isAi = b.visualType === 'ai';
            const isOpening = !!b.openingText;
            const noClip = !isOpening && !b.clipAssetPath && !!b.narration;
            const notRendered = !isOpening && b.status === 'clip_ready' && !!b.clipAssetPath && !b.renderedClipPath;
            // Check if video duration < audio duration (skip for opening blocks — fixed 3s, no audio)
            const audioDurSec = (b.audioDurationMs ?? 0) / 1000;
            let videoDurSec = 0;
            if (!isOpening) {
              if (b.clips?.length > 0) {
                videoDurSec = b.clips.reduce((sum, c) => {
                  const start = c.startSec ?? 0;
                  const end = c.endSec ?? c.sourceDurationSec ?? null;
                  return sum + (end != null ? Math.max(0, end - start) : 0);
                }, 0);
              } else if (b.clipAssetPath) {
                videoDurSec = b.clipEndSec != null && b.clipStartSec != null ? b.clipEndSec - b.clipStartSec : 0;
              }
            }
            const videoShort = audioDurSec > 0 && videoDurSec > 0 && videoDurSec < audioDurSec - 0.5;
            const isNewSegment = i === 0 || blocks[i - 1].segmentIndex !== b.segmentIndex;
            return (
              <div key={b.id} className="flex items-center gap-1 shrink-0">
                {isNewSegment && i > 0 && (
                  <div className="w-px h-5 bg-c-border mx-1 shrink-0" />
                )}
                {isNewSegment && (
                  <span className="text-[10px] font-semibold text-c-accent/70 uppercase tracking-wide shrink-0 max-w-[72px] truncate" title={b.segmentName}>
                    {b.segmentName}
                  </span>
                )}
                <button
                  onClick={() => setIdx(i)}
                  className={`shrink-0 w-6 h-6 rounded-md text-xs font-mono font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-c-accent text-white'
                      : hasErr
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : isOpening
                          ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                          : noClip
                            ? 'bg-amber-500/20 text-amber-400 border border-dashed border-amber-500/50'
                            : notRendered
                              ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                              : videoShort
                                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                : isChart
                                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                  : isAi
                                    ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                                    : b.status === 'rendered'
                                      ? 'bg-green-500/15 text-green-400'
                                      : 'bg-c-elevated text-c-dim hover:bg-c-hover hover:text-c-text'
                  }`}
                  title={`#${i + 1} · ${b.segmentName} · Sc ${b.sceneNumber}${isOpening ? ' [opening]' : isChart ? ' [chart]' : isAi ? ' [AI]' : ''}: ${b.status}${videoShort ? ` · video ${videoDurSec.toFixed(1)}s < audio ${audioDurSec.toFixed(1)}s` : ''}`}
                >
                  {isOpening ? <Film className="w-3 h-3" /> : isChart ? <BarChart2 className="w-3 h-3" /> : isAi ? <Wand2 className="w-3 h-3" /> : i + 1}
                </button>
              </div>
            );
          })}
        </div>

        <button
          className="p-1.5 rounded-lg hover:bg-c-elevated text-c-muted hover:text-c-text transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
          onClick={() => setIdx((i) => Math.min(blocks.length - 1, i + 1))}
          disabled={clampedIdx === blocks.length - 1}
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Jump to issue */}
        {blocks.some((b) => b.status === 'error' || (!b.openingText && !b.clipAssetPath && b.narration)) && (
          <button
            className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors cursor-pointer shrink-0"
            onClick={jumpToIssue}
            title="Jump to next block with issue"
          >
            <AlertTriangle className="w-3 h-3" />
            {t('scriptStudio.studio.nextIssue')}
          </button>
        )}
      </div>

      {/* ── Scrollable content area ── */}
      <div className="flex-1 overflow-y-auto min-h-0">

      {/* ── Current block segment info ── */}
      <div className="flex items-center gap-1.5 px-3 py-1 border-b border-c-border bg-c-elevated/30 sticky top-0 z-[5]">
        <div className="w-0.5 h-2.5 rounded-full bg-c-accent/50 shrink-0" />
        <span className="text-[10px] font-semibold text-c-accent/70 uppercase tracking-widest truncate">{block.segmentName}</span>
        <span className="text-[10px] text-c-dim/60 shrink-0">·</span>
        <span className="text-[10px] text-c-dim tabular-nums shrink-0">{clampedIdx + 1}/{blocks.length}</span>
        <div className="flex-1" />
        {block.openingText
          ? <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-sky-500/10 text-sky-400 shrink-0"><Film className="w-2 h-2" />3s</span>
          : block.clipAssetPath
            ? <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-green-500/10 text-green-400 shrink-0"><Check className="w-2 h-2" />clip</span>
            : block.narration ? <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-amber-500/10 text-amber-400 shrink-0"><AlertTriangle className="w-2 h-2" />no clip</span> : null
        }
        {block.audioDurationMs ? (
          <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-px rounded bg-blue-500/10 text-blue-400 shrink-0">
            <Mic className="w-2 h-2" />{(block.audioDurationMs / 1000).toFixed(1)}s
          </span>
        ) : null}
      </div>

      {/* ── Narration strip (collapsible) — hidden when narration equals overlay ── */}
      {!(block.overlays?.length === 1 && block.overlays[0] === block.narration) && (
      <div className="border-b border-c-border bg-c-surface/60">
        <button
          className="w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-c-elevated/30 transition-colors cursor-pointer"
          onClick={() => setNarrationExpanded(v => !v)}
        >
          <FileText className="w-3 h-3 text-c-dim shrink-0" />
          {narrationExpanded
            ? <span className="flex-1 text-[10px] text-c-muted font-medium uppercase tracking-wider">Narration</span>
            : <p className="flex-1 text-xs text-c-text leading-relaxed truncate">{block.narration || <span className="text-c-dim italic">No narration</span>}</p>
          }
          {narrationExpanded ? <ChevronUp className="w-3 h-3 text-c-dim shrink-0" /> : <ChevronDown className="w-3 h-3 text-c-dim shrink-0" />}
        </button>
        {narrationExpanded && (
        <div className="px-4 pb-2">
          <p className="text-xs text-c-text leading-relaxed whitespace-pre-line mb-1.5">{block.narration}</p>
        {/* Voice info + regenerate */}
        <div className="flex items-center gap-2 flex-wrap">
          {generatingTts ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/70">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />{t('scriptStudio.studio.generatingVoice')}
            </span>
          ) : block.audioDurationMs ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-blue-400/70">
              <Mic className="w-2.5 h-2.5" />{(block.audioDurationMs / 1000).toFixed(1)}s
              {block.audioEngine && (
                <span className={`px-1 py-px rounded text-[9px] font-mono ${block.audioEngine === 'omnivoice' ? 'bg-purple-500/15 text-purple-400 border border-purple-500/20' : 'bg-sky-500/15 text-sky-400 border border-sky-500/20'}`}>
                  {block.audioEngine === 'omnivoice' ? 'OmniVoice' : 'edge-tts'}
                </span>
              )}
            </span>
          ) : block.narration ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-c-dim">
              <Mic className="w-2.5 h-2.5 opacity-40" />{t('scriptStudio.studio.noAudioYet')}
            </span>
          ) : null}
          {/* Voice config details */}
          {(() => {
            const vc = block.voiceConfig;
            if (!vc) return null;
            const parts = vc.split('|').map((p: string) => p.trim());
            const groupPart = parts.find((p: string) => p.startsWith('group:'));
            const emotionPart = parts.find((p: string) => p.startsWith('emotion:'));
            const ratePart = parts.find((p: string) => p.startsWith('rate:'));
            const groupName = groupPart?.split(':')[1]?.trim();
            const emotionName = emotionPart?.split(':')[1]?.trim();
            const rateVal = ratePart?.split(':')[1]?.trim();
            return (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono" title={vc}>
                <Mic className="w-2.5 h-2.5 shrink-0" />
                {groupName ?? 'custom'}
                {emotionName && <span className="text-cyan-400/60">· {emotionName}</span>}
                {rateVal && <span className="text-cyan-400/60">· {rateVal}</span>}
              </span>
            );
          })()}
          {!block.voiceConfig && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-c-elevated text-c-dim border border-c-border font-mono">
              <Mic className="w-2.5 h-2.5 shrink-0 opacity-40" />
              {t('scriptStudio.studio.defaultVoice')}
            </span>
          )}
          {/* TTS engine selector + regenerate + apply all */}
          {block.narration && !generatingTts && !ttsAllRunning && (
            <>
              <select
                value={ttsEngine}
                onChange={(e) => onTtsEngineChange(e.target.value as 'omnivoice' | 'edge-tts')}
                className="text-[10px] px-1 py-0.5 rounded bg-c-elevated border border-c-border text-c-text cursor-pointer focus:outline-none focus:border-c-accent/40"
              >
                <option value="omnivoice">OmniVoice</option>
                <option value="edge-tts">edge-tts</option>
              </select>
              <button
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-c-elevated border border-c-border text-c-dim hover:text-c-accent hover:border-c-accent/30 transition-colors cursor-pointer"
                title={t('scriptStudio.studio.regenVoice')}
                onClick={() => {
                  setGeneratingTts(true);
                  scriptStudioApi.ttsBlock(docId, block.blockIndex, { force: true, engine: ttsEngine, voice, rate }).then((data: any) => {
                    const eng = data.engine ? ` [${data.engine}]` : '';
                    setActionLog([{ level: 'success', msg: `TTS regenerated (${(data.audioDurationMs / 1000).toFixed(1)}s)${eng}` }]);
                    onBlockUpdated();
                  }).catch((err) => {
                    setActionLog([{ level: 'error', msg: `TTS failed: ${err.message ?? 'unknown'}` }]);
                  }).finally(() => setGeneratingTts(false));
                }}
              >
                <RefreshCw className="w-2.5 h-2.5" />
                {t('scriptStudio.studio.regenVoice')}
              </button>
              <button
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/40 transition-colors cursor-pointer"
                title="Regenerate TTS for all blocks with current engine"
                onClick={() => {
                  setTtsAllRunning(true);
                  setTtsAllProgress({ done: 0, total: blocks.length });
                  setActionLog([{ level: 'info', msg: `Regenerating TTS for all blocks [${ttsEngine}]...` }]);
                  scriptStudioApi.ttsAll(docId, ttsEngine, voice, rate, (data) => {
                    if (data.total) setTtsAllProgress({ done: data.done, total: data.total });
                    if (data.error) setActionLog(prev => [...prev, { level: 'error', msg: `Block ${data.blockIndex}: ${data.error}` }]);
                  }).then(() => {
                    setActionLog(prev => [...prev, { level: 'success', msg: 'All blocks TTS done!' }]);
                    onBlockUpdated();
                  }).catch((err) => {
                    setActionLog(prev => [...prev, { level: 'error', msg: `TTS all failed: ${err.message}` }]);
                  }).finally(() => { setTtsAllRunning(false); setTtsAllProgress(null); });
                }}
              >
                <Zap className="w-2.5 h-2.5" />
                Apply all
              </button>
            </>
          )}
          {(generatingTts || ttsAllRunning) && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/70">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              {ttsAllRunning && ttsAllProgress ? `TTS ${ttsAllProgress.done}/${ttsAllProgress.total}` : 'Generating...'}
            </span>
          )}
        </div>
        </div>
        )}
      </div>
      )}

      {/* ── Video/Audio player ── */}
      {/* Collapse/expand bar */}
      <div className="flex items-center gap-1 px-3 py-0.5 border-b border-c-border bg-c-surface/40">
        <button
          onClick={() => setPlayerCollapsed(v => !v)}
          className="flex items-center gap-1 text-[10px] text-c-dim hover:text-c-text transition-colors cursor-pointer"
        >
          {playerCollapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          <span>{playerCollapsed ? 'Show player' : 'Hide player'}</span>
        </button>
        <div className="flex-1" />
        {clipUrl && (
          <>
            <button
              onClick={() => {
                const vid = videoRef.current;
                if (!vid) return;
                if (document.fullscreenElement) {
                  document.exitFullscreen();
                } else {
                  vid.requestFullscreen?.().catch(() => {});
                }
              }}
              className="flex items-center gap-1 text-[10px] text-c-dim hover:text-c-text transition-colors cursor-pointer"
              title="Fullscreen"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
            <button
              onClick={() => {
                if (playing) { videoRef.current?.pause(); audioRef.current?.pause(); setPlaying(false); }
                const updated = blockClips.length > 1
                  ? blockClips.filter((_, i) => i !== safeClipIdx)
                  : [];
                scriptStudioApi.updateBlockClips(docId, block.blockIndex, updated).then(() => {
                  setActiveClipIdx(Math.max(0, safeClipIdx - 1));
                  setVideoDuration(null);
                  setCurrentTime(0);
                  onBlockUpdated();
                });
              }}
              className="flex items-center gap-1 text-[10px] text-c-dim hover:text-red-400 transition-colors cursor-pointer"
              title="Remove current clip"
            >
              <X className="w-3 h-3" />
              <span>Remove clip</span>
            </button>
          </>
        )}
      </div>
      {!playerCollapsed && (
      <div className={`relative bg-black flex items-center justify-center overflow-hidden ${isPortrait ? 'h-72' : 'h-56'}`}>
        {clipUrl ? (
          <>
            <video
              ref={videoRef}
              src={clipUrl}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={(e) => {
                const vid = e.currentTarget as HTMLVideoElement;
                setVideoDuration(vid.duration);
                if (activeClip) {
                  setClipSourceDurations(prev => ({ ...prev, [activeClip.assetPath]: vid.duration }));
                }
                if (effectiveClipStart > 0) vid.currentTime = effectiveClipStart;
              }}
              className={isPortrait ? 'h-full w-auto mx-auto object-cover aspect-[9/16]' : 'w-full h-full object-cover'}
            />
            {/* Play / pause center overlay */}
            <button
              className="absolute inset-0 flex items-center justify-center group cursor-pointer"
              onClick={togglePlay}
            >
              <div className={`w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center transition-all duration-200 ${playing ? 'opacity-0 scale-90 group-hover:opacity-80 group-hover:scale-100' : 'opacity-90 hover:opacity-100 hover:scale-105'}`}>
                {playing
                  ? <Square className="w-4 h-4 text-white fill-white" />
                  : <Play className="w-5 h-5 text-white fill-white ml-0.5" />}
              </div>
            </button>
            {/* Clip index badge */}
            {blockClips.length > 1 && (
              <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-mono z-10">
                {safeClipIdx + 1}/{blockClips.length}
              </div>
            )}
            {/* Live overlay text preview (only on raw clip, not rendered video which has text burned in) */}
            {block.overlays?.length > 0 && !renderedUrl && (() => {
              const ost = block.overlayStyle ?? {};
              const textColor = ost.color ?? '#FFFFFF';
              const sizeMap: Record<string, string> = { sm: '0.7rem', md: '0.9rem', lg: '1.15rem', xl: '1.5rem' };
              const fs = sizeMap[ost.fontSize ?? 'md'] ?? '0.9rem';
              const pos = ost.position ?? 'center';
              const posStyle: React.CSSProperties = pos === 'top'
                ? { top: '8%', left: '50%', transform: 'translateX(-50%)' }
                : pos === 'bottom'
                ? { bottom: '15%', left: '50%', transform: 'translateX(-50%)' }
                : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
              const bgStyle: React.CSSProperties | undefined = ost.bgEnabled ? {
                backgroundColor: `${ost.bgColor ?? '#000000'}${Math.round((ost.bgOpacity ?? 0.6) * 255).toString(16).padStart(2, '0')}`,
                padding: '4px 12px',
                borderRadius: '4px',
              } : undefined;
              return (
                <div className="absolute pointer-events-none" style={{ ...posStyle, zIndex: 5 }}>
                  <div style={bgStyle}>
                    {block.overlays.map((text, i) => (
                      <p key={i} className="font-bold text-center leading-snug whitespace-nowrap" style={{
                        color: textColor,
                        fontSize: fs,
                        textShadow: '0 0 6px rgba(0,0,0,0.8), 2px 2px 4px rgba(0,0,0,0.6)',
                      }}>{text}</p>
                    ))}
                  </div>
                </div>
              );
            })()}
          </>
        ) : audioUrl ? (
          /* Audio-only: dark player area with waveform icon */
          <div className="flex flex-col items-center gap-2">
            <button onClick={togglePlay} className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer">
              {playing
                ? <Square className="w-6 h-6 text-white fill-white" />
                : <Play className="w-6 h-6 text-white fill-white ml-0.5" />}
            </button>
            <span className="text-white/50 text-xs">{audioDurSec ? `${audioDurSec.toFixed(1)}s` : 'Audio'}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-c-dim">
            {hasIssue ? (
              <>
                <AlertTriangle className="w-8 h-8 text-amber-400/50" />
                <p className="text-xs text-amber-400/70">
                  {block.status === 'error' ? block.errorMsg ?? 'Error' : t('scriptStudio.studio.noClipYet')}
                </p>
              </>
            ) : (
              <>
                <Film className="w-8 h-8 opacity-20" />
                <p className="text-xs opacity-40">{t('scriptStudio.studio.noClipYet')}</p>
              </>
            )}
          </div>
        )}

        {/* ── Dual timeline overlay (bottom of player) ── */}
        {(() => {
          const srcDur = activeClip
            ? (activeClip.sourceDurationSec ?? clipSourceDurations[activeClip.assetPath] ?? videoDuration ?? null)
            : null;
          const vDur = srcDur && srcDur > 0 ? srcDur : 0;
          const aDur = audioTotalSec > 0 ? audioTotalSec : 0;
          if (vDur <= 0 && aDur <= 0) return null;

          const masterDur = Math.max(vDur, aDur);
          const videoIsLonger = vDur >= aDur;
          const rangeStartSec = audioRangeDragStart ?? effectiveClipStart;

          // Percentages for the shorter-one's range on the longer bar
          const audioOnVideoPct = vDur > 0 && aDur > 0 ? Math.min(100, (aDur / vDur) * 100) : 100;
          const audioOnVideoLeftPct = vDur > 0 ? Math.min(100 - audioOnVideoPct, (rangeStartSec / vDur) * 100) : 0;
          const videoOnAudioPct = aDur > 0 && vDur > 0 ? Math.min(100, (vDur / aDur) * 100) : 100;
          // When audio is longer, the video portion starts at negative offset relative to audio
          const videoOnAudioLeftPct = aDur > 0 && vDur > 0 ? Math.max(0, Math.min(100 - videoOnAudioPct, ((aDur - vDur + rangeStartSec) / aDur) * 100)) : 0;

          const canDrag = vDur > 0 && aDur > 0 && vDur !== aDur;

          const audioProgressPct = aDur > 0 ? Math.min(100, (audioTime / aDur) * 100) : 0;
          // currentTime is elapsed within the clip; absolute video pos = startSec + currentTime
          const absVideoPos = rangeStartSec + currentTime;
          const videoProgressPct = vDur > 0 ? Math.min(100, (absVideoPos / vDur) * 100) : 0;

          const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

          // Drag handler for the audio range on the video bar (when video is longer)
          const handleDragOnVideoBar = (e: React.MouseEvent, barRef: HTMLDivElement | null) => {
            if (!barRef || !canDrag || vDur <= aDur) return;
            e.preventDefault(); e.stopPropagation();
            const tlRect = barRef.getBoundingClientRect();
            const clickFrac = (e.clientX - tlRect.left) / tlRect.width;
            audioRangeDragOffsetRef.current = clickFrac - rangeStartSec / vDur;

            const calc = (ev: MouseEvent) => {
              const rect = barRef.getBoundingClientRect();
              const frac = (ev.clientX - rect.left) / rect.width;
              const newFrac = Math.max(0, Math.min(1 - aDur / vDur, frac - audioRangeDragOffsetRef.current));
              return parseFloat((newFrac * vDur).toFixed(2));
            };
            const onMove = (ev: MouseEvent) => {
              const ns = calc(ev);
              setAudioRangeDragStart(ns);
              if (videoRef.current) videoRef.current.currentTime = ns;
            };
            const onUp = (ev: MouseEvent) => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
              const ns = calc(ev);
              setAudioRangeDragStart(null);
              if (!activeClip) return;
              const ne = parseFloat((ns + aDur).toFixed(2));
              const updated = blockClips.map((c, i) => i === safeClipIdx ? { ...c, startSec: ns, endSec: ne } : c);
              scriptStudioApi.updateBlockClips(docId, block.blockIndex, updated).then(() => onBlockUpdated());
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          };

          // Drag handler for the video range on the audio bar (when audio is longer)
          const handleDragOnAudioBar = (e: React.MouseEvent, barRef: HTMLDivElement | null) => {
            if (!barRef || !canDrag || aDur <= vDur) return;
            e.preventDefault(); e.stopPropagation();
            const tlRect = barRef.getBoundingClientRect();
            const clickFrac = (e.clientX - tlRect.left) / tlRect.width;
            const currentLeftFrac = (aDur - vDur + rangeStartSec) / aDur;
            audioRangeDragOffsetRef.current = clickFrac - currentLeftFrac;

            const calc = (ev: MouseEvent) => {
              const rect = barRef.getBoundingClientRect();
              const frac = (ev.clientX - rect.left) / rect.width;
              const newLeftFrac = Math.max(0, Math.min(1 - vDur / aDur, frac - audioRangeDragOffsetRef.current));
              // Convert back: rangeStartSec = newLeftFrac * aDur - (aDur - vDur)
              return parseFloat((newLeftFrac * aDur - (aDur - vDur)).toFixed(2));
            };
            const onMove = (ev: MouseEvent) => {
              const ns = Math.max(0, calc(ev));
              setAudioRangeDragStart(ns);
              if (videoRef.current) videoRef.current.currentTime = ns;
            };
            const onUp = (ev: MouseEvent) => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
              const ns = Math.max(0, calc(ev));
              setAudioRangeDragStart(null);
              if (!activeClip) return;
              const ne = parseFloat((ns + aDur).toFixed(2));
              const updated = blockClips.map((c, i) => i === safeClipIdx ? { ...c, startSec: ns, endSec: ne } : c);
              scriptStudioApi.updateBlockClips(docId, block.blockIndex, updated).then(() => onBlockUpdated());
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          };

          // Scrub handler for clicking on video bar
          const scrubVideo = (e: { clientX: number }, barEl: HTMLDivElement | null) => {
            if (!barEl || vDur <= 0) return;
            const rect = barEl.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const absTime = frac * vDur; // absolute video position
            if (videoRef.current) videoRef.current.currentTime = absTime;
            // currentTime is elapsed within clip = absTime - startSec
            const elapsed = Math.max(0, absTime - rangeStartSec);
            setCurrentTime(elapsed);
            // Also sync audio if within audio range
            if (audioRef.current && elapsed >= 0 && elapsed <= aDur) {
              audioRef.current.currentTime = elapsed;
              setAudioTime(elapsed);
            }
          };

          // Scrub handler for clicking on audio bar
          const scrubAudio = (e: { clientX: number }, barEl: HTMLDivElement | null) => {
            if (!barEl || aDur <= 0) return;
            const rect = barEl.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const t = frac * aDur;
            if (audioRef.current) audioRef.current.currentTime = t;
            setAudioTime(t);
            // Also sync video: absolute video pos = startSec + audioTime
            const absVideoTime = rangeStartSec + t;
            if (videoRef.current) videoRef.current.currentTime = absVideoTime;
            setCurrentTime(t); // elapsed = audioTime within clip
          };

          return (
          <div
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pt-5 pb-2 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              {/* ── Video timeline (top, blue/accent) ── */}
              {vDur > 0 && (
                <div className="flex items-center gap-2">
                  <Film className="w-2.5 h-2.5 text-cyan-400/70 shrink-0" />
                  <div
                    ref={scrubBarRef}
                    className="flex-1 cursor-pointer group"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-audio-range]')) return;
                      scrubVideo(e, scrubBarRef.current);
                    }}
                    onMouseDown={(e) => {
                      if ((e.target as HTMLElement).closest('[data-audio-range]')) return;
                      e.preventDefault();
                      const onMove = (ev: MouseEvent) => scrubVideo(ev, scrubBarRef.current);
                      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                      window.addEventListener('mousemove', onMove);
                      window.addEventListener('mouseup', onUp);
                    }}
                  >
                    <div className="h-2.5 bg-white/10 rounded relative">
                      {/* Audio range on video bar (when video is longer) */}
                      {videoIsLonger && canDrag && (
                        <div
                          data-audio-range
                          className={`absolute inset-y-0 rounded border transition-colors ${
                            audioRangeDragStart != null
                              ? 'bg-orange-400/40 border-orange-400/80'
                              : 'bg-orange-400/20 border-orange-400/40 hover:bg-orange-400/30 hover:border-orange-400/60'
                          }`}
                          style={{ left: `${audioOnVideoLeftPct}%`, width: `${audioOnVideoPct}%`, cursor: 'grab' }}
                          onMouseDown={(e) => { e.stopPropagation(); handleDragOnVideoBar(e, scrubBarRef.current); }}
                        >
                          <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-orange-300/60 rounded pointer-events-none" />
                          <div className="absolute left-1.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-orange-300/60 rounded pointer-events-none" />
                          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-orange-300/60 rounded pointer-events-none" />
                          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-orange-300/60 rounded pointer-events-none" />
                        </div>
                      )}
                      {/* Video progress + white dot */}
                      <div
                        className="absolute inset-y-0 left-0 bg-cyan-400/40 rounded-l transition-[width] duration-75 pointer-events-none"
                        style={{ width: `${videoProgressPct}%` }}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-lg" />
                      </div>
                    </div>
                  </div>
                  <span className="text-[9px] text-white/50 font-mono tabular-nums shrink-0 w-8 text-right">{fmt(vDur)}</span>
                </div>
              )}

              {/* ── Audio timeline (bottom, orange) ── */}
              {aDur > 0 && (
                <div className="flex items-center gap-2">
                  <Mic className="w-2.5 h-2.5 text-orange-400/70 shrink-0" />
                  <div
                    className="flex-1 cursor-pointer group"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-video-range]')) return;
                      scrubAudio(e, e.currentTarget as HTMLDivElement);
                    }}
                    onMouseDown={(e) => {
                      if ((e.target as HTMLElement).closest('[data-video-range]')) return;
                      e.preventDefault();
                      const bar = e.currentTarget as HTMLDivElement;
                      const onMove = (ev: MouseEvent) => scrubAudio(ev, bar);
                      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                      window.addEventListener('mousemove', onMove);
                      window.addEventListener('mouseup', onUp);
                    }}
                  >
                    <div className="h-2.5 bg-white/10 rounded relative">
                      {/* Video range on audio bar (when audio is longer) */}
                      {!videoIsLonger && canDrag && (
                        <div
                          data-video-range
                          className={`absolute inset-y-0 rounded border transition-colors ${
                            audioRangeDragStart != null
                              ? 'bg-cyan-400/40 border-cyan-400/80'
                              : 'bg-cyan-400/20 border-cyan-400/40 hover:bg-cyan-400/30 hover:border-cyan-400/60'
                          }`}
                          style={{ left: `${videoOnAudioLeftPct}%`, width: `${videoOnAudioPct}%`, cursor: 'grab' }}
                          onMouseDown={(e) => { e.stopPropagation(); handleDragOnAudioBar(e, e.currentTarget.parentElement as HTMLDivElement); }}
                        >
                          <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-cyan-300/60 rounded pointer-events-none" />
                          <div className="absolute left-1.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-cyan-300/60 rounded pointer-events-none" />
                          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-cyan-300/60 rounded pointer-events-none" />
                          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-cyan-300/60 rounded pointer-events-none" />
                        </div>
                      )}
                      {/* Audio progress + white dot */}
                      <div
                        className="absolute inset-y-0 left-0 bg-orange-400/40 rounded-l transition-[width] duration-75 pointer-events-none"
                        style={{ width: `${audioProgressPct}%` }}
                      >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-lg" />
                      </div>
                    </div>
                  </div>
                  <span className="text-[9px] text-white/50 font-mono tabular-nums shrink-0 w-8 text-right">{fmt(aDur)}</span>
                </div>
              )}
            </div>
          </div>
          );
        })()}
      </div>
      )}

      {/* Hidden audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          key={audioUrl}
          src={audioUrl}
          preload="metadata"
          className="hidden"
          onLoadedMetadata={(e) => {
            const dur = (e.currentTarget as HTMLAudioElement).duration;
            if (dur && isFinite(dur) && dur > 0) setAudioElDuration(dur);
          }}
          onDurationChange={(e) => {
            const dur = (e.currentTarget as HTMLAudioElement).duration;
            if (dur && isFinite(dur) && dur > 0) setAudioElDuration(dur);
          }}
          onEnded={() => { setPlaying(false); if (videoRef.current) videoRef.current.pause(); }}
          onTimeUpdate={(e) => setAudioTime((e.currentTarget as HTMLAudioElement).currentTime)}
        />
      )}

      {/* ── Quick action bar ── */}
      <div className="px-3 py-1.5 border-t border-c-border bg-c-surface flex items-center gap-1.5">
        {block.visualType !== 'ai' && block.visualType !== 'chart' && (
          <button
            onClick={() => { setShowPexelsPicker((v) => !v); setShowSplitPanel(false); }}
            disabled={loadingPicker}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all disabled:opacity-50 cursor-pointer ${showPexelsPicker ? 'bg-c-accent/15 border-c-accent/40 text-c-accent' : 'bg-c-elevated border-c-border text-c-muted hover:border-c-accent/40 hover:text-c-accent'}`}
          >
            {loadingPicker ? <Loader2 className="w-3 h-3 animate-spin" /> : <Film className="w-3 h-3" />}
            Stock
          </button>
        )}
        {block.visualType === 'ai' && (
          <button
            onClick={generateAiBlock}
            disabled={generatingAi}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-violet-500/10 border border-violet-500/25 text-violet-300 hover:bg-violet-500/20 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {generatingAi ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            AI Gen
          </button>
        )}
        <button
          onClick={openSplitPanel}
          disabled={splitRendering}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all disabled:opacity-50 cursor-pointer ${showSplitPanel ? 'bg-teal-500/15 border-teal-500/40 text-teal-400' : 'bg-c-elevated border-c-border text-c-muted hover:border-teal-500/40 hover:text-teal-400'}`}
        >
          {splitRendering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Columns className="w-3 h-3" />}
          Split
        </button>
        {fetchingPixabay && (
          <span className="inline-flex items-center gap-1 text-[10px] text-c-dim">
            <Loader2 className="w-3 h-3 animate-spin" />
          </span>
        )}
        <div className="flex-1" />
        {actionLog.length > 0 && (
          <div className={`min-w-0 text-[10px] truncate max-w-[200px] ${actionLog[actionLog.length - 1].level === 'error' ? 'text-red-400' : actionLog[actionLog.length - 1].level === 'success' ? 'text-green-400' : 'text-c-dim'}`}>
            {actionLog[actionLog.length - 1].msg}
          </div>
        )}
      </div>

      {/* ── Split screen panel ── */}
      {showSplitPanel && (
        <div className="border-t-2 border-teal-500/30 bg-gradient-to-b from-teal-500/[0.03] to-transparent">

          {/* ── Header bar ── */}
          <div className="px-4 py-2 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-teal-500/15 flex items-center justify-center">
                <Columns className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <span className="text-[12px] font-semibold text-c-text tracking-wide">Split Screen</span>
            </div>
            <div className="flex-1" />
            <button
              onClick={handleSplitScreen}
              disabled={splitRendering || !splitLeftClip || !splitRightClip}
              className="px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-teal-500 text-white hover:bg-teal-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center gap-1.5 shadow-sm shadow-teal-500/25"
            >
              {splitRendering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Columns className="w-3.5 h-3.5" />}
              {splitRendering ? 'Rendering...' : 'Render Split'}
            </button>
            <button onClick={() => setShowSplitPanel(false)} className="p-1.5 rounded-lg hover:bg-c-elevated text-c-dim hover:text-c-text transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Preview area: top/bottom (portrait) or left/right (landscape) ── */}
          <div className="px-4 pb-3">
            <div className={`flex items-stretch gap-0 rounded-xl overflow-hidden border border-c-border/60 bg-black/40 ${isPortrait ? 'flex-col max-w-xs mx-auto' : ''}`}>
              {/* Left panel */}
              <div
                className={`flex-1 relative group cursor-pointer transition-all ${splitSearchSide === 'left' ? 'ring-2 ring-teal-400/60 ring-inset' : ''}`}
                onClick={() => setSplitSearchSide('left')}
              >
                {splitLeftClip ? (
                  <>
                    <video
                      src={`/renders/storyboard/doc_${docId}/${splitLeftClip}`}
                      muted loop playsInline
                      className="w-full aspect-video object-cover"
                      onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); setLightbox({ type: 'video', src: `/renders/storyboard/doc_${docId}/${splitLeftClip}`, title: isPortrait ? 'Top clip' : 'Left clip' }); }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white/60 hover:text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-sm"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSplitLeftClip(''); }}
                      className="absolute top-1.5 left-1.5 p-1 rounded-md bg-black/50 text-white/60 hover:text-red-400 hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-sm"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <div className="aspect-video flex flex-col items-center justify-center gap-1.5 bg-c-elevated/30">
                    <Film className="w-5 h-5 text-c-dim/40" />
                    <span className="text-[10px] text-c-dim/60">{isPortrait ? 'Click to pick top' : 'Click to pick left'}</span>
                  </div>
                )}
                {/* Side label */}
                <div className={`absolute px-2 py-1 ${splitLabelPosition.startsWith('top') ? 'top-0' : 'bottom-0'} inset-x-0 ${splitLabelStyle === 'banner' ? (splitLabelPosition.startsWith('top') ? 'bg-gradient-to-b from-black/80 to-transparent' : 'bg-gradient-to-t from-black/80 to-transparent') : ''} ${splitLabelPosition.endsWith('right') ? 'text-right' : splitLabelPosition.endsWith('center') ? 'text-center' : 'text-left'}`}>
                  <span className={`font-bold uppercase tracking-wider ${
                    splitLabelStyle === 'badge' ? 'bg-black/70 text-white px-1.5 py-0.5 rounded' :
                    splitLabelStyle === 'outline' ? 'text-white' :
                    splitLabelStyle === 'shadow' ? 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]' :
                    'text-white'
                  }`} style={{ fontSize: `${Math.max(8, Math.round(splitLabelFontSize * 0.4))}px`, ...(splitLabelStyle === 'outline' ? { WebkitTextStroke: '1px rgba(0,0,0,0.8)' } : {}) }}>
                    {splitLeftLabel || (isPortrait ? 'Top' : 'Left')}
                  </span>
                </div>
              </div>

              {/* Middle divider */}
              {splitMiddleStyle === 'none' ? (
                <div className={`shrink-0 ${isPortrait ? 'h-1.5 w-full' : 'w-1.5'}`} style={{ background: splitAccentColor }} />
              ) : splitMiddleStyle === 'line' ? (
                <div className={`shrink-0 relative ${isPortrait ? 'h-1 w-full' : 'w-1'}`}>
                  <div className="absolute inset-0" style={{ background: splitAccentColor }} />
                </div>
              ) : splitMiddleStyle === 'slash' ? (
                <div className={`shrink-0 relative overflow-hidden ${isPortrait ? 'h-6 w-full' : 'w-6'}`} style={{ background: '#000' }}>
                  <div className="absolute inset-0" style={{ background: `linear-gradient(${isPortrait ? '245' : '155'}deg, transparent 40%, ${splitAccentColor} 40%, ${splitAccentColor} 60%, transparent 60%)` }} />
                </div>
              ) : splitMiddleStyle === 'clean' ? (
                <div className={`shrink-0 relative bg-white/30 ${isPortrait ? 'h-[3px] w-full' : 'w-[3px]'}`}>
                  <div className={`absolute flex items-center justify-center ${isPortrait ? 'inset-y-0 left-1/2 -translate-x-1/2' : 'inset-x-0 top-1/2 -translate-y-1/2'}`}>
                    {splitMiddleText && <span className="text-[8px] font-medium text-white/60 bg-black/60 px-1 py-0.5 rounded-sm whitespace-nowrap">{splitMiddleText}</span>}
                  </div>
                </div>
              ) : (
                <div className={`shrink-0 flex items-center justify-center gap-1 relative ${isPortrait
                  ? `w-full ${splitMiddleStyle === 'glow' || splitMiddleStyle === 'neon' ? 'h-12' : splitMiddleStyle === 'fire' ? 'h-14' : 'h-10'}`
                  : `flex-col ${splitMiddleStyle === 'glow' || splitMiddleStyle === 'neon' ? 'w-12' : splitMiddleStyle === 'fire' ? 'w-14' : 'w-10'}`
                }`}
                  style={{ background: splitMiddleStyle === 'glow' || splitMiddleStyle === 'neon' || splitMiddleStyle === 'fire' ? 'transparent' : splitAccentColor + '20' }}>
                  {splitMiddleStyle === 'glow' && (
                    <div className="absolute inset-0 blur-md" style={{ background: `radial-gradient(ellipse at center, ${splitAccentColor}90, transparent 70%)` }} />
                  )}
                  {splitMiddleStyle === 'neon' && (
                    <>
                      <div className="absolute inset-0 blur-lg" style={{ background: `radial-gradient(ellipse at center, ${splitAccentColor}cc, transparent 60%)` }} />
                      {isPortrait
                        ? <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px]" style={{ background: splitAccentColor, boxShadow: `0 0 8px ${splitAccentColor}, 0 0 16px ${splitAccentColor}80` }} />
                        : <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px]" style={{ background: splitAccentColor, boxShadow: `0 0 8px ${splitAccentColor}, 0 0 16px ${splitAccentColor}80` }} />
                      }
                    </>
                  )}
                  {splitMiddleStyle === 'fire' && (
                    <>
                      <div className="absolute inset-0 blur-lg" style={{ background: 'radial-gradient(ellipse at center, #ff4500cc, #ff8c0060, transparent 70%)' }} />
                      <div className="absolute inset-0 blur-sm opacity-60" style={{ background: `radial-gradient(ellipse at center ${isPortrait ? 'left' : 'bottom'}, #ffd70090, transparent 60%)` }} />
                    </>
                  )}
                  {splitMiddleStyle === 'vs' && (
                    <div className="absolute inset-0 opacity-20" style={{ background: `linear-gradient(${isPortrait ? '90' : '180'}deg, transparent, ${splitAccentColor}40, transparent)` }} />
                  )}
                  {splitMiddleText && (
                    <span className={`text-[11px] font-bold relative z-10 ${
                      splitMiddleStyle === 'badge' ? 'px-1.5 py-0.5 rounded text-white' :
                      splitMiddleStyle === 'glow' ? 'text-white drop-shadow-lg' :
                      splitMiddleStyle === 'neon' ? 'text-white font-extrabold' :
                      splitMiddleStyle === 'fire' ? 'text-yellow-200 font-extrabold' :
                      'text-white/80 drop-shadow-sm'
                    }`} style={
                      splitMiddleStyle === 'badge' ? { background: splitAccentColor + 'dd' } :
                      splitMiddleStyle === 'neon' ? { textShadow: `0 0 6px ${splitAccentColor}, 0 0 12px ${splitAccentColor}` } :
                      splitMiddleStyle === 'fire' ? { textShadow: '0 0 8px #ff4500, 0 0 16px #ff8c00, 0 0 24px #ff450080' } :
                      undefined
                    }>
                      {splitMiddleText}
                    </span>
                  )}
                </div>
              )}

              {/* Right/Bottom panel */}
              <div
                className={`flex-1 relative group cursor-pointer transition-all ${splitSearchSide === 'right' ? 'ring-2 ring-teal-400/60 ring-inset' : ''}`}
                onClick={() => setSplitSearchSide('right')}
              >
                {splitRightClip ? (
                  <>
                    <video
                      src={`/renders/storyboard/doc_${docId}/${splitRightClip}`}
                      muted loop playsInline
                      className="w-full aspect-video object-cover"
                      onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); setLightbox({ type: 'video', src: `/renders/storyboard/doc_${docId}/${splitRightClip}`, title: isPortrait ? 'Bottom clip' : 'Right clip' }); }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white/60 hover:text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-sm"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSplitRightClip(''); }}
                      className="absolute top-1.5 left-1.5 p-1 rounded-md bg-black/50 text-white/60 hover:text-red-400 hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-sm"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <div className="aspect-video flex flex-col items-center justify-center gap-1.5 bg-c-elevated/30">
                    <Film className="w-5 h-5 text-c-dim/40" />
                    <span className="text-[10px] text-c-dim/60">{isPortrait ? 'Click to pick bottom' : 'Click to pick right'}</span>
                  </div>
                )}
                <div className={`absolute px-2 py-1 ${(isPortrait ? splitRightLabelPosition : splitLabelPosition).startsWith('top') ? 'top-0' : 'bottom-0'} inset-x-0 ${splitLabelStyle === 'banner' ? ((isPortrait ? splitRightLabelPosition : splitLabelPosition).startsWith('top') ? 'bg-gradient-to-b from-black/80 to-transparent' : 'bg-gradient-to-t from-black/80 to-transparent') : ''} ${(isPortrait ? splitRightLabelPosition : splitLabelPosition).endsWith('right') ? 'text-right' : (isPortrait ? splitRightLabelPosition : splitLabelPosition).endsWith('center') ? 'text-center' : 'text-left'}`}>
                  <span className={`font-bold uppercase tracking-wider ${
                    splitLabelStyle === 'badge' ? 'bg-black/70 text-white px-1.5 py-0.5 rounded' :
                    splitLabelStyle === 'outline' ? 'text-white' :
                    splitLabelStyle === 'shadow' ? 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]' :
                    'text-white'
                  }`} style={{ fontSize: `${Math.max(8, Math.round(splitLabelFontSize * 0.4))}px`, ...(splitLabelStyle === 'outline' ? { WebkitTextStroke: '1px rgba(0,0,0,0.8)' } : {}) }}>
                    {splitRightLabel || (isPortrait ? 'Bottom' : 'Right')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Settings ── */}
          <div className="px-4 pb-3 space-y-2">
            {/* Row 1: Labels + middle text */}
            <div className="flex items-end gap-1.5">
              <div className="flex-1 min-w-[60px]">
                <label className="text-[10px] text-c-muted block mb-1">{isPortrait ? 'Top label' : 'Left label'}</label>
                <input type="text" value={splitLeftLabel} onChange={(e) => setSplitLeftLabel(e.target.value)}
                  placeholder="e.g. iPhone"
                  className="w-full text-[11px] bg-c-bg border border-c-border rounded-lg px-2.5 py-1.5 text-c-text placeholder-c-dim/50 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all" />
              </div>
              <div className="w-16">
                <label className="text-[10px] text-c-muted block mb-1">Middle</label>
                <input type="text" value={splitMiddleText} onChange={(e) => setSplitMiddleText(e.target.value)}
                  placeholder="VS"
                  className="w-full text-[11px] text-center bg-c-bg border border-c-border rounded-lg px-2 py-1.5 text-c-text placeholder-c-dim/50 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all" />
              </div>
              <div className="flex-1 min-w-[60px]">
                <label className="text-[10px] text-c-muted block mb-1">{isPortrait ? 'Bottom label' : 'Right label'}</label>
                <input type="text" value={splitRightLabel} onChange={(e) => setSplitRightLabel(e.target.value)}
                  placeholder="e.g. Samsung"
                  className="w-full text-[11px] bg-c-bg border border-c-border rounded-lg px-2.5 py-1.5 text-c-text placeholder-c-dim/50 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all" />
              </div>
            </div>
            {/* Row 2: Divider style + color */}
            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] text-c-muted block mb-1">Divider style</label>
                <div className="flex flex-wrap gap-1">
                  {(['vs', 'badge', 'glow', 'fire', 'neon', 'slash', 'clean', 'line', 'none'] as const).map((s) => (
                    <button key={s} onClick={() => setSplitMiddleStyle(s)}
                      className={`px-2 py-1 text-[10px] rounded-md transition-all cursor-pointer border ${
                        splitMiddleStyle === s ? 'bg-teal-500/20 text-teal-300 font-semibold border-teal-500/40' : 'bg-c-bg text-c-dim hover:text-c-text hover:bg-c-elevated border-c-border'
                      }`}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-c-muted block mb-1">Color</label>
                <input type="color" value={splitAccentColor} onChange={(e) => setSplitAccentColor(e.target.value)}
                  className="w-8 h-8 rounded-lg border border-c-border cursor-pointer appearance-none" style={{ padding: 2 }} />
              </div>
            </div>
            {/* Row 3: Label style + label position */}
            <div className="flex items-end gap-2">
              <div>
                <label className="text-[10px] text-c-muted block mb-1">Label style</label>
                <div className="flex gap-1">
                  {(['badge', 'outline', 'shadow', 'banner'] as const).map((s) => (
                    <button key={s} onClick={() => setSplitLabelStyle(s)}
                      className={`px-2 py-1 text-[10px] rounded-md transition-all cursor-pointer border ${
                        splitLabelStyle === s ? 'bg-teal-500/20 text-teal-300 font-semibold border-teal-500/40' : 'bg-c-bg text-c-dim hover:text-c-text hover:bg-c-elevated border-c-border'
                      }`}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-c-muted block mb-1">Font</label>
                <input type="number" value={splitLabelFontSize} onChange={(e) => setSplitLabelFontSize(Math.max(12, Math.min(72, parseInt(e.target.value) || 28)))}
                  min={12} max={72} step={2}
                  className="w-14 text-[11px] text-center bg-c-bg border border-c-border rounded-lg px-1.5 py-1.5 text-c-text focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all" />
              </div>
              <div>
                <label className="text-[10px] text-c-muted block mb-1">{isPortrait ? 'Top pos' : 'Label pos'}</label>
                <div className="grid grid-cols-3 gap-px rounded-lg border border-c-border overflow-hidden w-[66px] h-[30px]">
                  {(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const).map((pos) => (
                    <button key={pos} onClick={() => setSplitLabelPosition(pos)}
                      className={`flex items-center justify-center transition-all cursor-pointer ${
                        splitLabelPosition === pos ? 'bg-teal-500/30' : 'bg-c-bg hover:bg-c-elevated'
                      }`}
                      title={pos}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${splitLabelPosition === pos ? 'bg-teal-400' : 'bg-c-dim/40'}`} />
                    </button>
                  ))}
                </div>
              </div>
              {isPortrait && (
                <div>
                  <label className="text-[10px] text-c-muted block mb-1">Bottom pos</label>
                  <div className="grid grid-cols-3 gap-px rounded-lg border border-c-border overflow-hidden w-[66px] h-[30px]">
                    {(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const).map((pos) => (
                      <button key={pos} onClick={() => setSplitRightLabelPosition(pos)}
                        className={`flex items-center justify-center transition-all cursor-pointer ${
                          splitRightLabelPosition === pos ? 'bg-teal-500/30' : 'bg-c-bg hover:bg-c-elevated'
                        }`}
                        title={pos}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${splitRightLabelPosition === pos ? 'bg-teal-400' : 'bg-c-dim/40'}`} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Stock search bar ── */}
          <div className="mx-4 mb-2 flex items-center gap-1.5 bg-c-bg rounded-xl border border-c-border p-1">
            {(['pexels', 'pixabay', 'mixkit'] as const).map((svc) => (
              <button
                key={svc}
                onClick={() => { setSplitSearchService(svc); splitStockSearch(splitSearchQuery, svc); }}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${splitSearchService === svc
                  ? 'bg-teal-500/15 text-teal-400 shadow-sm'
                  : 'text-c-dim hover:text-c-text hover:bg-c-elevated'}`}
              >
                {svc.charAt(0).toUpperCase() + svc.slice(1)}
              </button>
            ))}
            <div className="w-px h-5 bg-c-border mx-0.5" />
            {/* Orientation toggle */}
            <div className="flex rounded-md border border-c-border overflow-hidden shrink-0">
              <button
                onClick={() => { setSplitSearchOrientation('landscape'); splitStockSearch(splitSearchQuery); }}
                className={`px-1.5 py-1 text-[11px] transition-colors cursor-pointer flex items-center gap-0.5 ${splitSearchOrientation === 'landscape' ? 'bg-teal-500 text-white' : 'bg-c-elevated text-c-muted hover:text-c-text'}`}
                title="16:9"
              >
                <span className="inline-block w-3 h-2 border border-current rounded-[1px]" />
              </button>
              <button
                onClick={() => { setSplitSearchOrientation('portrait'); splitStockSearch(splitSearchQuery); }}
                className={`px-1.5 py-1 text-[11px] transition-colors cursor-pointer border-l border-c-border flex items-center gap-0.5 ${splitSearchOrientation === 'portrait' ? 'bg-teal-500 text-white' : 'bg-c-elevated text-c-muted hover:text-c-text'}`}
                title="9:16"
              >
                <span className="inline-block w-1.5 h-3 border border-current rounded-[1px]" />
              </button>
            </div>
            <input
              type="text"
              value={splitSearchQuery}
              onChange={(e) => setSplitSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && splitStockSearch(splitSearchQuery)}
              placeholder={`Search ${splitSearchService}...`}
              className="flex-1 min-w-0 text-[11px] bg-transparent px-2 py-1 text-c-text placeholder-c-dim/50 focus:outline-none"
            />
            <button
              onClick={() => splitStockSearch(splitSearchQuery)}
              disabled={splitSearchLoading}
              className="shrink-0 p-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-400 disabled:opacity-40 transition-all cursor-pointer"
            >
              {splitSearchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Results grid */}
          {splitSearchLoading && (
            <div className={`grid gap-2 px-4 pb-3 ${splitSearchOrientation === 'landscape' ? 'grid-cols-4 sm:grid-cols-5' : 'grid-cols-5 sm:grid-cols-7'}`}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={`rounded-lg overflow-hidden bg-c-elevated/50 animate-pulse ${splitSearchOrientation === 'landscape' ? 'aspect-video' : 'aspect-[9/16]'}`} />
              ))}
            </div>
          )}
          {!splitSearchLoading && splitSearchResults.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-c-dim">
              <Film className="w-8 h-8 opacity-15" />
              <p className="text-[11px] opacity-40">Search for stock videos, then click to assign {isPortrait ? 'top or bottom' : 'left or right'}</p>
            </div>
          )}
          {!splitSearchLoading && splitSearchResults.length > 0 && (
            <div className={`grid gap-2 px-4 pb-3 ${splitSearchOrientation === 'landscape' ? 'grid-cols-4 sm:grid-cols-5' : 'grid-cols-5 sm:grid-cols-7'}`}>
              {splitSearchResults.map((c) => (
                <div key={c.id} className="relative rounded-xl overflow-hidden group bg-black ring-1 ring-white/[0.06] hover:ring-teal-400/40 transition-all">
                  {c.previewUrl || c.downloadUrl ? (
                    <PickerVideo previewUrl={c.previewUrl || c.downloadUrl!} downloadUrl={c.downloadUrl} duration={c.duration} className={splitSearchOrientation === 'landscape' ? 'aspect-video' : 'aspect-[9/16]'} />
                  ) : (
                    <img src={c.thumbnail} alt="" className={`w-full object-cover ${splitSearchOrientation === 'landscape' ? 'aspect-video' : 'aspect-[9/16]'}`} />
                  )}
                  {/* Expand button */}
                  <button
                    onClick={() => setLightbox({
                      type: 'video',
                      src: c.downloadUrl || c.previewUrl || c.thumbnail,
                      title: c.title,
                    })}
                    className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 backdrop-blur-sm text-white/60 hover:text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-all cursor-pointer pointer-events-auto z-10"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                  {/* Hover overlay with Top/Bottom (portrait) or Left/Right (landscape) split buttons */}
                  <div className={`absolute inset-0 bg-black/40 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity flex items-stretch pointer-events-none ${isPortrait ? 'flex-col' : ''}`}>
                    <button
                      onClick={() => splitSelectStock(c, 'left')}
                      disabled={!!splitDownloading}
                      className={`flex-1 flex items-center justify-center text-[11px] font-semibold text-white/80 hover:bg-teal-500/30 hover:text-white transition-all cursor-pointer pointer-events-auto ${isPortrait ? 'border-b border-white/10' : 'border-r border-white/10'}`}
                    >
                      {splitDownloading === c.id && splitSearchSide === 'left'
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : isPortrait
                          ? <><ChevronUp className="w-3.5 h-3.5" /> Top</>
                          : <><ChevronLeft className="w-3.5 h-3.5" /> Left</>}
                    </button>
                    <button
                      onClick={() => splitSelectStock(c, 'right')}
                      disabled={!!splitDownloading}
                      className="flex-1 flex items-center justify-center text-[11px] font-semibold text-white/80 hover:bg-teal-500/30 hover:text-white transition-all cursor-pointer pointer-events-auto"
                    >
                      {splitDownloading === c.id && splitSearchSide === 'right'
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : isPortrait
                          ? <>Bottom <ChevronDown className="w-3.5 h-3.5" /></>
                          : <>Right <ChevronRight className="w-3.5 h-3.5" /></>}
                    </button>
                  </div>
                  {/* Duration badge */}
                  {c.duration > 0 && (
                    <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm">
                      <span className="text-white/70 text-[9px] font-mono tabular-nums">{c.duration}s</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

        </div>
      )}

      {/* ── Stock picker panel ── */}
      {showPexelsPicker && (
        <div className="border-t border-c-border bg-c-surface">
          {/* Service tabs + search */}
          <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5 flex-wrap">
            {/* Service tabs */}
            <div className="flex rounded-md border border-c-border overflow-hidden shrink-0">
              {(['pexels', 'pixabay', 'mixkit', 'images'] as const).map((svc) => (
                <button
                  key={svc}
                  onClick={() => switchPickerService(svc)}
                  className={`px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${svc !== 'pexels' ? 'border-l border-c-border' : ''} ${pickerService === svc
                    ? svc === 'pexels' ? 'bg-c-accent text-white' : svc === 'pixabay' ? 'bg-emerald-600 text-white' : svc === 'mixkit' ? 'bg-orange-600 text-white' : 'bg-purple-600 text-white'
                    : 'bg-c-elevated text-c-muted hover:text-c-text'}`}
                >
                  {svc === 'images' ? 'Image' : svc.charAt(0).toUpperCase() + svc.slice(1)}
                </button>
              ))}
            </div>
            {/* Close button (always visible) */}
            <div className="flex-1" />
            <button
              onClick={() => setShowPexelsPicker(false)}
              className="shrink-0 p-1 rounded-md hover:bg-c-elevated text-c-dim hover:text-c-text transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Stock search + grid (all tabs including Image) */}
          {(
            <>
              <div className="px-3 pb-1.5 flex items-center gap-1.5 flex-wrap">
                {/* Orientation toggle */}
                <div className="flex rounded-md border border-c-border overflow-hidden shrink-0">
                  <button
                    onClick={() => switchPickerOrientation('landscape')}
                    className={`px-1.5 py-1 text-[11px] transition-colors cursor-pointer flex items-center gap-0.5 ${pickerOrientation === 'landscape' ? 'bg-c-accent text-white' : 'bg-c-elevated text-c-muted hover:text-c-text'}`}
                    title="16:9"
                  >
                    <span className="inline-block w-3 h-2 border border-current rounded-[1px]" />
                  </button>
                  <button
                    onClick={() => switchPickerOrientation('portrait')}
                    className={`px-1.5 py-1 text-[11px] transition-colors cursor-pointer border-l border-c-border flex items-center gap-0.5 ${pickerOrientation === 'portrait' ? 'bg-c-accent text-white' : 'bg-c-elevated text-c-muted hover:text-c-text'}`}
                    title="9:16"
                  >
                    <span className="inline-block w-1.5 h-3 border border-current rounded-[1px]" />
                  </button>
                </div>
                <input
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchPicker()}
                  className="flex-1 min-w-0 text-[11px] bg-c-elevated border border-c-border rounded-md px-2 py-1 text-c-text placeholder-c-dim focus:outline-none focus:border-c-accent/50"
                  placeholder={`Search ${pickerService}...`}
                />
                <button
                  onClick={regenPickerQuery}
                  disabled={regenningQuery || loadingPicker}
                  title="AI: regenerate search query"
                  className="shrink-0 p-1 rounded-md bg-violet-500/10 border border-violet-500/25 text-violet-300 hover:bg-violet-500/20 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {regenningQuery ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                </button>
                <button
                  onClick={searchPicker}
                  disabled={loadingPicker || regenningQuery}
                  className="shrink-0 p-1 rounded-md bg-c-accent text-white hover:bg-c-accent/80 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loadingPicker ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                </button>
              </div>
              {loadingPicker && (
                <div className={`grid gap-1.5 px-3 pb-2 ${pickerOrientation === 'portrait' ? 'grid-cols-3' : 'grid-cols-4 sm:grid-cols-5'}`}>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className={`rounded-md overflow-hidden border border-c-border bg-c-elevated animate-pulse ${pickerOrientation === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'}`} />
                  ))}
                </div>
              )}
              {!loadingPicker && pickerError && (
                <div className="flex items-center gap-2 mx-3 mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {pickerError}
                </div>
              )}
              {!loadingPicker && !pickerError && pickerCandidates.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-c-dim">
                  <Film className="w-8 h-8 opacity-20" />
                  <p className="text-xs opacity-50">No results — try a different keyword</p>
                </div>
              )}
              {!loadingPicker && pickerCandidates.length > 0 && (
                <div className={`grid gap-1.5 px-3 pb-2 ${pickerOrientation === 'portrait' ? 'grid-cols-3' : 'grid-cols-4 sm:grid-cols-5'}`}>
                  {pickerCandidates.map((c, ci) => {
                    const isApplied = block.clipAssetPath?.includes(String(c.id));
                    const isImageMode = pickerService === 'images';
                    return (
                      <div key={`${c.id}-${ci}`} className={`relative rounded-lg overflow-hidden border group bg-black transition-all ${isApplied ? 'border-c-accent ring-1 ring-c-accent/40' : 'border-c-border hover:border-c-border-hover'}`}>
                        {isImageMode ? (
                          <img src={c.thumbnail} alt={c.title || ''} className={`w-full object-cover ${pickerOrientation === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'}`} loading="lazy" />
                        ) : c.previewUrl || c.downloadUrl ? (
                          <PickerVideo previewUrl={c.previewUrl || c.downloadUrl!} downloadUrl={c.downloadUrl} duration={c.duration} className={pickerOrientation === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'} />
                        ) : (
                          <img src={c.thumbnail} alt="" className={`w-full object-cover ${pickerOrientation === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'}`} />
                        )}
                        {/* Source badge for image mode */}
                        {isImageMode && c.source && (
                          <div className={`absolute top-1 left-1 text-[9px] font-medium px-1 py-0.5 rounded ${c.source === 'pexels' ? 'bg-c-accent/80' : 'bg-emerald-600/80'} text-white`}>
                            {c.source}
                          </div>
                        )}
                        {/* Expand button */}
                        <button
                          onClick={() => setLightbox({
                            type: isImageMode ? 'image' : 'video',
                            src: isImageMode ? (c.downloadUrl || c.thumbnail) : (c.downloadUrl || c.previewUrl || c.thumbnail),
                            title: c.title,
                          })}
                          className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white/70 hover:text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-all cursor-pointer pointer-events-auto z-10"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                        {/* Apply overlay — persistent when downloading, hover otherwise */}
                        {applyingPexelsId === c.id ? (
                          <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 pointer-events-none z-10">
                            <Loader2 className="w-6 h-6 animate-spin text-c-accent" />
                            <span className="text-xs text-white font-medium">Downloading...</span>
                            <div className="w-3/4 h-1 bg-white/20 rounded-full overflow-hidden">
                              <div className="h-full bg-c-accent rounded-full animate-[progress-indeterminate_1.5s_ease-in-out_infinite]" style={{ width: '40%' }} />
                            </div>
                          </div>
                        ) : (
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 pointer-events-none">
                            <button
                              onClick={() => applyPexelsVideo(c)}
                              disabled={!!applyingPexelsId}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-c-accent text-white font-medium hover:bg-c-accent/80 disabled:opacity-50 transition-colors cursor-pointer shadow-lg pointer-events-auto"
                            >
                              <Check className="w-3 h-3" />
                              Use
                            </button>
                            {c.pageUrl && (
                              <a
                                href={c.pageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors pointer-events-auto"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="w-2.5 h-2.5" />
                                Source
                              </a>
                            )}
                          </div>
                        )}
                        {/* Bottom bar */}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 flex items-center justify-between gap-1">
                          <span className="text-white/80 text-[10px] truncate flex-1">{c.title || ''}</span>
                          {c.duration > 0 && <span className="text-white/50 text-[10px] font-mono shrink-0">{c.duration}s</span>}
                        </div>
                        {/* Applied badge */}
                        {isApplied && (
                          <div className="absolute top-1 right-7 bg-c-accent rounded-full p-0.5">
                            <Check className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Zoom effect + paste zone for Image tab */}
          {pickerService === 'images' && (
            <div className="px-3 pb-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-c-muted">Effect:</span>
                {(['zoom-in', 'zoom-out'] as const).map((z) => (
                  <button
                    key={z}
                    onClick={() => setImageZoomEffect(z)}
                    className={`text-[10px] px-2 py-0.5 rounded-md border transition-all cursor-pointer ${
                      imageZoomEffect === z
                        ? 'border-c-accent/40 bg-c-accent/10 text-c-accent font-medium'
                        : 'border-c-border bg-c-elevated text-c-dim hover:text-c-text'
                    }`}
                  >
                    {z === 'zoom-in' ? '🔍 Zoom In' : '🔎 Zoom Out'}
                  </button>
                ))}
              </div>
              {/* Paste / drop zone */}
              <div
                className={`border-2 border-dashed rounded-lg px-3 py-2.5 text-center transition-colors ${pastingImage ? 'border-c-accent/50 bg-c-accent/5' : 'border-c-border hover:border-c-accent/30'}`}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  for (const item of items) {
                    if (item.type.startsWith('image/')) {
                      e.preventDefault();
                      const file = item.getAsFile();
                      if (file) handlePasteImage(file);
                      return;
                    }
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer?.files?.[0];
                  if (file && file.type.startsWith('image/')) handlePasteImage(file);
                }}
                tabIndex={0}
              >
                {pastingImage ? (
                  <div className="flex items-center justify-center gap-1.5 text-c-accent">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-[11px]">Converting image...</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-c-dim">
                    <span className="font-medium text-c-muted">Ctrl+V</span> to paste image or <span className="font-medium text-c-muted">drag & drop</span> here
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Block card (edit controls, hidden when picker is open) ── */}
      {!showPexelsPicker && (
        <div>
          <BlockCard
            key={block.id}
            block={block}
            docId={docId}
            orientation={orientation}
            isProducing={false}
            onBlockUpdated={onBlockUpdated}
            displayLabel={(() => {
              const dn = block.displayNumber ?? (block.blockIndex + 1);
              const siblings = blocks.filter(b => (b.displayNumber ?? (b.blockIndex + 1)) === dn);
              if (siblings.length <= 1) return String(dn);
              return `${dn}${String.fromCharCode(97 + siblings.indexOf(block))}`;
            })()}
          />
        </div>
      )}

      </div>{/* end scrollable content area */}

      {/* ── Footer: progress ── */}
      <div className="shrink-0 px-3 py-1 border-t border-c-border bg-c-surface flex items-center gap-2 text-[10px] text-c-dim">
        <span className="font-mono tabular-nums">{clampedIdx + 1}/{blocks.length}</span>
        <div className="flex-1 h-0.5 bg-c-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-c-accent/50 rounded-full transition-all duration-200"
            style={{ width: `${((clampedIdx + 1) / blocks.length) * 100}%` }}
          />
        </div>
        <span className={`font-mono ${block.status === 'rendered' ? 'text-green-400' : block.status === 'error' ? 'text-red-400' : ''}`}>
          {block.status}
        </span>
      </div>

      {/* ── Lightbox modal ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer z-10"
          >
            <X className="w-5 h-5" />
          </button>
          {lightbox.title && (
            <div className="absolute top-4 left-4 text-white/70 text-sm max-w-[60%] truncate">{lightbox.title}</div>
          )}
          <div className="max-w-[90vw] max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            {lightbox.type === 'video' ? (
              <video
                src={lightbox.src}
                controls
                autoPlay
                loop
                className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
              />
            ) : (
              <img
                src={lightbox.src}
                alt={lightbox.title || ''}
                className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Picker Video (stock preview with scrub bar) ──

function PickerVideo({ previewUrl, downloadUrl, duration, className }: { previewUrl: string; downloadUrl?: string; duration: number; className?: string }) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [dur, setDur] = useState(duration || 0);
  const [hovering, setHovering] = useState(false);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Use full quality video URL when available, fall back to preview
  const videoSrc = downloadUrl || previewUrl;

  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    const tick = () => {
      if (vidRef.current && dur > 0) setProgress(vidRef.current.currentTime / dur);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, dur]);

  const seekTo = useCallback((clientX: number) => {
    if (!barRef.current || !vidRef.current || dur <= 0) return;
    const rect = barRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    vidRef.current.currentTime = frac * dur;
    setProgress(frac);
  }, [dur]);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  return (
    <div
      className={`relative w-full ${className || 'aspect-video'}`}
      onMouseEnter={() => { setHovering(true); vidRef.current?.play().then(() => setPlaying(true)).catch(() => {}); }}
      onMouseLeave={() => { setHovering(false); const v = vidRef.current; if (v) { v.pause(); v.currentTime = 0; } setPlaying(false); setProgress(0); }}
    >
      <video
        ref={vidRef}
        src={videoSrc}
        className="w-full h-full object-cover"
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => { const d = (e.currentTarget as HTMLVideoElement).duration; if (d && isFinite(d)) setDur(d); }}
      />
      {/* Scrub bar — always visible at bottom */}
      {dur > 0 && (
        <div
          className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1 pt-3 pb-1 z-20"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <span className="text-[8px] text-white/70 font-mono tabular-nums shrink-0">{fmtTime(progress * dur)}</span>
            <div
              ref={barRef}
              className="flex-1 py-1 cursor-pointer group"
              onClick={(e) => { e.stopPropagation(); seekTo(e.clientX); }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                seekTo(e.clientX);
                const onMove = (ev: MouseEvent) => seekTo(ev.clientX);
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            >
              <div className="h-0.5 bg-white/25 rounded-full overflow-hidden group-hover:h-1 transition-all">
                <div className="h-full bg-white/90 rounded-full" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
            <span className="text-[8px] text-white/50 font-mono tabular-nums shrink-0">{fmtTime(dur)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Block Card Player (mini video player with draggable audio range) ──

function BlockCardPlayer({ audioSrc, durationMs, clips, visualType, docId, blockIndex, onClipsUpdated, orientation = 'landscape' }: {
  audioSrc: string;
  durationMs: number | null;
  clips: Array<{ assetPath: string; startSec: number; endSec: number | null; sourceDurationSec?: number; label?: string }>;
  visualType: string;
  docId: string;
  blockIndex: number;
  onClipsUpdated: () => void;
  orientation?: 'landscape' | 'portrait';
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDur, setAudioDur] = useState<number>(durationMs ? durationMs / 1000 : 0);
  const [videoDur, setVideoDur] = useState<number>(0);
  const rafRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragStartSec, setDragStartSec] = useState<number | null>(null);
  const dragOffsetRef = useRef(0);

  const firstClip = clips[0] ?? null;
  const clipUrl = firstClip
    ? `/renders/storyboard/doc_${docId}/` + firstClip.assetPath
    : null;

  // The video start offset where audio begins (use drag state if actively dragging)
  const clipStartSec = dragStartSec ?? (firstClip?.startSec ?? 0);

  // Sync video position with audio during playback
  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      const video = videoRef.current;
      if (audio) {
        setAudioTime(audio.currentTime);
        // Keep video in sync: video time = clipStartSec + audio.currentTime
        if (video && videoDur > 0 && !audio.paused) {
          const targetVideoTime = clipStartSec + audio.currentTime;
          if (Math.abs(video.currentTime - targetVideoTime) > 0.3) {
            video.currentTime = targetVideoTime;
          }
        }
        if (audio.ended) {
          setPlaying(false);
          setAudioTime(0);
          if (video) { video.pause(); video.currentTime = clipStartSec; }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    if (playing) rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, clipStartSec, videoDur]);

  // Seek video to clipStartSec when it changes
  useEffect(() => {
    if (videoRef.current && videoDur > 0 && !playing) {
      videoRef.current.currentTime = clipStartSec;
    }
  }, [clipStartSec, videoDur, playing]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      videoRef.current?.pause();
      setPlaying(false);
    } else {
      if (videoRef.current) {
        videoRef.current.currentTime = clipStartSec + audioRef.current.currentTime;
        videoRef.current.play().catch(() => {});
      }
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  // ── Draggable audio range on video timeline ──
  const audioRangePct = videoDur > 0 && audioDur > 0 ? Math.min(100, (audioDur / videoDur) * 100) : 100;
  const audioRangeLeftPct = videoDur > 0 ? Math.min(100 - audioRangePct, (clipStartSec / videoDur) * 100) : 0;

  // Playback progress within the audio range
  const audioProgressPct = audioDur > 0 ? Math.min(100, (audioTime / audioDur) * 100) : 0;

  const handleRangeDragStart = (e: React.MouseEvent) => {
    if (!timelineRef.current || videoDur <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tlRect = timelineRef.current.getBoundingClientRect();
    const clickFrac = (e.clientX - tlRect.left) / tlRect.width;
    const currentStartFrac = clipStartSec / videoDur;
    dragOffsetRef.current = clickFrac - currentStartFrac;
    setDragging(true);

    const calcStart = (ev: MouseEvent) => {
      if (!timelineRef.current) return null;
      const rect = timelineRef.current.getBoundingClientRect();
      const frac = (ev.clientX - rect.left) / rect.width;
      const newStartFrac = Math.max(0, Math.min(1 - audioDur / videoDur, frac - dragOffsetRef.current));
      return parseFloat((newStartFrac * videoDur).toFixed(2));
    };

    const onMove = (ev: MouseEvent) => {
      const newStart = calcStart(ev);
      if (newStart == null) return;
      setDragStartSec(newStart);
      if (videoRef.current) videoRef.current.currentTime = newStart;
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(false);
      const newStart = calcStart(ev);
      if (newStart == null || !firstClip) { setDragStartSec(null); return; }
      const newEnd = parseFloat((newStart + audioDur).toFixed(2));
      setDragStartSec(null);
      const updated = clips.map((c, i) => i === 0 ? { ...c, startSec: newStart, endSec: newEnd } : c);
      scriptStudioApi.updateBlockClips(docId, blockIndex, updated).then(() => onClipsUpdated());
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="px-3.5 pb-2.5">
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(e) => {
          const d = (e.currentTarget as HTMLAudioElement).duration;
          if (d && isFinite(d) && d > 0) setAudioDur(d);
        }}
      />

      {clipUrl ? (
        <div className="relative rounded-lg overflow-hidden bg-black group">
          {/* Video */}
          <video
            ref={videoRef}
            src={clipUrl}
            muted
            playsInline
            preload="metadata"
            className={`w-full object-cover cursor-pointer ${orientation === 'portrait' ? 'aspect-[9/16] max-h-[400px]' : 'aspect-video'}`}
            onClick={toggle}
            onLoadedMetadata={(e) => {
              const d = (e.currentTarget as HTMLVideoElement).duration;
              if (d && isFinite(d) && d > 0) {
                setVideoDur(d);
                (e.currentTarget as HTMLVideoElement).currentTime = clipStartSec;
              }
            }}
          />
          {/* Play/pause overlay */}
          <div
            className={`absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity duration-200 pointer-events-none ${playing ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
          >
            <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              {playing
                ? <Square className="w-4 h-4 text-white fill-white" />
                : <Play className="w-4 h-4 text-white fill-white ml-0.5" />}
            </div>
          </div>

          {/* Bottom timeline with draggable audio range */}
          <div
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pt-5 pb-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-white/80 font-mono tabular-nums shrink-0">
                {formatTime(clipStartSec + audioTime)}
              </span>

              {/* Timeline track (full video duration) */}
              <div
                ref={timelineRef}
                className="flex-1 h-3 bg-white/10 rounded relative"
              >
                {/* Video duration faint ticks */}
                <div className="absolute inset-0 rounded bg-white/5" />

                {/* Draggable audio range rectangle */}
                <div
                  className={`absolute inset-y-0 rounded border transition-colors ${
                    dragging
                      ? 'bg-orange-400/40 border-orange-400/80'
                      : 'bg-orange-400/25 border-orange-400/50 hover:bg-orange-400/35 hover:border-orange-400/70'
                  }`}
                  style={{
                    left: `${audioRangeLeftPct}%`,
                    width: `${audioRangePct}%`,
                    cursor: videoDur > audioDur ? 'grab' : 'default',
                  }}
                  onMouseDown={videoDur > audioDur ? handleRangeDragStart : undefined}
                >
                  {/* Audio playback progress inside the range */}
                  <div
                    className="absolute inset-y-0 left-0 bg-orange-400/50 rounded-l transition-[width] duration-75"
                    style={{ width: `${audioProgressPct}%` }}
                  />
                  {/* Drag handle lines */}
                  {videoDur > audioDur && (
                    <>
                      <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-orange-300/70 rounded" />
                      <div className="absolute left-1.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-orange-300/70 rounded" />
                      <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-orange-300/70 rounded" />
                      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 w-px h-1.5 bg-orange-300/70 rounded" />
                    </>
                  )}
                </div>
              </div>

              <span className="text-[9px] text-white/50 font-mono tabular-nums shrink-0">
                {formatTime(videoDur)}
              </span>
            </div>
            {/* Labels */}
            <div className="flex items-center justify-between mt-0.5 px-0.5">
              <span className="text-[8px] text-orange-300/60 font-mono">
                {audioDur > 0 ? `${formatTime(audioDur)} audio` : ''}
              </span>
              <span className="text-[8px] text-white/30 font-mono">
                {videoDur > 0 ? `${formatTime(videoDur)} video` : ''}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* Audio-only fallback */
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-c-elevated/60 border border-c-border">
          <button
            onClick={toggle}
            className="w-6 h-6 rounded-full bg-blue-500/15 hover:bg-blue-500/25 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            {playing
              ? <Square className="w-2.5 h-2.5 text-blue-400 fill-blue-400" />
              : <Play className="w-2.5 h-2.5 text-blue-400 fill-blue-400 ml-px" />}
          </button>
          <div
            className="flex-1 h-1.5 bg-c-border rounded-full cursor-pointer relative group"
            onClick={(e) => {
              if (!audioRef.current || !audioDur) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              audioRef.current.currentTime = frac * audioDur;
              setAudioTime(frac * audioDur);
            }}
            onMouseMove={(e) => {
              if (e.buttons !== 1 || !audioRef.current || !audioDur) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              audioRef.current.currentTime = frac * audioDur;
              setAudioTime(frac * audioDur);
            }}
          >
            <div
              className="h-full bg-blue-500/50 rounded-full transition-[width] duration-75 relative"
              style={{ width: `${audioDur > 0 ? Math.min(100, (audioTime / audioDur) * 100) : 0}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-blue-400 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
          <span className="text-[10px] text-c-dim font-mono tabular-nums shrink-0">
            {audioTime.toFixed(1)}/{audioDur > 0 ? audioDur.toFixed(1) : '?'}s
          </span>
        </div>
      )}
    </div>
  );
}

// ── Block Structure Row (Step 1 — compact transcript-like) ──

function BlockStructureRow({ block, idx, total, docId, isProducing, displayLabel, onBlockUpdated, orientation }: {
  block: ScriptBlock; idx: number; total: number; docId: string; isProducing: boolean; displayLabel: string; onBlockUpdated: () => void; orientation: 'landscape' | 'portrait';
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const wordCount = block.narration?.split(/\s+/).filter(Boolean).length ?? 0;
  const durationSec = block.audioDurationMs ? (block.audioDurationMs / 1000) : (wordCount / 2.5);
  const hasClip = !!block.clipAssetPath;
  const hasAudio = !!block.audioPath;
  const isOpening = !!block.openingText;
  const isEmpty = !block.narration?.trim() && !isOpening;
  const isLong = durationSec > 5;
  const hasOverlay = block.overlays && block.overlays.length > 0;

  const handleAction = async (action: string, fn: () => Promise<any>) => {
    if (busy || isProducing) return;
    setBusy(action);
    setActionError(null);
    try { await fn(); onBlockUpdated(); } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Action failed';
      console.error(`BlockStructureRow ${action} failed:`, msg);
      setActionError(msg);
    }
    setBusy(null);
  };

  return (
    <div>
    <div className={`px-3 py-2 flex gap-2.5 items-center transition-colors group ${
      busy ? 'bg-c-accent/5' : isEmpty ? 'bg-red-500/5' : isLong ? 'bg-orange-500/5' : 'hover:bg-c-surface/40'
    }`}>
      {/* Block number */}
      <span className={`text-[10px] font-mono shrink-0 w-7 text-right tabular-nums ${
        isOpening ? 'text-violet-400' : 'text-c-accent/60'
      }`}>{displayLabel}</span>
      {/* Status indicators */}
      <div className="flex items-center gap-1 shrink-0" title={`${hasAudio ? 'Audio ready' : 'No audio'} · ${hasClip ? 'Clip ready' : 'No clip'}`}>
        <Mic className={`w-3 h-3 ${hasAudio ? 'text-green-400' : 'text-c-border'}`} />
        <Film className={`w-3 h-3 ${hasClip ? 'text-blue-400' : 'text-c-border'}`} />
        {hasOverlay && <span title={block.overlays.join(', ')}><TypeIcon className="w-3 h-3 text-sky-400" /></span>}
        {block.chartSpec && (() => {
          const defaultAnim = block.audioDurationMs ? (block.audioDurationMs / 1000) / 2 : 4;
          const animSec = block.chartSpec.chartAnimSec ?? defaultAnim;
          return (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-purple-500/15 text-purple-400 text-[9px] font-semibold leading-none" title={`Chart: ${block.chartSpec.type} · anim ${animSec.toFixed(1)}s`}>
              <BarChart2 className="w-2.5 h-2.5" />
              {block.chartSpec.type}
              <input
                type="number"
                min={0.5} max={60} step={0.5}
                defaultValue={parseFloat(animSec.toFixed(1))}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const val = Math.max(0.5, parseFloat(e.target.value) || defaultAnim);
                  if (val !== animSec) {
                    scriptStudioApi.updateBlock(docId, block.blockIndex, {
                      chartSpec: { ...block.chartSpec, chartAnimSec: val },
                    } as any).then(() => onBlockUpdated()).catch(() => {});
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="w-8 ml-0.5 px-0.5 py-0 bg-transparent border-b border-purple-400/30 text-purple-400/60 text-[9px] font-mono text-center outline-none focus:border-purple-400 focus:text-purple-400 transition-colors"
              />
              <span className="text-purple-400/40">s</span>
            </span>
          );
        })()}
      </div>
      {/* Narration text — inline editable */}
      {isOpening ? (
        <span className="flex-1 text-xs text-violet-400/80 italic truncate px-1">
          {block.openingText}
        </span>
      ) : (
        <input
          key={`${block.id}-${block.narration}`}
          type="text"
          defaultValue={block.narration}
          onBlur={(ev) => {
            const val = ev.target.value.trim();
            if (val !== (block.narration ?? '')) {
              handleAction('save', () => scriptStudioApi.updateBlock(docId, block.blockIndex, { narration: val }));
            }
          }}
          onKeyDown={(ev) => {
            const pos = ev.currentTarget.selectionStart ?? 0;
            const len = ev.currentTarget.value.length;
            if (ev.key === 'Enter') {
              ev.preventDefault();
              const text = ev.currentTarget.value;
              if (pos > 0 && pos < len) {
                handleAction('split', () => scriptStudioApi.splitBlockAtText(docId, block.blockIndex, text.slice(0, pos), text.slice(pos)));
              } else {
                ev.currentTarget.blur();
              }
            }
            if (ev.key === 'Backspace' && pos === 0 && ev.currentTarget.selectionEnd === 0 && idx > 0) {
              ev.preventDefault();
              handleAction('merge', () => scriptStudioApi.mergeBlockWithNext(docId, block.blockIndex - 1));
            }
          }}
          className="flex-1 text-xs text-c-muted bg-transparent border-none outline-none focus:text-c-text px-1 py-1 rounded hover:bg-c-elevated/50 focus:bg-c-elevated focus:ring-1 focus:ring-c-accent/30 transition-all"
          disabled={isProducing || !!busy}
          placeholder={isEmpty ? t('scriptStudio.studio.emptyBlock') : ''}
        />
      )}
      {/* Word count & duration */}
      <span className={`text-[10px] shrink-0 w-[4.5rem] text-right tabular-nums ${
        isEmpty ? 'text-red-400' : isLong ? 'text-orange-400 font-semibold' : 'text-c-dim'
      }`}>
        {wordCount}w{' '}
        <span className="text-c-dim/50">·</span>{' '}
        {durationSec.toFixed(1)}s
      </span>
      {/* Overlay text toggle — always visible */}
      <button
        onClick={() => setShowOverlay(v => !v)}
        className={`p-1.5 rounded-md transition-colors cursor-pointer shrink-0 ${hasOverlay || showOverlay ? 'text-sky-400 bg-sky-500/10' : 'text-c-dim/30 hover:text-sky-400 hover:bg-sky-900/20'}`}
        title={t('scriptStudio.studio.addOverlay')}
      >
        <TypeIcon className="w-3.5 h-3.5" />
      </button>
      {/* Actions — visible on hover */}
      <div className={`shrink-0 flex items-center gap-0.5 transition-opacity ${busy ? 'opacity-30 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>
        <button
          onClick={() => handleAction('insert', () => scriptStudioApi.insertBlockBefore(docId, block.blockIndex))}
          className="p-1.5 rounded-md text-c-dim hover:text-c-accent hover:bg-c-accent/10 transition-colors cursor-pointer"
          title={t('scriptStudio.studio.insertBlock')}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        {idx > 0 && (
          <button
            onClick={() => handleAction('merge', () => scriptStudioApi.mergeBlockWithNext(docId, block.blockIndex - 1))}
            className="p-1.5 rounded-md text-c-dim hover:text-amber-400 hover:bg-amber-900/20 transition-colors cursor-pointer"
            title={t('scriptStudio.studio.mergeWithPrev')}
          >
            <Merge className="w-3.5 h-3.5 -rotate-90" />
          </button>
        )}
        {idx < total - 1 && (
          <button
            onClick={() => handleAction('merge', () => scriptStudioApi.mergeBlockWithNext(docId, block.blockIndex))}
            className="p-1.5 rounded-md text-c-dim hover:text-amber-400 hover:bg-amber-900/20 transition-colors cursor-pointer"
            title={t('scriptStudio.studio.mergeWithNext')}
          >
            <Merge className="w-3.5 h-3.5 rotate-90" />
          </button>
        )}
        {wordCount > 10 && (
          <button
            onClick={() => handleAction('breakdown', () => scriptStudioApi.breakdownBlock(docId, block.blockIndex))}
            className="p-1.5 rounded-md text-c-dim hover:text-cyan-400 hover:bg-cyan-900/20 transition-colors cursor-pointer"
            title={t('scriptStudio.studio.breakdownBlock')}
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => { if (window.confirm(t('scriptStudio.studio.confirmDeleteBlock'))) handleAction('delete', () => scriptStudioApi.deleteBlock(docId, block.blockIndex)); }}
          className="p-1.5 rounded-md text-c-dim hover:text-red-400 hover:bg-red-900/20 transition-colors cursor-pointer"
          title={t('scriptStudio.studio.deleteBlock')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        {hasClip && (
          <button
            onClick={() => handleAction('reproduce', async () => {
              await scriptStudioApi.reproduceBlock(docId, block.blockIndex, orientation, 0.85, undefined, () => {}, '#7c6af5');
            })}
            className="p-1.5 rounded-md text-c-dim hover:text-green-400 hover:bg-green-900/20 transition-colors cursor-pointer"
            title={t('scriptStudio.studio.reproduce')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-c-accent shrink-0" />}
    </div>
    {/* Action error banner — selectable & copyable */}
    {actionError && (
      <div className="mx-3 mb-1 px-2 py-1 rounded bg-red-500/10 border border-red-500/20 flex items-start gap-1.5 group/err select-text">
        <p className="text-[10px] font-mono text-red-400 flex-1 break-all leading-relaxed">{actionError}</p>
        <button
          onClick={() => navigator.clipboard.writeText(actionError)}
          className="p-0.5 rounded text-red-400/60 hover:text-red-300 opacity-0 group-hover/err:opacity-100 transition-opacity shrink-0"
          title="Copy error"
        >
          <Copy className="w-3 h-3" />
        </button>
        <button
          onClick={() => setActionError(null)}
          className="p-0.5 rounded text-red-400/60 hover:text-red-300 shrink-0"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    )}
    {/* Overlay text row + style controls */}
    {(showOverlay || hasOverlay) && (
      <div className="pl-[3.25rem] pr-3 py-1.5 space-y-1.5 bg-sky-500/5">
        {/* Text input row */}
        <div className="flex gap-2 items-center">
          <TypeIcon className="w-3 h-3 text-sky-400 shrink-0" />
          <input
            key={`overlay-${block.id}-${block.overlays?.join('|')}`}
            type="text"
            defaultValue={block.overlays?.join(' | ') ?? ''}
            onBlur={(ev) => {
              const val = ev.target.value.trim();
              const newOverlays = val ? val.split('|').map(s => s.trim()).filter(Boolean) : [];
              const oldOverlays = block.overlays ?? [];
              if (JSON.stringify(newOverlays) !== JSON.stringify(oldOverlays)) {
                handleAction('overlay', () => scriptStudioApi.updateBlock(docId, block.blockIndex, { overlays: newOverlays }));
              }
            }}
            onKeyDown={(ev) => { if (ev.key === 'Enter') ev.currentTarget.blur(); if (ev.key === 'Escape') { setShowOverlay(false); } }}
            className="flex-1 text-xs text-sky-300 bg-transparent border-none outline-none focus:text-sky-200 px-1 py-0.5 rounded hover:bg-c-elevated/50 focus:bg-c-elevated focus:ring-1 focus:ring-sky-500/30 transition-all"
            placeholder={t('scriptStudio.studio.overlayPlaceholder')}
            disabled={isProducing || !!busy}
            autoFocus={showOverlay && !hasOverlay}
          />
          {hasOverlay && (
            <button
              onClick={() => handleAction('overlay', () => scriptStudioApi.updateBlock(docId, block.blockIndex, { overlays: [], overlayStyle: null }))}
              className="p-1 rounded text-c-dim hover:text-red-400 hover:bg-red-900/20 transition-colors cursor-pointer shrink-0"
              title={t('scriptStudio.studio.removeOverlay')}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Style controls row */}
        {hasOverlay && (() => {
          const st = block.overlayStyle ?? {};
          const saveStyle = (patch: Record<string, unknown>) => {
            const merged = { ...st, ...patch };
            handleAction('overlayStyle', () => scriptStudioApi.updateBlock(docId, block.blockIndex, { overlayStyle: merged }));
          };
          return (
            <div className="flex items-center gap-2 flex-wrap pl-5">
              {/* Text color */}
              <label className="flex items-center gap-1 text-[10px] text-c-dim">
                {t('scriptStudio.studio.overlayColor')}
                <input type="color" value={st.color ?? '#FFFFFF'} onChange={(e) => saveStyle({ color: e.target.value })}
                  className="w-5 h-5 rounded border border-c-border cursor-pointer bg-transparent p-0" />
              </label>
              {/* Font size */}
              <label className="flex items-center gap-1 text-[10px] text-c-dim">
                {t('scriptStudio.studio.overlaySize')}
                <select value={st.fontSize ?? 'md'} onChange={(e) => saveStyle({ fontSize: e.target.value })}
                  className="text-[10px] bg-c-elevated border border-c-border rounded px-1 py-0.5 text-c-text cursor-pointer">
                  <option value="sm">S</option>
                  <option value="md">M</option>
                  <option value="lg">L</option>
                  <option value="xl">XL</option>
                </select>
              </label>
              {/* Position */}
              <label className="flex items-center gap-1 text-[10px] text-c-dim">
                {t('scriptStudio.studio.overlayPosition')}
                <select value={st.position ?? 'center'} onChange={(e) => saveStyle({ position: e.target.value })}
                  className="text-[10px] bg-c-elevated border border-c-border rounded px-1 py-0.5 text-c-text cursor-pointer">
                  <option value="top">{t('scriptStudio.studio.posTop')}</option>
                  <option value="center">{t('scriptStudio.studio.posCenter')}</option>
                  <option value="bottom">{t('scriptStudio.studio.posBottom')}</option>
                </select>
              </label>
              {/* Background toggle */}
              <label className="flex items-center gap-1 text-[10px] text-c-dim cursor-pointer">
                <input type="checkbox" checked={st.bgEnabled ?? false} onChange={(e) => saveStyle({ bgEnabled: e.target.checked })}
                  className="w-3 h-3 rounded cursor-pointer" />
                {t('scriptStudio.studio.overlayBg')}
              </label>
              {/* Background color + opacity (only when bg enabled) */}
              {st.bgEnabled && (
                <>
                  <input type="color" value={st.bgColor ?? '#000000'} onChange={(e) => saveStyle({ bgColor: e.target.value })}
                    className="w-5 h-5 rounded border border-c-border cursor-pointer bg-transparent p-0" title={t('scriptStudio.studio.overlayBgColor')} />
                  <label className="flex items-center gap-1 text-[10px] text-c-dim">
                    {t('scriptStudio.studio.overlayBgOpacity')}
                    <input type="range" min="0.1" max="1" step="0.1" value={st.bgOpacity ?? 0.6}
                      onChange={(e) => saveStyle({ bgOpacity: parseFloat(e.target.value) })}
                      className="w-14 h-3 cursor-pointer" />
                    <span className="text-[9px] tabular-nums w-6">{((st.bgOpacity ?? 0.6) * 100).toFixed(0)}%</span>
                  </label>
                </>
              )}
            </div>
          );
        })()}
      </div>
    )}
    </div>
  );
}

// ── Block Card ──

function InsertBlockButton({ docId, blockIndex, isProducing, onInserted }: {
  docId: string; blockIndex: number; isProducing: boolean; onInserted: () => void;
}) {
  const { t } = useTranslation();
  const [inserting, setInserting] = useState(false);

  const handleInsert = async () => {
    if (inserting || isProducing) return;
    setInserting(true);
    try {
      await scriptStudioApi.insertBlockBefore(docId, blockIndex);
      onInserted();
    } catch { /* ignore */ }
    setInserting(false);
  };

  return (
    <div className="group flex items-center gap-2 py-1 -mb-1">
      <div className="flex-1 h-px bg-transparent group-hover:bg-c-accent/20 transition-colors" />
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full bg-c-accent/10 text-c-accent hover:bg-c-accent/20 border border-transparent hover:border-c-accent/30 cursor-pointer disabled:opacity-30"
        onClick={handleInsert}
        disabled={inserting || isProducing}
        title={t('scriptStudio.studio.insertBlock')}
      >
        {inserting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
      </button>
      <div className="flex-1 h-px bg-transparent group-hover:bg-c-accent/20 transition-colors" />
    </div>
  );
}

function BlockCard({ block, docId, orientation, isProducing, onBlockUpdated, displayLabel }: {
  block: ScriptBlock;
  docId: string;
  orientation: 'landscape' | 'portrait';
  isProducing: boolean;
  onBlockUpdated: () => void;
  displayLabel: string;
}) {
  const { t } = useTranslation();
  const [editingQuery, setEditingQuery] = useState(false);
  const [queryValue, setQueryValue] = useState(block.pexelsQuery ?? '');
  const [editingMotion, setEditingMotion] = useState(false);
  const [showAlts, setShowAlts] = useState(false);
  const [alts, setAlts] = useState<any[]>([]);
  const [loadingAlts, setLoadingAlts] = useState(false);
  const [altService, setAltService] = useState<'pexels' | 'pixabay' | 'mixkit' | 'remotion'>('pexels');
  const [remotionRendering, setRemotionRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingAltId, setApplyingAltId] = useState<number | string | null>(null);
  const [fetchingStock, setFetchingStock] = useState<'pexels' | 'pixabay' | null>(null);
  const [fetchLog, setFetchLog] = useState<string | null>(null);
  const [editingAiPrompt, setEditingAiPrompt] = useState(false);
  const [aiPromptValue, setAiPromptValue] = useState(block.aiPrompt ?? '');
  const [generatingAi, setGeneratingAi] = useState(false);
  const [visualTypeError, setVisualTypeError] = useState<string | null>(null);
  // Optimistic local visual type — updates immediately on toggle, syncs with prop
  const [localVisualType, setLocalVisualType] = useState(block.visualType);
  useEffect(() => { setLocalVisualType(block.visualType); }, [block.visualType]);
  const [aiGenLog, setAiGenLog] = useState<string[]>([]);
  const [reproducing, setReproducing] = useState(false);
  const [reproduceLog, setReproduceLog] = useState<string[]>([]);
  const [splittingBlock, setSplittingBlock] = useState(false);
  const [breakingDown, setBreakingDown] = useState(false);
  const [chartOpacity, setChartOpacity] = useState(0.5);
  const [chartColor, setChartColor] = useState('#7c6af5');
  const defaultAnimSec = block.audioDurationMs ? (block.audioDurationMs / 1000) / 2 : 4;
  const [animationSec, setAnimationSec] = useState(parseFloat((block.chartSpec?.chartAnimSec ?? defaultAnimSec).toFixed(1)));

  const handleReproduce = async () => {
    if (reproducing) return;
    setReproducing(true);
    setReproduceLog([]);
    try {
      const result = await scriptStudioApi.reproduceBlock(
        docId, block.blockIndex, orientation, chartOpacity,
        block.chartSpec ? animationSec : undefined,
        (msg) => setReproduceLog(prev => [...prev, msg]),
        chartColor,
      );
      if (result?.type === 'error') {
        setReproduceLog(prev => [...prev, `ERROR: ${result.error}`]);
      } else {
        setReproduceLog(prev => [...prev, '✓ Done']);
        onBlockUpdated();
      }
    } catch (err: any) {
      setReproduceLog(prev => [...prev, `ERROR: ${err.message}`]);
    }
    setReproducing(false);
  };

  const handleSplitBlock = async () => {
    if (splittingBlock) return;
    setSplittingBlock(true);
    try {
      await scriptStudioApi.splitBlock(docId, block.blockIndex);
      onBlockUpdated();
    } catch (err: any) {
      setFetchLog(`Split failed: ${err.response?.data?.error ?? err.message}`);
    }
    setSplittingBlock(false);
  };

  const handleBreakdown = async () => {
    if (breakingDown) return;
    setBreakingDown(true);
    try {
      const result = await scriptStudioApi.breakdownBlock(docId, block.blockIndex);
      setFetchLog(`Block broken down into ${result.count} blocks`);
      onBlockUpdated();
    } catch (err: any) {
      setFetchLog(`Breakdown failed: ${err.response?.data?.error ?? err.message}`);
    }
    setBreakingDown(false);
  };

  const saveQuery = async () => {
    setSaving(true);
    try {
      await scriptStudioApi.updateBlock(docId, block.blockIndex, { pexelsQuery: queryValue || null });
      onBlockUpdated();
    } catch { /* ignore */ }
    setSaving(false);
    setEditingQuery(false);
  };

  const fetchStock = async (source: 'pexels' | 'pixabay') => {
    setFetchingStock(source);
    setFetchLog(null);
    try {
      // Save existing clips before fetch (backend replaces single clip)
      const existingClips = [...blockClips];
      const data = source === 'pexels'
        ? await scriptStudioApi.fetchBlockPexels(docId, block.blockIndex, orientation)
        : await scriptStudioApi.fetchBlockPixabay(docId, block.blockIndex, orientation);
      // Append new clip to existing clips (or create first clip)
      const newClip = { assetPath: data.filename, startSec: 0, endSec: null };
      const merged = [...existingClips, newClip];
      await scriptStudioApi.updateBlockClips(docId, block.blockIndex, merged);
      setFetchLog(`${source === 'pexels' ? 'Pexels' : 'Pixabay'} clip added (${data.duration}s)`);
      onBlockUpdated();
    } catch (err: any) {
      setFetchLog(`Error: ${err.response?.data?.error ?? err.message}`);
    }
    setFetchingStock(null);
  };

  const saveMotion = async (motion: string) => {
    try {
      await scriptStudioApi.updateBlock(docId, block.blockIndex, { motion });
      onBlockUpdated();
    } catch { /* ignore */ }
    setEditingMotion(false);
  };

  const fetchAlts = async (service: 'pexels' | 'pixabay' | 'mixkit' | 'remotion' = altService) => {
    if (loadingAlts) return;
    setAltService(service);
    setShowAlts(true);
    if (service === 'remotion') return; // No search needed for remotion tab
    setLoadingAlts(true);
    try {
      const query = block.pexelsQuery || block.narration.split(/\s+/).slice(0, 4).join(' ');
      const data = await scriptStudioApi.getAlternatives(docId, query, orientation, 15, service);
      setAlts(data.candidates ?? []);
    } catch { setAlts([]); }
    setLoadingAlts(false);
  };

  const renderRemotion = async (compositionId: string, durationSec: number, props: Record<string, unknown>) => {
    if (remotionRendering) return;
    setRemotionRendering(true);
    try {
      const result = await scriptStudioApi.renderRemotion(docId, block.blockIndex, compositionId, durationSec, orientation, props);
      // Append to existing clips
      const newClip = { assetPath: result.filename, startSec: 0, endSec: null };
      const merged = blockClips.length > 0 ? [...blockClips, newClip] : [newClip];
      await scriptStudioApi.updateBlockClips(docId, block.blockIndex, merged);
      onBlockUpdated();
      setFetchLog(`Remotion ${compositionId} rendered (${result.durationSec}s)`);
    } catch (err: any) {
      setFetchLog(`Error: ${err.response?.data?.error ?? err.message}`);
    }
    setRemotionRendering(false);
  };

  const selectAlt = async (alt: { pexelsId?: number; pixabayId?: number; mixkitId?: number; downloadUrl?: string; duration: number; width: number; height: number }) => {
    const altKey = alt.pexelsId ?? alt.pixabayId ?? alt.mixkitId ?? alt.downloadUrl ?? null;
    setApplyingAltId(altKey);
    try {
      let newFilename: string | null = null;
      if (alt.pexelsId) {
        const result = await scriptStudioApi.applyPexelsById(docId, block.blockIndex, alt.pexelsId);
        newFilename = result.filename;
      } else if (alt.pixabayId && alt.downloadUrl) {
        const result = await scriptStudioApi.applyPixabayFromUrl(docId, block.blockIndex, alt.downloadUrl, alt.duration, alt.width, alt.height);
        newFilename = result.filename;
      } else if (alt.mixkitId && alt.downloadUrl) {
        const result = await scriptStudioApi.applyMixkitFromUrl(docId, block.blockIndex, alt.downloadUrl, alt.duration, alt.width, alt.height);
        newFilename = result.filename;
      }
      // Append to existing clips instead of replacing
      if (newFilename && blockClips.length > 0) {
        const merged = [...blockClips, { assetPath: newFilename, startSec: 0, endSec: null }];
        await scriptStudioApi.updateBlockClips(docId, block.blockIndex, merged);
      }
      onBlockUpdated();
    } catch { /* ignore */ }
    setApplyingAltId(null);
  };

  const saveAiPrompt = async () => {
    setSaving(true);
    try {
      await scriptStudioApi.updateBlock(docId, block.blockIndex, {
        visualType: 'ai',
        aiPrompt: aiPromptValue.trim() || '__auto__',
      });
      onBlockUpdated();
    } catch { /* ignore */ }
    setSaving(false);
    setEditingAiPrompt(false);
  };

  const setVisualType = async (vtype: 'pexels' | 'ai') => {
    if (vtype === localVisualType) return;
    setLocalVisualType(vtype); // optimistic
    setVisualTypeError(null);
    try {
      if (vtype === 'ai') {
        await scriptStudioApi.updateBlock(docId, block.blockIndex, {
          visualType: 'ai',
          aiPrompt: block.aiPrompt ?? '__auto__',
        });
      } else {
        await scriptStudioApi.updateBlock(docId, block.blockIndex, { visualType: 'pexels' });
      }
      onBlockUpdated();
    } catch (err: any) {
      setLocalVisualType(block.visualType); // revert on error
      setVisualTypeError(err.message ?? 'Failed to update visual type');
    }
  };

  const generateAi = async () => {
    setGeneratingAi(true);
    setAiGenLog([]);
    try {
      const prompt = aiPromptValue.trim() || block.aiPrompt || null;
      const result = await scriptStudioApi.generateBlockAi(docId, block.blockIndex, prompt, orientation);
      if (result?.log) {
        setAiGenLog(result.log.map((l: any) => `${l.level.toUpperCase()}: ${l.message}`));
      }
      onBlockUpdated();
    } catch (err: any) {
      setAiGenLog([`ERROR: ${err.message}`]);
    }
    setGeneratingAi(false);
  };

  const audioDurSec = block.audioDurationMs != null ? (block.audioDurationMs / 1000).toFixed(1) : null;
  const isError = block.status === 'error';

  // Detect split scene
  const isSplitBlock = block.visualType === 'split' || block.clipAssetPath?.startsWith('split_') || block.clips?.some((c: any) => c.splitSources?.length > 0);

  // Detect video < audio duration warning (skip for opening blocks — fixed 3s, no audio)
  const blockClips = block.clips?.length > 0
    ? block.clips
    : (block.clipAssetPath ? [{ assetPath: block.clipAssetPath, startSec: block.clipStartSec ?? 0, endSec: block.clipEndSec, sourceDurationSec: block.audioDurationMs ? block.audioDurationMs / 1000 : undefined }] : []);
  const clipsDur = block.openingText ? 3 : blockClips.reduce((sum: number, c: any) => {
    const start = c.startSec ?? 0;
    const end = c.endSec ?? c.sourceDurationSec ?? null;
    return sum + (end != null ? Math.max(0, end - start) : 0);
  }, 0);
  const audioDurNum = block.audioDurationMs ? block.audioDurationMs / 1000 : 0;
  const isVideoShort = !block.openingText && audioDurNum > 0 && clipsDur > 0 && clipsDur < audioDurNum - 0.5;

  return (
    <div className={`rounded-xl border transition-all ${
      isError
        ? 'bg-red-500/5 border-red-500/25'
        : block.openingText
          ? 'bg-sky-500/5 border-sky-500/25'
          : isVideoShort
            ? 'bg-amber-500/5 border-amber-500/25'
            : isSplitBlock
              ? 'bg-teal-500/5 border-teal-500/25'
              : block.status === 'rendered'
                ? 'bg-green-500/3 border-green-500/15'
                : 'bg-c-surface border-c-border hover:border-c-border-hover'
    }`}>
      {/* Header row */}
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
        {/* Block number badge */}
        <span className="min-w-5 h-5 px-1 rounded bg-c-elevated border border-c-border text-xs font-mono font-bold text-c-muted flex items-center justify-center shrink-0">
          {displayLabel}
        </span>
        {/* Segment · Scene label */}
        <span className="text-xs text-c-dim shrink-0 whitespace-nowrap tabular-nums">
          Seg {block.segmentIndex} · Sc {block.sceneNumber}
        </span>

        {/* Status pipeline */}
        <BlockStatusPipeline status={block.status} />

        {/* Chart badge */}
        {block.chartSpec && (
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-400 border border-purple-500/20">
            <BarChart2 className="w-3 h-3" />
            {block.chartSpec.type}
          </span>
        )}
        {/* AI badge */}
        {localVisualType === 'ai' && !block.chartSpec && (
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-400 border border-violet-500/20">
            <Wand2 className="w-3 h-3" />
            AI
          </span>
        )}
        {/* Opening badge */}
        {block.openingText && (
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-sky-500/15 text-sky-400 border border-sky-500/20">
            <Film className="w-3 h-3" />
            {t('scriptStudio.studio.opening')}
          </span>
        )}

        {/* Pace badge */}
        {block.paceHint && (
          <span className={`text-xs px-1.5 py-0.5 rounded-md border font-mono ${
            block.paceHint === 'slow'
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              : 'bg-orange-500/10 text-orange-400 border-orange-500/20'
          }`} title={t(`scriptStudio.studio.pace_${block.paceHint}`)}>
            {block.paceHint === 'slow' ? t('scriptStudio.studio.paceSlow') : t('scriptStudio.studio.paceFast')}
          </span>
        )}

        {/* Split scene badge */}
        {isSplitBlock && (
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-teal-500/15 text-teal-400 border border-teal-500/20">
            <Columns className="w-3 h-3" />
            Split
          </span>
        )}
        {/* Video too short warning */}
        {isVideoShort && (
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/20" title={`Video ${clipsDur.toFixed(1)}s < Audio ${audioDurNum.toFixed(1)}s`}>
            <AlertTriangle className="w-3 h-3" />
            {clipsDur.toFixed(1)}s / {audioDurNum.toFixed(1)}s
          </span>
        )}

        {/* Voice config badge */}
        {block.voiceConfig && (() => {
          const parts = block.voiceConfig.split('|').map(p => p.trim());
          const groupPart = parts.find(p => p.startsWith('group:'));
          const emotionPart = parts.find(p => p.startsWith('emotion:'));
          const groupName = groupPart?.split(':')[1]?.trim();
          const emotionName = emotionPart?.split(':')[1]?.trim();
          return (
            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono" title={block.voiceConfig}>
              <Mic className="w-3 h-3 shrink-0" />
              {groupName ? `${groupName}${emotionName ? ' · ' + emotionName : ''}` : 'voice'}
            </span>
          );
        })()}

        <div className="flex-1" />

        {/* Audio duration + engine */}
        {audioDurSec && (
          <span className="inline-flex items-center gap-1 text-xs text-blue-400/80">
            <Volume2 className="w-3 h-3" />
            {audioDurSec}s
            {block.audioEngine && (
              <span className={`px-1 py-px rounded text-[9px] font-mono ${block.audioEngine === 'omnivoice' ? 'bg-purple-500/15 text-purple-400 border border-purple-500/20' : 'bg-sky-500/15 text-sky-400 border border-sky-500/20'}`}>
                {block.audioEngine === 'omnivoice' ? 'OmniVoice' : 'edge-tts'}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Opening text banner */}
      {block.openingText && (
        <div className="mx-3.5 mb-2 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/20">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="text-sm font-semibold text-sky-300">{block.openingText}</span>
            <span className="text-[10px] text-c-dim ml-auto">3s</span>
          </div>
        </div>
      )}

      {/* Overlays (shown live on video player above) */}

      {/* Narration text (skip if identical to overlay — shown on video instead) */}
      {block.narration && !(block.overlays?.length === 1 && block.overlays[0] === block.narration) && (
        <p className="text-sm text-c-text leading-relaxed px-3.5 pb-2.5 whitespace-pre-line">{block.narration}</p>
      )}

      {/* Audio/Video player */}
      {block.audioPath && (
        <div className="relative">
          <BlockCardPlayer
            audioSrc={`/cache/block_audio/${block.audioPath}`}
            durationMs={block.audioDurationMs}
            clips={block.clips?.length > 0
              ? block.clips
              : (block.clipAssetPath ? [{ assetPath: block.clipAssetPath, startSec: block.clipStartSec ?? 0, endSec: block.clipEndSec, sourceDurationSec: block.audioDurationMs ? block.audioDurationMs / 1000 : undefined }] : [])}
            visualType={block.visualType}
            docId={docId}
            blockIndex={block.blockIndex}
            onClipsUpdated={onBlockUpdated}
            orientation={orientation}
          />
          {/* Live overlay text preview */}
          {block.overlays?.length > 0 && block.clipAssetPath && !block.renderedClipPath && (() => {
            const ost = block.overlayStyle ?? {};
            const textColor = ost.color ?? '#FFFFFF';
            const sizeMap: Record<string, string> = { sm: '0.6rem', md: '0.75rem', lg: '0.95rem', xl: '1.2rem' };
            const fs = sizeMap[ost.fontSize ?? 'md'] ?? '0.75rem';
            const pos = ost.position ?? 'center';
            const posStyle: React.CSSProperties = pos === 'top'
              ? { top: '8%', left: '50%', transform: 'translateX(-50%)' }
              : pos === 'bottom'
              ? { bottom: '20%', left: '50%', transform: 'translateX(-50%)' }
              : { top: '40%', left: '50%', transform: 'translate(-50%, -50%)' };
            const bgStyle: React.CSSProperties | undefined = ost.bgEnabled ? {
              backgroundColor: `${ost.bgColor ?? '#000000'}${Math.round((ost.bgOpacity ?? 0.6) * 255).toString(16).padStart(2, '0')}`,
              padding: '3px 10px',
              borderRadius: '4px',
            } : undefined;
            return (
              <div className="absolute pointer-events-none" style={{ ...posStyle, zIndex: 5 }}>
                <div style={bgStyle}>
                  {block.overlays.map((text, i) => (
                    <p key={i} className="font-bold text-center leading-snug whitespace-nowrap" style={{
                      color: textColor,
                      fontSize: fs,
                      textShadow: '0 0 6px rgba(0,0,0,0.8), 2px 2px 4px rgba(0,0,0,0.6)',
                    }}>{text}</p>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Reproduce controls */}
      <div className="flex flex-col gap-1 px-3.5 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
              reproducing
                ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                : 'bg-c-elevated border-c-border text-c-muted hover:text-c-text hover:border-c-border-hover'
            }`}
            onClick={handleReproduce}
            disabled={reproducing}
            title="Re-render this block"
          >
            {reproducing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {reproducing ? 'Reproducing...' : 'Reproduce'}
          </button>
          <button
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer bg-c-elevated border-c-border text-c-muted hover:text-amber-400 hover:border-amber-500/30 disabled:opacity-50"
            onClick={handleSplitBlock}
            disabled={splittingBlock || isProducing || (block.narration?.split(/\s+/).length ?? 0) < 6}
            title="Split this block into two at sentence boundary"
          >
            {splittingBlock ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
            Split
          </button>
          <button
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer bg-c-elevated border-c-border text-c-muted hover:text-orange-400 hover:border-orange-500/30 disabled:opacity-40"
            onClick={handleBreakdown}
            disabled={breakingDown || isProducing || (block.narration?.split(/[.!?]\s+/).length ?? 0) < 2}
            title={t('scriptStudio.studio.breakdownTitle')}
          >
            {breakingDown ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
            {t('scriptStudio.studio.breakdown')}
          </button>
          {block.chartSpec && (
            <>
              <label className="inline-flex items-center gap-1 text-[10px] text-c-muted" title={t('scriptStudio.studio.chartColor')}>
                <input
                  type="color"
                  value={chartColor}
                  onChange={(e) => setChartColor(e.target.value)}
                  className="w-5 h-5 rounded border border-c-border cursor-pointer"
                  style={{ padding: 0 }}
                />
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] text-c-muted" title={t('scriptStudio.studio.chartOpacity')}>
                <span>Opacity</span>
                <input
                  type="number"
                  min={0} max={1} step={0.1}
                  value={chartOpacity}
                  onChange={(e) => setChartOpacity(Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)))}
                  className="w-12 px-1 py-0.5 rounded border border-c-border bg-c-elevated text-c-text text-[10px] font-mono text-center"
                />
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] text-c-muted" title={t('scriptStudio.studio.chartAnim')}>
                <span>Anim</span>
                <input
                  type="number"
                  min={0.5} max={60} step={0.5}
                  value={animationSec}
                  onChange={(e) => setAnimationSec(Math.max(0.5, parseFloat(e.target.value) || 1))}
                  onBlur={() => {
                    if (block.chartSpec && animationSec !== (block.chartSpec.chartAnimSec ?? defaultAnimSec)) {
                      scriptStudioApi.updateBlock(docId, block.blockIndex, {
                        chartSpec: { ...block.chartSpec, chartAnimSec: animationSec },
                      } as any).then(() => onBlockUpdated()).catch(() => {});
                    }
                  }}
                  className="w-14 px-1 py-0.5 rounded border border-c-border bg-c-elevated text-c-text text-[10px] font-mono text-center"
                />
                <span>s</span>
              </label>
            </>
          )}
        </div>
        {reproduceLog.length > 0 && (
          <div className="relative max-h-28 overflow-y-auto rounded bg-c-elevated/60 border border-c-border px-2 py-1 select-text group/log">
            <button
              onClick={() => navigator.clipboard.writeText(reproduceLog.join('\n'))}
              className="absolute top-1 right-1 p-0.5 rounded bg-c-bg/80 text-c-dim hover:text-c-text opacity-0 group-hover/log:opacity-100 transition-opacity"
              title="Copy log"
            >
              <Copy className="w-3 h-3" />
            </button>
            {reproduceLog.map((line, i) => (
              <p key={i} className={`text-[10px] font-mono leading-relaxed ${
                line.startsWith('ERROR') ? 'text-red-400' : line.startsWith('✓') ? 'text-green-400' : 'text-c-dim'
              }`}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {isError && block.errorMsg && (
        <div className="mx-3.5 mb-2.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400">{block.errorMsg}</p>
        </div>
      )}

      {/* Overlays (shown in header area above) */}

      {/* Visual controls row */}
      {!block.chartSpec && (
        <div className="flex flex-col gap-1.5 px-3.5 pb-3">
          {/* Stock / AI toggle */}
          <div className="flex items-center gap-1">
            <button
              className={`text-xs px-2 py-1 rounded-l-lg border transition-all cursor-pointer ${
                localVisualType !== 'ai'
                  ? 'bg-c-accent/10 border-c-accent/30 text-c-accent font-medium'
                  : 'bg-c-elevated border-c-border text-c-muted hover:text-c-text'
              }`}
              onClick={() => setVisualType('pexels')}
              disabled={isProducing}
              title={t('scriptStudio.studio.typeStock')}
            >
              <Video className="w-3 h-3 inline mr-1" />
              {t('scriptStudio.studio.typeStock')}
            </button>
            <button
              className={`text-xs px-2 py-1 rounded-r-lg border-t border-r border-b transition-all cursor-pointer ${
                localVisualType === 'ai'
                  ? 'bg-violet-500/10 border-violet-500/30 text-violet-400 font-medium'
                  : 'bg-c-elevated border-c-border text-c-muted hover:text-c-text'
              }`}
              onClick={() => setVisualType('ai')}
              disabled={isProducing}
              title={t('scriptStudio.studio.typeAi')}
            >
              <Wand2 className="w-3 h-3 inline mr-1" />
              {t('scriptStudio.studio.typeAi')}
            </button>
          </div>

          {/* AI prompt editor */}
          {localVisualType === 'ai' && (
            <div className="flex flex-col gap-1.5">
              {editingAiPrompt ? (
                <div className="flex flex-col gap-1">
                  <textarea
                    className="input text-xs py-1 min-h-[60px] resize-none"
                    value={aiPromptValue}
                    onChange={(e) => setAiPromptValue(e.target.value)}
                    placeholder={t('scriptStudio.studio.aiPromptPlaceholder')}
                    autoFocus
                  />
                  <div className="flex items-center gap-1">
                    <button
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-c-accent text-white hover:bg-c-accent/80 transition-colors cursor-pointer"
                      onClick={saveAiPrompt}
                      disabled={saving}
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      {t('scriptStudio.studio.savePrompt')}
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded-lg bg-c-elevated text-c-muted hover:text-c-text hover:bg-c-hover transition-colors cursor-pointer"
                      onClick={() => { setEditingAiPrompt(false); setAiPromptValue(block.aiPrompt ?? ''); }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-1">
                  <button
                    className="flex-1 text-left text-xs px-2 py-1 rounded-lg bg-violet-500/5 border border-violet-500/20 text-violet-300/80 hover:border-violet-500/40 transition-all cursor-pointer truncate"
                    onClick={() => { setAiPromptValue(!block.aiPrompt || block.aiPrompt === '__auto__' ? autoFlowPrompt(block, orientation) : block.aiPrompt); setEditingAiPrompt(true); }}
                    disabled={isProducing}
                    title={block.aiPrompt || t('scriptStudio.studio.aiPromptAuto')}
                  >
                    <Pencil className="w-2.5 h-2.5 inline mr-1 opacity-60" />
                    {!block.aiPrompt || block.aiPrompt === '__auto__'
                      ? <em className="opacity-50">{t('scriptStudio.studio.aiPromptAuto')}</em>
                      : <span className="truncate">{block.aiPrompt}</span>}
                  </button>
                  <button
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-all cursor-pointer shrink-0 ${
                      generatingAi
                        ? 'bg-violet-500/10 border-violet-500/30 text-violet-400'
                        : 'bg-violet-500/15 border-violet-500/30 text-violet-400 hover:bg-violet-500/25'
                    }`}
                    onClick={generateAi}
                    disabled={isProducing || generatingAi}
                    title={t('scriptStudio.studio.generateAi')}
                  >
                    {generatingAi
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Zap className="w-3 h-3" />}
                    {t('scriptStudio.studio.generateAi')}
                  </button>
                </div>
              )}
              {/* Generation log */}
              {aiGenLog.length > 0 && (
                <div className="bg-black/30 rounded-lg px-2 py-1.5 space-y-0.5 max-h-20 overflow-y-auto">
                  {aiGenLog.map((l, i) => (
                    <p key={i} className={`text-xs font-mono ${l.startsWith('ERROR') ? 'text-red-400' : l.startsWith('SUCCESS') ? 'text-green-400' : 'text-c-dim'}`}>
                      {l}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Visual type error */}
          {visualTypeError && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
              <span className="text-xs text-red-400">{visualTypeError}</span>
            </div>
          )}

          {/* Stock controls (shown when not AI) */}
          {localVisualType !== 'ai' && (
          <><div className="flex items-center gap-1.5 flex-wrap">
          {editingQuery ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                className="input flex-1 text-xs py-1 min-w-0"
                value={queryValue}
                onChange={(e) => setQueryValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveQuery(); if (e.key === 'Escape') setEditingQuery(false); }}
                placeholder={t('scriptStudio.studio.pexelsQueryPlaceholder')}
                autoFocus
              />
              <button
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-c-accent text-white hover:bg-c-accent/80 transition-colors cursor-pointer shrink-0"
                onClick={saveQuery}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-c-elevated hover:bg-c-hover transition-colors cursor-pointer shrink-0"
                onClick={() => setEditingQuery(false)}
              >
                <X className="w-3.5 h-3.5 text-c-muted" />
              </button>
            </div>
          ) : (
            <button
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-c-elevated border border-c-border text-c-muted hover:text-c-text hover:border-c-border-hover transition-all cursor-pointer max-w-xs truncate"
              onClick={() => { setQueryValue(block.pexelsQuery ?? ''); setEditingQuery(true); }}
              disabled={isProducing}
              title={block.pexelsQuery ?? t('scriptStudio.studio.noQuery')}
            >
              <Video className="w-3 h-3 shrink-0" />
              <span className="truncate">{block.pexelsQuery || t('scriptStudio.studio.noQuery')}</span>
              <Pencil className="w-2.5 h-2.5 shrink-0 opacity-60" />
            </button>
          )}

          {/* Swap alternatives */}
          {!editingQuery && (
            <button
              className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg text-c-dim hover:text-c-accent hover:bg-c-accent/10 transition-all cursor-pointer"
              onClick={fetchAlts}
              disabled={isProducing}
              title={t('scriptStudio.studio.swap')}
            >
              <RefreshCw className={`w-3 h-3 ${loadingAlts ? 'animate-spin' : ''}`} />
              {t('scriptStudio.studio.swap')}
            </button>
          )}

          {/* Fetch buttons */}
          {!editingQuery && !isProducing && (
            <>
              <button
                className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg text-c-dim hover:text-c-accent hover:bg-c-accent/10 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => fetchStock('pexels')}
                disabled={!!fetchingStock}
                title="Fetch Pexels video"
              >
                {fetchingStock === 'pexels' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Video className="w-3 h-3" />}
                Pexels
              </button>
              <button
                className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg text-c-dim hover:text-emerald-400 hover:bg-emerald-500/10 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => fetchStock('pixabay')}
                disabled={!!fetchingStock}
                title="Fetch Pixabay video"
              >
                {fetchingStock === 'pixabay' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Video className="w-3 h-3" />}
                Pixabay
              </button>
            </>
          )}

          {/* Motion effect */}
          {editingMotion ? (
            <select
              className="input text-xs py-1 h-7"
              defaultValue={block.motion}
              onChange={(e) => saveMotion(e.target.value)}
              onBlur={() => setEditingMotion(false)}
              autoFocus
            >
              {MOTION_EFFECTS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <button
              className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-c-elevated border border-c-border text-c-dim hover:text-c-text hover:border-c-border-hover transition-all cursor-pointer"
              onClick={() => setEditingMotion(true)}
              disabled={isProducing}
              title={t('scriptStudio.studio.motion')}
            >
              <Film className="w-3 h-3" />
              {block.motion}
            </button>
          )}
          </div>

          {/* Fetch result log */}
          {fetchLog && (
            <p className={`text-xs mt-0.5 ${fetchLog.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
              {fetchLog}
            </p>
          )}
          </>
          )}
        </div>
      )}

      {/* Alternatives grid */}
      {showAlts && (
        <div className="px-3.5 pb-3 space-y-2 border-t border-c-border pt-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {(['pexels', 'pixabay', 'mixkit', 'remotion'] as const).map((svc) => (
                <button
                  key={svc}
                  className={`text-[10px] px-2 py-0.5 rounded-md border transition-all cursor-pointer ${
                    altService === svc
                      ? 'border-c-accent/40 bg-c-accent/10 text-c-accent font-medium'
                      : 'border-c-border bg-c-elevated text-c-dim hover:text-c-text'
                  }`}
                  onClick={() => fetchAlts(svc)}
                  disabled={loadingAlts}
                >
                  {svc === 'remotion' ? 'Remotion' : svc.charAt(0).toUpperCase() + svc.slice(1)}
                </button>
              ))}
            </div>
            <button className="text-xs text-c-dim hover:text-c-text cursor-pointer p-0.5 rounded hover:bg-c-elevated" onClick={() => setShowAlts(false)}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Stock video grid */}
          {altService !== 'remotion' && (
            <>
              {loadingAlts && (
                <div className="flex items-center gap-2 text-xs text-c-muted py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t('common.loading')}
                </div>
              )}
              {!loadingAlts && alts.length === 0 && (
                <p className="text-xs text-c-dim py-1">{t('scriptStudio.studio.noAlternatives')}</p>
              )}
              {alts.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {[...alts].sort((a, b) => a.duration - b.duration).map((alt) => {
                    const altKey = alt.pexelsId ?? alt.pixabayId ?? alt.mixkitId ?? alt.downloadUrl;
                    const isApplying = applyingAltId === altKey;
                    return (
                    <button
                      key={altKey}
                      className={`relative rounded-lg overflow-hidden border border-c-border hover:border-c-accent transition-all cursor-pointer group ${orientation === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'}`}
                      onClick={() => selectAlt(alt)}
                      disabled={!!applyingAltId}
                    >
                      <img src={alt.thumbnail} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                      {isApplying ? (
                        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1.5 z-10">
                          <Loader2 className="w-5 h-5 animate-spin text-c-accent" />
                          <span className="text-[10px] text-white font-medium">Downloading...</span>
                          <div className="w-3/4 h-1 bg-white/20 rounded-full overflow-hidden">
                            <div className="h-full bg-c-accent rounded-full animate-[progress-indeterminate_1.5s_ease-in-out_infinite]" style={{ width: '40%' }} />
                          </div>
                        </div>
                      ) : (
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between px-1.5 py-1">
                          <span className="text-white text-[10px] font-mono">{alt.duration}s</span>
                          <Plus className="w-3 h-3 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      )}
                    </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Remotion compositions */}
          {altService === 'remotion' && (
            <RemotionPanel
              onRender={renderRemotion}
              rendering={remotionRendering}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Remotion Panel ──

const REMOTION_COMPOSITIONS = [
  { id: 'Intro', label: 'Intro Card', icon: '🎬', fields: ['creatorName', 'tagline', 'style'] },
  { id: 'Outro', label: 'Outro / CTA', icon: '🔚', fields: ['creatorName', 'socialHandle', 'ctaText'] },
  { id: 'ChartBars', label: 'Bar Chart', icon: '📊', fields: ['title', 'sourceLabel', 'bars'] },
  { id: 'ChartLine', label: 'Line Chart', icon: '📈', fields: ['title', 'sourceLabel', 'dataPoints'] },
  { id: 'ChartBigNumber', label: 'Big Number', icon: '🔢', fields: ['value', 'prefix', 'suffix', 'label'] },
  { id: 'ChartVs', label: 'VS Compare', icon: '⚔️', fields: ['leftLabel', 'leftValue', 'rightLabel', 'rightValue', 'title'] },
] as const;

function RemotionPanel({ onRender, rendering }: {
  onRender: (compositionId: string, durationSec: number, props: Record<string, unknown>) => void;
  rendering: boolean;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(4);
  const [accentColor, setAccentColor] = useState('#7c6af5');
  const [formData, setFormData] = useState<Record<string, string>>({});

  const comp = REMOTION_COMPOSITIONS.find((c) => c.id === selected);

  const setField = (key: string, val: string) => setFormData((prev) => ({ ...prev, [key]: val }));

  const handleRender = () => {
    if (!selected || rendering) return;
    const props: Record<string, unknown> = { accentColor };

    if (selected === 'Intro') {
      props.creatorName = formData.creatorName || 'Creator';
      props.tagline = formData.tagline || undefined;
      props.style = formData.style || 'minimal';
    } else if (selected === 'Outro') {
      props.creatorName = formData.creatorName || 'Creator';
      props.socialHandle = formData.socialHandle || undefined;
      props.ctaText = formData.ctaText || 'Subscribe!';
    } else if (selected === 'ChartBars') {
      props.title = formData.title || undefined;
      props.sourceLabel = formData.sourceLabel || undefined;
      // Parse bars: "Label1:100, Label2:200"
      const barsStr = formData.bars || '';
      props.parsedData = {
        bars: barsStr.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
          const [name, val] = s.split(':').map((p) => p.trim());
          return { name: name || '?', value: parseFloat(val) || 0 };
        }),
      };
    } else if (selected === 'ChartLine') {
      props.title = formData.title || undefined;
      props.sourceLabel = formData.sourceLabel || undefined;
      // Parse points: "Jan:100, Feb:200"
      const ptsStr = formData.dataPoints || '';
      props.parsedData = {
        points: ptsStr.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
          const [label, val] = s.split(':').map((p) => p.trim());
          return { label: label || '?', value: parseFloat(val) || 0 };
        }),
      };
    } else if (selected === 'ChartBigNumber') {
      props.parsedData = {
        value: parseFloat(formData.value || '0') || 0,
        prefix: formData.prefix || undefined,
        suffix: formData.suffix || undefined,
      };
      props.title = formData.label || undefined;
    } else if (selected === 'ChartVs') {
      props.parsedData = {
        leftLabel: formData.leftLabel || 'A',
        leftValue: formData.leftValue || '0',
        rightLabel: formData.rightLabel || 'B',
        rightValue: formData.rightValue || '0',
      };
      props.title = formData.title || undefined;
    }

    onRender(selected, durationSec, props);
  };

  return (
    <div className="space-y-2">
      {/* Composition grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {REMOTION_COMPOSITIONS.map((c) => (
          <button
            key={c.id}
            className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg border text-center transition-all cursor-pointer ${
              selected === c.id
                ? 'border-c-accent/50 bg-c-accent/10 text-c-accent'
                : 'border-c-border bg-c-elevated text-c-dim hover:text-c-text hover:border-c-border-hover'
            }`}
            onClick={() => { setSelected(selected === c.id ? null : c.id); setFormData({}); }}
          >
            <span className="text-base">{c.icon}</span>
            <span className="text-[10px] font-medium leading-tight">{c.label}</span>
          </button>
        ))}
      </div>

      {/* Selected composition form */}
      {comp && (
        <div className="space-y-2 rounded-lg border border-c-border bg-c-surface p-2.5">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-c-muted">{t('scriptStudio.studio.chartColor')}</label>
            <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)}
              className="w-5 h-5 rounded border border-c-border cursor-pointer" style={{ padding: 0 }} />
            <label className="text-[10px] text-c-muted ml-2">Duration</label>
            <input type="number" min={1} max={30} step={0.5} value={durationSec}
              onChange={(e) => setDurationSec(Math.max(1, parseFloat(e.target.value) || 4))}
              className="w-12 px-1 py-0.5 rounded border border-c-border bg-c-elevated text-c-text text-[10px] font-mono text-center" />
            <span className="text-[10px] text-c-dim">s</span>
          </div>

          {/* Dynamic fields */}
          <div className="grid grid-cols-2 gap-1.5">
            {comp.fields.map((field) => (
              <div key={field}>
                <label className="text-[10px] text-c-muted block mb-0.5">{field}</label>
                {field === 'style' ? (
                  <select className="input w-full text-xs py-0.5" value={formData[field] ?? 'minimal'}
                    onChange={(e) => setField(field, e.target.value)}>
                    <option value="minimal">Minimal</option>
                    <option value="cinematic">Cinematic</option>
                    <option value="bold">Bold</option>
                  </select>
                ) : field === 'bars' || field === 'dataPoints' ? (
                  <input className="input w-full text-xs py-0.5 col-span-2" value={formData[field] ?? ''}
                    onChange={(e) => setField(field, e.target.value)}
                    placeholder="Label1:100, Label2:200, ..." />
                ) : (
                  <input className="input w-full text-xs py-0.5" value={formData[field] ?? ''}
                    onChange={(e) => setField(field, e.target.value)}
                    placeholder={field} />
                )}
              </div>
            ))}
          </div>

          <button
            className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-c-accent text-white font-medium hover:bg-c-accent/80 disabled:opacity-50 transition-colors cursor-pointer"
            onClick={handleRender}
            disabled={rendering}
          >
            {rendering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {rendering ? t('scriptStudio.studio.rendering') : t('scriptStudio.studio.renderAdd')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Settings Panel (Step 2) ──

const RATE_OPTIONS = [
  { value: '-20%', label: '-20%' },
  { value: '-10%', label: '-10%' },
  { value: '+0%',  label: '+0% (normal)' },
  { value: '+10%', label: '+10%' },
  { value: '+20%', label: '+20%' },
];

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  enabled: false, fontFamily: 'Arial', fontSize: 48, fontColor: '#FFFFFF',
  fontWeight: 'bold', strokeColor: '#000000', strokeWidth: 2,
  bgColor: '#000000', bgOpacity: 0.5, position: 'bottom', alignment: 'center',
  marginX: 40, marginBottom: 60, uppercase: false, animation: 'none',
};

const WATERMARK_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

function WatermarkPanel({ options, onChange }: { options: Record<string, any>; onChange: (k: string, v: any) => void }) {
  const { t } = useTranslation();
  const wm = options.watermark ?? { enabled: false, position: 'bottom-right', opacity: 0.8, scale: 0.08, margin: 20 };
  const setWm = (patch: Record<string, unknown>) => onChange('watermark', { ...wm, ...patch });
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: wmStatus, refetch } = useQuery({ queryKey: ['watermark-status'], queryFn: scriptStudioApi.getWatermark });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await scriptStudioApi.uploadWatermark(file);
    refetch();
    setWm({ enabled: true });
  };

  const handleDelete = async () => {
    await scriptStudioApi.deleteWatermark();
    refetch();
    setWm({ enabled: false });
  };

  return (
    <div className="rounded-lg border border-c-border bg-c-surface p-2.5 space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={wm.enabled}
          onChange={(e) => setWm({ enabled: e.target.checked })}
          className="cursor-pointer accent-c-accent"
          disabled={!wmStatus?.exists}
        />
        <Image className="w-3.5 h-3.5 text-c-muted" />
        <span className="text-sm font-medium text-c-text">{t('scriptStudio.produce.watermarkLabel')}</span>
      </label>

      {/* Logo upload / preview */}
      <div className="flex items-center gap-2 pl-1">
        {wmStatus?.exists ? (
          <>
            <img src={`/api/script-studio/watermark/image?t=${Date.now()}`} className="w-8 h-8 object-contain rounded border border-c-border bg-c-elevated" />
            <span className="text-xs text-c-dim">{t('scriptStudio.produce.watermarkUploaded')}</span>
            <button className="text-xs text-red-400 hover:text-red-300 cursor-pointer" onClick={handleDelete}>{t('scriptStudio.produce.watermarkRemove')}</button>
          </>
        ) : (
          <span className="text-xs text-c-dim">{t('scriptStudio.produce.watermarkNoLogo')}</span>
        )}
        <button
          className="text-xs text-c-accent hover:text-c-accent/80 flex items-center gap-1 cursor-pointer"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-3 h-3" />
          {t('scriptStudio.produce.watermarkUpload')}
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/webp,image/svg+xml" className="hidden" onChange={handleUpload} />
      </div>

      {wm.enabled && wmStatus?.exists && (
        <div className="grid grid-cols-3 gap-2 pl-1">
          {/* Position */}
          <div>
            <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.watermarkPosition')}</label>
            <select className="input w-full text-sm" value={wm.position ?? 'bottom-right'} onChange={(e) => setWm({ position: e.target.value })}>
              {WATERMARK_POSITIONS.map((p) => (
                <option key={p} value={p}>{t(`scriptStudio.produce.watermarkPos_${p.replace('-', '_')}`)}</option>
              ))}
            </select>
          </div>
          {/* Opacity */}
          <div>
            <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.watermarkOpacity')} ({Math.round((wm.opacity ?? 0.8) * 100)}%)</label>
            <input type="range" min={0.1} max={1} step={0.05} value={wm.opacity ?? 0.8} onChange={(e) => setWm({ opacity: Number(e.target.value) })} className="w-full accent-c-accent cursor-pointer" />
          </div>
          {/* Scale */}
          <div>
            <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.watermarkScale')} ({Math.round((wm.scale ?? 0.08) * 100)}%)</label>
            <input type="range" min={0.03} max={0.25} step={0.01} value={wm.scale ?? 0.08} onChange={(e) => setWm({ scale: Number(e.target.value) })} className="w-full accent-c-accent cursor-pointer" />
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ docId, options, onChange, onClose }: {
  docId?: string;
  options: Record<string, any>;
  onChange: (k: string, v: any) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const subtitleStyle = options.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;

  const { data: voiceData } = useQuery({ queryKey: ['tts-voices'], queryFn: ttsApi.voices });
  const { data: cachedTracks } = useQuery({ queryKey: ['music-cached'], queryFn: musicApi.cached });

  const allVoices = Object.entries(voiceData?.voices ?? {}) as [string, { lang: string; label: string; flag: string; gender: string }][];
  const langs = [...new Set(allVoices.map(([, v]) => v.lang))].sort();

  // Auto-detect language from saved voice
  const savedVoiceLang = allVoices.find(([name]) => name === options.voice)?.[1]?.lang;
  const [langFilter, setLangFilter] = useState(savedVoiceLang ?? 'en');
  useEffect(() => { if (savedVoiceLang && savedVoiceLang !== langFilter) setLangFilter(savedVoiceLang); }, [savedVoiceLang]);

  // Sort: US voices first, then by gender (female first), then alphabetical
  const filteredVoices = (langFilter ? allVoices.filter(([, v]) => v.lang === langFilter) : allVoices)
    .sort((a, b) => {
      const aUS = a[0].startsWith('en-US') ? 0 : 1;
      const bUS = b[0].startsWith('en-US') ? 0 : 1;
      if (aUS !== bUS) return aUS - bUS;
      const aG = a[1].gender === 'female' ? 0 : 1;
      const bG = b[1].gender === 'female' ? 0 : 1;
      if (aG !== bG) return aG - bG;
      return a[1].label.localeCompare(b[1].label);
    });

  // Voice demo
  const [demoPlaying, setDemoPlaying] = useState(false);
  const demoAudioRef = useRef<HTMLAudioElement | null>(null);
  const handleDemoVoice = async () => {
    const voice = options.voice;
    if (!voice || demoPlaying) return;
    setDemoPlaying(true);
    try {
      const result = await ttsApi.generate({ text: 'Hello! This is a preview of my voice.', voice, rate: options.rate ?? '+0%' });
      if (demoAudioRef.current) { demoAudioRef.current.pause(); demoAudioRef.current = null; }
      const audio = new Audio(`/api/tts/audio/${result.filename}`);
      demoAudioRef.current = audio;
      audio.onended = () => setDemoPlaying(false);
      audio.onerror = () => setDemoPlaying(false);
      await audio.play();
    } catch { setDemoPlaying(false); }
  };

  const musicEnabled = options.music?.enabled ?? false;
  const musicTrackId = options.music?.trackId ?? '';
  const musicVolumeDb = options.music?.volumeDb ?? -21;
  const setMusic = (patch: Record<string, unknown>) =>
    onChange('music', { enabled: musicEnabled, trackId: musicTrackId, volumeDb: musicVolumeDb, ...patch });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-5 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-c-accent" />
            <h3 className="text-base font-semibold text-c-text">{t('scriptStudio.studio.produceSettings')}</h3>
          </div>
          <button className="text-c-dim hover:text-c-text cursor-pointer p-1.5 rounded-lg hover:bg-c-elevated transition-colors" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {/* Voice language + Voice + Rate + Speed + Orientation + Chart Color */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {/* Voice language filter */}
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.voiceLang')}</label>
              <select className="input w-full text-sm" value={langFilter} onChange={(e) => setLangFilter(e.target.value)}>
                <option value="">{t('scriptStudio.produce.voiceLangAll')}</option>
                {langs.map((lang) => (
                  <option key={lang} value={lang}>{lang.toUpperCase()}</option>
                ))}
              </select>
            </div>

            {/* Voice select + demo */}
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.voice')}</label>
              <div className="flex items-center gap-1">
                <select className="input flex-1 text-sm min-w-0" value={options.voice ?? ''} onChange={(e) => onChange('voice', e.target.value)}>
                  <option value="">{t('scriptStudio.produce.voiceDefault')}</option>
                  {filteredVoices.map(([name, v]) => (
                    <option key={name} value={name}>{v.flag} {v.gender === 'female' ? '♀' : '♂'} {v.label}</option>
                  ))}
                </select>
                <button
                  className="shrink-0 p-1.5 rounded border border-c-border bg-c-elevated text-c-muted hover:text-c-accent hover:border-c-accent/30 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={handleDemoVoice}
                  disabled={!options.voice || demoPlaying}
                  title={t('scriptStudio.produce.demoVoice')}
                >
                  {demoPlaying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* TTS Rate */}
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.rate')}</label>
              <select className="input w-full text-sm" value={options.rate ?? '+0%'} onChange={(e) => onChange('rate', e.target.value)}>
                {RATE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* Speed Rate */}
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.speedRate')}</label>
              <select className="input w-full text-sm" value={options.speedRate ?? 1} onChange={(e) => onChange('speedRate', Number(e.target.value))}>
                {[1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2].map((r) => (
                  <option key={r} value={r}>{r}x</option>
                ))}
              </select>
            </div>

            {/* Video Format */}
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.videoFormat')}</label>
              <select className="input w-full text-sm" value={options.orientation ?? 'landscape'} onChange={(e) => onChange('orientation', e.target.value)}>
                <option value="landscape">{t('scriptStudio.produce.formatLong')}</option>
                <option value="portrait">{t('scriptStudio.produce.formatShort')}</option>
              </select>
            </div>

            {/* Chart accent color */}
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.chartColor')}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={options.accentColor ?? '#7c6af5'}
                  onChange={(e) => onChange('accentColor', e.target.value)}
                  className="w-8 h-8 rounded border border-c-border cursor-pointer"
                  style={{ padding: 0 }}
                />
                <span className="text-xs font-mono text-c-dim">{options.accentColor ?? '#7c6af5'}</span>
              </div>
            </div>
          </div>

          {/* Brightness & Contrast */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.brightness')} ({((options.brightness ?? 0) >= 0 ? '+' : '')}{((options.brightness ?? 0) * 100).toFixed(0)}%)</label>
              <input
                type="range"
                min={-0.3}
                max={0.3}
                step={0.05}
                value={options.brightness ?? 0}
                onChange={(e) => onChange('brightness', parseFloat(e.target.value))}
                className="w-full accent-c-accent cursor-pointer"
              />
            </div>
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.contrast')} ({((options.contrast ?? 1) * 100).toFixed(0)}%)</label>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={options.contrast ?? 1}
                onChange={(e) => onChange('contrast', parseFloat(e.target.value))}
                className="w-full accent-c-accent cursor-pointer"
              />
            </div>
          </div>

          {/* Row 2: Background music */}
          <div className="rounded-lg border border-c-border bg-c-surface p-2.5 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={musicEnabled}
                onChange={(e) => setMusic({ enabled: e.target.checked })}
                className="cursor-pointer accent-c-accent"
              />
              <Music2 className="w-3.5 h-3.5 text-c-muted" />
              <span className="text-sm font-medium text-c-text">{t('scriptStudio.produce.musicLabel')}</span>
            </label>
            {musicEnabled && (
              <div className="grid grid-cols-2 gap-2 pl-1">
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.musicTrack')}</label>
                  <select
                    className="input w-full text-sm"
                    value={musicTrackId}
                    onChange={(e) => setMusic({ trackId: e.target.value })}
                  >
                    <option value="">{t('scriptStudio.produce.musicNoTrack')}</option>
                    {(cachedTracks ?? []).map((tr: any) => (
                      <option key={tr.filename} value={tr.filename}>
                        {tr.filename} ({Math.round(tr.duration)}s)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-c-muted mb-1 block">{t('scriptStudio.produce.musicVolume')} ({musicVolumeDb} dB)</label>
                  <input
                    type="range"
                    min={-40}
                    max={0}
                    step={1}
                    value={musicVolumeDb}
                    onChange={(e) => setMusic({ volumeDb: Number(e.target.value) })}
                    className="w-full accent-c-accent cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Row 3: Subtitles */}
          <SubtitlePanel
            subtitleStyle={subtitleStyle}
            setSubtitleStyle={(updater) => {
              const next = typeof updater === 'function' ? updater(subtitleStyle) : updater;
              onChange('subtitleStyle', next);
              scriptStudioApi.updateSubtitleStyle(docId!, next).catch(console.error);
            }}
            saveProject={() => {/* no-op */}}
            t={t}
          />

          {/* Row 4: AI fallback */}
          <label className="flex items-center gap-2 cursor-pointer" title={t('scriptStudio.produce.aiFallbackHint')}>
            <input
              type="checkbox"
              checked={options.aiFallback === true}
              onChange={(e) => onChange('aiFallback', e.target.checked)}
              className="cursor-pointer accent-violet-500"
            />
            <Wand2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            <span className="text-sm text-c-text">{t('scriptStudio.produce.aiFallback')}</span>
            <span className="text-xs text-c-dim">— {t('scriptStudio.produce.aiFallbackHint')}</span>
          </label>

          {/* Row 5: AI long scene mode */}
          <div className="flex items-center gap-2">
            <Video className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-sm text-c-text">{t('scriptStudio.produce.aiLongScene')}</span>
            <select
              value={options.aiLongSceneMode ?? 'freeze_hold'}
              onChange={(e) => onChange('aiLongSceneMode', e.target.value)}
              className="ml-auto text-xs bg-c-elevated border border-c-border rounded px-2 py-1 text-c-text cursor-pointer"
            >
              <option value="freeze_hold">{t('scriptStudio.produce.aiLongFreezeHold')}</option>
              <option value="multi_generate">{t('scriptStudio.produce.aiLongMultiGen')}</option>
            </select>
          </div>

          {/* Row 6: Watermark / Logo */}
          <WatermarkPanel options={options} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

// ── Result View (Step 4) ──

function ResultView({ jobResult, orientation, onRerun, onRemove, docId }: {
  jobResult: any;
  orientation: 'landscape' | 'portrait';
  onRerun: () => void;
  onRemove: () => void;
  docId: string;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const SPEED_OPTIONS = [1, 2.5, 5, 7.5, 10];
  const [ytDesc, setYtDesc] = useState<string>(jobResult?.ytDescription ?? '');
  const [ytTags, setYtTags] = useState<string[]>(jobResult?.ytTags ?? []);
  const [genYt, setGenYt] = useState(false);
  const [copiedDesc, setCopiedDesc] = useState(false);
  const [copiedTags, setCopiedTags] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{ percent: number; detail: string }>({ percent: 0, detail: '' });
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResults, setExportResults] = useState<Record<string, { url: string; filename: string; sizeKB: number }>>({});
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportLogEndRef = useRef<HTMLDivElement>(null);

  const handleExport = async (preset: '2k' | '3k' | '4k') => {
    const ac = new AbortController();
    exportAbortRef.current = ac;
    setExporting(preset);
    setExportProgress({ percent: 0, detail: '' });
    setExportLogs([]);
    setExportError(null);
    try {
      const result = await scriptStudioApi.exportUpscale(docId, preset, orientation, (percent, detail) => {
        setExportProgress({ percent, detail });
        setExportLogs(prev => [...prev, detail]);
      }, ac.signal);
      setExportResults(prev => ({ ...prev, [preset]: { url: result.url, filename: result.filename, sizeKB: result.sizeKB } }));
      setExportLogs(prev => [...prev, `Done — ${(result.sizeKB / 1024).toFixed(1)} MB`]);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setExportLogs(prev => [...prev, 'Export cancelled']);
      } else {
        console.error('Export failed:', err);
        setExportError((err as Error).message);
        setExportLogs(prev => [...prev, `Error: ${(err as Error).message}`]);
      }
    }
    exportAbortRef.current = null;
    setExporting(null);
  };

  const handleStopExport = () => {
    exportAbortRef.current?.abort();
  };

  useEffect(() => {
    exportLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [exportLogs]);

  const generateYt = async () => {
    setGenYt(true);
    try {
      const data = await scriptStudioApi.generateYouTubeMetadata(docId);
      setYtDesc(data.description);
      setYtTags(data.tags);
    } catch { /* ignore */ }
    setGenYt(false);
  };

  const copyText = (text: string, setter: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
  };

  if (!jobResult?.resultUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-c-muted">
        <Film className="w-12 h-12 opacity-20" />
        <p className="text-sm">{t('scriptStudio.studio.noResult')}</p>
      </div>
    );
  }
  const isPortrait = orientation === 'portrait';

  const videoPlayer = (
    <video
      ref={videoRef}
      key={jobResult.resultUrl}
      src={jobResult.resultUrl}
      controls
      autoPlay
      onLoadedMetadata={() => { if (videoRef.current) videoRef.current.playbackRate = playbackRate; }}
      className={`rounded-xl border border-green-500/20 shadow-xl bg-black ${
        isPortrait ? 'max-h-[75vh] w-full' : 'w-full max-w-4xl'
      }`}
    />
  );

  const controlsSection = (
    <>
      <div className="flex items-center gap-2">
        <Check className="w-4 h-4 text-green-400 shrink-0" />
        <p className="text-xs text-green-400 font-medium truncate">
          {jobResult.resultFilename}
          {jobResult.resultSizeKB ? ` — ${(jobResult.resultSizeKB / 1024).toFixed(1)} MB` : ''}
        </p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${isPortrait ? 'bg-violet-500/15 text-violet-400' : 'bg-blue-500/15 text-blue-400'}`}>
          {isPortrait ? '9:16' : '16:9'}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-c-elevated rounded-lg border border-c-border px-1.5 py-1">
          {SPEED_OPTIONS.map((rate) => (
            <button
              key={rate}
              className={`text-xs px-2 py-0.5 rounded cursor-pointer transition-all ${
                playbackRate === rate
                  ? 'bg-c-accent text-white font-semibold'
                  : 'text-c-muted hover:text-c-text hover:bg-c-surface'
              }`}
              onClick={() => handleSpeedChange(rate)}
            >
              {rate}x
            </button>
          ))}
        </div>
        <a
          href={jobResult.resultUrl}
          download={jobResult.resultFilename}
          className="btn-primary flex items-center gap-2 text-xs px-3 py-1.5"
        >
          {t('scriptStudio.studio.download')}
        </a>
        <button
          className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5"
          onClick={onRerun}
        >
          {t('scriptStudio.studio.rerun')}
        </button>
        <button
          className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 text-red-500 border border-red-500/10"
          onClick={onRemove}
        >
          <Trash2 className="w-3.5 h-3.5" />
          {t('scriptStudio.studio.removeProduce')}
        </button>
      </div>

      {/* Export upscale */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-c-dim font-medium">Export:</span>
          {(['2k', '3k', '4k'] as const).map((preset) => {
            const result = exportResults[preset];
            const isExporting = exporting === preset;
            return result ? (
              <a
                key={preset}
                href={result.url}
                download={result.filename}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 transition-all"
              >
                <Check className="w-3 h-3" />
                {preset.toUpperCase()} ({(result.sizeKB / 1024).toFixed(1)} MB)
              </a>
            ) : (
              <button
                key={preset}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-c-elevated border border-c-border text-c-muted hover:text-c-text hover:border-c-border-hover transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleExport(preset)}
                disabled={isExporting || exporting !== null}
              >
                {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Maximize2 className="w-3 h-3" />}
                {preset.toUpperCase()}
              </button>
            );
          })}
          {exporting && (
            <button
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
              onClick={handleStopExport}
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          )}
        </div>
        {exporting && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-c-elevated rounded-full overflow-hidden border border-c-border">
              <div
                className="h-full bg-c-accent rounded-full transition-all duration-300"
                style={{ width: `${exportProgress.percent}%` }}
              />
            </div>
            <span className="text-xs text-c-muted whitespace-nowrap">{exportProgress.percent}%</span>
          </div>
        )}
        {exportLogs.length > 0 && (
          <div className="max-h-24 overflow-y-auto rounded-lg bg-c-bg/50 border border-c-border px-3 py-2 text-[11px] font-mono text-c-muted space-y-0.5">
            {exportLogs.map((log, i) => (
              <div key={i} className={log.startsWith('Error') ? 'text-red-400' : log.startsWith('Done') ? 'text-green-400' : ''}>{log}</div>
            ))}
            <div ref={exportLogEndRef} />
          </div>
        )}
        {exportError && (
          <p className="text-xs text-red-400">{exportError}</p>
        )}
      </div>
    </>
  );

  const metadataSection = (
    <>
      {/* Synthetic content disclosure notice */}
      {(jobResult.aiShotCount ?? 0) > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-violet-500/8 border border-violet-500/20 w-full">
          <Wand2 className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
          <p className="text-xs text-violet-300/80 leading-relaxed">
            <strong className="text-violet-300">{t('scriptStudio.studio.aiDisclosureTitle')}</strong>
            {' '}{t('scriptStudio.studio.aiDisclosureMsg', { count: jobResult.aiShotCount })}
          </p>
        </div>
      )}

      {/* YouTube Metadata */}
      <div className="w-full mt-2 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-c-text flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-red-400" />
            YouTube Metadata
          </h3>
          <button
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
            onClick={generateYt}
            disabled={genYt}
          >
            {genYt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {ytDesc ? 'Regenerate' : 'Generate'}
          </button>
        </div>

        {ytDesc && (
          <div className="space-y-3">
            {/* Description */}
            <div className="bg-c-elevated rounded-lg border border-c-border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-c-border">
                <span className="text-xs font-medium text-c-muted">Description</span>
                <button
                  className="text-xs text-c-accent hover:text-c-text flex items-center gap-1 cursor-pointer"
                  onClick={() => copyText(ytDesc, setCopiedDesc)}
                >
                  {copiedDesc ? <Check className="w-3 h-3 text-green-400" /> : <FileText className="w-3 h-3" />}
                  {copiedDesc ? 'Copied' : 'Copy'}
                </button>
              </div>
              <textarea
                className="w-full bg-transparent text-xs text-c-text p-3 resize-y min-h-[120px] max-h-[400px] outline-none"
                value={ytDesc}
                onChange={(e) => setYtDesc(e.target.value)}
                rows={10}
              />
            </div>

            {/* Tags */}
            <div className="bg-c-elevated rounded-lg border border-c-border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-c-border">
                <span className="text-xs font-medium text-c-muted">Tags ({ytTags.length})</span>
                <button
                  className="text-xs text-c-accent hover:text-c-text flex items-center gap-1 cursor-pointer"
                  onClick={() => copyText(ytTags.join(', '), setCopiedTags)}
                >
                  {copiedTags ? <Check className="w-3 h-3 text-green-400" /> : <FileText className="w-3 h-3" />}
                  {copiedTags ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="p-3 flex flex-wrap gap-1.5">
                {ytTags.map((tag, i) => (
                  <span key={i} className="text-xs bg-c-surface text-c-muted px-2 py-0.5 rounded border border-c-border">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className={`h-full overflow-y-auto p-6 ${isPortrait ? 'flex gap-6' : 'flex flex-col items-center gap-4'}`}>
      {isPortrait ? (
        <>
          <div className="shrink-0 flex flex-col items-center" style={{ maxWidth: '340px' }}>
            {videoPlayer}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {controlsSection}
            {metadataSection}
          </div>
        </>
      ) : (
        <>
          {videoPlayer}
          {controlsSection}
          {metadataSection}
        </>
      )}
    </div>
  );
}

// ── Produce Panel (Step 3 — sticky bottom) ──

function ProducePanel({
  isProducing,
  producing,
  activeProduceJob,
  jobResult,
  showSettings,
  onToggleSettings,
  onProduce,
  onStop,
}: {
  isProducing: boolean;
  producing: boolean;
  activeProduceJob: any;
  jobResult: any;
  showSettings: boolean;
  onToggleSettings: () => void;
  onProduce: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  // progress is a flat number, progressMessage is a separate field
  const pct = activeProduceJob?.progress ?? 0;
  const progressMsg = activeProduceJob?.progressMessage ?? null;

  return (
    <div className="border-t border-c-border bg-c-surface shrink-0">
      {/* Result ready indicator (video only shown on step 4) */}
      {jobResult?.resultUrl && (
        <div className="px-4 py-2 border-b border-c-border bg-green-500/5 flex items-center gap-2">
          <Check className="w-4 h-4 text-green-400 shrink-0" />
          <p className="text-xs text-green-400 font-medium truncate flex-1">
            {t('scriptStudio.studio.videoReady')}: {jobResult.resultFilename}
            {jobResult.resultSizeKB ? ` (${(jobResult.resultSizeKB / 1024).toFixed(1)} MB)` : ''}
          </p>
        </div>
      )}

      {/* Progress bar */}
      {isProducing && activeProduceJob && (
        <div className="px-4 py-2.5 border-b border-c-border bg-orange-500/5">
          <div className="flex items-center gap-2 text-sm text-orange-400 mb-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span className="flex-1 text-xs truncate">{progressMsg ?? t('scriptStudio.studio.producing')}</span>
            <span className="text-xs font-mono">{pct}%</span>
          </div>
          <div className="h-1.5 bg-c-border rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 px-4 py-3">
        {/* Settings toggle */}
        <button
          className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-all cursor-pointer ${
            showSettings
              ? 'bg-c-accent/10 border-c-accent/30 text-c-accent'
              : 'bg-c-elevated border-c-border text-c-muted hover:text-c-text hover:border-c-border-hover'
          }`}
          onClick={onToggleSettings}
        >
          <Settings className="w-4 h-4" />
          <span className="hidden sm:inline">{t('scriptStudio.studio.settings')}</span>
        </button>

        <div className="flex-1" />

        {/* Produce / Stop */}
        {isProducing ? (
          <button
            className="flex items-center gap-2 text-sm px-5 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer font-medium"
            onClick={onStop}
          >
            <Square className="w-4 h-4 fill-current" />
            {t('scriptStudio.produce.stop')}
          </button>
        ) : (
          <button
            className="flex items-center gap-2 text-sm px-5 py-2 rounded-lg bg-c-accent hover:bg-c-accent/90 text-white transition-all cursor-pointer font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onProduce}
            disabled={producing}
          >
            {producing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{t('scriptStudio.studio.produce')}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──

export default function ScriptDoc() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { liveJobs, pushNotification } = useAppStore();

  const [logExpanded, setLogExpanded] = useState(false);
  const [logsClearedAt, setLogsClearedAt] = useState('');
  const [streamLogs, setStreamLogs] = useState<LogEntry[]>([]);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'step' | 'list' | 'markdown'>('step');
  const [produceOptions, setProduceOptions] = useState<Record<string, any>>(() => ({
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE }
  }));
  const produceOptionsLoaded = useRef(false);
  const [producing, setProducing] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [fetchingAllStock, setFetchingAllStock] = useState(false);
  const [fetchAllProgress, setFetchAllProgress] = useState<string[]>([]);
  const prevResultUrlRef = useRef<string | null>(null);

  // Queries
  const docQ = useQuery({
    queryKey: ['script-studio-doc', id],
    queryFn: () => scriptStudioApi.get(id!),
    enabled: !!id,
    refetchInterval: 10_000,
  });

  const blocksQ = useQuery({
    queryKey: ['script-studio-blocks', id],
    queryFn: () => scriptStudioApi.getBlocks(id!),
    enabled: !!id,
    refetchInterval: 3_000,
  });

  const statusQ = useQuery({
    queryKey: ['script-studio-produce-status', id],
    queryFn: () => scriptStudioApi.getProduceStatus(id!),
    enabled: !!id,
    refetchInterval: 2_000,
  });

  const logsQ = useQuery({
    queryKey: ['script-studio-logs', id],
    queryFn: () => scriptStudioApi.getLogs(id!, 300),
    enabled: !!id,
    refetchInterval: 3_000,
  });

  const doc = docQ.data;

  // Load saved produce options from doc on first load
  useEffect(() => {
    produceOptionsLoaded.current = false;
  }, [id]);

  useEffect(() => {
    if (!doc || produceOptionsLoaded.current) return;
    produceOptionsLoaded.current = true;
    const saved = doc.produceOptions ?? {};
    const subtitleStyle = doc.subtitleStyle ?? saved.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;
    setProduceOptions({ ...saved, subtitleStyle });
  }, [doc]);

  // Persist produce options to backend (debounced)
  useEffect(() => {
    if (!id || !produceOptionsLoaded.current) return;
    const timer = setTimeout(() => {
      scriptStudioApi.updateProduceOptions(id, produceOptions).catch(console.error);
    }, 500);
    return () => clearTimeout(timer);
  }, [id, produceOptions]);

  // Only check OmniVoice health if the doc uses omnivoice voice groups
  const docUsesOmnivoice = !!(doc?.parsed?.voiceGroups as any[])?.some((g: any) => g.engine === 'omnivoice');
  const omnivoiceQ = useQuery({
    queryKey: ['omnivoice-health'],
    queryFn: scriptStudioApi.omnivoiceHealth,
    refetchInterval: 30_000,
    staleTime: 15_000,
    enabled: docUsesOmnivoice,
  });
  const omnivoiceReachable = docUsesOmnivoice ? (omnivoiceQ.data?.reachable ?? null) : null;
  const blocks: ScriptBlock[] = blocksQ.data ?? [];
  const produceStatus = statusQ.data;
  const storedLogs: LogEntry[] = logsQ.data ?? [];

  const activeProduceJob = produceStatus?.job ?? null;
  const isProducing = doc?.status === 'producing' || activeProduceJob?.status === 'running' || activeProduceJob?.status === 'queued';

  const displayLogs = [...storedLogs, ...streamLogs]
    .filter((l) => !logsClearedAt || l.ts > logsClearedAt)
    .sort((a, b) => a.ts.localeCompare(b.ts));

  const handleProduce = async () => {
    if (!id || producing || isProducing) return;
    setProducing(true);
    setStep(3);
    try {
      await scriptStudioApi.produce(id, produceOptions);
      qc.invalidateQueries({ queryKey: ['script-studio-produce-status', id] });
      qc.invalidateQueries({ queryKey: ['script-studio-doc', id] });
    } catch (err) {
      console.error(err);
    }
    setProducing(false);
  };

  const handleStop = async () => {
    if (!activeProduceJob) return;
    try {
      await queueApi.cancel(activeProduceJob.id);
      qc.invalidateQueries({ queryKey: ['script-studio-produce-status', id] });
      qc.invalidateQueries({ queryKey: ['script-studio-doc', id] });
    } catch { /* ignore */ }
  };

  const handleRemoveProduce = async () => {
    if (!id) return;
    if (!window.confirm(t('scriptStudio.studio.confirmRemoveProduce'))) return;
    try {
      await scriptStudioApi.deleteProduce(id);
      qc.invalidateQueries({ queryKey: ['script-studio-produce-status', id] });
      qc.invalidateQueries({ queryKey: ['script-studio-doc', id] });
      setStep(3);
    } catch (err) {
      console.error(err);
    }
  };

  const handleBlockUpdated = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['script-studio-blocks', id] });
  }, [qc, id]);

  const handleResyncBlocks = async () => {
    if (!id || resyncing) return;
    setResyncing(true);
    try {
      await scriptStudioApi.syncBlocks(id);
      qc.invalidateQueries({ queryKey: ['script-studio-blocks', id] });
    } catch (err: any) {
      pushNotification({ id: `resync-err-${Date.now()}`, type: 'error', title: err.message ?? 'Sync failed' });
    }
    setResyncing(false);
  };

  const handleFetchAllStock = async () => {
    if (!id || fetchingAllStock) return;
    const missing = blocks.filter(b => b.narration && !b.clipAssetPath && !b.openingText && b.pexelsQuery);
    if (!missing.length) return;
    setFetchingAllStock(true);
    setFetchAllProgress([`Fetching stock for ${missing.length} blocks...`]);
    for (let i = 0; i < missing.length; i++) {
      const b = missing[i];
      const label = `[${i + 1}/${missing.length}] #${b.blockIndex + 1} "${(b.pexelsQuery || '').substring(0, 40)}"`;
      try {
        setFetchAllProgress(prev => [...prev, `${label} — fetching...`]);
        await scriptStudioApi.fetchBlockPexels(id, b.blockIndex, orientation);
        setFetchAllProgress(prev => [...prev.slice(0, -1), `${label} — done ✓`]);
      } catch (err: any) {
        setFetchAllProgress(prev => [...prev.slice(0, -1), `${label} — failed: ${err.response?.data?.error ?? err.message}`]);
      }
    }
    setFetchAllProgress(prev => [...prev, `Done — ${missing.length} blocks processed`]);
    qc.invalidateQueries({ queryKey: ['script-studio-blocks', id] });
    setFetchingAllStock(false);
  };

  const totalBlocks = blocks.length;
  const audioReady = blocks.filter((b) => b.status !== 'pending' && b.status !== 'error').length;
  const rendered = blocks.filter((b) => b.status === 'rendered').length;
  const missingClips = blocks.filter(b => b.narration && !b.clipAssetPath && !b.openingText).length;

  const jobResult = activeProduceJob?.result;
  const hasResult = !!jobResult?.resultUrl;

  // Auto-advance to step 4 when production completes with a result
  useEffect(() => {
    const url = jobResult?.resultUrl;
    if (url) {
      if (url !== prevResultUrlRef.current) {
        prevResultUrlRef.current = url;
        setStep(4);
      }
    } else {
      prevResultUrlRef.current = null;
    }
  }, [jobResult?.resultUrl]);

  // Advance to step 3 when production starts
  useEffect(() => {
    if (isProducing) setStep(3);
  }, [isProducing]);

  const handleStepClick = (s: 1 | 2 | 3 | 4) => {
    if (s === 4 && !hasResult) return;
    setStep(s);
  };

  const showSettings = settingsOpen;
  const notes = doc?.parsed?.productionNotes;
  const hasNotes = !!(notes?.sourcesText || notes?.chaptersText || notes?.thumbnailText);
  const [notesOpen, setNotesOpen] = useState(false);

  // Compute display labels: blocks sharing the same displayNumber get a/b/c suffixes
  const blockDisplayLabels = useMemo(() => {
    const labels: Record<number, string> = {};
    // Group by displayNumber
    const groups = new Map<number, number[]>();
    for (const b of blocks) {
      const dn = b.displayNumber ?? (b.blockIndex + 1);
      if (!groups.has(dn)) groups.set(dn, []);
      groups.get(dn)!.push(b.blockIndex);
    }
    for (const [dn, indices] of groups) {
      if (indices.length === 1) {
        labels[indices[0]] = String(dn);
      } else {
        indices.forEach((idx, i) => {
          labels[idx] = `${dn}${String.fromCharCode(97 + i)}`; // a, b, c...
        });
      }
    }
    return labels;
  }, [blocks]);

  // Segment grouping
  const segmentGroups: Array<{ name: string; segIndex: number; blocks: ScriptBlock[] }> = [];
  for (const block of blocks) {
    const last = segmentGroups[segmentGroups.length - 1];
    if (!last || last.segIndex !== block.segmentIndex) {
      segmentGroups.push({ name: block.segmentName, segIndex: block.segmentIndex, blocks: [block] });
    } else {
      last.blocks.push(block);
    }
  }
  const orientation = (produceOptions.orientation ?? 'landscape') as 'landscape' | 'portrait';
  const ttsEngine = (produceOptions.ttsEngine ?? 'edge-tts') as 'omnivoice' | 'edge-tts';
  const setTtsEngine = (engine: 'omnivoice' | 'edge-tts') => setProduceOptions(prev => ({ ...prev, ttsEngine: engine }));

  if (docQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-c-accent" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex items-center justify-center h-full text-c-muted">
        {t('scriptStudio.docNotFound')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-c-border bg-c-surface shrink-0">
        <button
          className="text-c-muted hover:text-c-text transition-colors cursor-pointer p-1 -ml-1 rounded-lg hover:bg-c-elevated"
          onClick={() => navigate('/script-studio')}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-c-text truncate">{doc.title}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_CLASSES[doc.status] ?? 'bg-gray-500/15 text-gray-400'}`}>
              {doc.status}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${orientation === 'portrait' ? 'bg-violet-500/15 text-violet-400' : 'bg-blue-500/15 text-blue-400'}`}>
              {orientation === 'portrait' ? '9:16 Short' : '16:9 Long'}
            </span>
          </div>
        </div>
        {/* Re-sync removed: too dangerous, wipes user-assigned clips and audio */}
      </div>

      {/* ── Production Notes ── */}
      {hasNotes && (
        <div className="border-b border-c-border shrink-0 flex flex-col" style={{ maxHeight: notesOpen ? '40vh' : undefined }}>
          <button
            className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-c-elevated/50 transition-colors cursor-pointer shrink-0"
            onClick={() => setNotesOpen((v) => !v)}
          >
            <span className="text-xs font-semibold text-red-400 uppercase tracking-widest">
              # PRODUCTION NOTES
            </span>
            <div className="flex-1 h-px bg-c-border" />
            {notesOpen ? <ChevronUp className="w-3.5 h-3.5 text-c-dim shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-c-dim shrink-0" />}
          </button>
          {notesOpen && (
            <div className="px-4 pb-3 space-y-2.5 overflow-y-auto min-h-0">
              {notes?.chaptersText && (
                <div>
                  <p className="text-xs font-semibold text-c-muted mb-1">Chapter markers</p>
                  <pre className="font-mono text-xs text-c-text whitespace-pre-wrap leading-relaxed">{notes.chaptersText}</pre>
                </div>
              )}
              {notes?.thumbnailText && (
                <div>
                  <p className="text-xs font-semibold text-c-muted mb-1">Thumbnail concept</p>
                  <p className="text-xs text-c-text leading-relaxed">{notes.thumbnailText}</p>
                </div>
              )}
              {notes?.sourcesText && (
                <div>
                  <p className="text-xs font-semibold text-c-muted mb-1">Stats &amp; sources</p>
                  <pre className="font-mono text-xs text-c-text whitespace-pre-wrap leading-relaxed">{notes.sourcesText}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step indicator ── */}
      <StepIndicator
        step={step}
        totalBlocks={totalBlocks}
        audioReady={audioReady}
        rendered={rendered}
        isProducing={isProducing}
        hasResult={hasResult}
        onStepClick={handleStepClick}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen(v => !v)}
        missingClips={missingClips}
      />

      {/* ── Main content ── */}
      {step === 4 ? (
        <div className="flex-1 overflow-hidden">
          <ResultView
            jobResult={jobResult}
            orientation={orientation}
            onRerun={() => setStep(3)}
            onRemove={handleRemoveProduce}
            docId={id!}
          />
        </div>
      ) : blocks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-c-muted">
          <Film className="w-8 h-8 opacity-30" />
          <p className="text-sm">{t('scriptStudio.studio.noBlocks')}</p>
        </div>
      ) : step === 1 ? (
        /* ── Step 1: Structure — compact transcript-like block editor ── */
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-c-border bg-c-surface flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-c-text">{blocks.length} {t('scriptStudio.studio.blocks')}</span>
              <div className="h-3 w-px bg-c-border" />
              <span className="text-[10px] text-c-dim tabular-nums">
                {blocks.reduce((s, b) => s + (b.narration?.split(/\s+/).filter(Boolean).length ?? 0), 0)} {t('scriptStudio.studio.words')}
              </span>
              <span className="text-[10px] text-c-dim tabular-nums">
                ~{(blocks.reduce((s, b) => s + (b.audioDurationMs ? b.audioDurationMs / 1000 : (b.narration?.split(/\s+/).filter(Boolean).length ?? 0) / 2.5), 0)).toFixed(0)}s
              </span>
              {(() => {
                const longCount = blocks.filter(b => {
                  const wc = b.narration?.split(/\s+/).filter(Boolean).length ?? 0;
                  const dur = b.audioDurationMs ? b.audioDurationMs / 1000 : wc / 2.5;
                  return dur > 5;
                }).length;
                return longCount > 0 ? (
                  <span className="text-[10px] text-orange-400 font-medium">{longCount} {t('scriptStudio.studio.longBlocks')}</span>
                ) : null;
              })()}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleResyncBlocks}
                disabled={resyncing}
                className="text-[10px] text-c-dim hover:text-c-muted flex items-center gap-1 px-2 py-1 rounded-md hover:bg-c-elevated transition-colors cursor-pointer"
                title={t('scriptStudio.studio.resyncBlocks')}
              >
                <RefreshCw className={`w-3 h-3 ${resyncing ? 'animate-spin' : ''}`} /> {t('scriptStudio.studio.resyncBlocks')}
              </button>
              <button onClick={() => setStep(2)} className="btn-primary text-xs flex items-center gap-1.5 h-8 px-4 cursor-pointer">
                {t('scriptStudio.studio.reviewBlocks')} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {segmentGroups.map((group) => {
              const segWords = group.blocks.reduce((s, b) => s + (b.narration?.split(/\s+/).filter(Boolean).length ?? 0), 0);
              const segDur = group.blocks.reduce((s, b) => s + (b.audioDurationMs ? b.audioDurationMs / 1000 : (b.narration?.split(/\s+/).filter(Boolean).length ?? 0) / 2.5), 0);
              return (
                <div key={group.segIndex}>
                  <div className="flex items-center gap-2 px-4 py-2 bg-c-elevated/60 border-b border-c-border sticky top-0 z-10 backdrop-blur-sm">
                    <div className="w-1 h-4 rounded-full bg-c-accent/60 shrink-0" />
                    <span className="text-[10px] font-bold text-c-accent uppercase tracking-wider">{group.name}</span>
                    <div className="flex-1 h-px bg-c-border/50" />
                    <span className="text-[10px] text-c-dim tabular-nums">{group.blocks.length} · {segWords}w · {segDur.toFixed(0)}s</span>
                  </div>
                  <div className="divide-y divide-c-border/30">
                    {group.blocks.map((block) => (
                      <BlockStructureRow
                        key={block.id}
                        block={block}
                        idx={blocks.indexOf(block)}
                        total={blocks.length}
                        docId={id!}
                        isProducing={isProducing}
                        displayLabel={blockDisplayLabels[block.blockIndex] ?? String(block.blockIndex + 1)}
                        onBlockUpdated={handleBlockUpdated}
                        orientation={orientation}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* View-mode toggle (step 2 only) */}
          {step === 2 && !isProducing && (
            <div className="flex items-center justify-between px-4 py-1.5 border-b border-c-border bg-c-surface/50 shrink-0">
              <span className="text-xs text-c-dim">
                {viewMode === 'step' ? t('scriptStudio.studio.viewStep') : viewMode === 'markdown' ? t('scriptStudio.studio.viewMarkdown') : t('scriptStudio.studio.viewList')}
              </span>
              <div className="flex items-center gap-1">
                <button
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${viewMode === 'markdown' ? 'border-c-accent/40 bg-c-accent/10 text-c-accent' : 'border-c-border bg-c-elevated text-c-muted hover:text-c-text hover:border-c-border-hover'}`}
                  onClick={() => setViewMode((v) => v === 'markdown' ? 'step' : 'markdown')}
                >
                  <FileText className="w-3.5 h-3.5" />{t('scriptStudio.studio.switchMarkdown')}
                </button>
                {viewMode !== 'markdown' && (
                  <button
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-c-border bg-c-elevated text-c-muted hover:text-c-text hover:border-c-border-hover transition-all cursor-pointer"
                    onClick={() => setViewMode((v) => v === 'step' ? 'list' : 'step')}
                  >
                    {viewMode === 'step'
                      ? <><List className="w-3.5 h-3.5" />{t('scriptStudio.studio.switchList')}</>
                      : <><Rows3 className="w-3.5 h-3.5" />{t('scriptStudio.studio.switchStep')}</>
                    }
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Markdown raw view */}
          {step === 2 && viewMode === 'markdown' ? (
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="font-mono text-xs text-c-text leading-relaxed whitespace-pre-wrap break-words bg-c-elevated border border-c-border rounded-xl p-4">
                {doc.rawMarkdown ?? ''}
              </pre>
            </div>
          ) : /* Step-by-step editor */
          step === 2 && viewMode === 'step' && !isProducing ? (
            <div className="flex-1 overflow-hidden">
              <BlockStepEditor
                blocks={blocks}
                docId={id!}
                orientation={orientation}
                onBlockUpdated={handleBlockUpdated}
                ttsEngine={ttsEngine}
                onTtsEngineChange={setTtsEngine}
                voice={produceOptions.voice}
                rate={produceOptions.rate}
              />
            </div>
          ) : (
            /* List view */
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 space-y-5">
                {/* Fetch all stock bar */}
                {(() => {
                  const missingStockCount = blocks.filter(b => b.narration && !b.clipAssetPath && !b.openingText && b.pexelsQuery).length;
                  return (missingStockCount > 0 || fetchAllProgress.length > 0) ? (
                    <div className="border border-c-border rounded-lg p-2.5 bg-c-surface/50 space-y-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleFetchAllStock}
                          disabled={fetchingAllStock || isProducing || missingStockCount === 0}
                          className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50 py-1.5 px-3"
                        >
                          {fetchingAllStock ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />}
                          {t('scriptStudio.studio.fetchAllStock')}
                        </button>
                        <span className="text-xs text-c-dim">
                          {missingStockCount} {t('scriptStudio.studio.blocksMissingClip')}
                        </span>
                      </div>
                      {fetchAllProgress.length > 0 && (
                        <div className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                          {fetchAllProgress.map((line, i) => <div key={i}>{line}</div>)}
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}
                {segmentGroups.map((group) => (
                  <div key={group.segIndex}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-1.5 h-4 rounded-full bg-c-accent/50 shrink-0" />
                      <span className="text-xs font-semibold text-c-accent uppercase tracking-widest">
                        {group.name}
                      </span>
                      <div className="flex-1 h-px bg-c-border" />
                      <span className="text-xs text-c-dim">{group.blocks.length} {t('scriptStudio.studio.blocks')}</span>
                    </div>
                    <div className="space-y-2 ml-1">
                      {group.blocks.map((block) => (
                        <div key={block.id}>
                          <InsertBlockButton docId={id!} blockIndex={block.blockIndex} isProducing={isProducing} onInserted={handleBlockUpdated} />
                          <BlockCard
                            block={block}
                            docId={id!}
                            orientation={orientation}
                            isProducing={isProducing}
                            onBlockUpdated={handleBlockUpdated}
                            displayLabel={blockDisplayLabels[block.blockIndex] ?? String(block.blockIndex + 1)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Produce panel (step 3 only) */}
      {step === 3 && (
        <>
          <ProducePanel
            isProducing={isProducing}
            producing={producing}
            activeProduceJob={activeProduceJob}
            jobResult={jobResult}
            showSettings={showSettings}
            onToggleSettings={() => setSettingsOpen(v => !v)}
            onProduce={handleProduce}
            onStop={handleStop}
          />
          <ActivityLog
            logs={displayLogs}
            expanded={logExpanded}
            onToggle={() => setLogExpanded((v) => !v)}
            onClear={() => { setStreamLogs([]); setLogsClearedAt(new Date().toISOString()); }}
          />
        </>
      )}

      {/* ── Settings Modal ── */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSettingsOpen(false)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] mx-4 rounded-2xl border border-c-border bg-c-surface shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* OmniVoice health banners */}
            {omnivoiceReachable === false && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs text-amber-400">{t('scriptStudio.studio.omnivoiceOffline')}</span>
              </div>
            )}
            {omnivoiceReachable === true && (
              <div className="mx-4 mt-3 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                <span className="text-xs text-green-400">{t('scriptStudio.studio.omnivoiceOnline')}</span>
              </div>
            )}
            <SettingsPanel
              docId={id}
              options={produceOptions}
              onChange={(k, v) => setProduceOptions((prev) => ({ ...prev, [k]: v }))}
              onClose={() => setSettingsOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
