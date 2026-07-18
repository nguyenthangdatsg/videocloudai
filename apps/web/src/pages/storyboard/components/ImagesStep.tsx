import { Image, Video, RefreshCw, Trash2, ArrowRight, Globe, Film, Square, Wand2, Upload, ZoomIn, X, CheckCircle, Pencil, Link, Filter } from 'lucide-react';
import { useState } from 'react';
import { clsx } from 'clsx';
import { Spinner } from '../../../components/ui/Spinner';
import { imageApi } from '../../../lib/api';
import { useStoryboard } from '../StoryboardContext';

export function ImagesStep() {
  const {
    t, projectId,
    generatedImages, setGeneratedImages, generatingImages, imageProgress,
    provider, setProvider, imageModel, setImageModel, aspectRatio, setAspectRatio,
    uploadingZip, zipInputRef, imageCardRefs,
    imageTab, setImageTab, flowAvailable, flowProvider, setFlowProvider,
    mediaType, setMediaType, videoDuration, setVideoDuration,
    imageProviders, selectedProviderInfo,
    handleGenerateImages, handleGenerateVideos, handleStopImages, handleUploadZip,
    handleFlowGenerate, handleFlowRegenerateAll, handleFlowResume,
    handleRegenSingle, handleDropImage, handleImportFromUrl, regenIndex,
    failedImageCount,
    editingImageIdx, setEditingImageIdx, editingImagePrompt, setEditingImagePrompt,
    prompts, setPrompts, setStep, saveProject, setLightboxUrl,
    segments, setSegments, handleBuildTimeline,
    compMediaSource, handlePexelsBatch, cancelPexels, pexelsLoading, pexelsProgress, videoMode,
  } = useStoryboard();

  const [statusFilter, setStatusFilter] = useState<'all' | 'done' | 'error' | 'pending'>('all');

  const doneImageCount = generatedImages.filter((i) => i.status === 'done').length;
  const errorImageCount = generatedImages.filter((i) => i.status === 'error').length;
  const pendingImageCount = generatedImages.filter((i) => i.status === 'pending').length;

  const handleStartEditPrompt = (idx: number) => {
    setEditingImageIdx(idx);
    setEditingImagePrompt(prompts[idx]?.prompt || '');
  };

  const handleSaveEditedPrompt = (idx: number) => {
    if (editingImageIdx !== idx) return;
    const updated = prompts.map((p, i) =>
      i === idx ? { ...p, prompt: editingImagePrompt } : p,
    );
    setPrompts(updated);
    saveProject({ prompts: updated });
    setEditingImageIdx(null);
  };

  return (
    <div className="space-y-3">
      {/* Status + Actions row */}
      <div className="flex items-center gap-2 flex-wrap">
        {generatedImages.length > 0 ? (
          <div className="inline-flex rounded-lg border border-c-border overflow-hidden shrink-0">
            <button
              onClick={() => setStatusFilter('all')}
              className={clsx('text-[10px] px-2.5 py-1 font-medium transition-colors whitespace-nowrap', statusFilter === 'all' ? 'bg-c-elevated text-c-text' : 'text-c-dim hover:text-c-text')}
            >
              {t('storyboard.all')} {generatedImages.length}
            </button>
            {doneImageCount > 0 && (
              <button
                onClick={() => setStatusFilter(statusFilter === 'done' ? 'all' : 'done')}
                className={clsx('text-[10px] px-2.5 py-1 font-medium transition-colors border-l border-c-border whitespace-nowrap', statusFilter === 'done' ? 'bg-emerald-600/20 text-emerald-400' : 'text-emerald-400/60 hover:text-emerald-400')}
              >
                {doneImageCount} {t('storyboard.imgDone')}
              </button>
            )}
            {errorImageCount > 0 && (
              <button
                onClick={() => setStatusFilter(statusFilter === 'error' ? 'all' : 'error')}
                className={clsx('text-[10px] px-2.5 py-1 font-medium transition-colors border-l border-c-border whitespace-nowrap', statusFilter === 'error' ? 'bg-red-600/20 text-red-400' : 'text-red-400/60 hover:text-red-400')}
              >
                {errorImageCount} {t('storyboard.imgFailed')}
              </button>
            )}
            {pendingImageCount > 0 && (
              <button
                onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
                className={clsx('text-[10px] px-2.5 py-1 font-medium transition-colors border-l border-c-border whitespace-nowrap', statusFilter === 'pending' ? 'bg-yellow-600/20 text-yellow-400' : 'text-yellow-400/60 hover:text-yellow-400')}
              >
                {pendingImageCount} {t('storyboard.imgPending')}
              </button>
            )}
          </div>
        ) : (
          <span className="text-xs text-c-muted">{prompts.length} {t('storyboard.stepPrompts').toLowerCase()}</span>
        )}
        <div className="flex-1" />
        {!generatingImages && generatedImages.length > 0 && (
          <>
            {flowAvailable && failedImageCount > 0 && regenIndex === null && (
              <button onClick={handleFlowResume} className="text-xs py-1 px-2.5 rounded-lg font-medium flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white transition-colors">
                <RefreshCw className="w-3 h-3" /> {t('storyboard.resumeFailed', { count: failedImageCount })}
              </button>
            )}
            {doneImageCount > 0 && (
              <button
                onClick={() => {
                  if (!confirm(t('storyboard.clearImagesConfirm'))) return;
                  const cleared = generatedImages.map(img => ({ ...img, status: 'pending' as const, filename: '', url: '' }));
                  setGeneratedImages(cleared);
                  const clearedSegments = segments.map(s => ({ ...s, imageFilename: '', imageUrl: '', videoFilename: '', videoUrl: '' }));
                  setSegments(clearedSegments);
                  saveProject({ generatedImages: cleared, segments: clearedSegments });
                  const promptTexts = prompts.map(p => p.prompt).filter(Boolean);
                  if (promptTexts.length) imageApi.clearPromptCache(promptTexts);
                }}
                className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> {t('storyboard.clearAllImages')}
              </button>
            )}
            {doneImageCount > 0 && (
              <button onClick={handleBuildTimeline} className="btn-primary text-xs flex items-center gap-1 py-1.5 px-3">
                {t('storyboard.buildTimeline')} <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Progress bar */}
      {generatedImages.length > 0 && (
        <div className="w-full h-2 rounded-full bg-c-elevated overflow-hidden flex">
          {doneImageCount > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${(doneImageCount / generatedImages.length) * 100}%` }} />}
          {errorImageCount > 0 && <div className="bg-red-500 transition-all" style={{ width: `${(errorImageCount / generatedImages.length) * 100}%` }} />}
          {pendingImageCount > 0 && <div className="bg-yellow-500/40 transition-all" style={{ width: `${(pendingImageCount / generatedImages.length) * 100}%` }} />}
        </div>
      )}

      {/* Media Type Toggle: Image / Video Clip / Pexels Stock */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-c-muted">{t('storyboard.mediaType')}:</span>
        <div className="flex rounded-lg border border-c-border overflow-hidden">
          <button
            onClick={() => setMediaType('image')}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors border-r border-c-border',
              mediaType === 'image' ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text',
            )}
          >
            <Image className="w-3.5 h-3.5" /> {t('storyboard.imageMode')}
          </button>
          <button
            onClick={() => { setMediaType('video'); setImageTab('generate'); }}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors border-r border-c-border',
              mediaType === 'video' ? 'bg-violet-600/20 text-violet-400' : 'text-c-muted hover:text-c-text',
            )}
          >
            <Video className="w-3.5 h-3.5" /> {t('storyboard.videoMode')}
          </button>
          <button
            onClick={() => { setMediaType('pexels'); }}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
              mediaType === 'pexels' ? 'bg-green-600/20 text-green-400' : 'text-c-muted hover:text-c-text',
            )}
          >
            <Film className="w-3.5 h-3.5" /> Pexels Stock
          </button>
        </div>
      </div>

      {/* Pexels Stock Video mode */}
      {mediaType === 'pexels' ? (
        <div className="space-y-3">
          <div className="border border-green-800/30 rounded-xl p-4 bg-green-900/10 space-y-3">
            <div className="flex items-center gap-2">
              <Film className="w-4 h-4 text-green-400" />
              <span className="text-xs font-medium text-green-300">{t('storyboard.compMediaSourcePexels')}</span>
            </div>
            <p className="text-[10px] text-c-dim">{t('storyboard.compMediaSourcePexelsDesc')}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePexelsBatch}
                disabled={pexelsLoading || !prompts.length}
                className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
              >
                {pexelsLoading ? <Spinner size="sm" /> : <Film className="w-3.5 h-3.5" />}
                {t('storyboard.pexelsGenerateVideos')}
              </button>
              {pexelsLoading && (
                <button
                  onClick={cancelPexels}
                  className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white"
                >
                  {t('storyboard.stop')}
                </button>
              )}
            </div>
            {pexelsProgress.length > 0 && (
              <div className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                {pexelsProgress.slice(-10).map((line, i) => (
                  <div key={i} className={line.includes('Error') || line.includes('error') || line.includes('Failed') ? 'text-red-400' : line.includes('Done') ? 'text-green-400' : ''}>{line}</div>
                ))}
              </div>
            )}
          </div>
          {doneImageCount > 0 && !generatingImages && (
            <div className="flex justify-end">
              <button onClick={handleBuildTimeline} className="btn-primary text-xs flex items-center gap-1 py-1.5 px-3">
                {t('storyboard.buildTimeline')} <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      ) :
      /* Video mode: generate via Extension */
      mediaType === 'video' ? (
        <div className="space-y-3">
          {!flowAvailable ? (
            <div className="border-2 border-dashed border-violet-700/30 rounded-xl p-8 flex flex-col items-center justify-center gap-3">
              <Globe className="w-8 h-8 text-violet-400/50" />
              <span className="text-sm text-c-text font-medium">{t('storyboard.extensionNotDetected')}</span>
              <span className="text-xs text-c-dim text-center max-w-md" dangerouslySetInnerHTML={{ __html: t('storyboard.extensionInstallHint') + ' ' + t('storyboard.extensionInstallFlowHint') }} />
            </div>
          ) : (
            <div className="border border-violet-800/30 rounded-xl p-4 bg-violet-900/10 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs font-medium text-violet-300">
                  <Film className="w-4 h-4 inline mr-1" /> {t('storyboard.extensionConnected')} — {t('storyboard.videoMode')}
                </span>
              </div>
              <div className="text-[11px] text-c-dim space-y-1">
                <p dangerouslySetInnerHTML={{ __html: t('storyboard.extensionVideoHint') }} />
                <p className="text-amber-300/80" dangerouslySetInnerHTML={{ __html: t('storyboard.extensionVideoWarning') }} />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={generatingImages ? handleStopImages : handleGenerateVideos}
                  disabled={!prompts.length && !generatingImages}
                  className={clsx(
                    'text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5',
                    generatingImages ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50',
                  )}
                >
                  {generatingImages
                    ? <><Square className="w-3 h-3" /> {t('image.stop')}</>
                    : <><Video className="w-3.5 h-3.5" /> {t('storyboard.generateNVideosViaFlow', { count: prompts.length })}</>
                  }
                </button>
                {!generatingImages && failedImageCount > 0 && (
                  <button
                    onClick={handleFlowResume}
                    className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> {t('storyboard.resumeNFailed', { count: failedImageCount })}
                  </button>
                )}
                <span className="text-[10px] text-c-dim">{t('storyboard.nPromptsQueued', { count: prompts.length })}</span>
              </div>
            </div>
          )}

          {imageProgress.length > 0 && (
            <div className="border border-violet-800/30 rounded-xl p-3 bg-violet-900/10">
              <div className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                {imageProgress.slice(-10).map((line, i) => (
                  <div key={i} className={line.includes('Failed') || line.includes('Stopped') ? 'text-red-400' : line.includes('Done') ? 'text-green-400' : ''}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
      <>
      {/* Aspect Ratio (shared across all image tabs) */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-c-muted">{t('image.aspectRatio')}:</label>
        <div className="flex rounded-lg border border-c-border overflow-hidden">
          {(['16:9', '9:16', '1:1'] as const).map(ar => (
            <button
              key={ar}
              onClick={() => setAspectRatio(ar)}
              className={clsx(
                'px-3 py-1 text-xs font-medium transition-colors',
                aspectRatio === ar ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text',
              )}
            >
              {ar}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs: Generate / Google Flow / Upload (image mode only) */}
      <div className="flex gap-0 border-b border-c-border">
        <button
          onClick={() => setImageTab('generate')}
          className={clsx(
            'px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
            imageTab === 'generate' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-c-muted hover:text-c-text',
          )}
        >
          <Wand2 className="w-3.5 h-3.5" /> {t('storyboard.generateAllImages')}
        </button>
        <button
          onClick={() => setImageTab('flow')}
          className={clsx(
            'px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
            imageTab === 'flow' ? 'border-violet-400 text-violet-400' : 'border-transparent text-c-muted hover:text-c-text',
          )}
        >
          <Globe className="w-3.5 h-3.5" /> {t('storyboard.extension')}
          {flowAvailable && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        </button>
        <button
          onClick={() => setImageTab('upload')}
          className={clsx(
            'px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5',
            imageTab === 'upload' ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-c-muted hover:text-c-text',
          )}
        >
          <Upload className="w-3.5 h-3.5" /> {t('storyboard.uploadZip')}
        </button>
      </div>

      {/* Tab: Generate */}
      {imageTab === 'generate' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.provider')}</label>
              <select
                value={provider}
                onChange={(e) => { setProvider(e.target.value); setImageModel(''); }}
                className="input text-sm"
              >
                <option value="auto">{t('storyboard.autoProvider')}</option>
                {imageProviders?.map((p) => (
                  <option key={p.id} value={p.id} disabled={!(p as any).available && (p as any).needsKey}>
                    {p.name}{(p as any).free ? ' (Free)' : ''}{!(p as any).available && (p as any).needsKey ? ` — ${t('storyboard.keyNeeded')}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {selectedProviderInfo?.models && selectedProviderInfo.models.length > 0 && (
              <div>
                <label className="text-xs text-c-muted mb-1 block">{t('image.model')}</label>
                <select value={imageModel} onChange={(e) => setImageModel(e.target.value)} className="input text-sm">
                  <option value="">{t('image.defaultModel')}</option>
                  {selectedProviderInfo.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="self-end">
              <button
                onClick={generatingImages ? handleStopImages : handleGenerateImages}
                disabled={!prompts.length && !generatingImages}
                className={clsx(
                  'text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5',
                  generatingImages ? 'bg-red-600 hover:bg-red-700 text-white' : 'btn-primary disabled:opacity-50',
                )}
              >
                {generatingImages
                  ? <><Square className="w-3 h-3" /> {t('image.stop')}</>
                  : <><Image className="w-3.5 h-3.5" /> {t('storyboard.generateAllImages')}</>
                }
              </button>
            </div>
          </div>

          {imageProgress.length > 0 && (
            <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10">
              <div className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                {imageProgress.slice(-10).map((line, i) => (
                  <div key={i} className={line.includes('Failed') || line.includes('Stopped') ? 'text-red-400' : line.includes('Done') ? 'text-green-400' : ''}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Extension (Google Flow / Grok / ChatGPT) */}
      {imageTab === 'flow' && (
        <div className="space-y-3">
          {/* Provider selector */}
          <div className="flex rounded-lg border border-c-border overflow-hidden">
            {([
              { id: 'google-flow' as const, label: 'Google Flow' },
              { id: 'grok' as const, label: 'Grok' },
              { id: 'chatgpt' as const, label: 'ChatGPT' },
            ]).map(fp => (
              <button
                key={fp.id}
                onClick={() => setFlowProvider(fp.id)}
                className={clsx(
                  'flex-1 py-1.5 text-xs font-medium transition-colors',
                  flowProvider === fp.id
                    ? 'bg-violet-600/20 text-violet-400 border-b-2 border-violet-400'
                    : 'text-c-muted hover:bg-c-elevated hover:text-c-text',
                )}
              >
                {fp.label}
              </button>
            ))}
          </div>

          {!flowAvailable ? (
            <div className="border-2 border-dashed border-violet-700/30 rounded-xl p-8 flex flex-col items-center justify-center gap-3">
              <Globe className="w-8 h-8 text-violet-400/50" />
              <span className="text-sm text-c-text font-medium">{t('storyboard.extensionNotDetected')}</span>
              <span className="text-xs text-c-dim text-center max-w-md" dangerouslySetInnerHTML={{ __html: t('storyboard.extensionInstallHint') }} />
            </div>
          ) : (
            <>
              <div className="border border-violet-800/30 rounded-xl p-4 bg-violet-900/10 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-xs font-medium text-violet-300">{t('storyboard.extensionConnected')} — {flowProvider === 'google-flow' ? 'Google Flow' : flowProvider === 'grok' ? 'Grok' : 'ChatGPT'}</span>
                </div>
                <div className="text-[11px] text-c-dim space-y-1">
                  <p>{t('storyboard.extensionImageHint', { provider: flowProvider === 'google-flow' ? 'Google Flow' : flowProvider === 'grok' ? 'Grok' : 'ChatGPT' })}</p>
                  <p className="text-amber-300/80">{t('storyboard.extensionDebugWarning')}</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {generatingImages ? (
                    <button
                      onClick={handleStopImages}
                      className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white"
                    >
                      <Square className="w-3 h-3" /> {t('storyboard.stop')}
                    </button>
                  ) : doneImageCount > 0 && failedImageCount === 0 && pendingImageCount === 0 ? (
                    /* All done — show Regenerate All */
                    <button
                      onClick={handleFlowRegenerateAll}
                      disabled={!prompts.length}
                      className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> {t('storyboard.regenerateAllN', { count: prompts.length })}
                    </button>
                  ) : failedImageCount > 0 || pendingImageCount > 0 ? (
                    /* Some failed/pending — show Resume (skips done) */
                    <button
                      onClick={handleFlowResume}
                      disabled={!prompts.length}
                      className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> {t('storyboard.resumeNRemaining', { count: failedImageCount + pendingImageCount })}
                    </button>
                  ) : (
                    /* No images yet — show Generate */
                    <button
                      onClick={handleFlowGenerate}
                      disabled={!prompts.length}
                      className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                    >
                      <Globe className="w-3.5 h-3.5" /> {t('storyboard.generateNVia', { count: prompts.length, provider: flowProvider === 'google-flow' ? 'Flow' : flowProvider === 'grok' ? 'Grok' : 'ChatGPT' })}
                    </button>
                  )}
                  {/* Always show Regenerate All as secondary when there are partial results */}
                  {!generatingImages && doneImageCount > 0 && (failedImageCount > 0 || pendingImageCount > 0) && (
                    <button
                      onClick={handleFlowRegenerateAll}
                      className="text-xs py-2 px-3 rounded-lg font-medium flex items-center gap-1.5 border border-violet-600/50 text-violet-300 hover:bg-violet-600/20 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" /> {t('storyboard.regenerateAll')}
                    </button>
                  )}
                  <span className="text-[10px] text-c-dim">
                    {doneImageCount > 0
                      ? t('storyboard.nOfNDone', { done: doneImageCount, total: prompts.length })
                      : t('storyboard.nPromptsQueued', { count: prompts.length })}
                  </span>
                </div>
              </div>

              {imageProgress.length > 0 && (
                <div className="border border-violet-800/30 rounded-xl p-3 bg-violet-900/10">
                  <div className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
                    {imageProgress.slice(-10).map((line, i) => (
                      <div key={i} className={line.includes('Error') || line.includes('Failed') ? 'text-red-400' : line.includes('Done') ? 'text-green-400' : ''}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      )}

      {/* Tab: Upload Zip */}
      {imageTab === 'upload' && (
        <div className="space-y-3">
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadZip(f); }}
          />
          <div
            onClick={() => !uploadingZip && zipInputRef.current?.click()}
            className={clsx(
              'border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors',
              uploadingZip ? 'border-cyan-600/40 bg-cyan-950/20' : 'border-c-border hover:border-cyan-600/50 hover:bg-cyan-950/10',
            )}
          >
            {uploadingZip ? (
              <>
                <Spinner size="md" />
                <span className="text-sm text-cyan-400">{t('storyboard.uploadingZip')}</span>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-c-muted" />
                <span className="text-sm text-c-text font-medium">{t('storyboard.uploadZip')}</span>
                <span className="text-xs text-c-dim text-center">{t('storyboard.uploadZipHint')}</span>
              </>
            )}
          </div>
        </div>
      )}
      </>
      )}

      {/* Stop button while generating */}
      {(generatingImages || regenIndex !== null) && (
        <div className="flex items-center gap-3 border border-amber-800/30 rounded-xl p-3 bg-amber-900/10">
          <Spinner size="sm" />
          <span className="text-xs text-amber-300 flex-1">
            {regenIndex !== null
              ? t('storyboard.regeneratingImageN', { n: regenIndex + 1 })
              : t('storyboard.generatingImagesProgress', { done: generatedImages.filter((im) => im.status === 'done').length, total: generatedImages.length })
            }
          </span>
          <button
            onClick={() => {
              handleStopImages();
            }}
            className="text-xs py-1.5 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium flex items-center gap-1.5"
          >
            <Square className="w-3 h-3" /> {t('storyboard.stop')}
          </button>
        </div>
      )}

      {generatedImages.length > 0 && flowAvailable && !generatingImages && regenIndex === null && failedImageCount > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-c-dim">
          <span>{t('storyboard.retryWith')}</span>
          {(['google-flow', 'grok', 'chatgpt'] as const).map(fp => (
            <button
              key={fp}
              onClick={() => setFlowProvider(fp)}
              className={clsx(
                'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                flowProvider === fp ? 'bg-violet-600 text-white' : 'bg-c-elevated text-c-muted hover:text-c-text',
              )}
            >
              {fp === 'google-flow' ? 'Flow' : fp === 'grok' ? 'Grok' : 'ChatGPT'}
            </button>
          ))}
          <button
            onClick={handleFlowResume}
            className="ml-auto px-3 py-0.5 rounded text-[10px] font-medium bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1"
          >
            <RefreshCw className="w-2.5 h-2.5" /> {t('storyboard.resumeNFailed', { count: failedImageCount })}
          </button>
        </div>
      )}

      {generatedImages.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {generatedImages.map((img, i) => {
            if (statusFilter !== 'all' && img.status !== statusFilter) return null;
            const isEditing = editingImageIdx === i;
            const prompt = prompts[i];
            return (
            <div key={i} ref={(el) => { imageCardRefs.current[i] = el; }} className={clsx(
              'rounded-xl border overflow-hidden group/card',
              img.status === 'done' ? 'border-green-800/30' : img.status === 'generating' ? 'border-cyan-800/30' : img.status === 'error' ? 'border-red-800/30' : 'border-c-border',
            )}>
              {/* Media area */}
              {img.status === 'done' && img.url ? (() => {
                const isVid = img.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(img.url || '') || /\.(mp4|webm|mov)$/i.test(img.filename || '');
                return (
                <div className="relative cursor-pointer group" onClick={() => setLightboxUrl(img.url)}>
                  {isVid ? (
                    <video src={`${img.url}#t=0.1`} className={clsx('w-full object-cover', aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video')} muted loop playsInline preload="metadata" onMouseEnter={(e) => (e.target as HTMLVideoElement).play()} onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }} />
                  ) : (
                    <img src={img.url} alt={`Generated image ${img.timestamp}`} className={clsx('w-full object-cover', aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video')} loading="lazy" />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <ZoomIn className="w-5 h-5 text-white" />
                  </div>
                  {/* Action buttons overlay */}
                  {!generatingImages && regenIndex === null && (
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-all">
                      {flowAvailable && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRegenSingle(i, 'google-flow'); }}
                            className="p-1 rounded-md bg-black/60 text-blue-300 hover:text-white hover:bg-blue-600/80"
                            title={t('storyboard.retryWithFlow')}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRegenSingle(i, 'grok'); }}
                            className="p-1 rounded-md bg-black/60 text-orange-300 hover:text-white hover:bg-orange-600/80"
                            title={t('storyboard.retryWithGrok')}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRegenSingle(i, 'chatgpt'); }}
                            className="p-1 rounded-md bg-black/60 text-green-300 hover:text-white hover:bg-green-600/80"
                            title={t('storyboard.retryWithChatGPT')}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleImportFromUrl(i); }}
                        className="p-1 rounded-md bg-black/60 text-cyan-300 hover:text-white hover:bg-cyan-600/80"
                        title={t('storyboard.importFromUrl')}
                      >
                        <Link className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDropImage(i); }}
                        className="p-1 rounded-md bg-black/60 text-white/80 hover:text-white hover:bg-red-600/80"
                        title={t('storyboard.removeImage')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
                );
              })() : (
                <div className={clsx('flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-c-elevated to-c-bg', aspectRatio === '9:16' ? 'aspect-[9/16]' : aspectRatio === '1:1' ? 'aspect-square' : 'aspect-video')}>
                  {img.status === 'generating' ? (
                    <Spinner size="sm" />
                  ) : img.status === 'error' ? (
                    <>
                      <X className="w-4 h-4 text-red-400" />
                      {flowAvailable && regenIndex === null && (
                        <div className="flex flex-wrap justify-center gap-1">
                          <button
                            onClick={() => handleRegenSingle(i, 'google-flow')}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-blue-600/80 hover:bg-blue-600 text-white flex items-center gap-0.5 transition-colors"
                            title={t('storyboard.retryWithFlow')}
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> Google
                          </button>
                          <button
                            onClick={() => handleRegenSingle(i, 'grok')}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-orange-600/80 hover:bg-orange-600 text-white flex items-center gap-0.5 transition-colors"
                            title={t('storyboard.retryWithGrok')}
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> Grok
                          </button>
                          <button
                            onClick={() => handleRegenSingle(i, 'chatgpt')}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-green-600/80 hover:bg-green-600 text-white flex items-center gap-0.5 transition-colors"
                            title={t('storyboard.retryWithChatGPT')}
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> GPT
                          </button>
                        </div>
                      )}
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleImportFromUrl(i)}
                          className="text-[9px] px-2 py-0.5 rounded bg-cyan-800/60 hover:bg-cyan-700 text-white flex items-center gap-1 transition-colors"
                          title={t('storyboard.importFromUrl')}
                        >
                          <Link className="w-2.5 h-2.5" /> URL
                        </button>
                        <button
                          onClick={() => handleDropImage(i)}
                          className="text-[9px] px-2 py-0.5 rounded bg-red-800/60 hover:bg-red-700 text-white flex items-center gap-1 transition-colors"
                        >
                          <Trash2 className="w-2.5 h-2.5" /> {t('storyboard.dropImage')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-c-dim" />
                      {flowAvailable && regenIndex === null && (
                        <div className="flex flex-wrap justify-center gap-1">
                          <button
                            onClick={() => handleRegenSingle(i, 'google-flow')}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-blue-600/60 hover:bg-blue-600 text-white flex items-center gap-0.5 transition-colors"
                            title={t('storyboard.generateWithFlow')}
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> Google
                          </button>
                          <button
                            onClick={() => handleRegenSingle(i, 'grok')}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-orange-600/60 hover:bg-orange-600 text-white flex items-center gap-0.5 transition-colors"
                            title={t('storyboard.generateWithGrok')}
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> Grok
                          </button>
                          <button
                            onClick={() => handleRegenSingle(i, 'chatgpt')}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-green-600/60 hover:bg-green-600 text-white flex items-center gap-0.5 transition-colors"
                            title={t('storyboard.generateWithChatGPT')}
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> GPT
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => handleImportFromUrl(i)}
                        className="text-[9px] px-2 py-0.5 rounded bg-cyan-800/60 hover:bg-cyan-700 text-white flex items-center gap-1 transition-colors"
                        title={t('storyboard.importFromUrl')}
                      >
                        <Link className="w-2.5 h-2.5" /> URL
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Footer: segment text + prompt edit */}
              <div className="px-2 py-1.5 bg-c-bg/50 space-y-1">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-cyan-400 font-mono shrink-0">[{img.timestamp}]</span>
                  <span className="text-[9px] text-c-dim font-medium shrink-0">#{i + 1}</span>
                  <span className="flex-1" />
                  <button
                    onClick={() => isEditing ? handleSaveEditedPrompt(i) : handleStartEditPrompt(i)}
                    className="p-0.5 rounded text-c-dim hover:text-c-text transition-colors"
                    title={isEditing ? t('storyboard.savePrompt2') : t('storyboard.editPrompt2')}
                  >
                    {isEditing ? <CheckCircle className="w-3 h-3 text-green-400" /> : <Pencil className="w-3 h-3" />}
                  </button>
                  {isEditing && (
                    <button
                      onClick={() => setEditingImageIdx(null)}
                      className="p-0.5 rounded text-c-dim hover:text-red-400 transition-colors"
                      title={t('storyboard.cancel')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {prompt?.text && (
                  <div className="text-[10px] text-c-text leading-snug line-clamp-3">
                    {prompt.text}
                  </div>
                )}
                {isEditing ? (
                  <textarea
                    value={editingImagePrompt}
                    onChange={(e) => setEditingImagePrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleSaveEditedPrompt(i); if (e.key === 'Escape') setEditingImageIdx(null); }}
                    className="w-full text-[10px] bg-c-bg border border-c-border rounded p-1 text-c-text resize-y min-h-[40px] max-h-[100px] focus:outline-none focus:border-violet-600/50"
                    autoFocus
                  />
                ) : (
                  <div className="text-[9px] text-c-muted line-clamp-2 leading-tight cursor-pointer hover:text-c-text" onClick={() => handleStartEditPrompt(i)}>
                    {prompt?.prompt || '—'}
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
