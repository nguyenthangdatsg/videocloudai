import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, Play, Pause } from 'lucide-react';
import { clsx } from 'clsx';
import { useStoryboard } from '../StoryboardContext';

/** Compact summary for the Topic step */
function TopicSummary() {
  const { scriptTopic } = useStoryboard();
  if (!scriptTopic) return null;
  return <span className="text-xs text-c-text truncate">{scriptTopic}</span>;
}

/** Compact summary for the Script step */
function ScriptSummary() {
  const { scriptText } = useStoryboard();
  if (!scriptText) return null;
  const words = scriptText.split(/\s+/).filter(Boolean).length;
  const lines = scriptText.split('\n').filter(l => l.trim()).slice(0, 2);
  return (
    <div className="space-y-1 min-w-0">
      <span className="text-[10px] text-c-dim">{words} words</span>
      <p className="text-xs text-c-muted truncate">{lines.join(' | ')}</p>
    </div>
  );
}

/** Compact summary for the Audio step */
function AudioSummary() {
  const { audioFile, voice } = useStoryboard();
  const [playing, setPlaying] = useState(false);
  const [audioEl] = useState(() => typeof Audio !== 'undefined' ? new Audio() : null);

  if (!audioFile) return null;

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioEl) return;
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

  const dur = audioFile.duration ? `${Math.round(audioFile.duration)}s` : '';
  return (
    <div className="flex items-center gap-2">
      <button onClick={togglePlay} className="p-1 rounded hover:bg-c-elevated">
        {playing ? <Pause className="w-3 h-3 text-cyan-400" /> : <Play className="w-3 h-3 text-cyan-400" />}
      </button>
      <span className="text-xs text-c-muted">{voice}</span>
      {dur && <span className="text-[10px] text-c-dim">{dur}</span>}
    </div>
  );
}

/** Compact summary for the Prompts step */
function PromptsSummary() {
  const { prompts } = useStoryboard();
  if (!prompts.length) return null;
  return <span className="text-xs text-c-muted">{prompts.length} prompts</span>;
}

/** Compact summary for the Images step */
function ImagesSummary() {
  const { generatedImages } = useStoryboard();
  const done = generatedImages.filter(i => i.status === 'done');
  if (!done.length) return null;
  return (
    <span className="text-[10px] text-c-muted">
      {done.length}/{generatedImages.length} assets ready
    </span>
  );
}

/** Compact summary for the Timeline step */
function TimelineSummary() {
  const { segments } = useStoryboard();
  if (!segments.length) return null;
  const totalDur = segments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
  return <span className="text-xs text-c-muted">{segments.length} segments, {Math.round(totalDur)}s</span>;
}

/** Compact summary for the Metadata step */
function MetadataSummary() {
  const { metadataTitle, metadataTags } = useStoryboard();
  if (!metadataTitle) return null;
  return (
    <div className="space-y-0.5 min-w-0">
      <span className="text-xs text-c-text truncate block">{metadataTitle}</span>
      {metadataTags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {metadataTags.slice(0, 5).map((tag, i) => (
            <span key={i} className="text-[9px] bg-cyan-900/20 text-cyan-400/80 px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const summaryComponents: Record<string, React.ComponentType> = {
  topics: TopicSummary,
  script: ScriptSummary,
  audio: AudioSummary,
  prompts: PromptsSummary,
  images: ImagesSummary,
  timeline: TimelineSummary,
  metadata: MetadataSummary,
};

interface StepAccordionProps {
  stepKey: string;
  label: string;
  icon: React.ElementType;
  done: boolean;
  isActive: boolean;
  isFuture: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}

export function StepAccordion({ stepKey, label, icon: Icon, done, isActive, isFuture, onActivate, children }: StepAccordionProps) {
  const SummaryComp = summaryComponents[stepKey];

  // Future steps: show as disabled pill
  if (isFuture) {
    return (
      <div className="border border-c-border/50 rounded-xl bg-c-surface/30 opacity-40">
        <div className="px-4 py-2.5 flex items-center gap-2">
          <Icon className="w-4 h-4 text-c-dim" />
          <span className="text-xs font-medium text-c-dim">{label}</span>
        </div>
      </div>
    );
  }

  // Completed steps: show summary, clickable to expand
  if (done && !isActive) {
    return (
      <div className="border border-green-800/20 rounded-xl bg-c-surface overflow-hidden">
        <button
          onClick={onActivate}
          className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-c-elevated/30 transition-colors"
        >
          <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
          <span className="text-xs font-medium text-green-400 shrink-0">{label}</span>
          <div className="flex-1 min-w-0 ml-2">
            {SummaryComp && <SummaryComp />}
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-c-dim shrink-0" />
        </button>
      </div>
    );
  }

  // Active step: show full content
  return (
    <div className={clsx(
      'border rounded-xl bg-c-surface overflow-hidden',
      isActive ? 'border-cyan-700/40 ring-1 ring-cyan-500/10' : 'border-c-border',
    )}>
      <button
        onClick={onActivate}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-c-elevated/30 transition-colors"
      >
        {done
          ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
          : <Icon className={clsx('w-4 h-4 shrink-0', isActive ? 'text-cyan-400' : 'text-c-dim')} />
        }
        <span className={clsx('text-xs font-medium shrink-0', isActive ? 'text-cyan-300' : 'text-c-text')}>{label}</span>
        {done && SummaryComp && (
          <div className="flex-1 min-w-0 ml-2">
            <SummaryComp />
          </div>
        )}
        <span className="flex-1" />
        {isActive ? <ChevronUp className="w-3.5 h-3.5 text-c-dim shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-c-dim shrink-0" />}
      </button>
      {isActive && (
        <div className="px-4 pb-4 pt-2 border-t border-c-border/50">
          {children}
        </div>
      )}
    </div>
  );
}
