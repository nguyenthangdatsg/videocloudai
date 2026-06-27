import { clsx } from 'clsx';
import { Brain, RefreshCw, Sparkles, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorAIStore } from '../store';
import { RecommendationCard } from './RecommendationCard';
import { SUBTITLE_STYLE_LABELS, type SubtitleStyle } from '../types';
import type { SceneLine } from '@videocloudai/shared';

const SUBTITLE_STYLES = Object.entries(SUBTITLE_STYLE_LABELS) as [SubtitleStyle, string][];

interface Props {
  scenes: SceneLine[];
}

export function AIRecommendationSidebar({ scenes }: Props) {
  const { t } = useTranslation();
  const {
    recommendations,
    dismissedIds,
    isAnalyzing,
    appliedEdits,
    globalSubtitleStyle,
    applyRecommendation,
    dismissRecommendation,
    setGlobalSubtitleStyle,
    analyze,
  } = useEditorAIStore();

  const visible = recommendations.filter((r) => !dismissedIds.has(r.id));
  const appliedCount = appliedEdits.reduce((n, e) => n + e.effects.length, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-c-border shrink-0">
        <Brain className="w-3.5 h-3.5 text-[#7c6af5]" />
        <span className="text-xs font-medium text-c-text flex-1">{t('editor.ai.title')}</span>
        {isAnalyzing ? (
          <RefreshCw className="w-3 h-3 text-c-dim animate-spin" />
        ) : (
          <button
            onClick={() => analyze(scenes)}
            className="p-1 rounded hover:bg-c-elevated text-c-dim hover:text-c-muted transition-colors"
            title={t('editor.ai.reanalyze')}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto px-3 py-3 space-y-4">
        {/* Applied edits summary */}
        {appliedCount > 0 && (
          <div className="flex items-center gap-2 p-2 bg-green-900/15 border border-green-800/30 rounded-lg">
            <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
            <span className="text-xs text-green-300">
              {t('editor.ai.effectsApplied', { count: appliedCount })}
            </span>
          </div>
        )}

        {/* Recommendations */}
        <div>
          <div className="text-xs font-medium text-c-muted uppercase tracking-wider mb-2">
            {isAnalyzing
              ? t('editor.ai.analyzing')
              : visible.length === 0
              ? t('editor.ai.allClear')
              : t('editor.ai.suggestionsCount', { count: visible.length })}
          </div>

          {!isAnalyzing && visible.length === 0 && (
            <div className="text-center py-6">
              <Sparkles className="w-6 h-6 text-c-dim mx-auto mb-2" />
              <div className="text-xs text-c-dim">
                {scenes.length === 0 ? t('editor.ai.addScenes') : t('editor.ai.lookingGreat')}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {visible.map((rec) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                onApply={() => applyRecommendation(rec.id)}
                onIgnore={() => dismissRecommendation(rec.id)}
              />
            ))}
          </div>
        </div>

        {/* Subtitle style */}
        <div>
          <div className="text-xs font-medium text-c-muted uppercase tracking-wider mb-2">
            {t('editor.ai.subtitleStyle')}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {SUBTITLE_STYLES.map(([style, label]) => (
              <button
                key={style}
                onClick={() => setGlobalSubtitleStyle(style)}
                className={clsx(
                  'py-1.5 px-2 text-xs rounded-lg border transition-colors text-left truncate',
                  globalSubtitleStyle === style
                    ? 'bg-[#7c6af520] border-[#7c6af5] text-[#9180ff]'
                    : 'border-c-border text-c-muted hover:border-c-border-hi hover:text-c-text'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Cinematic effects legend */}
        <div>
          <div className="text-xs font-medium text-c-muted uppercase tracking-wider mb-2">
            {t('editor.ai.effectKey')}
          </div>
          <div className="space-y-0.5">
            {[
              { emoji: '🎞', label: 'Film Grain', key: 'film-grain' },
              { emoji: '✨', label: 'Light Leak', key: 'light-leak' },
              { emoji: '🔍', label: 'Zoom Punch', key: 'zoom-punch' },
              { emoji: '💫', label: 'Glow', key: 'glow' },
              { emoji: '⚡', label: 'Speed Ramp', key: 'speed-ramp' },
              { emoji: '📺', label: 'Vignette', key: 'vignette' },
            ].map(({ emoji, label, key }) => {
              const used = appliedEdits.some((e) => e.effects.includes(key as never));
              return (
                <div
                  key={key}
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-0.5 rounded text-xs',
                    used ? 'text-c-text bg-c-elevated' : 'text-c-dim'
                  )}
                >
                  <span>{emoji}</span>
                  <span>{label}</span>
                  {used && <span className="ml-auto text-green-400 text-xs">✓</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
