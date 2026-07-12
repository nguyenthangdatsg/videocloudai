import { useState } from 'react';
import { Tag, Wand2, CheckCircle, X, ExternalLink, Image, Copy, ArrowRight, Check } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { StagePromptEditor } from './StagePromptEditor';
import { useStoryboard } from '../StoryboardContext';

export function MetadataStep() {
  const {
    t,
    saveProject,
    setStep,
    scriptText,
    scriptTopic,
    templateStageParts,
    setTemplateStageParts,
    metadataPrompt,
    setMetadataPrompt,
    savingPrompt,
    savedPromptStage,
    handleSaveStagePrompt,
    generatingMetadata,
    handleGenerateMetadata,
    metadataTitle,
    setMetadataTitle,
    metadataDesc,
    setMetadataDesc,
    metadataTags,
    setMetadataTags,
    metadataThumbnailPrompt,
    setMetadataThumbnailPrompt,
    thumbnailUrl,
    setThumbnailUrl,
    generatingThumbnail,
    thumbnailProgress,
    generatingThumbnailPrompt,
    handleAutoGenerateThumbnailPrompt,
    thumbnailBgColor,
    setThumbnailBgColor,
    handleGenerateThumbnail,
  } = useStoryboard();

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyField = (field: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleThumbnailPromptChange = (val: string) => {
    setMetadataThumbnailPrompt(val);
    saveProject({ thumbnailPrompt: val });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
        <Tag className="w-4 h-4 text-cyan-400" />
        {t('storyboard.stepMetadata')}
      </h3>

      {/* Stage prompt editor */}
      <StagePromptEditor
        label={`Stage 4: ${t('storyboard.stepMetadata')} — ${t('storyboard.stagePrompt')}`}
        stageParts={templateStageParts.metadata}
        value={metadataPrompt}
        onChange={setMetadataPrompt}
        onPartsChange={(parts) => setTemplateStageParts(p => ({ ...p, metadata: parts }))}
        onSave={() => handleSaveStagePrompt('metadata', metadataPrompt)}
        saving={savingPrompt === 'metadata'}
        saved={savedPromptStage === 'metadata'}
        t={t}
      />

      <div className="flex items-center gap-3">
        <button
          onClick={handleGenerateMetadata}
          disabled={!scriptText.trim() || generatingMetadata}
          className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
        >
          {generatingMetadata ? <Spinner size="sm" /> : <Wand2 className="w-3.5 h-3.5" />}
          {generatingMetadata ? t('storyboard.generatingMetadata') : t('storyboard.generateMetadata')}
        </button>
        {metadataTitle && (
          <span className="text-[10px] text-green-400 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> {t('storyboard.metadataDone')}
          </span>
        )}
      </div>

      {/* Metadata & Thumbnail layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Column: Metadata Fields */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-c-muted">{t('storyboard.metadataTitle')}</label>
              {metadataTitle && (
                <button onClick={() => copyField('title', metadataTitle)} className="text-[10px] text-c-dim hover:text-cyan-400 flex items-center gap-0.5 transition-colors">
                  {copiedField === 'title' ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copiedField === 'title' ? t('storyboard.copied') : t('storyboard.copy')}
                </button>
              )}
            </div>
            <input
              type="text"
              value={metadataTitle}
              onChange={(e) => { setMetadataTitle(e.target.value); saveProject({ metadataTitle: e.target.value }); }}
              className="input text-sm w-full"
              placeholder={t('storyboard.titlePlaceholder') || 'Enter video title'}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-c-muted">{t('storyboard.metadataDescription')}</label>
              {metadataDesc && (
                <button onClick={() => copyField('desc', metadataDesc)} className="text-[10px] text-c-dim hover:text-cyan-400 flex items-center gap-0.5 transition-colors">
                  {copiedField === 'desc' ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copiedField === 'desc' ? t('storyboard.copied') : t('storyboard.copy')}
                </button>
              )}
            </div>
            <textarea
              value={metadataDesc}
              onChange={(e) => { setMetadataDesc(e.target.value); saveProject({ metadataDesc: e.target.value }); }}
              rows={6}
              className="input text-sm w-full resize-y min-h-[100px]"
              placeholder={t('storyboard.descriptionPlaceholder') || 'Enter video description'}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-c-muted">{t('storyboard.metadataTags')} ({metadataTags.length})</label>
              {metadataTags.length > 0 && (
                <button onClick={() => copyField('tags', metadataTags.join(', '))} className="text-[10px] text-c-dim hover:text-cyan-400 flex items-center gap-0.5 transition-colors">
                  {copiedField === 'tags' ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copiedField === 'tags' ? t('storyboard.copied') : t('storyboard.copy')}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {metadataTags.map((tag, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-cyan-900/30 text-cyan-300 px-2 py-0.5 rounded-full">
                  {tag}
                  <button onClick={() => {
                    const updated = metadataTags.filter((_, j) => j !== i);
                    setMetadataTags(updated);
                    saveProject({ metadataTags: updated });
                  }} className="p-0.5 -m-0.5 hover:text-red-400 transition-colors" aria-label={`Remove tag ${tag}`}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder={t('storyboard.addTagPlaceholder') || 'Add tag...'}
              className="input text-sm w-full"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                  const updated = [...metadataTags, (e.target as HTMLInputElement).value.trim()];
                  setMetadataTags(updated);
                  saveProject({ metadataTags: updated });
                  (e.target as HTMLInputElement).value = '';
                }
              }}
            />
          </div>
        </div>

        {/* Right Column: YouTube Thumbnail Generator */}
        <div className="border border-c-border rounded-xl bg-c-surface p-4 flex flex-col justify-between space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-c-text mb-1 uppercase tracking-wider text-cyan-400">
              {t('storyboard.youtubeThumbnailTitle')}
            </h4>
            <p className="text-[10px] text-c-dim mb-3">
              {t('storyboard.youtubeThumbnailDesc')}
            </p>

            {/* Preview Image */}
            <div className="aspect-video w-full rounded-lg bg-c-bg border border-c-border overflow-hidden relative flex items-center justify-center group mb-3 shadow-md">
              {thumbnailUrl ? (
                <>
                  <img src={thumbnailUrl} alt="Thumbnail preview" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-all duration-200">
                    <a
                      href={thumbnailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary text-[10px] py-1 px-2 flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> {t('storyboard.viewFull')}
                    </a>
                    <button
                      onClick={() => {
                        setThumbnailUrl('');
                        saveProject({ thumbnailUrl: '' });
                      }}
                      className="btn-secondary hover:bg-red-900/35 hover:text-red-400 text-[10px] py-1 px-2"
                    >
                      {t('storyboard.reset')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center p-4">
                  <Image className="w-8 h-8 text-c-dim mx-auto mb-2 opacity-50" />
                  <span className="text-xs text-c-dim block">{t('storyboard.noThumbnailGenerated')}</span>
                </div>
              )}
              {generatingThumbnail && (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center p-4 text-center">
                  <Spinner className="w-6 h-6 text-cyan-400 mb-2" />
                  <span className="text-xs text-cyan-400 font-medium animate-pulse">{thumbnailProgress}</span>
                </div>
              )}
            </div>

            {/* Thumbnail Prompt Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-c-muted font-medium">{t('storyboard.ctrImagePrompt')}</label>
                <button
                  onClick={handleAutoGenerateThumbnailPrompt}
                  disabled={generatingThumbnailPrompt || (!metadataTitle && !scriptTopic)}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5 transition-colors disabled:opacity-50"
                  title={t('storyboard.autoGenerateTitle')}
                >
                  {generatingThumbnailPrompt ? <Spinner size="sm" /> : <Wand2 className="w-2.5 h-2.5" />}
                  {t('storyboard.autoGenerate')}
                </button>
              </div>
              <textarea
                value={metadataThumbnailPrompt}
                onChange={(e) => handleThumbnailPromptChange(e.target.value)}
                rows={4}
                className="input text-xs w-full resize-none bg-c-bg"
                placeholder={t('storyboard.thumbnailPromptPlaceholder')}
                disabled={generatingThumbnail}
              />
            </div>

            {/* Background Color */}
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-c-muted font-medium">{t('storyboard.background')}</label>
                {thumbnailBgColor && (
                  <button
                    onClick={() => { setThumbnailBgColor(''); saveProject({ thumbnailBgColor: '' }); }}
                    className="text-[10px] text-c-dim hover:text-red-400 transition-colors"
                  >
                    {t('storyboard.clear')}
                  </button>
                )}
              </div>
              {/* Preset options */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {[
                  { label: t('storyboard.colorNone'), value: '', icon: '—' },
                  { label: t('storyboard.colorTransparent'), value: 'transparent', icon: '🏁' },
                  { label: t('storyboard.colorWhite'), value: '#FFFFFF', swatch: '#FFFFFF' },
                  { label: t('storyboard.colorBlack'), value: '#000000', swatch: '#000000' },
                  { label: t('storyboard.colorRed'), value: '#FF0000', swatch: '#FF0000' },
                  { label: t('storyboard.colorBlue'), value: '#0066FF', swatch: '#0066FF' },
                  { label: t('storyboard.colorYellow'), value: '#FFD600', swatch: '#FFD600' },
                  { label: t('storyboard.colorGreen'), value: '#00C853', swatch: '#00C853' },
                  { label: t('storyboard.colorGradient'), value: 'cinematic gradient background' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setThumbnailBgColor(opt.value); saveProject({ thumbnailBgColor: opt.value }); }}
                    className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border transition-colors ${
                      thumbnailBgColor === opt.value
                        ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                        : 'border-c-border bg-c-bg text-c-muted hover:border-c-text/30'
                    }`}
                  >
                    {opt.swatch ? (
                      <span className="w-3 h-3 rounded-sm border border-c-border/50 inline-block" style={{ backgroundColor: opt.swatch }} />
                    ) : opt.icon ? (
                      <span className="text-[10px]">{opt.icon}</span>
                    ) : null}
                    {opt.label}
                  </button>
                ))}
              </div>
              {/* Custom color row */}
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={thumbnailBgColor.startsWith('#') && thumbnailBgColor.length <= 7 ? thumbnailBgColor : '#000000'}
                  onChange={(e) => { setThumbnailBgColor(e.target.value); saveProject({ thumbnailBgColor: e.target.value }); }}
                  className="w-7 h-7 rounded cursor-pointer border border-c-border bg-transparent p-0 shrink-0"
                />
                <input
                  type="text"
                  value={thumbnailBgColor}
                  onChange={(e) => { setThumbnailBgColor(e.target.value); saveProject({ thumbnailBgColor: e.target.value }); }}
                  className="input text-xs flex-1 bg-c-bg"
                  placeholder={t('storyboard.customColorPlaceholder')}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleGenerateThumbnail}
              disabled={generatingThumbnail || !metadataThumbnailPrompt.trim()}
              className="btn-primary text-xs flex items-center gap-1.5 flex-1 justify-center disabled:opacity-50 py-2"
            >
              {generatingThumbnail ? <Spinner className="w-3.5 h-3.5" /> : <Wand2 className="w-3.5 h-3.5" />}
              {t('storyboard.generateThumbnail')}
            </button>
            {thumbnailUrl && (
              <button
                onClick={() => navigator.clipboard.writeText(window.location.origin + thumbnailUrl)}
                className="btn-secondary text-xs px-3"
                title="Copy image link"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Copy all metadata */}
      {metadataTitle && (
        <div className="flex gap-2 pt-2 border-t border-c-border">
          <button
            onClick={() => {
              const text = `Title: ${metadataTitle}\n\nDescription:\n${metadataDesc}\n\nTags: ${metadataTags.join(', ')}`;
              navigator.clipboard.writeText(text);
            }}
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <Copy className="w-3 h-3" /> {t('storyboard.copyAll')}
          </button>
          <button
            onClick={() => { setStep('assemble'); saveProject({ currentStep: 'assemble' }); }}
            className="btn-primary text-xs flex items-center gap-1"
          >
            {t('storyboard.assemble')} <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
