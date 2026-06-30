import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { videosApi, libraryApi, musicApi, exportApi, type EpidemicTrack } from '../lib/api';
import { DistributeModal } from '../components/distribution/DistributeModal';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { StatusDot } from '../components/ui/StatusDot';
import { Spinner } from '../components/ui/Spinner';
import { useAppStore } from '../store';
import {
  Play,
  Zap,
  RefreshCw,
  Download,
  Clock,
  Wand2,
  Film,
  Brain,
  Settings2,
  Play as PlayIcon,
  Pencil,
  Trash2,
  Check,
  X,
  Crop,
  List,
  LayoutGrid,
  GripVertical,
  Scissors,
  Wrench,
  EyeOff,
  Undo2,
  Redo2,
  Sparkles,
  Copy,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Save,
  CheckCircle2,
  CircleDashed,
  Send,
  Volume2,
  Pause,
  Music,
} from 'lucide-react';
import type { VideoProject, SceneLine, SceneMood, SceneStyle, BlurRegion, TextOverlay } from '@videocloudai/shared';
import { Type } from 'lucide-react';
import { clsx } from 'clsx';
import {
  PresetBar,
  AIRecommendationSidebar,
  SceneSplitter,
  TransformPanel,
  useEditorAnalysis,
  useEditorAIStore,
} from '../features/editor-ai';
import { EFFECT_LABELS } from '../features/editor-ai';
import { EditorVideoPlayer } from '../components/player/EditorVideoPlayer';
import { useState, useEffect, useRef, useMemo, useCallback, type RefObject } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function formatHms(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const EDITOR_MUSIC_MOODS = [
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

export function VideoEditor() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const videoId = searchParams.get('video');
  const queryClient = useQueryClient();
  const { pushNotification, liveJobs } = useAppStore();
  const { activeTab, setActiveTab, recommendations, dismissedIds, appliedEdits, globalSubtitleStyle, currentTime, requestSeek, videoDuration } =
    useEditorAIStore();

  const [timelineLayout, setTimelineLayout] = useState<'vertical' | 'horizontal'>('horizontal');

  // Undo / Redo
  type HistoryEntry = { scenes: SceneLine[]; blurRegions: BlurRegion[] };
  const [undoPast, setUndoPast] = useState<HistoryEntry[]>([]);
  const [undoFuture, setUndoFuture] = useState<HistoryEntry[]>([]);
  // project is declared later via useQuery; ref is updated after that declaration
  const undoStateRef = useRef<{ past: HistoryEntry[]; future: HistoryEntry[]; project: { scenes: SceneLine[]; blurRegions?: BlurRegion[] } | undefined }>({ past: [], future: [], project: undefined });

  // Trim state
  const [trimMode, setTrimMode] = useState(false);
  const [trimIn, setTrimIn] = useState<number | null>(null);
  const [trimOut, setTrimOut] = useState<number | null>(null);

  // AI description card state
  const [showOriginalDescription, setShowOriginalDescription] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(false);

  const [distributeOpen, setDistributeOpen] = useState(false);

  // Upload-status form state. Synced from project below via useEffect.
  const [uploadStatusDraft, setUploadStatusDraft] = useState<'pending' | 'in_progress' | 'uploaded'>('pending');
  const [uploadNoteDraft, setUploadNoteDraft] = useState('');

  // Right panel — floats over content, hideable. Persisted to localStorage so toggle survives reload.
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('editor.sidebarOpen');
    return stored === null ? true : stored === '1';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('editor.sidebarOpen', sidebarOpen ? '1' : '0');
    }
  }, [sidebarOpen]);

  // Crop state
  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // raw pixel coords of cropRect in the player container (for overlay positioning)
  const [cropRawRect, setCropRawRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [trimDragging, setTrimDragging] = useState<'in' | 'out' | 'scrub' | null>(null);
  const trimScrubberRef = useRef<HTMLDivElement>(null);

  // Player right-click context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !project) return;
    const oldIndex = Number(String(active.id).replace('scene-', ''));
    const newIndex = Number(String(over.id).replace('scene-', ''));
    if (isNaN(oldIndex) || isNaN(newIndex)) return;
    updateScenes(arrayMove(project.scenes, oldIndex, newIndex));
  }

  function handleCutScene(index: number, startTime: number) {
    if (!project) return;
    const scene = project.scenes[index];
    const rel = currentTime - startTime;
    const splitAt = rel >= 0.5 && rel <= scene.duration - 0.5
      ? Math.round(rel * 10) / 10
      : Math.round(scene.duration / 2 * 10) / 10;
    const part1 = { ...scene, duration: splitAt };
    const part2 = { ...scene, duration: Math.round((scene.duration - splitAt) * 10) / 10 };
    updateScenes([
      ...project.scenes.slice(0, index),
      part1,
      part2,
      ...project.scenes.slice(index + 1),
    ]);
  }

  // Blur drawing state
  const [blurDrawMode, setBlurDrawMode] = useState(false);
  const [blurMode, setBlurMode] = useState<'blur' | 'pixelate'>('blur');
  const [blurStrength, setBlurStrength] = useState(15);
  // drawingRect: live rectangle while mouse is held down
  const [drawingRect, setDrawingRect] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const drawingRectRef = useRef<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  // Refs that stay current so the window-level pointerup listener never has stale values
  const blurModeRef = useRef(blurMode);
  const blurStrengthRef = useRef(blurStrength);
  blurModeRef.current = blurMode;
  blurStrengthRef.current = blurStrength;

  // pendingRegion: frozen after mouse-up, waiting for user to confirm type/strength
  type PendingRegion = {
    rawLeft: number; rawTop: number; rawWidth: number; rawHeight: number; // px in container
    x: number; y: number; width: number; height: number;                  // % of video frame
    type: 'blur' | 'pixelate'; strength: number;
  };
  const [pendingRegion, setPendingRegion] = useState<PendingRegion | null>(null);

  // Live regions during drag/resize (null = use project.blurRegions)
  const [liveRegions, setLiveRegions] = useState<BlurRegion[] | null>(null);
  const liveRegionsRef = useRef<BlurRegion[] | null>(null);
  const blurDragRef = useRef<{
    id: string; startMX: number; startMY: number;
    startX: number; startY: number; origW: number; origH: number;
    origRegions: BlurRegion[];
  } | null>(null);
  const blurResizeRef = useRef<{
    id: string; handle: string; startMX: number; startMY: number;
    origRegion: BlurRegion; origRegions: BlurRegion[];
  } | null>(null);


  // Text overlay state
  const [textMode, setTextMode] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [liveTextOverlays, setLiveTextOverlays] = useState<TextOverlay[] | null>(null);
  const liveTextOverlaysRef = useRef<TextOverlay[] | null>(null);
  const textDragRef = useRef<{
    id: string; startMX: number; startMY: number;
    startX: number; startY: number;
    origOverlays: TextOverlay[];
  } | null>(null);
  const textResizeRef = useRef<{
    id: string; handle: string;
    startMX: number; startMY: number;
    startW: number; startH: number;
    startX: number; startY: number;
    origOverlays: TextOverlay[];
  } | null>(null);
  const [textDefaults, setTextDefaults] = useState({
    fontSize: 5,
    fontFamily: 'Arial',
    fontWeight: 'bold' as 'normal' | 'bold',
    color: '#FFFFFF',
    bgColor: '#00000080',
    opacity: 1,
    animation: 'none' as TextOverlay['animation'],
  });

  // Assembly log state
  const [assembleJobId, setAssembleJobId] = useState<string | null>(null);
  const [assemblyLogs, setAssemblyLogs] = useState<Array<{ msg: string; pct: number }>>([]);
  const prevLogMsgRef = useRef<string | null>(null);
  const [flashDownload, setFlashDownload] = useState(false);
  const prevAssemblingRef = useRef(false);
  const assemblyLogRef = useRef<HTMLDivElement>(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ['video', videoId],
    queryFn: () => videosApi.get(videoId!),
    enabled: !!videoId,
    refetchInterval: 5000,
  });

  // Keep undo ref in sync with latest values (safe here since project is now declared)
  undoStateRef.current = { past: undoPast, future: undoFuture, project };

  // Trigger AI analysis whenever scenes change (debounced in hook)
  useEditorAnalysis(project?.scenes ?? []);

  // Accumulate stage messages into the log whenever a new one arrives via SSE
  const liveJob = assembleJobId ? liveJobs.get(assembleJobId) : null;
  useEffect(() => {
    const msg = liveJob?.progressMessage;
    if (msg && msg !== prevLogMsgRef.current) {
      prevLogMsgRef.current = msg;
      const pct = liveJob?.progress ?? 0;
      setAssemblyLogs((prev) => [...prev, { msg, pct }]);
      requestAnimationFrame(() => {
        if (assemblyLogRef.current) {
          assemblyLogRef.current.scrollTop = assemblyLogRef.current.scrollHeight;
        }
      });
    }
  }, [liveJob?.progressMessage, liveJob?.progress]);

  const generateMutation = useMutation({
    mutationFn: () => videosApi.generateScenes(videoId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      pushNotification({ id: 'gen-start', type: 'info', title: t('editor.generationStarted') });
    },
  });

  const assembleMutation = useMutation({
    mutationFn: () => {
      const { appliedEdits, frameTransform } = useEditorAIStore.getState();
      const motionEffect = appliedEdits.flatMap((e) => e.effects)[0];
      const transition = appliedEdits.find((e) => e.transition)?.transition;
      const effects = motionEffect || transition ? { motionEffect, transition } : undefined;
      const hasTransform = frameTransform.rotation !== 0 || frameTransform.flipH || frameTransform.flipV || frameTransform.crop !== null;
      const ft = hasTransform
        ? { rotation: frameTransform.rotation, flipH: frameTransform.flipH, flipV: frameTransform.flipV, crop: frameTransform.crop }
        : undefined;
      return videosApi.assemble(videoId!, [], effects, ft);
    },
    onSuccess: (jobId) => {
      setAssembleJobId(jobId);
      setAssemblyLogs([]);
      prevLogMsgRef.current = null;
      queryClient.invalidateQueries({ queryKey: ['video', videoId] });
      pushNotification({ id: 'assemble-start', type: 'info', title: t('editor.assemblyQueued') });
    },
  });

  const musicMoodMutation = useMutation({
    mutationFn: (mood: string) => videosApi.updateMusicMood(videoId!, mood),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['video', videoId] }),
  });

  const musicTrackMutation = useMutation({
    mutationFn: (trackPath: string | null) => videosApi.updateMusicTrack(videoId!, trackPath),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['video', videoId] }),
  });

  const musicSettingsMutation = useMutation({
    mutationFn: (s: { musicEnabled?: boolean; muteOriginalAudio?: boolean }) =>
      videosApi.updateMusicSettings(videoId!, s),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['video', videoId] }),
  });

  const updateScenesMutation = useMutation({
    mutationFn: (scenes: SceneLine[]) => videosApi.updateScenes(videoId!, scenes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['video', videoId] }),
  });

  const updateBlurRegionsMutation = useMutation({
    mutationFn: (regions: BlurRegion[]) => videosApi.updateBlurRegions(videoId!, regions),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['video', videoId] }),
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      pushNotification({ id: `blur-err-${Date.now()}`, type: 'error', title: ax.response?.data?.error || ax.message || t('common.error') });
    },
  });

  const updateTextOverlaysMutation = useMutation({
    mutationFn: (overlays: TextOverlay[]) => videosApi.updateTextOverlays(videoId!, overlays),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['video', videoId] }),
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      pushNotification({ id: `text-err-${Date.now()}`, type: 'error', title: ax.response?.data?.error || ax.message || t('common.error') });
    },
  });

  const trimMutation = useMutation({
    mutationFn: ({ start, end }: { start: number; end: number }) => videosApi.trim(videoId!, start, end),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['video', videoId] });
      setTrimMode(false);
      setTrimIn(null);
      setTrimOut(null);
      pushNotification({ id: `trim-done-${Date.now()}`, type: 'success', title: t('editor.trimDone') });
    },
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      pushNotification({ id: `trim-err-${Date.now()}`, type: 'error', title: ax.response?.data?.error || ax.message || t('common.error') });
    },
  });

  // Title rename — inline editable in the TopBar
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleMutation = useMutation({
    mutationFn: (title: string) => videosApi.updateTitle(videoId!, title),
    onSuccess: (updated) => {
      queryClient.setQueryData(['video', videoId], updated);
      queryClient.invalidateQueries({ queryKey: ['video', videoId] });
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      setEditingTitle(false);
      setTitleError(null);
    },
    onError: (err: unknown) => {
      // Keep the input open and surface the conflict inline so the user can pick a new title
      const ax = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
      const msg = ax.response?.data?.error || ax.message || t('common.error');
      setTitleError(msg);
      pushNotification({ id: `title-err-${Date.now()}`, type: 'error', title: msg });
    },
  });

  function commitTitle() {
    const next = titleDraft.trim();
    if (!next || next === project?.title) { setEditingTitle(false); setTitleError(null); return; }
    titleMutation.mutate(next);
  }

  const uploadStatusMutation = useMutation({
    mutationFn: ({ status, note }: { status: 'pending' | 'in_progress' | 'uploaded'; note?: string }) =>
      videosApi.setUploadStatus(videoId!, status, note),
    onSuccess: (updated) => {
      queryClient.setQueryData(['video', videoId], updated);
      queryClient.invalidateQueries({ queryKey: ['video', videoId] });
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      pushNotification({ id: `upload-saved-${Date.now()}`, type: 'success', title: t('editor.uploadStatusSaved') });
    },
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      pushNotification({ id: `upload-err-${Date.now()}`, type: 'error', title: ax.response?.data?.error || ax.message || t('common.error') });
    },
  });

  const generateDescriptionMutation = useMutation({
    mutationFn: () => videosApi.generateDescription(videoId!),
    onSuccess: (updated) => {
      queryClient.setQueryData(['video', videoId], updated);
      queryClient.invalidateQueries({ queryKey: ['video', videoId] });
    },
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      pushNotification({ id: `desc-err-${Date.now()}`, type: 'error', title: ax.response?.data?.error || ax.message || t('common.error') });
    },
  });

  const cropMutation = useMutation({
    mutationFn: ({ x, y, width, height }: { x: number; y: number; width: number; height: number }) =>
      videosApi.crop(videoId!, x, y, width, height),
    onSuccess: (updated) => {
      queryClient.setQueryData(['video', videoId], updated);
      queryClient.invalidateQueries({ queryKey: ['video', videoId] });
      setCropMode(false);
      setCropRect(null);
      pushNotification({ id: `crop-done-${Date.now()}`, type: 'success', title: t('editor.cropDone') });
    },
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      pushNotification({ id: `crop-err-${Date.now()}`, type: 'error', title: ax.response?.data?.error || ax.message || t('common.error') });
    },
  });

  const optimizePreviewMutation = useMutation({
    mutationFn: () => videosApi.optimizePreview(videoId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['video', videoId] });
      pushNotification({ id: 'optimize-done', type: 'info', title: t('editor.previewOptimized') });
    },
    onError: (err: unknown) => {
      // axios stashes the server's JSON body at err.response.data — surface it instead of the generic status message
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      const detail = ax.response?.data?.error || ax.message || t('common.error');
      pushNotification({
        id: 'optimize-err',
        type: 'error',
        title: `${t('editor.optimizeFailed')}: ${detail}`,
      });
    },
  });

  const { data: cachedTracks } = useQuery({
    queryKey: ['music', 'cached'],
    queryFn: musicApi.cached,
    enabled: !!project?.musicEnabled,
  });

  // Detect assembly completion: when status flips from 'assembling' → 'completed' for THIS
  // video, drop a clear toast and scroll the player into view. The SSE invalidation already
  // refetched ['video'] so project here is the fresh post-assembly record.
  const prevStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = project?.status;
    if (prev === 'assembling' && curr === 'completed') {
      pushNotification({
        id: `assemble-done-${project!.id}`,
        type: 'success',
        title: t('editor.assembled'),
        message: project!.outputPath,
      });
      playerContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevStatusRef.current = curr;
  }, [project?.status, project?.id, project?.outputPath, pushNotification, t]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const { past, future, project: proj } = undoStateRef.current;
      if (!proj) return;
      const curr: HistoryEntry = { scenes: proj.scenes, blurRegions: proj.blurRegions ?? [] };
      if (e.key === 'z' && !e.shiftKey) {
        if (past.length === 0) return;
        e.preventDefault();
        const prev = past[past.length - 1];
        setUndoPast(p => p.slice(0, -1));
        setUndoFuture(f => [curr, ...f.slice(0, 29)]);
        updateScenesMutation.mutate(prev.scenes);
        updateBlurRegionsMutation.mutate(prev.blurRegions);
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        if (future.length === 0) return;
        e.preventDefault();
        const next = future[0];
        setUndoFuture(f => f.slice(1));
        setUndoPast(p => [...p.slice(-29), curr]);
        updateScenesMutation.mutate(next.scenes);
        updateBlurRegionsMutation.mutate(next.blurRegions);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // I / O keyboard shortcuts for trim (reads currentTime from store to avoid stale closure)
  useEffect(() => {
    function onTrimKey(e: KeyboardEvent) {
      if (!trimMode) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      const t = useEditorAIStore.getState().currentTime;
      if (e.key === 'i' || e.key === 'I') setTrimIn(t);
      else if (e.key === 'o' || e.key === 'O') setTrimOut(t);
    }
    document.addEventListener('keydown', onTrimKey);
    return () => document.removeEventListener('keydown', onTrimKey);
  }, [trimMode]);

  // Live-update pending region preview when user changes type/strength
  useEffect(() => {
    setPendingRegion((p) => (p ? { ...p, type: blurMode, strength: blurStrength } : null));
  }, [blurMode, blurStrength]);

  // Sync upload-status form drafts whenever the project record refreshes — but never
  // overwrite local edits the user is still typing. We reset only when the project's
  // saved values actually change.
  useEffect(() => {
    setUploadStatusDraft(project?.uploadStatus ?? 'pending');
    setUploadNoteDraft(project?.uploadNote ?? '');
  }, [project?.uploadStatus, project?.uploadNote]);

  // Ctrl/Cmd + B toggles the right floating panel.
  useEffect(() => {
    function onPanelKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    }
    document.addEventListener('keydown', onPanelKey);
    return () => document.removeEventListener('keydown', onPanelKey);
  }, []);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent) {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setCtxMenu(null); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [ctxMenu]);


  if (!videoId) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title={t('editor.title')} subtitle={t('editor.noVideoSub')} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Film className="w-10 h-10 text-c-dim mx-auto mb-3" />
            <div className="text-sm text-c-muted">{t('editor.noVideo')}</div>
            <div className="text-xs text-c-dim mt-1">{t('editor.noVideoSub')}</div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title={t('editor.title')} />
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (!project) return null;

  // History helpers — only call after project is guaranteed non-null
  function captureSnapshot(): HistoryEntry {
    return { scenes: project!.scenes, blurRegions: project!.blurRegions ?? [] };
  }
  function pushHistory() {
    setUndoPast(p => [...p.slice(-29), captureSnapshot()]);
    setUndoFuture([]);
  }
  function updateScenes(scenes: SceneLine[]) {
    pushHistory();
    updateScenesMutation.mutate(scenes);
  }
  function updateBlurRegions(regions: BlurRegion[]) {
    pushHistory();
    updateBlurRegionsMutation.mutate(regions);
  }
  function updateTextOverlays(overlays: TextOverlay[]) {
    updateTextOverlaysMutation.mutate(overlays);
  }
  function addTextOverlay(x: number, y: number) {
    const overlay: TextOverlay = {
      id: crypto.randomUUID(),
      text: 'Text',
      x, y,
      width: 30,
      height: 8,
      ...textDefaults,
      rotation: 0,
      animation: textDefaults.animation,
    };
    updateTextOverlays([...(project?.textOverlays ?? []), overlay]);
    setEditingTextId(overlay.id);
  }
  function updateSingleTextOverlay(id: string, changes: Partial<TextOverlay>) {
    const overlays = (project?.textOverlays ?? []).map(o =>
      o.id === id ? { ...o, ...changes } : o
    );
    updateTextOverlays(overlays);
  }
  function deleteTextOverlay(id: string) {
    updateTextOverlays((project?.textOverlays ?? []).filter(o => o.id !== id));
    if (editingTextId === id) setEditingTextId(null);
  }
  function handleUndo() {
    if (undoPast.length === 0) return;
    const prev = undoPast[undoPast.length - 1];
    const curr = captureSnapshot();
    setUndoPast(p => p.slice(0, -1));
    setUndoFuture(f => [curr, ...f.slice(0, 29)]);
    updateScenesMutation.mutate(prev.scenes);
    updateBlurRegionsMutation.mutate(prev.blurRegions);
  }
  function handleRedo() {
    if (undoFuture.length === 0) return;
    const next = undoFuture[0];
    const curr = captureSnapshot();
    setUndoFuture(f => f.slice(1));
    setUndoPast(p => [...p.slice(-29), curr]);
    updateScenesMutation.mutate(next.scenes);
    updateBlurRegionsMutation.mutate(next.blurRegions);
  }

  const isGenerating = project.status === 'generating' || project.status === 'assembling';
  const isAssembling = project.status === 'assembling' || assembleMutation.isPending;

  // Detect assembly completion → flash download button
  useEffect(() => {
    if (prevAssemblingRef.current && !isAssembling && project.status === 'completed') {
      setFlashDownload(true);
    }
    prevAssemblingRef.current = isAssembling;
  }, [isAssembling, project.status]);

  const isBusy = isGenerating
    || assembleMutation.isPending
    || generateMutation.isPending
    || trimMutation.isPending
    || cropMutation.isPending
    || optimizePreviewMutation.isPending
    || generateDescriptionMutation.isPending
    || musicSettingsMutation.isPending
    || musicTrackMutation.isPending
    || musicMoodMutation.isPending;
  const pendingRecCount = recommendations.filter((r) => !dismissedIds.has(r.id)).length;

  // Aggregate every applied effect/transition for the live player preview. With no scene
  // timeline yet, effects from any scene apply to the whole video — clearest UX while editing.
  const previewEffects = Array.from(new Set(appliedEdits.flatMap((e) => e.effects)));
  const previewTransition = appliedEdits.find((e) => e.transition)?.transition;
  const previewSubtitleStyle =
    globalSubtitleStyle !== 'default'
      ? globalSubtitleStyle
      : appliedEdits.find((e) => e.subtitleStyle && e.subtitleStyle !== 'default')?.subtitleStyle;

  // Blur region coordinate math
  const [resW, resH] = (project.resolution || '1080x1920').split('x').map(Number);

  // Compute the letterbox-aware video frame rect inside the player container.
  // object-contain: video fits within container preserving aspect ratio; black bars fill the rest.
  function getVideoFrame() {
    const el = playerContainerRef.current;
    if (!el) return null;
    const { width: cW, height: cH } = el.getBoundingClientRect();
    if (!cW || !cH) return null;
    const videoEl = el.querySelector('video') as HTMLVideoElement | null;
    const vW = videoEl?.videoWidth || resW;
    const vH = videoEl?.videoHeight || resH;
    const vAspect = vW / vH;
    const cAspect = cW / cH;
    if (cAspect > vAspect) {
      const h = cH; const w = h * vAspect;
      return { x: (cW - w) / 2, y: 0, w, h };
    } else {
      const w = cW; const h = w / vAspect;
      return { x: 0, y: (cH - h) / 2, w, h };
    }
  }

  function computeResized(orig: BlurRegion, handle: string, dxPx: number, dyPx: number, vfW: number, vfH: number): BlurRegion {
    const dxPct = (dxPx / vfW) * 100;
    const dyPct = (dyPx / vfH) * 100;
    let { x, y, width, height } = orig;
    const MIN = 1;
    if (handle.includes('w')) { const nx = Math.max(0, Math.min(x + width - MIN, x + dxPct)); width = Math.max(MIN, width - (nx - x)); x = nx; }
    if (handle.includes('e')) { width = Math.max(MIN, Math.min(100 - x, width + dxPct)); }
    if (handle.includes('n')) { const ny = Math.max(0, Math.min(y + height - MIN, y + dyPct)); height = Math.max(MIN, height - (ny - y)); y = ny; }
    if (handle.includes('s')) { height = Math.max(MIN, Math.min(100 - y, height + dyPct)); }
    return { ...orig, x, y, width, height };
  }

  function toPct(frame: NonNullable<ReturnType<typeof getVideoFrame>>, px: number, py: number) {
    return {
      x: Math.max(0, Math.min(100, ((px - frame.x) / frame.w) * 100)),
      y: Math.max(0, Math.min(100, ((py - frame.y) / frame.h) * 100)),
    };
  }

  // Prefer the HTMLVideoElement's real duration (published by EditorVideoPlayer into the
  // store) so the trim scrubber stays exactly in sync with the player. Fall back to scene
  // sum or project metadata while the video is still loading.
  const sceneSum = project.scenes.reduce((acc, s) => acc + s.duration, 0);
  const totalDuration = Math.max(
    1,
    videoDuration > 0
      ? videoDuration
      : sceneSum > 0
        ? sceneSum
        : (project.metadata.totalDuration ?? project.duration ?? 0)
  );

  function getTrimRatio(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = trimScrubberRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }
  function onTrimScrubberPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ratio = getTrimRatio(e);
    const time = ratio * totalDuration;
    const THRESH = 0.03;
    const inRatio = trimIn !== null ? trimIn / totalDuration : null;
    const outRatio = trimOut !== null ? trimOut / totalDuration : null;
    if (inRatio !== null && Math.abs(ratio - inRatio) < THRESH) {
      setTrimDragging('in');
    } else if (outRatio !== null && Math.abs(ratio - outRatio) < THRESH) {
      setTrimDragging('out');
    } else {
      requestSeek(time);
      setTrimDragging('scrub');
    }
  }
  function onTrimScrubberPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!trimDragging) return;
    const time = getTrimRatio(e) * totalDuration;
    if (trimDragging === 'in') { setTrimIn(time); requestSeek(time); }
    else if (trimDragging === 'out') { setTrimOut(time); requestSeek(time); }
    else requestSeek(time);
  }
  function onTrimScrubberPointerUp() { setTrimDragging(null); }

  function onBlurPointerDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = playerContainerRef.current!;
    const rect = container.getBoundingClientRect();
    const vf = getVideoFrame();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const minX = vf ? vf.x : 0;
    const maxX = vf ? vf.x + vf.w : rect.width;
    const minY = vf ? vf.y : 0;
    const maxY = vf ? vf.y + vf.h : rect.height;
    const startX = Math.max(minX, Math.min(maxX, rawX));
    const startY = Math.max(minY, Math.min(maxY, rawY));

    const initial = { startX, startY, curX: startX, curY: startY };
    drawingRectRef.current = initial;
    setDrawingRect({ ...initial });

    function onMove(ev: MouseEvent) {
      if (!playerContainerRef.current) return;
      const r = playerContainerRef.current.getBoundingClientRect();
      const vf = getVideoFrame();
      const minX = vf ? vf.x : 0;
      const maxX = vf ? vf.x + vf.w : r.width;
      const minY = vf ? vf.y : 0;
      const maxY = vf ? vf.y + vf.h : r.height;
      const curX = Math.max(minX, Math.min(maxX, ev.clientX - r.left));
      const curY = Math.max(minY, Math.min(maxY, ev.clientY - r.top));
      const val = { startX, startY, curX, curY };
      drawingRectRef.current = val;
      setDrawingRect({ ...val });
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      const dr = drawingRectRef.current;
      drawingRectRef.current = null;
      setDrawingRect(null);

      if (!dr || (Math.abs(dr.curX - dr.startX) < 8 && Math.abs(dr.curY - dr.startY) < 8)) return;

      const rawLeft = Math.min(dr.startX, dr.curX);
      const rawTop = Math.min(dr.startY, dr.curY);
      const rawWidth = Math.abs(dr.curX - dr.startX);
      const rawHeight = Math.abs(dr.curY - dr.startY);

      const el = playerContainerRef.current;
      if (!el) return;

      const elRect = el.getBoundingClientRect();
      const cW = elRect.width, cH = elRect.height;
      if (!cW || !cH) {
        setPendingRegion({ x: 0, y: 0, width: 0, height: 0, rawLeft, rawTop, rawWidth, rawHeight, strength: blurStrengthRef.current, type: blurModeRef.current });
        return;
      }

      const resStr = el.dataset.videoResolution || '1080x1920';
      const [rW, rH] = resStr.split('x').map(Number);
      const vAspect = (rW || 9) / (rH || 16);
      const cAspect = cW / cH;
      let fx: number, fy: number, fw: number, fh: number;
      if (cAspect > vAspect) { fh = cH; fw = fh * vAspect; fx = (cW - fw) / 2; fy = 0; }
      else { fw = cW; fh = fw / vAspect; fx = 0; fy = (cH - fh) / 2; }

      const clamp = (v: number) => Math.max(0, Math.min(100, v));
      const p1x = clamp(((dr.startX - fx) / fw) * 100);
      const p1y = clamp(((dr.startY - fy) / fh) * 100);
      const p2x = clamp(((dr.curX - fx) / fw) * 100);
      const p2y = clamp(((dr.curY - fy) / fh) * 100);
      const x = Math.min(p1x, p2x), y = Math.min(p1y, p2y);
      const width = Math.abs(p2x - p1x), height = Math.abs(p2y - p1y);
      if (width < 0.5 || height < 0.5) return;
      setPendingRegion({ x, y, width, height, rawLeft, rawTop, rawWidth, rawHeight, strength: blurStrengthRef.current, type: blurModeRef.current });
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function confirmPendingRegion() {
    if (!pendingRegion) return;
    let { x, y, width, height } = pendingRegion;
    if (width === 0 && height === 0) {
      const frame = getVideoFrame();
      if (frame) {
        const p1 = toPct(frame, pendingRegion.rawLeft, pendingRegion.rawTop);
        const p2 = toPct(frame, pendingRegion.rawLeft + pendingRegion.rawWidth, pendingRegion.rawTop + pendingRegion.rawHeight);
        x = Math.min(p1.x, p2.x); y = Math.min(p1.y, p2.y);
        width = Math.max(Math.abs(p2.x - p1.x), 1); height = Math.max(Math.abs(p2.y - p1.y), 1);
      }
    }
    const newRegion: BlurRegion = { id: crypto.randomUUID(), x, y, width, height, strength: pendingRegion.strength, type: pendingRegion.type };
    updateBlurRegions([...(project?.blurRegions ?? []), newRegion]);
    setPendingRegion(null);
  }

  function onCropPointerDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = playerContainerRef.current!;
    const rect = container.getBoundingClientRect();
    const vf = getVideoFrame();
    const minX = vf ? vf.x : 0, maxX = vf ? vf.x + vf.w : rect.width;
    const minY = vf ? vf.y : 0, maxY = vf ? vf.y + vf.h : rect.height;
    const startX = Math.max(minX, Math.min(maxX, e.clientX - rect.left));
    const startY = Math.max(minY, Math.min(maxY, e.clientY - rect.top));

    setCropRect(null);
    setCropRawRect(null);
    drawingRectRef.current = { startX, startY, curX: startX, curY: startY };
    setDrawingRect({ startX, startY, curX: startX, curY: startY });

    function onMove(ev: MouseEvent) {
      if (!playerContainerRef.current) return;
      const r = playerContainerRef.current.getBoundingClientRect();
      const vfr = getVideoFrame();
      const mnX = vfr ? vfr.x : 0, mxX = vfr ? vfr.x + vfr.w : r.width;
      const mnY = vfr ? vfr.y : 0, mxY = vfr ? vfr.y + vfr.h : r.height;
      const curX = Math.max(mnX, Math.min(mxX, ev.clientX - r.left));
      const curY = Math.max(mnY, Math.min(mxY, ev.clientY - r.top));
      drawingRectRef.current = { startX, startY, curX, curY };
      setDrawingRect({ startX, startY, curX, curY });
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const dr = drawingRectRef.current;
      drawingRectRef.current = null;
      setDrawingRect(null);
      if (!dr || (Math.abs(dr.curX - dr.startX) < 8 && Math.abs(dr.curY - dr.startY) < 8)) return;

      const el = playerContainerRef.current;
      if (!el) return;
      const elRect = el.getBoundingClientRect();
      const vfr = getVideoFrame();
      if (!vfr) return;

      const clamp = (v: number) => Math.max(0, Math.min(100, v));
      const p1x = clamp(((dr.startX - vfr.x) / vfr.w) * 100);
      const p1y = clamp(((dr.startY - vfr.y) / vfr.h) * 100);
      const p2x = clamp(((dr.curX - vfr.x) / vfr.w) * 100);
      const p2y = clamp(((dr.curY - vfr.y) / vfr.h) * 100);
      const x = Math.min(p1x, p2x), y = Math.min(p1y, p2y);
      const width = Math.abs(p2x - p1x), height = Math.abs(p2y - p1y);
      if (width < 1 || height < 1) return;

      const rawLeft = vfr.x + (x / 100) * vfr.w;
      const rawTop = vfr.y + (y / 100) * vfr.h;
      const rawWidth = (width / 100) * vfr.w;
      const rawHeight = (height / 100) * vfr.h;

      void elRect; // suppress unused warning
      setCropRect({ x, y, width, height });
      setCropRawRect({ left: rawLeft, top: rawTop, width: rawWidth, height: rawHeight });
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onTextClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const container = playerContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const vf = getVideoFrame();
    if (!vf) return;
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const pctX = Math.max(5, Math.min(95, ((rawX - vf.x) / vf.w) * 100));
    const pctY = Math.max(5, Math.min(95, ((rawY - vf.y) / vf.h) * 100));
    addTextOverlay(pctX, pctY);
  }


  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={
          editingTitle ? (
            <div className="relative w-full max-w-[600px]">
              <input
                autoFocus
                type="text"
                value={titleDraft}
                maxLength={200}
                disabled={isBusy}
                onChange={(e) => { setTitleDraft(e.target.value); if (titleError) setTitleError(null); }}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
                  else if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); setTitleError(null); }
                }}
                className={clsx(
                  'text-sm font-semibold leading-tight bg-c-elevated text-c-text rounded px-2 py-0.5 outline-none border w-full',
                  titleError ? 'border-red-500' : 'border-accent-primary'
                )}
              />
              {titleError && (
                <div className="absolute left-0 top-full mt-1 text-[11px] text-red-400 bg-c-surface border border-red-500/40 rounded px-2 py-1 shadow-lg whitespace-nowrap z-50">
                  {titleError}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setTitleDraft(project.title); setEditingTitle(true); }}
              title={t('editor.renameTitle')}
              className="group flex items-center gap-1.5 min-w-0 text-left rounded hover:bg-c-elevated/60 px-1 -mx-1 py-0.5 transition-colors"
            >
              <h1 className="text-sm font-semibold text-c-text leading-tight truncate whitespace-nowrap">{project.title}</h1>
              <Pencil className="w-3 h-3 text-c-dim opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
            </button>
          )
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusDot status={project.status} label />

            {/* Undo / Redo */}
            <button
              onClick={handleUndo}
              disabled={undoPast.length === 0}
              title={`${t('editor.undo')} (Ctrl+Z)`}
              className="p-1.5 rounded border border-c-border text-c-muted hover:text-c-text hover:border-c-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={undoFuture.length === 0}
              title={`${t('editor.redo')} (Ctrl+Y)`}
              className="p-1.5 rounded border border-c-border text-c-muted hover:text-c-text hover:border-c-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => generateMutation.mutate()}
              disabled={isBusy}
              className="flex items-center gap-1 text-[11px] px-2 py-1 whitespace-nowrap font-medium bg-c-elevated border border-c-border hover:bg-c-hover text-c-text rounded-lg transition-colors duration-150 disabled:opacity-50"
            >
              {generateMutation.isPending ? <Spinner size="sm" /> : <Zap className="w-3 h-3" />}
              {t('editor.generate')}
            </button>

            <button
              onClick={() => assembleMutation.mutate()}
              disabled={isBusy}
              className="btn-primary flex items-center gap-1.5 text-xs"
            >
              {assembleMutation.isPending ? <Spinner size="sm" /> : <Play className="w-3 h-3" />}
              {t('editor.assemble')}
            </button>

            {project.outputPath && (
              <a
                href={`/api/export/${project.id}/download?v=${encodeURIComponent(project.updatedAt)}`}
                className={clsx(
                  'btn-secondary flex items-center gap-1.5 text-xs',
                  flashDownload && 'animate-pulse ring-2 ring-green-400 bg-green-500/20 text-green-300'
                )}
                onClick={() => setFlashDownload(false)}
              >
                <Download className="w-3 h-3" />
                {t('common.download')}
              </a>
            )}
          </div>
        }
      />

      {/* Player toolbar */}
      <div className={clsx('flex items-center gap-2 px-3 py-1.5 border-b border-c-border bg-c-surface shrink-0', isAssembling && 'opacity-50 pointer-events-none')}>
        <button
          disabled={isAssembling}
          onClick={() => {
            setBlurDrawMode((m) => !m);
            if (blurDrawMode) { setPendingRegion(null); drawingRectRef.current = null; setDrawingRect(null); }
            else { setTextMode(false); setEditingTextId(null); }
          }}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border disabled:opacity-50',
            blurDrawMode
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'text-c-muted hover:text-c-text border-c-border hover:bg-c-elevated'
          )}
        >
          <EyeOff className="w-3.5 h-3.5" />
          {blurDrawMode ? t('editor.blurDone') : t('editor.addBlur')}
        </button>
        <button
          disabled={isAssembling}
          onClick={() => {
            setTextMode((m) => !m);
            if (textMode) setEditingTextId(null);
            if (!textMode) { setBlurDrawMode(false); setPendingRegion(null); setCropMode(false); setTrimMode(false); }
          }}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border disabled:opacity-50',
            textMode
              ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
              : 'text-c-muted hover:text-c-text border-c-border hover:bg-c-elevated'
          )}
        >
          <Type className="w-3.5 h-3.5" />
          {textMode ? t('editor.textDone') : t('editor.addText')}
        </button>
        <button
          disabled={isAssembling}
          onClick={() => { setTrimMode((m) => !m); setTrimIn(null); setTrimOut(null); }}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border disabled:opacity-50',
            trimMode
              ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
              : 'text-c-muted hover:text-c-text border-c-border hover:bg-c-elevated'
          )}
        >
          <Scissors className="w-3.5 h-3.5" />
          {trimMode ? t('editor.trimCancel') : t('editor.trim')}
        </button>
        <button
          disabled={isAssembling}
          onClick={() => { setCropMode((m) => !m); setCropRect(null); setCropRawRect(null); }}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border disabled:opacity-50',
            cropMode
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : 'text-c-muted hover:text-c-text border-c-border hover:bg-c-elevated'
          )}
        >
          <Crop className="w-3.5 h-3.5" />
          {cropMode ? t('common.cancel') : t('editor.crop')}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Timeline / Scenes — full width; the right panel floats over it */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Video preview area */}
          <div
            ref={playerContainerRef}
            data-video-resolution={project.resolution || '1080x1920'}
            className="bg-black border-b border-c-border shrink-0 relative select-none"
            style={{ height: 'min(1500px, 85vh)', cursor: (blurDrawMode || cropMode) ? 'crosshair' : textMode ? 'text' : undefined }}
            onContextMenu={(e) => {
              if (blurDrawMode || cropMode) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              setCtxMenu({ x: e.clientX - box.left, y: e.clientY - box.top });
            }}
          >
            {project.outputPath ? (
              <div className={clsx('w-full h-full', blurDrawMode && 'pointer-events-none')}>
                <EditorVideoPlayer
                  key={`${project.outputPath}|${project.updatedAt}`}
                  src={exportApi.previewUrl(project.id, project.updatedAt)}
                  fps={project.fps || 30}
                  className="w-full h-full"
                  onRequestOptimize={() => optimizePreviewMutation.mutate()}
                  optimizing={optimizePreviewMutation.isPending}
                  effects={previewEffects}
                  transition={previewTransition}
                  subtitleStyle={previewSubtitleStyle}
                />
              </div>
            ) : isGenerating ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Spinner size="lg" className="text-accent-primary mb-2" />
                <div className="text-sm text-c-text capitalize">
                  {project.status.replace(/-/g, ' ')}…
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-c-dim">
                <Film className="w-8 h-8 mb-2 opacity-30" />
                <div className="text-sm">{t('editor.previewPlaceholder')}</div>
              </div>
            )}

            {/* Blur overlay — regions + draw ghost */}
            <div className="absolute inset-0 z-10 pointer-events-none">
              {/* Blur draw hint */}
              {blurDrawMode && !drawingRect && !pendingRegion && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm">
                    {t('editor.blurHint')}
                  </div>
                </div>
              )}
              {/* Text place hint */}
              {textMode && (project.textOverlays ?? []).length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm">
                    {t('editor.textHint')}
                  </div>
                </div>
              )}
              {/* Crop draw hint */}
              {cropMode && !cropRect && !drawingRect && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm">
                    {t('editor.cropHint')}
                  </div>
                </div>
              )}
              {/* Right-click hint — only on idle player with no active tool */}
              {!blurDrawMode && !cropMode && !trimMode && !drawingRect && !pendingRegion && (project.blurRegions?.length ?? 0) === 0 && (
                <div className="absolute bottom-2 right-2 pointer-events-none">
                  <div className="bg-black/50 text-white/50 text-[10px] px-2 py-1 rounded backdrop-blur-sm">
                    {t('editor.rightClickTools')}
                  </div>
                </div>
              )}

              {/* Confirmed regions — draggable, resizable, blur/mosaic preview */}
              {(() => {
                const vf = getVideoFrame();
                if (!vf) return null;
                const regions = liveRegions ?? (project.blurRegions ?? []);
                const HANDLES = ['nw','n','ne','e','se','s','sw','w'] as const;
                const HANDLE_CURSOR: Record<string, string> = { nw:'nw-resize',n:'n-resize',ne:'ne-resize',e:'e-resize',se:'se-resize',s:'s-resize',sw:'sw-resize',w:'w-resize' };
                const HANDLE_STYLE: Record<string, React.CSSProperties> = {
                  nw:{top:-4,left:-4}, n:{top:-4,left:'calc(50% - 4px)'}, ne:{top:-4,right:-4},
                  e:{top:'calc(50% - 4px)',right:-4}, se:{bottom:-4,right:-4},
                  s:{bottom:-4,left:'calc(50% - 4px)'}, sw:{bottom:-4,left:-4}, w:{top:'calc(50% - 4px)',left:-4},
                };
                return regions.map((region, idx) => {
                  const isPx = region.type === 'pixelate';
                  const blurPx = Math.round(region.strength * 0.6);
                  const gridPx = Math.max(2, Math.round(region.strength * 0.4));
                  return (
                    <div
                      key={region.id}
                      className="absolute border-2 border-dashed pointer-events-auto flex items-center justify-center"
                      style={{
                        left: vf.x + (region.x / 100) * vf.w,
                        top: vf.y + (region.y / 100) * vf.h,
                        width: (region.width / 100) * vf.w,
                        height: (region.height / 100) * vf.h,
                        borderColor: isPx ? '#a78bfa' : '#fbbf24',
                        backdropFilter: isPx ? undefined : `blur(${blurPx}px)`,
                        WebkitBackdropFilter: isPx ? undefined : `blur(${blurPx}px)`,
                        background: isPx
                          ? `repeating-linear-gradient(0deg,transparent,transparent ${gridPx-1}px,rgba(167,139,250,0.55) ${gridPx}px),repeating-linear-gradient(90deg,transparent,transparent ${gridPx-1}px,rgba(167,139,250,0.55) ${gridPx}px)`
                          : 'transparent',
                        cursor: 'move',
                        overflow: 'visible',
                      }}
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement).closest('[data-handle],[data-delete]')) return;
                        if (e.button !== 0) return;
                        e.preventDefault(); e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        const orig = [...(project.blurRegions ?? [])];
                        const origR = orig.find(r => r.id === region.id);
                        if (!origR) return;
                        blurDragRef.current = { id: region.id, startMX: e.clientX, startMY: e.clientY, startX: origR.x, startY: origR.y, origW: origR.width, origH: origR.height, origRegions: orig };
                      }}
                      onPointerMove={(e) => {
                        const dr = blurDragRef.current;
                        if (!dr || dr.id !== region.id) return;
                        const dx = e.clientX - dr.startMX;
                        const dy = e.clientY - dr.startMY;
                        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                        const f = getVideoFrame(); if (!f) return;
                        const nx = Math.max(0, Math.min(100 - dr.origW, dr.startX + (dx / f.w) * 100));
                        const ny = Math.max(0, Math.min(100 - dr.origH, dr.startY + (dy / f.h) * 100));
                        const upd = dr.origRegions.map(r => r.id === region.id ? { ...r, x: nx, y: ny } : r);
                        liveRegionsRef.current = upd; setLiveRegions([...upd]);
                      }}
                      onPointerUp={() => {
                        if (!blurDragRef.current || blurDragRef.current.id !== region.id) return;
                        blurDragRef.current = null;
                        const final = liveRegionsRef.current; liveRegionsRef.current = null; setLiveRegions(null);
                        if (final) updateBlurRegions(final);
                      }}
                    >
                      <span className="text-[10px] font-semibold text-white/90 bg-black/60 px-1 py-0.5 rounded select-none pointer-events-none z-10 relative">
                        #{idx + 1} {isPx ? 'Mosaic' : 'Blur'}
                      </span>
                      <button
                        data-delete="true"
                        className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-400 transition-colors z-10"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); updateBlurRegions((project.blurRegions ?? []).filter(r => r.id !== region.id)); }}
                      >
                        <X className="w-2.5 h-2.5 text-white" />
                      </button>
                      {HANDLES.map(h => (
                        <div
                          key={h}
                          data-handle={h}
                          className="absolute w-2 h-2 bg-white border border-gray-500 rounded-sm z-10"
                          style={{ ...HANDLE_STYLE[h], cursor: HANDLE_CURSOR[h] }}
                          onPointerDown={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            const orig = [...(project.blurRegions ?? [])];
                            const origR = orig.find(r => r.id === region.id);
                            if (!origR) return;
                            blurResizeRef.current = { id: region.id, handle: h, startMX: e.clientX, startMY: e.clientY, origRegion: { ...origR }, origRegions: orig };
                          }}
                          onPointerMove={(e) => {
                            const rr = blurResizeRef.current;
                            if (!rr || rr.id !== region.id) return;
                            const dx = e.clientX - rr.startMX;
                            const dy = e.clientY - rr.startMY;
                            if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
                            const f = getVideoFrame(); if (!f) return;
                            const upd = rr.origRegions.map(r => r.id === region.id ? computeResized(rr.origRegion, rr.handle, dx, dy, f.w, f.h) : r);
                            liveRegionsRef.current = upd; setLiveRegions([...upd]);
                          }}
                          onPointerUp={() => {
                            if (!blurResizeRef.current || blurResizeRef.current.id !== region.id) return;
                            blurResizeRef.current = null;
                            const final = liveRegionsRef.current; liveRegionsRef.current = null; setLiveRegions(null);
                            if (final) updateBlurRegions(final);
                          }}
                        />
                      ))}
                    </div>
                  );
                });
              })()}

              {/* Pending region — live strength preview */}
              {pendingRegion && (() => {
                const isPx = pendingRegion.type === 'pixelate';
                const blurPx = Math.round(pendingRegion.strength * 0.6);
                const gridPx = Math.max(2, Math.round(pendingRegion.strength * 0.4));
                return (
                  <div
                    className="absolute pointer-events-none flex items-center justify-center overflow-hidden"
                    style={{
                      left: pendingRegion.rawLeft,
                      top: pendingRegion.rawTop,
                      width: pendingRegion.rawWidth,
                      height: pendingRegion.rawHeight,
                      border: `2px dashed ${isPx ? '#a78bfa' : '#fbbf24'}`,
                      backdropFilter: isPx ? undefined : `blur(${blurPx}px)`,
                      WebkitBackdropFilter: isPx ? undefined : `blur(${blurPx}px)`,
                      background: isPx
                        ? `repeating-linear-gradient(0deg,transparent,transparent ${gridPx - 1}px,rgba(167,139,250,0.55) ${gridPx}px),repeating-linear-gradient(90deg,transparent,transparent ${gridPx - 1}px,rgba(167,139,250,0.55) ${gridPx}px)`
                        : 'transparent',
                    }}
                  >
                    <span className="text-[10px] font-semibold text-white/90 bg-black/60 px-1 py-0.5 rounded select-none">
                      {isPx ? 'Mosaic' : 'Blur'} {pendingRegion.strength}
                    </span>
                  </div>
                );
              })()}

              {/* Drawing ghost (while dragging) */}
              {drawingRect && (
                <div
                  className="absolute border-2 border-dashed border-white bg-white/10"
                  style={{
                    left: Math.min(drawingRect.startX, drawingRect.curX),
                    top: Math.min(drawingRect.startY, drawingRect.curY),
                    width: Math.abs(drawingRect.curX - drawingRect.startX),
                    height: Math.abs(drawingRect.curY - drawingRect.startY),
                  }}
                />
              )}
            </div>

            {/* Blur capture layer */}
            {blurDrawMode && !pendingRegion && (
              <div
                className="absolute inset-0 pointer-events-auto"
                style={{ zIndex: 30, cursor: 'crosshair' }}
                onMouseDown={onBlurPointerDown}
              />
            )}

            {/* Crop capture layer */}
            {cropMode && !cropRect && (
              <div
                className="absolute inset-0 pointer-events-auto"
                style={{ zIndex: 30, cursor: 'crosshair' }}
                onMouseDown={onCropPointerDown}
              />
            )}

            {/* Text click capture layer */}
            {textMode && (
              <div
                className="absolute inset-0 pointer-events-auto"
                style={{ zIndex: 30, cursor: 'text' }}
                onMouseDown={onTextClick}
              />
            )}

            {/* Text overlay previews on video — draggable */}
            {(() => {
              const vf = getVideoFrame();
              if (!vf) return null;
              const overlays = liveTextOverlays ?? (project.textOverlays ?? []);
              if (overlays.length === 0) return null;
              return overlays.map((ov, idx) => {
                const boxW = (ov.width ?? 30) / 100 * vf.w;
                const boxH = (ov.height ?? 8) / 100 * vf.h;
                const boxLeft = vf.x + (ov.x / 100) * vf.w - boxW / 2;
                const boxTop = vf.y + (ov.y / 100) * vf.h - boxH / 2;
                const fsPx = Math.max(10, (ov.fontSize / 100) * vf.h);
                const isEditing = editingTextId === ov.id;
                const HANDLES = ['nw','n','ne','e','se','s','sw','w'] as const;
                const HANDLE_CURSOR: Record<string, string> = { nw:'nwse-resize',n:'ns-resize',ne:'nesw-resize',e:'ew-resize',se:'nwse-resize',s:'ns-resize',sw:'nesw-resize',w:'ew-resize' };
                const HANDLE_POS: Record<string, React.CSSProperties> = {
                  nw:{top:-5,left:-5}, n:{top:-5,left:'calc(50% - 5px)'}, ne:{top:-5,right:-5},
                  e:{top:'calc(50% - 5px)',right:-5}, se:{bottom:-5,right:-5},
                  s:{bottom:-5,left:'calc(50% - 5px)'}, sw:{bottom:-5,left:-5}, w:{top:'calc(50% - 5px)',left:-5},
                };
                return (
                  <div
                    key={ov.id}
                    className="absolute pointer-events-auto"
                    style={{
                      zIndex: 25,
                      left: boxLeft, top: boxTop,
                      width: boxW, height: boxH,
                      transform: ov.rotation ? `rotate(${ov.rotation}deg)` : undefined,
                      fontSize: fsPx,
                      fontFamily: ov.fontFamily,
                      fontWeight: ov.fontWeight,
                      color: ov.color,
                      opacity: ov.opacity,
                      backgroundColor: ov.bgColor || undefined,
                      borderRadius: ov.bgColor ? 4 : undefined,
                      cursor: 'move',
                      border: isEditing ? '2px solid #ec4899' : '1px dashed rgba(255,255,255,0.4)',
                      userSelect: 'none',
                      lineHeight: 1.2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      overflow: 'hidden',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).closest('[data-delete],[data-handle]')) return;
                      if (e.button !== 0) return;
                      e.preventDefault(); e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setEditingTextId(ov.id);
                      const orig = [...(project.textOverlays ?? [])];
                      const origOv = orig.find(o => o.id === ov.id);
                      if (!origOv) return;
                      textDragRef.current = {
                        id: ov.id, startMX: e.clientX, startMY: e.clientY,
                        startX: origOv.x, startY: origOv.y, origOverlays: orig,
                      };
                    }}
                    onPointerMove={(e) => {
                      const dr = textDragRef.current;
                      if (!dr || dr.id !== ov.id) return;
                      const dx = e.clientX - dr.startMX;
                      const dy = e.clientY - dr.startMY;
                      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                      const f = getVideoFrame(); if (!f) return;
                      const nx = Math.max(2, Math.min(98, dr.startX + (dx / f.w) * 100));
                      const ny = Math.max(2, Math.min(98, dr.startY + (dy / f.h) * 100));
                      const upd = dr.origOverlays.map(o => o.id === ov.id ? { ...o, x: nx, y: ny } : o);
                      liveTextOverlaysRef.current = upd; setLiveTextOverlays([...upd]);
                    }}
                    onPointerUp={() => {
                      if (!textDragRef.current || textDragRef.current.id !== ov.id) return;
                      textDragRef.current = null;
                      const final = liveTextOverlaysRef.current;
                      liveTextOverlaysRef.current = null; setLiveTextOverlays(null);
                      if (final) updateTextOverlays(final);
                    }}
                  >
                    <span className="pointer-events-none">{ov.text}</span>
                    {/* Delete button */}
                    <button
                      data-delete="true"
                      className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-400 transition-colors z-10"
                      style={{ fontSize: 10 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); deleteTextOverlay(ov.id); }}
                    >
                      <X className="w-2.5 h-2.5 text-white" />
                    </button>
                    {/* Resize handles — 8 directions */}
                    {isEditing && HANDLES.map(h => (
                      <div
                        key={h}
                        data-handle={h}
                        className="absolute w-2.5 h-2.5 rounded-full bg-pink-400 border border-white pointer-events-auto"
                        style={{ cursor: HANDLE_CURSOR[h], ...HANDLE_POS[h] }}
                        onPointerDown={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          const orig = [...(project.textOverlays ?? [])];
                          const origOv = orig.find(o => o.id === ov.id)!;
                          textResizeRef.current = {
                            id: ov.id, handle: h,
                            startMX: e.clientX, startMY: e.clientY,
                            startW: origOv.width ?? 30, startH: origOv.height ?? 8,
                            startX: origOv.x, startY: origOv.y,
                            origOverlays: orig,
                          };
                        }}
                        onPointerMove={(e) => {
                          const rr = textResizeRef.current;
                          if (!rr || rr.id !== ov.id) return;
                          const f = getVideoFrame(); if (!f) return;
                          const dxPct = ((e.clientX - rr.startMX) / f.w) * 100;
                          const dyPct = ((e.clientY - rr.startMY) / f.h) * 100;
                          let nw = rr.startW, nh = rr.startH, nx = rr.startX, ny = rr.startY;
                          // East edge
                          if (rr.handle.includes('e')) { nw = Math.max(5, rr.startW + dxPct * 2); }
                          // West edge
                          if (rr.handle.includes('w')) { nw = Math.max(5, rr.startW - dxPct * 2); }
                          // South edge
                          if (rr.handle.includes('s')) { nh = Math.max(2, rr.startH + dyPct * 2); }
                          // North edge
                          if (rr.handle.includes('n')) { nh = Math.max(2, rr.startH - dyPct * 2); }
                          nw = Math.min(100, nw); nh = Math.min(100, nh);
                          const upd = rr.origOverlays.map(o => o.id === ov.id ? { ...o, width: Math.round(nw * 10) / 10, height: Math.round(nh * 10) / 10 } : o);
                          liveTextOverlaysRef.current = upd; setLiveTextOverlays([...upd]);
                        }}
                        onPointerUp={() => {
                          if (!textResizeRef.current || textResizeRef.current.id !== ov.id) return;
                          textResizeRef.current = null;
                          const final = liveTextOverlaysRef.current;
                          liveTextOverlaysRef.current = null; setLiveTextOverlays(null);
                          if (final) updateTextOverlays(final);
                        }}
                      />
                    ))}
                  </div>
                );
              });
            })()}

            {/* Crop overlay — dark mask outside selection + confirm/cancel buttons */}
            {cropMode && cropRect && cropRawRect && (() => {
              const { left, top, width: rw, height: rh } = cropRawRect;
              const vf = getVideoFrame();
              const cW = playerContainerRef.current?.clientWidth ?? 0;
              const cH = playerContainerRef.current?.clientHeight ?? 0;
              return (
                <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 30 }}>
                  {/* four dark masks around selection */}
                  <div className="absolute bg-black/60 pointer-events-none" style={{ left: 0, top: 0, width: cW, height: top }} />
                  <div className="absolute bg-black/60 pointer-events-none" style={{ left: 0, top: top + rh, width: cW, height: cH - top - rh }} />
                  <div className="absolute bg-black/60 pointer-events-none" style={{ left: 0, top, width: left, height: rh }} />
                  <div className="absolute bg-black/60 pointer-events-none" style={{ left: left + rw, top, width: cW - left - rw, height: rh }} />
                  {/* selection border */}
                  <div className="absolute border-2 border-emerald-400 pointer-events-none" style={{ left, top, width: rw, height: rh }} />
                  {/* rule-of-thirds grid lines */}
                  {[1/3, 2/3].map(f => (
                    <div key={`cv${f}`} className="absolute bg-white/20 pointer-events-none" style={{ left: left + rw * f, top, width: 1, height: rh }} />
                  ))}
                  {[1/3, 2/3].map(f => (
                    <div key={`ch${f}`} className="absolute bg-white/20 pointer-events-none" style={{ left, top: top + rh * f, width: rw, height: 1 }} />
                  ))}
                  {/* confirm / redraw buttons */}
                  <div className="absolute flex gap-2 pointer-events-auto" style={{ left, top: top + rh + 6, zIndex: 31 }}>
                    <button
                      disabled={isBusy}
                      onClick={() => cropMutation.mutate(cropRect)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg transition-colors disabled:opacity-50"
                    >
                      <Crop className="w-3 h-3" />
                      {cropMutation.isPending ? t('common.loading') : t('editor.cropConfirm')}
                    </button>
                    <button
                      onClick={() => { setCropRect(null); setCropRawRect(null); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/10 hover:bg-white/20 text-white shadow-lg transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                  <div className="absolute pointer-events-none text-white/70 text-[10px]" style={{ left, top: top - 18 }}>
                    {void vf}
                    {Math.round(cropRect.width)}% × {Math.round(cropRect.height)}%
                  </div>
                </div>
              );
            })()}

            {/* Active-mode badges — z-40 so they sit above the capture layer (z-30) */}
            {(trimMode || blurDrawMode || cropMode) && (
              <div className="absolute bottom-2 left-2 z-40 flex items-center gap-1.5 pointer-events-auto">
                {trimMode && (
                  <button
                    onClick={() => { setTrimMode(false); setTrimIn(null); setTrimOut(null); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-sky-500 text-white shadow-lg transition-colors"
                  >
                    <Scissors className="w-3 h-3" />
                    {t('common.cancel')}
                  </button>
                )}
                {blurDrawMode && (
                  <button
                    onClick={() => { setBlurDrawMode(false); setPendingRegion(null); drawingRectRef.current = null; setDrawingRect(null); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500 text-white shadow-lg transition-colors"
                  >
                    <EyeOff className="w-3 h-3" />
                    {t('editor.blurDone')}
                  </button>
                )}
                {cropMode && (
                  <button
                    onClick={() => { setCropMode(false); setCropRect(null); setCropRawRect(null); drawingRectRef.current = null; setDrawingRect(null); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500 text-white shadow-lg transition-colors"
                  >
                    <Crop className="w-3 h-3" />
                    {t('common.cancel')}
                  </button>
                )}
              </div>
            )}

            {/* Right-click context menu */}
            {ctxMenu && (
              <div
                ref={ctxMenuRef}
                className="absolute z-50 bg-c-surface border border-c-border rounded-xl shadow-2xl shadow-black/50 py-1 min-w-[160px] pointer-events-auto"
                style={{
                  left: Math.min(ctxMenu.x, (playerContainerRef.current?.clientWidth ?? 400) - 170),
                  top: Math.min(ctxMenu.y, (playerContainerRef.current?.clientHeight ?? 300) - 120),
                }}
              >
                <div className="px-3 py-1 text-[10px] text-c-dim uppercase tracking-wider font-semibold border-b border-c-border/50 mb-1">
                  {t('editor.tools')}
                </div>
                <button
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-[12px] transition-colors text-left',
                    blurDrawMode ? 'text-amber-400 bg-amber-500/10' : 'text-c-text hover:bg-c-elevated'
                  )}
                  onClick={() => { setCtxMenu(null); setBlurDrawMode((m) => !m); if (blurDrawMode) { setPendingRegion(null); drawingRectRef.current = null; setDrawingRect(null); } }}
                >
                  <EyeOff className="w-3.5 h-3.5 shrink-0" />
                  {blurDrawMode ? t('editor.blurDone') : t('editor.addBlur')}
                </button>
                <button
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-[12px] transition-colors text-left',
                    trimMode ? 'text-sky-400 bg-sky-500/10' : 'text-c-text hover:bg-c-elevated'
                  )}
                  onClick={() => { setCtxMenu(null); setTrimMode((m) => !m); setTrimIn(null); setTrimOut(null); }}
                >
                  <Scissors className="w-3.5 h-3.5 shrink-0" />
                  {trimMode ? t('editor.trimCancel') : t('editor.trim')}
                </button>
                <button
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-[12px] transition-colors text-left',
                    cropMode ? 'text-emerald-400 bg-emerald-500/10' : 'text-c-text hover:bg-c-elevated'
                  )}
                  onClick={() => { setCtxMenu(null); setCropMode((m) => !m); setCropRect(null); setCropRawRect(null); }}
                >
                  <Crop className="w-3.5 h-3.5 shrink-0" />
                  {cropMode ? t('common.cancel') : t('editor.crop')}
                </button>
                {project.outputPath && (
                  <>
                    <div className="border-t border-c-border/50 my-1" />
                    <a
                      href={`/api/export/${project.id}/download?v=${encodeURIComponent(project.updatedAt)}`}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-c-text hover:bg-c-elevated transition-colors"
                      onClick={() => setCtxMenu(null)}
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      {t('common.download')}
                    </a>
                  </>
                )}
              </div>
            )}

          </div>

          {/* AI caption card — only for imported videos that have an original description */}
          {project.originalDescription && (() => {
            const aiCaption = project.aiDescription;
            const isGenerating = generateDescriptionMutation.isPending;
            const author = project.originalAuthor;
            const authorHref = project.originalAuthorUrl || project.importedFromUrl;
            return (
              <div className={clsx("border-b border-c-border bg-gradient-to-r from-violet-500/5 via-c-surface to-c-surface px-3 py-2.5 shrink-0", isAssembling && 'opacity-50 pointer-events-none')}>
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span className="text-[11px] font-semibold text-c-text">{t('editor.aiCaptionTitle')}</span>
                  {author && (
                    <span className="text-[10.5px] text-violet-300 flex items-center gap-1">
                      <span className="text-c-dim">·</span>
                      {authorHref ? (
                        <a href={authorHref} target="_blank" rel="noreferrer" className="hover:underline" title={authorHref}>
                          {t('editor.aiCaptionBy')} {author}
                        </a>
                      ) : (
                        <span>{t('editor.aiCaptionBy')} {author}</span>
                      )}
                    </span>
                  )}
                  {project.importedFromUrl && (
                    <a
                      href={project.importedFromUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={project.importedFromUrl}
                      className="ml-auto text-[10px] text-c-muted hover:text-c-text flex items-center gap-1 truncate max-w-[40%]"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{t('editor.aiCaptionSource')}</span>
                    </a>
                  )}
                </div>

                {isGenerating ? (
                  <div className="text-[12px] text-c-muted italic flex items-center gap-1.5 py-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    {t('editor.aiCaptionLoading')}
                  </div>
                ) : aiCaption ? (
                  <div className="text-[12.5px] text-c-text leading-relaxed whitespace-pre-wrap select-text">{aiCaption}</div>
                ) : (
                  <div className="text-[12px] text-c-muted italic py-1">{t('editor.aiCaptionEmpty')}</div>
                )}

                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {aiCaption && !isGenerating && (
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(aiCaption);
                          setCaptionCopied(true);
                          window.setTimeout(() => setCaptionCopied(false), 1500);
                        } catch { /* clipboard may be blocked */ }
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 border border-violet-500/30 transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      {captionCopied ? t('editor.aiCaptionCopied') : t('editor.aiCaptionCopy')}
                    </button>
                  )}
                  <button
                    onClick={() => generateDescriptionMutation.mutate()}
                    disabled={isBusy}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium text-c-muted hover:text-c-text border border-c-border hover:bg-c-elevated transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={clsx('w-3 h-3', isBusy && 'animate-spin')} />
                    {aiCaption ? t('editor.aiCaptionRegenerate') : t('editor.aiCaptionGenerate')}
                  </button>
                  <button
                    onClick={() => setShowOriginalDescription((v) => !v)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium text-c-muted hover:text-c-text border border-c-border hover:bg-c-elevated transition-colors"
                  >
                    {showOriginalDescription ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showOriginalDescription ? t('editor.aiCaptionHideOriginal') : t('editor.aiCaptionViewOriginal')}
                  </button>
                </div>

                {showOriginalDescription && (
                  <div className="mt-2 pt-2 border-t border-c-border/50">
                    <div className="text-[10px] uppercase tracking-wide text-c-muted mb-1">{t('editor.aiCaptionOriginal')}</div>
                    <div className="text-[12px] text-c-muted leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto select-text">{project.originalDescription}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Save & Download card — only when assembly has produced an output file.
              Lets the user mark work-in-progress status, jot a note, and download the .mp4. */}
          {project.outputPath && (() => {
            const isUploaded = uploadStatusDraft === 'uploaded';
            const isWorking = uploadStatusDraft === 'in_progress';
            const dirty = (project.uploadStatus ?? 'pending') !== uploadStatusDraft
              || (project.uploadNote ?? '') !== uploadNoteDraft;
            const downloadHref = `/api/export/${project.id}/download?v=${encodeURIComponent(project.updatedAt)}`;
            // Status icon + tint key off the current draft so the card visually reflects state
            const statusIcon = isUploaded
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              : isWorking
                ? <Save className="w-3.5 h-3.5 text-amber-400" />
                : <CircleDashed className="w-3.5 h-3.5 text-c-muted" />;
            const gradientTint = isUploaded
              ? 'from-emerald-500/5'
              : isWorking
                ? 'from-amber-500/5'
                : 'from-c-elevated/30';
            return (
              <div className={clsx('border-b border-c-border bg-gradient-to-r via-c-surface to-c-surface px-3 py-2.5 shrink-0', gradientTint, isAssembling && 'opacity-50 pointer-events-none')}>
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  {statusIcon}
                  <span className="text-[11px] font-semibold text-c-text">{t('editor.uploadCardTitle')}</span>
                  {isUploaded && project.uploadedAt && (
                    <span className="text-[10.5px] text-emerald-300/80">
                      · {new Date(project.uploadedAt).toLocaleString()}
                    </span>
                  )}
                </div>

                {/* Status segmented control — 3 states: pending / in-progress / uploaded */}
                <div className="flex rounded-md overflow-hidden border border-c-border text-[11px] mb-2 w-fit">
                  <button
                    onClick={() => setUploadStatusDraft('pending')}
                    className={clsx('px-2.5 py-1 transition-colors', uploadStatusDraft === 'pending' ? 'bg-c-elevated text-c-text' : 'text-c-muted hover:text-c-text')}
                  >
                    {t('editor.uploadPending')}
                  </button>
                  <button
                    onClick={() => setUploadStatusDraft('in_progress')}
                    className={clsx('px-2.5 py-1 transition-colors border-l border-c-border', uploadStatusDraft === 'in_progress' ? 'bg-amber-500/20 text-amber-300' : 'text-c-muted hover:text-c-text')}
                  >
                    {t('editor.uploadInProgress')}
                  </button>
                  <button
                    onClick={() => setUploadStatusDraft('uploaded')}
                    className={clsx('px-2.5 py-1 transition-colors border-l border-c-border', uploadStatusDraft === 'uploaded' ? 'bg-emerald-500/20 text-emerald-300' : 'text-c-muted hover:text-c-text')}
                  >
                    {t('editor.uploadUploaded')}
                  </button>
                </div>

                {/* Note input — visible for in-progress (TODOs / next steps) and uploaded (where posted) */}
                {(isUploaded || isWorking) && (
                  <input
                    type="text"
                    value={uploadNoteDraft}
                    onChange={(e) => setUploadNoteDraft(e.target.value)}
                    placeholder={isWorking ? t('editor.uploadWorkingNotePlaceholder') : t('editor.uploadNotePlaceholder')}
                    className="input text-[12px] mb-2"
                  />
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => uploadStatusMutation.mutate({ status: uploadStatusDraft, note: uploadNoteDraft || undefined })}
                    disabled={!dirty || isBusy}
                    className={clsx(
                      'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors',
                      dirty
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-white'
                        : 'bg-c-elevated text-c-muted cursor-default'
                    )}
                  >
                    <Save className="w-3 h-3" />
                    {uploadStatusMutation.isPending ? t('common.loading') : t('editor.saveStatus')}
                  </button>
                  <a
                    href={downloadHref}
                    download
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-c-border text-c-text hover:bg-c-elevated transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    {t('common.download')}
                  </a>
                  <button
                    onClick={() => setDistributeOpen(true)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-accent-primary/50 text-accent-hover hover:bg-accent-primary/10 transition-colors"
                  >
                    <Send className="w-3 h-3" />
                    {t('distribution.distributeBtn_short')}
                  </button>
                </div>
              </div>
            );
          })()}

          {distributeOpen && project && (
            <DistributeModal
              videoId={project.id}
              videoTitle={project.title}
              onClose={() => setDistributeOpen(false)}
            />
          )}

          {/* Blur controls strip */}
          {(blurDrawMode || pendingRegion !== null || (project.blurRegions?.length ?? 0) > 0) && (
            <div className={clsx("border-b border-c-border bg-c-surface px-3 py-2 shrink-0 flex items-center gap-3 flex-wrap", isAssembling && 'opacity-50 pointer-events-none')}>
              {/* ── Pending region: configure then confirm ── */}
              {pendingRegion ? (
                <>
                  <span className="text-[11px] font-medium text-c-text shrink-0">{t('editor.blurNewRegion')}</span>

                  {/* Type toggle */}
                  <div className="flex rounded-md overflow-hidden border border-c-border text-[11px]">
                    <button
                      onClick={() => setBlurMode('blur')}
                      className={clsx('px-2.5 py-1 transition-colors', blurMode === 'blur' ? 'bg-amber-500/20 text-amber-300' : 'text-c-muted hover:text-c-text')}
                    >{t('editor.blurGaussian')}</button>
                    <button
                      onClick={() => setBlurMode('pixelate')}
                      className={clsx('px-2.5 py-1 transition-colors border-l border-c-border', blurMode === 'pixelate' ? 'bg-violet-500/20 text-violet-300' : 'text-c-muted hover:text-c-text')}
                    >{t('editor.blurMosaic')}</button>
                  </div>

                  {/* Strength slider */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-c-dim">{t('editor.blurSigma')}</span>
                    <input
                      type="range"
                      min={blurMode === 'pixelate' ? 4 : 2}
                      max={blurMode === 'pixelate' ? 40 : 30}
                      value={blurStrength}
                      onChange={(e) => setBlurStrength(Number(e.target.value))}
                      className="w-24 h-1.5 accent-amber-400"
                    />
                    <span className="text-[11px] font-mono text-c-text w-4">{blurStrength}</span>
                  </div>

                  {/* Cancel / Confirm */}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => setPendingRegion(null)}
                      className="text-[11px] px-2.5 py-1 rounded border border-c-border text-c-muted hover:text-c-text transition-colors"
                    >{t('common.cancel')}</button>
                    <button
                      onClick={confirmPendingRegion}
                      className="text-[11px] px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-white font-medium transition-colors flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      {t('editor.blurAdd')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Draw mode defaults */}
                  {blurDrawMode && (
                    <>
                      <div className="flex rounded-md overflow-hidden border border-c-border text-[11px]">
                        <button
                          onClick={() => setBlurMode('blur')}
                          className={clsx('px-2.5 py-1 transition-colors', blurMode === 'blur' ? 'bg-amber-500/20 text-amber-300' : 'text-c-muted hover:text-c-text')}
                        >{t('editor.blurGaussian')}</button>
                        <button
                          onClick={() => setBlurMode('pixelate')}
                          className={clsx('px-2.5 py-1 transition-colors border-l border-c-border', blurMode === 'pixelate' ? 'bg-violet-500/20 text-violet-300' : 'text-c-muted hover:text-c-text')}
                        >{t('editor.blurMosaic')}</button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-c-dim">{t('editor.blurSigma')}</span>
                        <input type="range" min={blurMode === 'pixelate' ? 4 : 2} max={blurMode === 'pixelate' ? 40 : 30}
                          value={blurStrength} onChange={(e) => setBlurStrength(Number(e.target.value))}
                          className="w-20 h-1.5 accent-amber-400" />
                        <span className="text-[11px] font-mono text-c-text w-4">{blurStrength}</span>
                      </div>
                    </>
                  )}

                  {/* Region chips */}
                  {(project.blurRegions ?? []).map((region, i) => (
                    <div key={region.id} className="flex items-center gap-1 px-2 py-0.5 rounded border text-[11px]"
                      style={{ borderColor: region.type === 'pixelate' ? '#a78bfa66' : '#fbbf2466', color: region.type === 'pixelate' ? '#c4b5fd' : '#fcd34d' }}>
                      <span>#{i + 1} {region.type === 'pixelate' ? t('editor.blurMosaic') : t('editor.blurGaussian')}</span>
                      <button onClick={() => updateBlurRegions((project.blurRegions ?? []).filter((r) => r.id !== region.id))}
                        className="ml-0.5 hover:text-red-400 transition-colors">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}

                  {(project.blurRegions?.length ?? 0) > 1 && (
                    <button onClick={() => updateBlurRegions([])} className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors ml-auto">
                      {t('editor.blurClear')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Text overlay controls strip */}
          {(textMode || editingTextId || (project.textOverlays?.length ?? 0) > 0) && (
            <div className={clsx("border-b border-c-border bg-c-surface px-3 py-2 shrink-0 flex items-center gap-3 flex-wrap", isAssembling && 'opacity-50 pointer-events-none')}>
              {editingTextId && (() => {
                const ov = (project.textOverlays ?? []).find(o => o.id === editingTextId);
                if (!ov) return null;
                return (
                  <>
                    <textarea
                      value={ov.text}
                      onChange={(e) => updateSingleTextOverlay(ov.id, { text: e.target.value })}
                      className="bg-c-elevated border border-c-border rounded px-2 py-1 text-xs text-c-text w-32 focus:border-pink-400 outline-none resize-none"
                      placeholder={t('editor.textPlaceholder')}
                      rows={2}
                      autoFocus
                    />

                    {/* Font */}
                    <select
                      value={ov.fontFamily}
                      onChange={(e) => updateSingleTextOverlay(ov.id, { fontFamily: e.target.value })}
                      className="bg-c-elevated border border-c-border rounded px-1.5 py-1 text-[11px] text-c-text outline-none"
                    >
                      {['Arial', 'Impact', 'Georgia', 'Courier New', 'Verdana', 'Comic Sans MS', 'Trebuchet MS'].map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>

                    {/* Bold */}
                    <button
                      onClick={() => updateSingleTextOverlay(ov.id, { fontWeight: ov.fontWeight === 'bold' ? 'normal' : 'bold' })}
                      className={clsx('px-2 py-1 rounded border text-[11px] font-bold transition-colors',
                        ov.fontWeight === 'bold' ? 'bg-pink-500/20 text-pink-300 border-pink-500/40' : 'text-c-muted border-c-border hover:text-c-text'
                      )}
                    >B</button>

                    {/* Size */}
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-c-dim">{t('editor.textFontSize')}</span>
                      <input type="range" min={1} max={15} step={0.5}
                        value={ov.fontSize} onChange={(e) => updateSingleTextOverlay(ov.id, { fontSize: Number(e.target.value) })}
                        className="w-16 h-1.5 accent-pink-400" />
                      <span className="text-[11px] font-mono text-c-text w-6">{ov.fontSize}</span>
                    </div>

                    {/* Color */}
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-c-dim">{t('editor.textColor')}</span>
                      <input type="color" value={ov.color}
                        onChange={(e) => updateSingleTextOverlay(ov.id, { color: e.target.value })}
                        className="w-6 h-6 rounded border border-c-border cursor-pointer" />
                    </div>

                    {/* BG Color */}
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-c-dim">{t('editor.textBgColor')}</span>
                      <input type="color" value={ov.bgColor?.slice(0, 7) || '#000000'}
                        onChange={(e) => updateSingleTextOverlay(ov.id, { bgColor: e.target.value + '80' })}
                        className="w-6 h-6 rounded border border-c-border cursor-pointer" />
                      <button
                        onClick={() => updateSingleTextOverlay(ov.id, { bgColor: '' })}
                        className="text-[10px] text-c-muted hover:text-c-text"
                      >×</button>
                    </div>

                    {/* Animation */}
                    <select
                      value={ov.animation}
                      onChange={(e) => updateSingleTextOverlay(ov.id, { animation: e.target.value as TextOverlay['animation'] })}
                      className="bg-c-elevated border border-c-border rounded px-1.5 py-1 text-[11px] text-c-text outline-none"
                    >
                      <option value="none">{t('editor.textAnimNone')}</option>
                      <option value="fade-in">{t('editor.textAnimFadeIn')}</option>
                      <option value="slide-up">{t('editor.textAnimSlideUp')}</option>
                      <option value="pop">{t('editor.textAnimPop')}</option>
                      <option value="typewriter">{t('editor.textAnimTypewriter')}</option>
                    </select>

                    {/* Delete */}
                    <button onClick={() => deleteTextOverlay(ov.id)}
                      className="ml-auto text-red-400/70 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                );
              })()}

              {!editingTextId && (
                <>
                  {/* Text overlay chips */}
                  {(project.textOverlays ?? []).map((ov, i) => (
                    <div key={ov.id}
                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-pink-400/40 text-[11px] text-pink-300 cursor-pointer hover:bg-pink-500/10 transition-colors"
                      onClick={() => setEditingTextId(ov.id)}
                    >
                      <Type className="w-3 h-3" />
                      <span className="max-w-[80px] truncate">#{i + 1} {ov.text}</span>
                      <button onClick={(e) => { e.stopPropagation(); deleteTextOverlay(ov.id); }}
                        className="ml-0.5 hover:text-red-400 transition-colors">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}

                  {(project.textOverlays?.length ?? 0) > 1 && (
                    <button onClick={() => updateTextOverlays([])} className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors ml-auto">
                      {t('editor.textClear')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Trim controls — visual scrubber */}
          {trimMode && (
            <div className={clsx("border-b border-c-border bg-c-surface shrink-0 px-3 pt-3 pb-2 select-none", isAssembling && 'opacity-50 pointer-events-none')}>
              {/* ── Timeline scrubber bar ── */}
              <div
                ref={trimScrubberRef}
                className="relative h-8 cursor-pointer mb-1"
                onPointerDown={onTrimScrubberPointerDown}
                onPointerMove={onTrimScrubberPointerMove}
                onPointerUp={onTrimScrubberPointerUp}
                onPointerCancel={onTrimScrubberPointerUp}
              >
                {/* Track */}
                <div className="absolute inset-x-0 top-3 bottom-3 rounded bg-c-elevated" />

                {/* Excluded (grey) zones outside in/out */}
                {trimIn !== null && (
                  <div className="absolute top-3 bottom-3 rounded-l bg-black/40"
                    style={{ left: 0, width: `${(Math.min(trimIn, trimOut ?? totalDuration) / totalDuration) * 100}%` }} />
                )}
                {trimOut !== null && (
                  <div className="absolute top-3 bottom-3 rounded-r bg-black/40"
                    style={{ left: `${(Math.max(trimOut, trimIn ?? 0) / totalDuration) * 100}%`, right: 0 }} />
                )}

                {/* Selected region */}
                {trimIn !== null && trimOut !== null && (
                  <div
                    className="absolute top-2 bottom-2 bg-sky-500/40 border-t-2 border-b-2 border-sky-400"
                    style={{
                      left: `${(Math.min(trimIn, trimOut) / totalDuration) * 100}%`,
                      width: `${(Math.abs(trimOut - trimIn) / totalDuration) * 100}%`,
                    }}
                  />
                )}

                {/* In handle */}
                {trimIn !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-3 -translate-x-1/2 flex items-center justify-center cursor-ew-resize z-10"
                    style={{ left: `${(trimIn / totalDuration) * 100}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setTrimDragging('in');
                      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                      // Seek to the in-point on grab so the user sees the current frame for fine-tuning
                      if (trimIn !== null) requestSeek(trimIn);
                    }}
                    onPointerMove={(e) => {
                      if (trimDragging !== 'in') return;
                      const r = trimScrubberRef.current!.getBoundingClientRect();
                      const time = Math.max(0, Math.min(totalDuration, ((e.clientX - r.left) / r.width) * totalDuration));
                      setTrimIn(time);
                      requestSeek(time);
                    }}
                    onPointerUp={() => setTrimDragging(null)}
                  >
                    <div className="w-2.5 h-6 rounded-sm bg-sky-400 flex flex-col items-center justify-center gap-0.5 shadow-lg">
                      <div className="w-0.5 h-3 bg-white/60 rounded-full" />
                    </div>
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-mono text-sky-300 whitespace-nowrap">{formatHms(trimIn)}</span>
                  </div>
                )}

                {/* Out handle */}
                {trimOut !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-3 -translate-x-1/2 flex items-center justify-center cursor-ew-resize z-10"
                    style={{ left: `${(trimOut / totalDuration) * 100}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setTrimDragging('out');
                      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                      if (trimOut !== null) requestSeek(trimOut);
                    }}
                    onPointerMove={(e) => {
                      if (trimDragging !== 'out') return;
                      const r = trimScrubberRef.current!.getBoundingClientRect();
                      const time = Math.max(0, Math.min(totalDuration, ((e.clientX - r.left) / r.width) * totalDuration));
                      setTrimOut(time);
                      requestSeek(time);
                    }}
                    onPointerUp={() => setTrimDragging(null)}
                  >
                    <div className="w-2.5 h-6 rounded-sm bg-sky-400 flex flex-col items-center justify-center gap-0.5 shadow-lg">
                      <div className="w-0.5 h-3 bg-white/60 rounded-full" />
                    </div>
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-mono text-sky-300 whitespace-nowrap">{formatHms(trimOut)}</span>
                  </div>
                )}

                {/* Playhead */}
                <div
                  className="absolute top-1 bottom-1 w-0.5 bg-white pointer-events-none z-20"
                  style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                >
                  <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white shadow" />
                </div>

                {/* Duration labels */}
                <span className="absolute -bottom-4 left-0 text-[9px] font-mono text-c-dim">00:00</span>
                <span className="absolute -bottom-4 right-0 text-[9px] font-mono text-c-dim">{formatHms(totalDuration)}</span>
              </div>

              {/* ── Controls row ── */}
              <div className="mt-5 flex items-center gap-2 flex-wrap">
                {/* Current time */}
                <div className="flex items-center gap-1 text-[11px] text-sky-400 font-mono shrink-0">
                  <Clock className="w-3 h-3" />
                  {formatHms(currentTime)}
                </div>

                {/* In point */}
                <button
                  onClick={() => setTrimIn(currentTime)}
                  title={t('editor.trimIn') + ' (I)'}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors',
                    trimIn !== null ? 'border-sky-400 bg-sky-500/20 text-sky-300' : 'border-c-border text-c-muted hover:border-sky-400 hover:text-sky-300'
                  )}
                >
                  <span className="opacity-60 text-[9px] font-bold">[I]</span>
                  {trimIn !== null ? <span className="font-mono">{formatHms(trimIn)}</span> : <span>{t('editor.trimIn')}</span>}
                </button>

                {/* Out point */}
                <button
                  onClick={() => setTrimOut(currentTime)}
                  title={t('editor.trimOut') + ' (O)'}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors',
                    trimOut !== null ? 'border-sky-400 bg-sky-500/20 text-sky-300' : 'border-c-border text-c-muted hover:border-sky-400 hover:text-sky-300'
                  )}
                >
                  {trimOut !== null ? <span className="font-mono">{formatHms(trimOut)}</span> : <span>{t('editor.trimOut')}</span>}
                  <span className="opacity-60 text-[9px] font-bold">[O]</span>
                </button>

                {/* Duration badge */}
                {trimIn !== null && trimOut !== null && (
                  <span className="text-[11px] text-c-dim">
                    = {formatHms(Math.abs(trimOut - trimIn))}
                  </span>
                )}

                {/* Reset */}
                {(trimIn !== null || trimOut !== null) && (
                  <button
                    onClick={() => { setTrimIn(null); setTrimOut(null); }}
                    className="text-[11px] text-c-dim hover:text-c-muted transition-colors"
                  >
                    {t('common.reset')}
                  </button>
                )}

                {/* Apply */}
                <button
                  onClick={() => {
                    if (trimIn === null || trimOut === null) return;
                    trimMutation.mutate({ start: Math.min(trimIn, trimOut), end: Math.max(trimIn, trimOut) });
                  }}
                  disabled={trimIn === null || trimOut === null || trimIn === trimOut || isBusy}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white text-[11px] font-medium transition-colors"
                >
                  {trimMutation.isPending ? <Spinner size="sm" /> : <Scissors className="w-3 h-3" />}
                  {t('editor.trimApply')}
                </button>
              </div>
            </div>
          )}

          {/* Scene timeline */}
          {/* Timeline container — flex-col so header stays fixed and content scrolls.
              min-h gives it real estate even when the player consumes most of the viewport,
              so users can always scroll the outer column to reach it. */}
          <div className={clsx("flex-1 flex flex-col min-h-[320px]", isAssembling && 'opacity-50 pointer-events-none')}>
            {/* Header */}
            <div className="px-6 py-3 border-b border-c-border flex items-center justify-between shrink-0">
              <span className="text-xs font-medium text-c-muted uppercase tracking-wider">
                {t('editor.sceneTimeline')}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-c-dim">
                  {project.scenes.length} {t('editor.scenesCount')}
                </span>
                <div className="flex items-center gap-0.5 bg-c-elevated rounded-md p-0.5">
                  <button
                    onClick={() => setTimelineLayout('vertical')}
                    title={t('editor.timelineVertical')}
                    className={clsx(
                      'p-1 rounded transition-colors',
                      timelineLayout === 'vertical'
                        ? 'bg-accent-primary text-white'
                        : 'text-c-dim hover:text-c-text'
                    )}
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setTimelineLayout('horizontal')}
                    title={t('editor.timelineHorizontal')}
                    className={clsx(
                      'p-1 rounded transition-colors',
                      timelineLayout === 'horizontal'
                        ? 'bg-accent-primary text-white'
                        : 'text-c-dim hover:text-c-text'
                    )}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {project.scenes.length === 0 ? (
              <div className="flex-1 overflow-y-auto">
                <SceneSplitter project={project} />
              </div>
            ) : timelineLayout === 'horizontal' ? (
              /* Horizontal filmstrip — dedicated x-scroll container, never clips via parent */
              <div className="flex-1 overflow-x-auto overflow-y-hidden">
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={project.scenes.map((_, i) => `scene-${i}`)}
                    strategy={horizontalListSortingStrategy}
                  >
                    {/* w-max so the row grows to fit all cards; min-w-full prevents gap when few scenes */}
                    <div className="flex flex-row gap-1.5 p-3 h-full min-w-full w-max">
                      {(() => {
                        let runningStart = 0;
                        return project.scenes.map((scene, i) => {
                          const startTime = runningStart;
                          runningStart += scene.duration;
                          const ae = appliedEdits.find((e) => e.sceneIndex === i);
                          const isAct = currentTime >= startTime && currentTime < startTime + scene.duration;
                          return (
                            <SortableHorizontalCard
                              key={`scene-${i}`}
                              id={`scene-${i}`}
                              scene={scene}
                              index={i}
                              startTime={startTime}
                              isActive={isAct}
                              appliedEdit={ae}
                              onCut={() => handleCutScene(i, startTime)}
                              onSave={(changes) => {
                                const next = project.scenes.map((s, idx) => idx === i ? { ...s, ...changes } : s);
                                updateScenes(next);
                              }}
                              onDelete={() => updateScenes(project.scenes.filter((_, idx) => idx !== i))}
                              saving={updateScenesMutation.isPending}
                            />
                          );
                        });
                      })()}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            ) : (
              /* Vertical list — dedicated y-scroll container */
              <div className="flex-1 overflow-y-auto min-h-0">
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={project.scenes.map((_, i) => `scene-${i}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="p-4 space-y-2">
                      {(() => {
                        let runningStart = 0;
                        return project.scenes.map((scene, i) => {
                          const startTime = runningStart;
                          runningStart += scene.duration;
                          return (
                            <SortableVerticalRow
                              key={`scene-${i}`}
                              id={`scene-${i}`}
                              onCut={() => handleCutScene(i, startTime)}
                            >
                              <SceneTimelineRow
                                scene={scene}
                                index={i}
                                videoId={videoId!}
                                startTime={startTime}
                                onSave={(changes) => {
                                  const next = project.scenes.map((s, idx) => idx === i ? { ...s, ...changes } : s);
                                  updateScenes(next);
                                }}
                                onDelete={() => updateScenes(project.scenes.filter((_, idx) => idx !== i))}
                                saving={updateScenesMutation.isPending}
                              />
                            </SortableVerticalRow>
                          );
                        });
                      })()}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            )}
          </div>
        </div>

        {/* Toggle handle — sits at the boundary between timeline and panel; the panel
            below is docked (animates width 0↔288px) so the player resizes responsively. */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? `${t('editor.hidePanel')} (Ctrl+B)` : `${t('editor.showPanel')} (Ctrl+B)`}
          className={clsx(
            'absolute top-1/2 -translate-y-1/2 z-40 w-6 h-16 bg-c-surface border-y border-l border-c-border rounded-l-md flex items-center justify-center text-c-muted hover:text-c-text shadow-lg transition-[right] duration-200 ease-out',
            sidebarOpen ? 'right-72' : 'right-0'
          )}
        >
          {sidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        {/* Right panel — docked: animates its width so the timeline column (and the player
            inside it) gets the reclaimed space when hidden. Inner div keeps a stable 288px
            width during the transition so tab labels don't reflow while sliding. */}
        <div className={clsx(
          'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          sidebarOpen ? 'w-72' : 'w-0'
        )}>
        <div className="w-72 h-full bg-c-surface border-l border-c-border flex flex-col">
          {/* One-click preset strip — moved here from the main toolbar */}
          <div className={clsx(isAssembling && 'opacity-50 pointer-events-none')}>
            <PresetBar scenes={project.scenes} compact />
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-c-border shrink-0">
            <button
              onClick={() => setActiveTab('properties')}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors',
                activeTab === 'properties'
                  ? 'border-accent-primary text-accent-hover'
                  : 'border-transparent text-c-muted hover:text-c-text'
              )}
            >
              <Settings2 className="w-3 h-3" />
              {t('editor.properties')}
            </button>
            <button
              onClick={() => setActiveTab('transform')}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors',
                activeTab === 'transform'
                  ? 'border-accent-primary text-accent-hover'
                  : 'border-transparent text-c-muted hover:text-c-text'
              )}
            >
              <Crop className="w-3 h-3" />
              {t('editor.tabTransform')}
            </button>
            <button
              onClick={() => setActiveTab('tools')}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors',
                activeTab === 'tools'
                  ? 'border-accent-primary text-accent-hover'
                  : 'border-transparent text-c-muted hover:text-c-text'
              )}
            >
              <Wrench className="w-3 h-3" />
              {t('editor.tabTools')}
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors relative',
                activeTab === 'ai'
                  ? 'border-accent-primary text-accent-hover'
                  : 'border-transparent text-c-muted hover:text-c-text'
              )}
            >
              <Brain className="w-3 h-3" />
              {t('editor.tabAi')}
              {pendingRecCount > 0 && activeTab !== 'ai' && (
                <span className="absolute top-1.5 right-2 w-4 h-4 bg-accent-primary text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                  {pendingRecCount > 9 ? '9+' : pendingRecCount}
                </span>
              )}
            </button>
          </div>

          {/* Panel content */}
          <div className={clsx("flex-1 overflow-hidden", isAssembling && activeTab !== 'tools' && 'opacity-50 pointer-events-none')}>
            {activeTab === 'properties' ? (
              <PropertiesPanel
                project={project}
                musicMoodMutation={musicMoodMutation}
                musicTrackMutation={musicTrackMutation}
                musicSettingsMutation={musicSettingsMutation}
                cachedTracks={cachedTracks}
                isBusy={isBusy}
                t={t}
              />
            ) : activeTab === 'transform' ? (
              <TransformPanel />
            ) : activeTab === 'tools' ? (
              <ToolsPanel
                project={project}
                onClearRegions={() => updateBlurRegions([])}
                onClearTextOverlays={() => updateTextOverlays([])}
                trimMode={trimMode}
                setTrimMode={setTrimMode}
                trimIn={trimIn}
                setTrimIn={setTrimIn}
                trimOut={trimOut}
                setTrimOut={setTrimOut}
                currentTime={currentTime}
                trimMutation={trimMutation}
                assembleJobId={assembleJobId}
                assemblyLogs={assemblyLogs}
                assemblyLogRef={assemblyLogRef}
                liveJob={liveJob}
                isBusy={isBusy}
                t={t}
              />
            ) : (
              <AIRecommendationSidebar scenes={project.scenes} />
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── Properties Panel ────────────────────────────────────────────────────────

function PropertiesPanel({
  project,
  musicMoodMutation,
  musicTrackMutation,
  musicSettingsMutation,
  cachedTracks,
  isBusy,
  t,
}: {
  project: VideoProject;
  musicMoodMutation: ReturnType<typeof useMutation<VideoProject, Error, string>>;
  musicTrackMutation: ReturnType<typeof useMutation<VideoProject, Error, string | null>>;
  musicSettingsMutation: ReturnType<typeof useMutation<VideoProject, Error, { musicEnabled?: boolean; muteOriginalAudio?: boolean }>>;
  cachedTracks: Array<{ id: string; filename: string; sizeKB: number; duration: number }> | undefined;
  isBusy: boolean;
  t: (key: string) => string;
}) {
  const [searchMood, setSearchMood] = useState('dramatic');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<EpidemicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  // ── Music preview state ────────────────────────────────────────────────────
  const [previewTrack, setPreviewTrack] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // Cleanup audio on unmount
  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  // ── Split state ──────────────────────────────────────────────────────────────
  const [splitDuration, setSplitDuration] = useState(10);
  const [splitCustom, setSplitCustom] = useState('');
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitSegments, setSplitSegments] = useState<Array<{ index: number; filename: string; startTime: number; duration: number }> | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);

  const effectiveSplitDuration = splitCustom ? Number(splitCustom) : splitDuration;
  const totalDur = project.metadata.totalDuration ?? 0;
  const estimatedClips = totalDur > 0 ? Math.ceil(totalDur / effectiveSplitDuration) : null;
  const hasOutput = Boolean(project.outputPath);

  async function handleSplit() {
    if (!effectiveSplitDuration || effectiveSplitDuration < 1) return;
    setIsSplitting(true);
    setSplitError(null);
    setSplitSegments(null);
    try {
      const segs = await videosApi.split(project.id, effectiveSplitDuration);
      setSplitSegments(segs);
    } catch (err: unknown) {
      setSplitError(err instanceof Error ? err.message : 'Split failed');
    } finally {
      setIsSplitting(false);
    }
  }

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
      await queryClient.invalidateQueries({ queryKey: ['music', 'cached'] });
      musicTrackMutation.mutate(filename);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="overflow-auto p-4 h-full">
      <div className="space-y-3 text-xs">
        {[
          { label: t('editor.format'),       value: project.format.toUpperCase() },
          { label: t('editor.duration'),     value: `${project.duration}s` },
          { label: t('editor.resolution'),   value: project.resolution },
          { label: t('editor.fps'),          value: String(project.fps) },
          { label: t('editor.scenesCount'),  value: String(project.scenes.length) },
          { label: t('editor.narration'),    value: project.narrationEnabled ? t('editor.enabled') : t('editor.disabled') },
          { label: t('editor.subtitlesLabel'), value: project.subtitlesEnabled ? t('editor.enabled') : t('editor.disabled') },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between">
            <span className="text-c-dim">{label}</span>
            <span className="text-c-text">{value}</span>
          </div>
        ))}

        {/* ── Music section ── */}
        <div className="pt-1 border-t border-c-border space-y-2">
          {/* Mute original audio toggle */}
          <div className="flex items-center justify-between">
            <span className="text-c-dim">{t('editor.muteOriginalAudio')}</span>
            <button
              onClick={() => musicSettingsMutation.mutate({ muteOriginalAudio: !project.muteOriginalAudio })}
              disabled={isBusy}
              className={clsx(
                'w-8 h-4 rounded-full transition-colors relative shrink-0',
                project.muteOriginalAudio ? 'bg-red-500' : 'bg-c-border'
              )}
            >
              <span className={clsx(
                'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                project.muteOriginalAudio ? 'left-4.5' : 'left-0.5'
              )} />
            </button>
          </div>

          {/* Add background music toggle */}
          <div className="flex items-center justify-between">
            <span className="text-c-dim">{t('editor.addBackgroundMusic')}</span>
            <button
              onClick={() => musicSettingsMutation.mutate({ musicEnabled: !project.musicEnabled })}
              disabled={isBusy}
              className={clsx(
                'w-8 h-4 rounded-full transition-colors relative shrink-0',
                project.musicEnabled ? 'bg-accent-primary' : 'bg-c-border'
              )}
            >
              <span className={clsx(
                'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                project.musicEnabled ? 'left-4.5' : 'left-0.5'
              )} />
            </button>
          </div>

          {(project.muteOriginalAudio || project.musicEnabled) && (
            <p className="text-[10px] text-amber-500/80">{t('editor.audioSettingsNote')}</p>
          )}

          {project.musicEnabled && (
            <>
              {/* Pinned track */}
              {project.musicTrackPath && (() => {
                const pinnedFilename = project.musicTrackPath.split(/[\\/]/).pop()!;
                const pinnedTrack = cachedTracks?.find(t => t.filename === pinnedFilename);
                const pinnedDur = pinnedTrack?.duration ?? 0;
                const videoDur = project.metadata.totalDuration ?? project.duration ?? 0;
                return (
                  <div className="px-2 py-1.5 bg-accent-muted border border-accent-primary rounded space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => togglePreview(pinnedFilename)}
                        className="shrink-0 text-accent-hover hover:text-white transition-colors"
                        title={t('editor.previewMusic')}
                      >
                        {previewTrack === pinnedFilename
                          ? <Pause className="w-3.5 h-3.5" />
                          : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <span className="truncate text-accent-hover flex-1 text-left">
                        {pinnedFilename}
                      </span>
                      <button
                        onClick={() => musicTrackMutation.mutate(null)}
                        disabled={isBusy}
                        className="shrink-0 text-c-dim hover:text-red-400 transition-colors"
                        title={t('editor.detachMusic')}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    {pinnedDur > 0 && videoDur > 0 && (
                      <div className="flex items-center gap-1 text-[10px] text-c-dim">
                        <Music className="w-3 h-3 shrink-0" />
                        <span>{pinnedDur}s</span>
                        <span className="text-c-border">→</span>
                        <span>{videoDur}s</span>
                        <span className="ml-auto text-accent-hover/70">
                          {pinnedDur >= videoDur ? t('editor.musicTrimmed') : `${Math.ceil(videoDur / pinnedDur)}× ${t('editor.musicLooped')}`}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Cached tracks */}
              {cachedTracks && cachedTracks.length > 0 && (
                <div>
                  <div className="text-c-dim mb-1">{t('editor.cachedTracks')}</div>
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                    {cachedTracks.map((track) => {
                      const isActive = project.musicTrackPath?.endsWith(track.filename);
                      const isPlaying = previewTrack === track.filename;
                      return (
                        <div
                          key={track.id}
                          className={clsx(
                            'flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors',
                            isActive
                              ? 'bg-accent-muted border-accent-primary text-accent-hover'
                              : 'border-c-border text-c-muted hover:border-c-border-hi'
                          )}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePreview(track.filename); }}
                            className={clsx(
                              'shrink-0 transition-colors',
                              isPlaying ? 'text-accent-hover' : 'text-c-dim hover:text-c-text'
                            )}
                            title={isPlaying ? t('editor.stopPreview') : t('editor.previewMusic')}
                          >
                            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                          </button>
                          <button
                            onClick={() => musicTrackMutation.mutate(isActive ? null : track.filename)}
                            disabled={isBusy}
                            className="flex-1 text-left truncate"
                          >
                            {track.filename}
                          </button>
                          <span className="shrink-0 text-c-dim">
                            {track.duration > 0 ? `${track.duration}s` : `${track.sizeKB}KB`}
                          </span>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (isActive) musicTrackMutation.mutate(null);
                              if (previewTrack === track.filename) { audioRef.current?.pause(); setPreviewTrack(null); }
                              await musicApi.deleteTrack(track.filename);
                              queryClient.invalidateQueries({ queryKey: ['music', 'cached'] });
                            }}
                            className="shrink-0 text-c-dim hover:text-red-400 transition-colors"
                            title={t('common.delete')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Upload local music file */}
              <div>
                <label className="flex items-center gap-2 px-2 py-1.5 border border-dashed border-c-border rounded cursor-pointer hover:border-accent-primary transition-colors">
                  <Volume2 className="w-3.5 h-3.5 text-c-dim shrink-0" />
                  <span className="text-c-muted text-xs">{t('editor.uploadMusic')}</span>
                  <input
                    type="file"
                    accept=".mp3,.wav,.ogg,.m4a,.aac,.flac"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const result = await musicApi.upload(file);
                        await queryClient.invalidateQueries({ queryKey: ['music', 'cached'] });
                        musicTrackMutation.mutate(result.filename);
                      } catch (err) {
                        console.error('Music upload failed:', err);
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              {/* Search Epidemic Sound */}
              <div>
                <div className="text-c-dim mb-1">{t('editor.searchEpidemicSound')}</div>
                <div className="flex gap-1 mb-1">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder={t('editor.searchPlaceholder')}
                    className="flex-1 text-xs bg-c-surface border border-c-border rounded px-1.5 py-1 text-c-text placeholder:text-c-dim min-w-0"
                  />
                  <select
                    value={searchMood}
                    onChange={(e) => setSearchMood(e.target.value)}
                    className="w-20 text-xs bg-c-surface border border-c-border rounded px-1 py-1 text-c-text"
                  >
                    <option value="">{t('editor.anyMood')}</option>
                    {EDITOR_MUSIC_MOODS.map(({ value, labelKey }) => (
                      <option key={value} value={value}>{t(labelKey)}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleSearch}
                    disabled={isSearching || isBusy}
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
                          className="flex items-center gap-1.5 px-2 py-1 border border-c-border rounded text-xs"
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
                              isPlaying ? 'text-accent-hover' : 'text-c-dim hover:text-c-text'
                            )}
                            title={isPlaying ? t('editor.stopPreview') : t('editor.previewMusic')}
                          >
                            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="text-c-text truncate">{track.title}</div>
                            <div className="text-c-dim truncate">{track.artist} · {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}</div>
                          </div>
                          <button
                            onClick={() => handleDownload(track)}
                            disabled={!!downloadingId || isBusy}
                            className="shrink-0 text-xs px-2 py-0.5 bg-accent-primary hover:bg-accent-hover text-white rounded transition-colors"
                          >
                            {downloadingId === track.id ? <Spinner size="sm" /> : <Download className="w-3 h-3" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {project.metadata.filesize ? (
          <div className="flex justify-between">
            <span className="text-c-dim">{t('editor.fileSize')}</span>
            <span className="text-c-text">
              {(project.metadata.filesize / 1_048_576).toFixed(1)} MB
            </span>
          </div>
        ) : null}
      </div>

      {(project.metadata.reusedSceneCount ?? 0) > 0 && (
        <div className="mt-4 p-3 bg-green-900/20 border border-green-800/30 rounded-lg">
          <div className="text-xs text-green-300 font-medium">
            <RefreshCw className="w-3 h-3 inline mr-1" />
            {project.metadata.reusedSceneCount} {t('editor.scenesReused')}
          </div>
          <div className="text-xs text-c-muted mt-0.5">
            {t('editor.savedFromLibrary')}
          </div>
        </div>
      )}

      {/* ── Split Video ─────────────────────────────────────────────────────── */}
      <div className="pt-3 border-t border-c-border space-y-2">
        <div className="flex items-center gap-1.5">
          <Scissors className="w-3 h-3 text-c-muted" />
          <span className="text-xs font-medium text-c-text">{t('editor.splitVideo')}</span>
        </div>

        {!hasOutput ? (
          <p className="text-[11px] text-c-dim italic">{t('editor.splitNoVideo')}</p>
        ) : (
          <>
            {/* Preset chips */}
            <div className="flex flex-wrap gap-1">
              {[5, 10, 15, 30, 60].map((s) => (
                <button
                  key={s}
                  onClick={() => { setSplitDuration(s); setSplitCustom(''); setSplitSegments(null); }}
                  className={clsx(
                    'px-2 py-0.5 rounded-md text-[11px] border transition-colors',
                    splitDuration === s && !splitCustom
                      ? 'bg-accent-primary border-accent-primary text-white'
                      : 'border-c-border text-c-muted hover:border-accent-primary hover:text-c-text'
                  )}
                >
                  {s}s
                </button>
              ))}
              <input
                type="number"
                min={1}
                placeholder="custom"
                value={splitCustom}
                onChange={(e) => { setSplitCustom(e.target.value); setSplitSegments(null); }}
                className="w-16 px-1.5 py-0.5 rounded-md text-[11px] border border-c-border bg-c-bg text-c-text focus:border-accent-primary focus:outline-none"
              />
            </div>

            {/* Preview */}
            {totalDur > 0 && effectiveSplitDuration >= 1 && (
              <p className="text-[11px] text-c-dim">
                {totalDur.toFixed(1)}s ÷ {effectiveSplitDuration}s ≈{' '}
                <span className="text-accent-hover font-medium">{estimatedClips} {t('editor.clips')}</span>
              </p>
            )}

            {/* Split button */}
            <button
              onClick={handleSplit}
              disabled={isSplitting || effectiveSplitDuration < 1 || isBusy}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-hover disabled:opacity-50 text-white text-xs transition-colors"
            >
              {isSplitting ? <Spinner className="w-3 h-3" /> : <Scissors className="w-3 h-3" />}
              {isSplitting ? t('editor.splitting') : t('editor.splitNow')}
            </button>

            {/* Error */}
            {splitError && (
              <p className="text-[11px] text-red-400">{splitError}</p>
            )}

            {/* Results */}
            {splitSegments && splitSegments.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-c-muted">{splitSegments.length} {t('editor.clipsReady')}</p>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {splitSegments.map((seg) => (
                    <div key={seg.index} className="flex items-center justify-between gap-2 py-1 px-2 bg-c-elevated rounded-lg">
                      <div className="min-w-0">
                        <p className="text-[10px] font-mono text-c-text truncate">{seg.filename}</p>
                        <p className="text-[9px] text-c-dim">
                          {seg.startTime.toFixed(1)}s – {(seg.startTime + seg.duration).toFixed(1)}s ({seg.duration.toFixed(1)}s)
                        </p>
                      </div>
                      <a
                        href={videosApi.splitDownloadUrl(project.id, seg.filename)}
                        download={seg.filename}
                        className="shrink-0 flex items-center gap-0.5 px-1.5 py-1 rounded bg-accent-primary/20 hover:bg-accent-primary/40 text-accent-hover text-[10px] transition-colors"
                      >
                        <Download className="w-2.5 h-2.5" />
                        {t('common.download')}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
}

// ─── Scene Timeline Row ───────────────────────────────────────────────────────

const SCENE_MOODS: SceneMood[] = [
  'sad', 'hopeful', 'dramatic', 'energetic', 'calm', 'mysterious',
  'romantic', 'dark', 'uplifting', 'tense', 'melancholic', 'euphoric',
];

const SCENE_STYLES: SceneStyle[] = [
  'anime-cinematic', 'documentary', 'noir', 'dark-fantasy', 'sci-fi',
  'emotional-storytelling', 'cyberpunk', 'natural', 'vintage', 'modern',
];

function SceneTimelineRow({
  scene,
  index,
  videoId,
  startTime,
  onSave,
  onDelete,
  saving,
}: {
  scene: SceneLine;
  index: number;
  videoId: string;
  startTime: number;
  onSave: (changes: Partial<SceneLine>) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const appliedEdits = useEditorAIStore((s) => s.appliedEdits);
  const currentTime = useEditorAIStore((s) => s.currentTime);
  const requestSeek = useEditorAIStore((s) => s.requestSeek);
  const appliedEdit = appliedEdits.find((e) => e.sceneIndex === index);
  const isActive = currentTime >= startTime && currentTime < startTime + scene.duration;

  // ── Edit state ────────────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<SceneLine>(scene);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(scene);
    setIsEditing(true);
  }
  function cancelEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setIsEditing(false);
    setDraft(scene);
  }
  function saveEdit(e: React.MouseEvent) {
    e.stopPropagation();
    onSave({
      line: draft.line,
      visual: draft.visual,
      mood: draft.mood,
      style: draft.style,
      duration: Number(draft.duration) || scene.duration,
    });
    setIsEditing(false);
  }
  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    onDelete();
  }
  // ──────────────────────────────────────────────────────────────────────────

  const { data: reuseMatches } = useQuery({
    queryKey: ['reuse', scene.visual, scene.mood],
    queryFn: () => libraryApi.findReuseMatches(scene, 3),
    staleTime: 60_000,
    enabled: !isEditing,
  });

  const hasReuse = reuseMatches && reuseMatches.length > 0;
  const topMatch = reuseMatches?.[0];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !isEditing && requestSeek(startTime)}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          requestSeek(startTime);
        }
      }}
      className={clsx(
        'group flex items-stretch gap-3 bg-c-surface border rounded-xl p-3 transition-colors',
        !isEditing && 'cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60',
        isActive
          ? 'border-accent-primary bg-accent-muted ring-1 ring-accent-glow'
          : appliedEdit
          ? 'border-accent-glow bg-accent-muted hover:border-accent-glow'
          : 'border-c-border hover:border-c-border-hi'
      )}
    >
      {/* Index + start time + seek hint */}
      <div className="flex flex-col items-center gap-1 pt-1 shrink-0 w-12">
        <span className="text-xs font-mono text-c-dim">{String(index + 1).padStart(2, '0')}</span>
        <span className="text-[10px] font-mono text-c-dim/70">{formatHms(startTime)}</span>
        <PlayIcon className="w-3 h-3 text-c-dim/60 mt-0.5" />
        <div className="w-0.5 flex-1 rounded-full bg-c-border" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0" onClick={(e) => isEditing && e.stopPropagation()}>
        {isEditing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={draft.line}
              onChange={(e) => setDraft({ ...draft, line: e.target.value })}
              placeholder={t('editor.scene.linePlaceholder')}
              className="w-full px-2.5 py-1.5 text-sm bg-c-bg border border-c-border rounded-lg text-c-text placeholder-c-dim focus:border-accent-primary focus:outline-none"
            />
            <input
              type="text"
              value={draft.visual}
              onChange={(e) => setDraft({ ...draft, visual: e.target.value })}
              placeholder={t('editor.scene.visualPlaceholder')}
              className="w-full px-2.5 py-1.5 text-xs bg-c-bg border border-c-border rounded-lg text-c-text placeholder-c-dim focus:border-accent-primary focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-c-dim">{t('editor.scene.mood')}</span>
                <select
                  value={draft.mood}
                  onChange={(e) => setDraft({ ...draft, mood: e.target.value as SceneMood })}
                  className="px-2 py-1 bg-c-bg border border-c-border rounded text-c-text focus:border-accent-primary focus:outline-none"
                >
                  {SCENE_MOODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-c-dim">{t('editor.scene.style')}</span>
                <select
                  value={draft.style ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, style: e.target.value ? (e.target.value as SceneStyle) : undefined })
                  }
                  className="px-2 py-1 bg-c-bg border border-c-border rounded text-c-text focus:border-accent-primary focus:outline-none"
                >
                  <option value="">{t('editor.scene.styleNone')}</option>
                  {SCENE_STYLES.map((s) => (
                    <option key={s} value={s}>{s.replace(/-/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-c-dim">{t('editor.scene.durationLabel')}</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={draft.duration}
                  onChange={(e) =>
                    setDraft({ ...draft, duration: Math.max(0.5, Number(e.target.value) || 0.5) })
                  }
                  className="w-16 px-2 py-1 bg-c-bg border border-c-border rounded text-c-text focus:border-accent-primary focus:outline-none"
                />
                <span className="text-c-dim">s</span>
              </label>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-c-text leading-relaxed mb-2">"{scene.line}"</p>

            <div className="flex items-center gap-2 flex-wrap">
              <Badge mood={scene.mood}>{scene.mood}</Badge>
              {scene.style && (
                <Badge variant="default">{scene.style.replace(/-/g, ' ')}</Badge>
              )}
              <span className="flex items-center gap-1 text-xs text-c-muted">
                <Clock className="w-3 h-3" />
                {scene.duration}s
              </span>
            </div>

            <div className="mt-2 flex items-center gap-2 p-2 bg-c-bg rounded-lg">
              <Wand2 className="w-3 h-3 text-accent-primary shrink-0" />
              <span className="text-xs text-c-muted italic truncate">{scene.visual}</span>
            </div>
          </>
        )}

        {/* Applied effects from AI/preset */}
        {!isEditing && appliedEdit && appliedEdit.effects.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {appliedEdit.effects.map((fx) => (
              <span
                key={fx}
                className="text-xs px-1.5 py-0.5 rounded bg-accent-muted border border-accent-glow text-accent-hover"
              >
                {EFFECT_LABELS[fx] ?? fx}
              </span>
            ))}
            {appliedEdit.transition && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/20 border border-blue-800/30 text-blue-300">
                → {appliedEdit.transition}
              </span>
            )}
            {appliedEdit.subtitleStyle && appliedEdit.subtitleStyle !== 'default' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/20 border border-purple-800/30 text-purple-300">
                CC: {appliedEdit.subtitleStyle}
              </span>
            )}
          </div>
        )}

        {!isEditing && hasReuse && topMatch && (
          <div className="mt-2 flex items-center gap-2 p-2 bg-green-900/10 border border-green-800/20 rounded-lg">
            <RefreshCw className="w-3 h-3 text-green-400 shrink-0" />
            <span className="text-xs text-green-300 truncate">
              {t('library.reuseMatch')}: {Math.round(topMatch.score * 100)}%
            </span>
            <span className="text-xs text-c-dim ml-auto">
              {topMatch.matchReason.slice(0, 1).join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* Right column: actions + duration bar */}
      <div className="flex flex-col items-end gap-2 shrink-0 w-20">
        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <button
                onClick={saveEdit}
                disabled={saving}
                title={t('editor.scene.save')}
                className="p-1.5 rounded bg-accent-primary hover:bg-accent-hover text-white disabled:opacity-50 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={cancelEdit}
                title={t('editor.scene.cancel')}
                className="p-1.5 rounded hover:bg-c-elevated text-c-muted hover:text-c-text transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startEdit}
                title={t('editor.scene.edit')}
                className="p-1.5 rounded hover:bg-c-elevated text-c-dim hover:text-c-text opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                title={confirmDelete ? t('editor.scene.deleteConfirm') : t('editor.scene.delete')}
                className={clsx(
                  'p-1.5 rounded transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                  confirmDelete
                    ? 'bg-red-600 hover:bg-red-500 text-white opacity-100'
                    : 'hover:bg-red-900/30 text-c-dim hover:text-red-400'
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Duration bar */}
        {!isEditing && (
          <div className="w-full flex flex-col items-end gap-1">
            <div className="text-xs text-c-dim">{scene.duration}s</div>
            <div className="w-full bg-c-elevated rounded-full h-1">
              <div
                className="h-full rounded-full bg-accent-primary"
                style={{
                  width: `${Math.min(100, (scene.duration / 8) * 100)}%`,
                  opacity: appliedEdit ? 1 : 0.6,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tools Panel ───────────────────────────────────────────────────────────────

function ToolsPanel({
  project,
  onClearRegions,
  onClearTextOverlays,
  trimMode, setTrimMode,
  trimIn, setTrimIn,
  trimOut, setTrimOut,
  currentTime,
  trimMutation,
  assembleJobId,
  assemblyLogs,
  assemblyLogRef,
  liveJob,
  isBusy,
  t,
}: {
  project: VideoProject;
  onClearRegions: () => void;
  onClearTextOverlays: () => void;
  trimMode: boolean; setTrimMode: (v: boolean) => void;
  trimIn: number | null; setTrimIn: (v: number | null) => void;
  trimOut: number | null; setTrimOut: (v: number | null) => void;
  currentTime: number;
  trimMutation: { mutate: (v: { start: number; end: number }) => void; isPending: boolean };
  assembleJobId: string | null;
  assemblyLogs: Array<{ msg: string; pct: number }>;
  assemblyLogRef: RefObject<HTMLDivElement>;
  liveJob: { progress?: number; progressMessage?: string } | null | undefined;
  isBusy: boolean;
  t: (key: string) => string;
}) {
  const regionCount = project.blurRegions?.length ?? 0;
  const textOverlayCount = project.textOverlays?.length ?? 0;
  const [clipSegDuration, setClipSegDuration] = useState(60);
  const [isSplittingClips, setIsSplittingClips] = useState(false);
  const [clipSegments, setClipSegments] = useState<Array<{ index: number; filename: string; startTime: number; duration: number }> | null>(null);
  const [clipSplitError, setClipSplitError] = useState<string | null>(null);
  return (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* ── Blur Section ── */}
      <div className="px-4 py-3 border-b border-c-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-c-text uppercase tracking-wider flex items-center gap-1.5">
            <EyeOff className="w-3.5 h-3.5 text-amber-400" />
            {t('editor.blurArea')}
          </span>
          {regionCount > 0 && (
            <button onClick={onClearRegions} className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors">
              {t('editor.blurClear')}
            </button>
          )}
        </div>
        {regionCount === 0 ? (
          <p className="text-[11px] text-c-dim">{t('editor.blurTip')}</p>
        ) : (
          <p className="text-[11px] text-amber-400/80">{regionCount} {t('editor.blurArea').toLowerCase()} · {t('editor.blurReassemble')}</p>
        )}
      </div>

      {/* ── Text Overlay Section ── */}
      <div className="px-4 py-3 border-b border-c-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-c-text uppercase tracking-wider flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5 text-pink-400" />
            {t('editor.textOverlay')}
          </span>
          {textOverlayCount > 0 && (
            <button onClick={onClearTextOverlays} className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors">
              {t('editor.textClear')}
            </button>
          )}
        </div>
        {textOverlayCount === 0 ? (
          <p className="text-[11px] text-c-dim">{t('editor.textTip')}</p>
        ) : (
          <p className="text-[11px] text-pink-400/80">{textOverlayCount} {t('editor.textOverlay').toLowerCase()} · {t('editor.textReassemble')}</p>
        )}
      </div>

      {/* ── Trim Section ── */}
      <div className="px-4 py-3 border-b border-c-border">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-c-text uppercase tracking-wider flex items-center gap-1.5">
            <Scissors className="w-3.5 h-3.5 text-sky-400" />
            {t('editor.trim')}
          </span>
          {project.outputPath && (
            <button
              onClick={() => { setTrimMode(!trimMode); setTrimIn(null); setTrimOut(null); }}
              className={clsx(
                'text-[11px] px-2.5 py-1 rounded border transition-colors font-medium',
                trimMode
                  ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                  : 'border-c-border text-c-muted hover:border-sky-400 hover:text-sky-300'
              )}
            >
              {trimMode ? t('common.cancel') : t('editor.trim')}
            </button>
          )}
        </div>

        {!project.outputPath ? (
          <p className="text-[11px] text-c-dim">{t('editor.previewPlaceholder')}</p>
        ) : trimMode ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-c-dim">{t('editor.trimCurrent')}</span>
              <span className="text-sky-400 font-mono">{formatHms(currentTime)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTrimIn(currentTime)}
                className={clsx(
                  'flex flex-col items-center py-2 rounded border text-[11px] transition-colors',
                  trimIn !== null ? 'border-sky-400 bg-sky-500/20 text-sky-300' : 'border-c-border text-c-muted hover:border-sky-400 hover:text-sky-300'
                )}
              >
                <span className="font-medium">[ {t('editor.trimIn')}</span>
                {trimIn !== null && <span className="font-mono text-sky-200 mt-0.5">{formatHms(trimIn)}</span>}
              </button>
              <button
                onClick={() => setTrimOut(currentTime)}
                className={clsx(
                  'flex flex-col items-center py-2 rounded border text-[11px] transition-colors',
                  trimOut !== null ? 'border-sky-400 bg-sky-500/20 text-sky-300' : 'border-c-border text-c-muted hover:border-sky-400 hover:text-sky-300'
                )}
              >
                <span className="font-medium">{t('editor.trimOut')} ]</span>
                {trimOut !== null && <span className="font-mono text-sky-200 mt-0.5">{formatHms(trimOut)}</span>}
              </button>
            </div>
            {trimIn !== null && trimOut !== null && (
              <p className="text-[11px] text-c-dim text-center">
                {formatHms(Math.abs(trimOut - trimIn))} {t('editor.trimDuration')}
              </p>
            )}
            <button
              onClick={() => {
                if (trimIn === null || trimOut === null) return;
                trimMutation.mutate({ start: Math.min(trimIn, trimOut), end: Math.max(trimIn, trimOut) });
              }}
              disabled={trimIn === null || trimOut === null || trimIn === trimOut || isBusy}
              className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-white transition-colors font-medium"
            >
              {trimMutation.isPending ? <Spinner size="sm" /> : <Scissors className="w-3 h-3" />}
              {t('editor.trimApply')}
            </button>
            <p className="text-[11px] text-c-dim italic">{t('editor.trimHint')}</p>
          </div>
        ) : (
          <p className="text-[11px] text-c-dim">{t('editor.trimHint')}</p>
        )}
      </div>

      {/* ── Split into Clips Section ── */}
      <div className="px-4 py-3 border-b border-c-border">
        <span className="text-xs font-semibold text-c-text uppercase tracking-wider flex items-center gap-1.5 mb-3">
          <Scissors className="w-3.5 h-3.5 text-orange-400" />
          {t('editor.splitIntoClips')}
        </span>
        {!project.outputPath ? (
          <p className="text-[11px] text-c-dim italic">{t('editor.splitNoVideo')}</p>
        ) : (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-c-muted block mb-1">{t('editor.segmentDuration')}</label>
              <input
                type="number"
                min={15}
                max={300}
                value={clipSegDuration}
                onChange={(e) => { setClipSegDuration(Number(e.target.value)); setClipSegments(null); }}
                className="w-full px-2 py-1 rounded-lg text-xs border border-c-border bg-c-bg text-c-text focus:border-accent-primary focus:outline-none"
              />
            </div>
            <button
              onClick={async () => {
                setIsSplittingClips(true);
                setClipSplitError(null);
                setClipSegments(null);
                try {
                  const segs = await videosApi.split(project.id, clipSegDuration);
                  setClipSegments(segs);
                } catch (err: unknown) {
                  setClipSplitError(err instanceof Error ? err.message : 'Split failed');
                } finally {
                  setIsSplittingClips(false);
                }
              }}
              disabled={isSplittingClips || clipSegDuration < 15 || clipSegDuration > 300 || isBusy}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 disabled:opacity-50 text-orange-300 border border-orange-500/30 text-xs transition-colors"
            >
              {isSplittingClips ? <Spinner className="w-3 h-3" /> : <Scissors className="w-3 h-3" />}
              {isSplittingClips ? t('editor.splitting') : t('editor.split')}
            </button>
            {clipSplitError && <p className="text-[11px] text-red-400">{clipSplitError}</p>}
            {clipSegments && clipSegments.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] text-c-muted">{clipSegments.length} {t('editor.splitDone')}</p>
                <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                  {clipSegments.map((seg) => (
                    <div key={seg.index} className="flex items-center justify-between gap-2 py-1 px-2 bg-c-elevated rounded-lg">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-c-text">
                          Clip {seg.index + 1} ({formatHms(seg.startTime)} – {formatHms(seg.startTime + seg.duration)})
                        </p>
                      </div>
                      <a
                        href={videosApi.splitDownloadUrl(project.id, seg.filename)}
                        download={seg.filename}
                        className="shrink-0 flex items-center gap-0.5 px-1.5 py-1 rounded bg-orange-500/15 hover:bg-orange-500/30 text-orange-300 text-[10px] transition-colors"
                      >
                        <Download className="w-2.5 h-2.5" />
                        {t('editor.downloadClip').replace('{{n}}', String(seg.index + 1))}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Download Section ── */}
      {project.outputPath && project.status === 'completed' && (
        <div className="px-4 py-3 border-b border-c-border">
          <span className="text-xs font-semibold text-c-text uppercase tracking-wider flex items-center gap-1.5 mb-3">
            <Download className="w-3.5 h-3.5 text-accent-hover" />
            {t('common.download')}
          </span>
          <a
            href={`/api/export/${project.id}/download?v=${encodeURIComponent(project.updatedAt)}`}
            className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded bg-accent-primary hover:bg-accent-hover text-white transition-colors font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            {t('common.download')}
          </a>
        </div>
      )}

      {/* ── Assembly Log ── */}
      {project.status === 'assembling' && (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Spinner size="sm" />
              <span className="text-xs font-medium text-c-secondary">{t('editor.assembling')}</span>
            </div>
            <span className="text-xs text-c-dim tabular-nums">{liveJob?.progress ?? 0}%</span>
          </div>
          <div className="w-full bg-c-border rounded-full h-1 mb-2">
            <div className="h-1 bg-accent-primary rounded-full transition-all duration-500" style={{ width: `${liveJob?.progress ?? 0}%` }} />
          </div>
          <div ref={assemblyLogRef} className="font-mono text-[11px] leading-5 bg-black/40 rounded p-2 max-h-48 overflow-y-auto">
            {assemblyLogs.map((entry, i) => (
              <div key={i} className="text-c-dim">
                <span className="text-c-muted/50 mr-2 select-none">[{String(entry.pct).padStart(3, ' ')}%]</span>
                {entry.msg}
              </div>
            ))}
            {liveJob?.progressMessage && (
              <div className="text-accent-hover">
                <span className="text-accent-hover/50 mr-2 select-none">[{String(liveJob.progress ?? 0).padStart(3, ' ')}%]</span>
                ▶ {liveJob.progressMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sortable wrapper for vertical list ────────────────────────────────────────

function SortableVerticalRow({
  id,
  children,
  onCut,
}: {
  id: string;
  children: React.ReactNode;
  onCut: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1, zIndex: isDragging ? 50 : undefined }}
      className="flex items-stretch gap-1"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="flex items-center justify-center w-5 shrink-0 text-c-dim/30 hover:text-c-dim cursor-grab active:cursor-grabbing touch-none"
        title="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
      {/* Cut button */}
      <button
        onClick={onCut}
        title="Cut / split scene at playhead"
        className="flex items-center justify-center w-6 shrink-0 text-c-dim/30 hover:text-orange-400 transition-colors"
      >
        <Scissors className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Sortable card for horizontal filmstrip ────────────────────────────────────

const PX_PER_SEC = 30;
const MIN_CARD_W = 88;

function SortableHorizontalCard({
  id,
  scene,
  index,
  startTime,
  isActive,
  appliedEdit,
  onCut,
  onSave,
  onDelete,
  saving: _saving,
}: {
  id: string;
  scene: SceneLine;
  index: number;
  startTime: number;
  isActive: boolean;
  appliedEdit: { effects: string[]; transition?: string } | undefined;
  onCut: () => void;
  onSave: (changes: Partial<SceneLine>) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const requestSeek = useEditorAIStore((s) => s.requestSeek);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const pendingRef = useRef(scene.duration);
  const displayDuration = previewDuration ?? scene.duration;
  const cardWidth = Math.max(MIN_CARD_W, displayDuration * PX_PER_SEC);

  function handleRightResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startDur = scene.duration;
    pendingRef.current = startDur;

    function onMove(me: PointerEvent) {
      const next = Math.max(0.5, Math.round((startDur + (me.clientX - startX) / PX_PER_SEC) * 2) / 2);
      pendingRef.current = next;
      setPreviewDuration(next);
    }
    function onUp() {
      onSave({ duration: pendingRef.current });
      setPreviewDuration(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        width: cardWidth,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        zIndex: isDragging ? 50 : undefined,
        position: 'relative',
      }}
      className={clsx(
        'group shrink-0 flex flex-col gap-1 border rounded-xl p-2 select-none transition-colors min-h-24',
        isActive
          ? 'border-accent-primary bg-accent-muted ring-1 ring-accent-glow'
          : appliedEdit
          ? 'border-accent-glow bg-accent-muted hover:border-accent-glow'
          : 'border-c-border bg-c-surface hover:border-c-border-hi'
      )}
      onClick={() => requestSeek(startTime)}
    >
      {/* Top row: drag handle · index · time */}
      <div className="flex items-center gap-1">
        <button
          {...attributes}
          {...listeners}
          className="text-c-dim/30 hover:text-c-dim cursor-grab active:cursor-grabbing touch-none shrink-0"
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        >
          <GripVertical className="w-3 h-3" />
        </button>
        <span className="text-[10px] font-mono text-c-dim">{String(index + 1).padStart(2, '0')}</span>
        <span className="text-[9px] font-mono text-c-dim/60 ml-auto">{formatHms(startTime)}</span>
      </div>

      {/* Line preview */}
      <p className="text-[11px] text-c-text line-clamp-2 leading-tight flex-1 cursor-pointer">
        "{scene.line}"
      </p>

      {/* Bottom: mood · duration · scissors · delete */}
      <div className="flex items-center gap-1 flex-wrap">
        <Badge mood={scene.mood} className="text-[9px] !px-1 !py-px">{scene.mood}</Badge>
        <span className="text-[9px] text-c-dim ml-auto">{displayDuration}s</span>
        <button
          onClick={(e) => { e.stopPropagation(); onCut(); }}
          title="Cut / split at playhead"
          className="opacity-0 group-hover:opacity-100 text-c-dim/50 hover:text-orange-400 transition-all"
        >
          <Scissors className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete scene"
          className="opacity-0 group-hover:opacity-100 text-c-dim/50 hover:text-red-400 transition-all"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Applied effects pills */}
      {appliedEdit && appliedEdit.effects.length > 0 && (
        <div className="flex flex-wrap gap-0.5">
          {appliedEdit.effects.slice(0, 2).map((fx) => (
            <span key={fx} className="text-[9px] px-1 py-px rounded bg-accent-muted border border-accent-glow text-accent-hover">
              {(EFFECT_LABELS as Record<string, string>)[fx] ?? fx}
            </span>
          ))}
        </div>
      )}

      {/* Right trim handle */}
      <div
        className="absolute right-0 top-0 w-3 h-full cursor-ew-resize rounded-r-xl bg-accent-primary/0 hover:bg-accent-primary/25 active:bg-accent-primary/40 transition-colors"
        onPointerDown={handleRightResize}
        onClick={(e) => e.stopPropagation()}
        title="Drag to trim duration"
      />
    </div>
  );
}
