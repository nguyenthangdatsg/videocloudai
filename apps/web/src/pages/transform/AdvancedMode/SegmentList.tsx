import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { transformApi } from '../../../lib/api';
import SegmentEditor from './SegmentEditor';

interface SegmentListProps {
  projectId: string;
}

export default function SegmentList({ projectId }: SegmentListProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<'google-flow' | 'grok' | 'chatgpt'>('google-flow');

  const { data: project } = useQuery({
    queryKey: ['transform-project', projectId],
    queryFn: () => transformApi.getProject(projectId),
  });

  const segments = project?.segments || [];
  const anchor = project?.lockedCameraAnchor || '';

  const handleAddSegment = useCallback(async () => {
    const nextOrder = segments.length + 1;
    try {
      await transformApi.addSegment(projectId, {
        prompt: '',
        lighting: '',
        order: nextOrder,
      });
      queryClient.invalidateQueries({ queryKey: ['transform-project', projectId] });
    } catch (err) {
      console.error('Failed to add segment:', err);
    }
  }, [projectId, segments.length, queryClient]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          {t('transformStudio.segments')} ({segments.length})
        </h3>

        {/* Provider selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--text-secondary)]">
            {t('transformStudio.provider')}
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
            className="rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
          >
            <option value="google-flow">Google Flow</option>
            <option value="grok">Grok</option>
            <option value="chatgpt">ChatGPT</option>
          </select>
        </div>
      </div>

      {/* Segment editors */}
      <div className="space-y-3">
        {segments
          .sort((a: any, b: any) => a.segmentOrder - b.segmentOrder)
          .map((seg: any) => (
            <SegmentEditor
              key={seg.id}
              segment={seg}
              lockedCameraAnchor={anchor}
              provider={provider}
            />
          ))}
      </div>

      {/* Add segment button */}
      <button
        onClick={handleAddSegment}
        className="flex items-center gap-1.5 w-full justify-center py-2 rounded-lg border border-dashed border-[var(--border-primary)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)] transition-colors"
      >
        <Plus className="w-4 h-4" />
        {t('transformStudio.addSegment')}
      </button>
    </div>
  );
}
