import { useState, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dvidsApi } from '../lib/api';
import { DvidsSearchFilters, DvidsSearchResult, DvidsImportedAsset } from './dvids/types';
import { DvidsSearchPanel } from './dvids/DvidsSearchPanel';
import { DvidsResultsGrid } from './dvids/DvidsResultsGrid';
import { DvidsDetailPanel } from './dvids/DvidsDetailPanel';

const DEFAULT_FILTERS: DvidsSearchFilters = {
  q: '', branch: '', category: '', aspectRatio: '', hd: false,
  fromDuration: '', toDuration: '', fromDate: '', toDate: '',
  sort: 'date', sortDir: 'desc', page: 1,
};

export function DvidsBrowser() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<DvidsSearchFilters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<'search' | 'imported'>('search');
  const [searchResults, setSearchResults] = useState<DvidsSearchResult[]>([]);
  const [importedAssets, setImportedAssets] = useState<DvidsImportedAsset[]>([]);
  const [totalSearch, setTotalSearch] = useState(0);
  const [totalImported, setTotalImported] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<DvidsSearchResult | DvidsImportedAsset | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [collections, setCollections] = useState<string[]>([]);

  const doSearch = useCallback(async (f?: DvidsSearchFilters) => {
    const ff = f ?? filters;
    if (!ff.q.trim()) return;
    setLoading(true);
    try {
      const data = await dvidsApi.search({
        q: ff.q, branch: ff.branch, category: ff.category, aspectRatio: ff.aspectRatio,
        hd: ff.hd || undefined, fromDuration: ff.fromDuration || undefined, toDuration: ff.toDuration || undefined,
        fromDate: ff.fromDate || undefined, toDate: ff.toDate || undefined,
        sort: ff.sort, sortDir: ff.sortDir, page: ff.page, maxResults: 24,
      });
      setSearchResults(data.results || []);
      setTotalSearch(data.pageInfo?.total ?? 0);
      setTab('search');
    } catch (err) {
      console.error('DVIDS search error:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadImported = useCallback(async (page = 1) => {
    try {
      const data = await dvidsApi.imported({ page, limit: 24 });
      setImportedAssets(data.assets || []);
      setTotalImported(data.total ?? 0);
      const colData = await dvidsApi.collections();
      setCollections(colData.collections || []);
    } catch (err) {
      console.error('Load imported error:', err);
    }
  }, []);

  const handleSearch = () => doSearch();

  const handleTabChange = (t: 'search' | 'imported') => {
    setTab(t);
    if (t === 'imported') loadImported();
  };

  const handleSelect = (item: DvidsSearchResult | DvidsImportedAsset) => {
    setSelectedItem(item);
  };

  const handleCheck = (id: string, checked: boolean) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleImport = async (dvidsId: string) => {
    setImporting(true);
    try {
      const data = await dvidsApi.download(dvidsId);
      if (data.ok) {
        setSelectedItem(data.asset);
        loadImported();
      }
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setImporting(false);
    }
  };

  const handleBulkImport = async () => {
    setBulkImporting(true);
    try {
      await dvidsApi.downloadBatch([...checkedIds], () => {});
      setCheckedIds(new Set());
      loadImported();
    } catch (err) {
      console.error('Bulk import error:', err);
    } finally {
      setBulkImporting(false);
    }
  };

  const handleFavorite = async (id: number, fav: boolean) => {
    await dvidsApi.updateImported(id, { is_favorite: fav });
    loadImported();
    if (selectedItem && 'id' in selectedItem && (selectedItem as any).id === id) {
      const data = await dvidsApi.importedById(id);
      setSelectedItem(data.asset);
    }
  };

  const handleUpdateTags = async (id: number, tags: string[]) => {
    await dvidsApi.updateImported(id, { tags });
    loadImported();
    const data = await dvidsApi.importedById(id);
    setSelectedItem(data.asset);
  };

  const handleUpdateCollection = async (id: number, collection: string) => {
    await dvidsApi.updateImported(id, { collection });
    loadImported();
  };

  const handleAutoTag = async (id: number) => {
    await dvidsApi.autoTag(id);
    loadImported();
    const data = await dvidsApi.importedById(id);
    setSelectedItem(data.asset);
  };

  const handleDelete = async (id: number) => {
    await dvidsApi.deleteImported(id);
    setSelectedItem(null);
    loadImported();
  };

  const handlePageChange = (p: number) => {
    if (tab === 'search') {
      const f = { ...filters, page: p };
      setFilters(f);
      doSearch(f);
    } else {
      loadImported(p);
    }
  };

  const isImported = tab === 'imported' || (selectedItem && 'imported_at' in selectedItem);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-c-border">
        <Shield className="w-5 h-5 text-cyan-400" />
        <div>
          <h1 className="text-sm font-semibold text-c-text">{t('dvids.title')}</h1>
          <p className="text-[10px] text-c-dim">{t('dvids.subtitle')}</p>
        </div>
      </div>

      {/* 3-Panel Layout */}
      <div className="flex flex-1 overflow-hidden">
        <DvidsSearchPanel
          filters={filters}
          onChange={setFilters}
          onSearch={handleSearch}
          importedCount={totalImported}
        />

        <DvidsResultsGrid
          tab={tab}
          onTabChange={handleTabChange}
          searchResults={searchResults}
          importedAssets={importedAssets}
          totalSearch={totalSearch}
          totalImported={totalImported}
          page={filters.page}
          onPageChange={handlePageChange}
          selectedId={selectedItem ? ('dvids_id' in selectedItem ? (selectedItem as any).id : (selectedItem as any).id) : null}
          onSelect={handleSelect}
          checkedIds={checkedIds}
          onCheck={handleCheck}
          onBulkImport={handleBulkImport}
          loading={loading}
          bulkImporting={bulkImporting}
        />

        {selectedItem && (
          <DvidsDetailPanel
            item={selectedItem}
            isImported={!!isImported}
            onClose={() => setSelectedItem(null)}
            onImport={handleImport}
            onFavorite={handleFavorite}
            onUpdateTags={handleUpdateTags}
            onUpdateCollection={handleUpdateCollection}
            onAutoTag={handleAutoTag}
            onDelete={handleDelete}
            importing={importing}
            collections={collections}
          />
        )}
      </div>
    </div>
  );
}
