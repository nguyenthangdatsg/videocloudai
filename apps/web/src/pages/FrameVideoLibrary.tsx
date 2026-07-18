import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { frameVideoLibraryApi } from '../lib/api';
import type { FrameVideoItem } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { Spinner } from '../components/ui/Spinner';
import { clsx } from 'clsx';
import {
  Search,
  Upload,
  Trash2,
  X,
  Sparkles,
  ChevronDown,
  Film,
  Play,
  VolumeX,
  ExternalLink,
} from 'lucide-react';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FrameVideoLibrary() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Filters - default to 'comparison' category per requirements
  const [categoryFilter, setCategoryFilter] = useState('comparison');
  const [searchQuery, setSearchQuery] = useState('');

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadMeta, setUploadMeta] = useState({
    name: '',
    category: 'comparison', // Default to comparison
  });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selected item
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Video hover playback ref
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Name editing
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  // Data fetching
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['frame-video-library', categoryFilter, searchQuery],
    queryFn: () =>
      frameVideoLibraryApi.list({
        category: categoryFilter || undefined,
        search: searchQuery || undefined,
      }),
  });

  const { data: rawCategories = [] } = useQuery<Array<{ category: string; count: number }>>({
    queryKey: ['frame-video-library', 'categories'],
    queryFn: frameVideoLibraryApi.categories,
  });

  // Ensure "comparison" is the first category in the sidebar category filter
  const categoriesList = (() => {
    const list = [...rawCategories].filter((c) => c && typeof c.category === 'string');
    const compIdx = list.findIndex((c) => c.category.toLowerCase() === 'comparison');
    const result: Array<{ category: string; count: number }> = [];

    if (compIdx !== -1) {
      result.push(list[compIdx]);
      list.splice(compIdx, 1);
    } else {
      result.push({ category: 'comparison', count: 0 });
    }
    result.push(...list);
    return result;
  })();

  // Mutations
  const uploadMut = useMutation({
    mutationFn: async () => {
      if (uploadFiles.length === 1) {
        return frameVideoLibraryApi.upload(uploadFiles[0], {
          name: uploadMeta.name || uploadFiles[0].name.replace(/\.[^.]+$/, ''),
          category: uploadMeta.category,
        });
      }
      return frameVideoLibraryApi.bulkUpload(uploadFiles, {
        category: uploadMeta.category,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['frame-video-library'] });
      setUploadFiles([]);
      setUploadMeta({ name: '', category: 'comparison' });
      setShowUpload(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: frameVideoLibraryApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['frame-video-library'] });
      setSelectedId(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ name: string; category: string }> }) =>
      frameVideoLibraryApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['frame-video-library'] });
    },
  });

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(mp4|webm|mov|m4v|html)$/i.test(f.name)
    );
    if (files.length > 0) {
      setUploadFiles(files);
      if (files.length === 1) {
        setUploadMeta((prev) => ({ ...prev, name: files[0].name.replace(/\.[^.]+$/, '') }));
      }
      setShowUpload(true);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      /\.(mp4|webm|mov|m4v|html)$/i.test(f.name)
    );
    if (files.length > 0) {
      setUploadFiles(files);
      if (files.length === 1) {
        setUploadMeta((prev) => ({ ...prev, name: files[0].name.replace(/\.[^.]+$/, '') }));
      }
      setShowUpload(true);
    }
  }, []);

  const handleMouseEnter = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item && item.mimeType !== 'text/html' && !item.filename.endsWith('.html')) {
      const video = videoRefs.current[itemId];
      if (video) {
        video.play().catch(() => {});
      }
    }
  };

  const handleMouseLeave = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item && item.mimeType !== 'text/html' && !item.filename.endsWith('.html')) {
      const video = videoRefs.current[itemId];
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
    }
  };

  const selectedItem = items.find((i) => i.id === selectedId);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={t('frameVideoLibrary.title')}
        subtitle={t('frameVideoLibrary.subtitle', { count: items.length })}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left filter panel */}
        <div className="w-52 border-r border-c-border overflow-auto p-4 space-y-5 shrink-0">
          {/* Category filter */}
          <div>
            <div className="text-xs text-c-muted uppercase tracking-wider mb-2">
              {t('frameVideoLibrary.categories')}
            </div>
            <div className="space-y-0.5">
              <button
                onClick={() => setCategoryFilter('')}
                className={clsx(
                  'w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors flex justify-between items-center',
                  !categoryFilter
                    ? 'bg-accent-muted text-accent-hover font-medium'
                    : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                )}
              >
                <span>{t('frameVideoLibrary.allTypes')}</span>
              </button>
              {categoriesList.map((cat) => (
                <button
                  key={cat.category}
                  onClick={() => setCategoryFilter(cat.category)}
                  className={clsx(
                    'w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors flex justify-between items-center',
                    categoryFilter === cat.category
                      ? 'bg-accent-muted text-accent-hover font-medium'
                      : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                  )}
                >
                  <span className="capitalize">{cat.category}</span>
                  <span className="text-[10px] text-c-dim bg-c-surface px-1.5 py-0.5 rounded-md border border-c-border">
                    {cat.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Upload button */}
          <button
            onClick={() => setShowUpload(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-accent-primary text-white text-xs font-medium hover:bg-accent-hover transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            {t('frameVideoLibrary.upload')}
          </button>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search bar */}
          <div className="px-6 py-3 border-b border-c-border flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-c-dim" />
              <input
                className="input pl-9"
                placeholder={t('frameVideoLibrary.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              accept="video/mp4,video/webm,video/quicktime,video/x-m4v,text/html,.html"
            />
          </div>

          {/* Upload panel */}
          {showUpload && (
            <div className="border-b border-c-border bg-c-surface px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-c-text">
                  {uploadFiles.length > 1 ? t('frameVideoLibrary.bulkUpload') : t('frameVideoLibrary.upload')}
                </h3>
                <button
                  onClick={() => {
                    setShowUpload(false);
                    setUploadFiles([]);
                  }}
                  className="text-c-muted hover:text-c-text"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Drop zone */}
              {uploadFiles.length === 0 && (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={clsx(
                    'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                    isDragging
                      ? 'border-accent-primary bg-accent-muted'
                      : 'border-c-border hover:border-c-muted'
                  )}
                >
                  <Upload className="w-8 h-8 text-c-dim mx-auto mb-2" />
                  <div className="text-sm text-c-muted">{t('frameVideoLibrary.dragDrop')}</div>
                </div>
              )}

              {/* File selected - show meta form */}
              {uploadFiles.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs text-c-muted">
                    {uploadFiles.length} file(s): {uploadFiles.map((f) => f.name).join(', ')}
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-w-xl">
                    {uploadFiles.length === 1 && (
                      <div>
                        <label className="text-xs text-c-muted block mb-1">{t('frameVideoLibrary.name')}</label>
                        <input
                          className="input text-xs"
                          value={uploadMeta.name}
                          onChange={(e) => setUploadMeta((p) => ({ ...p, name: e.target.value }))}
                        />
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-c-muted block mb-1">{t('frameVideoLibrary.category')}</label>
                      <input
                        className="input text-xs"
                        value={uploadMeta.category}
                        onChange={(e) => setUploadMeta((p) => ({ ...p, category: e.target.value }))}
                        placeholder="comparison"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => uploadMut.mutate()}
                      disabled={uploadMut.isPending}
                      className="px-4 py-1.5 rounded-lg bg-accent-primary text-white text-xs font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
                    >
                      {uploadMut.isPending ? <Spinner /> : t('frameVideoLibrary.upload')}
                    </button>
                    <button
                      onClick={() => {
                        setUploadFiles([]);
                        setShowUpload(false);
                      }}
                      className="px-4 py-1.5 rounded-lg bg-c-elevated text-c-muted text-xs hover:text-c-text transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Grid display */}
          <div
            className="flex-1 overflow-auto p-6 relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragging && (
              <div className="absolute inset-0 bg-accent-primary/10 border-2 border-dashed border-accent-primary rounded-xl z-10 flex items-center justify-center">
                <div className="text-accent-primary text-sm font-medium">{t('frameVideoLibrary.dragDrop')}</div>
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-16">
                <Film className="w-10 h-10 text-c-dim mx-auto mb-3" />
                <div className="text-sm text-c-muted">{t('frameVideoLibrary.noItems')}</div>
                <div className="text-xs text-c-dim mt-1 max-w-xs mx-auto">{t('frameVideoLibrary.noItemsHint')}</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                {items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                    onMouseEnter={() => handleMouseEnter(item.id)}
                    onMouseLeave={() => handleMouseLeave(item.id)}
                    className={clsx(
                      'group relative card p-3 cursor-pointer hover:border-accent-primary transition-all flex flex-col',
                      selectedId === item.id && 'border-accent-primary bg-accent-muted'
                    )}
                  >
                    {/* Delete button on hover */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(t('frameVideoLibrary.deleteConfirm'))) {
                          deleteMut.mutate(item.id);
                        }
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-red-600 shadow-md"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Preview video or iframe */}
                    <div className="w-full aspect-video bg-black rounded-lg mb-2 relative flex items-center justify-center overflow-hidden border border-c-border">
                      {item.mimeType === 'text/html' || item.filename.endsWith('.html') ? (
                        <iframe
                          src={item.url}
                          className="w-full h-full border-0 pointer-events-none"
                          title={item.name}
                        />
                      ) : (
                        <>
                          <video
                            ref={(el) => {
                              videoRefs.current[item.id] = el;
                            }}
                            src={item.url}
                            muted
                            loop
                            playsInline
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute bottom-2 left-2 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-white flex items-center gap-1 font-medium">
                            <VolumeX className="w-2.5 h-2.5" />
                            {item.duration != null && (
                              <span>
                                {t('frameVideoLibrary.duration', { duration: item.duration.toFixed(1) })}
                              </span>
                            )}
                          </div>
                          <div className="absolute inset-0 bg-black/25 flex items-center justify-center opacity-100 group-hover:opacity-0 transition-opacity pointer-events-none">
                            <Play className="w-7 h-7 text-white/80" />
                          </div>
                        </>
                      )}
                    </div>

                    {/* Name */}
                    {editingNameId === item.id ? (
                      <input
                        className="input text-xs mb-1 w-full"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        onBlur={() => {
                          if (editNameValue.trim() && editNameValue !== item.name) {
                            updateMut.mutate({ id: item.id, data: { name: editNameValue.trim() } });
                          }
                          setEditingNameId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditingNameId(null);
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div
                        className="text-xs text-c-text font-semibold truncate mb-1 cursor-text group-hover:text-accent-hover transition-colors"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingNameId(item.id);
                          setEditNameValue(item.name);
                        }}
                        title={t('frameVideoLibrary.editName')}
                      >
                        {item.name}
                      </div>
                    )}

                    {/* Category + resolution / size */}
                    <div className="flex items-center justify-between text-[10px] text-c-dim mt-auto pt-2 border-t border-c-border/40">
                      <span className="capitalize bg-c-surface px-1.5 py-0.5 rounded border border-c-border">
                        {item.category}
                      </span>
                      {item.width && item.height && (
                        <span>
                          {t('frameVideoLibrary.resolution', { width: item.width, height: item.height })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Selected item metadata panel */}
        {selectedItem && (
          <div className="w-64 border-l border-c-border bg-c-surface overflow-auto p-4 shrink-0 flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-c-muted">
                Metadata Details
              </h3>
              <button
                onClick={() => setSelectedId(null)}
                className="p-1 rounded hover:bg-c-elevated text-c-muted hover:text-c-text transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-video bg-black rounded-lg overflow-hidden border border-c-border">
              {selectedItem.mimeType === 'text/html' || selectedItem.filename.endsWith('.html') ? (
                <iframe src={selectedItem.url} className="w-full h-full border-0" title={selectedItem.name} />
              ) : (
                <video src={selectedItem.url} controls muted loop className="w-full h-full object-contain" />
              )}
            </div>

            {(selectedItem.mimeType === 'text/html' || selectedItem.filename.endsWith('.html')) && (
              <a
                href={selectedItem.url}
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-accent-primary hover:bg-accent-hover text-black font-bold rounded-lg transition-colors shadow-md mt-2 text-center"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Run / Open Web Frame
              </a>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-c-dim block mb-0.5">Filename</span>
                <span className="font-mono text-[10px] text-c-text break-all">
                  {selectedItem.filename}
                </span>
              </div>

              <div>
                <span className="text-c-dim block mb-0.5">URL Path</span>
                <a
                  href={selectedItem.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-primary hover:underline break-all"
                >
                  {selectedItem.url}
                </a>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-c-dim block mb-0.5">Resolution</span>
                  <span className="text-c-text font-medium">
                    {selectedItem.width} x {selectedItem.height}
                  </span>
                </div>
                <div>
                  <span className="text-c-dim block mb-0.5">Duration</span>
                  <span className="text-c-text font-medium">
                    {selectedItem.duration?.toFixed(2)}s
                  </span>
                </div>
                <div>
                  <span className="text-c-dim block mb-0.5">Size</span>
                  <span className="text-c-text font-medium">
                    {formatFileSize(selectedItem.filesize)}
                  </span>
                </div>
                <div>
                  <span className="text-c-dim block mb-0.5">Mime Type</span>
                  <span className="text-c-text font-medium font-mono text-[10px]">
                    {selectedItem.mimeType}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-c-dim block mb-1">Rename Item</span>
                <input
                  className="input py-1 text-xs"
                  value={selectedItem.name}
                  onChange={(e) =>
                    updateMut.mutate({ id: selectedItem.id, data: { name: e.target.value } })
                  }
                />
              </div>

              <div>
                <span className="text-c-dim block mb-1">Change Category</span>
                <input
                  className="input py-1 text-xs"
                  value={selectedItem.category}
                  onChange={(e) =>
                    updateMut.mutate({ id: selectedItem.id, data: { category: e.target.value } })
                  }
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={() => {
                    if (confirm(t('frameVideoLibrary.deleteConfirm'))) {
                      deleteMut.mutate(selectedItem.id);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-medium hover:bg-red-500 hover:text-white transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Asset
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
