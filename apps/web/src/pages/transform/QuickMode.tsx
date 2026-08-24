import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Play, Download, ArrowRight, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { transformApi, imageApi } from '../../lib/api';
import { useTransformStore } from '../../store/transform';

interface QuickModeProps {
  onSendToAdvanced: (projectId: string) => void;
}

export function QuickMode({ onSendToAdvanced }: QuickModeProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [provider, setProvider] = useState<'google-flow' | 'grok' | 'chatgpt'>('google-flow');

  const quickJob = useTransformStore((s) => s.quickJob);
  const setQuickJob = useTransformStore((s) => s.setQuickJob);
  const startGeneration = useTransformStore((s) => s.startGeneration);
  const stopGeneration = useTransformStore((s) => s.stopGeneration);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageDataUrl(reader.result);
        setImagePreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!imageDataUrl) throw new Error('No image selected');
      return imageApi.uploadSingle(imageDataUrl);
    },
  });

  const quickJobMutation = useMutation({
    mutationFn: async (sourceImagePath: string) => {
      return transformApi.createQuickJob({
        sourceImagePath,
        instruction,
      });
    },
  });

  const convertMutation = useMutation({
    mutationFn: (projectId: string) => transformApi.convertToAdvanced(projectId),
  });

  const handleGenerate = useCallback(async () => {
    if (!imageDataUrl || !instruction.trim()) return;

    try {
      // Step 1: Upload image
      const { filename } = await uploadMutation.mutateAsync();

      // Step 2: Create quick job on backend
      const project = await quickJobMutation.mutateAsync(filename);
      const projectId = project.id;

      // Step 3: Set up quick job state
      setQuickJob({
        projectId,
        status: 'generating',
        progress: [],
        resultUrl: null,
        error: null,
      });

      // Step 4: Build composed prompt and dispatch to extension
      const composedPrompt = `Transform image: ${instruction}`;

      startGeneration(
        projectId,
        composedPrompt,
        'image',
        provider,
        (result) => {
          // On done: update quick job with result
          setQuickJob({
            projectId,
            status: 'done',
            progress: useTransformStore.getState().quickJob?.progress || [],
            resultUrl: result.url,
            error: null,
          });
        },
        (error) => {
          // On error: update quick job with error
          setQuickJob({
            projectId,
            status: 'failed',
            progress: useTransformStore.getState().quickJob?.progress || [],
            resultUrl: null,
            error,
          });
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setQuickJob({
        projectId: '',
        status: 'failed',
        progress: [],
        resultUrl: null,
        error: message,
      });
    }
  }, [imageDataUrl, instruction, provider, uploadMutation, quickJobMutation, setQuickJob, startGeneration]);

  const handleStop = useCallback(() => {
    if (quickJob?.projectId) {
      stopGeneration(quickJob.projectId);
      setQuickJob({
        ...quickJob,
        status: 'failed',
        error: 'Generation stopped by user',
      });
    }
  }, [quickJob, stopGeneration, setQuickJob]);

  const handleSendToAdvanced = useCallback(async () => {
    if (!quickJob?.projectId) return;
    try {
      await convertMutation.mutateAsync(quickJob.projectId);
      onSendToAdvanced(quickJob.projectId);
    } catch {
      // ignore — mutation state will show error
    }
  }, [quickJob, convertMutation, onSendToAdvanced]);

  const handleDownload = useCallback(() => {
    if (!quickJob?.resultUrl) return;
    const a = document.createElement('a');
    a.href = quickJob.resultUrl;
    a.download = `transform-${quickJob.projectId}.png`;
    a.click();
  }, [quickJob]);

  const isGenerating = quickJob?.status === 'generating';
  const isDone = quickJob?.status === 'done';
  const isFailed = quickJob?.status === 'failed';
  const canGenerate = !!imageDataUrl && instruction.trim().length > 0 && !isGenerating;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Image Upload */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          {t('transformStudio.uploadImage')}
        </label>
        <p className="text-xs text-gray-500">{t('transformStudio.uploadImageHint')}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        {imagePreview ? (
          <div className="relative group">
            <img
              src={imagePreview}
              alt="Source"
              className="w-full max-h-64 object-contain rounded-lg border border-white/10 bg-black/30"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg text-sm text-white"
            >
              <Upload className="w-4 h-4 mr-2" />
              {t('transformStudio.uploadImage')}
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex flex-col items-center justify-center gap-2 py-12 border-2 border-dashed border-white/10 rounded-lg hover:border-purple-500/50 transition-colors text-gray-400 hover:text-purple-400"
          >
            <Upload className="w-8 h-8" />
            <span className="text-sm">{t('transformStudio.uploadImage')}</span>
          </button>
        )}
      </div>

      {/* Instruction */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          {t('transformStudio.instruction')}
        </label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t('transformStudio.instructionPlaceholder')}
          rows={3}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 resize-none"
        />
      </div>

      {/* Provider */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">
          {t('transformStudio.provider')}
        </label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as typeof provider)}
          className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500/50"
        >
          <option value="google-flow">Google Flow</option>
          <option value="grok">Grok</option>
          <option value="chatgpt">ChatGPT</option>
        </select>
      </div>

      {/* Generate / Stop Button */}
      <div className="flex gap-3">
        {isGenerating ? (
          <button
            onClick={handleStop}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('transformStudio.generating')}
          </button>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium transition-colors"
          >
            <Play className="w-4 h-4" />
            {t('transformStudio.generate')}
          </button>
        )}
      </div>

      {/* Progress Log */}
      {quickJob && quickJob.progress.length > 0 && (
        <div className="rounded-lg bg-black/30 border border-white/10 p-4 max-h-40 overflow-auto">
          <div className="space-y-1">
            {quickJob.progress.map((line, i) => (
              <p key={i} className="text-xs text-gray-400 font-mono">
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Error Display */}
      {isFailed && quickJob?.error && (
        <div className="rounded-lg bg-red-900/20 border border-red-500/30 p-4">
          <p className="text-sm text-red-400">{quickJob.error}</p>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="mt-2 text-xs text-red-300 hover:text-white underline"
          >
            {t('transformStudio.retry')}
          </button>
        </div>
      )}

      {/* Result */}
      {isDone && quickJob?.resultUrl && (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-500/30 bg-green-900/10 p-4">
            <p className="text-sm text-green-400 mb-3">{t('transformStudio.resultReady')}</p>
            <img
              src={quickJob.resultUrl}
              alt="Result"
              className="w-full max-h-80 object-contain rounded-lg bg-black/30"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-white text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              {t('transformStudio.download')}
            </button>
            <button
              onClick={handleSendToAdvanced}
              disabled={convertMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white text-sm font-medium transition-colors"
            >
              {convertMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              {t('transformStudio.sendToAdvanced')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
