import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, AlertCircle, Loader2, Download, Film } from 'lucide-react';
import { transformApi } from '../../../lib/api';

interface AssemblePanelProps {
  projectId: string;
}

export default function AssemblePanel({ projectId }: AssemblePanelProps) {
  const { t } = useTranslation();
  const [assembling, setAssembling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; outputPath: string } | null>(null);

  const { data: project } = useQuery({
    queryKey: ['transform-project', projectId],
    queryFn: () => transformApi.getProject(projectId),
  });

  const segments = project?.segments || [];
  const allDone = segments.length > 0 && segments.every((s: any) => s.status === 'done');

  const handleAssemble = useCallback(async () => {
    setAssembling(true);
    setError(null);
    setResult(null);
    try {
      const res = await transformApi.assemble(projectId);
      setResult({ url: res.url, outputPath: res.outputPath });
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Assembly failed');
    } finally {
      setAssembling(false);
    }
  }, [projectId]);

  return (
    <div className="space-y-4">
      {/* Status indicator */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        {allDone ? (
          <>
            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
            <span className="text-sm text-green-500">
              {t('transformStudio.allSegmentsDone')}
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
            <span className="text-sm text-[var(--text-tertiary)]">
              {t('transformStudio.segmentsIncomplete')}
            </span>
          </>
        )}
      </div>

      {/* Assemble button */}
      <button
        onClick={handleAssemble}
        disabled={!allDone || assembling}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-primary)] text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {assembling ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Film className="w-4 h-4" />
        )}
        {assembling ? t('transformStudio.assembling') : t('transformStudio.assemble')}
      </button>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-green-500">
            {t('transformStudio.resultReady')}
          </p>
          <video
            src={result.url}
            controls
            className="w-full rounded-lg bg-black max-h-96"
          />
          <a
            href={result.url}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:opacity-90 transition-opacity"
          >
            <Download className="w-4 h-4" />
            {t('transformStudio.download')}
          </a>
        </div>
      )}
    </div>
  );
}
