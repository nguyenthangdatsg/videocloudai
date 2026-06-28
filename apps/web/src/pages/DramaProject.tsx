import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import {
  ArrowLeft,
  Sparkles,
  FileText,
  Users,
  MapPin,
  Loader2,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Camera,
  Play,
  Download,
  Star,
  AlertTriangle,
  CheckCircle2,
  Info,
  Eye,
  Wand2,
  Save,
  X,
  Film,
  Music,
  Type,
  Clapperboard,
  Settings,
} from 'lucide-react';
import { dramaApi } from '../lib/api';
import type {
  DramaProject,
  DramaEpisode,
  DramaCharacter,
  DramaLocation,
  DramaBeat,
  DramaScene,
  DramaShot,
  CameraAngle,
  CameraMovement,
  ShotTransition,
  DramaGenre,
  DramaTone,
  DramaArtStyle,
  DramaAspectRatio,
} from '@videocloudai/shared';

const GENRES: DramaGenre[] = ['romance', 'fantasy', 'mystery', 'thriller', 'revenge', 'billionaire', 'workplace', 'family', 'horror', 'comedy', 'sci-fi', 'historical', 'supernatural', 'crime', 'coming-of-age'];
const TONES: DramaTone[] = ['dark', 'suspenseful', 'romantic', 'comedic', 'dramatic', 'whimsical', 'gritty', 'hopeful', 'melancholic', 'intense'];
const ART_STYLES: DramaArtStyle[] = ['cinematic', 'anime', 'illustrated', '3d-rendered', 'watercolor', 'noir', 'comic', 'custom'];
const ASPECT_RATIOS: DramaAspectRatio[] = ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'];
const DURATIONS = [30, 60, 90, 120, 180, 300];
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'th', label: 'ไทย' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'ar', label: 'العربية' },
  { value: 'ru', label: 'Русский' },
];

const GENRE_KEYS: Record<DramaGenre, string> = {
  romance: 'genreRomance', fantasy: 'genreFantasy', mystery: 'genreMystery', thriller: 'genreThriller',
  revenge: 'genreRevenge', billionaire: 'genreBillionaire', workplace: 'genreWorkplace', family: 'genreFamily',
  horror: 'genreHorror', comedy: 'genreComedy', 'sci-fi': 'genreSciFi', historical: 'genreHistorical',
  supernatural: 'genreSupernatural', crime: 'genreCrime', 'coming-of-age': 'genreComingOfAge',
};
const TONE_KEYS: Record<DramaTone, string> = {
  dark: 'toneDark', suspenseful: 'toneSuspenseful', romantic: 'toneRomantic', comedic: 'toneComedic',
  dramatic: 'toneDramatic', whimsical: 'toneWhimsical', gritty: 'toneGritty', hopeful: 'toneHopeful',
  melancholic: 'toneMelancholic', intense: 'toneIntense',
};
const STYLE_KEYS: Record<DramaArtStyle, string> = {
  cinematic: 'styleCinematic', anime: 'styleAnime', illustrated: 'styleIllustrated', '3d-rendered': 'style3d',
  watercolor: 'styleWatercolor', noir: 'styleNoir', comic: 'styleComic', custom: 'styleCustom',
};

const STAGES = ['setup', 'story', 'script', 'characters', 'locations', 'storyboard', 'video', 'audio', 'subtitles', 'assembly', 'export'] as const;

const BEAT_COLORS: Record<string, string> = {
  hook: 'border-red-500/30 bg-red-500/5',
  setup: 'border-blue-500/30 bg-blue-500/5',
  'inciting-incident': 'border-orange-500/30 bg-orange-500/5',
  'rising-action': 'border-yellow-500/30 bg-yellow-500/5',
  midpoint: 'border-violet-500/30 bg-violet-500/5',
  escalation: 'border-pink-500/30 bg-pink-500/5',
  climax: 'border-red-600/30 bg-red-600/5',
  resolution: 'border-emerald-500/30 bg-emerald-500/5',
  cliffhanger: 'border-cyan-500/30 bg-cyan-500/5',
};

const BEAT_KEYS: Record<string, string> = {
  hook: 'beatHook', setup: 'beatSetup', 'inciting-incident': 'beatIncitingIncident',
  'rising-action': 'beatRisingAction', midpoint: 'beatMidpoint', escalation: 'beatEscalation',
  climax: 'beatClimax', resolution: 'beatResolution', cliffhanger: 'beatCliffhanger',
};

const CAMERA_ANGLES: CameraAngle[] = ['wide', 'medium', 'close-up', 'extreme-close-up', 'over-the-shoulder', 'low-angle', 'high-angle', 'dutch-angle', 'pov', 'two-shot', 'establishing'];
const CAMERA_MOVEMENTS: CameraMovement[] = ['static', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'zoom-in', 'zoom-out', 'dolly-in', 'dolly-out', 'tracking'];
const TRANSITIONS: ShotTransition[] = ['cut', 'fade', 'dissolve', 'wipe', 'flash'];

const ANGLE_KEYS: Record<string, string> = {
  'wide': 'wide', 'medium': 'medium', 'close-up': 'closeUp', 'extreme-close-up': 'extremeCloseUp',
  'over-the-shoulder': 'overTheShoulder', 'low-angle': 'lowAngle', 'high-angle': 'highAngle',
  'dutch-angle': 'dutchAngle', 'pov': 'povShot', 'two-shot': 'twoShot', 'establishing': 'establishing',
};
const MOVEMENT_KEYS: Record<string, string> = {
  'static': 'static', 'pan-left': 'panLeft', 'pan-right': 'panRight', 'tilt-up': 'tiltUp',
  'tilt-down': 'tiltDown', 'zoom-in': 'zoomIn', 'zoom-out': 'zoomOut', 'dolly-in': 'dollyIn',
  'dolly-out': 'dollyOut', 'tracking': 'tracking',
};
const TRANSITION_KEYS: Record<string, string> = {
  'cut': 'cut', 'fade': 'fade', 'dissolve': 'dissolve', 'wipe': 'wipe', 'flash': 'flash',
};

type TabKey = 'outline' | 'script' | 'characters' | 'locations' | 'storyboard' | 'video' | 'export';

export function DramaProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeEpisode, setActiveEpisode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('outline');
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const onMutationError = (err: unknown) => {
    const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
    const msg = axiosErr?.response?.data?.error || axiosErr?.message || t('common.error');
    setError(msg);
    setTimeout(() => setError(null), 8000);
  };

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['drama', 'project', id],
    queryFn: () => dramaApi.getProject(id!),
    enabled: !!id,
  });

  const { data: episodes } = useQuery({
    queryKey: ['drama', 'episodes', id],
    queryFn: () => dramaApi.listEpisodes(id!),
    enabled: !!id,
  });

  const { data: characters } = useQuery({
    queryKey: ['drama', 'characters', id],
    queryFn: () => dramaApi.listCharacters(id!),
    enabled: !!id,
  });

  const { data: locations } = useQuery({
    queryKey: ['drama', 'locations', id],
    queryFn: () => dramaApi.listLocations(id!),
    enabled: !!id,
  });

  const selectedEpisodeId = activeEpisode ?? episodes?.[0]?.id;
  const selectedEpisode = episodes?.find(e => e.id === selectedEpisodeId);

  const { data: scenes } = useQuery({
    queryKey: ['drama', 'scenes', selectedEpisodeId],
    queryFn: () => dramaApi.listScenes(selectedEpisodeId!),
    enabled: !!selectedEpisodeId && (activeTab === 'storyboard' || activeTab === 'video'),
  });

  const outlineMutation = useMutation({
    mutationFn: () => dramaApi.generateOutline(id!, selectedEpisodeId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama'] }),
    onError: onMutationError,
  });

  const scriptMutation = useMutation({
    mutationFn: () => dramaApi.generateScript(id!, selectedEpisodeId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama'] }),
    onError: onMutationError,
  });

  const charactersMutation = useMutation({
    mutationFn: () => dramaApi.extractCharacters(id!, selectedEpisodeId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama'] }),
    onError: onMutationError,
  });

  const locationsMutation = useMutation({
    mutationFn: () => dramaApi.extractLocations(id!, selectedEpisodeId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama'] }),
    onError: onMutationError,
  });

  const storyboardMutation = useMutation({
    mutationFn: () => dramaApi.generateStoryboard(id!, selectedEpisodeId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama'] }),
    onError: onMutationError,
  });

  const addCharacterMutation = useMutation({
    mutationFn: (data: { name: string; role?: string }) => dramaApi.createCharacter(id!, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama', 'characters'] }),
  });

  const deleteCharacterMutation = useMutation({
    mutationFn: (charId: string) => dramaApi.deleteCharacter(charId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama', 'characters'] }),
  });

  const updateCharacterMutation = useMutation({
    mutationFn: ({ charId, data }: { charId: string; data: Partial<DramaCharacter> }) => dramaApi.updateCharacter(charId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama', 'characters'] }),
  });

  const addLocationMutation = useMutation({
    mutationFn: (data: { name: string; type?: string }) => dramaApi.createLocation(id!, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama', 'locations'] }),
  });

  const deleteLocationMutation = useMutation({
    mutationFn: (locId: string) => dramaApi.deleteLocation(locId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama', 'locations'] }),
  });

  const updateLocationMutation = useMutation({
    mutationFn: ({ locId, data }: { locId: string; data: Partial<DramaLocation> }) => dramaApi.updateLocation(locId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama', 'locations'] }),
  });

  const updateProjectMutation = useMutation({
    mutationFn: (data: Partial<DramaProject>) => dramaApi.updateProject(id!, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['drama', 'project', id] }); setShowSettings(false); },
    onError: onMutationError,
  });

  const reviewMutation = useMutation({
    mutationFn: () => dramaApi.reviewEpisode(id!, selectedEpisodeId!),
    onError: onMutationError,
  });

  if (projectLoading) {
    return <div className="flex-1 flex items-center justify-center bg-c-bg text-c-muted">{t('common.loading')}</div>;
  }

  if (!project) {
    return <div className="flex-1 flex items-center justify-center bg-c-bg text-c-muted">{t('common.error')}</div>;
  }

  const TABS: Array<{ key: TabKey; label: string; icon: typeof Sparkles }> = [
    { key: 'outline', label: t('drama.story'), icon: Sparkles },
    { key: 'script', label: t('drama.scriptStage'), icon: FileText },
    { key: 'characters', label: t('drama.characters'), icon: Users },
    { key: 'locations', label: t('drama.locations'), icon: MapPin },
    { key: 'storyboard', label: t('drama.storyboardTab'), icon: Camera },
    { key: 'video', label: t('drama.videoTab'), icon: Film },
    { key: 'export', label: t('drama.exportTab'), icon: Download },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-c-bg">
      {/* Header */}
      <div className="glass px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/drama')} className="p-1.5 rounded-lg hover:bg-c-elevated text-c-muted hover:text-c-text transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-c-text truncate">{project.title}</h1>
            <div className="flex items-center gap-2 text-xs text-c-muted mt-0.5">
              <span className="px-1.5 py-0.5 rounded-full bg-accent-muted text-accent-primary text-xs font-medium">{t(`drama.${project.genre === 'sci-fi' ? 'genreSciFi' : 'genre' + project.genre.charAt(0).toUpperCase() + project.genre.slice(1)}` as string)}</span>
              <span>{project.aspectRatio}</span>
              <span>{project.durationTarget}s</span>
              <span>{LANGUAGES.find(l => l.value === project.language)?.label || project.language}</span>
              <span>{project.episodeCount} {t('drama.episodes').toLowerCase()}</span>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg hover:bg-c-elevated text-c-muted hover:text-c-text transition-colors"
            title={t('common.settings')}
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={() => reviewMutation.mutate()}
            disabled={reviewMutation.isPending || !selectedEpisode?.script}
            className="btn-ghost flex items-center gap-1.5 text-xs rounded-full disabled:opacity-40"
          >
            {reviewMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
            {t('drama.reviewEpisode')}
          </button>
        </div>

        {/* Stage progress */}
        <div className="flex items-center gap-1 mt-3 overflow-x-auto">
          {STAGES.map((stage, i) => {
            const stageIdx = STAGES.indexOf(project.currentStage as typeof stage);
            const isDone = i < stageIdx;
            const isCurrent = i === stageIdx;
            return (
              <div key={stage} className="flex items-center">
                <div className={clsx(
                  'px-2.5 py-1 text-xs rounded-full whitespace-nowrap transition-colors',
                  isDone && 'bg-emerald-500/10 text-emerald-400',
                  isCurrent && 'bg-accent-muted text-accent-primary font-medium',
                  !isDone && !isCurrent && 'text-c-dim'
                )}>
                  {t(`drama.${stage === 'script' ? 'scriptStage' : stage}` as string)}
                </div>
                {i < STAGES.length - 1 && <ChevronRight className="w-3 h-3 text-c-dim mx-0.5 shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-3 flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-sm text-red-400 flex-1">{error}</span>
          <button onClick={() => setError(null)} className="p-1 rounded-lg text-red-400/60 hover:text-red-400">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Review results banner */}
      {reviewMutation.data && (
        <div className="bg-c-surface border-b border-c-border px-6 py-3">
          <div className="flex items-center gap-3 mb-2">
            <div className={clsx(
              'text-lg font-bold tabular-nums',
              reviewMutation.data.score >= 80 ? 'text-emerald-400' :
              reviewMutation.data.score >= 60 ? 'text-yellow-400' : 'text-red-400'
            )}>
              {reviewMutation.data.score}/100
            </div>
            <span className="text-sm text-c-muted">{reviewMutation.data.feedback}</span>
          </div>
          {reviewMutation.data.issues.length > 0 && (
            <div className="space-y-1">
              {reviewMutation.data.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {issue.severity === 'critical' ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" /> :
                   issue.severity === 'warning' ? <Info className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" /> :
                   <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />}
                  <span className="text-c-muted"><span className="text-c-text font-medium">{issue.area}:</span> {issue.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Episode selector */}
        <div className="w-48 border-r border-c-border bg-c-bg py-3 px-2 space-y-1 overflow-y-auto shrink-0">
          <div className="text-xs font-medium text-c-dim uppercase tracking-wider px-2 mb-2">
            {t('drama.episodes')}
          </div>
          {episodes?.map(ep => (
            <button
              key={ep.id}
              onClick={() => setActiveEpisode(ep.id)}
              className={clsx(
                'w-full text-left px-2.5 py-2 rounded-xl text-sm transition-colors',
                selectedEpisodeId === ep.id
                  ? 'bg-accent-muted text-accent-primary font-medium'
                  : 'text-c-muted hover:bg-c-elevated hover:text-c-text'
              )}
            >
              {t('drama.episode', { n: ep.episodeNumber })}
              {ep.title && ep.title !== `Episode ${ep.episodeNumber}` && (
                <span className="block text-xs text-c-dim truncate mt-0.5">{ep.title}</span>
              )}
              {ep.reviewScore != null && (
                <span className={clsx(
                  'text-xs tabular-nums',
                  ep.reviewScore >= 80 ? 'text-emerald-400' :
                  ep.reviewScore >= 60 ? 'text-yellow-400' : 'text-red-400'
                )}>{ep.reviewScore}/100</span>
              )}
            </button>
          ))}
        </div>

        {/* Right: Episode content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-c-border overflow-x-auto">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={clsx(
                  'flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-full transition-colors whitespace-nowrap',
                  activeTab === key
                    ? 'bg-accent-muted text-accent-primary font-medium'
                    : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {key === 'characters' && characters?.length ? (
                  <span className="ml-1 text-xs text-c-dim">{characters.length}</span>
                ) : null}
                {key === 'locations' && locations?.length ? (
                  <span className="ml-1 text-xs text-c-dim">{locations.length}</span>
                ) : null}
                {key === 'storyboard' && scenes?.length ? (
                  <span className="ml-1 text-xs text-c-dim">{scenes.length}</span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'outline' && selectedEpisode && (
              <OutlineTab episode={selectedEpisode} onGenerate={() => outlineMutation.mutate()} isGenerating={outlineMutation.isPending} />
            )}
            {activeTab === 'script' && selectedEpisode && (
              <ScriptTab episode={selectedEpisode} onGenerate={() => scriptMutation.mutate()} isGenerating={scriptMutation.isPending} />
            )}
            {activeTab === 'characters' && (
              <CharactersTab
                characters={characters ?? []} onExtract={() => charactersMutation.mutate()} isExtracting={charactersMutation.isPending}
                onAdd={(name) => addCharacterMutation.mutate({ name })} onDelete={(charId) => deleteCharacterMutation.mutate(charId)}
                onUpdate={(charId, data) => updateCharacterMutation.mutate({ charId, data })} hasScript={!!selectedEpisode?.script}
              />
            )}
            {activeTab === 'locations' && (
              <LocationsTab
                locations={locations ?? []} onExtract={() => locationsMutation.mutate()} isExtracting={locationsMutation.isPending}
                onAdd={(name) => addLocationMutation.mutate({ name })} onDelete={(locId) => deleteLocationMutation.mutate(locId)}
                onUpdate={(locId, data) => updateLocationMutation.mutate({ locId, data })} hasScript={!!selectedEpisode?.script}
              />
            )}
            {activeTab === 'storyboard' && selectedEpisode && (
              <StoryboardTab projectId={id!} episodeId={selectedEpisodeId!} scenes={scenes ?? []} characters={characters ?? []}
                onGenerateStoryboard={() => storyboardMutation.mutate()} isGenerating={storyboardMutation.isPending} hasScript={!!selectedEpisode.script}
              />
            )}
            {activeTab === 'video' && selectedEpisode && (
              <VideoAudioTab projectId={id!} episodeId={selectedEpisodeId!} scenes={scenes ?? []} episode={selectedEpisode} />
            )}
            {activeTab === 'export' && selectedEpisode && (
              <ExportTab project={project} episode={selectedEpisode} scenes={scenes ?? []} />
            )}
          </div>
        </div>
      </div>

      {showSettings && (
        <ProjectSettingsModal
          project={project}
          onClose={() => setShowSettings(false)}
          onSave={(data) => updateProjectMutation.mutate(data)}
          isSaving={updateProjectMutation.isPending}
        />
      )}
    </div>
  );
}

// ── Project Settings Modal ──

function ProjectSettingsModal({ project, onClose, onSave, isSaving }: {
  project: DramaProject; onClose: () => void;
  onSave: (data: Partial<DramaProject>) => void; isSaving: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    title: project.title,
    description: project.description || '',
    genre: project.genre,
    tone: project.tone,
    artStyle: project.artStyle,
    aspectRatio: project.aspectRatio,
    language: project.language || 'en',
    durationTarget: project.durationTarget,
  });

  const update = (key: string, value: unknown) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-c-surface border border-c-border rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-c-surface border-b border-c-border px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <h2 className="text-base font-bold text-c-text">{t('drama.projectSettings')}</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-c-dim hover:text-c-text hover:bg-c-elevated transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-c-text mb-1.5">{t('drama.projectTitle')}</label>
            <input value={form.title} onChange={e => update('title', e.target.value)} className="input rounded-xl" />
          </div>
          <div>
            <label className="block text-sm font-medium text-c-text mb-1.5">{t('drama.description')}</label>
            <textarea value={form.description} onChange={e => update('description', e.target.value)} rows={2} className="input rounded-xl resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-c-text mb-1.5">{t('drama.genre')}</label>
              <select value={form.genre} onChange={e => update('genre', e.target.value)} className="input rounded-xl">
                {GENRES.map(g => <option key={g} value={g}>{t(`drama.${GENRE_KEYS[g]}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-c-text mb-1.5">{t('drama.tone')}</label>
              <select value={form.tone} onChange={e => update('tone', e.target.value)} className="input rounded-xl">
                {TONES.map(tn => <option key={tn} value={tn}>{t(`drama.${TONE_KEYS[tn]}`)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-c-text mb-1.5">{t('drama.artStyle')}</label>
              <select value={form.artStyle} onChange={e => update('artStyle', e.target.value)} className="input rounded-xl">
                {ART_STYLES.map(s => <option key={s} value={s}>{t(`drama.${STYLE_KEYS[s]}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-c-text mb-1.5">{t('drama.aspectRatio')}</label>
              <select value={form.aspectRatio} onChange={e => update('aspectRatio', e.target.value)} className="input rounded-xl">
                {ASPECT_RATIOS.map(ar => <option key={ar} value={ar}>{ar}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-c-text mb-1.5">{t('drama.language')}</label>
              <select value={form.language} onChange={e => update('language', e.target.value)} className="input rounded-xl">
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-c-text mb-1.5">{t('drama.durationTarget')}</label>
              <select value={form.durationTarget} onChange={e => update('durationTarget', Number(e.target.value))} className="input rounded-xl">
                {DURATIONS.map(d => <option key={d} value={d}>{t('drama.durationSeconds', { count: d })}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-c-surface border-t border-c-border px-6 py-4 rounded-b-2xl flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost rounded-full">{t('common.cancel')}</button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.title.trim() || isSaving}
            className="btn-primary rounded-full disabled:opacity-40"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('drama.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Outline Tab ──

function OutlineTab({ episode, onGenerate, isGenerating }: { episode: DramaEpisode; onGenerate: () => void; isGenerating: boolean }) {
  const { t } = useTranslation();
  const beats = episode.beats ?? [];

  return (
    <div className="space-y-4 max-w-3xl">
      {episode.synopsis && (
        <div className="card rounded-2xl p-4">
          <h3 className="text-sm font-medium text-c-text mb-1.5">{t('drama.synopsis')}</h3>
          <p className="text-sm text-c-muted leading-relaxed">{episode.synopsis}</p>
        </div>
      )}

      <button onClick={onGenerate} disabled={isGenerating} className="btn-primary flex items-center gap-2 rounded-full">
        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {isGenerating ? t('drama.generatingOutline') : t('drama.generateOutline')}
      </button>

      {beats.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-c-text">{t('drama.beats')} ({beats.length})</h3>
          {beats.map((beat: DramaBeat, i: number) => (
            <div key={beat.id || i} className={clsx('border rounded-xl p-3', BEAT_COLORS[beat.type] || 'border-c-border bg-c-surface')}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-c-text uppercase tracking-wider">
                  {t(`drama.${BEAT_KEYS[beat.type] || 'beatSetup'}`)}
                </span>
                <div className="flex items-center gap-2 text-xs text-c-muted">
                  {beat.emotionTag && <span className="px-1.5 py-0.5 rounded-full bg-c-elevated">{beat.emotionTag}</span>}
                  <span>{beat.durationEstimate}s</span>
                </div>
              </div>
              <p className="text-sm text-c-muted">{beat.description}</p>
            </div>
          ))}
          <div className="text-xs text-c-dim text-right">
            {t('drama.durationTarget')}: ~{beats.reduce((s, b) => s + (b.durationEstimate || 0), 0)}s
          </div>
        </div>
      ) : (
        <p className="text-sm text-c-dim">{t('drama.noBeats')}</p>
      )}
    </div>
  );
}

// ── Script Tab ──

function ScriptTab({ episode, onGenerate, isGenerating }: { episode: DramaEpisode; onGenerate: () => void; isGenerating: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={onGenerate} disabled={isGenerating || !episode.beats?.length} className="btn-primary flex items-center gap-2 rounded-full">
        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        {isGenerating ? t('drama.generatingScript') : t('drama.generateScript')}
      </button>

      {episode.script ? (
        <div className="card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-c-text">{t('drama.script')}</h3>
            <span className="text-xs text-c-dim">v{episode.scriptVersion}</span>
          </div>
          <pre className="text-sm text-c-muted whitespace-pre-wrap font-mono leading-relaxed max-h-[60vh] overflow-y-auto">
            {episode.script}
          </pre>
        </div>
      ) : (
        <p className="text-sm text-c-dim">{t('drama.noScript')}</p>
      )}
    </div>
  );
}

// ── Characters Tab ──

function CharactersTab({ characters, onExtract, isExtracting, onAdd, onDelete, onUpdate, hasScript }: {
  characters: DramaCharacter[]; onExtract: () => void; isExtracting: boolean;
  onAdd: (name: string) => void; onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<DramaCharacter>) => void; hasScript: boolean;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const ROLE_COLORS: Record<string, string> = {
    protagonist: 'bg-accent-muted text-accent-primary',
    antagonist: 'bg-red-500/10 text-red-400',
    supporting: 'bg-blue-500/10 text-blue-400',
    extra: 'bg-c-elevated text-c-muted',
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={onExtract} disabled={isExtracting || !hasScript} className="btn-primary flex items-center gap-2 rounded-full">
        {isExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
        {isExtracting ? t('drama.extractingCharacters') : t('drama.extractCharacters')}
      </button>

      <div className="flex items-center gap-2">
        <input
          type="text" value={newName} onChange={e => setNewName(e.target.value)}
          placeholder={t('drama.characterName')} className="input rounded-xl w-64"
          onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { onAdd(newName.trim()); setNewName(''); } }}
        />
        <button onClick={() => { if (newName.trim()) { onAdd(newName.trim()); setNewName(''); } }}
          className="p-1.5 rounded-lg hover:bg-c-elevated text-c-muted hover:text-c-text transition-colors">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {characters.length > 0 ? (
        <div className="space-y-2">
          {characters.map(char => (
            <div key={char.id} className="card rounded-2xl p-4 group">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold text-c-text">{char.name}</h4>
                  <span className={clsx('px-1.5 py-0.5 text-xs rounded-full', ROLE_COLORS[char.role] || ROLE_COLORS.extra)}>
                    {t(`drama.${char.role}`)}
                  </span>
                  {char.age && <span className="text-xs text-c-dim">{char.age}</span>}
                  {char.gender && <span className="text-xs text-c-dim">{char.gender}</span>}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={() => setEditingId(editingId === char.id ? null : char.id)} className="p-1 rounded-lg text-c-dim hover:text-accent-primary">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onDelete(char.id)} className="p-1 rounded-lg text-c-dim hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {char.physicalDescription && <p className="text-xs text-c-muted mb-1"><span className="text-c-dim">{t('drama.physicalDescription')}:</span> {char.physicalDescription}</p>}
              {char.personality && <p className="text-xs text-c-muted mb-1"><span className="text-c-dim">{t('drama.personality')}:</span> {char.personality}</p>}
              {char.wardrobeDefault && <p className="text-xs text-c-muted"><span className="text-c-dim">{t('drama.wardrobe')}:</span> {char.wardrobeDefault}</p>}
              {editingId === char.id && (
                <CharacterEditPanel character={char} onSave={(data) => { onUpdate(char.id, data); setEditingId(null); }} onClose={() => setEditingId(null)} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-c-dim">{t('drama.noCharacters')}</p>
      )}
    </div>
  );
}

function CharacterEditPanel({ character, onSave, onClose }: { character: DramaCharacter; onSave: (data: Partial<DramaCharacter>) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    physicalDescription: character.physicalDescription || '', personality: character.personality || '',
    wardrobeDefault: character.wardrobeDefault || '', backstory: character.backstory || '',
    age: character.age || '', gender: character.gender || '',
  });

  return (
    <div className="mt-3 pt-3 border-t border-c-border space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('drama.age')}</label>
          <input value={form.age} onChange={e => setForm(f => ({ ...f, age: e.target.value }))} className="input text-xs rounded-lg py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('drama.gender')}</label>
          <input value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))} className="input text-xs rounded-lg py-1.5" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-c-muted mb-1">{t('drama.physicalDescription')}</label>
        <textarea value={form.physicalDescription} onChange={e => setForm(f => ({ ...f, physicalDescription: e.target.value }))} rows={2} className="input text-xs rounded-lg py-1.5 resize-none" />
      </div>
      <div>
        <label className="block text-xs text-c-muted mb-1">{t('drama.personality')}</label>
        <textarea value={form.personality} onChange={e => setForm(f => ({ ...f, personality: e.target.value }))} rows={2} className="input text-xs rounded-lg py-1.5 resize-none" />
      </div>
      <div>
        <label className="block text-xs text-c-muted mb-1">{t('drama.wardrobe')}</label>
        <input value={form.wardrobeDefault} onChange={e => setForm(f => ({ ...f, wardrobeDefault: e.target.value }))} className="input text-xs rounded-lg py-1.5" />
      </div>
      <div>
        <label className="block text-xs text-c-muted mb-1">{t('drama.backstory')}</label>
        <textarea value={form.backstory} onChange={e => setForm(f => ({ ...f, backstory: e.target.value }))} rows={2} className="input text-xs rounded-lg py-1.5 resize-none" />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost text-xs rounded-full"><X className="w-3.5 h-3.5" /></button>
        <button onClick={() => onSave(form)} className="btn-primary flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5">
          <Save className="w-3 h-3" />{t('drama.saveChanges')}
        </button>
      </div>
    </div>
  );
}

// ── Locations Tab ──

function LocationsTab({ locations, onExtract, isExtracting, onAdd, onDelete, onUpdate, hasScript }: {
  locations: DramaLocation[]; onExtract: () => void; isExtracting: boolean;
  onAdd: (name: string) => void; onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<DramaLocation>) => void; hasScript: boolean;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={onExtract} disabled={isExtracting || !hasScript} className="btn-primary flex items-center gap-2 rounded-full">
        {isExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
        {isExtracting ? t('drama.extractingLocations') : t('drama.extractLocations')}
      </button>

      <div className="flex items-center gap-2">
        <input
          type="text" value={newName} onChange={e => setNewName(e.target.value)}
          placeholder={t('drama.locationName')} className="input rounded-xl w-64"
          onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { onAdd(newName.trim()); setNewName(''); } }}
        />
        <button onClick={() => { if (newName.trim()) { onAdd(newName.trim()); setNewName(''); } }}
          className="p-1.5 rounded-lg hover:bg-c-elevated text-c-muted hover:text-c-text transition-colors">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {locations.length > 0 ? (
        <div className="space-y-2">
          {locations.map(loc => (
            <div key={loc.id} className="card rounded-2xl p-4 group">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-c-text">{loc.name}</h4>
                  <span className="px-1.5 py-0.5 text-xs rounded-full bg-c-elevated text-c-muted">{t(`drama.${loc.type}`)}</span>
                  {loc.timeOfDay && <span className="text-xs text-c-dim">{loc.timeOfDay}</span>}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={() => setEditingId(editingId === loc.id ? null : loc.id)} className="p-1 rounded-lg text-c-dim hover:text-accent-primary">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => onDelete(loc.id)} className="p-1 rounded-lg text-c-dim hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {loc.description && <p className="text-xs text-c-muted mb-1">{loc.description}</p>}
              <div className="flex flex-wrap gap-2 text-xs text-c-dim">
                {loc.lighting && <span>{t('drama.lighting')}: {loc.lighting}</span>}
                {loc.mood && <span>{t('drama.mood')}: {loc.mood}</span>}
                {loc.props?.length > 0 && <span>Props: {loc.props.join(', ')}</span>}
              </div>
              {editingId === loc.id && (
                <LocationEditPanel location={loc} onSave={(data) => { onUpdate(loc.id, data); setEditingId(null); }} onClose={() => setEditingId(null)} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-c-dim">{t('drama.noLocations')}</p>
      )}
    </div>
  );
}

function LocationEditPanel({ location, onSave, onClose }: { location: DramaLocation; onSave: (data: Partial<DramaLocation>) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    description: location.description || '', lighting: location.lighting || '',
    timeOfDay: location.timeOfDay || '', weather: location.weather || '', mood: location.mood || '',
  });

  return (
    <div className="mt-3 pt-3 border-t border-c-border space-y-3">
      <div>
        <label className="block text-xs text-c-muted mb-1">{t('drama.sceneDescription')}</label>
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="input text-xs rounded-lg py-1.5 resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('drama.lighting')}</label>
          <input value={form.lighting} onChange={e => setForm(f => ({ ...f, lighting: e.target.value }))} className="input text-xs rounded-lg py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('drama.timeOfDay')}</label>
          <input value={form.timeOfDay} onChange={e => setForm(f => ({ ...f, timeOfDay: e.target.value }))} className="input text-xs rounded-lg py-1.5" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('drama.weather')}</label>
          <input value={form.weather} onChange={e => setForm(f => ({ ...f, weather: e.target.value }))} className="input text-xs rounded-lg py-1.5" />
        </div>
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('drama.sceneMood')}</label>
          <input value={form.mood} onChange={e => setForm(f => ({ ...f, mood: e.target.value }))} className="input text-xs rounded-lg py-1.5" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost text-xs rounded-full"><X className="w-3.5 h-3.5" /></button>
        <button onClick={() => onSave(form)} className="btn-primary flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5">
          <Save className="w-3 h-3" />{t('drama.saveChanges')}
        </button>
      </div>
    </div>
  );
}

// ── Storyboard Tab ──

function StoryboardTab({ projectId, episodeId, scenes, characters, onGenerateStoryboard, isGenerating, hasScript }: {
  projectId: string; episodeId: string; scenes: DramaScene[]; characters: DramaCharacter[];
  onGenerateStoryboard: () => void; isGenerating: boolean; hasScript: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());

  const promptMutation = useMutation({
    mutationFn: (shotId: string) => dramaApi.generateShotPrompt(projectId, shotId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama', 'scenes'] }),
  });

  const toggleScene = (sceneId: string) => {
    setExpandedScenes(prev => {
      const next = new Set(prev);
      if (next.has(sceneId)) next.delete(sceneId); else next.add(sceneId);
      return next;
    });
  };

  const totalShots = scenes.reduce((sum, s) => sum + s.shots.length, 0);
  const totalDuration = scenes.reduce((sum, s) => sum + s.shots.reduce((ss, sh) => ss + sh.duration, 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onGenerateStoryboard} disabled={isGenerating || !hasScript} className="btn-primary flex items-center gap-2 rounded-full">
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          {isGenerating ? t('drama.generatingStoryboard') : t('drama.generateStoryboard')}
        </button>
        {scenes.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-c-muted">
            <span>{t('drama.sceneCount')}: {scenes.length}</span>
            <span>{t('drama.shotCount')}: {totalShots}</span>
            <span>{t('drama.totalDuration')}: {totalDuration.toFixed(1)}s</span>
          </div>
        )}
      </div>

      {scenes.length > 0 ? (
        <div className="space-y-3">
          {scenes.map(scene => (
            <div key={scene.id} className="card rounded-2xl overflow-hidden">
              <button onClick={() => toggleScene(scene.id)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-c-surface hover:bg-c-elevated transition-colors text-left">
                <ChevronDown className={clsx('w-4 h-4 text-c-muted transition-transform', !expandedScenes.has(scene.id) && '-rotate-90')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-c-text">{t('drama.scene', { n: scene.sceneNumber })}</span>
                    <span className="text-xs text-c-muted truncate">{scene.heading}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-c-dim mt-0.5">
                    {scene.mood && <span>{t('drama.sceneMood')}: {scene.mood}</span>}
                    <span>{scene.shots.length} {t('drama.shots').toLowerCase()}</span>
                    <span>~{scene.durationEstimate}s</span>
                  </div>
                </div>
              </button>
              {expandedScenes.has(scene.id) && (
                <div className="border-t border-c-border">
                  {scene.shots.length > 0 ? (
                    <div className="divide-y divide-c-border">
                      {scene.shots.map(shot => (
                        <ShotCard key={shot.id} shot={shot} characters={characters}
                          onGeneratePrompt={() => promptMutation.mutate(shot.id)}
                          isGeneratingPrompt={promptMutation.isPending && promptMutation.variables === shot.id}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-c-dim px-4 py-3">{t('drama.noShots')}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-c-dim">{t('drama.noScenes')}</p>
      )}
    </div>
  );
}

function ShotCard({ shot, characters, onGeneratePrompt, isGeneratingPrompt }: {
  shot: DramaShot; characters: DramaCharacter[]; onGeneratePrompt: () => void; isGeneratingPrompt: boolean;
}) {
  const { t } = useTranslation();
  const [showPrompt, setShowPrompt] = useState(false);
  const shotChars = characters.filter(c => shot.characterIds.includes(c.id));

  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-c-elevated text-c-muted',
    generating: 'bg-blue-500/10 text-blue-400',
    completed: 'bg-emerald-500/10 text-emerald-400',
    failed: 'bg-red-500/10 text-red-400',
  };
  const STATUS_KEYS: Record<string, string> = {
    pending: 'statusPending', generating: 'statusGenerating', completed: 'statusCompleted', failed: 'statusFailed',
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-24 h-16 bg-c-elevated border border-c-border rounded-xl flex items-center justify-center shrink-0">
          {shot.keyframeUrl ? (
            <img src={shot.keyframeUrl} alt="" className="w-full h-full object-cover rounded-xl" />
          ) : (
            <Clapperboard className="w-5 h-5 text-c-dim" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-c-text">{t('drama.shot', { n: shot.shotNumber })}</span>
            <span className={clsx('px-1.5 py-0.5 text-xs rounded-full', STATUS_COLORS[shot.generationStatus])}>
              {t(`drama.${STATUS_KEYS[shot.generationStatus]}`)}
            </span>
            <span className="text-xs text-c-dim">{shot.duration}s</span>
            {shot.consistencyScore != null && (
              <span className={clsx('text-xs', shot.consistencyScore >= 0.8 ? 'text-emerald-400' : shot.consistencyScore >= 0.6 ? 'text-yellow-400' : 'text-red-400')}>
                {t('drama.consistencyScore')}: {(shot.consistencyScore * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <p className="text-xs text-c-muted mb-1.5">{shot.description}</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="px-1.5 py-0.5 rounded-full bg-c-elevated text-c-dim">{t(`drama.${ANGLE_KEYS[shot.cameraAngle] || 'medium'}`)}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-c-elevated text-c-dim">{t(`drama.${MOVEMENT_KEYS[shot.cameraMovement] || 'static'}`)}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-c-elevated text-c-dim">{t(`drama.${TRANSITION_KEYS[shot.transitionOut] || 'cut'}`)}</span>
            {shotChars.map(c => (
              <span key={c.id} className="px-1.5 py-0.5 rounded-full bg-accent-muted text-accent-primary">{c.name}</span>
            ))}
          </div>
          {shot.dialogueLine && <p className="text-xs text-cyan-400 mt-1.5 italic">"{shot.dialogueLine}"</p>}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={onGeneratePrompt} disabled={isGeneratingPrompt}
              className="btn-ghost flex items-center gap-1 text-xs rounded-full px-3 py-1 disabled:opacity-40">
              {isGeneratingPrompt ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              {t('drama.generatePrompt')}
            </button>
            {shot.prompt && (
              <button onClick={() => setShowPrompt(!showPrompt)}
                className="btn-ghost flex items-center gap-1 text-xs rounded-full px-3 py-1">
                <Eye className="w-3 h-3" />{t('drama.prompt')}
              </button>
            )}
          </div>
          {showPrompt && shot.prompt && (
            <div className="mt-2 space-y-1.5">
              <div className="bg-c-elevated border border-c-border rounded-xl p-2">
                <div className="text-xs text-c-dim mb-0.5">{t('drama.prompt')}:</div>
                <p className="text-xs text-c-muted">{shot.prompt}</p>
              </div>
              {shot.negativePrompt && (
                <div className="bg-c-elevated border border-c-border rounded-xl p-2">
                  <div className="text-xs text-c-dim mb-0.5">{t('drama.negativePrompt')}:</div>
                  <p className="text-xs text-red-400/70">{shot.negativePrompt}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Video & Audio Tab ──

function VideoAudioTab({ projectId, episodeId, scenes, episode }: { projectId: string; episodeId: string; scenes: DramaScene[]; episode: DramaEpisode }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const allShots = scenes.flatMap(s => s.shots);
  const totalShots = allShots.length;
  const shotsWithPrompt = allShots.filter(sh => sh.prompt).length;
  const shotsWithImage = allShots.filter(sh => sh.keyframeUrl).length;
  const completedShots = allShots.filter(sh => sh.generationStatus === 'completed').length;
  const totalDuration = allShots.reduce((sum, sh) => sum + sh.duration, 0);

  // Flow extension state
  const [flowAvailable, setFlowAvailable] = useState(false);
  const [flowProvider, setFlowProvider] = useState<'google-flow' | 'grok' | 'chatgpt'>('google-flow');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<string[]>([]);
  const [shotStatuses, setShotStatuses] = useState<Map<string, 'pending' | 'generating' | 'done' | 'error'>>(new Map());
  const shotCardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Check if extension is available (ping/pong like Storyboard)
  useEffect(() => {
    const onPong = () => setFlowAvailable(true);
    window.addEventListener('h2dev_flow_pong', onPong);
    window.dispatchEvent(new CustomEvent('h2dev_flow_ping'));
    const timer = setTimeout(() => window.dispatchEvent(new CustomEvent('h2dev_flow_ping')), 1500);
    return () => {
      window.removeEventListener('h2dev_flow_pong', onPong);
      clearTimeout(timer);
    };
  }, []);

  // Generate all prompts
  const generateAllPromptsMutation = useMutation({
    mutationFn: () => dramaApi.generateAllPrompts(projectId, episodeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama', 'scenes'] }),
  });

  // Build prompts list from shots that have prompts but no images
  const getShotsForGeneration = useCallback((onlyFailed = false) => {
    const result: Array<{ shotId: string; index: number; prompt: string }> = [];
    allShots.forEach((shot, i) => {
      if (!shot.prompt) return;
      if (onlyFailed) {
        const status = shotStatuses.get(shot.id);
        if (shot.keyframeUrl && status !== 'error') return;
        if (status === 'done') return;
      } else {
        if (shot.keyframeUrl) return; // skip shots that already have images
      }
      result.push({ shotId: shot.id, index: i, prompt: shot.prompt });
    });
    return result;
  }, [allShots, shotStatuses]);

  const handleStartGeneration = (onlyFailed = false) => {
    const shotsToGen = getShotsForGeneration(onlyFailed);
    if (!shotsToGen.length) return;

    setGenerating(true);
    setGenProgress([onlyFailed ? `Resuming ${shotsToGen.length} shots...` : `Starting generation of ${shotsToGen.length} shots...`]);

    // Init statuses
    setShotStatuses(prev => {
      const next = new Map(prev);
      shotsToGen.forEach(s => next.set(s.shotId, 'pending'));
      return next;
    });

    // Build index map: extension index → allShots index
    const indexMap = shotsToGen.map(s => s.index);

    // Scroll to first pending
    requestAnimationFrame(() => {
      shotCardRefs.current[indexMap[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const prompts = shotsToGen.map(s => ({ timestamp: s.shotId, prompt: s.prompt }));

    const onProgress = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.detail) setGenProgress(prev => [...prev, d.detail]);
      if (d.status === 'generating' && typeof d.index === 'number') {
        const realIdx = indexMap[d.index];
        const shot = shotsToGen[d.index];
        if (shot) setShotStatuses(prev => new Map(prev).set(shot.shotId, 'generating'));
        if (realIdx != null) {
          shotCardRefs.current[realIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    };

    const onImage = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d.index !== 'number') return;
      const shot = shotsToGen[d.index];
      if (!shot) return;
      if (d.status === 'done') {
        setShotStatuses(prev => new Map(prev).set(shot.shotId, 'done'));
        // Save keyframeUrl to backend
        dramaApi.updateShot(shot.shotId, { keyframeUrl: d.url, generationStatus: 'completed' } as Partial<DramaShot>).catch(() => {});
      } else if (d.status === 'error') {
        setShotStatuses(prev => new Map(prev).set(shot.shotId, 'error'));
        dramaApi.updateShot(shot.shotId, { generationStatus: 'failed' } as Partial<DramaShot>).catch(() => {});
      }
    };

    const cleanup = () => {
      window.removeEventListener('h2dev_flow_progress', onProgress);
      window.removeEventListener('h2dev_flow_image', onImage);
      window.removeEventListener('h2dev_flow_done', onDone);
      window.removeEventListener('h2dev_flow_error', onError);
      cleanupRef.current = null;
    };

    const finalize = () => {
      cleanup();
      setGenerating(false);
      queryClient.invalidateQueries({ queryKey: ['drama', 'scenes'] });
    };

    const onDone = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setGenProgress(prev => [...prev, `Done: ${d.done}/${d.total} images generated`]);
      // Mark remaining pending/generating as error
      setShotStatuses(prev => {
        const next = new Map(prev);
        shotsToGen.forEach(s => { if (next.get(s.shotId) === 'pending' || next.get(s.shotId) === 'generating') next.set(s.shotId, 'error'); });
        return next;
      });
      finalize();
    };

    const onError = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setGenProgress(prev => [...prev, `Error: ${d.error}`]);
      setShotStatuses(prev => {
        const next = new Map(prev);
        shotsToGen.forEach(s => { if (next.get(s.shotId) === 'pending' || next.get(s.shotId) === 'generating') next.set(s.shotId, 'error'); });
        return next;
      });
      finalize();
    };

    window.addEventListener('h2dev_flow_progress', onProgress);
    window.addEventListener('h2dev_flow_image', onImage);
    window.addEventListener('h2dev_flow_done', onDone);
    window.addEventListener('h2dev_flow_error', onError);
    cleanupRef.current = cleanup;

    window.dispatchEvent(new CustomEvent('h2dev_flow_start', {
      detail: { prompts, delayMin: 5, delayMax: 15, mediaType: 'image', provider: flowProvider },
    }));
  };

  const handleStop = () => {
    window.dispatchEvent(new CustomEvent('h2dev_flow_stop'));
    setShotStatuses(prev => {
      const next = new Map(prev);
      for (const [id, status] of next) {
        if (status === 'pending' || status === 'generating') next.set(id, 'error');
      }
      return next;
    });
    setGenerating(false);
    cleanupRef.current?.();
    queryClient.invalidateQueries({ queryKey: ['drama', 'scenes'] });
  };

  const failedCount = Array.from(shotStatuses.values()).filter(s => s === 'error').length +
    allShots.filter(sh => sh.prompt && !sh.keyframeUrl && !shotStatuses.has(sh.id)).length;

  const pendingGenCount = getShotsForGeneration(false).length;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: t('drama.sceneCount'), value: scenes.length, icon: Film },
          { label: t('drama.shotCount'), value: `${completedShots}/${totalShots}`, icon: Camera },
          { label: t('drama.shotsWithPrompts', { count: shotsWithPrompt }), value: `${shotsWithPrompt}/${totalShots}`, icon: Wand2 },
          { label: t('drama.shotsWithImages', { count: shotsWithImage }), value: `${shotsWithImage}/${totalShots}`, icon: CheckCircle2 },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="card rounded-2xl p-3">
            <div className="flex items-center gap-2 text-c-muted mb-1">
              <Icon className="w-3.5 h-3.5" />
              <span className="text-xs">{label}</span>
            </div>
            <div className="text-lg font-semibold text-c-text tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Generate all prompts */}
        {shotsWithPrompt < totalShots && totalShots > 0 && (
          <button
            onClick={() => generateAllPromptsMutation.mutate()}
            disabled={generateAllPromptsMutation.isPending}
            className="btn-primary flex items-center gap-2 rounded-full text-xs"
          >
            {generateAllPromptsMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {generateAllPromptsMutation.isPending ? t('drama.generatingAllPrompts') : `${t('drama.generateAllPrompts')} (${totalShots - shotsWithPrompt})`}
          </button>
        )}

        {/* Generate images via extension */}
        {flowAvailable && shotsWithPrompt > 0 && (
          <div className="flex items-center gap-2">
            {(['google-flow', 'grok', 'chatgpt'] as const).map(fp => (
              <button
                key={fp}
                onClick={() => setFlowProvider(fp)}
                disabled={generating}
                className={clsx(
                  'px-2 py-1 rounded text-xs font-medium transition-colors',
                  flowProvider === fp ? 'bg-violet-600 text-white' : 'bg-c-elevated text-c-muted hover:text-c-text',
                )}
              >
                {fp === 'google-flow' ? 'Flow' : fp === 'grok' ? 'Grok' : 'ChatGPT'}
              </button>
            ))}
            <button
              onClick={generating ? handleStop : () => handleStartGeneration(false)}
              disabled={!generating && pendingGenCount === 0}
              className={clsx(
                'flex items-center gap-1.5 text-xs py-1.5 px-4 rounded-full font-medium',
                generating ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-cyan-600 hover:bg-cyan-700 text-white disabled:opacity-50',
              )}
            >
              {generating
                ? <><Play className="w-3 h-3" /> {t('drama.stopGeneration')}</>
                : <><Camera className="w-3.5 h-3.5" /> {t('drama.generateShotImages')} ({pendingGenCount})</>}
            </button>
            {!generating && failedCount > 0 && (
              <button
                onClick={() => handleStartGeneration(true)}
                className="flex items-center gap-1.5 text-xs py-1.5 px-4 rounded-full font-medium bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Play className="w-3 h-3" /> {t('drama.resumeFailed', { count: failedCount })}
              </button>
            )}
          </div>
        )}

        {!flowAvailable && shotsWithPrompt > 0 && (
          <div className="text-xs text-c-dim flex items-center gap-2">
            <Info className="w-3.5 h-3.5" />
            {t('drama.installExtensionHint')}
          </div>
        )}
      </div>

      {/* Generation progress log */}
      {genProgress.length > 0 && (
        <div className="border border-c-border rounded-xl p-3 bg-c-surface max-h-32 overflow-y-auto text-xs text-c-muted space-y-0.5">
          {genProgress.map((msg, i) => <div key={i}>{msg}</div>)}
        </div>
      )}

      {/* Shot grid */}
      {scenes.length > 0 ? (
        <div className="space-y-4">
          {scenes.map(scene => (
            <div key={scene.id}>
              <h3 className="text-xs font-medium text-c-muted mb-2">{scene.heading}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {scene.shots.map(shot => {
                  const globalIdx = allShots.indexOf(shot);
                  const liveStatus = shotStatuses.get(shot.id);
                  const displayStatus = liveStatus || (shot.keyframeUrl ? 'done' : shot.prompt ? 'pending' : undefined);
                  return (
                    <div
                      key={shot.id}
                      ref={el => { shotCardRefs.current[globalIdx] = el; }}
                      className={clsx(
                        'rounded-xl border overflow-hidden',
                        displayStatus === 'done' ? 'border-emerald-500/30' :
                        displayStatus === 'generating' ? 'border-cyan-500/30 animate-pulse' :
                        displayStatus === 'error' ? 'border-red-500/30' :
                        'border-c-border',
                      )}
                    >
                      {/* Image area */}
                      <div className="aspect-video bg-c-elevated flex items-center justify-center relative">
                        {(shot.keyframeUrl || (liveStatus === 'done')) ? (
                          <img src={shot.keyframeUrl} alt="" className="w-full h-full object-cover" />
                        ) : displayStatus === 'generating' ? (
                          <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                        ) : (
                          <Clapperboard className="w-5 h-5 text-c-dim" />
                        )}
                        {displayStatus === 'error' && (
                          <div className="absolute inset-0 bg-red-900/20 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-red-400" />
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-medium text-c-text">{t('drama.shot', { n: shot.shotNumber })}</span>
                          <span className="text-c-dim">{shot.duration}s</span>
                          {shot.prompt && <span title="Has prompt"><Wand2 className="w-2.5 h-2.5 text-violet-400" /></span>}
                        </div>
                        <p className="text-[10px] text-c-dim truncate mt-0.5">{shot.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-c-dim">{t('drama.noScenes')}</p>
      )}

      {/* Audio section */}
      <div>
        <h3 className="text-sm font-medium text-c-text mb-3 flex items-center gap-2"><Music className="w-4 h-4" />{t('drama.audio')}</h3>
        <div className="card rounded-2xl p-6 text-center">
          <Music className="w-8 h-8 text-c-dim mx-auto mb-2" />
          <p className="text-sm text-c-muted">{t('drama.audioComingSoon')}</p>
        </div>
      </div>

      {/* Subtitles section */}
      <div>
        <h3 className="text-sm font-medium text-c-text mb-3 flex items-center gap-2"><Type className="w-4 h-4" />{t('drama.subtitles')}</h3>
        <div className="card rounded-2xl p-6 text-center">
          <Type className="w-8 h-8 text-c-dim mx-auto mb-2" />
          <p className="text-sm text-c-muted">{t('drama.subtitlesComingSoon')}</p>
        </div>
      </div>
    </div>
  );
}

// ── Export Tab ──

function ExportTab({ project, episode, scenes }: { project: DramaProject; episode: DramaEpisode; scenes: DramaScene[] }) {
  const { t } = useTranslation();
  const [selectedPreset, setSelectedPreset] = useState('tiktok');

  const PRESETS = [
    { id: 'tiktok', label: t('drama.tiktok'), ratio: '9:16', res: '1080x1920', maxDur: '180s' },
    { id: 'youtube-shorts', label: t('drama.youtubeShorts'), ratio: '9:16', res: '1080x1920', maxDur: '60s' },
    { id: 'instagram-reels', label: t('drama.instagramReels'), ratio: '9:16', res: '1080x1920', maxDur: '90s' },
    { id: 'youtube', label: t('drama.youtube'), ratio: '16:9', res: '1920x1080', maxDur: 'unlimited' },
    { id: 'custom', label: t('drama.customExport'), ratio: project.aspectRatio, res: 'custom', maxDur: 'unlimited' },
  ];

  const totalShots = scenes.reduce((sum, s) => sum + s.shots.length, 0);
  const completedShots = scenes.reduce((sum, s) => sum + s.shots.filter(sh => sh.generationStatus === 'completed').length, 0);
  const totalDuration = scenes.reduce((sum, s) => sum + s.shots.reduce((ss, sh) => ss + sh.duration, 0), 0);
  const readyToExport = completedShots > 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="card rounded-2xl p-4">
        <h3 className="text-sm font-medium text-c-text mb-3">{t('drama.exportVideo')}</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><span className="text-c-dim">{t('drama.sceneCount')}:</span><span className="ml-2 text-c-text font-medium">{scenes.length}</span></div>
          <div><span className="text-c-dim">{t('drama.shotCount')}:</span><span className="ml-2 text-c-text font-medium">{completedShots}/{totalShots}</span></div>
          <div><span className="text-c-dim">{t('drama.totalDuration')}:</span><span className="ml-2 text-c-text font-medium">{totalDuration.toFixed(1)}s</span></div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-c-text mb-3">{t('drama.exportPresets')}</h3>
        <div className="grid grid-cols-5 gap-2">
          {PRESETS.map(preset => (
            <button key={preset.id} onClick={() => setSelectedPreset(preset.id)}
              className={clsx('p-3 rounded-2xl border text-center transition-colors',
                selectedPreset === preset.id
                  ? 'border-accent-primary bg-accent-muted text-accent-primary'
                  : 'border-c-border text-c-muted hover:bg-c-elevated'
              )}>
              <div className="text-sm font-medium">{preset.label}</div>
              <div className="text-xs text-c-dim mt-1">{preset.ratio}</div>
              <div className="text-xs text-c-dim">{preset.res}</div>
            </button>
          ))}
        </div>
      </div>

      <button disabled={!readyToExport} className="btn-primary flex items-center gap-2 rounded-full disabled:opacity-50">
        <Download className="w-4 h-4" />{t('drama.exportVideo')}
      </button>

      {!readyToExport && <p className="text-xs text-c-dim">{t('drama.noScenes')}</p>}
    </div>
  );
}
