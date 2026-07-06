import { useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { clsx } from 'clsx';
import type { StagePart } from '../types';

export const PART_COLORS = [
  { border: 'border-blue-700/40', bg: 'bg-blue-950/20', headerBg: 'bg-blue-950/40', label: 'text-blue-300', dim: 'text-blue-400/50', icon: 'text-blue-400/60', focusBg: 'focus:bg-blue-950/30', dot: 'bg-blue-400' },
  { border: 'border-emerald-700/40', bg: 'bg-emerald-950/20', headerBg: 'bg-emerald-950/40', label: 'text-emerald-300', dim: 'text-emerald-400/50', icon: 'text-emerald-400/60', focusBg: 'focus:bg-emerald-950/30', dot: 'bg-emerald-400' },
  { border: 'border-amber-700/40', bg: 'bg-amber-950/20', headerBg: 'bg-amber-950/40', label: 'text-amber-300', dim: 'text-amber-400/50', icon: 'text-amber-400/60', focusBg: 'focus:bg-amber-950/30', dot: 'bg-amber-400' },
  { border: 'border-rose-700/40', bg: 'bg-rose-950/20', headerBg: 'bg-rose-950/40', label: 'text-rose-300', dim: 'text-rose-400/50', icon: 'text-rose-400/60', focusBg: 'focus:bg-rose-950/30', dot: 'bg-rose-400' },
  { border: 'border-violet-700/40', bg: 'bg-violet-950/20', headerBg: 'bg-violet-950/40', label: 'text-violet-300', dim: 'text-violet-400/50', icon: 'text-violet-400/60', focusBg: 'focus:bg-violet-950/30', dot: 'bg-violet-400' },
  { border: 'border-cyan-700/40', bg: 'bg-cyan-950/20', headerBg: 'bg-cyan-950/40', label: 'text-cyan-300', dim: 'text-cyan-400/50', icon: 'text-cyan-400/60', focusBg: 'focus:bg-cyan-950/30', dot: 'bg-cyan-400' },
];

export function PromptPartBlock({
  part, colorIdx, defaultOpen, onEdit, onDelete, onRename,
}: {
  part: StagePart;
  colorIdx: number;
  defaultOpen?: boolean;
  onEdit: (content: string) => void;
  onDelete?: () => void;
  onRename?: (label: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(part.label);
  const c = PART_COLORS[colorIdx % PART_COLORS.length];
  const wordCount = part.content.trim() ? part.content.trim().split(/\s+/).length : 0;

  return (
    <div className={clsx('border rounded-lg overflow-hidden', c.border)}>
      <div className={clsx('px-2.5 py-1.5 flex items-center gap-2', c.headerBg)}>
        <span className={clsx('w-2 h-2 rounded-full shrink-0', c.dot)} />
        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={() => { onRename?.(labelDraft.trim() || part.label); setEditingLabel(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { onRename?.(labelDraft.trim() || part.label); setEditingLabel(false); } if (e.key === 'Escape') setEditingLabel(false); }}
            className="text-[10px] font-semibold uppercase tracking-wide bg-transparent border-b border-white/30 outline-none flex-1 text-white px-0.5"
          />
        ) : (
          <button
            onClick={() => setOpen(!open)}
            onDoubleClick={() => { if (onRename) { setLabelDraft(part.label); setEditingLabel(true); } }}
            className="flex-1 text-left flex items-center gap-2"
          >
            <span className={clsx('text-[10px] font-semibold flex-1 uppercase tracking-wide', c.label)}>
              {part.label}
            </span>
          </button>
        )}
        <span className={clsx('text-[9px] shrink-0', c.dim)}>{wordCount} w</span>
        <button
          onClick={() => setOpen(!open)}
          className="p-1 -m-1 shrink-0"
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-expanded={open}
        >
          {open
            ? <ChevronUp className={clsx('w-3.5 h-3.5', c.icon)} />
            : <ChevronDown className={clsx('w-3.5 h-3.5', c.icon)} />
          }
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1 -m-1 shrink-0 hover:text-red-400 transition-colors"
            aria-label="Delete prompt part"
          >
            <X className={clsx('w-3.5 h-3.5', c.icon)} />
          </button>
        )}
      </div>
      {open && (
        <textarea
          value={part.content}
          onChange={(e) => onEdit(e.target.value)}
          className={clsx('text-[11px] font-mono border-t w-full min-h-[80px] max-h-[250px] resize-y p-2.5 text-c-secondary focus:outline-none', c.border, c.bg, c.focusBg)}
        />
      )}
    </div>
  );
}
