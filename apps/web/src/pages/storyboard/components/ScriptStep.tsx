import { Wand2, ArrowRight } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { StagePromptEditor } from './StagePromptEditor';
import { AdvancedToggle } from './AdvancedToggle';
import { useStoryboard } from '../StoryboardContext';

export function ScriptStep() {
  const {
    templateStageParts, setTemplateStageParts,
    scriptPrompt, setScriptPrompt,
    savingPrompt, savedPromptStage, handleSaveStagePrompt,
    scriptTopic, setStep, setScriptTopic,
    scriptDuration, setScriptDuration, generatingScript, handleGenerateScript,
    scriptText, setScriptText, saveProject,
    t,
  } = useStoryboard();

  return (
    <div className="space-y-3">
      {/* Topic + Duration + Generate — single row */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] text-c-dim mb-0.5 block">{t('storyboard.selectedTopic')}</label>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-c-text truncate">{scriptTopic || '—'}</span>
            <button onClick={() => setStep('topics')} className="text-[10px] text-cyan-400 hover:underline shrink-0">{t('storyboard.changeTopic')}</button>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-c-dim mb-0.5 block">{t('storyboard.videoDuration')}</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={scriptDuration}
              onChange={(e) => setScriptDuration(Number(e.target.value))}
              className="input text-sm w-20"
              min={30}
              max={1800}
            />
            <span className="text-xs text-c-dim">{t('storyboard.secondsAbbr')}</span>
          </div>
        </div>
        <button
          onClick={handleGenerateScript}
          disabled={!scriptTopic.trim() || generatingScript}
          className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50 py-2 px-4"
        >
          {generatingScript ? <Spinner size="sm" /> : <Wand2 className="w-3.5 h-3.5" />}
          {generatingScript && scriptDuration > 120
            ? t('storyboard.generatingChunked')
            : t('storyboard.generateScript')}
        </button>
      </div>

      {/* Script editor */}
      <textarea
        value={scriptText}
        onChange={(e) => setScriptText(e.target.value)}
        placeholder={t('storyboard.scriptPlaceholder')}
        rows={12}
        className="input text-sm w-full resize-y min-h-[150px] font-mono"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-c-dim">{scriptText.split(/\s+/).filter(Boolean).length} {t('storyboard.words')}</span>
        <button
          onClick={() => { setStep('audio'); saveProject({ script: scriptText, scriptDuration, currentStep: 'audio' }); }}
          disabled={!scriptText.trim()}
          className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50 py-2 px-4"
        >
          {t('common.next')} <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Advanced: Stage prompt editor */}
      <AdvancedToggle label={t('storyboard.stagePrompt')}>
        <StagePromptEditor
          label={`Stage 2: ${t('storyboard.stepScript')} — ${t('storyboard.stagePrompt')}`}
          stageParts={templateStageParts.script}
          value={scriptPrompt}
          onChange={setScriptPrompt}
          onPartsChange={(parts) => setTemplateStageParts(p => ({ ...p, script: parts }))}
          onSave={() => handleSaveStagePrompt('script', scriptPrompt)}
          saving={savingPrompt === 'script'}
          saved={savedPromptStage === 'script'}
          t={t}
        />
      </AdvancedToggle>
    </div>
  );
}
