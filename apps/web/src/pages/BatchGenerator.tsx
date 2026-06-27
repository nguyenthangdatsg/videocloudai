import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { videosApi, batchApi, queueApi } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { StatusDot } from '../components/ui/StatusDot';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Spinner } from '../components/ui/Spinner';
import { useAppStore } from '../store';
import { Layers, Plus, Play, Clock, Film } from 'lucide-react';

export function BatchGenerator() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pushNotification } = useAppStore();
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [variationCount, setVariationCount] = useState(5);

  const { data: videos } = useQuery({
    queryKey: ['videos'],
    queryFn: videosApi.list,
  });

  const { data: batchJobs, isLoading } = useQuery({
    queryKey: ['batch'],
    queryFn: batchApi.list,
    refetchInterval: 5000,
  });

  const createBatchMutation = useMutation({
    mutationFn: () => batchApi.create(selectedTemplate, variationCount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch'] });
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      pushNotification({ id: 'batch-created', type: 'success', title: t('notifications.batchCreated') });
      setSelectedTemplate('');
    },
  });

  const completedVideos = videos?.filter((v) => v.status === 'script-ready' || v.status === 'completed') ?? [];

  return (
    <div className="flex flex-col h-full overflow-auto">
      <TopBar
        title={t('batch.title')}
        subtitle={t('batch.subtitle')}
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Create batch */}
        <div className="card p-5">
          <h2 className="text-sm font-medium text-c-text mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#7c6af5]" />
            {t('batch.newBatch')}
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('batch.templateVideo')}</label>
              <select
                className="input"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              >
                <option value="">{t('batch.selectTemplate')}</option>
                {completedVideos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} ({v.format} · {v.duration}s)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1.5 block">
                {t('batch.variations')}: {variationCount}
              </label>
              <input
                type="range"
                min={2}
                max={20}
                value={variationCount}
                onChange={(e) => setVariationCount(parseInt(e.target.value))}
                className="w-full accent-[#7c6af5]"
              />
              <div className="flex justify-between text-xs text-c-dim mt-1">
                <span>2</span>
                <span>20</span>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-c-surface rounded-lg text-xs text-c-muted">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-c-text font-medium mb-0.5">{variationCount} Videos</div>
                <div>{t('batch.videosGenerated')}</div>
              </div>
              <div>
                <div className="text-c-text font-medium mb-0.5">{t('batch.sceneReuse')}</div>
                <div>{t('batch.maximized')}</div>
              </div>
              <div>
                <div className="text-c-text font-medium mb-0.5">{t('batch.cpuOnly')}</div>
                <div>{t('batch.noGpu')}</div>
              </div>
            </div>
          </div>

          <button
            onClick={() => createBatchMutation.mutate()}
            disabled={!selectedTemplate || createBatchMutation.isPending}
            className="btn-primary flex items-center gap-2 text-sm mt-4 disabled:opacity-50"
          >
            {createBatchMutation.isPending ? <Spinner size="sm" /> : <Play className="w-4 h-4" />}
            {t('batch.startBatch')}
          </button>
        </div>

        {/* Batch jobs */}
        <div className="card">
          <div className="px-5 py-4 border-b border-c-border">
            <h2 className="text-sm font-medium text-c-text">{t('batch.batchHistory')}</h2>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : !batchJobs?.length ? (
            <div className="text-center py-12">
              <Layers className="w-8 h-8 text-c-dim mx-auto mb-3" />
              <div className="text-sm text-c-muted">{t('batch.noBatches')}</div>
            </div>
          ) : (
            <div className="divide-y divide-c-border">
              {batchJobs.map((job: Record<string, unknown>) => (
                <div key={job.id as string} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <StatusDot status={job.status as string} />
                      <div>
                        <div className="text-sm text-c-text">
                          Batch · {job.variation_count as number} variations
                        </div>
                        <div className="text-xs text-c-muted">
                          {new Date(job.created_at as string).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant="success">{job.completed_count as number} {t('batch.done')}</Badge>
                      {(job.failed_count as number) > 0 && (
                        <Badge variant="error">{job.failed_count as number} {t('batch.failed')}</Badge>
                      )}
                    </div>
                  </div>

                  <ProgressBar
                    value={(job.completed_count as number) + (job.failed_count as number)}
                    max={job.variation_count as number}
                    showLabel
                    color={job.status === 'failed' ? 'error' : 'primary'}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
