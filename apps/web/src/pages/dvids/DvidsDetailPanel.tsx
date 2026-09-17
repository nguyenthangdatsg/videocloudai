import { useState } from 'react';
import { X, Star, Download, Trash2, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { DvidsSearchResult, DvidsImportedAsset, BRANCH_COLORS } from './types';

interface Props {
  item: DvidsSearchResult | DvidsImportedAsset | null;
  isImported?: boolean;
  onClose: () => void;
  onImport?: (id: string) => void;
  onFavorite?: (id: number, fav: boolean) => void;
  onUpdateTags?: (id: number, tags: string[]) => void;
  onUpdateCollection?: (id: number, collection: string) => void;
  onAutoTag?: (id: number) => void;
  onDelete?: (id: number) => void;
  importing?: boolean;
  collections?: string[];
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function DvidsDetailPanel({
  item, isImported, onClose, onImport, onFavorite, onUpdateTags, onUpdateCollection, onAutoTag, onDelete, importing, collections,
}: Props) {
  const { t } = useTranslation();
  const [newTag, setNewTag] = useState('');

  if (!item) return null;

  const imported = isImported ? (item as DvidsImportedAsset) : null;
  const search = !isImported ? (item as DvidsSearchResult) : null;

  const title = item.title;
  const branch = item.branch ?? '';
  const branchClass = BRANCH_COLORS[branch] || '';
  const duration = item.duration ?? 0;
  const thumbnail = search?.thumbnail ?? imported?.thumbnail_url;
  const videoSrc = imported?.local_filename ? `/api/dvids/file/${imported.local_filename}` : null;
  const dvidsUrl = search?.url ?? imported?.dvids_url;
  const credit = search?.credit ?? imported?.credit?.map(c => `${c.rank} ${c.name}`).join(', ') ?? '';
  const unit = search?.unit_name ?? imported?.unit_name ?? '';
  const virin = imported?.virin ?? '';
  const keywords = search?.keywords ?? imported?.keywords ?? [];
  const tags = imported?.tags ?? [];
  const datePub = search?.date_published ?? imported?.date_published ?? '';

  const addTag = () => {
    if (!newTag.trim() || !imported) return;
    onUpdateTags?.(imported.id, [...tags, newTag.trim()]);
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    if (!imported) return;
    onUpdateTags?.(imported.id, tags.filter(t => t !== tag));
  };

  return (
    <div className="w-[320px] flex-shrink-0 border-l border-c-border overflow-y-auto bg-c-surface">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-c-border">
        <span className="text-xs font-medium text-c-text truncate">{title}</span>
        <button onClick={onClose} className="text-c-dim hover:text-c-text"><X className="w-4 h-4" /></button>
      </div>

      {/* Preview */}
      <div className="aspect-video bg-black">
        {videoSrc ? (
          <video src={videoSrc} controls className="w-full h-full" poster={thumbnail ?? undefined} />
        ) : thumbnail ? (
          <img src={thumbnail} alt={title} className="w-full h-full object-cover" />
        ) : null}
      </div>

      <div className="p-3 space-y-3">
        {/* Branch + Duration */}
        <div className="flex items-center gap-2 flex-wrap">
          {branch && <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded border', branchClass)}>{branch}</span>}
          {duration > 0 && <span className="text-[10px] text-c-dim">{formatDuration(duration)}</span>}
          {datePub && <span className="text-[10px] text-c-dim">{new Date(datePub).toLocaleDateString()}</span>}
        </div>

        {/* Description */}
        {(search?.short_description || imported?.description) && (
          <p className="text-[11px] text-c-muted leading-relaxed">{search?.short_description || imported?.short_description || imported?.description?.slice(0, 200)}</p>
        )}

        {/* Metadata */}
        <div className="space-y-1.5 text-[11px]">
          {unit && <div><span className="text-c-dim">{t('dvids.unit')}:</span> <span className="text-c-text">{unit}</span></div>}
          {credit && <div><span className="text-c-dim">{t('dvids.credit')}:</span> <span className="text-c-text">{credit}</span></div>}
          {virin && <div><span className="text-c-dim">{t('dvids.virin')}:</span> <span className="text-c-text font-mono">{virin}</span></div>}
        </div>

        {/* Keywords */}
        {keywords.length > 0 && (
          <div>
            <span className="text-[10px] text-c-dim">{t('dvids.keywords')}</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {keywords.slice(0, 12).map(kw => (
                <span key={kw} className="text-[9px] px-1.5 py-0.5 rounded bg-c-elevated text-c-muted border border-c-border">{kw}</span>
              ))}
            </div>
          </div>
        )}

        {/* Tags (imported only) */}
        {imported && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-c-dim">{t('dvids.tags')}</span>
              <button onClick={() => onAutoTag?.(imported.id)} className="text-[9px] text-cyan-400 hover:underline">{t('dvids.autoTag')}</button>
            </div>
            <div className="flex flex-wrap gap-1">
              {tags.map(tag => (
                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-600/15 text-cyan-400 border border-cyan-600/20 flex items-center gap-1">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                placeholder={t('dvids.addTag')}
                className="text-[9px] px-1.5 py-0.5 bg-transparent border border-c-border rounded w-16 text-c-text outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        )}

        {/* Collection (imported only) */}
        {imported && (
          <div>
            <label className="text-[10px] text-c-dim block mb-1">{t('dvids.collection')}</label>
            <select
              value={imported.collection ?? ''}
              onChange={(e) => onUpdateCollection?.(imported.id, e.target.value)}
              className="input text-xs w-full"
            >
              <option value="">{t('dvids.noCollection')}</option>
              {collections?.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2 border-t border-c-border">
          {!isImported && (
            <button
              onClick={() => onImport?.(search?.id ?? '')}
              disabled={importing}
              className="btn-primary text-xs flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {importing ? t('dvids.importing') : t('dvids.import')}
            </button>
          )}

          {imported && (
            <>
              <button
                onClick={() => onFavorite?.(imported.id, !imported.is_favorite)}
                className={clsx('text-xs flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-colors',
                  imported.is_favorite ? 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30' : 'border-c-border text-c-muted hover:text-c-text'
                )}
              >
                <Star className="w-3.5 h-3.5" fill={imported.is_favorite ? 'currentColor' : 'none'} />
                {t('dvids.favorites')}
              </button>
              <button
                onClick={() => { if (confirm(t('dvids.deleteConfirm'))) onDelete?.(imported.id); }}
                className="text-xs flex items-center justify-center gap-1.5 py-2 rounded-lg border border-red-600/30 text-red-400 hover:bg-red-600/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('dvids.delete')}
              </button>
            </>
          )}

          {dvidsUrl && (
            <a href={dvidsUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1 justify-center">
              <ExternalLink className="w-3 h-3" /> View on DVIDS
            </a>
          )}
        </div>

        {/* Attribution */}
        <div className="text-[9px] text-c-dim text-center pt-2 border-t border-c-border">
          {t('dvids.attribution')}
        </div>
      </div>
    </div>
  );
}
