import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { DvidsSearchResult, DvidsImportedAsset } from './types';
import { DvidsVideoCard } from './DvidsVideoCard';

interface Props {
  tab: 'search' | 'imported';
  onTabChange: (tab: 'search' | 'imported') => void;
  searchResults: DvidsSearchResult[];
  importedAssets: DvidsImportedAsset[];
  totalSearch: number;
  totalImported: number;
  page: number;
  onPageChange: (page: number) => void;
  selectedId: string | number | null;
  onSelect: (item: DvidsSearchResult | DvidsImportedAsset) => void;
  checkedIds: Set<string>;
  onCheck: (id: string, checked: boolean) => void;
  onBulkImport: () => void;
  loading?: boolean;
  bulkImporting?: boolean;
}

export function DvidsResultsGrid({
  tab, onTabChange, searchResults, importedAssets, totalSearch, totalImported,
  page, onPageChange, selectedId, onSelect, checkedIds, onCheck, onBulkImport, loading, bulkImporting,
}: Props) {
  const { t } = useTranslation();
  const items = tab === 'search' ? searchResults : importedAssets;
  const total = tab === 'search' ? totalSearch : totalImported;
  const perPage = 24;
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tabs + Bulk Actions */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-c-border">
        <div className="flex gap-1">
          <button
            onClick={() => onTabChange('search')}
            className={clsx('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              tab === 'search' ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text'
            )}
          >
            {t('dvids.searchResults')} {totalSearch > 0 && `(${totalSearch})`}
          </button>
          <button
            onClick={() => onTabChange('imported')}
            className={clsx('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              tab === 'imported' ? 'bg-green-600/20 text-green-400' : 'text-c-muted hover:text-c-text'
            )}
          >
            {t('dvids.imported')} {totalImported > 0 && `(${totalImported})`}
          </button>
        </div>

        {tab === 'search' && checkedIds.size > 0 && (
          <button
            onClick={onBulkImport}
            disabled={bulkImporting}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {bulkImporting
              ? t('dvids.importing')
              : `${t('dvids.importSelected')} (${checkedIds.size})`}
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-c-dim">
            <p className="text-sm">{tab === 'search' ? t('dvids.noResults') : t('dvids.noImported')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => {
              const itemId = 'dvids_id' in item ? (item as DvidsImportedAsset).dvids_id : (item as DvidsSearchResult).id;
              const numId = 'id' in item && typeof (item as any).id === 'number' ? (item as any).id : itemId;
              return (
                <DvidsVideoCard
                  key={itemId}
                  item={item}
                  selected={selectedId === numId || selectedId === itemId}
                  checked={checkedIds.has(String(itemId))}
                  onSelect={() => onSelect(item)}
                  onCheck={(c) => onCheck(String(itemId), c)}
                  showCheckbox={tab === 'search'}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-3 border-t border-c-border">
          <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="btn-secondary p-1.5 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-c-muted">{page} / {totalPages}</span>
          <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="btn-secondary p-1.5 disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
