import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';

export function useSSE() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { updateLiveJob, setQueueStats, pushNotification } = useAppStore();

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('job:completed', (e) => {
      const data = JSON.parse(e.data) as { jobId: string; result: { effectsSkipped?: boolean } & Record<string, unknown> };
      // Persist completion + result into the live job map so consumers (like the Dashboard
      // import flow) can read the result without an extra API round-trip.
      updateLiveJob({ id: data.jobId, status: 'completed', progress: 100, progressMessage: 'Done', result: data.result } as never);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      // Per-video query that the editor uses — invalidate too so the player picks up
      // the new outputPath the moment assembly finishes (otherwise it waits on polling).
      queryClient.invalidateQueries({ queryKey: ['video'] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
      if (data.result?.effectsSkipped) {
        pushNotification({
          id: `effects-skipped-${data.jobId}`,
          type: 'warning',
          title: t('notifications.effectsSkipped'),
          message: t('notifications.effectsSkippedMsg'),
        });
      } else {
        pushNotification({
          id: `job-done-${data.jobId}`,
          type: 'success',
          title: t('notifications.jobDone'),
          message: `${t('notifications.jobDoneMsg')}: ${data.jobId.slice(0, 8)}`,
        });
      }
    });

    es.addEventListener('job:failed', (e) => {
      const data = JSON.parse(e.data) as { jobId: string; error: string };
      updateLiveJob({ id: data.jobId, status: 'failed', errorMessage: data.error } as never);
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      queryClient.invalidateQueries({ queryKey: ['video'] });
      pushNotification({
        id: `job-fail-${data.jobId}`,
        type: 'error',
        title: t('notifications.jobFailed'),
        message: data.error,
      });
    });

    es.addEventListener('job:progress', (e) => {
      const data = JSON.parse(e.data) as { jobId: string; progress: number; message: string };
      updateLiveJob({
        id: data.jobId,
        progress: data.progress,
        progressMessage: data.message,
      } as never);
    });

    es.onerror = () => {
      // Auto-reconnects
    };

    return () => es.close();
  }, [queryClient, updateLiveJob, setQueueStats, pushNotification]);
}
