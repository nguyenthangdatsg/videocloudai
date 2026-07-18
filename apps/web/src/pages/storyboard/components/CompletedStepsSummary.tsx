import { Play, Pause } from 'lucide-react';
import { useState } from 'react';
import { useStoryboard } from '../StoryboardContext';

export function CompletedStepsSummary() {
  const {
    scriptTopic, scriptText, audioFile, voice, prompts,
    generatedImages, segments, metadataTitle, metadataTags,
    setStep, setLightboxUrl, t,
  } = useStoryboard();

  const [playing, setPlaying] = useState(false);
  const [audioEl] = useState(() => typeof Audio !== 'undefined' ? new Audio() : null);

  const togglePlay = () => {
    if (!audioEl || !audioFile) return;
    if (playing) {
      audioEl.pause();
      setPlaying(false);
    } else {
      audioEl.src = `/api/tts/file/${audioFile.filename}`;
      audioEl.onended = () => setPlaying(false);
      audioEl.play();
      setPlaying(true);
    }
  };

  const doneImages = generatedImages.filter(i => i.status === 'done');
  const totalDur = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);

  // Only show if at least one step is completed
  const hasAnything = scriptTopic || scriptText || audioFile || prompts.length > 0 || doneImages.length > 0 || segments.length > 0 || metadataTitle;
  if (!hasAnything) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap px-4 py-2 bg-c-surface/30 border-b border-c-border/50">
      {/* Topic */}
      {scriptTopic && (
        <button onClick={() => setStep('topics')} className="text-[10px] text-c-muted hover:text-cyan-400 truncate max-w-[200px] transition-colors" title={scriptTopic}>
          {scriptTopic}
        </button>
      )}

      {scriptTopic && scriptText && <span className="text-c-border">|</span>}

      {/* Script word count */}
      {scriptText && (
        <button onClick={() => setStep('script')} className="text-[10px] text-c-dim hover:text-cyan-400 transition-colors">
          {scriptText.split(/\s+/).filter(Boolean).length} {t('storyboard.words')}
        </button>
      )}

      {/* Audio */}
      {audioFile && (
        <>
          <span className="text-c-border">|</span>
          <button onClick={togglePlay} className="flex items-center gap-1 text-[10px] text-c-dim hover:text-cyan-400 transition-colors">
            {playing ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
            {voice.split('-').slice(-1)[0]} · {Math.round(audioFile.duration)}s
          </button>
        </>
      )}

      {/* Prompts */}
      {prompts.length > 0 && (
        <>
          <span className="text-c-border">|</span>
          <button onClick={() => setStep('prompts')} className="text-[10px] text-c-dim hover:text-cyan-400 transition-colors">
            {prompts.length} {t('storyboard.stepPrompts').toLowerCase()}
          </button>
        </>
      )}

      {/* Images */}
      {doneImages.length > 0 && (
        <>
          <span className="text-c-border">|</span>
          <button onClick={() => setStep('images')} className="text-[10px] text-c-dim hover:text-cyan-400 transition-colors">
            {doneImages.length}/{generatedImages.length} {t('storyboard.stepImages').toLowerCase()}
          </button>
        </>
      )}

      {/* Timeline */}
      {segments.length > 0 && (
        <>
          <span className="text-c-border">|</span>
          <button onClick={() => setStep('timeline')} className="text-[10px] text-c-dim hover:text-cyan-400 transition-colors">
            {segments.length} seg · {Math.round(totalDur)}s
          </button>
        </>
      )}

      {/* Metadata */}
      {metadataTitle && (
        <>
          <span className="text-c-border">|</span>
          <button onClick={() => setStep('metadata')} className="text-[10px] text-c-dim hover:text-cyan-400 truncate max-w-[150px] transition-colors" title={metadataTitle}>
            {metadataTitle}
          </button>
          {metadataTags.length > 0 && (
            <span className="text-[9px] text-c-dim">({metadataTags.length} tags)</span>
          )}
        </>
      )}
    </div>
  );
}
