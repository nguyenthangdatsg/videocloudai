import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  FileText,
  AlertTriangle,
  BookOpen,
  Search,
  MoreVertical,
  X,
  Clock,
  Hash,
  Type,
  Layers,
} from 'lucide-react';
import { scriptStudioApi } from '../../lib/api';
import { useAppStore } from '../../store';
import { FormatGuide } from './FormatGuide';

// ── Types ──

interface ScriptDocSummary {
  id: string;
  title: string;
  status: string;
  segmentsCount: number;
  blocksCount: number;
  wordsCount: number;
  estDurationSeconds: number;
  warningsCount: number;
  linkedStoryboardId: string | null;
  linkedStoryboardName: string | null;
  createdAt: string;
  updatedAt: string;
}

type DocStatus = 'draft' | 'parsed' | 'narration_copied' | 'aligned' | 'ready' | 'published';

const STATUS_CLASSES: Record<string, string> = {
  draft: 'bg-gray-500/15 text-gray-400',
  parsed: 'bg-blue-500/15 text-blue-400',
  narration_copied: 'bg-indigo-500/15 text-indigo-400',
  aligned: 'bg-purple-500/15 text-purple-400',
  producing: 'bg-orange-500/15 text-orange-400',
  ready: 'bg-green-500/15 text-green-400',
  published: 'bg-emerald-500/15 text-emerald-400',
};

function formatDuration(seconds: number): string {
  if (seconds === 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `~${m}m ${s.toString().padStart(2, '0')}s`;
}

// ── Paste Modal ──

function PasteModal({ onSubmit, onClose }: { onSubmit: (md: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const lines = text.split('\n').length;
  const chars = text.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in" onClick={onClose}>
      <div className="card p-6 w-full max-w-2xl mx-4 space-y-4 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-c-text">{t('scriptStudio.pasteMarkdown')}</h3>
          <button onClick={onClose} className="text-c-dim hover:text-c-text p-1 rounded-lg hover:bg-c-elevated transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <textarea
          className="input w-full h-64 font-mono text-sm resize-none"
          placeholder={t('scriptStudio.pasteHere')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="flex justify-between items-center">
          <span className="text-xs text-c-dim">
            {chars.toLocaleString()} {t('scriptStudio.chars')} · {lines} {t('scriptStudio.lines')}
          </span>
          <div className="flex gap-2">
            <button className="btn-secondary text-sm cursor-pointer" onClick={onClose}>
              {t('scriptStudio.cancel')}
            </button>
            <button
              className="btn-primary text-sm cursor-pointer"
              onClick={() => { if (text.trim()) onSubmit(text); }}
              disabled={!text.trim()}
            >
              {t('scriptStudio.parseAndSave')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Row Menu (fixed-position to escape table overflow clipping) ──

function RowMenu({ docId, currentStatus, anchorRect, onClose }: {
  docId: string;
  currentStatus: string;
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pushNotification } = useAppStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DocStatus }) => scriptStudioApi.setStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['script-studio-docs'] }); onClose(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scriptStudioApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['script-studio-docs'] });
      pushNotification({ id: `del-${Date.now()}`, type: 'success', title: t('scriptStudio.deleted') });
      onClose();
    },
  });

  const allStatuses: DocStatus[] = ['draft', 'parsed', 'narration_copied', 'aligned', 'ready', 'published'];
  const statusOptions = allStatuses.filter((s) => s !== currentStatus);

  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    right: window.innerWidth - anchorRect.right,
    zIndex: 50,
  };

  return (
    <div ref={menuRef} style={style} className="card p-1 min-w-[180px] shadow-xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
      {statusOptions.map((s) => (
        <button
          key={s}
          className="w-full text-left px-3 py-2 text-sm text-c-text hover:bg-c-hover rounded cursor-pointer transition-colors"
          onClick={() => statusMutation.mutate({ id: docId, status: s })}
        >
          {t(`scriptStudio.status.${s}`)}
        </button>
      ))}
      <hr className="my-1 border-c-border" />
      <button
        className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-c-hover rounded cursor-pointer transition-colors"
        onClick={() => deleteMutation.mutate(docId)}
      >
        {t('scriptStudio.deleteDoc')}
      </button>
    </div>
  );
}

// ── Skeleton Row ──

function SkeletonRow() {
  return (
    <tr className="border-b border-c-border animate-pulse">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="p-3"><div className="h-4 bg-c-elevated rounded w-3/4" /></td>
      ))}
    </tr>
  );
}

// ── Dashboard ──

export function ScriptStudioDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushNotification } = useAppStore();
  const [showPaste, setShowPaste] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenu, setOpenMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const toggleMenu = useCallback((e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    setOpenMenu((prev) => prev?.id === docId ? null : { id: docId, rect });
  }, []);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['script-studio-docs'],
    queryFn: scriptStudioApi.list,
  });

  const createMutation = useMutation({
    mutationFn: (md: string) => scriptStudioApi.create(md),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['script-studio-docs'] });
      if (result?.doc) navigate(`/script-studio/${result.doc.id}`);
    },
    onError: (err) => {
      pushNotification({ id: `err-${Date.now()}`, type: 'error', title: (err as Error).message });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => createMutation.mutate(reader.result as string);
    reader.readAsText(file);
    e.target.value = '';
  };

  const filtered = docs.filter((d: ScriptDocSummary) => {
    if (filterStatus && d.status !== filterStatus) return false;
    if (searchQuery && !d.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const totalDuration = docs.reduce((s: number, d: ScriptDocSummary) => s + d.estDurationSeconds, 0);
  const readyCount = docs.filter((d: ScriptDocSummary) => d.status === 'ready').length;
  const publishedCount = docs.filter((d: ScriptDocSummary) => d.status === 'published').length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-c-text">{t('scriptStudio.title')}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-secondary flex items-center gap-2 text-sm cursor-pointer" onClick={() => navigate('/storyboard')}>
              <Layers className="w-4 h-4" />
              {t('nav.storyboard')}
            </button>
            <label className="btn-secondary flex items-center gap-2 cursor-pointer text-sm">
              <Upload className="w-4 h-4" />
              {t('scriptStudio.uploadMd')}
              <input type="file" accept=".md,.txt,.markdown" className="hidden" onChange={handleFileUpload} />
            </label>
            <button className="btn-secondary flex items-center gap-2 text-sm cursor-pointer" onClick={() => setShowPaste(true)}>
              <FileText className="w-4 h-4" />
              {t('scriptStudio.pasteMarkdown')}
            </button>
            <button className="btn-secondary flex items-center gap-2 text-sm cursor-pointer" onClick={() => setShowGuide(true)}>
              <BookOpen className="w-4 h-4" />
              {t('scriptStudio.formatGuide')}
            </button>
          </div>
        </div>

        {/* Summary strip */}
        {docs.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="flex items-center gap-1.5 text-c-muted">
              <Hash className="w-3.5 h-3.5" />
              {t('scriptStudio.summaryStrip', {
                total: docs.length,
                ready: readyCount,
                published: publishedCount,
                duration: formatDuration(totalDuration),
              })}
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 items-center flex-wrap">
          <div className="relative flex-1 max-w-xs min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-c-dim pointer-events-none" />
            <input
              className="input w-full pl-9 text-sm"
              placeholder={t('scriptStudio.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="input text-sm w-auto min-w-[140px]"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">{t('scriptStudio.allStatuses')}</option>
            {['draft', 'parsed', 'narration_copied', 'aligned', 'producing', 'ready', 'published'].map((s) => (
              <option key={s} value={s}>{t(`scriptStudio.status.${s}`)}</option>
            ))}
          </select>
        </div>

        {/* Empty state */}
        {!isLoading && docs.length === 0 && (
          <div className="text-center py-16">
            <FileText className="w-14 h-14 mx-auto mb-4 text-c-dim opacity-40" />
            <p className="text-lg text-c-muted mb-4">{t('scriptStudio.emptyLibrary')}</p>
            <div className="flex justify-center gap-3">
              <label className="btn-primary flex items-center gap-2 cursor-pointer text-sm">
                <Upload className="w-4 h-4" />
                {t('scriptStudio.uploadMd')}
                <input type="file" accept=".md,.txt,.markdown" className="hidden" onChange={handleFileUpload} />
              </label>
              <button className="btn-secondary flex items-center gap-2 text-sm cursor-pointer" onClick={() => setShowGuide(true)}>
                <BookOpen className="w-4 h-4" />
                {t('scriptStudio.formatGuide')}
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {(isLoading || filtered.length > 0) && (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-c-border">
                  <th className="text-left p-3 text-c-dim font-medium whitespace-nowrap">{t('scriptStudio.colTitle')}</th>
                  <th className="text-left p-3 text-c-dim font-medium whitespace-nowrap">{t('scriptStudio.colStatus')}</th>
                  <th className="text-center p-3 text-c-dim font-medium whitespace-nowrap hidden md:table-cell">{t('scriptStudio.colSegments')}</th>
                  <th className="text-center p-3 text-c-dim font-medium whitespace-nowrap hidden lg:table-cell">{t('scriptStudio.colBlocks')}</th>
                  <th className="text-center p-3 text-c-dim font-medium whitespace-nowrap hidden md:table-cell">{t('scriptStudio.colWords')}</th>
                  <th className="text-left p-3 text-c-dim font-medium whitespace-nowrap hidden sm:table-cell">{t('scriptStudio.colDuration')}</th>
                  <th className="text-center p-3 text-c-dim font-medium whitespace-nowrap hidden lg:table-cell">{t('scriptStudio.colWarnings')}</th>
                  <th className="text-left p-3 text-c-dim font-medium whitespace-nowrap hidden xl:table-cell">{t('scriptStudio.colStoryboard')}</th>
                  <th className="text-left p-3 text-c-dim font-medium whitespace-nowrap hidden sm:table-cell">{t('scriptStudio.colUpdated')}</th>
                  <th className="p-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
                {!isLoading && filtered.map((doc: ScriptDocSummary) => (
                  <tr
                    key={doc.id}
                    className="border-b border-c-border hover:bg-c-hover cursor-pointer transition-colors duration-150"
                    onClick={() => navigate(`/script-studio/${doc.id}`)}
                  >
                    <td className="p-3 text-c-text font-medium max-w-[240px] truncate">{doc.title}</td>
                    <td className="p-3">
                      <span className={`badge ${STATUS_CLASSES[doc.status] || STATUS_CLASSES.draft} ${doc.status === 'producing' ? 'animate-pulse' : ''}`}>
                        {t(`scriptStudio.status.${doc.status}`)}
                      </span>
                    </td>
                    <td className="p-3 text-center text-c-muted tabular-nums hidden md:table-cell">{doc.segmentsCount}</td>
                    <td className="p-3 text-center text-c-muted tabular-nums hidden lg:table-cell">{doc.blocksCount}</td>
                    <td className="p-3 text-center text-c-muted tabular-nums hidden md:table-cell">{doc.wordsCount.toLocaleString()}</td>
                    <td className="p-3 text-c-muted whitespace-nowrap hidden sm:table-cell">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-c-dim" />
                        {formatDuration(doc.estDurationSeconds)}
                      </span>
                    </td>
                    <td className="p-3 text-center hidden lg:table-cell">
                      {doc.warningsCount > 0 ? (
                        <span className="badge bg-amber-500/15 text-amber-400">
                          <AlertTriangle className="w-3 h-3" />
                          {doc.warningsCount}
                        </span>
                      ) : (
                        <span className="text-c-dim">—</span>
                      )}
                    </td>
                    <td className="p-3 text-c-muted max-w-[140px] truncate hidden xl:table-cell">
                      {doc.linkedStoryboardName || '—'}
                    </td>
                    <td className="p-3 text-c-dim text-xs whitespace-nowrap hidden sm:table-cell">
                      {new Date(doc.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="p-3">
                      <button
                        className="text-c-dim hover:text-c-text p-1.5 rounded-lg hover:bg-c-elevated transition-colors cursor-pointer"
                        onClick={(e) => toggleMenu(e, doc.id)}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {openMenu && (
        <RowMenu
          docId={openMenu.id}
          currentStatus={docs.find((d: ScriptDocSummary) => d.id === openMenu.id)?.status ?? ''}
          anchorRect={openMenu.rect}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {showPaste && (
        <PasteModal
          onSubmit={(md) => { setShowPaste(false); createMutation.mutate(md); }}
          onClose={() => setShowPaste(false)}
        />
      )}
      {showGuide && <FormatGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}
