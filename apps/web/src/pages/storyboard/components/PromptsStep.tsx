import { useState } from 'react';
import { Wand2, ArrowRight, Trash2, Copy, Download, Pencil } from 'lucide-react';
import { clsx } from 'clsx';
import { Spinner } from '../../../components/ui/Spinner';
import { StagePromptEditor } from './StagePromptEditor';
import { useStoryboard } from '../StoryboardContext';

export function PromptsStep() {
  const ctx = useStoryboard();
  const {
    t, projectName,
    templateStageParts, setTemplateStageParts,
    imagePromptPrompt, setImagePromptPrompt,
    savingPrompt, savedPromptStage, handleSaveStagePrompt,
    prompts, setPrompts, generatingPrompts, promptProgress,
    editingPromptIdx, setEditingPromptIdx,
    handleGeneratePrompts, promptLogRef,
    transcriptEntries, aspectRatio, setAspectRatio,
    setStep, saveProject,
  } = ctx;

  const [copiedField, setCopiedField] = useState<string | null>(null);

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
                  const lines = prompts.map((p) => `[${p.timestamp}] ${p.prompt}`).join('\n\n');
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
                    prompts: prompts.map((p, i) => ({ index: i + 1, timestamp: p.timestamp, narration: p.text, imagePrompt: p.prompt })),
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

      {transcriptEntries.length > 0 && (
        <div className="border border-c-border rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-c-border bg-c-surface flex items-center justify-between">
            <span className="text-xs font-medium text-c-text">{t('storyboard.transcriptPreview')} ({transcriptEntries.length})</span>
          </div>
          <div className="max-h-[200px] overflow-auto divide-y divide-c-border">
            {transcriptEntries.map((e) => (
              <div key={e.index} className="px-3 py-1.5 flex gap-3 items-start">
                <span className="text-[10px] font-mono text-cyan-300/70 shrink-0 w-24">{e.startTime} &rarr; {e.endTime}</span>
                <span className="text-xs text-c-muted">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
      </div>

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

      {prompts.length > 0 && (
        <div className="space-y-3">
          {prompts.map((p, i) => (
            <div key={i} className="border border-violet-800/30 rounded-xl bg-c-surface overflow-hidden">
              <div className="px-3 py-2 border-b border-c-border bg-violet-900/10 flex items-center gap-2">
                <span className="text-[10px] font-bold text-violet-400 bg-violet-900/30 rounded-full w-5 h-5 flex items-center justify-center shrink-0">{i + 1}</span>
                <span className="text-[10px] font-mono text-cyan-300/70">[{p.timestamp}]</span>
                <span className="text-[10px] text-c-dim italic truncate">{p.text}</span>
                <button
                  onClick={() => setEditingPromptIdx(editingPromptIdx === i ? null : i)}
                  className="ml-auto p-1 text-c-muted hover:text-cyan-400 shrink-0"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
              <div className="p-3">
                {editingPromptIdx === i ? (
                  <textarea
                    value={p.prompt}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPrompts((prev) => prev.map((pp, j) => j === i ? { ...pp, prompt: val } : pp));
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
