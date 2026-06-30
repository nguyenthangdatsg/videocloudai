import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { queueApi } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Spinner } from '../components/ui/Spinner';
import { useAppStore } from '../store';
import { X, CheckCircle, AlertCircle, Clock, Loader2, Ban, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { JobStatus } from '@videocloudai/shared';

const STATUS_TABS: Array<{ value: JobStatus | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'queue.all' },
  { value: 'running', labelKey: 'queue.running' },
  { value: 'queued', labelKey: 'queue.queued' },
  { value: 'failed', labelKey: 'queue.failed' },
  { value: 'completed', labelKey: 'queue.done' },
];

function statusIcon(status: JobStatus) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />;
  if (status === 'completed') return <CheckCircle className="w-3.5 h-3.5 text-green-400" />;
  if (status === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
  if (status === 'cancelled') return <Ban className="w-3.5 h-3.5 text-c-dim" />;
  return <Clock className="w-3.5 h-3.5 text-c-muted" />;
}

function statusColor(status: JobStatus) {
  if (status === 'running') return 'text-blue-400';
  if (status === 'completed') return 'text-green-400';
  if (status === 'failed') return 'text-red-400';
  if (status === 'cancelled') return 'text-c-dim';
  return 'text-c-muted';
}

export function QueueManager() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { liveJobs } = useAppStore();
  const [activeTab, setActiveTab] = useState<JobStatus | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: jobs, isLoading } = useQuery({
    queryKey: ['queue', 'list', activeTab],
    queryFn: () => queueApi.list(activeTab === 'all' ? undefined : activeTab),
    refetchInterval: 3000,
  });

  const { data: stats } = useQuery({
    queryKey: ['queue', 'stats'],
    queryFn: queueApi.stats,
    refetchInterval: 3000,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => queueApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await queueApi.remove(id);
    },
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });

  // Jobs that can be selected for deletion (not running)
  const selectableJobs = jobs?.filter(j => j.status !== 'running') ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={t('queue.title')}
        subtitle={t('queue.subtitle')}
      />

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: t('queue.running'), value: stats.running, color: 'text-blue-400', bg: 'bg-blue-900/20' },
              { label: t('queue.queued'), value: stats.queued, color: 'text-c-muted', bg: 'bg-c-surface' },
              { label: t('queue.done'), value: stats.completed, color: 'text-green-400', bg: 'bg-green-900/20' },
              { label: t('queue.failed'), value: stats.failed, color: 'text-red-400', bg: 'bg-red-900/20' },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={clsx('card p-4 text-center', bg)}>
                <div className={clsx('text-2xl font-semibold', color)}>{value}</div>
                <div className="text-xs text-c-muted mt-1">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 border-b border-c-border">
          {STATUS_TABS.map(({ value, labelKey }) => (
            <button
              key={value}
              onClick={() => setActiveTab(value)}
              className={clsx(
                'px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors',
                activeTab === value
                  ? 'border-accent-primary text-accent-hover'
                  : 'border-transparent text-c-muted hover:text-c-text'
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* Bulk actions */}
        {selectableJobs.length > 0 && (
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={selectableJobs.length > 0 && selected.size === selectableJobs.length}
              onChange={(e) => {
                if (e.target.checked) setSelected(new Set(selectableJobs.map(j => j.id)));
                else setSelected(new Set());
              }}
              className="w-3.5 h-3.5 accent-c-accent cursor-pointer"
            />
            <span className="text-xs text-c-muted">
              {selected.size > 0 ? t('queue.selectedCount', { count: selected.size }) : t('queue.selectAll')}
            </span>
            {selected.size > 0 && (
              <button
                onClick={() => bulkDeleteMutation.mutate([...selected])}
                disabled={bulkDeleteMutation.isPending}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                {bulkDeleteMutation.isPending ? t('common.loading') : t('queue.deleteSelected')}
              </button>
            )}
          </div>
        )}

        {/* Job list */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : !jobs?.length ? (
          <div className="text-center py-12 text-c-dim text-sm">{t('queue.noJobs')}</div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => {
              const live = liveJobs.get(job.id);
              const progress = live?.progress ?? job.progress;
              const message = live?.progressMessage ?? job.progressMessage;
              const canCancel = job.status === 'queued' || job.status === 'running';

              return (
                <div key={job.id} className="card p-4">
                  <div className="flex items-start gap-3">
                    {job.status !== 'running' && (
                      <input
                        type="checkbox"
                        checked={selected.has(job.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(job.id);
                          else next.delete(job.id);
                          setSelected(next);
                        }}
                        className="w-3.5 h-3.5 accent-c-accent cursor-pointer shrink-0 mt-0.5"
                      />
                    )}
                    <div className="mt-0.5 shrink-0">{statusIcon(job.status)}</div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-c-text capitalize">
                          {job.type.replace(/-/g, ' ')}
                        </span>
                        <span className={clsx('text-xs', statusColor(job.status))}>
                          {job.status}
                        </span>
                        <span className="text-xs text-c-dim ml-auto shrink-0">
                          {new Date(job.createdAt).toLocaleTimeString()}
                        </span>
                      </div>

                      {(job.status === 'running' || job.status === 'queued') && (
                        <div className="mb-2">
                          <ProgressBar value={progress} />
                          {message && (
                            <div className="text-xs text-c-muted mt-1 truncate">{message}</div>
                          )}
                        </div>
                      )}

                      {job.errorMessage && (
                        <div className="text-xs text-red-400 mt-1 bg-red-900/10 border border-red-900/20 rounded px-2 py-1">
                          {job.errorMessage}
                        </div>
                      )}

                      <div className="flex items-center gap-3 text-xs text-c-dim mt-1">
                        <span>{t('queue.priority')}: {job.priority}</span>
                        {job.retryCount > 0 && (
                          <span>{t('queue.retries')}: {job.retryCount}/{job.maxRetries}</span>
                        )}
                        {job.payload['videoId'] ? (
                          <span>video: {String(job.payload['videoId']).slice(0, 8)}…</span>
                        ) : null}
                      </div>
                    </div>

                    {canCancel && (
                      <button
                        onClick={() => cancelMutation.mutate(job.id)}
                        disabled={cancelMutation.isPending}
                        className="shrink-0 p-1.5 rounded hover:bg-red-900/20 text-c-dim hover:text-red-400 transition-colors"
                        title={t('common.cancel')}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
