import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Wand2, Loader2 } from 'lucide-react';
import { transformApi } from '../../../lib/api';
import { imageApi } from '../../../lib/api';

interface SetupPanelProps {
  activeProjectId: string | null;
  onProjectCreated: (id: string) => void;
}

const DEFAULT_SEGMENTS = [
  { prompt: 'Empty room / bare space — starting state', lighting: 'natural daylight' },
  { prompt: 'Preparation and cleanup — clearing debris', lighting: 'morning light' },
  { prompt: 'Flooring and base elements installed', lighting: 'midday sun' },
  { prompt: 'Furniture placement — key pieces arranged', lighting: 'afternoon light' },
  { prompt: 'Decorative touches — plants, cushions, art', lighting: 'golden hour' },
  { prompt: 'Final reveal with full styling complete', lighting: 'dusk with warm string lights' },
];

export default function SetupPanel({ activeProjectId, onProjectCreated }: SetupPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null);
  const [anchor, setAnchor] = useState('');
  const [creating, setCreating] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Load existing project data
  const { data: project } = useQuery({
    queryKey: ['transform-project', activeProjectId],
    queryFn: () => transformApi.getProject(activeProjectId!),
    enabled: !!activeProjectId,
  });

  useEffect(() => {
    if (project) {
      setAnchor(project.lockedCameraAnchor || '');
      if (project.sourceImagePath) {
        setSourceImageUrl(project.sourceImagePath);
      }
    }
  }, [project]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;

    setCreating(true);
    try {
      // Upload image via imageApi
      const uploaded = await imageApi.uploadMediaFile(file);
      setSourceImageUrl(uploaded.url);

      if (!activeProjectId) {
        // Create new advanced project and seed segments
        const newProject = await transformApi.createProject({
          mode: 'advanced',
          sourceImagePath: uploaded.url,
          lockedCameraAnchor: anchor,
        });

        // Seed 6 default segments
        for (let i = 0; i < DEFAULT_SEGMENTS.length; i++) {
          await transformApi.addSegment(newProject.id, {
            prompt: DEFAULT_SEGMENTS[i].prompt,
            lighting: DEFAULT_SEGMENTS[i].lighting,
            order: i + 1,
          });
        }

        onProjectCreated(newProject.id);
        queryClient.invalidateQueries({ queryKey: ['transform-project', newProject.id] });
      } else {
        await transformApi.updateProject(activeProjectId, { sourceImagePath: uploaded.url });
        queryClient.invalidateQueries({ queryKey: ['transform-project', activeProjectId] });
      }
    } catch (err) {
      console.error('Failed to upload image:', err);
    } finally {
      setCreating(false);
    }
  }, [activeProjectId, anchor, onProjectCreated, queryClient]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  }, [handleFileUpload]);

  const handleAutoDerive = useCallback(async () => {
    if (!activeProjectId) return;
    setDeriving(true);
    try {
      const result = await transformApi.deriveAnchor(activeProjectId);
      setAnchor(result);
      queryClient.invalidateQueries({ queryKey: ['transform-project', activeProjectId] });
    } catch (err) {
      console.error('Failed to derive anchor:', err);
    } finally {
      setDeriving(false);
    }
  }, [activeProjectId, queryClient]);

  const handleAnchorBlur = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      await transformApi.updateProject(activeProjectId, { lockedCameraAnchor: anchor });
    } catch (err) {
      console.error('Failed to save anchor:', err);
    }
  }, [activeProjectId, anchor]);

  return (
    <div className="space-y-6">
      {/* Source image upload */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          {t('transformStudio.uploadImage')}
        </label>
        <p className="text-xs text-[var(--text-tertiary)] mb-2">
          {t('transformStudio.uploadImageHint')}
        </p>

        {sourceImageUrl ? (
          <div className="relative group">
            <img
              src={sourceImageUrl}
              alt="Source"
              className="w-full max-h-64 object-contain rounded-lg border border-[var(--border-primary)]"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg text-white text-sm font-medium"
            >
              {t('transformStudio.uploadImage')}
            </button>
          </div>
        ) : (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => !creating && fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${dragging
                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                : 'border-[var(--border-primary)] hover:border-[var(--accent-primary)]'
              }
            `}
          >
            {creating ? (
              <Loader2 className="w-8 h-8 mx-auto text-[var(--accent-primary)] animate-spin" />
            ) : (
              <>
                <Upload className="w-8 h-8 mx-auto text-[var(--text-tertiary)] mb-2" />
                <p className="text-sm text-[var(--text-secondary)]">
                  {t('transformStudio.uploadImage')}
                </p>
              </>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Locked camera anchor */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
          {t('transformStudio.lockedCameraAnchor')}
        </label>
        <p className="text-xs text-[var(--text-tertiary)] mb-2">
          {t('transformStudio.lockedCameraAnchorHint')}
        </p>
        <textarea
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
          onBlur={handleAnchorBlur}
          rows={3}
          className="w-full rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] resize-none"
        />
        <button
          onClick={handleAutoDerive}
          disabled={!activeProjectId || deriving}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
        >
          {deriving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Wand2 className="w-3.5 h-3.5" />
          )}
          {deriving ? t('transformStudio.deriving') : t('transformStudio.autoDerive')}
        </button>
      </div>
    </div>
  );
}
