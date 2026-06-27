import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { storyboardApi } from '../lib/api';
import type { StoryboardProjectSummary, StoryboardTemplateSummary, StoryboardTemplateDetail } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { Spinner } from '../components/ui/Spinner';
import {
  Clapperboard, Plus, Trash2, Clock, Mic, Film, FileText, Wand2, Image, CheckCircle,
  Layout, Pencil, X, Copy, Search, Filter, ChevronDown, ChevronUp, Play, ExternalLink, StickyNote, RefreshCw, Save,
} from 'lucide-react';
import { clsx } from 'clsx';

const STEP_ICONS: Record<string, typeof Clock> = {
  topics: Wand2, script: FileText, audio: Mic, prompts: Wand2,
  images: Image, timeline: Clock, metadata: FileText, assemble: Film,
};

const STEP_COLORS: Record<string, string> = {
  topics: 'text-violet-400', script: 'text-violet-400', audio: 'text-violet-400',
  prompts: 'text-violet-400', images: 'text-violet-400', timeline: 'text-violet-400',
  metadata: 'text-violet-400', assemble: 'text-emerald-400',
};

const STEP_DOT_COLORS: Record<string, string> = {
  topics: 'bg-violet-400', script: 'bg-violet-400', audio: 'bg-violet-400',
  prompts: 'bg-violet-400', images: 'bg-violet-400', timeline: 'bg-violet-400',
  metadata: 'bg-violet-400', assemble: 'bg-emerald-400',
};

const STEP_ORDER = ['topics', 'script', 'audio', 'prompts', 'images', 'timeline', 'metadata', 'assemble'];

const NICHE_COLORS = [
  '#7c6af5', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6',
  '#06b6d4', '#f97316', '#14b8a6', '#6366f1', '#e11d48',
];

const VISUAL_STYLES = [
  { value: '', labelKey: 'storyboardList.styleNone' },
  { value: 'cinematic drama', labelKey: 'storyboardList.styleCinematicDrama' },
  { value: 'stick figure doodle', labelKey: 'storyboardList.styleStickFigure' },
  { value: 'hand-drawn whiteboard', labelKey: 'storyboardList.styleWhiteboard' },
  { value: 'anime illustration', labelKey: 'storyboardList.styleAnime' },
  { value: 'photorealistic', labelKey: 'storyboardList.stylePhotorealistic' },
  { value: 'watercolor painting', labelKey: 'storyboardList.styleWatercolor' },
  { value: 'comic book', labelKey: 'storyboardList.styleComicBook' },
  { value: 'pixel art', labelKey: 'storyboardList.stylePixelArt' },
  { value: '3D render', labelKey: 'storyboardList.style3DRender' },
  { value: 'oil painting', labelKey: 'storyboardList.styleOilPainting' },
  { value: 'minimalist flat', labelKey: 'storyboardList.styleMinimalist' },
  { value: 'dark gothic', labelKey: 'storyboardList.styleDarkGothic' },
];

const STAGE_KEYS = ['topics', 'script', 'prompts', 'metadata'] as const;
const STAGE_LABEL_KEYS: Record<string, string> = {
  topics: 'storyboardList.stageTopics',
  script: 'storyboardList.stageScript',
  prompts: 'storyboardList.stageImagePrompts',
  metadata: 'storyboardList.stageMetadata',
};

function NichePromptsPanel({ templateId, t }: { templateId: string; t: (k: string, opts?: Record<string, unknown>) => string }) {
  const queryClient = useQueryClient();
  const { data: detail, isLoading } = useQuery({
    queryKey: ['storyboard', 'template-detail', templateId],
    queryFn: () => storyboardApi.getTemplateById(templateId),
    enabled: !!templateId,
  });
  const { data: defaults } = useQuery({
    queryKey: ['storyboard', 'template-defaults'],
    queryFn: storyboardApi.getDefaults,
    staleTime: Infinity,
  });

  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiTargetStage, setAiTargetStage] = useState<string>('');
  const [aiGenerating, setAiGenerating] = useState(false);

  const toggleStage = useCallback((stage: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); else next.add(stage);
      return next;
    });
  }, []);

  const startEdit = (stage: string, content: string) => {
    setEditingStage(stage);
    setEditValue(content);
  };

  const handleSave = async () => {
    if (!editingStage || !editValue.trim()) return;
    setSaving(true);
    try {
      await storyboardApi.saveTemplatePrompt(templateId, editingStage, editValue.trim());
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'template-detail', templateId] });
      setEditingStage(null);
    } finally {
      setSaving(false);
    }
  };

  const handleAiGenerate = async () => {
    if (!aiInstruction.trim()) return;
    setAiGenerating(true);
    try {
      await storyboardApi.aiPrompt(templateId, aiInstruction.trim(), aiTargetStage || undefined);
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'template-detail', templateId] });
      setAiInstruction('');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setAiGenerating(false);
    }
  };

  if (isLoading) return <div className="p-4 flex justify-center"><Spinner className="w-4 h-4" /></div>;

  const prompts = detail?.stagePrompts || {};
  const defaultPrompts = defaults?.stagePrompts || {};
  const hasAny = STAGE_KEYS.some(k => prompts[k]);

  return (
    <div className="px-4 pb-3 space-y-2.5">
      {/* AI Assistant */}
      <div className="flex gap-2 items-start">
        <div className="flex-1 space-y-1.5">
          <div className="flex gap-2">
            <select
              value={aiTargetStage}
              onChange={e => setAiTargetStage(e.target.value)}
              className="input text-xs py-1.5 w-44 shrink-0"
            >
              <option value="">{t('storyboardList.aiAllStages')}</option>
              {STAGE_KEYS.map(s => (
                <option key={s} value={s}>{t(STAGE_LABEL_KEYS[s])}</option>
              ))}
            </select>
            <input
              value={aiInstruction}
              onChange={e => setAiInstruction(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAiGenerate()}
              placeholder={t('storyboardList.aiPlaceholder')}
              className="input text-xs py-1.5 flex-1"
              disabled={aiGenerating}
            />
            <button
              onClick={handleAiGenerate}
              disabled={!aiInstruction.trim() || aiGenerating}
              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              {aiGenerating ? <Spinner className="w-3.5 h-3.5" /> : <Wand2 className="w-3.5 h-3.5" />}
              {aiGenerating ? t('storyboardList.aiGenerating') : t('storyboardList.aiGenerate')}
            </button>
          </div>
        </div>
      </div>

      {STAGE_KEYS.map(stage => {
        const content = prompts[stage] || '';
        const fallback = defaultPrompts[stage] || '';
        const display = content || fallback;
        if (!display) return null;
        const isDefault = !content && !!fallback;
        const isExpanded = expandedStages.has(stage);
        const isEditing = editingStage === stage;
        const preview = display.substring(0, 120).replace(/\n/g, ' ') + (display.length > 120 ? '...' : '');

        return (
          <div key={stage} className={clsx('border rounded-lg overflow-hidden', isDefault ? 'border-c-border/50 bg-c-bg/50' : 'border-purple-800/30 bg-purple-900/10')}>
            <button
              onClick={() => {
                if (isEditing) return;
                toggleStage(stage);
              }}
              className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-purple-900/20 transition-colors"
            >
              <Wand2 className={clsx('w-3 h-3 shrink-0', isDefault ? 'text-c-dim' : 'text-purple-400')} />
              <span className={clsx('text-[11px] font-medium flex-1', isDefault ? 'text-c-muted' : 'text-purple-300')}>
                {t(STAGE_LABEL_KEYS[stage])}
                {isDefault && <span className="ml-2 text-[9px] text-amber-500/70 font-normal">{t('storyboardList.defaultLabel')}</span>}
              </span>
              {!isExpanded && !isEditing && (
                <span className="text-[10px] text-c-dim truncate max-w-[300px]">{preview}</span>
              )}
              {isExpanded ? <ChevronUp className="w-3 h-3 text-purple-400 shrink-0" /> : <ChevronDown className="w-3 h-3 text-purple-400 shrink-0" />}
            </button>
            {(isExpanded || isEditing) && (
              <div className="px-3 pb-3 border-t border-purple-800/20">
                {isEditing ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      rows={14}
                      className="input text-[11px] w-full font-mono resize-y min-h-[200px] bg-purple-950/20 border-purple-800/30 focus:border-purple-600/50"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditingStage(null)}
                        className="text-[10px] px-3 py-1 rounded-lg border border-c-border text-c-dim hover:text-c-text transition-colors"
                      >
                        {t('storyboardList.cancel')}
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="text-[10px] px-3 py-1 rounded-lg bg-green-700/60 hover:bg-green-700/80 text-green-200 font-medium flex items-center gap-1 disabled:opacity-50 transition-colors"
                      >
                        {saving ? <Spinner className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                        {saving ? t('storyboardList.savingPrompt') : t('storyboardList.savePrompt')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <pre className={clsx('text-[10px] whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-auto', isDefault ? 'text-c-dim' : 'text-c-muted')}>
                      {display}
                    </pre>
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(stage, display); }}
                        className="text-[10px] px-3 py-1 rounded-lg border border-purple-800/30 text-purple-300 hover:bg-purple-900/30 flex items-center gap-1 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        {t('storyboardList.editTemplate')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GlobalPromptsPanel({ t }: { t: (k: string, opts?: Record<string, unknown>) => string }) {
  const queryClient = useQueryClient();
  const { data: defaults, isLoading } = useQuery({
    queryKey: ['storyboard', 'template-defaults'],
    queryFn: storyboardApi.getDefaults,
    staleTime: 60_000,
  });

  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

  const toggleStage = useCallback((stage: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage); else next.add(stage);
      return next;
    });
  }, []);

  const handleSave = async () => {
    if (!editingStage || !editValue.trim()) return;
    setSaving(true);
    try {
      await storyboardApi.saveDefaultPrompt(editingStage, editValue.trim());
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'template-defaults'] });
      setEditingStage(null);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (stage: string) => {
    if (!confirm(t('storyboardList.resetGlobalConfirm'))) return;
    await storyboardApi.resetDefaultPrompt(stage);
    queryClient.invalidateQueries({ queryKey: ['storyboard', 'template-defaults'] });
  };

  if (isLoading) return <div className="p-4 flex justify-center"><Spinner className="w-4 h-4" /></div>;

  const prompts = defaults?.stagePrompts || {};

  return (
    <div className="p-4 space-y-2.5">
      <div className="text-[11px] text-c-dim mb-2">{t('storyboardList.globalPromptsHint')}</div>
      {STAGE_KEYS.map(stage => {
        const content = prompts[stage] || '';
        if (!content) return null;
        const isExpanded = expandedStages.has(stage);
        const isEditing = editingStage === stage;
        const preview = content.substring(0, 120).replace(/\n/g, ' ') + (content.length > 120 ? '...' : '');

        return (
          <div key={stage} className="border border-cyan-800/30 rounded-lg overflow-hidden bg-cyan-900/5">
            <button
              onClick={() => { if (!isEditing) toggleStage(stage); }}
              className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-cyan-900/20 transition-colors"
            >
              <Wand2 className="w-3 h-3 shrink-0 text-cyan-400" />
              <span className="text-[11px] font-medium flex-1 text-cyan-300">
                {t(STAGE_LABEL_KEYS[stage])}
              </span>
              {!isExpanded && !isEditing && (
                <span className="text-[10px] text-c-dim truncate max-w-[300px]">{preview}</span>
              )}
              {isExpanded ? <ChevronUp className="w-3 h-3 text-cyan-400 shrink-0" /> : <ChevronDown className="w-3 h-3 text-cyan-400 shrink-0" />}
            </button>
            {(isExpanded || isEditing) && (
              <div className="px-3 pb-3 border-t border-cyan-800/20">
                {isEditing ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      rows={14}
                      className="input text-[11px] w-full font-mono resize-y min-h-[200px] bg-cyan-950/20 border-cyan-800/30 focus:border-cyan-600/50"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditingStage(null)}
                        className="text-[10px] px-3 py-1 rounded-lg border border-c-border text-c-dim hover:text-c-text transition-colors"
                      >
                        {t('storyboardList.cancel')}
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="text-[10px] px-3 py-1 rounded-lg bg-green-700/60 hover:bg-green-700/80 text-green-200 font-medium flex items-center gap-1 disabled:opacity-50 transition-colors"
                      >
                        {saving ? <Spinner className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                        {saving ? t('storyboardList.savingPrompt') : t('storyboardList.savePrompt')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <pre className="text-[10px] whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-auto text-c-muted">
                      {content}
                    </pre>
                    <div className="flex justify-end mt-2 gap-2">
                      <button
                        onClick={() => handleReset(stage)}
                        className="text-[10px] px-3 py-1 rounded-lg border border-red-800/30 text-red-400 hover:bg-red-900/30 flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {t('storyboardList.resetDefault')}
                      </button>
                      <button
                        onClick={() => { setEditingStage(stage); setEditValue(content); }}
                        className="text-[10px] px-3 py-1 rounded-lg border border-cyan-800/30 text-cyan-300 hover:bg-cyan-900/30 flex items-center gap-1 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        {t('storyboardList.editTemplate')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StoryboardList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [deleting, setDeleting] = useState<string | null>(null);

  // Template management
  const [showTemplates, setShowTemplates] = useState(false);
  const [showGlobalPrompts, setShowGlobalPrompts] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<StoryboardTemplateSummary | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplNiche, setTplNiche] = useState('');
  const [tplDesc, setTplDesc] = useState('');
  const [tplColor, setTplColor] = useState('#7c6af5');
  const [tplYoutubeUrl, setTplYoutubeUrl] = useState('');
  const [tplMemo, setTplMemo] = useState('');
  const [tplVisualStyle, setTplVisualStyle] = useState('');
  const [savingTpl, setSavingTpl] = useState(false);
  const [deletingTpl, setDeletingTpl] = useState<string | null>(null);
  const [generatingNiche, setGeneratingNiche] = useState('');
  const [generatingTpl, setGeneratingTpl] = useState(false);
  const [referenceTemplateId, setReferenceTemplateId] = useState<string>('');

  // Filters
  const [filterNiche, setFilterNiche] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'completed'>('all');
  const [filterSearch, setFilterSearch] = useState('');
  const [collapsedNiches, setCollapsedNiches] = useState<Set<string>>(new Set());
  const [playingVideo, setPlayingVideo] = useState<{ url: string; title: string; projectId: string } | null>(null);
  const [renamingNiche, setRenamingNiche] = useState<string | null>(null);
  const [nicheNewName, setNicheNewName] = useState('');
  const [editingYoutubeNiche, setEditingYoutubeNiche] = useState<string | null>(null);
  const [youtubeUrlDraft, setYoutubeUrlDraft] = useState('');
  const [editingMemoNiche, setEditingMemoNiche] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState('');
  const [promptsOpenTpl, setPromptsOpenTpl] = useState<string | null>(null);

  const { data: projects, isLoading, isError, refetch } = useQuery({
    queryKey: ['storyboard', 'projects'],
    queryFn: storyboardApi.listProjects,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });

  const { data: templates } = useQuery({
    queryKey: ['storyboard', 'templates'],
    queryFn: storyboardApi.listTemplates,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });

  const handleCreate = async () => {
    const name = newName.trim() || `Storyboard ${new Date().toLocaleDateString()}`;
    setCreating(true);
    try {
      const project = await storyboardApi.createProject(name, selectedTemplateId || undefined);
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'projects'] });
      navigate(`/storyboard/${project.id}`);
    } catch {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('storyboard.confirmDelete'))) return;
    setDeleting(id);
    try {
      await storyboardApi.deleteProject(id);
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'projects'] });
    } finally {
      setDeleting(null);
    }
  };

  const handleSaveTemplate = async () => {
    if (!tplName.trim()) return;
    setSavingTpl(true);
    try {
      if (editingTemplate) {
        await storyboardApi.updateTemplate(editingTemplate.id, { name: tplName.trim(), niche: tplNiche.trim(), description: tplDesc.trim(), color: tplColor, youtubeUrl: tplYoutubeUrl.trim(), memo: tplMemo.trim(), visualStyle: tplVisualStyle } as never);
      } else {
        await storyboardApi.createTemplate({ name: tplName.trim(), niche: tplNiche.trim(), description: tplDesc.trim(), color: tplColor, youtubeUrl: tplYoutubeUrl.trim(), memo: tplMemo.trim(), visualStyle: tplVisualStyle });
      }
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'templates'] });
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'projects'] });
      setEditingTemplate(null);
      setTplName(''); setTplNiche(''); setTplDesc(''); setTplColor('#7c6af5'); setTplYoutubeUrl(''); setTplMemo(''); setTplVisualStyle('');
    } finally {
      setSavingTpl(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    setDeletingTpl(id);
    try {
      await storyboardApi.deleteTemplate(id);
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'templates'] });
      if (selectedTemplateId === id) setSelectedTemplateId('');
    } finally {
      setDeletingTpl(null);
    }
  };

  const handleDuplicateTemplate = async (tpl: StoryboardTemplateSummary) => {
    try {
      const full = await storyboardApi.getTemplateById(tpl.id);
      await storyboardApi.createTemplate({
        name: `${tpl.name} (copy)`, niche: tpl.niche, description: tpl.description,
        templateText: full.templateText, color: tpl.color,
      });
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'templates'] });
    } catch { /* silent */ }
  };

  const handleGenerateFromNiche = async () => {
    if (!generatingNiche.trim()) return;
    setGeneratingTpl(true);
    try {
      // Step 1: Generate the mega-prompt via LLM (optionally based on reference template)
      const result = await storyboardApi.generateTemplate(generatingNiche.trim(), referenceTemplateId || undefined);
      // Step 2: Create the template with the generated content
      const randomColor = NICHE_COLORS[Math.floor(Math.random() * NICHE_COLORS.length)];
      await storyboardApi.createTemplate({
        name: result.name,
        niche: result.niche,
        description: result.description,
        templateText: result.templateText,
        color: randomColor,
      });
      queryClient.invalidateQueries({ queryKey: ['storyboard', 'templates'] });
      setGeneratingNiche('');
      setReferenceTemplateId('');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setGeneratingTpl(false);
    }
  };

  const startEditTemplate = (tpl: StoryboardTemplateSummary) => {
    setEditingTemplate(tpl);
    setTplName(tpl.name); setTplNiche(tpl.niche); setTplDesc(tpl.description); setTplColor(tpl.color);
    setTplYoutubeUrl(tpl.youtubeUrl || ''); setTplMemo(tpl.memo || ''); setTplVisualStyle(tpl.visualStyle || '');
  };

  const handleRenameNiche = async (oldNiche: string, newNiche: string) => {
    if (!newNiche.trim() || newNiche.trim() === oldNiche) {
      setRenamingNiche(null);
      return;
    }
    // Update all templates with this niche
    const tplsToUpdate = (templates || []).filter((tp) => tp.niche === oldNiche);
    await Promise.all(tplsToUpdate.map((tp) =>
      storyboardApi.updateTemplate(tp.id, { niche: newNiche.trim() } as never),
    ));
    queryClient.invalidateQueries({ queryKey: ['storyboard', 'templates'] });
    queryClient.invalidateQueries({ queryKey: ['storyboard', 'projects'] });
    setRenamingNiche(null);
  };

  const handleSaveYoutubeUrl = async (templateId: string, url: string) => {
    if (!templateId) { setEditingYoutubeNiche(null); return; }
    await storyboardApi.updateTemplate(templateId, { youtubeUrl: url.trim() } as never);
    queryClient.invalidateQueries({ queryKey: ['storyboard', 'templates'] });
    queryClient.invalidateQueries({ queryKey: ['storyboard', 'projects'] });
    setEditingYoutubeNiche(null);
  };

  const handleSaveMemo = async (templateId: string, memo: string) => {
    if (!templateId) { setEditingMemoNiche(null); return; }
    await storyboardApi.updateTemplate(templateId, { memo: memo.trim() } as never);
    queryClient.invalidateQueries({ queryKey: ['storyboard', 'templates'] });
    queryClient.invalidateQueries({ queryKey: ['storyboard', 'projects'] });
    setEditingMemoNiche(null);
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const niches = [...new Set((templates || []).map((t) => t.niche).filter(Boolean))];

  const filteredProjects = (projects || []).filter((p: StoryboardProjectSummary) => {
    // Niche filter
    if (filterNiche) {
      if (filterNiche === '__none__') {
        if (p.templateNiche) return false;
      } else {
        if (p.templateNiche !== filterNiche) return false;
      }
    }
    // Status filter
    if (filterStatus === 'completed' && !p.resultFilename) return false;
    if (filterStatus === 'draft' && p.resultFilename) return false;
    // Search filter
    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase();
      const haystack = `${p.name} ${p.topic || ''} ${p.templateName || ''} ${p.templateNiche || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Group by niche
  const groupedProjects: { niche: string; label: string; color: string; youtubeUrl: string; memo: string; nicheStatus: string; templateId: string; projects: StoryboardProjectSummary[] }[] = [];
  const nicheMap = new Map<string, StoryboardProjectSummary[]>();
  for (const p of filteredProjects) {
    const key = p.templateNiche || '';
    if (!nicheMap.has(key)) nicheMap.set(key, []);
    nicheMap.get(key)!.push(p);
  }
  // Sort: named niches first (alphabetical), uncategorized last
  const sortedNicheKeys = [...nicheMap.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });
  for (const key of sortedNicheKeys) {
    const tpl = (templates || []).find((tp) => tp.niche === key);
    groupedProjects.push({
      niche: key,
      label: key || t('storyboardList.uncategorized'),
      color: tpl?.color || '#6b7280',
      youtubeUrl: tpl?.youtubeUrl || '',
      memo: tpl?.memo || '',
      nicheStatus: tpl?.nicheStatus || 'active',
      templateId: tpl?.id || '',
      projects: nicheMap.get(key)!,
    });
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title={t('storyboardList.title')} />
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Templates section */}
          <div className="border border-c-border rounded-xl bg-c-surface overflow-hidden">
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-c-bg/50 transition-colors"
              aria-expanded={showTemplates}
            >
              <Layout className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-medium text-c-text">{t('storyboardList.templates')}</span>
              <span className="text-xs text-c-dim bg-c-bg rounded-full px-2 py-0.5">{templates?.length || 0}</span>
              <ChevronDown className={clsx('w-4 h-4 text-c-dim ml-auto transition-transform duration-200', showTemplates && 'rotate-180')} />
            </button>

            {showTemplates && (
              <div className="border-t border-c-border p-4 space-y-3">
                {/* Auto-generate from niche */}
                <div className="flex gap-2 items-center flex-wrap">
                  <Wand2 className="w-4 h-4 text-amber-400 shrink-0" />
                  {templates && templates.length > 0 && (
                    <select
                      value={referenceTemplateId}
                      onChange={(e) => setReferenceTemplateId(e.target.value)}
                      className="input text-sm w-48 shrink-0"
                      disabled={generatingTpl}
                    >
                      <option value="">{t('storyboardList.fromScratch')}</option>
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>{t('storyboardList.basedOn', { name: tpl.niche || tpl.name })}</option>
                      ))}
                    </select>
                  )}
                  <input
                    value={generatingNiche}
                    onChange={(e) => setGeneratingNiche(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleGenerateFromNiche()}
                    placeholder={t('storyboardList.nicheInputPlaceholder')}
                    className="input text-sm flex-1"
                    disabled={generatingTpl}
                  />
                  <button
                    onClick={handleGenerateFromNiche}
                    disabled={!generatingNiche.trim() || generatingTpl}
                    className="btn-primary text-sm flex items-center gap-1.5 px-4 py-2 disabled:opacity-50"
                  >
                    {generatingTpl ? <Spinner className="w-4 h-4" /> : <Wand2 className="w-4 h-4" />}
                    {generatingTpl ? t('storyboardList.generatingTemplate') : t('storyboardList.generateTemplate')}
                  </button>
                </div>

                {/* Template cards */}
                {templates && templates.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {templates.map((tpl) => (
                      <div
                        key={tpl.id}
                        className={clsx(
                          'border rounded-lg p-3 transition-all cursor-pointer',
                          selectedTemplateId === tpl.id
                            ? 'border-violet-500/60 bg-violet-950/20 ring-1 ring-violet-500/30'
                            : 'border-c-border hover:border-c-muted bg-c-bg',
                        )}
                        onClick={() => setSelectedTemplateId(selectedTemplateId === tpl.id ? '' : tpl.id)}
                      >
                        <div className="flex items-start gap-2">
                          <div className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: tpl.color }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-c-text truncate">{tpl.name}</div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {tpl.niche && (
                                <span className="text-xs text-c-dim bg-c-surface rounded px-1.5 py-0.5">{tpl.niche}</span>
                              )}
                              {tpl.visualStyle && (
                                <span className="text-[10px] text-purple-400 bg-purple-500/10 rounded px-1.5 py-0.5">{tpl.visualStyle}</span>
                              )}
                            </div>
                            {tpl.description && (
                              <div className="text-xs text-c-muted mt-1 line-clamp-2">{tpl.description}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 mt-2 justify-end">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPromptsOpenTpl(promptsOpenTpl === tpl.id ? null : tpl.id);
                            }}
                            className={clsx(
                              'p-1.5 rounded transition-colors',
                              promptsOpenTpl === tpl.id
                                ? 'bg-purple-900/30 text-purple-300'
                                : 'hover:bg-c-surface text-c-dim hover:text-purple-300',
                            )}
                            aria-label={t('storyboardList.nichePrompts')}
                            title={t('storyboardList.nichePrompts')}
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); startEditTemplate(tpl); }}
                            className="p-1.5 rounded hover:bg-c-surface text-c-dim hover:text-c-text transition-colors"
                            aria-label={`${t('storyboardList.editTemplate')}: ${tpl.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDuplicateTemplate(tpl); }}
                            className="p-1.5 rounded hover:bg-c-surface text-c-dim hover:text-c-text transition-colors"
                            aria-label={`Duplicate: ${tpl.name}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.id); }}
                            disabled={deletingTpl === tpl.id}
                            className="p-1.5 rounded hover:bg-red-900/30 text-c-dim hover:text-red-400 transition-colors"
                            aria-label={`Delete: ${tpl.name}`}
                          >
                            {deletingTpl === tpl.id ? <Spinner className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Niche Prompts Panel — full width below grid */}
                {promptsOpenTpl && (
                  <div className="border border-purple-800/30 rounded-xl bg-purple-950/10 overflow-hidden">
                    <div className="px-4 py-2.5 flex items-center gap-2 border-b border-purple-800/20">
                      <Wand2 className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-medium text-purple-300">{t('storyboardList.nichePrompts')}</span>
                      <span className="text-xs text-c-dim">— {templates?.find(tp => tp.id === promptsOpenTpl)?.name}</span>
                      <button
                        onClick={() => setPromptsOpenTpl(null)}
                        className="ml-auto p-1 rounded hover:bg-purple-900/30 text-c-dim hover:text-c-text transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <NichePromptsPanel templateId={promptsOpenTpl} t={t} />
                  </div>
                )}

                {/* Create / Edit template form */}
                <div className="border border-c-border rounded-lg p-3 bg-c-bg space-y-2">
                  <div className="text-xs text-c-dim font-medium uppercase tracking-wider">
                    {editingTemplate ? t('storyboardList.editTemplate') : t('storyboardList.newTemplate')}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder={t('storyboardList.tplName')} className="input text-sm" />
                    <input value={tplNiche} onChange={(e) => setTplNiche(e.target.value)} placeholder={t('storyboardList.tplNiche')} className="input text-sm" list="niche-suggestions" />
                    <datalist id="niche-suggestions">
                      {niches.map((n) => <option key={n} value={n} />)}
                    </datalist>
                    <input value={tplDesc} onChange={(e) => setTplDesc(e.target.value)} placeholder={t('storyboardList.tplDescription')} className="input text-sm sm:col-span-2" />
                    <input value={tplYoutubeUrl} onChange={(e) => setTplYoutubeUrl(e.target.value)} placeholder={t('storyboardList.tplYoutubeUrl')} className="input text-sm sm:col-span-2" />
                    <input value={tplMemo} onChange={(e) => setTplMemo(e.target.value)} placeholder={t('storyboardList.tplMemo')} className="input text-sm sm:col-span-2" />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-c-dim shrink-0">{t('storyboardList.tplVisualStyle')}</span>
                      <select
                        value={tplVisualStyle}
                        onChange={(e) => setTplVisualStyle(e.target.value)}
                        className="input text-sm flex-1"
                      >
                        {VISUAL_STYLES.map(({ value, labelKey }) => (
                          <option key={value} value={value}>{t(labelKey)}</option>
                        ))}
                      </select>
                      <input
                        value={tplVisualStyle}
                        onChange={(e) => setTplVisualStyle(e.target.value)}
                        placeholder={t('storyboardList.customStyle')}
                        className="input text-sm flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-c-dim">{t('storyboardList.tplColor')}</span>
                      <div className="flex gap-1">
                        {NICHE_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setTplColor(c)}
                            className={clsx('w-6 h-6 rounded-full border-2 transition-all', tplColor === c ? 'border-white scale-110' : 'border-transparent hover:scale-105')}
                            style={{ backgroundColor: c }}
                            aria-label={`Color ${c}`}
                            aria-pressed={tplColor === c}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleSaveTemplate} disabled={!tplName.trim() || savingTpl} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
                      {savingTpl ? <Spinner className="w-3 h-3" /> : editingTemplate ? t('storyboardList.saveTemplate') : t('storyboardList.createTemplate')}
                    </button>
                    {editingTemplate && (
                      <button onClick={() => { setEditingTemplate(null); setTplName(''); setTplNiche(''); setTplDesc(''); setTplColor('#7c6af5'); setTplYoutubeUrl(''); setTplMemo(''); setTplVisualStyle(''); }} className="btn-secondary text-xs px-3 py-1.5">
                        {t('storyboardList.cancel')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Global Prompts section */}
          <div className="border border-c-border rounded-xl bg-c-surface overflow-hidden">
            <button
              onClick={() => setShowGlobalPrompts(!showGlobalPrompts)}
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-c-bg/50 transition-colors"
              aria-expanded={showGlobalPrompts}
            >
              <FileText className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-medium text-c-text">{t('storyboardList.globalPrompts')}</span>
              <span className="text-xs text-c-dim bg-c-bg rounded-full px-2 py-0.5">4</span>
              <ChevronDown className={clsx('w-4 h-4 text-c-dim ml-auto transition-transform duration-200', showGlobalPrompts && 'rotate-180')} />
            </button>
            {showGlobalPrompts && (
              <div className="border-t border-c-border">
                <GlobalPromptsPanel t={t} />
              </div>
            )}
          </div>

          {/* Create new project */}
          <div className="flex gap-2 items-center">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder={t('storyboardList.newPlaceholder')}
              className="input text-sm flex-1"
            />
            {templates && templates.length > 0 && (
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="input text-sm w-48"
              >
                <option value="">{t('storyboardList.noTemplate')}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.name}{tpl.niche ? ` (${tpl.niche})` : ''}</option>
                ))}
              </select>
            )}
            <button
              onClick={handleCreate}
              disabled={creating}
              className="btn-primary text-sm flex items-center gap-1.5 px-4 py-2"
            >
              {creating ? <Spinner className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {t('storyboardList.create')}
            </button>
          </div>

          {/* Filter bar */}
          <div className="border border-c-border rounded-lg bg-c-surface p-3 space-y-2">
            {/* Row 1: Search + Status */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-c-dim absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  placeholder={t('storyboardList.searchPlaceholder')}
                  className="input text-xs py-1.5 pl-8 w-full"
                />
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | 'draft' | 'completed')}
                className="input text-xs py-1.5 w-36"
              >
                <option value="all">{t('storyboardList.allStatus')}</option>
                <option value="draft">{t('storyboardList.statusDraft')}</option>
                <option value="completed">{t('storyboardList.statusCompleted')}</option>
              </select>
              {!isLoading && (
                <span className="text-xs text-c-dim whitespace-nowrap">
                  {t('storyboardList.projectCount', { count: filteredProjects.length })}
                </span>
              )}
            </div>

            {/* Row 2: Niche chips */}
            {niches.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Filter className="w-3 h-3 text-c-dim shrink-0" />
                <button
                  onClick={() => setFilterNiche('')}
                  className={clsx(
                    'text-xs px-2 py-0.5 rounded-full border transition-colors',
                    !filterNiche ? 'bg-violet-600/20 border-violet-500/50 text-violet-300' : 'border-c-border text-c-muted hover:text-c-text hover:border-c-muted',
                  )}
                >
                  {t('storyboardList.allNiches')}
                </button>
                {niches.map((n) => {
                  const tpl = (templates || []).find((tp) => tp.niche === n);
                  const isActive = filterNiche === n;
                  return (
                    <button
                      key={n}
                      onClick={() => setFilterNiche(isActive ? '' : n)}
                      className={clsx(
                        'text-xs px-2 py-0.5 rounded-full border transition-colors',
                        isActive ? 'border-white/30 text-white' : 'border-c-border text-c-muted hover:text-c-text hover:border-c-muted',
                      )}
                      style={isActive ? { backgroundColor: `${tpl?.color || '#7c6af5'}40`, borderColor: `${tpl?.color || '#7c6af5'}80` } : undefined}
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ backgroundColor: tpl?.color || '#6b7280' }} />
                      {n}
                    </button>
                  );
                })}
                <button
                  onClick={() => setFilterNiche(filterNiche === '__none__' ? '' : '__none__')}
                  className={clsx(
                    'text-xs px-2 py-0.5 rounded-full border transition-colors',
                    filterNiche === '__none__' ? 'bg-gray-600/20 border-gray-500/50 text-gray-300' : 'border-c-border text-c-muted hover:text-c-text hover:border-c-muted',
                  )}
                >
                  {t('storyboardList.uncategorized')}
                </button>
              </div>
            )}
          </div>

          {/* Project list grouped by niche */}
          {isLoading ? (
            <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
          ) : isError ? (
            <div className="text-center py-16 space-y-3">
              <X className="w-12 h-12 mx-auto text-red-400" />
              <p className="text-sm text-red-300">{t('common.error')}</p>
              <button onClick={() => refetch()} className="btn-secondary text-xs">{t('common.retry')}</button>
            </div>
          ) : !filteredProjects.length ? (
            <div className="text-center py-16 space-y-3">
              <Clapperboard className="w-12 h-12 mx-auto text-c-dim" />
              <p className="text-sm text-c-dim">
                {(projects?.length ?? 0) > 0
                  ? t('storyboardList.noFilterResults')
                  : t('storyboardList.empty')}
              </p>
              {(projects?.length ?? 0) > 0 && (
                <button
                  onClick={() => { setFilterNiche(''); setFilterStatus('all'); setFilterSearch(''); }}
                  className="btn-secondary text-xs"
                >
                  {t('storyboardList.clearFilters')}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {groupedProjects.map((group) => {
                const nicheKey = group.niche || '__none__';
                const isCollapsed = collapsedNiches.has(nicheKey);
                const completedCount = group.projects.filter((p) => !!p.resultFilename).length;
                const thumbnails = group.projects
                  .filter((p) => p.thumbnailUrl || p.resultFilename)
                  .slice(0, 6);

                return (
                  <div
                    key={nicheKey}
                    className="border border-c-border rounded-xl bg-c-surface overflow-hidden"
                  >
                    {/* Niche card header — Row 1: title + stats + actions */}
                    <div
                      className="px-4 pt-3.5 pb-2.5 hover:bg-c-bg/30 transition-colors cursor-pointer"
                      onClick={() => setCollapsedNiches((prev) => {
                        const next = new Set(prev);
                        if (next.has(nicheKey)) next.delete(nicheKey); else next.add(nicheKey);
                        return next;
                      })}
                    >
                      <div className="flex items-center gap-3">
                        {/* Color dot */}
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: group.color }} />

                        {/* Name */}
                        {renamingNiche === nicheKey ? (
                          <input
                            autoFocus
                            value={nicheNewName}
                            onChange={(e) => setNicheNewName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameNiche(group.niche, nicheNewName);
                              if (e.key === 'Escape') setRenamingNiche(null);
                            }}
                            onBlur={() => handleRenameNiche(group.niche, nicheNewName)}
                            onClick={(e) => e.stopPropagation()}
                            className="input text-sm font-semibold py-0.5 px-2 w-48"
                          />
                        ) : (
                          <span className="text-base font-semibold text-c-text tracking-tight">{group.label}</span>
                        )}

                        {/* Counts */}
                        <span className="text-xs text-c-muted font-medium tabular-nums">
                          {group.projects.length} {group.projects.length === 1 ? 'project' : 'projects'}
                        </span>
                        {completedCount > 0 && (
                          <span className="text-xs text-emerald-400/80 font-medium flex items-center gap-1">
                            <Film className="w-3.5 h-3.5" /> {completedCount}
                          </span>
                        )}

                        {/* Status badge */}
                        {group.templateId && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = group.nicheStatus === 'active' ? 'paused' : group.nicheStatus === 'paused' ? 'archived' : 'active';
                              storyboardApi.updateTemplate(group.templateId, { nicheStatus: next } as never).then(() => {
                                queryClient.invalidateQueries({ queryKey: ['storyboard', 'templates'] });
                                queryClient.invalidateQueries({ queryKey: ['storyboard', 'projects'] });
                              });
                            }}
                            className={clsx(
                              'text-xs px-2.5 py-0.5 rounded-full font-medium transition-colors',
                              group.nicheStatus === 'active' && 'bg-emerald-500/10 text-emerald-400',
                              group.nicheStatus === 'paused' && 'bg-amber-500/10 text-amber-400',
                              group.nicheStatus === 'archived' && 'bg-c-bg text-c-dim',
                            )}
                            title={t('storyboardList.clickToChangeStatus')}
                          >
                            {t(`storyboardList.status_${group.nicheStatus}`)}
                          </button>
                        )}

                        {/* Spacer + thumbnails + chevron */}
                        <div className="flex-1" />

                        {/* Mini thumbnail gallery */}
                        {thumbnails.length > 0 && (
                          <div className="hidden sm:flex items-center gap-1">
                            {thumbnails.map((p) => {
                              const isVid = /\.(mp4|webm|mov)$/i.test(p.thumbnailUrl || '');
                              return isVid ? (
                                <video
                                  key={p.id}
                                  src={`${p.thumbnailUrl}#t=0.1`}
                                  muted
                                  preload="metadata"
                                  className="w-9 h-6 rounded object-cover bg-c-bg shrink-0"
                                />
                              ) : (
                                <img
                                  key={p.id}
                                  src={p.thumbnailUrl}
                                  alt=""
                                  className="w-9 h-6 rounded object-cover bg-c-bg shrink-0"
                                />
                              );
                            })}
                            {group.projects.length > 6 && (
                              <span className="text-xs text-c-dim ml-0.5">+{group.projects.length - 6}</span>
                            )}
                          </div>
                        )}

                        <ChevronDown className={clsx(
                          'w-4 h-4 text-c-dim transition-transform duration-200 shrink-0',
                          !isCollapsed && 'rotate-180',
                        )} />
                      </div>

                      {/* Row 2: meta — YouTube, memo, actions */}
                      {(group.youtubeUrl || group.memo || group.templateId) && (
                        <div className="flex items-center gap-3 mt-2 ml-6 flex-wrap">
                          {/* YouTube URL */}
                          {editingYoutubeNiche === nicheKey ? (
                            <input
                              autoFocus
                              value={youtubeUrlDraft}
                              onChange={(e) => setYoutubeUrlDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveYoutubeUrl(group.templateId, youtubeUrlDraft);
                                if (e.key === 'Escape') setEditingYoutubeNiche(null);
                              }}
                              onBlur={() => handleSaveYoutubeUrl(group.templateId, youtubeUrlDraft)}
                              onClick={(e) => e.stopPropagation()}
                              placeholder={t('storyboardList.tplYoutubeUrl')}
                              className="input text-xs py-1 px-2 w-60"
                            />
                          ) : group.youtubeUrl ? (
                            <a
                              href={group.youtubeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-c-muted hover:text-violet-400 flex items-center gap-1.5 transition-colors truncate max-w-[240px]"
                              title={group.youtubeUrl}
                            >
                              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{group.youtubeUrl.replace(/^https?:\/\/(www\.)?/, '')}</span>
                            </a>
                          ) : null}
                          {group.templateId && !editingYoutubeNiche && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingYoutubeNiche(nicheKey); setYoutubeUrlDraft(group.youtubeUrl); }}
                              className="text-xs text-c-muted hover:text-c-text flex items-center gap-1.5 transition-colors"
                              title={t('storyboardList.tplYoutubeUrl')}
                            >
                              {!group.youtubeUrl && <><ExternalLink className="w-3.5 h-3.5" /> <span>{t('storyboardList.tplYoutubeUrl')}</span></>}
                              {group.youtubeUrl && <Pencil className="w-3 h-3" />}
                            </button>
                          )}

                          {/* Memo */}
                          {editingMemoNiche === nicheKey ? (
                            <input
                              autoFocus
                              value={memoDraft}
                              onChange={(e) => setMemoDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveMemo(group.templateId, memoDraft);
                                if (e.key === 'Escape') setEditingMemoNiche(null);
                              }}
                              onBlur={() => handleSaveMemo(group.templateId, memoDraft)}
                              onClick={(e) => e.stopPropagation()}
                              placeholder={t('storyboardList.tplMemo')}
                              className="input text-xs py-1 px-2 w-60"
                            />
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingMemoNiche(nicheKey); setMemoDraft(group.memo); }}
                              className="text-xs text-c-muted hover:text-c-text flex items-center gap-1.5 transition-colors truncate max-w-[220px]"
                              title={group.memo || t('storyboardList.tplMemo')}
                            >
                              <StickyNote className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{group.memo || t('storyboardList.tplMemo')}</span>
                            </button>
                          )}

                          {/* Actions — grouped */}
                          <div className="flex items-center gap-1.5 ml-auto">
                            {group.niche && renamingNiche !== nicheKey && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setRenamingNiche(nicheKey); setNicheNewName(group.niche); }}
                                className="p-1.5 rounded-md text-c-dim hover:text-c-text hover:bg-c-bg transition-colors"
                                aria-label="Rename niche"
                                title="Rename"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {group.templateId && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  storyboardApi.syncTemplatePrompts(group.templateId).then((r) => {
                                    alert(t('storyboardList.syncDone', { count: r.updated }));
                                    queryClient.invalidateQueries({ queryKey: ['storyboard', 'projects'] });
                                  });
                                }}
                                className="p-1.5 rounded-md text-c-dim hover:text-c-text hover:bg-c-bg transition-colors"
                                title={t('storyboardList.syncPrompts')}
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Expanded content */}
                    {!isCollapsed && (() => {
                      const completedProjects = group.projects.filter((p) => !!p.resultFilename);
                      const inProgressProjects = group.projects.filter((p) => !p.resultFilename);

                      return (
                        <div className="border-t border-c-border">
                          {/* Video gallery grid for completed projects */}
                          {completedProjects.length > 0 && (
                            <div className="p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <Film className="w-4 h-4 text-emerald-400" />
                                <span className="text-sm font-medium text-c-text">{t('storyboardList.videos')}</span>
                                <span className="text-xs text-c-muted font-medium tabular-nums">{completedProjects.length}</span>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                {completedProjects.map((p) => {
                                  const thumbIsVid = /\.(mp4|webm|mov)$/i.test(p.thumbnailUrl || '');
                                  const resultVideoUrl = p.resultFilename ? `/renders/storyboard/${p.resultFilename}` : '';
                                  return (
                                    <div
                                      key={p.id}
                                      className="group relative rounded-lg overflow-hidden bg-c-bg border border-c-border hover:border-c-muted transition-all cursor-pointer"
                                      onClick={() => {
                                        const videoUrl = resultVideoUrl || (thumbIsVid ? p.thumbnailUrl! : '');
                                        if (videoUrl) {
                                          setPlayingVideo({ url: videoUrl, title: p.topic || p.name, projectId: p.id });
                                        } else {
                                          navigate(`/storyboard/${p.id}`);
                                        }
                                      }}
                                    >
                                      {/* Video thumbnail — 16:9 */}
                                      <div className="aspect-video relative">
                                        {resultVideoUrl ? (
                                          <video
                                            src={`${resultVideoUrl}#t=0.5`}
                                            muted
                                            preload="metadata"
                                            className="w-full h-full object-cover"
                                          />
                                        ) : p.thumbnailUrl ? (
                                          thumbIsVid ? (
                                            <video
                                              src={`${p.thumbnailUrl}#t=0.1`}
                                              muted
                                              preload="metadata"
                                              className="w-full h-full object-cover"
                                            />
                                          ) : (
                                            <img src={p.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                                          )
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center">
                                            <Film className="w-8 h-8 text-c-dim" />
                                          </div>
                                        )}
                                        {/* Play overlay */}
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                                          <Play className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                                        </div>
                                        {/* Duration badge */}
                                        {p.audioDuration != null && (
                                          <span className="absolute bottom-1 right-1 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded">
                                            {Math.floor(p.audioDuration / 60)}:{String(Math.round(p.audioDuration % 60)).padStart(2, '0')}
                                          </span>
                                        )}
                                      </div>
                                      {/* Topic & meta */}
                                      <div className="p-2.5">
                                        <div className="text-sm font-medium text-c-text leading-snug line-clamp-2 min-h-[2.5em]">
                                          {p.topic || p.name}
                                        </div>
                                        <div className="flex items-center justify-between mt-1.5">
                                          <span className="text-xs text-c-muted truncate">{fmtDate(p.updatedAt)}</span>
                                          <div className="flex items-center gap-0.5">
                                            <button
                                              onClick={(e) => { e.stopPropagation(); navigate(`/storyboard/${p.id}`); }}
                                              className="p-1 rounded hover:bg-c-surface text-c-dim hover:text-c-text transition-colors"
                                              aria-label={`Edit ${p.name}`}
                                            >
                                              <Pencil className="w-3 h-3" />
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                                              disabled={deleting === p.id}
                                              className="p-1 rounded hover:bg-red-900/30 text-c-dim hover:text-red-400 transition-colors"
                                              aria-label={`Delete ${p.name}`}
                                            >
                                              {deleting === p.id ? <Spinner className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* In-progress projects as list */}
                          {inProgressProjects.length > 0 && (
                            <div className={clsx(completedProjects.length > 0 && 'border-t border-c-border')}>
                              {completedProjects.length > 0 && (
                                <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
                                  <Clock className="w-4 h-4 text-amber-400" />
                                  <span className="text-sm font-medium text-c-text">{t('storyboardList.statusDraft')}</span>
                                  <span className="text-xs text-c-muted font-medium tabular-nums">{inProgressProjects.length}</span>
                                </div>
                              )}
                              {inProgressProjects.map((p: StoryboardProjectSummary) => {
                                const StepIcon = STEP_ICONS[p.currentStep] || Clock;
                                const stepColor = STEP_COLORS[p.currentStep] || 'text-c-dim';
                                const currentIdx = STEP_ORDER.indexOf(p.currentStep);
                                const thumbIsVid = /\.(mp4|webm|mov)$/i.test(p.thumbnailUrl || '');

                                return (
                                  <div
                                    key={p.id}
                                    className="flex items-center gap-3 px-4 py-3 hover:bg-c-bg/30 transition-colors border-b border-c-border last:border-b-0"
                                  >
                                    {/* Thumbnail */}
                                    {p.thumbnailUrl ? (
                                      thumbIsVid ? (
                                        <video
                                          src={`${p.thumbnailUrl}#t=0.1`}
                                          muted preload="metadata"
                                          className="w-16 h-10 rounded-lg object-cover bg-c-bg shrink-0"
                                        />
                                      ) : (
                                        <img src={p.thumbnailUrl} alt="" className="w-16 h-10 rounded-lg object-cover bg-c-bg shrink-0" />
                                      )
                                    ) : (
                                      <div className={clsx('w-16 h-10 rounded-lg flex items-center justify-center bg-c-bg shrink-0', stepColor)}>
                                        <StepIcon className="w-4 h-4" />
                                      </div>
                                    )}

                                    {/* Info */}
                                    <button
                                      onClick={() => navigate(`/storyboard/${p.id}`)}
                                      className="flex-1 text-left min-w-0"
                                    >
                                      {p.topic && (
                                        <div className="text-sm font-medium text-c-text leading-snug line-clamp-2">
                                          {p.topic}
                                        </div>
                                      )}
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-xs text-c-muted truncate">{p.name}</span>
                                        <span className={clsx('text-xs font-medium uppercase shrink-0', stepColor)}>
                                          {t(`storyboard.step${p.currentStep.charAt(0).toUpperCase() + p.currentStep.slice(1)}`)}
                                        </span>
                                        {p.audioDuration != null && (
                                          <span className="text-xs text-c-dim shrink-0">{Math.round(p.audioDuration)}s</span>
                                        )}
                                      </div>
                                      {/* Step progress dots */}
                                      <div className="flex items-center gap-1 mt-1">
                                        {STEP_ORDER.map((s, i) => {
                                          const done = i < currentIdx;
                                          const active = i === currentIdx;
                                          const dotColor = STEP_DOT_COLORS[s] || 'bg-c-dim';
                                          return (
                                            <div key={s} className="flex items-center gap-1">
                                              <div
                                                className={clsx(
                                                  'rounded-full transition-all',
                                                  active ? `w-4 h-1.5 ${dotColor}` : 'w-1.5 h-1.5',
                                                  done ? dotColor : active ? dotColor : 'bg-c-border',
                                                )}
                                                title={t(`storyboard.step${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                                              />
                                              {i < STEP_ORDER.length - 1 && (
                                                <div className={clsx('w-2 h-px', done ? 'bg-c-muted' : 'bg-c-border')} />
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </button>

                                    <div className="text-xs text-c-muted shrink-0 text-right">{fmtDate(p.updatedAt)}</div>

                                    <button
                                      onClick={() => handleDelete(p.id)}
                                      disabled={deleting === p.id}
                                      className="p-2 rounded-lg hover:bg-red-900/30 text-c-dim hover:text-red-400 transition-colors shrink-0"
                                      aria-label={`Delete ${p.name}`}
                                    >
                                      {deleting === p.id ? <Spinner className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Video player modal */}
      {playingVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPlayingVideo(null)}
        >
          <div
            className="relative w-full max-w-3xl mx-4 bg-c-bg rounded-xl overflow-hidden shadow-2xl border border-c-border"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-c-border">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-c-text truncate">{playingVideo.title}</div>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <button
                  onClick={() => { setPlayingVideo(null); navigate(`/storyboard/${playingVideo.projectId}`); }}
                  className="p-1.5 rounded-lg hover:bg-c-surface text-c-muted hover:text-c-text transition-colors"
                  aria-label="Edit project"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPlayingVideo(null)}
                  className="p-1.5 rounded-lg hover:bg-c-surface text-c-muted hover:text-c-text transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Video */}
            <div className="aspect-video bg-black">
              <video
                src={playingVideo.url}
                controls
                autoPlay
                className="w-full h-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
