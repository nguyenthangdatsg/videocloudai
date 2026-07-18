import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2, ArrowLeftRight, User, Image, Film, Monitor, Video, RefreshCw, ChevronDown, ChevronUp, Layout, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Spinner } from '../../../components/ui/Spinner';
import { useStoryboard } from '../StoryboardContext';
import { frameVideoLibraryApi, type FrameVideoItem } from '../../../lib/api';

export function ComparisonSetup() {
  const { t } = useTranslation();
  const {
    isComparisonTemplate,
    mascotPrompt, setMascotPrompt,
    mascotImage,
    comparisonItems, setComparisonItems,
    generatingMascot, handleGenerateMascot,
    getMascotVariants, handleGenerateSingleMascotVariant, generatingMascotKey,
    compMediaSource, setCompMediaSource,
    compRoundPanels, setCompRoundPanels,
    compBgSource, setCompBgSource,
    compBgQuery, setCompBgQuery,
    frameTemplateId, setFrameTemplateId,
    saveProject, setLightboxUrl,
  } = useStoryboard();

  const [expanded, setExpanded] = useState(true);
  const [frameTemplates, setFrameTemplates] = useState<FrameVideoItem[]>([]);
  const [loadingFrames, setLoadingFrames] = useState(false);

  useEffect(() => {
    if (!isComparisonTemplate) return;
    setLoadingFrames(true);
    frameVideoLibraryApi.list().then(setFrameTemplates).catch(() => {}).finally(() => setLoadingFrames(false));
  }, [isComparisonTemplate]);

  // Only render for comparison-style templates
  if (!isComparisonTemplate) return null;

  const variants = getMascotVariants();
  const hasMascot = variants.some(v => v.image);

  return (
    <div className="border border-cyan-800/30 rounded-xl bg-cyan-900/10 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-cyan-900/20 hover:bg-cyan-900/30 transition-colors text-left"
        aria-expanded={expanded}
      >
        <ArrowLeftRight className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-semibold text-cyan-300">
          {t('storyboard.comparisonMode')}
        </span>
        <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-medium">ON</span>
        <span className="ml-auto text-cyan-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {expanded && (
        <div>
        {/* ─── Section 1: Items ─── */}
        <div className="px-4 py-3 space-y-3 bg-cyan-950/20">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-3 h-3 text-cyan-400/60" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-cyan-400/70">
              {t('storyboard.comparisonType')}
            </span>
            <div className="flex-1" />
            <div className="flex rounded-lg border border-c-border overflow-hidden">
              <button
                onClick={() => {
                  const next = { ...comparisonItems, type: 'difference' as const };
                  setComparisonItems(next);
                  saveProject({ comparisonItems: next });
                }}
                className={clsx(
                  'px-3 py-1 text-[10px] font-medium transition-colors',
                  (comparisonItems.type || 'difference') === 'difference'
                    ? 'bg-cyan-600/20 text-cyan-400'
                    : 'text-c-muted hover:text-c-text',
                )}
              >
                {t('storyboard.comparisonTypeDifference')}
              </button>
              <button
                onClick={() => {
                  const next = { ...comparisonItems, type: 'winner' as const };
                  setComparisonItems(next);
                  saveProject({ comparisonItems: next });
                }}
                className={clsx(
                  'px-3 py-1 text-[10px] font-medium transition-colors',
                  comparisonItems.type === 'winner'
                    ? 'bg-amber-600/20 text-amber-400'
                    : 'text-c-muted hover:text-c-text',
                )}
              >
                {t('storyboard.comparisonTypeWinner')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-blue-400 font-bold tracking-wider mb-1 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                {t('storyboard.comparisonLeft')}
              </label>
              <input
                type="text"
                value={comparisonItems.left.name}
                onChange={(e) => {
                  const next = { ...comparisonItems, left: { ...comparisonItems.left, name: e.target.value } };
                  setComparisonItems(next);
                }}
                onBlur={() => saveProject({ comparisonItems })}
                placeholder={t('storyboard.comparisonLeftPlaceholder')}
                className="input text-sm w-full"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-orange-400 font-bold tracking-wider mb-1 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                {t('storyboard.comparisonRight')}
              </label>
              <input
                type="text"
                value={comparisonItems.right.name}
                onChange={(e) => {
                  const next = { ...comparisonItems, right: { ...comparisonItems.right, name: e.target.value } };
                  setComparisonItems(next);
                }}
                onBlur={() => saveProject({ comparisonItems })}
                placeholder={t('storyboard.comparisonRightPlaceholder')}
                className="input text-sm w-full"
              />
            </div>
          </div>
        </div>

        {/* ─── Section 2: Mascot Character ─── */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <User className="w-3 h-3 text-violet-400/60" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-violet-400/70">
              {t('storyboard.mascot')}
            </span>
            <div className="flex-1" />
            {hasMascot && <span className="text-[9px] text-green-400 font-medium">{t('storyboard.mascotReady')}</span>}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={mascotPrompt}
              onChange={(e) => setMascotPrompt(e.target.value)}
              placeholder={t('storyboard.mascotPromptPlaceholder')}
              className="input text-xs flex-1"
            />
            <button
              onClick={handleGenerateMascot}
              disabled={!mascotPrompt.trim() || generatingMascot}
              className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50 shrink-0"
            >
              {generatingMascot ? <Spinner size="sm" /> : <Wand2 className="w-3 h-3" />}
              {hasMascot ? t('storyboard.regenerateAll') : t('storyboard.generateMascot')}
            </button>
          </div>

          {/* Mascot variant gallery — compact row */}
          {hasMascot && (
            <div className="flex items-end gap-1.5">
              {variants.map((v) => {
                const src = v.image ? (v.image.startsWith('/api/') ? v.image : `/api/image/file/${v.image}`) : '';
                const isGenerating = generatingMascotKey === v.key;
                return (
                  <div key={v.key} className="group/mv">
                    <div className={clsx(
                      'relative w-8 h-12 rounded border overflow-hidden bg-c-elevated',
                      v.image ? 'border-violet-700/30' : 'border-c-border border-dashed',
                    )}>
                      {v.image ? (
                        <>
                          <img src={src} alt={v.label} className="w-full h-full object-cover cursor-pointer" onClick={() => setLightboxUrl(src)} />
                          <button
                            onClick={() => handleGenerateSingleMascotVariant(v.key, mascotPrompt.trim() + v.suffix)}
                            disabled={!!generatingMascotKey}
                            className="absolute inset-0 bg-black/0 group-hover/mv:bg-black/40 flex items-center justify-center opacity-0 group-hover/mv:opacity-100 transition-all disabled:opacity-30"
                            title={`Regenerate ${v.label}`}
                          >
                            <RefreshCw className="w-2.5 h-2.5 text-white" />
                          </button>
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {isGenerating ? <Spinner size="sm" /> : (
                            <button
                              onClick={() => handleGenerateSingleMascotVariant(v.key, mascotPrompt.trim() + v.suffix)}
                              disabled={!mascotPrompt.trim() || !!generatingMascotKey}
                              className="text-violet-400/50 hover:text-violet-400 disabled:opacity-30"
                            >
                              <Wand2 className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      )}
                      {isGenerating && v.image && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Spinner size="sm" /></div>
                      )}
                    </div>
                    <span className="text-[8px] text-c-dim text-center block mt-0.5">{v.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Section 3: Media & Layout ─── */}
        <div className="px-4 py-3 space-y-3 bg-cyan-950/20">
          <div className="flex items-center gap-2">
            <Image className="w-3 h-3 text-slate-400/60" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400/70">
              {t('storyboard.compMediaSource')}
            </span>
          </div>

          <div className="flex rounded-lg border border-c-border overflow-hidden">
            <button
              onClick={() => {
                setCompMediaSource('flow');
                saveProject({ compMediaSource: 'flow' });
              }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium transition-colors flex-1 justify-center',
                compMediaSource === 'flow'
                  ? 'bg-purple-600/20 text-purple-400'
                  : 'text-c-muted hover:text-c-text',
              )}
            >
              <Image className="w-3 h-3" />
              {t('storyboard.compMediaSourceImage')}
            </button>
            <button
              onClick={() => {
                setCompMediaSource('pexels');
                saveProject({ compMediaSource: 'pexels' });
              }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium transition-colors flex-1 justify-center',
                compMediaSource === 'pexels'
                  ? 'bg-green-600/20 text-green-400'
                  : 'text-c-muted hover:text-c-text',
              )}
            >
              <Film className="w-3 h-3" />
              {t('storyboard.compMediaSourcePexels')}
            </button>
          </div>

          {/* Round panels toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-c-muted font-medium">{t('storyboard.compRoundPanels')}</span>
            <button
              onClick={() => {
                const next = !compRoundPanels;
                setCompRoundPanels(next);
                saveProject({ compRoundPanels: next });
              }}
              className={clsx(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                compRoundPanels ? 'bg-cyan-600' : 'bg-c-border',
              )}
            >
              <span className={clsx(
                'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                compRoundPanels ? 'translate-x-[18px]' : 'translate-x-[3px]',
              )} />
            </button>
          </div>
        </div>

        {/* ─── Section 4: Background ─── */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Monitor className="w-3 h-3 text-slate-400/60" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400/70">
              {t('storyboard.compBgSource')}
            </span>
          </div>

          <div className="flex rounded-lg border border-c-border overflow-hidden">
            <button
              onClick={() => {
                setCompBgSource('color');
                saveProject({ compBgSource: 'color' });
              }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium transition-colors flex-1 justify-center',
                compBgSource === 'color'
                  ? 'bg-slate-600/20 text-slate-300'
                  : 'text-c-muted hover:text-c-text',
              )}
            >
              <Monitor className="w-3 h-3" />
              {t('storyboard.compBgColor')}
            </button>
            <button
              onClick={() => {
                setCompBgSource('pexels');
                saveProject({ compBgSource: 'pexels' });
              }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium transition-colors flex-1 justify-center',
                compBgSource === 'pexels'
                  ? 'bg-green-600/20 text-green-400'
                  : 'text-c-muted hover:text-c-text',
              )}
            >
              <Video className="w-3 h-3" />
              {t('storyboard.compBgPexels')}
            </button>
          </div>
          {compBgSource === 'pexels' && (
            <input
              type="text"
              value={compBgQuery}
              onChange={(e) => setCompBgQuery(e.target.value)}
              onBlur={() => saveProject({ compBgQuery })}
              placeholder={t('storyboard.compBgQueryPlaceholder')}
              className="input text-xs w-full"
            />
          )}
        </div>

        {/* ─── Section 5: Frame Template ─── */}
        <div className="px-4 py-3 space-y-2 bg-cyan-950/20">
          <div className="flex items-center gap-2">
            <Layout className="w-3 h-3 text-amber-400/60" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400/70">
              {t('storyboard.compFrameTemplate')}
            </span>
            <div className="flex-1" />
            {frameTemplateId && (
              <button
                onClick={() => { setFrameTemplateId(''); saveProject({ frameTemplateId: '' }); }}
                className="text-[9px] text-red-400 hover:text-red-300 flex items-center gap-0.5"
              >
                <X className="w-2.5 h-2.5" /> {t('storyboard.compFrameTemplateClear')}
              </button>
            )}
          </div>
          <p className="text-[10px] text-c-dim">{t('storyboard.compFrameTemplateDesc')}</p>

          {loadingFrames ? (
            <div className="flex items-center gap-2 text-[10px] text-c-dim"><Spinner size="sm" /> {t('common.loading')}</div>
          ) : frameTemplates.length === 0 ? (
            <div className="text-[10px] text-c-dim">{t('storyboard.compFrameTemplateEmpty')}</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {frameTemplates.map((ft) => {
                const isHtml = ft.mimeType === 'text/html';
                const previewUrl = isHtml
                  ? `/api/frame-video-library/view/${ft.id}`
                  : ft.url;
                const selected = frameTemplateId === ft.id;
                return (
                  <button
                    key={ft.id}
                    onClick={() => {
                      const next = selected ? '' : ft.id;
                      setFrameTemplateId(next);
                      saveProject({ frameTemplateId: next });
                    }}
                    className={clsx(
                      'relative rounded-lg border overflow-hidden transition-all text-left',
                      selected
                        ? 'border-amber-500 ring-1 ring-amber-500/50'
                        : 'border-c-border hover:border-amber-700/50',
                    )}
                  >
                    <div className="aspect-video bg-c-elevated overflow-hidden">
                      {isHtml ? (
                        <iframe
                          src={previewUrl}
                          className="w-full h-full pointer-events-none"
                          style={{ transform: 'scale(0.5)', transformOrigin: 'top left', width: '200%', height: '200%' }}
                          title={ft.name}
                        />
                      ) : (
                        <video src={previewUrl} muted className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="px-1.5 py-1 bg-c-surface">
                      <span className="text-[9px] text-c-text truncate block">{ft.name}</span>
                    </div>
                    {selected && (
                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
                        <span className="text-[8px] text-white font-bold">✓</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
