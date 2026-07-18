import { useState, useMemo } from 'react';
import { Wand2, ArrowRight, Trash2, Copy, Download, Pencil, Merge, Scissors, RefreshCw, Square } from 'lucide-react';
import { clsx } from 'clsx';
import { Spinner } from '../../../../components/ui/Spinner';
import { StagePromptEditor } from '../../components/StagePromptEditor';
import { useStoryboard } from '../../StoryboardContext';
import { tsToSec } from '../../utils';

export function ComparisonPromptsStep() {
  const ctx = useStoryboard();
  const {
    t, projectName,
    templateStageParts, setTemplateStageParts,
    imagePromptPrompt, setImagePromptPrompt,
    savingPrompt, savedPromptStage, handleSaveStagePrompt,
    prompts, setPrompts, generatingPrompts, promptProgress,
    editingPromptIdx, setEditingPromptIdx,
    handleGeneratePrompts, handleStopPrompts, handleRegenPrompt, regenPromptIdx, regenQueueRef, promptLogRef,
    transcriptEntries, aspectRatio, setAspectRatio,
    handleMergeEntry, handleSplitAtCursor, handleUpdateEntryText,
    handleSplitEntry,
    setStep, saveProject,
    comparisonItems,
  } = ctx;

  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Build timestamp-based mapping between segments and prompts
  const segToPromptIdx = useMemo(() => {
    const map = new Map<number, number>();
    prompts.forEach((p, pi) => {
      const pSec = tsToSec(p.timestamp);
      transcriptEntries.forEach((e, si) => {
        const eSec = Math.floor(e.startMs / 1000);
        const eMin = Math.floor(eSec / 60);
        const eSec2 = eSec % 60;
        const eTs = `${String(eMin).padStart(2, '0')}:${String(eSec2).padStart(2, '0')}`;
        if (tsToSec(eTs) === pSec && !map.has(si)) {
          map.set(si, pi);
        }
      });
    });
    return map;
  }, [transcriptEntries, prompts]);

  const promptToSegIdx = useMemo(() => {
    const map = new Map<number, number>();
    segToPromptIdx.forEach((pi, si) => { if (!map.has(pi)) map.set(pi, si); });
    return map;
  }, [segToPromptIdx]);

  const scrollToEl = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const container = el.closest('.overflow-auto');
    if (container) {
      const top = el.offsetTop - container.getBoundingClientRect().height / 2;
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-cyan-400/50');
    setTimeout(() => el.classList.remove('ring-2', 'ring-cyan-400/50'), 1500);
  };

  const isWinnerMode = comparisonItems.type === 'winner';

  // Side stats
  const sideStats = useMemo(() => {
    const left = prompts.filter(p => p.side === 'left').length;
    const right = prompts.filter(p => p.side === 'right').length;
    const both = prompts.filter(p => p.side === 'both').length;
    const winLeft = prompts.filter(p => p.side === 'win-left').length;
    const winRight = prompts.filter(p => p.side === 'win-right').length;
    return { left, right, both, winLeft, winRight };
  }, [prompts]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-cyan-400" />
          {t('storyboard.stepPrompts')} ({prompts.length})
        </h3>
        <div className="flex gap-2">
          {prompts.length > 0 && (
            <>
              {/* Side stats badge */}
              <div className="flex items-center gap-1 text-[9px] mr-2">
                <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">◀ {sideStats.left}</span>
                <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">◀▶ {sideStats.both}</span>
                <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300">{sideStats.right} ▶</span>
                {isWinnerMode && (sideStats.winLeft > 0 || sideStats.winRight > 0) && (
                  <>
                    <span className="text-c-dim">|</span>
                    {sideStats.winLeft > 0 && <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">🏆◀ {sideStats.winLeft}</span>}
                    {sideStats.winRight > 0 && <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">{sideStats.winRight} ▶🏆</span>}
                  </>
                )}
              </div>
              <button
                onClick={() => { setPrompts([]); saveProject({ prompts: [] }); }}
                className="btn-secondary text-xs flex items-center gap-1 text-red-400 hover:text-red-300"
                title={t('storyboard.clearPrompts')}
              >
                <Trash2 className="w-3 h-3" />
                {t('storyboard.clearPrompts')}
              </button>
              <button
                onClick={() => {
                  const lines = prompts.map((p) => `[${p.timestamp}] [${p.side || 'both'}] ${p.prompt}`).join('\n\n');
                  navigator.clipboard.writeText(lines);
                  setCopiedField('prompts-text');
                  setTimeout(() => setCopiedField(null), 2000);
                }}
                className="btn-secondary text-xs flex items-center gap-1"
                title={t('storyboard.exportPromptsText')}
              >
                <Copy className="w-3 h-3" />
                {copiedField === 'prompts-text' ? t('storyboard.copied') : t('storyboard.exportPromptsText')}
              </button>
              <button
                onClick={() => {
                  const data = {
                    projectName,
                    totalPrompts: prompts.length,
                    prompts: prompts.map((p, i) => ({ index: i + 1, timestamp: p.timestamp, side: p.side, narration: p.text, imagePrompt: p.prompt })),
                  };
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${(projectName || 'prompts').replace(/\s+/g, '_')}_prompts.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="btn-secondary text-xs flex items-center gap-1"
                title={t('storyboard.exportPromptsJSON')}
              >
                <Download className="w-3 h-3" />
                JSON
              </button>
              <button
                onClick={() => { setStep('images'); saveProject({ currentStep: 'images' }); }}
                className="btn-primary text-xs flex items-center gap-1"
              >
                {t('storyboard.generateImages')} <ArrowRight className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>

      <StagePromptEditor
        label={`Stage 3: ${t('storyboard.stepPrompts')} — ${t('storyboard.stagePrompt')}`}
        stageParts={templateStageParts.prompts}
        value={imagePromptPrompt}
        onChange={setImagePromptPrompt}
        onPartsChange={(parts) => setTemplateStageParts(p => ({ ...p, prompts: parts }))}
        onSave={() => handleSaveStagePrompt('prompts', imagePromptPrompt)}
        saving={savingPrompt === 'prompts'}
        saved={savedPromptStage === 'prompts'}
        t={t}
      />

      {/* Transcript segments */}
      {transcriptEntries.length > 0 && (
        <div className="border border-c-border rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-c-border bg-c-surface flex items-center justify-between">
            <span className="text-xs font-medium text-c-text">{t('storyboard.transcriptPreview')} ({transcriptEntries.length})</span>
          </div>
          <div className="max-h-[300px] overflow-auto divide-y divide-c-border">
            {transcriptEntries.map((e, idx) => {
              const dur = Math.round((e.endMs - e.startMs) / 1000);
              const durColor = dur <= 1 ? 'text-red-400' : dur <= 2 ? 'text-orange-400' : dur < 3 ? 'text-yellow-400' : 'text-c-dim';
              const rowBg = dur <= 1 ? 'bg-red-900/15' : dur <= 2 ? 'bg-orange-900/10' : dur < 3 ? 'bg-yellow-900/10' : '';
              return (
                <div key={`${e.startMs}-${e.endMs}-${idx}`} id={`seg-${idx}`} className={clsx('px-3 py-1 flex gap-2 items-center transition-all', rowBg)}>
                  <span
                    className={clsx('text-[9px] font-mono shrink-0 w-5 text-right', segToPromptIdx.has(idx) ? 'text-violet-400 cursor-pointer hover:text-violet-300' : 'text-c-dim')}
                    onClick={() => { const pi = segToPromptIdx.get(idx); if (pi !== undefined) scrollToEl(`prompt-${pi}`); }}
                    title={segToPromptIdx.has(idx) ? `→ Prompt #${(segToPromptIdx.get(idx) ?? 0) + 1}` : undefined}
                  >{idx + 1}</span>
                  <span className="text-[9px] font-mono text-cyan-300/70 shrink-0 w-20">{e.startTime.split(',')[0]} &rarr; {e.endTime.split(',')[0]}</span>
                  <span className={clsx('text-[9px] font-mono shrink-0 w-8 text-right font-bold', durColor)}>{dur}s</span>
                  <input
                    type="text"
                    defaultValue={e.text}
                    onBlur={(ev) => {
                      const val = ev.target.value.trim();
                      if (val && val !== e.text) handleUpdateEntryText(e.index, val);
                    }}
                    onKeyDown={(ev) => {
                      const pos = ev.currentTarget.selectionStart ?? 0;
                      const len = ev.currentTarget.value.length;
                      if (ev.key === 'Enter') {
                        ev.preventDefault();
                        if (pos > 0 && pos < len) handleSplitAtCursor(e.index, pos, ev.currentTarget.value);
                      }
                      if (ev.key === 'Backspace' && pos === 0 && ev.currentTarget.selectionEnd === 0 && idx > 0) {
                        ev.preventDefault();
                        handleMergeEntry(e.index, 'prev');
                      }
                    }}
                    className="flex-1 text-xs text-c-muted bg-transparent border-none outline-none focus:text-c-text px-1 py-0.5 rounded hover:bg-c-elevated/50 focus:bg-c-elevated transition-colors"
                  />
                  <div className="flex gap-0.5 items-center shrink-0">
                    {idx > 0 && (
                      <button onClick={() => handleMergeEntry(e.index, 'prev')} className="p-0.5 rounded text-c-dim hover:text-amber-400 hover:bg-amber-900/20 transition-colors" title={t('storyboard.mergeWithPrev')}>
                        <Merge className="w-3 h-3 -rotate-90" />
                      </button>
                    )}
                    {idx < transcriptEntries.length - 1 && (
                      <button onClick={() => handleMergeEntry(e.index, 'next')} className="p-0.5 rounded text-c-dim hover:text-amber-400 hover:bg-amber-900/20 transition-colors" title={t('storyboard.mergeWithNext')}>
                        <Merge className="w-3 h-3 rotate-90" />
                      </button>
                    )}
                    {dur > 3 && (
                      <select
                        onChange={(ev) => { const val = parseInt(ev.target.value); if (val) handleSplitEntry(e.index, val); ev.target.value = ''; }}
                        className="text-[9px] py-0 px-0.5 bg-transparent border border-c-border rounded h-5 text-c-dim hover:text-c-text cursor-pointer appearance-none w-6 text-center"
                        defaultValue=""
                        title="Split segment"
                      >
                        <option value="" disabled>&#9986;</option>
                        {[2, 3, 4, 5].filter(s => s < dur).map(s => (
                          <option key={s} value={s}>{s}s</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Generate controls */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-c-muted">{t('image.aspectRatio')}:</label>
          <div className="flex rounded-lg border border-c-border overflow-hidden">
            {(['16:9', '9:16', '1:1'] as const).map(ar => (
              <button
                key={ar}
                onClick={() => setAspectRatio(ar)}
                className={clsx(
                  'px-2.5 py-1 text-xs font-medium transition-colors',
                  aspectRatio === ar ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text',
                )}
              >
                {ar}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={handleGeneratePrompts}
          disabled={!transcriptEntries.length || generatingPrompts}
          className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
        >
          {generatingPrompts ? <Spinner size="sm" /> : <Wand2 className="w-3.5 h-3.5" />}
          {generatingPrompts ? t('storyboard.generatingPrompts') : t('storyboard.generatePrompts')}
        </button>
        {generatingPrompts && (
          <button
            onClick={handleStopPrompts}
            className="btn-secondary text-xs flex items-center gap-1.5 text-red-400 hover:text-red-300 border-red-800/50 hover:border-red-700/50"
          >
            <Square className="w-3 h-3 fill-current" />
            {t('storyboard.stopGeneration')}
          </button>
        )}
      </div>

      {/* Progress log */}
      {promptProgress.length > 0 && generatingPrompts && (
        <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10">
          <div className="flex items-center gap-2 mb-1">
            <Spinner size="sm" />
            <span className="text-xs text-cyan-300">{t('storyboard.generatingPrompts')}</span>
          </div>
          <div ref={promptLogRef} className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[120px] overflow-auto">
            {promptProgress.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      )}

      {/* Prompt cards with side badges */}
      {prompts.length > 0 && (
        <div className="space-y-3">
          {prompts.map((p, i) => (
            <div key={i} id={`prompt-${i}`} className="border border-violet-800/30 rounded-xl bg-c-surface overflow-hidden transition-all">
              <div className="px-3 py-2 border-b border-c-border bg-violet-900/10 flex items-center gap-2">
                <span
                  className={clsx('text-[10px] font-bold text-violet-400 bg-violet-900/30 rounded-full w-5 h-5 flex items-center justify-center shrink-0', promptToSegIdx.has(i) && 'cursor-pointer hover:bg-violet-800/50')}
                  onClick={() => { const si = promptToSegIdx.get(i); if (si !== undefined) scrollToEl(`seg-${si}`); }}
                  title={promptToSegIdx.has(i) ? `→ Segment #${(promptToSegIdx.get(i) ?? 0) + 1}` : undefined}
                >{i + 1}</span>
                <span className="text-[10px] font-mono text-cyan-300/70">[{p.timestamp}]</span>
                {/* Side badge — click to cycle */}
                {p.side && (
                  <button
                    onClick={() => {
                      type Side = 'left' | 'right' | 'both' | 'win-left' | 'win-right';
                      const sides: Side[] = isWinnerMode
                        ? ['left', 'right', 'both', 'win-left', 'win-right']
                        : ['left', 'right', 'both'];
                      const idx = sides.indexOf(p.side as Side);
                      const nextSide = sides[(idx + 1) % sides.length];
                      const updated = prompts.map((pp, j) => j === i ? { ...pp, side: nextSide } : pp);
                      setPrompts(updated);
                      saveProject({ prompts: updated });
                    }}
                    className={clsx(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded cursor-pointer',
                      p.side === 'left' && 'bg-blue-500/20 text-blue-300',
                      p.side === 'right' && 'bg-orange-500/20 text-orange-300',
                      p.side === 'both' && 'bg-purple-500/20 text-purple-300',
                      p.side === 'win-left' && 'bg-yellow-500/20 text-yellow-300',
                      p.side === 'win-right' && 'bg-yellow-500/20 text-yellow-300',
                    )}
                    title={t('storyboard.clickToChangeSide')}
                  >
                    {p.side === 'left' ? `◀ ${comparisonItems.left.name || 'L'}`
                      : p.side === 'right' ? `${comparisonItems.right.name || 'R'} ▶`
                      : p.side === 'win-left' ? `🏆 ${comparisonItems.left.name || 'L'}`
                      : p.side === 'win-right' ? `${comparisonItems.right.name || 'R'} 🏆`
                      : '◀▶'}
                  </button>
                )}
                <span className="text-[10px] text-c-dim italic truncate flex-1">{p.text}</span>
                {p.model && <span className="text-[9px] font-mono text-emerald-400/60 shrink-0">{p.model}</span>}
                <div className="ml-auto flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => handleRegenPrompt(i)}
                    disabled={regenPromptIdx === i}
                    className={clsx(
                      'p-1 shrink-0 transition-colors',
                      regenPromptIdx === i ? 'text-amber-400' : regenQueueRef.current.includes(i) ? 'text-amber-300/50' : 'text-c-muted hover:text-amber-400',
                    )}
                    title={regenPromptIdx === i ? t('storyboard.regenerating') : regenQueueRef.current.includes(i) ? t('storyboard.queued') : t('storyboard.regenPrompt')}
                  >
                    {regenPromptIdx === i ? <Spinner size="sm" /> : <RefreshCw className={clsx('w-3 h-3', regenQueueRef.current.includes(i) && 'animate-pulse')} />}
                  </button>
                  <button
                    onClick={() => {
                      if (editingPromptIdx === i) {
                        setEditingPromptIdx(null);
                        saveProject({ prompts });
                      } else {
                        setEditingPromptIdx(i);
                      }
                    }}
                    className="p-1 text-c-muted hover:text-cyan-400 shrink-0"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="p-3">
                {editingPromptIdx === i ? (
                  <textarea
                    value={p.prompt}
                    onChange={(e) => setPrompts((prev) => prev.map((pp, j) => j === i ? { ...pp, prompt: e.target.value } : pp))}
                    onBlur={(e) => {
                      setEditingPromptIdx(null);
                      const updated = prompts.map((pp, j) => j === i ? { ...pp, prompt: e.target.value } : pp);
                      saveProject({ prompts: updated });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        setEditingPromptIdx(null);
                        const updated = prompts.map((pp, j) => j === i ? { ...pp, prompt: e.currentTarget.value } : pp);
                        saveProject({ prompts: updated });
                      }
                    }}
                    rows={4}
                    className="input text-[11px] w-full font-mono resize-y"
                    autoFocus
                  />
                ) : (
                  <div className="text-xs text-c-muted cursor-pointer hover:text-c-text" onClick={() => setEditingPromptIdx(i)}>
                    {p.prompt}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
