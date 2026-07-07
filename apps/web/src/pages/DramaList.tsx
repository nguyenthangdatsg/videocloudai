import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import {
  Plus,
  Film,
  Trash2,
  ArrowRight,
  Clapperboard,
  Users,
  Clock,
  Sparkles,
  FileImage,
} from 'lucide-react';
import { dramaApi } from '../lib/api';
import type { DramaProject, CreateDramaProjectInput, DramaGenre, DramaTone, DramaArtStyle, DramaAspectRatio, EpisodeFormat } from '@videocloudai/shared';

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

export function DramaList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const isImageMode = location.pathname.startsWith('/image-drama');

  const { data: projects, isLoading } = useQuery({
    queryKey: ['drama', 'projects', isImageMode ? 'image' : 'video'],
    queryFn: () => dramaApi.listProjects(isImageMode ? 'image' : 'video'),
  });

  const { data: stats } = useQuery({
    queryKey: ['drama', 'stats', isImageMode ? 'image' : 'video'],
    queryFn: () => dramaApi.stats(isImageMode ? 'image' : 'video'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dramaApi.deleteProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drama'] }),
  });

  return (
    <div className="flex-1 overflow-y-auto bg-c-bg">
      {/* Header */}
      <div className="sticky top-0 z-10 glass px-8 py-5">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-xl font-bold text-c-text flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-accent-muted flex items-center justify-center">
                {isImageMode ? (
                  <FileImage className="w-4.5 h-4.5 text-accent-primary" />
                ) : (
                  <Film className="w-4.5 h-4.5 text-accent-primary" />
                )}
              </div>
              {isImageMode ? t('nav.imageDramaStudio') : t('drama.title')}
            </h1>
            <p className="text-sm text-c-muted mt-1">
              {isImageMode ? "Create vertical short drama stories using still image generation and Ken Burns effects." : t('drama.subtitle')}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary flex items-center gap-2 rounded-full"
          >
            <Plus className="w-4 h-4" />
            {t('drama.newProject')}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8 space-y-8">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: t('drama.totalProjects'), value: stats.totalProjects, icon: Film },
              { label: t('drama.inProgress'), value: stats.inProgress, icon: Clock },
              { label: t('drama.completed'), value: stats.completed, icon: Clapperboard },
              { label: t('drama.totalEpisodes'), value: stats.totalEpisodes, icon: Sparkles },
              { label: t('drama.totalCharacters'), value: stats.totalCharacters, icon: Users },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="card p-4 rounded-2xl">
                <div className="flex items-center gap-2 text-c-muted mb-2">
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-medium">{label}</span>
                </div>
                <div className="text-2xl font-bold text-c-text tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Project Grid */}
        {isLoading ? (
          <div className="text-center text-c-muted py-16">{t('common.loading')}</div>
        ) : !projects?.length ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl card flex items-center justify-center mx-auto mb-4">
              <Film className="w-8 h-8 text-c-dim" />
            </div>
            <p className="text-c-text text-base">{t('drama.noProjects')}</p>
            <p className="text-sm text-c-muted mt-2">{t('drama.noProjectsHint')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => navigate(`${isImageMode ? '/image-drama' : '/drama'}/${project.id}`)}
                onDelete={() => {
                  if (confirm(t('drama.deleteConfirm'))) {
                    deleteMutation.mutate(project.id);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreate={(project) => navigate(`${isImageMode ? '/image-drama' : '/drama'}/${project.id}`)}
          mode={isImageMode ? 'image' : 'video'}
        />
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen, onDelete }: { project: DramaProject; onOpen: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const stageIdx = STAGES.indexOf(project.currentStage as (typeof STAGES)[number]);
  const progress = ((stageIdx + 1) / STAGES.length) * 100;

  return (
    <div
      className="group card rounded-2xl p-5 hover:border-c-border-hi hover:bg-c-elevated transition-all duration-200 cursor-pointer"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-c-text truncate">{project.title}</h3>
          {project.description && (
            <p className="text-sm text-c-muted mt-1 line-clamp-2">{project.description}</p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-2 rounded-xl text-c-dim hover:text-red-400 hover:bg-c-hover opacity-0 group-hover:opacity-100 transition-all"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <span className="px-2.5 py-1 text-xs rounded-full bg-accent-muted text-accent-primary font-medium">
          {t(`drama.${GENRE_KEYS[project.genre]}`)}
        </span>
        <span className="px-2.5 py-1 text-xs rounded-full bg-c-elevated text-c-muted">
          {t(`drama.${TONE_KEYS[project.tone]}`)}
        </span>
        <span className="px-2.5 py-1 text-xs rounded-full bg-c-elevated text-c-muted">
          {t(`drama.${STYLE_KEYS[project.artStyle]}`)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="h-1 bg-c-elevated rounded-full overflow-hidden">
          <div className="h-full bg-accent-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between text-xs text-c-dim">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clapperboard className="w-3 h-3" />
            {project.episodeCount} {t('drama.episodes').toLowerCase()}
          </span>
          <span>{project.aspectRatio}</span>
          <span>{project.durationTarget}s</span>
        </div>
        <div className="flex items-center gap-1.5 text-accent-primary font-medium">
          <span className="text-xs capitalize">{t(`drama.${project.currentStage === 'script' ? 'scriptStage' : project.currentStage}` as string)}</span>
          <ArrowRight className="w-3 h-3" />
        </div>
      </div>
    </div>
  );
}

function CreateProjectModal({ onClose, onCreate, mode }: { onClose: () => void; onCreate: (p: DramaProject) => void; mode: 'video' | 'image' }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<CreateDramaProjectInput>({
    title: '',
    description: '',
    genre: 'romance',
    tone: 'dramatic',
    artStyle: 'cinematic',
    aspectRatio: '9:16',
    language: 'en',
    episodeFormat: 'single',
    durationTarget: 60,
    episodeCount: 1,
    storyInput: '',
    inputMode: 'idea',
    mode,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateDramaProjectInput) => dramaApi.createProject(data),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['drama'] });
      onCreate(project);
    },
  });

  const update = (key: keyof CreateDramaProjectInput, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-c-surface border border-c-border rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
      >
        <div className="sticky top-0 bg-c-surface border-b border-c-border px-6 py-5 rounded-t-2xl">
          <h2 className="text-lg font-bold text-c-text">{t('drama.createProject')}</h2>
        </div>

        <div className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-c-text mb-2">{t('drama.projectTitle')}</label>
            <input
              type="text"
              value={form.title}
              onChange={e => update('title', e.target.value)}
              placeholder={t('drama.projectTitlePlaceholder')}
              className="input rounded-xl"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-c-text mb-2">{t('drama.description')}</label>
            <textarea
              value={form.description}
              onChange={e => update('description', e.target.value)}
              placeholder={t('drama.descriptionPlaceholder')}
              rows={2}
              className="input rounded-xl resize-none"
            />
          </div>

          {/* Genre + Tone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-c-text mb-2">{t('drama.genre')}</label>
              <select value={form.genre} onChange={e => update('genre', e.target.value)} className="input rounded-xl">
                {GENRES.map(g => (
                  <option key={g} value={g}>{t(`drama.${GENRE_KEYS[g]}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-c-text mb-2">{t('drama.tone')}</label>
              <select value={form.tone} onChange={e => update('tone', e.target.value)} className="input rounded-xl">
                {TONES.map(tn => (
                  <option key={tn} value={tn}>{t(`drama.${TONE_KEYS[tn]}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Art Style + Aspect Ratio */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-c-text mb-2">{t('drama.artStyle')}</label>
              <select value={form.artStyle} onChange={e => update('artStyle', e.target.value)} className="input rounded-xl">
                {ART_STYLES.map(s => (
                  <option key={s} value={s}>{t(`drama.${STYLE_KEYS[s]}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-c-text mb-2">{t('drama.aspectRatio')}</label>
              <select value={form.aspectRatio} onChange={e => update('aspectRatio', e.target.value)} className="input rounded-xl">
                {ASPECT_RATIOS.map(ar => (
                  <option key={ar} value={ar}>{ar}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-c-text mb-2">{t('drama.language')}</label>
            <select value={form.language} onChange={e => update('language', e.target.value)} className="input rounded-xl">
              {LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Format + Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-c-text mb-2">{t('drama.episodeFormat')}</label>
              <div className="flex gap-2">
                {(['single', 'series'] as EpisodeFormat[]).map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => update('episodeFormat', fmt)}
                    className={clsx(
                      'flex-1 py-2.5 text-sm rounded-xl border transition-colors',
                      form.episodeFormat === fmt
                        ? 'border-accent-primary bg-accent-muted text-accent-primary font-medium'
                        : 'border-c-border text-c-muted hover:bg-c-elevated'
                    )}
                  >
                    {t(`drama.${fmt}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-c-text mb-2">{t('drama.durationTarget')}</label>
              <select value={form.durationTarget} onChange={e => update('durationTarget', Number(e.target.value))} className="input rounded-xl">
                {DURATIONS.map(d => (
                  <option key={d} value={d}>{t('drama.durationSeconds', { count: d })}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Episode count (for series) */}
          {form.episodeFormat === 'series' && (
            <div>
              <label className="block text-sm font-medium text-c-text mb-2">{t('drama.episodeCount')}</label>
              <input
                type="number"
                min={2}
                max={20}
                value={form.episodeCount}
                onChange={e => update('episodeCount', Number(e.target.value))}
                className="input rounded-xl w-24"
              />
            </div>
          )}

          {/* Story Input */}
          <div>
            <label className="block text-sm font-medium text-c-text mb-2">{t('drama.storyInput')}</label>
            <div className="flex gap-2 mb-3">
              {(['idea', 'outline', 'script', 'novel', 'generate'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => update('inputMode', mode)}
                  className={clsx(
                    'px-3 py-1.5 text-xs rounded-full border transition-colors',
                    form.inputMode === mode
                      ? 'border-accent-primary bg-accent-muted text-accent-primary font-medium'
                      : 'border-c-border text-c-muted hover:bg-c-elevated'
                  )}
                >
                  {t(`drama.inputMode${mode.charAt(0).toUpperCase() + mode.slice(1)}` as string)}
                </button>
              ))}
            </div>
            <textarea
              value={form.storyInput}
              onChange={e => update('storyInput', e.target.value)}
              placeholder={t('drama.storyInputPlaceholder')}
              rows={4}
              className="input rounded-xl resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-c-surface border-t border-c-border px-6 py-4 rounded-b-2xl flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost rounded-full">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => createMutation.mutate(form)}
            disabled={!form.title.trim() || createMutation.isPending}
            className="btn-primary rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? t('common.loading') : t('drama.createProject')}
          </button>
        </div>
      </div>
    </div>
  );
}
