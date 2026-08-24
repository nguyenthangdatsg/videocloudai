import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle, XCircle, Circle, Trash2, Play, RotateCcw } from 'lucide-react';
import { transformApi } from '../../../lib/api';
import { useTransformStore } from '../../../store/transform';

interface Segment {
  id: string;
  projectId: string;
  segmentOrder: number;
  prompt: string;
  lighting: string;
  status: string;
  assetPath: string | null;
}

interface SegmentEditorProps {
  segment: Segment;
  lockedCameraAnchor: string;
  provider: 'google-flow' | 'grok' | 'chatgpt';
}

export default function SegmentEditor({ segment, lockedCameraAnchor, provider }: SegmentEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { segmentStatuses, startGeneration, updateSegmentStatus } = useTransformStore();

  const [prompt, setPrompt] = useState(segment.prompt);
  const [lighting, setLighting] = useState(segment.lighting);

  const segStatus = segmentStatuses.get(segment.id);
  const currentStatus = segStatus?.status || segment.status || 'pending';
  const isGenerating = currentStatus === 'generating';

  const composedPrompt = useMemo(() => {
    return [
      `CAMERA ANCHOR: ${lockedCameraAnchor}`,
      `SCENE: ${prompt}`,
      `LIGHTING: ${lighting}`,
      `SEGMENT: ${segment.segmentOrder}`,
      `Generate a video clip showing this transformation stage.`,
    ].join('\n');
  }, [lockedCameraAnchor, prompt, lighting, segment.segmentOrder]);

  const statusIcon = useMemo(() => {
    switch (currentStatus) {
      case 'generating':
        return <Loader2 className="w-4 h-4 text-[var(--accent-primary)] animate-spin" />;
      case 'done':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Circle className="w-4 h-4 text-[var(--text-tertiary)]" />;
    }
  }, [currentStatus]);

  const handlePromptBlur = useCallback(async () => {
    if (prompt !== segment.prompt) {
      try {
        await transformApi.updateSegment(segment.id, { prompt });
        queryClient.invalidateQueries({ queryKey: ['transform-project', segment.projectId] });
      } catch (err) {
        console.error('Failed to save prompt:', err);
      }
    }
  }, [prompt, segment.id, segment.prompt, segment.projectId, queryClient]);

  const handleLightingBlur = useCallback(async () => {
    if (lighting !== segment.lighting) {
      try {
        await transformApi.updateSegment(segment.id, { lighting });
        queryClient.invalidateQueries({ queryKey: ['transform-project', segment.projectId] });
      } catch (err) {
        console.error('Failed to save lighting:', err);
      }
    }
  }, [lighting, segment.id, segment.lighting, segment.projectId, queryClient]);

  const handleGenerate = useCallback(() => {
    updateSegmentStatus(segment.id, {
      segmentId: segment.id,
      status: 'generating',
      progress: [],
      resultUrl: null,
      error: null,
    });

    startGeneration(
      segment.id,
      composedPrompt,
      'video',
      provider,
      async (result) => {
        updateSegmentStatus(segment.id, {
          status: 'done',
          resultUrl: result.url,
        });
        try {
          await transformApi.updateSegment(segment.id, {
            status: 'done',
            assetPath: result.url,
          });
          queryClient.invalidateQueries({ queryKey: ['transform-project', segment.projectId] });
        } catch (err) {
          console.error('Failed to update segment after generation:', err);
        }
      },
      async (error) => {
        updateSegmentStatus(segment.id, {
          status: 'failed',
          error,
        });
        try {
          await transformApi.updateSegment(segment.id, { status: 'failed' });
          queryClient.invalidateQueries({ queryKey: ['transform-project', segment.projectId] });
        } catch (err) {
          console.error('Failed to update segment after error:', err);
        }
      },
    );
  }, [segment.id, segment.projectId, composedPrompt, provider, startGeneration, updateSegmentStatus, queryClient]);

  const handleDelete = useCallback(async () => {
    try {
      await transformApi.deleteSegment(segment.id);
      queryClient.invalidateQueries({ queryKey: ['transform-project', segment.projectId] });
    } catch (err) {
      console.error('Failed to delete segment:', err);
    }
  }, [segment.id, segment.projectId, queryClient]);

  const assetUrl = segStatus?.resultUrl || segment.assetPath;

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {statusIcon}
          <span className="text-sm font-medium text-[var(--text-primary)]">
            #{segment.segmentOrder}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]">
            {t(`transformStudio.${currentStatus}`)}
          </span>
        </div>
        <button
          onClick={handleDelete}
          className="p-1 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
          title={t('transformStudio.deleteSegment')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Prompt */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
          {t('transformStudio.segmentPrompt')}
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={handlePromptBlur}
          rows={2}
          placeholder={t('transformStudio.segmentPromptPlaceholder')}
          className="w-full rounded-md bg-[var(--bg-primary)] border border-[var(--border-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] resize-none"
        />
      </div>

      {/* Lighting */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
          {t('transformStudio.lighting')}
        </label>
        <input
          value={lighting}
          onChange={(e) => setLighting(e.target.value)}
          onBlur={handleLightingBlur}
          className="w-full rounded-md bg-[var(--bg-primary)] border border-[var(--border-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
        />
      </div>

      {/* Progress log */}
      {segStatus && segStatus.progress.length > 0 && (
        <div className="rounded-md bg-[var(--bg-primary)] p-2 max-h-24 overflow-y-auto">
          {segStatus.progress.map((line, i) => (
            <p key={i} className="text-xs text-[var(--text-tertiary)] font-mono">
              {line}
            </p>
          ))}
        </div>
      )}

      {/* Error */}
      {segStatus?.error && (
        <p className="text-xs text-red-500 bg-red-500/10 rounded-md px-2 py-1">
          {segStatus.error}
        </p>
      )}

      {/* Asset preview */}
      {assetUrl && currentStatus === 'done' && (
        <video
          src={assetUrl}
          controls
          className="w-full rounded-md max-h-48 bg-black"
        />
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-[var(--accent-primary)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {isGenerating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : currentStatus === 'done' || currentStatus === 'failed' ? (
          <RotateCcw className="w-3.5 h-3.5" />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
        {currentStatus === 'done' || currentStatus === 'failed'
          ? t('transformStudio.regenerate')
          : t('transformStudio.generate')}
      </button>
    </div>
  );
}
