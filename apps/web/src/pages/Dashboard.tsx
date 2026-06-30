import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { videosApi, libraryApi, queueApi, importApi } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { StatusDot } from '../components/ui/StatusDot';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Spinner } from '../components/ui/Spinner';
import { useAppStore } from '../store';
import { Plus, Film, Library, Zap, Clock, Play, Link2, AlertCircle, Download, Trash2, Check, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

export function Dashboard() {
  const { t } = useTranslation();
  const { liveJobs } = useAppStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [importUrl, setImportUrl] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: ytdlpAvailable } = useQuery({
    queryKey: ['import', 'check'],
    queryFn: () => importApi.checkYtDlp().then((r) => r.available),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => videosApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['videos'] }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await videosApi.delete(id);
    },
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['videos'] });
    },
  });

  // POST /import/url now returns a jobId — the actual work runs in the background queue
  // and progress flows through SSE → liveJobs. We watch that map for completion below.
  const importMutation = useMutation({
    mutationFn: (url: string) => importApi.fromUrl(url),
    onSuccess: (jobId) => {
      setImportJobId(jobId);
    },
    onError: (err: Error) => {
      const ax = err as Error & { response?: { data?: { error?: string } } };
      setImportError(ax.response?.data?.error ?? err.message ?? t('dashboard.importError'));
    },
  });

  function handleImport() {
    if (!importUrl.trim()) return;
    setImportError(null);
    setImportJobId(null);
    importMutation.mutate(importUrl.trim());
  }

  const importJob = importJobId ? liveJobs.get(importJobId) : undefined;
  const importInFlight = importMutation.isPending || (importJob !== undefined && importJob.status !== 'completed' && importJob.status !== 'failed');
  const importPct = importJob?.progress ?? 0;
  const importMsg = importJob?.progressMessage ?? '';

  // Navigate to editor once the import job lands on the new project.
  useEffect(() => {
    if (!importJob) return;
    if (importJob.status === 'completed') {
      const result = importJob.result as { projectId?: string } | undefined;
      const projectId = result?.projectId;
      if (projectId) {
        queryClient.invalidateQueries({ queryKey: ['videos'] });
        setImportJobId(null);
        setImportUrl('');
        navigate(`/editor?video=${projectId}`);
      }
    } else if (importJob.status === 'failed') {
      setImportError(importJob.errorMessage ?? t('dashboard.importError'));
      setImportJobId(null);
    }
  }, [importJob?.status, importJob?.result, importJob?.errorMessage]);

  const { data: videos, isLoading: videosLoading } = useQuery({
    queryKey: ['videos'],
    queryFn: videosApi.list,
    refetchInterval: 10_000,
  });

  const { data: libraryStats } = useQuery({
    queryKey: ['library', 'stats'],
    queryFn: libraryApi.stats,
  });

  const { data: queueStats } = useQuery({
    queryKey: ['queue', 'stats'],
    queryFn: queueApi.stats,
    refetchInterval: 5000,
  });

  const { data: runningJobs } = useQuery({
    queryKey: ['queue', 'running'],
    queryFn: () => queueApi.list('running'),
    refetchInterval: 3000,
  });

  const recentVideos = videos?.slice(0, 6) ?? [];

  return (
    <div className="flex flex-col h-full overflow-auto">
      <TopBar
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={
          <Link to="/script" className="btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" />
            {t('dashboard.newVideo')}
          </Link>
        }
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            {
              icon: Film,
              label: t('dashboard.totalVideos'),
              value: videos?.length ?? 0,
              sub: t('dashboard.projects'),
              color: 'text-accent-primary',
              bg: 'bg-accent-muted',
            },
            {
              icon: Library,
              label: t('dashboard.sceneLibrary'),
              value: libraryStats?.totalScenes ?? 0,
              sub: t('dashboard.reusableScenes'),
              color: 'text-blue-400',
              bg: 'bg-blue-900/20',
            },
            {
              icon: Zap,
              label: t('dashboard.assets'),
              value: libraryStats?.totalAssets ?? 0,
              sub: t('dashboard.generated'),
              color: 'text-amber-400',
              bg: 'bg-amber-900/20',
            },
            {
              icon: Clock,
              label: t('dashboard.jobsToday'),
              value: queueStats?.totalToday ?? 0,
              sub: `${queueStats?.running ?? 0} ${t('dashboard.running')}`,
              color: 'text-green-400',
              bg: 'bg-green-900/20',
            },
          ].map(({ icon: Icon, label, value, sub, color, bg }) => (
            <div key={label} className="card p-4">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <div>
                  <div className="text-2xl font-semibold text-c-text">{value}</div>
                  <div className="text-xs text-c-muted">{label}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-c-dim">{sub}</div>
            </div>
          ))}
        </div>

        {/* URL Import */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Download className="w-4 h-4 text-accent-primary" />
            <h2 className="text-sm font-medium text-c-text">{t('dashboard.importVideo')}</h2>
            {ytdlpAvailable === false && (
              <span className="ml-auto flex items-center gap-1 text-xs text-amber-400">
                <AlertCircle className="w-3.5 h-3.5" />
                {t('dashboard.ytdlpNotAvailable')}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={importUrl}
              onChange={(e) => { setImportUrl(e.target.value); setImportError(null); }}
              onKeyDown={(e) => e.key === 'Enter' && handleImport()}
              placeholder={t('dashboard.importUrlPlaceholder')}
              disabled={importInFlight}
              className="input flex-1 text-sm"
            />
            <button
              onClick={handleImport}
              disabled={!importUrl.trim() || importInFlight || ytdlpAvailable === false}
              className="btn-primary flex items-center gap-2 text-sm px-4 disabled:opacity-50"
            >
              {importInFlight ? (
                <><Loader2 className="w-4 h-4 animate-spin" />{t('dashboard.importing')}</>
              ) : (
                <><Link2 className="w-4 h-4" />{t('dashboard.importBtn')}</>
              )}
            </button>
          </div>
          {importError && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {importError}
            </div>
          )}

          {/* Per-step progress card while the import job is running */}
          {importInFlight && (() => {
            const steps = [
              { key: 'fetch', label: t('dashboard.importStepMetadata'), endPct: 10 },
              { key: 'download', label: t('dashboard.importStepDownload'), endPct: 55 },
              { key: 'process', label: t('dashboard.importStepProcess'), endPct: 85 },
              { key: 'project', label: t('dashboard.importStepProject'), endPct: 94 },
              { key: 'caption', label: t('dashboard.importStepCaption'), endPct: 100 },
            ];
            return (
              <div className="mt-3 p-3 rounded-lg bg-c-bg border border-accent-glow">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-c-muted truncate">{importMsg || t('dashboard.importing')}</div>
                  <div className="text-xs font-medium text-accent-primary tabular-nums">{importPct}%</div>
                </div>
                <ProgressBar value={importPct} />
                <ul className="mt-3 space-y-1.5">
                  {steps.map((s) => {
                    const completed = importPct >= s.endPct;
                    const active = !completed && (steps[steps.indexOf(s) - 1]?.endPct ?? 0) <= importPct;
                    return (
                      <li key={s.key} className="flex items-center gap-2 text-xs">
                        {completed ? (
                          <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                        ) : active ? (
                          <Loader2 className="w-3.5 h-3.5 text-accent-primary animate-spin shrink-0" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full border border-c-border shrink-0" />
                        )}
                        <span className={clsx(
                          completed ? 'text-c-text' : active ? 'text-accent-primary font-medium' : 'text-c-dim'
                        )}>{s.label}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}

          <div className="mt-2 text-xs text-c-dim">{t('dashboard.supportedPlatforms')}</div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Recent Videos */}
          <div className="col-span-2 card">
            <div className="flex items-center justify-between p-4 border-b border-c-border">
              <div className="flex items-center gap-3">
                {recentVideos.length > 0 && (
                  <input
                    type="checkbox"
                    checked={recentVideos.length > 0 && selected.size === recentVideos.length}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(recentVideos.map(v => v.id)));
                      else setSelected(new Set());
                    }}
                    className="w-3.5 h-3.5 accent-c-accent cursor-pointer"
                  />
                )}
                <h2 className="text-sm font-medium text-c-text">{t('dashboard.recentVideos')}</h2>
                {selected.size > 0 && (
                  <button
                    onClick={() => bulkDeleteMutation.mutate([...selected])}
                    disabled={bulkDeleteMutation.isPending}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                    {bulkDeleteMutation.isPending ? t('common.loading') : t('dashboard.deleteSelected', { count: selected.size })}
                  </button>
                )}
              </div>
              <Link to="/editor" className="text-xs text-accent-primary hover:text-accent-hover">
                {t('common.viewAll')}
              </Link>
            </div>

            {videosLoading ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : recentVideos.length === 0 ? (
              <div className="text-center py-12">
                <Film className="w-8 h-8 text-c-dim mx-auto mb-3" />
                <div className="text-sm text-c-muted">{t('dashboard.noVideos')}</div>
                <Link to="/script" className="text-xs text-accent-primary hover:underline mt-1 block">
                  {t('dashboard.createFirst')}
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-c-border">
                {recentVideos.map((video) => (
                  <div key={video.id} className="flex items-center gap-4 px-4 py-3 hover:bg-c-surface transition-colors group">
                    <input
                      type="checkbox"
                      checked={selected.has(video.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(video.id);
                        else next.delete(video.id);
                        setSelected(next);
                      }}
                      className="w-3.5 h-3.5 accent-c-accent cursor-pointer shrink-0"
                    />
                    <Link to={`/editor?video=${video.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-14 h-9 bg-c-elevated rounded flex items-center justify-center shrink-0">
                        {video.outputPath
                          ? <Play className="w-3.5 h-3.5 text-accent-primary" />
                          : <Film className="w-3.5 h-3.5 text-c-dim" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-c-text truncate">{video.title}</div>
                          {video.uploadStatus === 'uploaded' && (
                            <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              <Check className="w-2.5 h-2.5" />
                              {t('dashboard.uploadedBadge')}
                            </span>
                          )}
                          {video.uploadStatus === 'in_progress' && (
                            <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              <Loader2 className="w-2.5 h-2.5" />
                              {t('dashboard.inProgressBadge')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <StatusDot status={video.status} />
                          <span className="text-xs text-c-muted">{video.status}</span>
                          <span className="text-xs text-c-dim">·</span>
                          <span className="text-xs text-c-dim">{video.duration}s</span>
                          <span className="text-xs text-c-dim">·</span>
                          <span className="text-xs text-c-dim uppercase">{video.format}</span>
                        </div>
                      </div>
                      <div className="text-xs text-c-dim shrink-0">
                        {new Date(video.createdAt).toLocaleDateString()}
                      </div>
                    </Link>
                    <button
                      onClick={() => deleteMutation.mutate(video.id)}
                      disabled={deleteMutation.isPending}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-900/30 text-c-dim hover:text-red-400 transition-all shrink-0"
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Jobs */}
          <div className="card">
            <div className="flex items-center justify-between p-4 border-b border-c-border">
              <h2 className="text-sm font-medium text-c-text">{t('dashboard.activeJobs')}</h2>
              <Link to="/batch" className="text-xs text-accent-primary hover:text-accent-hover">
                {t('dashboard.queueSummary')}
              </Link>
            </div>

            <div className="p-3 space-y-2">
              {!runningJobs?.length ? (
                <div className="text-center py-8 text-xs text-c-dim">
                  {t('dashboard.noActiveJobs')}
                </div>
              ) : (
                runningJobs.map((job) => {
                  const live = liveJobs.get(job.id);
                  const progress = live?.progress ?? job.progress;
                  return (
                    <div key={job.id} className="bg-c-surface rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-c-text font-medium capitalize">
                          {job.type.replace(/-/g, ' ')}
                        </span>
                        <span className="text-xs text-c-dim">{progress}%</span>
                      </div>
                      <ProgressBar value={progress} />
                      {(live?.progressMessage ?? job.progressMessage) && (
                        <div className="text-xs text-c-muted mt-1.5 truncate">
                          {live?.progressMessage ?? job.progressMessage}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {queueStats && (
                <div className="mt-3 pt-3 border-t border-c-border grid grid-cols-2 gap-2">
                  {[
                    { label: t('queue.queued'), value: queueStats.queued, color: 'text-c-muted' },
                    { label: t('queue.running'), value: queueStats.running, color: 'text-blue-400' },
                    { label: t('queue.done'), value: queueStats.completed, color: 'text-green-400' },
                    { label: t('queue.failed'), value: queueStats.failed, color: 'text-red-400' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="text-center">
                      <div className={`text-base font-semibold ${color}`}>{value}</div>
                      <div className="text-xs text-c-dim">{label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Library by mood */}
        {libraryStats && (
          <div className="card p-4">
            <h2 className="text-sm font-medium text-c-text mb-4">{t('dashboard.libraryByMood')}</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(libraryStats.byMood ?? {}).map(([mood, count]) => (
                <Link
                  key={mood}
                  to={`/library?mood=${mood}`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-c-surface border border-c-border hover:border-accent-primary transition-colors"
                >
                  <Badge mood={mood}>{mood}</Badge>
                  <span className="text-xs text-c-muted">{count as number}</span>
                </Link>
              ))}
              {Object.keys(libraryStats.byMood ?? {}).length === 0 && (
                <span className="text-xs text-c-dim">{t('dashboard.noScenes')}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
