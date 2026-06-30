import { clsx } from 'clsx';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorAIStore } from '../store';
import { EDIT_PRESETS } from '../presets';
import type { EditPreset, PresetColor } from '../types';
import type { SceneLine } from '@videocloudai/shared';
import { useState } from 'react';

const COLOR_CLASSES: Record<
  PresetColor,
  { active: string; hover: string; border: string }
> = {
  amber:  { active: 'bg-amber-900/30 border-amber-600/50 text-amber-300',  hover: 'hover:border-amber-700/50 hover:text-amber-300',  border: 'border-amber-800/30' },
  blue:   { active: 'bg-blue-900/30 border-blue-600/50 text-blue-300',     hover: 'hover:border-blue-700/50 hover:text-blue-300',     border: 'border-blue-800/30' },
  pink:   { active: 'bg-pink-900/30 border-pink-600/50 text-pink-300',     hover: 'hover:border-pink-700/50 hover:text-pink-300',     border: 'border-pink-800/30' },
  red:    { active: 'bg-red-900/30 border-red-600/50 text-red-300',        hover: 'hover:border-red-700/50 hover:text-red-300',        border: 'border-red-800/30' },
  purple: { active: 'bg-purple-900/30 border-purple-600/50 text-purple-300', hover: 'hover:border-purple-700/50 hover:text-purple-300', border: 'border-purple-800/30' },
  violet: { active: 'bg-violet-900/30 border-violet-600/50 text-violet-300', hover: 'hover:border-violet-700/50 hover:text-violet-300', border: 'border-violet-800/30' },
  green:  { active: 'bg-green-900/30 border-green-600/50 text-green-300',  hover: 'hover:border-green-700/50 hover:text-green-300',   border: 'border-green-800/30' },
  cyan:   { active: 'bg-cyan-900/30 border-cyan-600/50 text-cyan-300',     hover: 'hover:border-cyan-700/50 hover:text-cyan-300',     border: 'border-cyan-800/30' },
  orange: { active: 'bg-orange-900/30 border-orange-600/50 text-orange-300', hover: 'hover:border-orange-700/50 hover:text-orange-300', border: 'border-orange-800/30' },
  yellow: { active: 'bg-yellow-900/30 border-yellow-600/50 text-yellow-300', hover: 'hover:border-yellow-700/50 hover:text-yellow-300', border: 'border-yellow-800/30' },
};

interface Props {
  scenes: SceneLine[];
  /** Compact mode: vertical layout for the narrow right sidebar — buttons wrap into rows
   *  instead of scrolling horizontally. */
  compact?: boolean;
}

function PresetButton({ preset, scenes }: { preset: EditPreset; scenes: SceneLine[] }) {
  const { appliedPresetId, applyPreset, clearPreset } = useEditorAIStore();
  const isActive = appliedPresetId === preset.id;
  const c = COLOR_CLASSES[preset.color];

  function handleClick() {
    if (isActive) {
      clearPreset();
    } else {
      applyPreset(preset.id, scenes);
    }
  }

  return (
    <button
      onClick={handleClick}
      title={preset.description}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium',
        'whitespace-nowrap transition-all shrink-0',
        isActive
          ? c.active
          : clsx('text-c-muted border-c-border', c.hover)
      )}
    >
      <span>{preset.emoji}</span>
      <span>{preset.label}</span>
      {isActive && <X className="w-3 h-3 ml-0.5 opacity-70" />}
    </button>
  );
}

export function PresetBar({ scenes, compact = false }: Props) {
  const { t } = useTranslation();
  const { appliedPresetId, clearPreset } = useEditorAIStore();
  const active = EDIT_PRESETS.find((p) => p.id === appliedPresetId);
  // Separate storage key per layout so collapse state doesn't bleed between contexts
  const storageKey = compact ? 'presetBarCollapsed.compact' : 'presetBarCollapsed';
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(storageKey) === '1');

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(storageKey, next ? '1' : '0');
  }

  if (compact) {
    return (
      <div className="border-b border-c-border bg-c-surface shrink-0">
        <button
          onClick={toggleCollapsed}
          className="w-full flex items-center gap-1 px-3 py-2 text-[11px] text-c-text hover:bg-c-elevated transition-colors font-medium"
          title={collapsed ? t('editor.ai.showPresets') : t('editor.ai.hidePresets')}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          <span className="uppercase tracking-wider text-c-muted">{t('editor.ai.presets')}</span>
          {active && (
            <span className="ml-auto text-[10.5px] text-accent-hover truncate max-w-[60%]">
              {active.emoji} {active.label}
            </span>
          )}
        </button>

        {!collapsed && (
          <div className="px-2 pb-2 flex flex-wrap gap-1">
            {EDIT_PRESETS.map((preset) => (
              <PresetButton key={preset.id} preset={preset} scenes={scenes} />
            ))}
          </div>
        )}

        {!collapsed && active && (
          <div className="px-3 py-1.5 bg-accent-muted border-t border-accent-muted">
            <div className="flex items-start gap-1">
              <span className="text-[10.5px] text-accent-hover leading-tight flex-1">
                {active.effects.length} {t('editor.ai.effectsLabel')} · {active.subtitleStyle} · {active.durationMultiplier < 1
                  ? t('editor.ai.fasterLabel', { percent: Math.round((1 - active.durationMultiplier) * 100) })
                  : active.durationMultiplier > 1
                  ? t('editor.ai.slowerLabel', { percent: Math.round((active.durationMultiplier - 1) * 100) })
                  : t('editor.ai.normalPace')}
              </span>
              <button
                onClick={clearPreset}
                className="text-[10.5px] text-c-dim hover:text-red-400 transition-colors shrink-0"
              >
                {t('editor.ai.clear')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Original horizontal bar layout
  return (
    <div className="border-b border-c-border bg-c-bg shrink-0">
      <div className="flex items-center gap-2 px-4 py-1.5 overflow-x-auto scrollbar-none">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-1 text-xs text-c-dim hover:text-c-text transition-colors shrink-0 font-medium"
          title={collapsed ? t('editor.ai.showPresets') : t('editor.ai.hidePresets')}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {t('editor.ai.presets')}
          {active && !collapsed && <span className="w-1.5 h-1.5 rounded-full bg-accent-primary ml-1" />}
        </button>

        {!collapsed && (
          <div className="flex items-center gap-1.5">
            {EDIT_PRESETS.map((preset) => (
              <PresetButton key={preset.id} preset={preset} scenes={scenes} />
            ))}
          </div>
        )}

        {collapsed && active && (
          <span className="text-xs text-accent-hover shrink-0">
            {active.emoji} {active.label}
          </span>
        )}
      </div>

      {!collapsed && active && (
        <div className="flex items-center gap-2 px-4 py-1 bg-accent-muted border-t border-accent-muted">
          <span className="text-xs text-accent-hover">
            {active.emoji} <strong>{active.label}</strong> {t('editor.ai.active')} —{' '}
            {active.effects.length} {t('editor.ai.effectsLabel')} · {active.subtitleStyle}{' '}
            {t('editor.ai.captionsLabel')} ·{' '}
            {active.durationMultiplier < 1
              ? t('editor.ai.fasterLabel', { percent: Math.round((1 - active.durationMultiplier) * 100) })
              : active.durationMultiplier > 1
              ? t('editor.ai.slowerLabel', { percent: Math.round((active.durationMultiplier - 1) * 100) })
              : t('editor.ai.normalPace')}
          </span>
          <button
            onClick={clearPreset}
            className="ml-auto text-xs text-c-dim hover:text-red-400 transition-colors"
          >
            {t('editor.ai.clear')}
          </button>
        </div>
      )}
    </div>
  );
}
