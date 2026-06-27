import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { imageApi } from '../lib/api';
import type { ImageLibraryItem } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { Spinner } from '../components/ui/Spinner';
import {
  Image, Wand2, Download, Trash2, Copy, CheckCircle, X,
  ZoomIn, ChevronLeft, ChevronRight, FileText, Upload,
  Square, RefreshCw, FolderOutput, BookOpen, Save, Tag,
  Pencil, Search, FolderOpen,
} from 'lucide-react';
import { clsx } from 'clsx';

const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

interface BatchImage {
  filename: string;
  url: string;
  timestamp?: string;
  prompt?: string;
  status?: 'done' | 'error' | 'pending' | 'generating';
}

/** Parse "[HH:MM:SS] prompt" or "[MM:SS] prompt" lines */
function parseBatchInput(text: string): Array<{ timestamp: string; prompt: string }> {
  const lines = text.split('\n');
  const result: Array<{ timestamp: string; prompt: string }> = [];
  let currentTs = '';
  let currentPrompt = '';

  for (const line of lines) {
    const match = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/);
    if (match) {
      if (currentPrompt.trim()) {
        result.push({ timestamp: currentTs, prompt: currentPrompt.trim() });
      }
      currentTs = match[1];
      currentPrompt = match[2];
    } else if (line.trim()) {
      currentPrompt += ' ' + line.trim();
    }
  }
  if (currentPrompt.trim()) {
    result.push({ timestamp: currentTs, prompt: currentPrompt.trim() });
  }
  return result;
}

export function ImageGenerator() {
  const { t } = useTranslation();

  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [prompt, setPrompt] = useState('');
  const [batchText, setBatchText] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [provider, setProvider] = useState('auto');
  const [count, setCount] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<BatchImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Tabs: generate vs library
  const [tab, setTab] = useState<'generate' | 'library'>('generate');

  // Library save dialog
  const [saveDialogImg, setSaveDialogImg] = useState<BatchImage | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saveCategory, setSaveCategory] = useState('');
  const [saveTags, setSaveTags] = useState('');
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [saveAllStatus, setSaveAllStatus] = useState<string | null>(null);

  // Library browse
  const [libSearch, setLibSearch] = useState('');
  const [libCategory, setLibCategory] = useState('');
  const [editingItem, setEditingItem] = useState<ImageLibraryItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editTags, setEditTags] = useState('');

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ['image', 'history'],
    queryFn: imageApi.history,
  });

  const { data: libraryItems, refetch: refetchLibrary } = useQuery({
    queryKey: ['image', 'library', libSearch, libCategory],
    queryFn: () => imageApi.libraryList({ q: libSearch || undefined, category: libCategory || undefined }),
  });

  const { data: libraryCategories } = useQuery({
    queryKey: ['image', 'library', 'categories'],
    queryFn: imageApi.libraryCategories,
  });

  const parsedPrompts = mode === 'batch' ? parseBatchInput(batchText) : [];

  // ── Stop ──
  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  // ── Single generate ──
  const handleGenerateSingle = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setProgress([]);
    setGeneratedImages([]);
    setError(null);

    try {
      const images = await imageApi.generate(
        { prompt: prompt.trim(), aspectRatio, count, provider },
        (_step, detail) => setProgress((prev) => [...prev, detail ?? '']),
      );
      setGeneratedImages(images.map((img) => ({ ...img, status: 'done' as const })));
      refetchHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Batch generate ──
  const handleGenerateBatch = async () => {
    if (!parsedPrompts.length || isGenerating) return;
    setIsGenerating(true);
    setProgress([]);
    setError(null);

    // Initialize all as pending
    setGeneratedImages(parsedPrompts.map((p) => ({
      filename: '',
      url: '',
      timestamp: p.timestamp,
      prompt: p.prompt,
      status: 'pending',
    })));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await imageApi.generateBatch(
        { prompts: parsedPrompts, aspectRatio, provider },
        (step, detail, image) => {
          if (detail) setProgress((prev) => [...prev, detail]);
          if (image) {
            setGeneratedImages((prev) => prev.map((item) =>
              item.timestamp === image.timestamp && item.status !== 'done'
                ? { ...item, ...image, status: 'done' }
                : item,
            ));
          }
          // Mark next one as generating
          if (step === 'generating' && detail) {
            const match = detail.match(/\((\d+)\/\d+\)/);
            if (match) {
              const idx = parseInt(match[1]) - 1;
              setGeneratedImages((prev) => prev.map((item, i) =>
                i === idx && item.status === 'pending' ? { ...item, status: 'generating' } : item,
              ));
            }
          }
        },
        controller.signal,
      );
      refetchHistory();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setProgress((prev) => [...prev, '⏹ Stopped by user.']);
        // Mark remaining pending as stopped
        setGeneratedImages((prev) => prev.map((item) =>
          item.status === 'pending' || item.status === 'generating'
            ? { ...item, status: 'error' }
            : item,
        ));
      } else {
        setError((err as Error).message);
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  };

  const handleGenerate = () => {
    if (mode === 'single') handleGenerateSingle();
    else handleGenerateBatch();
  };

  // ── Regenerate single image ──
  const handleRegenerate = async (idx: number) => {
    const item = generatedImages[idx];
    if (!item?.prompt || regeneratingIdx !== null) return;

    setRegeneratingIdx(idx);
    setGeneratedImages((prev) => prev.map((img, i) =>
      i === idx ? { ...img, status: 'generating' } : img,
    ));

    try {
      const images = await imageApi.generate(
        { prompt: item.prompt, aspectRatio, count: 1, provider },
        () => {},
      );
      if (images[0]) {
        // Delete old image if it exists
        if (item.filename) {
          try { await imageApi.delete(item.filename); } catch { /* ignore */ }
        }
        setGeneratedImages((prev) => prev.map((img, i) =>
          i === idx ? { ...img, ...images[0], status: 'done' } : img,
        ));
        refetchHistory();
      }
    } catch (err) {
      setGeneratedImages((prev) => prev.map((img, i) =>
        i === idx ? { ...img, status: 'error' } : img,
      ));
    } finally {
      setRegeneratingIdx(null);
    }
  };

  // ── Export to assets ──
  const handleExportToAssets = async () => {
    const doneImages = generatedImages.filter((img) => img.status === 'done' && img.filename);
    if (!doneImages.length) return;

    setExportStatus(t('image.exporting'));
    try {
      const res = await fetch('/api/image/export-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: doneImages.map((img) => ({
            filename: img.filename,
            timestamp: img.timestamp,
          })),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setExportStatus(`${t('image.exported')} (${data.count} ${t('image.images')})`);
      setTimeout(() => setExportStatus(null), 3000);
    } catch (err) {
      setExportStatus(`Error: ${(err as Error).message}`);
      setTimeout(() => setExportStatus(null), 3000);
    }
  };

  // ── File handling ──
  const handleFileLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setBatchText(ev.target?.result as string);
      setMode('batch');
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setBatchText(ev.target?.result as string);
      setMode('batch');
    };
    reader.readAsText(file);
  }, []);

  const handleDelete = async (filename: string) => {
    await imageApi.delete(filename);
    refetchHistory();
    setGeneratedImages((prev) => prev.filter((img) => img.filename !== filename));
  };

  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(mode === 'batch' ? batchText : prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const allImages = [
    ...generatedImages.filter((g) => g.status === 'done' && g.url),
    ...(history ?? []).filter((h) => !generatedImages.some((g) => g.filename === h.filename)),
  ];

  const openLightbox = (idx: number) => {
    setLightboxIdx(idx);
    setLightboxUrl(allImages[idx]?.url ?? null);
  };

  const lightboxPrev = () => {
    const next = (lightboxIdx - 1 + allImages.length) % allImages.length;
    setLightboxIdx(next);
    setLightboxUrl(allImages[next]?.url ?? null);
  };

  const lightboxNext = () => {
    const next = (lightboxIdx + 1) % allImages.length;
    setLightboxIdx(next);
    setLightboxUrl(allImages[next]?.url ?? null);
  };

  // ── Save to library ──
  const openSaveDialog = (img: BatchImage) => {
    setSaveDialogImg(img);
    setSaveName(img.timestamp ? `[${img.timestamp}] Image` : img.filename?.replace(/\.[^.]+$/, '') || 'Image');
    setSaveDesc('');
    setSaveCategory('');
    setSaveTags('');
  };

  const handleSaveToLibrary = async () => {
    if (!saveDialogImg?.filename || !saveName.trim()) return;
    setSavingLibrary(true);
    try {
      await imageApi.librarySave({
        filename: saveDialogImg.filename,
        name: saveName.trim(),
        description: saveDesc.trim() || undefined,
        category: saveCategory.trim() || undefined,
        tags: saveTags.split(',').map((t) => t.trim()).filter(Boolean),
        prompt: saveDialogImg.prompt || undefined,
        provider,
        aspectRatio,
      });
      setSaveDialogImg(null);
      refetchLibrary();
      queryClient.invalidateQueries({ queryKey: ['image', 'library'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingLibrary(false);
    }
  };

  const handleSaveAllToLibrary = async () => {
    const doneImages = generatedImages.filter((img) => img.status === 'done' && img.filename);
    if (!doneImages.length) return;
    setSaveAllStatus(t('image.savingToLibrary'));
    try {
      const result = await imageApi.libraryBatchSave(
        doneImages.map((img, i) => ({
          filename: img.filename,
          name: img.timestamp ? `[${img.timestamp}] Image ${i + 1}` : `Image ${i + 1}`,
          prompt: img.prompt || undefined,
          category: saveCategory.trim() || undefined,
          tags: saveTags.split(',').map((t) => t.trim()).filter(Boolean),
          provider,
          aspectRatio,
        })),
      );
      setSaveAllStatus(`${t('image.savedToLibrary')} (${result.count})`);
      setTimeout(() => setSaveAllStatus(null), 3000);
      refetchLibrary();
      queryClient.invalidateQueries({ queryKey: ['image', 'library'] });
    } catch (err) {
      setSaveAllStatus(`Error: ${(err as Error).message}`);
      setTimeout(() => setSaveAllStatus(null), 3000);
    }
  };

  // ── Library item edit ──
  const openEditItem = (item: ImageLibraryItem) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditDesc(item.description || '');
    setEditCategory(item.category);
    setEditTags((() => { try { return (JSON.parse(item.tags) as string[]).join(', '); } catch { return ''; } })());
  };

  const handleUpdateItem = async () => {
    if (!editingItem) return;
    try {
      await imageApi.libraryUpdate(editingItem.id, {
        name: editName.trim(),
        description: editDesc.trim() || undefined,
        category: editCategory.trim() || undefined,
        tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setEditingItem(null);
      refetchLibrary();
      queryClient.invalidateQueries({ queryKey: ['image', 'library'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await imageApi.libraryDelete(id);
      refetchLibrary();
      queryClient.invalidateQueries({ queryKey: ['image', 'library'] });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const canGenerate = mode === 'single' ? !!prompt.trim() : parsedPrompts.length > 0;
  const doneCount = generatedImages.filter((img) => img.status === 'done').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title={t('image.title')} subtitle={t('image.subtitle')} />

      {/* Main tabs: Generate / Library */}
      <div className="border-b border-c-border bg-c-surface">
        <div className="max-w-5xl mx-auto flex gap-0">
          {(['generate', 'library'] as const).map((t2) => (
            <button
              key={t2}
              onClick={() => setTab(t2)}
              className={clsx(
                'text-sm px-5 py-2.5 flex items-center gap-2 border-b-2 transition-colors',
                tab === t2 ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-c-muted hover:text-c-text',
              )}
            >
              {t2 === 'generate' ? <Wand2 className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
              {t2 === 'generate' ? t('image.generate') : t('image.library')}
              {t2 === 'library' && libraryItems?.length ? (
                <span className="text-[10px] bg-cyan-900/40 text-cyan-300 px-1.5 py-0.5 rounded-full">{libraryItems.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-5">

          {/* ═══ GENERATE TAB ═══ */}
          {tab === 'generate' && <>

          {/* Mode toggle */}
          <div className="flex rounded-lg border border-c-border overflow-hidden w-fit">
            {(['single', 'batch'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={clsx(
                  'text-xs px-4 py-2 flex items-center gap-1.5 transition-colors',
                  mode === m ? 'bg-cyan-900/30 text-cyan-300' : 'text-c-muted hover:text-c-text',
                )}
              >
                {m === 'single' ? <Wand2 className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                {m === 'single' ? t('image.singleMode') : t('image.batchMode')}
              </button>
            ))}
          </div>

          {/* Single prompt */}
          {mode === 'single' && (
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('image.prompt')}</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t('image.promptPlaceholder')}
                rows={5}
                className="input text-sm w-full resize-y min-h-[80px]"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-c-dim">{prompt.length} {t('image.chars')}</span>
                <button onClick={handleCopyPrompt} className="text-xs text-c-muted hover:text-c-text flex items-center gap-1">
                  {copied ? <CheckCircle className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? t('tts.copied') : t('tts.copyText')}
                </button>
              </div>
            </div>
          )}

          {/* Batch mode */}
          {mode === 'batch' && (
            <div className="space-y-3">
              <div
                className={clsx(
                  'border-2 border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer',
                  dragOver ? 'border-cyan-500 bg-cyan-900/20' : 'border-c-border hover:border-c-border-hi',
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <input ref={fileInputRef} type="file" accept=".txt,.text" onChange={handleFileLoad} className="hidden" />
                <Upload className="w-5 h-5 text-c-dim mx-auto mb-1" />
                <div className="text-xs text-c-muted">{t('image.dropFile')}</div>
              </div>

              <div>
                <label className="text-xs text-c-muted mb-1.5 block">{t('image.batchPrompts')}</label>
                <textarea
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder={`[00:00] A hand-drawn doodle of a cat...\n\n[00:05] A hand-drawn doodle of a dog...`}
                  rows={12}
                  className="input text-sm w-full resize-y min-h-[150px] font-mono"
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-c-dim">{parsedPrompts.length} {t('image.promptsDetected')}</span>
                  <button onClick={handleCopyPrompt} className="text-xs text-c-muted hover:text-c-text flex items-center gap-1">
                    {copied ? <CheckCircle className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    {copied ? t('tts.copied') : t('tts.copyText')}
                  </button>
                </div>
              </div>

              {parsedPrompts.length > 0 && !generatedImages.length && (
                <div className="border border-c-border rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-c-border bg-c-surface">
                    <span className="text-xs font-medium text-c-text">{parsedPrompts.length} {t('image.promptsDetected')}</span>
                  </div>
                  <div className="max-h-[200px] overflow-auto divide-y divide-c-border">
                    {parsedPrompts.map((p, i) => (
                      <div key={i} className="px-3 py-2 flex gap-3 items-start">
                        <span className="text-[11px] font-mono text-cyan-300/70 shrink-0 w-14">[{p.timestamp}]</span>
                        <span className="text-xs text-c-muted line-clamp-2">{p.prompt.slice(0, 150)}...</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Settings row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.provider')}</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className="input text-sm">
                <option value="auto">Auto (Fallback Chain)</option>
                <option value="leonardo">Leonardo.ai (Free 150/day)</option>
                <option value="together">Together AI (Free)</option>
                <option value="pollinations">Pollinations (Free)</option>
                <option value="huggingface">HuggingFace (Free)</option>
                <option value="fal">FAL.ai</option>
                <option value="replicate">Replicate</option>
                <option value="stability">Stability AI</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.aspectRatio')}</label>
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="input text-sm">
                {ASPECT_RATIOS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {mode === 'single' && (
              <div>
                <label className="text-xs text-c-muted mb-1 block">{t('image.count')}</label>
                <input
                  type="number" min={1} max={4} value={count}
                  onChange={(e) => setCount(Math.min(4, Math.max(1, Number(e.target.value))))}
                  className="input text-sm w-20"
                />
              </div>
            )}
          </div>

          {/* Generate / Stop buttons */}
          <div className="flex gap-2">
            <button
              onClick={isGenerating ? handleStop : handleGenerate}
              disabled={!isGenerating && !canGenerate}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 text-sm py-2 rounded-lg font-medium transition-colors',
                isGenerating
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'btn-primary disabled:opacity-50',
              )}
            >
              {isGenerating ? (
                <>
                  <Square className="w-3.5 h-3.5" />
                  {t('image.stop')}
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  {mode === 'batch'
                    ? `${t('image.generate')} (${parsedPrompts.length} ${t('image.images')})`
                    : t('image.generate')}
                </>
              )}
            </button>
          </div>

          {/* Progress */}
          {progress.length > 0 && (
            <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10">
              <div className="flex items-center gap-2 mb-1">
                {isGenerating ? <Spinner size="sm" /> : <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
                <span className="text-xs font-medium text-cyan-300">
                  {isGenerating ? t('image.generating') : `${doneCount}/${generatedImages.length} ${t('image.done')}`}
                </span>
              </div>
              <div className="font-mono text-[11px] text-c-dim space-y-0.5 max-h-[200px] overflow-auto">
                {progress.map((line, i) => (
                  <div key={i} className={line.includes('Failed') || line.includes('Stopped') ? 'text-red-400' : line.includes('Done') ? 'text-green-400' : ''}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="border border-red-800/30 rounded-xl p-3 bg-red-900/10 text-sm text-red-300">{error}</div>
          )}

          {/* Generated images grid */}
          {generatedImages.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  {t('image.generated')} ({doneCount}/{generatedImages.length})
                </h3>
                <div className="flex items-center gap-2">
                  {doneCount > 0 && (
                    <button
                      onClick={handleSaveAllToLibrary}
                      className="btn-secondary text-xs flex items-center gap-1.5"
                      disabled={!!saveAllStatus}
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      {saveAllStatus || t('image.saveAllToLibrary')}
                    </button>
                  )}
                  {mode === 'batch' && doneCount > 0 && (
                    <button
                      onClick={handleExportToAssets}
                      className="btn-secondary text-xs flex items-center gap-1.5"
                      disabled={!!exportStatus}
                    >
                      <FolderOutput className="w-3.5 h-3.5" />
                      {exportStatus || t('image.exportToAssets')}
                    </button>
                  )}
                </div>
              </div>
              <div className={clsx(
                'grid gap-3',
                mode === 'batch' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2',
              )}>
                {generatedImages.map((img, i) => (
                  <div
                    key={`${img.filename || i}`}
                    className={clsx(
                      'rounded-xl border overflow-hidden',
                      img.status === 'done' ? 'border-green-800/30 bg-green-900/5' :
                      img.status === 'error' ? 'border-red-800/30 bg-red-900/5' :
                      img.status === 'generating' ? 'border-cyan-800/30 bg-cyan-900/5' :
                      'border-c-border bg-c-surface',
                    )}
                  >
                    {/* Image or placeholder */}
                    {img.status === 'done' && img.url ? (
                      <div className="relative cursor-pointer" onClick={() => {
                        const allIdx = allImages.findIndex((a) => a.filename === img.filename);
                        if (allIdx >= 0) openLightbox(allIdx);
                      }}>
                        <img src={img.url} alt={img.filename} className="w-full aspect-video object-cover" loading="lazy" />
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                          <ZoomIn className="w-5 h-5 text-white" />
                        </div>
                        {img.timestamp && (
                          <div className="absolute top-1.5 left-1.5 bg-black/60 rounded px-1.5 py-0.5 text-[10px] font-mono text-white">
                            [{img.timestamp}]
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="aspect-video flex items-center justify-center bg-c-bg">
                        {img.status === 'generating' ? (
                          <div className="text-center">
                            <Spinner size="sm" />
                            <div className="text-[10px] text-cyan-300 mt-1">[{img.timestamp}]</div>
                          </div>
                        ) : img.status === 'error' ? (
                          <div className="text-center">
                            <X className="w-5 h-5 text-red-400 mx-auto" />
                            <div className="text-[10px] text-red-400 mt-1">{t('image.failed')}</div>
                          </div>
                        ) : (
                          <div className="text-center">
                            <div className="w-5 h-5 rounded-full border-2 border-c-dim mx-auto" />
                            <div className="text-[10px] text-c-dim mt-1">[{img.timestamp}]</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="px-2 py-1.5 flex items-center gap-1">
                      <span className="text-[10px] text-c-dim truncate flex-1">
                        {img.timestamp ? `[${img.timestamp}]` : ''} {img.filename || '...'}
                      </span>
                      {img.prompt && (
                        <button
                          onClick={() => handleRegenerate(i)}
                          disabled={regeneratingIdx !== null || isGenerating}
                          className={clsx(
                            'p-1 transition-colors',
                            regeneratingIdx === i ? 'text-cyan-400 animate-spin' : 'text-c-muted hover:text-cyan-400',
                          )}
                          title={t('image.regenerate')}
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      )}
                      {img.status === 'done' && img.filename && (
                        <button
                          onClick={() => openSaveDialog(img)}
                          className="p-1 text-c-muted hover:text-green-400"
                          title={t('image.saveToLibrary')}
                        >
                          <Save className="w-3 h-3" />
                        </button>
                      )}
                      {img.status === 'done' && img.url && (
                        <button onClick={() => handleDownload(img.url, img.filename)} className="p-1 text-c-muted hover:text-c-text">
                          <Download className="w-3 h-3" />
                        </button>
                      )}
                      {img.status === 'done' && img.filename && (
                        <button onClick={() => handleDelete(img.filename)} className="p-1 text-c-muted hover:text-red-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History */}
          {history && history.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-c-text mb-3 flex items-center gap-2">
                <Image className="w-4 h-4 text-c-muted" />
                {t('image.history')} ({history.length})
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {history.map((img, i) => (
                  <div
                    key={img.filename}
                    className="group relative rounded-lg overflow-hidden border border-c-border bg-c-surface cursor-pointer"
                    onClick={() => openLightbox(generatedImages.filter((g) => g.status === 'done').length + i)}
                  >
                    <img src={img.url} alt={img.filename} className="w-full aspect-video object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <ZoomIn className="w-5 h-5 text-white" />
                    </div>
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between">
                      <span className="text-[10px] text-white/70 truncate">{img.sizeKB} KB</span>
                      <div className="flex gap-1">
                        <button onClick={(e) => { e.stopPropagation(); handleDownload(img.url, img.filename); }} className="p-0.5 text-white/70 hover:text-white">
                          <Download className="w-3 h-3" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(img.filename); }} className="p-0.5 text-white/70 hover:text-red-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          </>}

          {/* ═══ LIBRARY TAB ═══ */}
          {tab === 'library' && (
            <div className="space-y-4">
              {/* Search & Filter bar */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-c-dim" />
                  <input
                    type="text"
                    value={libSearch}
                    onChange={(e) => setLibSearch(e.target.value)}
                    placeholder={t('image.librarySearch')}
                    className="input text-sm w-full pl-9"
                  />
                </div>
                <select
                  value={libCategory}
                  onChange={(e) => setLibCategory(e.target.value)}
                  className="input text-sm"
                >
                  <option value="">{t('image.allCategories')}</option>
                  {libraryCategories?.map((c) => (
                    <option key={c.category} value={c.category}>{c.category} ({c.count})</option>
                  ))}
                </select>
              </div>

              {/* Library grid */}
              {!libraryItems?.length ? (
                <div className="text-center py-16 text-c-dim">
                  <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <div className="text-sm">{t('image.libraryEmpty')}</div>
                  <div className="text-xs mt-1">{t('image.libraryEmptyHint')}</div>
                </div>
              ) : (
                <>
                  <div className="text-xs text-c-dim">{t('image.libraryCount', { count: libraryItems.length })}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {libraryItems.map((item) => {
                      const itemTags: string[] = (() => { try { return JSON.parse(item.tags); } catch { return []; } })();
                      return (
                        <div
                          key={item.id}
                          className="group rounded-xl border border-c-border bg-c-surface overflow-hidden hover:border-cyan-700/50 transition-colors"
                        >
                          <div className="relative cursor-pointer" onClick={() => { setLightboxUrl(item.url); setLightboxIdx(0); }}>
                            <img src={item.url} alt={item.name} className="w-full aspect-video object-cover" loading="lazy" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <ZoomIn className="w-5 h-5 text-white" />
                            </div>
                            <div className="absolute top-1.5 left-1.5 bg-black/60 rounded px-1.5 py-0.5 text-[10px] text-white/80">
                              {item.category}
                            </div>
                          </div>

                          <div className="p-2 space-y-1">
                            <div className="text-xs font-medium text-c-text truncate" title={item.name}>{item.name}</div>
                            {item.description && (
                              <div className="text-[10px] text-c-dim line-clamp-2">{item.description}</div>
                            )}
                            {itemTags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {itemTags.slice(0, 4).map((tg) => (
                                  <span key={tg} className="text-[9px] bg-cyan-900/30 text-cyan-300/80 px-1.5 py-0.5 rounded-full">{tg}</span>
                                ))}
                                {itemTags.length > 4 && <span className="text-[9px] text-c-dim">+{itemTags.length - 4}</span>}
                              </div>
                            )}
                            <div className="flex items-center gap-1 pt-1">
                              <button
                                onClick={() => openEditItem(item)}
                                className="p-1 text-c-muted hover:text-cyan-400"
                                title={t('image.editItem')}
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDownload(item.url, item.filename)}
                                className="p-1 text-c-muted hover:text-c-text"
                              >
                                <Download className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item.id)}
                                className="p-1 text-c-muted hover:text-red-400"
                                title={t('image.deleteItem')}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                              <span className="flex-1" />
                              <span className="text-[9px] text-c-dim">{Math.round(item.filesize / 1024)} KB</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Save to Library Dialog */}
      {saveDialogImg && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setSaveDialogImg(null)}>
          <div className="bg-c-surface border border-c-border rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
                <Save className="w-4 h-4 text-green-400" />
                {t('image.saveToLibrary')}
              </h3>
              <button onClick={() => setSaveDialogImg(null)} className="p-1 text-c-muted hover:text-c-text">
                <X className="w-4 h-4" />
              </button>
            </div>

            {saveDialogImg.url && (
              <img src={saveDialogImg.url} alt="" className="w-full rounded-lg aspect-video object-cover" />
            )}

            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.imageName')} *</label>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t('image.imageNamePlaceholder')}
                className="input text-sm w-full"
              />
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.imageDescription')}</label>
              <textarea
                value={saveDesc}
                onChange={(e) => setSaveDesc(e.target.value)}
                placeholder={t('image.imageDescriptionPlaceholder')}
                rows={2}
                className="input text-sm w-full resize-y"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-c-muted mb-1 block">{t('image.imageCategory')}</label>
                <input
                  type="text"
                  value={saveCategory}
                  onChange={(e) => setSaveCategory(e.target.value)}
                  placeholder={t('image.imageCategoryPlaceholder')}
                  className="input text-sm w-full"
                  list="lib-categories"
                />
                <datalist id="lib-categories">
                  {libraryCategories?.map((c) => <option key={c.category} value={c.category} />)}
                </datalist>
              </div>
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.imageTags')}</label>
              <input
                type="text"
                value={saveTags}
                onChange={(e) => setSaveTags(e.target.value)}
                placeholder={t('image.imageTagsPlaceholder')}
                className="input text-sm w-full"
              />
            </div>

            {saveDialogImg.prompt && (
              <div className="text-[10px] text-c-dim line-clamp-2">
                <span className="text-c-muted">{t('image.prompt')}:</span> {saveDialogImg.prompt.slice(0, 150)}...
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setSaveDialogImg(null)} className="btn-secondary text-xs">{t('common.cancel')}</button>
              <button
                onClick={handleSaveToLibrary}
                disabled={!saveName.trim() || savingLibrary}
                className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {savingLibrary ? <Spinner size="sm" /> : <Save className="w-3 h-3" />}
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Library Item Dialog */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditingItem(null)}>
          <div className="bg-c-surface border border-c-border rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-c-text flex items-center gap-2">
                <Pencil className="w-4 h-4 text-cyan-400" />
                {t('image.editItem')}
              </h3>
              <button onClick={() => setEditingItem(null)} className="p-1 text-c-muted hover:text-c-text">
                <X className="w-4 h-4" />
              </button>
            </div>

            <img src={editingItem.url} alt="" className="w-full rounded-lg aspect-video object-cover" />

            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.imageName')} *</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="input text-sm w-full" />
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.imageDescription')}</label>
              <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} className="input text-sm w-full resize-y" />
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.imageCategory')}</label>
              <input
                type="text"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                className="input text-sm w-full"
                list="lib-categories-edit"
              />
              <datalist id="lib-categories-edit">
                {libraryCategories?.map((c) => <option key={c.category} value={c.category} />)}
              </datalist>
            </div>

            <div>
              <label className="text-xs text-c-muted mb-1 block">{t('image.imageTags')}</label>
              <input type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder={t('image.imageTagsPlaceholder')} className="input text-sm w-full" />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditingItem(null)} className="btn-secondary text-xs">{t('common.cancel')}</button>
              <button
                onClick={handleUpdateItem}
                disabled={!editName.trim()}
                className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save className="w-3 h-3" />
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center" onClick={() => setLightboxUrl(null)}>
          <button onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }} className="absolute top-4 right-4 p-2 text-white/70 hover:text-white">
            <X className="w-6 h-6" />
          </button>
          {allImages.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); lightboxPrev(); }} className="absolute left-4 p-2 text-white/70 hover:text-white">
                <ChevronLeft className="w-8 h-8" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); lightboxNext(); }} className="absolute right-4 p-2 text-white/70 hover:text-white">
                <ChevronRight className="w-8 h-8" />
              </button>
            </>
          )}
          <img src={lightboxUrl} alt="Preview" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          <div className="absolute bottom-4 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); handleDownload(lightboxUrl, allImages[lightboxIdx]?.filename ?? 'image.png'); }}
              className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20 flex items-center gap-1.5"
            >
              <Download className="w-3 h-3" /> {t('image.download')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
