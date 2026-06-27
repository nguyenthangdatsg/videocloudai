import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

interface StatusDotProps {
  status: string;
  label?: boolean;
}

export function StatusDot({ status, label }: StatusDotProps) {
  const { t } = useTranslation();

  const STATUS_LABELS: Record<string, string> = {
    queued: t('status.queued'),
    running: t('status.running'),
    completed: t('status.completed'),
    failed: t('status.failed'),
    cancelled: t('status.cancelled'),
    retrying: t('status.retrying'),
    draft: t('status.draft'),
    'script-ready': t('status.scriptReady'),
    generating: t('status.generating'),
    assembling: t('status.assembling'),
    exported: t('status.exported'),
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={clsx('status-dot', {
          queued: status === 'queued' || status === 'script-ready' || status === 'draft',
          running: status === 'running' || status === 'generating' || status === 'assembling' || status === 'retrying',
          completed: status === 'completed' || status === 'exported',
          failed: status === 'failed' || status === 'cancelled',
        })}
      />
      {label && (
        <span className="text-xs text-c-muted">{STATUS_LABELS[status] ?? status}</span>
      )}
    </span>
  );
}
