import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { mediaLibraryApi } from '../lib/api';
import type { MediaItem } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { Spinner } from '../components/ui/Spinner';
import { clsx } from 'clsx';
import {
  Search,
  Upload,
  Trash2,
  Play,
  Pause,
  X,
  Music,
  Sparkles,
  Tag,
  Plus,
  ChevronDown,
} from 'lucide-react';

type MediaType = '' | 'sticker' | 'icon' | 'animation' | 'sfx';

const TYPE_BADGE_COLORS: Record<string, string> = {
  sticker: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  icon: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  animation: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  sfx: 'bg-green-500/20 text-green-400 border-green-500/30',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaLibrary() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Filters
  const [typeFilter, setTypeFilter] = useState<MediaType>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadMeta, setUploadMeta] = useState({
    name: '',
    type: 'sticker' as string,
    category: '',
    tags: '',
    triggerTags: '',
  });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selected item
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Audio playback
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Tag editing
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState('');
  const [editingTriggerTagsId, setEditingTriggerTagsId] = useState<string | null>(null);
  const [newTriggerTagInput, setNewTriggerTagInput] = useState('');

  // Name editing
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  // Data fetching
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media-library', typeFilter, categoryFilter, searchQuery],
    queryFn: () =>
      mediaLibraryApi.list({
        type: typeFilter || undefined,
        category: categoryFilter || undefined,
        search: searchQuery || undefined,
      }),
  });

  const { data: categories = [] } = useQuery<Array<{ category: string; count: number }>>({
    queryKey: ['media-library', 'categories'],
    queryFn: mediaLibraryApi.categories,
  });

  // Mutations
  const uploadMut = useMutation({
    mutationFn: async () => {
      if (uploadFiles.length === 1) {
        return mediaLibraryApi.upload(uploadFiles[0], {
          name: uploadMeta.name || uploadFiles[0].name.replace(/\.[^.]+$/, ''),
          type: uploadMeta.type,
          category: uploadMeta.category,
          tags: uploadMeta.tags,
          triggerTags: uploadMeta.triggerTags,
        });
      }
      return mediaLibraryApi.bulkUpload(uploadFiles, {
        type: uploadMeta.type,
        category: uploadMeta.category,
        tags: uploadMeta.tags,
        triggerTags: uploadMeta.triggerTags,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library'] });
      setUploadFiles([]);
      setUploadMeta({ name: '', type: 'sticker', category: '', tags: '', triggerTags: '' });
      setShowUpload(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: mediaLibraryApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library'] });
      setSelectedId(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ name: string; tags: string[]; category: string; triggerTags: string[] }> }) =>
      mediaLibraryApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library'] });
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
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setUploadFiles(files);
      if (files.length === 1) {
        setUploadMeta((prev) => ({ ...prev, name: files[0].name.replace(/\.[^.]+$/, '') }));
      }
      setShowUpload(true);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setUploadFiles(files);
      if (files.length === 1) {
        setUploadMeta((prev) => ({ ...prev, name: files[0].name.replace(/\.[^.]+$/, '') }));
      }
      setShowUpload(true);
    }
  }, []);

  // Audio playback
  const togglePlay = useCallback((item: MediaItem) => {
    if (playingId === item.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(item.url);
      audio.onended = () => setPlayingId(null);
      audio.play();
      audioRef.current = audio;
      setPlayingId(item.id);
    }
  }, [playingId]);

  // Tag helpers
  const addTag = useCallback((item: MediaItem, tag: string) => {
    const tags = [...item.tags, tag.trim()].filter(Boolean);
    updateMut.mutate({ id: item.id, data: { tags } });
  }, [updateMut]);

  const removeTag = useCallback((item: MediaItem, tagToRemove: string) => {
    const tags = item.tags.filter((t) => t !== tagToRemove);
    updateMut.mutate({ id: item.id, data: { tags } });
  }, [updateMut]);

  const addTriggerTag = useCallback((item: MediaItem, tag: string) => {
    const triggerTags = [...item.triggerTags, tag.trim()].filter(Boolean);
    updateMut.mutate({ id: item.id, data: { triggerTags } });
  }, [updateMut]);

  const removeTriggerTag = useCallback((item: MediaItem, tagToRemove: string) => {
    const triggerTags = item.triggerTags.filter((t) => t !== tagToRemove);
    updateMut.mutate({ id: item.id, data: { triggerTags } });
  }, [updateMut]);

  const typeFilters: { value: MediaType; labelKey: string }[] = [
    { value: '', labelKey: 'mediaLibrary.allTypes' },
    { value: 'sticker', labelKey: 'mediaLibrary.stickers' },
    { value: 'icon', labelKey: 'mediaLibrary.icons' },
    { value: 'animation', labelKey: 'mediaLibrary.animations' },
    { value: 'sfx', labelKey: 'mediaLibrary.sfx' },
  ];

  const selectedItem = items.find((i) => i.id === selectedId);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={t('mediaLibrary.title')}
        subtitle={t('mediaLibrary.subtitle', { count: items.length })}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left filter panel */}
        <div className="w-52 border-r border-c-border overflow-auto p-4 space-y-5 shrink-0">
          {/* Type filter */}
          <div>
            <div className="text-xs text-c-muted uppercase tracking-wider mb-2">{t('mediaLibrary.type')}</div>
            <div className="space-y-0.5">
              {typeFilters.map(({ value, labelKey }) => (
                <button
                  key={value}
                  onClick={() => setTypeFilter(value)}
                  className={clsx(
                    'w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors',
                    typeFilter === value
                      ? 'bg-accent-muted text-accent-hover'
                      : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                  )}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Category filter */}
          <div>
            <div className="text-xs text-c-muted uppercase tracking-wider mb-2">{t('mediaLibrary.categories')}</div>
            <div className="space-y-0.5">
              <button
                onClick={() => setCategoryFilter('')}
                className={clsx(
                  'w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors',
                  !categoryFilter
                    ? 'bg-accent-muted text-accent-hover'
                    : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                )}
              >
                {t('mediaLibrary.allTypes')}
              </button>
              {categories.map((cat) => (
                <button
                  key={typeof cat === 'string' ? cat : cat.category}
                  onClick={() => setCategoryFilter(typeof cat === 'string' ? cat : cat.category)}
                  className={clsx(
                    'w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors flex justify-between',
                    categoryFilter === (typeof cat === 'string' ? cat : cat.category)
                      ? 'bg-accent-muted text-accent-hover'
                      : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                  )}
                >
                  <span>{typeof cat === 'string' ? cat : cat.category}</span>
                  {typeof cat !== 'string' && <span className="text-c-dim">{cat.count}</span>}
                </button>
              ))}
              {categories.length === 0 && (
                <div className="text-xs text-c-dim px-2 py-1">{t('mediaLibrary.general')}</div>
              )}
            </div>
          </div>

          {/* Upload button */}
          <button
            onClick={() => setShowUpload(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-accent-primary text-white text-xs font-medium hover:bg-accent-hover transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            {t('mediaLibrary.upload')}
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
                placeholder={t('mediaLibrary.search')}
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
              accept="image/*,audio/*,video/*,.gif,.webp,.svg,.lottie"
            />
          </div>

          {/* Upload panel */}
          {showUpload && (
            <div className="border-b border-c-border bg-c-surface px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-c-text">
                  {uploadFiles.length > 1 ? t('mediaLibrary.bulkUpload') : t('mediaLibrary.upload')}
                </h3>
                <button onClick={() => { setShowUpload(false); setUploadFiles([]); }} className="text-c-muted hover:text-c-text">
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
                  <div className="text-sm text-c-muted">{t('mediaLibrary.dragDrop')}</div>
                </div>
              )}

              {/* File selected - show meta form */}
              {uploadFiles.length > 0 && (
                <div className="space-y-3">
                  <div className="text-xs text-c-muted">
                    {uploadFiles.length} file(s): {uploadFiles.map((f) => f.name).join(', ')}
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {uploadFiles.length === 1 && (
                      <div>
                        <label className="text-xs text-c-muted block mb-1">{t('mediaLibrary.name')}</label>
                        <input
                          className="input text-xs"
                          value={uploadMeta.name}
                          onChange={(e) => setUploadMeta((p) => ({ ...p, name: e.target.value }))}
                        />
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-c-muted block mb-1">{t('mediaLibrary.type')}</label>
                      <div className="relative">
                        <select
                          className="input text-xs appearance-none pr-7"
                          value={uploadMeta.type}
                          onChange={(e) => setUploadMeta((p) => ({ ...p, type: e.target.value }))}
                        >
                          <option value="sticker">Sticker</option>
                          <option value="icon">Icon</option>
                          <option value="animation">Animation</option>
                          <option value="sfx">SFX</option>
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-c-dim pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-c-muted block mb-1">{t('mediaLibrary.category')}</label>
                      <input
                        className="input text-xs"
                        value={uploadMeta.category}
                        onChange={(e) => setUploadMeta((p) => ({ ...p, category: e.target.value }))}
                        placeholder={t('mediaLibrary.general')}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-c-muted block mb-1">{t('mediaLibrary.tags')}</label>
                      <input
                        className="input text-xs"
                        value={uploadMeta.tags}
                        onChange={(e) => setUploadMeta((p) => ({ ...p, tags: e.target.value }))}
                        placeholder="tag1, tag2"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-c-muted block mb-1">{t('mediaLibrary.triggerTags')}</label>
                      <input
                        className="input text-xs"
                        value={uploadMeta.triggerTags}
                        onChange={(e) => setUploadMeta((p) => ({ ...p, triggerTags: e.target.value }))}
                        placeholder={t('mediaLibrary.triggerTagsHint')}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => uploadMut.mutate()}
                      disabled={uploadMut.isPending}
                      className="px-4 py-1.5 rounded-lg bg-accent-primary text-white text-xs font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
                    >
                      {uploadMut.isPending ? <Spinner /> : t('mediaLibrary.upload')}
                    </button>
                    <button
                      onClick={() => { setUploadFiles([]); setShowUpload(false); }}
                      className="px-4 py-1.5 rounded-lg bg-c-elevated text-c-muted text-xs hover:text-c-text transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Drop zone overlay for main area */}
          <div
            className="flex-1 overflow-auto p-6 relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragging && (
              <div className="absolute inset-0 bg-accent-primary/10 border-2 border-dashed border-accent-primary rounded-xl z-10 flex items-center justify-center">
                <div className="text-accent-primary text-sm font-medium">{t('mediaLibrary.dragDrop')}</div>
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-16">
                <Sparkles className="w-10 h-10 text-c-dim mx-auto mb-3" />
                <div className="text-sm text-c-muted">{t('mediaLibrary.noItems')}</div>
                <div className="text-xs text-c-dim mt-1 max-w-xs mx-auto">{t('mediaLibrary.noItemsHint')}</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                {items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}
                    className={clsx(
                      'group relative card p-3 cursor-pointer hover:border-accent-primary transition-all',
                      selectedId === item.id && 'border-accent-primary bg-accent-muted'
                    )}
                  >
                    {/* Delete button on hover */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(t('mediaLibrary.deleteConfirm'))) {
                          deleteMut.mutate(item.id);
                        }
                      }}
                      className="absolute top-2 right-2 p-1 rounded bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-red-600"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>

                    {/* Preview */}
                    <div className="w-full aspect-square bg-c-bg rounded-lg mb-2 flex items-center justify-center overflow-hidden">
                      {item.type === 'sfx' ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePlay(item);
                          }}
                          className="flex flex-col items-center gap-1"
                        >
                          <Music className="w-8 h-8 text-green-400" />
                          {playingId === item.id ? (
                            <Pause className="w-4 h-4 text-green-400" />
                          ) : (
                            <Play className="w-4 h-4 text-c-dim" />
                          )}
                          {item.duration != null && (
                            <span className="text-xs text-c-dim">{t('mediaLibrary.duration', { duration: item.duration.toFixed(1) })}</span>
                          )}
                        </button>
                      ) : (
                        <img
                          src={item.url}
                          alt={item.name}
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
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
                        className="text-xs text-c-text font-medium truncate mb-1 cursor-text"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingNameId(item.id);
                          setEditNameValue(item.name);
                        }}
                        title={t('mediaLibrary.editName')}
                      >
                        {item.name}
                      </div>
                    )}

                    {/* Type badge + usage count */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border', TYPE_BADGE_COLORS[item.type] ?? 'bg-c-elevated text-c-muted border-c-border')}>
                        {item.type}
                      </span>
                      <span className="text-[10px] text-c-dim">{t('mediaLibrary.usageCount', { count: item.usageCount })}</span>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1">
                      {item.triggerTags.slice(0, 2).map((tag) => (
                        <span key={`tt-${tag}`} className="flex items-center gap-0.5 text-[10px] text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded">
                          <Tag className="w-2 h-2" />
                          {tag}
                        </span>
                      ))}
                      {item.tags.slice(0, 2).map((tag) => (
                        <span key={`t-${tag}`} className="flex items-center gap-0.5 text-[10px] text-cyan-400 bg-cyan-500/10 px-1 py-0.5 rounded">
                          <Tag className="w-2 h-2" />
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* File size */}
                    <div className="text-[10px] text-c-dim mt-1">{t('mediaLibrary.fileSize', { size: formatFileSize(item.filesize) })}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedItem && (
          <div className="w-72 border-l border-c-border overflow-auto p-4 shrink-0 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-c-text truncate">{selectedItem.name}</h3>
              <button onClick={() => setSelectedId(null)} className="text-c-muted hover:text-c-text">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Preview */}
            <div className="w-full aspect-square bg-c-bg rounded-lg flex items-center justify-center overflow-hidden">
              {selectedItem.type === 'sfx' ? (
                <button onClick={() => togglePlay(selectedItem)} className="flex flex-col items-center gap-2">
                  <Music className="w-12 h-12 text-green-400" />
                  {playingId === selectedItem.id ? (
                    <Pause className="w-6 h-6 text-green-400" />
                  ) : (
                    <Play className="w-6 h-6 text-c-dim" />
                  )}
                </button>
              ) : (
                <img src={selectedItem.url} alt={selectedItem.name} className="w-full h-full object-contain" />
              )}
            </div>

            {/* Info */}
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-c-muted">{t('mediaLibrary.type')}</span>
                <span className={clsx('px-1.5 py-0.5 rounded border', TYPE_BADGE_COLORS[selectedItem.type])}>{selectedItem.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-c-muted">{t('mediaLibrary.category')}</span>
                <span className="text-c-text">{selectedItem.category || t('mediaLibrary.general')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-c-muted">{t('mediaLibrary.fileSize', { size: '' })}</span>
                <span className="text-c-text">{formatFileSize(selectedItem.filesize)}</span>
              </div>
              {selectedItem.width && selectedItem.height && (
                <div className="flex justify-between">
                  <span className="text-c-muted">Dimensions</span>
                  <span className="text-c-text">{selectedItem.width} x {selectedItem.height}</span>
                </div>
              )}
              {selectedItem.duration != null && (
                <div className="flex justify-between">
                  <span className="text-c-muted">{t('mediaLibrary.duration', { duration: '' })}</span>
                  <span className="text-c-text">{selectedItem.duration.toFixed(1)}s</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-c-muted">{t('mediaLibrary.usageCount', { count: '' })}</span>
                <span className="text-c-text">{selectedItem.usageCount}</span>
              </div>
            </div>

            {/* Tags section */}
            <div>
              <div className="text-xs text-c-muted mb-1.5">{t('mediaLibrary.tags')}</div>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {selectedItem.tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 text-xs text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded group/tag"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(selectedItem, tag)}
                      className="opacity-0 group-hover/tag:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              {editingTagsId === selectedItem.id ? (
                <input
                  className="input text-xs w-full"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTagInput.trim()) {
                      addTag(selectedItem, newTagInput);
                      setNewTagInput('');
                    }
                    if (e.key === 'Escape') setEditingTagsId(null);
                  }}
                  onBlur={() => setEditingTagsId(null)}
                  placeholder={t('mediaLibrary.addTags')}
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => { setEditingTagsId(selectedItem.id); setNewTagInput(''); }}
                  className="flex items-center gap-1 text-xs text-c-dim hover:text-c-muted transition-colors"
                >
                  <Plus className="w-3 h-3" /> {t('mediaLibrary.addTags')}
                </button>
              )}
            </div>

            {/* Trigger tags section */}
            <div>
              <div className="text-xs text-c-muted mb-1">{t('mediaLibrary.triggerTags')}</div>
              <div className="text-[10px] text-c-dim mb-1.5">{t('mediaLibrary.triggerTagsHint')}</div>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {selectedItem.triggerTags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded group/tag"
                  >
                    {tag}
                    <button
                      onClick={() => removeTriggerTag(selectedItem, tag)}
                      className="opacity-0 group-hover/tag:opacity-100 transition-opacity"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              {editingTriggerTagsId === selectedItem.id ? (
                <input
                  className="input text-xs w-full"
                  value={newTriggerTagInput}
                  onChange={(e) => setNewTriggerTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTriggerTagInput.trim()) {
                      addTriggerTag(selectedItem, newTriggerTagInput);
                      setNewTriggerTagInput('');
                    }
                    if (e.key === 'Escape') setEditingTriggerTagsId(null);
                  }}
                  onBlur={() => setEditingTriggerTagsId(null)}
                  placeholder={t('mediaLibrary.addTags')}
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => { setEditingTriggerTagsId(selectedItem.id); setNewTriggerTagInput(''); }}
                  className="flex items-center gap-1 text-xs text-c-dim hover:text-c-muted transition-colors"
                >
                  <Plus className="w-3 h-3" /> {t('mediaLibrary.addTags')}
                </button>
              )}
            </div>

            {/* Delete */}
            <button
              onClick={() => {
                if (confirm(t('mediaLibrary.deleteConfirm'))) {
                  deleteMut.mutate(selectedItem.id);
                }
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('mediaLibrary.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
