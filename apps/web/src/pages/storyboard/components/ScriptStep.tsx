import { FileText, Wand2, ArrowRight } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { StagePromptEditor } from './StagePromptEditor';
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
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        {t('storyboard.stepScript')}
      </h3>

      {/* Stage prompt editor */}
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

      {/* Selected topic + generate */}
      <div className="border border-c-border rounded-xl p-4 bg-c-surface space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[10px] text-c-dim mb-0.5">{t('storyboard.selectedTopic')}</div>
            <div className="text-sm font-medium text-c-text">{scriptTopic || '—'}</div>
          </div>
          <button onClick={() => setStep('topics')} className="text-[10px] text-cyan-400 hover:underline shrink-0">{t('storyboard.changeTopic')}</button>
        </div>
        <div className="flex items-center gap-3">
          <div>
            <label className="text-[10px] text-c-muted mb-0.5 block">{t('storyboard.videoDuration')}</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={scriptDuration}
                onChange={(e) => setScriptDuration(Number(e.target.value))}
                className="input text-sm w-20"
                min={30}
                max={1800}
              />
              <span className="text-xs text-c-dim">sec</span>
              {scriptDuration > 120 && (
                <span className="text-[10px] text-amber-400/80 ml-1">
                  {Math.ceil(scriptDuration / 90)} {t('storyboard.scriptChunks')}
                </span>
              )}
            </div>
          </div>
          <div className="self-end">
            <button
              onClick={handleGenerateScript}
              disabled={!scriptTopic.trim() || generatingScript}
              className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              {generatingScript ? <Spinner size="sm" /> : <Wand2 className="w-3.5 h-3.5" />}
              {generatingScript && scriptDuration > 120
                ? t('storyboard.generatingChunked')
                : t('storyboard.generateScript')}
            </button>
          </div>
        </div>
      </div>

      {/* Script text editor */}
      <div>
        <label className="text-xs text-c-muted mb-1.5 block">{t('storyboard.scriptLabel')}</label>
        <textarea
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder={t('storyboard.scriptPlaceholder')}
          rows={16}
          className="input text-sm w-full resize-y min-h-[200px] font-mono"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-c-dim">{scriptText.split(/\s+/).filter(Boolean).length} {t('storyboard.words')}</span>
          <button
            onClick={() => { setStep('audio'); saveProject({ script: scriptText, scriptDuration, currentStep: 'audio' }); }}
            disabled={!scriptText.trim()}
            className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
          >
            {t('common.next')} <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
