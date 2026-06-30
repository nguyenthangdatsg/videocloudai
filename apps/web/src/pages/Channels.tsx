import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, ExternalLink, ToggleLeft, ToggleRight, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { channelsApi } from '../lib/api';
import type { Channel, Platform } from '@videocloudai/shared';

const PLATFORMS: { value: Platform; label: string; color: string }[] = [
  { value: 'tiktok',           label: 'TikTok',            color: 'bg-pink-500/15 text-pink-400 border-pink-500/30' },
  { value: 'youtube-shorts',   label: 'YouTube Shorts',    color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  { value: 'instagram-reels',  label: 'Instagram Reels',   color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  { value: 'facebook-reels',   label: 'Facebook Reels',    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  { value: 'twitter',          label: 'Twitter / X',       color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  { value: 'custom',           label: 'Custom',            color: 'bg-c-elevated text-c-muted border-c-border' },
];

const EMPTY_FORM = { name: '', platform: 'tiktok' as Platform, handle: '', url: '', description: '', defaultCaption: '', defaultHashtags: '' };

interface ChannelFormProps {
  initial?: Partial<Channel>;
  onSave: (data: typeof EMPTY_FORM) => void;
  onCancel: () => void;
  saving: boolean;
}

function ChannelForm({ initial, onSave, onCancel, saving }: ChannelFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    platform: initial?.platform ?? 'tiktok',
    handle: initial?.handle ?? '',
    url: initial?.url ?? '',
    description: initial?.description ?? '',
    defaultCaption: initial?.defaultCaption ?? '',
    defaultHashtags: initial?.defaultHashtags ?? '',
  } as typeof EMPTY_FORM);
  const [captionOpen, setCaptionOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('channels.name')} *</label>
          <input
            className="w-full bg-c-elevated border border-c-border rounded-lg px-3 py-2 text-sm text-c-text focus:outline-none focus:border-accent-primary"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('channels.namePlaceholder')}
          />
        </div>
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('channels.platform')} *</label>
          <select
            className="w-full bg-c-elevated border border-c-border rounded-lg px-3 py-2 text-sm text-c-text focus:outline-none focus:border-accent-primary"
            value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('channels.handle')}</label>
          <input
            className="w-full bg-c-elevated border border-c-border rounded-lg px-3 py-2 text-sm text-c-text focus:outline-none focus:border-accent-primary"
            value={form.handle}
            onChange={(e) => setForm({ ...form, handle: e.target.value })}
            placeholder="@handle"
          />
        </div>
        <div>
          <label className="block text-xs text-c-muted mb-1">{t('channels.url')}</label>
          <input
            className="w-full bg-c-elevated border border-c-border rounded-lg px-3 py-2 text-sm text-c-text focus:outline-none focus:border-accent-primary"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder="https://..."
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-c-muted mb-1">{t('channels.description')}</label>
        <input
          className="w-full bg-c-elevated border border-c-border rounded-lg px-3 py-2 text-sm text-c-text focus:outline-none focus:border-accent-primary"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder={t('channels.descriptionPlaceholder')}
        />
      </div>
      {/* Caption Template collapsible */}
      <div className="border border-c-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setCaptionOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-c-muted hover:text-c-text hover:bg-c-elevated transition-colors"
        >
          <span className="font-medium">{t('channels.captionTemplate')}</span>
          {captionOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {captionOpen && (
          <div className="px-3 pb-3 pt-1 space-y-2 bg-c-bg">
            <p className="text-xs text-c-dim">{t('channels.captionTemplateHint')}</p>
            <div>
              <label className="block text-xs text-c-muted mb-1">{t('channels.defaultCaption')}</label>
              <textarea
                className="w-full bg-c-elevated border border-c-border rounded-lg px-3 py-2 text-sm text-c-text focus:outline-none focus:border-accent-primary resize-none h-20"
                value={form.defaultCaption}
                onChange={(e) => setForm({ ...form, defaultCaption: e.target.value })}
                placeholder="Your default caption text..."
              />
            </div>
            <div>
              <label className="block text-xs text-c-muted mb-1">{t('channels.defaultHashtags')}</label>
              <input
                className="w-full bg-c-elevated border border-c-border rounded-lg px-3 py-2 text-sm text-c-text focus:outline-none focus:border-accent-primary"
                value={form.defaultHashtags}
                onChange={(e) => setForm({ ...form, defaultHashtags: e.target.value })}
                placeholder="#hashtag1 #hashtag2"
              />
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-c-muted hover:text-c-text rounded-lg hover:bg-c-elevated transition-colors">
          {t('common.cancel')}
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={!form.name.trim() || saving}
          className="px-4 py-1.5 text-sm bg-accent-primary hover:bg-accent-hover text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </div>
  );
}

interface ChannelCardProps {
  ch: Channel;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (data: typeof EMPTY_FORM) => void;
  savingEdit: boolean;
  onToggleActive: () => void;
  onDelete: () => void;
}

function ChannelCard({ ch, editing, onEdit, onCancelEdit, onSaveEdit, savingEdit, onToggleActive, onDelete }: ChannelCardProps) {
  const { t } = useTranslation();
  const platMeta = PLATFORMS.find((p) => p.value === ch.platform) ?? PLATFORMS[PLATFORMS.length - 1];

  return (
    <div className={clsx('bg-c-surface border rounded-xl p-4 transition-colors', ch.isActive ? 'border-c-border' : 'border-c-border opacity-60')}>
      {editing ? (
        <ChannelForm initial={ch} onSave={onSaveEdit} onCancel={onCancelEdit} saving={savingEdit} />
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', platMeta.color)}>
                {platMeta.label}
              </span>
              <span className="text-sm font-medium text-c-text">{ch.name}</span>
              {ch.handle && <span className="text-xs text-c-muted">{ch.handle}</span>}
              {!ch.isActive && (
                <span className="text-xs text-c-dim bg-c-elevated px-1.5 py-0.5 rounded-full">
                  {t('channels.inactive')}
                </span>
              )}
            </div>
            {ch.description && <p className="text-xs text-c-muted mt-0.5 truncate">{ch.description}</p>}
            {ch.url && (
              <a href={ch.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent-hover hover:underline mt-0.5">
                <ExternalLink className="w-3 h-3" />{ch.url}
              </a>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onToggleActive}
              className="p-1.5 rounded-lg text-c-muted hover:text-c-text hover:bg-c-elevated transition-colors"
              title={ch.isActive ? t('channels.deactivate') : t('channels.activate')}>
              {ch.isActive ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4" />}
            </button>
            <button onClick={onEdit} className="p-1.5 rounded-lg text-c-muted hover:text-c-text hover:bg-c-elevated transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg text-c-muted hover:text-red-400 hover:bg-red-500/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Channels() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [filterPlatform, setFilterPlatform] = useState<Platform | ''>('');

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ['channels', filterPlatform],
    queryFn: () => channelsApi.list(filterPlatform || undefined),
  });

  const createMutation = useMutation({
    mutationFn: channelsApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['channels'] }); setShowCreate(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof channelsApi.update>[1] }) =>
      channelsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['channels'] }); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: channelsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  });

  const toggleActive = (ch: Channel) =>
    updateMutation.mutate({ id: ch.id, data: { isActive: !ch.isActive } });

  const grouped = PLATFORMS.map((p) => ({
    ...p,
    channels: channels.filter((c) => c.platform === p.value),
  }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-c-border flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-c-text">{t('channels.title')}</h1>
          <p className="text-xs text-c-muted mt-0.5">{t('channels.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="bg-c-elevated border border-c-border rounded-lg px-3 py-1.5 text-sm text-c-text focus:outline-none focus:border-accent-primary"
            value={filterPlatform}
            onChange={(e) => setFilterPlatform(e.target.value as Platform | '')}
          >
            <option value="">{t('channels.allPlatforms')}</option>
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent-primary hover:bg-accent-hover text-white rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('channels.addChannel')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {/* Create form */}
        {showCreate && (
          <div className="bg-c-surface border border-accent-glow rounded-xl p-4">
            <h3 className="text-sm font-medium text-c-text mb-3">{t('channels.newChannel')}</h3>
            <ChannelForm
              onSave={(data) => createMutation.mutate(data)}
              onCancel={() => setShowCreate(false)}
              saving={createMutation.isPending}
            />
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-c-muted text-center py-12">{t('common.loading')}</div>
        ) : channels.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-c-muted text-sm">{t('channels.empty')}</div>
            <div className="text-c-dim text-xs mt-1">{t('channels.emptyHint')}</div>
          </div>
        ) : (
          grouped.map((group) =>
            group.channels.length === 0 ? null : (
              <div key={group.value}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', group.color)}>
                    {group.label}
                  </span>
                  <span className="text-xs text-c-dim">{group.channels.length}</span>
                </div>
                <div className="space-y-2">
                  {group.channels.map((ch) => (
                    <ChannelCard
                      key={ch.id}
                      ch={ch}
                      editing={editing === ch.id}
                      onEdit={() => setEditing(ch.id)}
                      onCancelEdit={() => setEditing(null)}
                      onSaveEdit={(data) => updateMutation.mutate({ id: ch.id, data })}
                      savingEdit={updateMutation.isPending}
                      onToggleActive={() => toggleActive(ch)}
                      onDelete={() => {
                        if (confirm(t('channels.confirmDelete', { name: ch.name }))) {
                          deleteMutation.mutate(ch.id);
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
