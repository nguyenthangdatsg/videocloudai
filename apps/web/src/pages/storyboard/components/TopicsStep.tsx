import { Wand2, ArrowRight } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { StagePromptEditor } from './StagePromptEditor';
import { AdvancedToggle } from './AdvancedToggle';
import { useStoryboard } from '../StoryboardContext';

export function TopicsStep() {
  const {
    templateLoaded, templateStageParts, setTemplateStageParts,
    topicsPrompt, setTopicsPrompt,
    savingPrompt, savedPromptStage, handleSaveStagePrompt,
    generatingTopics, handleGenerateTopics,
    scriptTopic, setScriptTopic,
    topicIdeas, handlePickTopic,
    t,
  } = useStoryboard();

  return (
    <div className="space-y-3">
      {!templateLoaded && (
        <div className="border border-yellow-800/30 rounded-lg p-2.5 bg-yellow-900/10 text-xs text-yellow-300">
          {t('storyboard.loadTemplateFirst')}
        </div>
      )}

      {/* Main action: generate or type a topic */}
      <div className="flex gap-2 items-center">
        <button
          onClick={handleGenerateTopics}
          disabled={!templateLoaded || generatingTopics}
          className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50 py-2 px-4"
        >
          {generatingTopics ? <Spinner size="sm" /> : <Wand2 className="w-3.5 h-3.5" />}
          {t('storyboard.generateTopics')}
        </button>
        <span className="text-xs text-c-dim">{t('common.or')}</span>
        <input
          type="text"
          value={scriptTopic}
          onChange={(e) => setScriptTopic(e.target.value)}
          placeholder={t('storyboard.topicPlaceholder')}
          className="input text-sm flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter' && scriptTopic.trim()) handlePickTopic(scriptTopic.trim()); }}
        />
        <button
          onClick={() => handlePickTopic(scriptTopic.trim())}
          disabled={!scriptTopic.trim()}
          className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50 py-2 px-3"
        >
          {t('storyboard.useTopic')} <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Generated topic ideas */}
      {topicIdeas.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-c-muted">{t('storyboard.pickTopic')}</div>
          {topicIdeas.map((topic, i) => (
            <button
              key={i}
              onClick={() => handlePickTopic(topic)}
              className="w-full text-left flex items-center gap-3 p-2.5 rounded-lg border border-c-border bg-c-surface hover:border-cyan-700/50 transition-colors"
            >
              <span className="text-sm font-medium text-cyan-400 shrink-0 w-6">{i + 1}</span>
              <span className="text-sm text-c-text flex-1">{topic}</span>
              <ArrowRight className="w-4 h-4 text-c-dim shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Advanced: Stage prompt editor */}
      <AdvancedToggle label={t('storyboard.stagePrompt')}>
        <StagePromptEditor
          label={`Stage 1: ${t('storyboard.stepTopics')} — ${t('storyboard.stagePrompt')}`}
          stageParts={templateStageParts.topics}
          value={topicsPrompt}
          onChange={setTopicsPrompt}
          onPartsChange={(parts) => setTemplateStageParts(p => ({ ...p, topics: parts }))}
          onSave={() => handleSaveStagePrompt('topics', topicsPrompt)}
          saving={savingPrompt === 'topics'}
          saved={savedPromptStage === 'topics'}
          t={t}
        />
      </AdvancedToggle>
    </div>
  );
}
