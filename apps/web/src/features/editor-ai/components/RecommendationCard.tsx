import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  ZoomIn,
  ArrowRight,
  Scissors,
  Type,
  MessageSquare,
  Timer,
  Zap,
  Heart,
  Shuffle,
  Wand2,
  Layout,
  Film,
} from 'lucide-react';
import type { Recommendation, RecommendationType } from '../types';

type IconComponent = React.ComponentType<{ className?: string }>;

const TYPE_CONFIG: Record<
  RecommendationType,
  { icon: IconComponent; textColor: string; borderColor: string; bgColor: string }
> = {
  'zoom-punch':         { icon: ZoomIn,        textColor: 'text-yellow-400', borderColor: 'border-yellow-800/40', bgColor: 'bg-yellow-900/10' },
  'transition':         { icon: ArrowRight,     textColor: 'text-blue-400',   borderColor: 'border-blue-800/40',   bgColor: 'bg-blue-900/10' },
  'cut':                { icon: Scissors,       textColor: 'text-red-400',    borderColor: 'border-red-800/40',    bgColor: 'bg-red-900/10' },
  'subtitle-emphasis':  { icon: Type,           textColor: 'text-purple-400', borderColor: 'border-purple-800/40', bgColor: 'bg-purple-900/10' },
  'commentary-overlay': { icon: MessageSquare,  textColor: 'text-cyan-400',   borderColor: 'border-cyan-800/40',   bgColor: 'bg-cyan-900/10' },
  'pacing-slow':        { icon: Timer,          textColor: 'text-orange-400', borderColor: 'border-orange-800/40', bgColor: 'bg-orange-900/10' },
  'pacing-fast':        { icon: Zap,            textColor: 'text-green-400',  borderColor: 'border-green-800/40',  bgColor: 'bg-green-900/10' },
  'emotional-highlight':{ icon: Heart,          textColor: 'text-pink-400',   borderColor: 'border-pink-800/40',   bgColor: 'bg-pink-900/10' },
  'mood-shift':         { icon: Shuffle,        textColor: 'text-violet-400', borderColor: 'border-violet-800/40', bgColor: 'bg-violet-900/10' },
  'add-effect':         { icon: Wand2,          textColor: 'text-amber-400',  borderColor: 'border-amber-800/40',  bgColor: 'bg-amber-900/10' },
  'split-screen':       { icon: Layout,         textColor: 'text-teal-400',   borderColor: 'border-teal-800/40',   bgColor: 'bg-teal-900/10' },
  'scene-restructure':  { icon: Film,           textColor: 'text-indigo-400', borderColor: 'border-indigo-800/40', bgColor: 'bg-indigo-900/10' },
};

interface Props {
  rec: Recommendation;
  onApply: () => void;
  onIgnore: () => void;
}

export function RecommendationCard({ rec, onApply, onIgnore }: Props) {
  const { t } = useTranslation();
  const cfg = TYPE_CONFIG[rec.type] ?? TYPE_CONFIG['add-effect'];
  const Icon = cfg.icon;
  const confidencePct = Math.round(rec.confidence * 100);

  return (
    <div className={clsx('rounded-xl p-3 border transition-colors', cfg.borderColor, cfg.bgColor)}>
      <div className="flex items-start gap-2.5">
        <Icon className={clsx('w-3.5 h-3.5 mt-0.5 shrink-0', cfg.textColor)} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-c-text leading-snug">{rec.message}</div>
          {rec.detail && (
            <div className="text-xs text-c-muted mt-0.5 leading-relaxed">{rec.detail}</div>
          )}
          <div className="flex items-center justify-between mt-1.5">
            {rec.sceneIndex !== undefined && (
              <span className="text-xs text-c-dim">
                {t('editor.ai.sceneNumber', { n: rec.sceneIndex + 1 })}
              </span>
            )}
            <div className="flex items-center gap-1.5 ml-auto">
              <div className="w-16 h-0.5 bg-c-elevated rounded-full overflow-hidden">
                <div
                  className={clsx('h-full rounded-full opacity-70', cfg.textColor.replace('text-', 'bg-'))}
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
              <span className="text-xs text-c-dim">{confidencePct}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 mt-2.5">
        <button
          onClick={onApply}
          className={clsx(
            'flex-1 py-1 px-2 text-xs font-medium rounded-lg border transition-colors',
            'bg-accent-muted text-accent-hover border-accent-glow hover:bg-accent-glow'
          )}
        >
          {rec.actionLabel}
        </button>
        <button
          onClick={onIgnore}
          className="py-1 px-2 text-xs text-c-dim rounded-lg border border-c-border hover:border-c-border-hi hover:text-c-muted transition-colors"
        >
          {t('editor.ai.ignore')}
        </button>
      </div>
    </div>
  );
}
