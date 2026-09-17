import { useState, useEffect } from 'react';
import { Search, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dvidsApi } from '../../lib/api';
import { DvidsSearchFilters, DVIDS_BRANCHES, DVIDS_CATEGORIES } from './types';

interface Props {
  filters: DvidsSearchFilters;
  onChange: (filters: DvidsSearchFilters) => void;
  onSearch: () => void;
  importedCount: number;
}

export function DvidsSearchPanel({ filters, onChange, onSearch, importedCount }: Props) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    dvidsApi.suggestions().then((d: any) => setSuggestions(d.suggestions || d));
  }, []);

  const set = (key: keyof DvidsSearchFilters, value: any) => {
    onChange({ ...filters, [key]: value, page: 1 });
  };

  const reset = () => {
    onChange({ q: '', branch: '', category: '', aspectRatio: '', hd: false, fromDuration: '', toDuration: '', fromDate: '', toDate: '', sort: 'date', sortDir: 'desc', page: 1 });
  };

  return (
    <div className="w-[280px] flex-shrink-0 border-r border-c-border overflow-y-auto p-4 space-y-4">
      {/* Search */}
      <div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-c-dim" />
          <input
            type="text"
            placeholder={t('dvids.searchPlaceholder')}
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            className="input pl-8 text-sm w-full"
          />
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={onSearch} className="btn-primary text-xs flex-1">{t('dvids.search')}</button>
          <button onClick={reset} className="btn-secondary text-xs p-2" title="Reset"><RotateCcw className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Branch */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.branch')}</label>
        <select value={filters.branch} onChange={(e) => set('branch', e.target.value)} className="input text-sm w-full">
          <option value="">{t('dvids.allBranches')}</option>
          {DVIDS_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Category */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.category')}</label>
        <select value={filters.category} onChange={(e) => set('category', e.target.value)} className="input text-sm w-full">
          <option value="">{t('dvids.allCategories')}</option>
          {DVIDS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Aspect Ratio */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.aspectRatio')}</label>
        <div className="flex gap-1.5 flex-wrap">
          {['', '16:9', 'portrait', 'square'].map(ar => (
            <button
              key={ar}
              onClick={() => set('aspectRatio', ar)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                filters.aspectRatio === ar ? 'bg-cyan-600/20 text-cyan-400 border-cyan-600/30' : 'border-c-border text-c-muted hover:text-c-text'
              }`}
            >
              {ar || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* HD Toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={filters.hd} onChange={(e) => set('hd', e.target.checked)} className="rounded" />
        <span className="text-xs text-c-muted">{t('dvids.hdOnly')}</span>
      </label>

      {/* Duration */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.duration')}</label>
        <div className="flex gap-2">
          <input type="number" placeholder={t('dvids.durationMin')} value={filters.fromDuration} onChange={(e) => set('fromDuration', e.target.value)} className="input text-xs w-1/2" min="0" />
          <input type="number" placeholder={t('dvids.durationMax')} value={filters.toDuration} onChange={(e) => set('toDuration', e.target.value)} className="input text-xs w-1/2" min="0" />
        </div>
      </div>

      {/* Date Range */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.dateRange')}</label>
        <div className="space-y-1.5">
          <input type="date" value={filters.fromDate} onChange={(e) => set('fromDate', e.target.value)} className="input text-xs w-full" />
          <input type="date" value={filters.toDate} onChange={(e) => set('toDate', e.target.value)} className="input text-xs w-full" />
        </div>
      </div>

      {/* Sort */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.sort')}</label>
        <select value={filters.sort} onChange={(e) => set('sort', e.target.value)} className="input text-sm w-full">
          <option value="date">{t('dvids.sortDate')}</option>
          <option value="score">{t('dvids.sortScore')}</option>
          <option value="rating">{t('dvids.sortRating')}</option>
        </select>
      </div>

      {/* Smart Suggestions */}
      <div>
        <label className="text-xs text-c-muted mb-2 block">{t('dvids.suggestions')}</label>
        {Object.entries(suggestions).map(([cat, items]) => (
          <div key={cat} className="mb-2">
            <span className="text-[10px] font-medium text-c-dim uppercase tracking-wide">{t(`dvids.${cat}`)}</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {(items as string[]).slice(0, 6).map(kw => (
                <button
                  key={kw}
                  onClick={() => { onChange({ ...filters, q: kw, page: 1 }); onSearch(); }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-c-elevated text-c-muted hover:text-c-text hover:bg-c-surface border border-c-border transition-colors"
                >
                  {kw}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Imported count */}
      <div className="border-t border-c-border pt-3">
        <span className="text-xs text-c-dim">{t('dvids.imported')}: {importedCount}</span>
      </div>
    </div>
  );
}
