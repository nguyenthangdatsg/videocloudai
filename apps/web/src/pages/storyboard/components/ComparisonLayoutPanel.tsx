import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronUp, Wand2, User, Upload, RotateCcw, X, Maximize2, Monitor, Smartphone, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { Spinner } from '../../../components/ui/Spinner';
import { useStoryboard } from '../StoryboardContext';

/** Resolve mascot image value to a valid URL */
const mascotUrl = (v: string) => v.startsWith('/api/') ? v : `/api/image/file/${v}`;

type PanelRect = { x: number; y: number; w: number; h: number };
type LayoutData = { left: PanelRect; mascot: PanelRect; right: PanelRect };

const DEFAULT_LANDSCAPE: LayoutData = {
  left:   { x: 1, y: 1, w: 48, h: 55 },
  right:  { x: 51, y: 1, w: 48, h: 55 },
  mascot: { x: 25, y: 59, w: 50, h: 39 },
};
const DEFAULT_PORTRAIT: LayoutData = {
  left:   { x: 2, y: 2, w: 96, h: 33 },
  mascot: { x: 20, y: 37, w: 60, h: 26 },
  right:  { x: 2, y: 65, w: 96, h: 33 },
};

const GAP = 2; // gap between panels in %
type PanelKey = 'left' | 'mascot' | 'right';

export function ComparisonLayoutPanel() {
  const {
    t,
    isComparisonTemplate,
    mascotPrompt, setMascotPrompt,
    mascotImage, setMascotImage,
    mascotImageLeft, mascotImageRight,
    mascotImageBoth, mascotImageWin,
    comparisonItems, setComparisonItems,
    generatingMascot, handleGenerateMascot,
    mascotAngle, setMascotAngle,
    getMascotVariants, handleGenerateSingleMascotVariant, generatingMascotKey,
    aspectRatio, setAspectRatio,
    saveProject, setLightboxUrl,
    step,
  } = useStoryboard();

  const namesReady = !!(comparisonItems.left.name && comparisonItems.right.name);
  const shouldAutoExpand = !namesReady && (step === 'topics' || step === 'script');
  const [expanded, setExpanded] = useState(shouldAutoExpand);
  const [showLayout, setShowLayout] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const isPortrait = aspectRatio === '9:16';
  const defaultLayout = isPortrait ? DEFAULT_PORTRAIT : DEFAULT_LANDSCAPE;
  const rawLayout = comparisonItems.layout;
  const layout: LayoutData = (rawLayout?.left?.w && rawLayout?.mascot?.w && rawLayout?.right?.w) ? rawLayout as LayoutData : defaultLayout;

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const setLayout = useCallback((newLayout: LayoutData) => {
    setComparisonItems(prev => ({ ...prev, layout: newLayout }));
  }, [setComparisonItems]);

  const saveLayout = useCallback((newLayout: LayoutData) => {
    const next = { ...comparisonItems, layout: newLayout };
    setComparisonItems(next);
    saveProject({ comparisonItems: next });
  }, [comparisonItems, setComparisonItems, saveProject]);

  const resetLayout = useCallback(() => {
    const target = isPortrait ? DEFAULT_PORTRAIT : DEFAULT_LANDSCAPE;
    saveLayout({ ...target });
  }, [isPortrait, saveLayout]);

  // ── Divider drag handlers ──
  // Landscape: vDivider (between left/right), hDivider (between top row / mascot)
  // Portrait: hDivider1 (left/mascot boundary), hDivider2 (mascot/right boundary)
  const dragRef = useRef<{
    type: 'v' | 'h' | 'h1' | 'h2';
    startPos: number;
    startLayout: LayoutData;
  } | null>(null);

  const handleDividerDown = useCallback((type: 'v' | 'h' | 'h1' | 'h2') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type, startPos: type === 'v' ? e.clientX : e.clientY, startLayout: { ...layout } };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current || !canvasRef.current) return;
      const canvas = canvasRef.current.getBoundingClientRect();
      const sl = dragRef.current.startLayout;

      if (dragRef.current.type === 'v') {
        // Vertical divider — landscape mode
        const dx = ((ev.clientX - dragRef.current.startPos) / canvas.width) * 100;
        const newSplit = Math.max(20, Math.min(80, sl.left.w + dx));
        setLayout({
          left:   { x: sl.left.x, y: sl.left.y, w: newSplit - GAP / 2, h: sl.left.h },
          right:  { x: newSplit + GAP / 2, y: sl.right.y, w: 100 - newSplit - GAP / 2 - sl.right.x + sl.left.x, h: sl.right.h },
          mascot: sl.mascot,
        });
      } else if (dragRef.current.type === 'h') {
        // Horizontal divider — landscape mode (between top row and mascot)
        const dy = ((ev.clientY - dragRef.current.startPos) / canvas.height) * 100;
        const newH = Math.max(25, Math.min(80, sl.left.h + dy));
        setLayout({
          left:   { ...sl.left, h: newH },
          right:  { ...sl.right, h: newH },
          mascot: { ...sl.mascot, y: newH + GAP + sl.left.y, h: 100 - newH - GAP - sl.left.y - (100 - sl.mascot.y - sl.mascot.h) },
        });
      } else if (dragRef.current.type === 'h1') {
        // Portrait: divider between left and mascot
        const dy = ((ev.clientY - dragRef.current.startPos) / canvas.height) * 100;
        const newBottom = Math.max(15, Math.min(sl.mascot.y + sl.mascot.h - 10, sl.left.y + sl.left.h + dy));
        setLayout({
          left:   { ...sl.left, h: newBottom - sl.left.y },
          mascot: { ...sl.mascot, y: newBottom + GAP, h: sl.mascot.h - dy },
          right:  sl.right,
        });
      } else if (dragRef.current.type === 'h2') {
        // Portrait: divider between mascot and right
        const dy = ((ev.clientY - dragRef.current.startPos) / canvas.height) * 100;
        const newBottom = Math.max(sl.mascot.y + 10, Math.min(85, sl.mascot.y + sl.mascot.h + dy));
        setLayout({
          left:   sl.left,
          mascot: { ...sl.mascot, h: newBottom - sl.mascot.y },
          right:  { ...sl.right, y: newBottom + GAP, h: sl.right.h - dy },
        });
      }
    };

    const onUp = () => {
      if (canvasRef.current) {
        // Read current layout from state via the ref-stored value
        const el = canvasRef.current;
        // Save happens after state update
        setTimeout(() => {
          saveProject({ comparisonItems });
        }, 50);
      }
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [layout, comparisonItems, setLayout, saveProject]);

  // ── Panel drag (move individual panels freely) ──
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const handlePanelDrag = useCallback((panel: PanelKey) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = { ...layoutRef.current[panel] };

    const onMove = (ev: MouseEvent) => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current.getBoundingClientRect();
      const dx = ((ev.clientX - startX) / canvas.width) * 100;
      const dy = ((ev.clientY - startY) / canvas.height) * 100;
      const nx = Math.max(0, Math.min(100 - startRect.w, startRect.x + dx));
      const ny = Math.max(0, Math.min(100 - startRect.h, startRect.y + dy));
      setLayout({ ...layoutRef.current, [panel]: { ...startRect, x: nx, y: ny } });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => saveProject({ comparisonItems: { ...comparisonItems, layout: layoutRef.current } }), 50);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [comparisonItems, setLayout, saveProject]);

  // ── Panel resize (resize individual panels from corners/edges) ──
  const MIN_PANEL = 10; // minimum panel size in %
  const handlePanelResize = useCallback((panel: PanelKey, corner: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = { ...layoutRef.current[panel] };

    const onMove = (ev: MouseEvent) => {
      if (!canvasRef.current) return;
      const canvas = canvasRef.current.getBoundingClientRect();
      const dx = ((ev.clientX - startX) / canvas.width) * 100;
      const dy = ((ev.clientY - startY) / canvas.height) * 100;
      let { x, y, w, h } = startRect;

      if (corner.includes('e')) w = Math.max(MIN_PANEL, Math.min(100 - x, startRect.w + dx));
      if (corner.includes('w')) { const nw = Math.max(MIN_PANEL, startRect.w - dx); x = startRect.x + startRect.w - nw; w = nw; }
      if (corner.includes('s')) h = Math.max(MIN_PANEL, Math.min(100 - y, startRect.h + dy));
      if (corner.includes('n')) { const nh = Math.max(MIN_PANEL, startRect.h - dy); y = startRect.y + startRect.h - nh; h = nh; }

      x = Math.max(0, x);
      y = Math.max(0, y);
      setLayout({ ...layoutRef.current, [panel]: { x, y, w, h } });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => saveProject({ comparisonItems: { ...comparisonItems, layout: layoutRef.current } }), 50);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [comparisonItems, setLayout, saveProject]);

  if (!isComparisonTemplate) return null;

  const leftName = comparisonItems.left.name || '';
  const rightName = comparisonItems.right.name || '';
  const hasMascot = !!(mascotImage || mascotImageLeft || mascotImageRight || mascotImageBoth || mascotImageWin);
  const compType = comparisonItems.type || 'difference';

  const mascotVariants = [
    { img: mascotImageLeft, label: 'L', color: 'blue' },
    { img: mascotImage, label: 'N', color: 'gray' },
    { img: mascotImageBoth, label: 'B', color: 'purple' },
    { img: mascotImageRight, label: 'R', color: 'orange' },
    { img: mascotImageWin, label: 'W', color: 'yellow' },
  ].filter(v => v.img);

  // ── YouTube-framed layout preview ──
  const renderYouTubePreview = (size: 'normal' | 'fullscreen') => {
    const isFS = size === 'fullscreen';
    return (
      <div className={clsx('flex flex-col rounded-xl overflow-hidden border border-c-border shadow-xl', isFS ? 'w-full max-w-5xl' : 'w-full max-w-[420px]')}>
        {/* YouTube player area */}
        <div className="relative bg-black" style={{ aspectRatio: isPortrait ? '9/16' : '16/9' }}>
          {/* Canvas */}
          <div ref={canvasRef} className="absolute inset-0">
            {/* Panels */}
            {(['left', 'mascot', 'right'] as PanelKey[]).map(key => {
              const rect = layout[key];
              const panelImg = key === 'left' ? null : key === 'right' ? null : mascotImage;
              return (
                <div
                  key={key}
                  className={clsx(
                    'absolute rounded-sm overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing',
                    key === 'left' && 'bg-blue-900/30 border border-blue-500/40 hover:border-blue-400/70',
                    key === 'right' && 'bg-orange-900/30 border border-orange-500/40 hover:border-orange-400/70',
                    key === 'mascot' && 'bg-purple-900/20 border border-purple-500/30 hover:border-purple-400/70',
                  )}
                  style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }}
                  onMouseDown={handlePanelDrag(key)}
                >
                  {panelImg && (
                    <img src={mascotUrl(panelImg)} alt="" className="absolute inset-0 w-full h-full object-contain opacity-50 pointer-events-none" />
                  )}
                  <span className={clsx(
                    'text-[10px] font-bold uppercase z-10 px-1.5 py-0.5 rounded bg-black/40 backdrop-blur-sm pointer-events-none',
                    key === 'left' && 'text-blue-300',
                    key === 'right' && 'text-orange-300',
                    key === 'mascot' && 'text-purple-300',
                  )}>
                    {key === 'left' ? (leftName || 'LEFT') : key === 'right' ? (rightName || 'RIGHT') : 'MASCOT'}
                  </span>
                  {/* Resize handles — 4 corners + 4 edges */}
                  {/* Corners */}
                  <div onMouseDown={handlePanelResize(key, 'nw')} className="absolute top-0 left-0 w-2.5 h-2.5 cursor-nw-resize z-10 group/h">
                    <div className="absolute top-0 left-0 w-1.5 h-1.5 rounded-br bg-cyan-400/50 group-hover/h:bg-cyan-400" />
                  </div>
                  <div onMouseDown={handlePanelResize(key, 'ne')} className="absolute top-0 right-0 w-2.5 h-2.5 cursor-ne-resize z-10 group/h">
                    <div className="absolute top-0 right-0 w-1.5 h-1.5 rounded-bl bg-cyan-400/50 group-hover/h:bg-cyan-400" />
                  </div>
                  <div onMouseDown={handlePanelResize(key, 'sw')} className="absolute bottom-0 left-0 w-2.5 h-2.5 cursor-sw-resize z-10 group/h">
                    <div className="absolute bottom-0 left-0 w-1.5 h-1.5 rounded-tr bg-cyan-400/50 group-hover/h:bg-cyan-400" />
                  </div>
                  <div onMouseDown={handlePanelResize(key, 'se')} className="absolute bottom-0 right-0 w-2.5 h-2.5 cursor-se-resize z-10 group/h">
                    <div className="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-tl bg-cyan-400/50 group-hover/h:bg-cyan-400" />
                  </div>
                  {/* Edge handles */}
                  <div onMouseDown={handlePanelResize(key, 'n')} className="absolute top-0 left-2.5 right-2.5 h-1.5 cursor-n-resize z-10" />
                  <div onMouseDown={handlePanelResize(key, 's')} className="absolute bottom-0 left-2.5 right-2.5 h-1.5 cursor-s-resize z-10" />
                  <div onMouseDown={handlePanelResize(key, 'w')} className="absolute left-0 top-2.5 bottom-2.5 w-1.5 cursor-w-resize z-10" />
                  <div onMouseDown={handlePanelResize(key, 'e')} className="absolute right-0 top-2.5 bottom-2.5 w-1.5 cursor-e-resize z-10" />
                </div>
              );
            })}

            {/* Draggable dividers */}
            {isPortrait ? (
              <>
                {/* h1: between left and mascot */}
                <div
                  className="absolute left-0 right-0 cursor-row-resize group z-20"
                  style={{ top: `${layout.left.y + layout.left.h}%`, height: `${GAP + 2}%`, transform: 'translateY(-50%)' }}
                  onMouseDown={handleDividerDown('h1')}
                >
                  <div className="absolute left-[10%] right-[10%] top-1/2 -translate-y-1/2 h-[2px] bg-cyan-500/40 group-hover:bg-cyan-400/80 transition-colors rounded-full" />
                  <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-8 h-3 bg-cyan-500/30 group-hover:bg-cyan-400/60 rounded-full flex items-center justify-center transition-colors">
                    <div className="w-4 h-[2px] bg-cyan-300/60 rounded-full" />
                  </div>
                </div>
                {/* h2: between mascot and right */}
                <div
                  className="absolute left-0 right-0 cursor-row-resize group z-20"
                  style={{ top: `${layout.mascot.y + layout.mascot.h}%`, height: `${GAP + 2}%`, transform: 'translateY(-50%)' }}
                  onMouseDown={handleDividerDown('h2')}
                >
                  <div className="absolute left-[10%] right-[10%] top-1/2 -translate-y-1/2 h-[2px] bg-cyan-500/40 group-hover:bg-cyan-400/80 transition-colors rounded-full" />
                  <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-8 h-3 bg-cyan-500/30 group-hover:bg-cyan-400/60 rounded-full flex items-center justify-center transition-colors">
                    <div className="w-4 h-[2px] bg-cyan-300/60 rounded-full" />
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Vertical divider between left and right */}
                <div
                  className="absolute top-0 cursor-col-resize group z-20"
                  style={{
                    left: `${layout.left.x + layout.left.w}%`,
                    width: `${GAP + 2}%`,
                    height: `${layout.left.h + layout.left.y}%`,
                    transform: 'translateX(-50%)',
                  }}
                  onMouseDown={handleDividerDown('v')}
                >
                  <div className="absolute top-[10%] bottom-[10%] left-1/2 -translate-x-1/2 w-[2px] bg-cyan-500/40 group-hover:bg-cyan-400/80 transition-colors rounded-full" />
                  <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-8 w-3 bg-cyan-500/30 group-hover:bg-cyan-400/60 rounded-full flex items-center justify-center transition-colors">
                    <div className="h-4 w-[2px] bg-cyan-300/60 rounded-full" />
                  </div>
                </div>
                {/* Horizontal divider between top row and mascot */}
                <div
                  className="absolute left-0 right-0 cursor-row-resize group z-20"
                  style={{ top: `${layout.left.y + layout.left.h}%`, height: `${GAP + 2}%`, transform: 'translateY(-50%)' }}
                  onMouseDown={handleDividerDown('h')}
                >
                  <div className="absolute left-[10%] right-[10%] top-1/2 -translate-y-1/2 h-[2px] bg-cyan-500/40 group-hover:bg-cyan-400/80 transition-colors rounded-full" />
                  <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-8 h-3 bg-cyan-500/30 group-hover:bg-cyan-400/60 rounded-full flex items-center justify-center transition-colors">
                    <div className="w-4 h-[2px] bg-cyan-300/60 rounded-full" />
                  </div>
                </div>
              </>
            )}

            {/* Overlay buttons (top-right) */}
            <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-30">
              <button
                onClick={resetLayout}
                className="p-1 rounded bg-black/50 hover:bg-black/80 text-white/60 hover:text-white transition-colors backdrop-blur-sm"
                title="Reset layout"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <button
                onClick={() => setFullscreen(true)}
                className="p-1 rounded bg-black/50 hover:bg-black/80 text-white/60 hover:text-white transition-colors backdrop-blur-sm"
                title="Fullscreen"
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            </div>

            {/* Aspect ratio badge (top-left) */}
            <div className="absolute top-1.5 left-1.5 z-30">
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/50 text-white/50 backdrop-blur-sm font-mono">
                {aspectRatio}
              </span>
            </div>
          </div>
        </div>

        {/* YouTube bottom chrome */}
        <div className="bg-[#0f0f0f] px-3 py-2 space-y-1.5">
          {/* Progress bar */}
          <div className="relative h-[3px] bg-white/10 rounded-full overflow-hidden">
            <div className="absolute left-0 top-0 h-full w-[35%] bg-red-600 rounded-full" />
          </div>
          {/* Info row */}
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-white/90 font-medium truncate">
                {leftName && rightName ? `${leftName} vs ${rightName}` : t('storyboard.comparisonLayout')}
              </div>
              <div className="text-[9px] text-white/40">Comparison Video</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Fullscreen layout editor ──
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-c-border bg-c-bg/80 backdrop-blur shrink-0">
          <span className="text-sm font-medium text-cyan-300">{t('storyboard.comparisonLayout')}</span>
          <span className="text-[10px] text-c-dim">{t('storyboard.dragToResize')}</span>
          <button onClick={() => setFullscreen(false)} className="ml-auto p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          {renderYouTubePreview('fullscreen')}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-cyan-800/30 rounded-xl bg-cyan-900/5 overflow-hidden">
      {/* Summary bar (always visible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-cyan-900/10 transition-colors"
      >
        {/* Left name */}
        <span className={clsx(
          'text-[10px] font-bold px-2 py-0.5 rounded',
          leftName ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-500/10 text-blue-300/50',
        )}>
          {leftName || t('storyboard.comparisonLeft')}
        </span>

        <span className="text-[10px] text-c-dim font-medium">vs</span>

        {/* Right name */}
        <span className={clsx(
          'text-[10px] font-bold px-2 py-0.5 rounded',
          rightName ? 'bg-orange-500/20 text-orange-300' : 'bg-orange-500/10 text-orange-300/50',
        )}>
          {rightName || t('storyboard.comparisonRight')}
        </span>

        {/* Mascot mini preview */}
        {hasMascot ? (
          <div className="flex items-center gap-0.5 ml-1">
            {mascotVariants.slice(0, 3).map(({ img, label, color }) => (
              <img key={label} src={mascotUrl(img)} alt={label} className={`w-4 h-6 object-contain rounded border border-${color}-500/30`} />
            ))}
            {mascotVariants.length > 3 && <span className="text-[8px] text-c-dim">+{mascotVariants.length - 3}</span>}
            {mascotPrompt && <span className="text-[9px] text-c-dim truncate max-w-[120px]" title={mascotPrompt}>{mascotPrompt}</span>}
          </div>
        ) : (
          <span className="text-[9px] text-c-dim italic ml-1">{t('storyboard.noMascot')}</span>
        )}

        {/* Setup needed hint */}
        {!namesReady && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 animate-pulse">
            {t('storyboard.setupNeeded')}
          </span>
        )}

        {/* Type badge */}
        <span className={clsx(
          'text-[9px] px-1.5 py-0.5 rounded ml-auto',
          compType === 'winner' ? 'bg-amber-500/20 text-amber-300' : 'bg-cyan-500/20 text-cyan-300',
        )}>
          {compType === 'winner' ? t('storyboard.comparisonTypeWinner') : t('storyboard.comparisonTypeDifference')}
        </span>

        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-c-dim" /> : <ChevronDown className="w-3.5 h-3.5 text-c-dim" />}
      </button>

      {/* Mascot prompt — always visible for quick editing */}
      <div className="flex gap-2 px-3 py-2 border-t border-cyan-800/15">
        <User className="w-3.5 h-3.5 text-c-muted shrink-0 mt-1.5" />
        <input
          type="text"
          value={mascotPrompt}
          onChange={(e) => setMascotPrompt(e.target.value)}
          onBlur={() => saveProject({ mascotPrompt })}
          placeholder={t('storyboard.mascotPromptPlaceholder')}
          className="input text-xs flex-1"
        />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[9px] text-c-dim">Angle:</span>
          <input
            type="text"
            value={mascotAngle}
            onChange={(e) => setMascotAngle(e.target.value)}
            className="input text-xs w-14 text-center"
            placeholder="70-75"
          />
          <span className="text-[9px] text-c-dim">deg</span>
        </div>
        <button
          onClick={handleGenerateMascot}
          disabled={!mascotPrompt.trim() || generatingMascot}
          className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50 shrink-0"
        >
          {generatingMascot ? <Spinner size="sm" /> : <Wand2 className="w-3 h-3" />}
          {t('storyboard.generateMascot')}
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-cyan-800/20">
          {/* Row 1: Left vs Right names */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="text-[10px] uppercase text-blue-400 font-bold tracking-wider mb-1 block">
                {t('storyboard.comparisonLeft')}
              </label>
              <input
                type="text"
                value={leftName}
                onChange={(e) => setComparisonItems(prev => ({ ...prev, left: { ...prev.left, name: e.target.value } }))}
                onBlur={() => saveProject({ comparisonItems })}
                placeholder={t('storyboard.comparisonLeftPlaceholder')}
                className="input text-sm w-full"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-orange-400 font-bold tracking-wider mb-1 block">
                {t('storyboard.comparisonRight')}
              </label>
              <input
                type="text"
                value={rightName}
                onChange={(e) => setComparisonItems(prev => ({ ...prev, right: { ...prev.right, name: e.target.value } }))}
                onBlur={() => saveProject({ comparisonItems })}
                placeholder={t('storyboard.comparisonRightPlaceholder')}
                className="input text-sm w-full"
              />
            </div>
          </div>

          {/* Row 2: Type + Aspect ratio (compact) */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-c-muted">{t('storyboard.comparisonType')}:</span>
              <div className="flex rounded-lg border border-c-border overflow-hidden">
                <button
                  onClick={() => { const next = { ...comparisonItems, type: 'difference' as const }; setComparisonItems(next); saveProject({ comparisonItems: next }); }}
                  className={clsx('px-2.5 py-1 text-[10px] font-medium transition-colors', compType === 'difference' ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text')}
                >
                  {t('storyboard.comparisonTypeDifference')}
                </button>
                <button
                  onClick={() => { const next = { ...comparisonItems, type: 'winner' as const }; setComparisonItems(next); saveProject({ comparisonItems: next }); }}
                  className={clsx('px-2.5 py-1 text-[10px] font-medium transition-colors', compType === 'winner' ? 'bg-amber-600/20 text-amber-400' : 'text-c-muted hover:text-c-text')}
                >
                  {t('storyboard.comparisonTypeWinner')}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-c-muted">{t('image.aspectRatio')}:</span>
              <div className="flex rounded-lg border border-c-border overflow-hidden">
                <button
                  onClick={() => { setAspectRatio('16:9'); const next = { ...comparisonItems, layout: { ...DEFAULT_LANDSCAPE } }; setComparisonItems(next); saveProject({ comparisonItems: next }); }}
                  className={clsx('px-2 py-1 text-[10px] font-medium transition-colors flex items-center gap-1', aspectRatio === '16:9' ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text')}
                >
                  <Monitor className="w-3 h-3" /> 16:9
                </button>
                <button
                  onClick={() => { setAspectRatio('9:16'); const next = { ...comparisonItems, layout: { ...DEFAULT_PORTRAIT } }; setComparisonItems(next); saveProject({ comparisonItems: next }); }}
                  className={clsx('px-2 py-1 text-[10px] font-medium transition-colors flex items-center gap-1', aspectRatio === '9:16' ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text')}
                >
                  <Smartphone className="w-3 h-3" /> 9:16
                </button>
              </div>
            </div>
          </div>

          {/* Row 3: Per-variant mascot prompts with individual regenerate */}
          <MascotVariantEditor
            mascotPrompt={mascotPrompt}
            getMascotVariants={getMascotVariants}
            handleGenerateSingleMascotVariant={handleGenerateSingleMascotVariant}
            generatingMascotKey={generatingMascotKey}
            setLightboxUrl={setLightboxUrl}
          />

          {/* Row 4: Layout preview with YouTube frame */}
          <div>
            <button
              onClick={() => setShowLayout(!showLayout)}
              className="flex items-center gap-1.5 text-[10px] text-c-muted hover:text-cyan-400 transition-colors"
            >
              {showLayout ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {t('storyboard.comparisonLayout')}
              <span className="text-[9px] text-c-dim">{t('storyboard.dragToResize')}</span>
            </button>

            {showLayout && (
              <div className="mt-2 flex justify-center">
                {renderYouTubePreview('normal')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Per-variant mascot prompt editor with individual regenerate */
function MascotVariantEditor({
  mascotPrompt,
  getMascotVariants,
  handleGenerateSingleMascotVariant,
  generatingMascotKey,
  setLightboxUrl,
}: {
  mascotPrompt: string;
  getMascotVariants: () => Array<{ key: string; label: string; suffix: string; image: string }>;
  handleGenerateSingleMascotVariant: (key: string, prompt: string) => Promise<void>;
  generatingMascotKey: string | null;
  setLightboxUrl: (url: string) => void;
}) {
  const variants = getMascotVariants();
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({});

  // Initialize edited prompts from base + suffix when mascotPrompt changes
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const v of variants) {
      init[v.key] = mascotPrompt + v.suffix;
    }
    setEditedPrompts(init);
  }, [mascotPrompt, variants.map(v => v.suffix).join('|')]);

  const COLORS: Record<string, { border: string; bg: string; text: string }> = {
    none: { border: 'border-gray-500/40', bg: 'bg-gray-500/10', text: 'text-gray-400' },
    left: { border: 'border-blue-500/40', bg: 'bg-blue-500/10', text: 'text-blue-400' },
    right: { border: 'border-orange-500/40', bg: 'bg-orange-500/10', text: 'text-orange-400' },
    both: { border: 'border-purple-500/40', bg: 'bg-purple-500/10', text: 'text-purple-400' },
    win: { border: 'border-yellow-500/40', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] uppercase text-c-muted font-bold tracking-wider flex items-center gap-1.5">
        <User className="w-3 h-3" />
        Mascot Variants
      </label>
      <div className="space-y-1.5">
        {variants.map(v => {
          const c = COLORS[v.key] || COLORS.none;
          const isGenerating = generatingMascotKey === v.key;
          return (
            <div key={v.key} className={clsx('flex items-start gap-2 p-1.5 rounded-lg border', c.border, c.bg)}>
              {/* Thumbnail */}
              <div className="shrink-0 w-8 flex flex-col items-center gap-0.5">
                {v.image ? (
                  <img
                    src={mascotUrl(v.image)}
                    alt={v.label}
                    className={clsx('w-8 h-12 object-contain rounded cursor-pointer border', c.border, 'hover:opacity-80')}
                    onClick={() => setLightboxUrl(mascotUrl(v.image))}
                  />
                ) : (
                  <div className={clsx('w-8 h-12 rounded border flex items-center justify-center', c.border)}>
                    <span className="text-[8px] text-c-dim">none</span>
                  </div>
                )}
                <span className={clsx('text-[8px] font-bold', c.text)}>{v.label}</span>
              </div>
              {/* Editable prompt */}
              <textarea
                value={editedPrompts[v.key] || ''}
                onChange={(e) => setEditedPrompts(prev => ({ ...prev, [v.key]: e.target.value }))}
                className="input text-[10px] flex-1 resize-none leading-tight"
                rows={2}
              />
              {/* Regenerate button */}
              <button
                onClick={() => handleGenerateSingleMascotVariant(v.key, editedPrompts[v.key] || '')}
                disabled={isGenerating || !editedPrompts[v.key]?.trim()}
                className="btn-secondary text-[10px] px-1.5 py-1 shrink-0 disabled:opacity-50 flex items-center gap-0.5"
                title={`Regenerate ${v.label}`}
              >
                {isGenerating ? <Spinner size="sm" /> : <RefreshCw className="w-3 h-3" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
