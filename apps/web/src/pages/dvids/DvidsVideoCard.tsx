import { clsx } from 'clsx';
import { Play, Check } from 'lucide-react';
import { DvidsSearchResult, DvidsImportedAsset, BRANCH_COLORS } from './types';

interface Props {
  item: DvidsSearchResult | DvidsImportedAsset;
  selected?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  onCheck?: (checked: boolean) => void;
  showCheckbox?: boolean;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function DvidsVideoCard({ item, selected, checked, onSelect, onCheck, showCheckbox }: Props) {
  const title = item.title;
  const thumbnail = 'thumbnail' in item ? item.thumbnail : (item as DvidsImportedAsset).thumbnail_url;
  const duration = item.duration ?? 0;
  const branch = item.branch ?? '';
  const branchClass = BRANCH_COLORS[branch] || 'bg-gray-600/20 text-gray-400 border-gray-600/30';

  return (
    <div
      onClick={onSelect}
      className={clsx(
        'group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 border',
        selected
          ? 'border-cyan-500 ring-2 ring-cyan-500/30 scale-[1.02]'
          : 'border-c-border hover:border-c-dim hover:shadow-lg hover:scale-[1.01]',
        'bg-c-surface',
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-c-bg">
        {thumbnail ? (
          <img src={thumbnail} alt={title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-c-dim">
            <Play className="w-8 h-8" />
          </div>
        )}

        {/* Play overlay on hover */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play className="w-10 h-10 text-white" fill="white" />
        </div>

        {/* Duration badge */}
        {duration > 0 && (
          <span className="absolute bottom-2 right-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/70 text-white">
            {formatDuration(duration)}
          </span>
        )}

        {/* Checkbox */}
        {showCheckbox && (
          <button
            onClick={(e) => { e.stopPropagation(); onCheck?.(!checked); }}
            className={clsx(
              'absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
              checked
                ? 'bg-cyan-500 border-cyan-500 text-white'
                : 'border-white/60 bg-black/30 hover:border-white',
            )}
          >
            {checked && <Check className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-1">
        <h4 className="text-xs font-medium text-c-text line-clamp-2 leading-tight">{title}</h4>
        {branch && (
          <span className={clsx('inline-block text-[9px] font-medium px-1.5 py-0.5 rounded border', branchClass)}>
            {branch}
          </span>
        )}
      </div>
    </div>
  );
}
