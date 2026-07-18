import { useState } from 'react';
import { Wand2, ChevronDown, ChevronUp, CheckCircle, Save } from 'lucide-react';
import { clsx } from 'clsx';
import type { StagePart } from '../types';
import { PromptPartBlock, PART_COLORS } from './PromptPartBlock';

export function StagePromptEditor({
  label,
  stageParts,
  value,
  onChange,
  onPartsChange,
  onSave,
  saving,
  saved,
  placeholder,
  t,
}: {
  label: string;
  stageParts?: StagePart[];
  value: string;
  onChange: (v: string) => void;
  onPartsChange?: (parts: StagePart[]) => void;
  onSave?: () => void;
  saving?: boolean;
  saved?: boolean;
  placeholder?: string;
  t: (key: string) => string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'parts' | 'full'>('parts');

  const decompose = (text: string): StagePart[] => {
    const parts: StagePart[] = [];
    const sections = text.split(/^---\s*(.+?)\s*---$/m);
    if (sections[0]?.trim()) {
      parts.push({ label: 'Intro', content: sections[0].trim() });
    }
    for (let i = 1; i < sections.length; i += 2) {
      const label = sections[i]?.trim();
      const content = sections[i + 1]?.trim() ?? '';
      if (label) parts.push({ label, content });
    }
    return parts;
  };

  const recompose = (parts: StagePart[]) => {
    const composed = parts
      .filter(p => p.content.trim())
      .map(p => `--- ${p.label} ---\n${p.content}`)
      .join('\n\n');
    onChange(composed);
  };

  // Single source of truth: derive parts from full prompt text
  const allParts = value ? decompose(value) : [];

  const handlePartEdit = (idx: number, newContent: string) => {
    const updated = allParts.map((p, i) => i === idx ? { ...p, content: newContent } : p);
    recompose(updated);
  };

  const handlePartDelete = (idx: number) => {
    const updated = allParts.filter((_, i) => i !== idx);
    recompose(updated);
  };

  const handlePartRename = (idx: number, newLabel: string) => {
    const updated = allParts.map((p, i) => i === idx ? { ...p, label: newLabel } : p);
    recompose(updated);
  };

  const handleAddPart = () => {
    const updated = [...allParts, { label: `Custom Part ${allParts.length + 1}`, content: '' }];
    recompose(updated);
  };

  const partsWithContent = allParts.filter(p => p.content.trim());

  return (
    <div className="border border-purple-800/30 rounded-xl bg-purple-900/10 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-purple-900/20 transition-colors"
        aria-expanded={!collapsed}
      >
        <Wand2 className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-[11px] font-medium text-purple-300 flex-1">
          {label}
          {allParts.length > 0 && (
            <span className="ml-2 text-[9px] text-green-400 font-normal flex-inline items-center gap-1">
              {allParts.map((_, i) => (
                <span key={i} className={clsx('inline-block w-1.5 h-1.5 rounded-full mr-0.5', PART_COLORS[i % PART_COLORS.length].dot)} />
              ))}
              <span className="ml-1">{partsWithContent.length} {t('storyboard.promptParts')}</span>
            </span>
          )}
        </span>
        {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-purple-400" /> : <ChevronUp className="w-3.5 h-3.5 text-purple-400" />}
      </button>
      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 border-t border-purple-800/20">
          <div className="flex gap-1 mt-2 items-center" role="tablist">
            <button
              onClick={() => setTab('parts')}
              role="tab"
              aria-selected={tab === 'parts'}
              className={clsx(
                'text-[10px] px-2.5 py-1 rounded-lg border transition-colors',
                tab === 'parts'
                  ? 'bg-purple-900/40 border-purple-600/50 text-purple-300 font-medium'
                  : 'border-transparent text-c-dim hover:text-purple-300',
              )}
            >
              {t('storyboard.promptPartsTab')}
            </button>
            <button
              onClick={() => setTab('full')}
              role="tab"
              aria-selected={tab === 'full'}
              className={clsx(
                'text-[10px] px-2.5 py-1 rounded-lg border transition-colors',
                tab === 'full'
                  ? 'bg-purple-900/40 border-purple-600/50 text-purple-300 font-medium'
                  : 'border-transparent text-c-dim hover:text-purple-300',
              )}
            >
              {t('storyboard.fullPrompt')}
            </button>
            {onSave && (
              saved ? (
                <span className="ml-auto text-[10px] px-3 py-1 rounded-lg bg-green-800/40 text-green-400 font-medium flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  {t('storyboard.saved')}
                </span>
              ) : (
                <button
                  onClick={onSave}
                  disabled={saving}
                  className="ml-auto text-[10px] px-3 py-1 rounded-lg bg-green-700/60 hover:bg-green-700/80 text-green-200 font-medium flex items-center gap-1 disabled:opacity-50 transition-colors"
                >
                  <Save className="w-3 h-3" />
                  {saving ? t('storyboard.saving') : t('storyboard.savePrompt')}
                </button>
              )
            )}
          </div>

          {tab === 'parts' && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-purple-300/60 mb-1">{t('storyboard.promptPartsHint')}</div>
              {allParts.length > 0 ? (
                allParts.map((part, i) => (
                  <PromptPartBlock
                    key={`${i}-${part.label}`}
                    part={part}
                    colorIdx={i}
                    defaultOpen={i > 0 && i < allParts.length - 1}
                    onEdit={(content) => handlePartEdit(i, content)}
                    onDelete={allParts.length > 1 ? () => handlePartDelete(i) : undefined}
                    onRename={(label) => handlePartRename(i, label)}
                  />
                ))
              ) : (
                <div className="text-[11px] text-c-dim italic p-3">{t('storyboard.noPromptSection')}</div>
              )}
              <button
                onClick={handleAddPart}
                className="w-full text-[10px] py-1.5 rounded-lg border border-dashed border-purple-700/40 text-purple-400 hover:bg-purple-900/20 hover:text-purple-300 transition-colors flex items-center justify-center gap-1"
              >
                + {t('storyboard.addPart')}
              </button>
            </div>
          )}

          {tab === 'full' && (
            <div>
              <div className="text-[10px] text-purple-300/60 mb-1">{t('storyboard.fullPromptHint')}</div>
              <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || t('storyboard.noPromptSection')}
                rows={12}
                className="input text-[11px] w-full font-mono resize-y min-h-[150px] bg-purple-950/20 border-purple-800/30 focus:border-purple-600/50"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
