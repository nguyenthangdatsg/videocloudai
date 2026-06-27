import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  X, Check, Download, ExternalLink, Trash2, CheckCircle2, Clock,
  AlertCircle, Upload, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { channelsApi, distributionsApi, exportApi } from '../../lib/api';
import type { Distribution, DistributionStatus, Platform, VideoFormat } from '@videocloudai/shared';

const PLATFORM_FORMAT: Record<Platform, VideoFormat> = {
  'tiktok': 'tiktok',
  'youtube-shorts': 'youtube-shorts',
  'instagram-reels': 'instagram-reels',
  'facebook-reels': 'instagram-reels',
  'twitter': 'custom',
  'custom': 'custom',
};

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  'youtube-shorts': 'YouTube Shorts',
  'instagram-reels': 'Instagram Reels',
  'facebook-reels': 'Facebook Reels',
  twitter: 'Twitter / X',
  custom: 'Custom',
};

const STATUS_META: Record<DistributionStatus, { icon: React.ReactNode; className: string }> = {
  pending:  { icon: <Clock className="w-3.5 h-3.5" />,       className: 'text-c-muted'  },
  exported: { icon: <Download className="w-3.5 h-3.5" />,    className: 'text-blue-400' },
  uploaded: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, className: 'text-green-400' },
  failed:   { icon: <AlertCircle className="w-3.5 h-3.5" />, className: 'text-red-400'  },
};

interface Props {
  videoId: string;
  videoTitle: string;
  onClose: () => void;
}

export function DistributeModal({ videoId, videoTitle, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [view, setView] = useState<'select' | 'history'>('select');
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => channelsApi.list(),
  });

  const { data: distributions = [], refetch: refetchDists } = useQuery({
    queryKey: ['distributions', videoId],
    queryFn: () => distributionsApi.list({ videoId }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof distributionsApi.update>[1] }) =>
      distributionsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['distributions', videoId] }); refetchDists(); },
  });

  const deleteMutation = useMutation({
    mutationFn: distributionsApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['distributions', videoId] }); refetchDists(); },
  });

  const activeChannels = channels.filter((c) => c.isActive);
  const distributedChannelIds = new Set(distributions.map((d) => d.channelId));

  const toggleChannel = (id: string) => {
    if (distributedChannelIds.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Auto-populate note from channel's defaultCaption if note is empty
        const ch = activeChannels.find((c) => c.id === id);
        if (ch?.defaultCaption) {
          setNote((currentNote) => currentNote.trim() === '' ? ch.defaultCaption! : currentNote);
        }
      }
      return next;
    });
  };

  const handlePrepare = async () => {
    const selectedChannels = activeChannels.filter((c) => selected.has(c.id));
    if (selectedChannels.length === 0) return;

    setPreparing(true);
    setPrepareError('');

    try {
      // Export platform-optimised files
      const formats = [...new Set(selectedChannels.map((c) => PLATFORM_FORMAT[c.platform]))];
      const exportResult = await exportApi.export(videoId, formats) as { exports: Record<string, string> };

      // Create a distribution record per channel
      for (const ch of selectedChannels) {
        if (distributedChannelIds.has(ch.id)) continue;
        await distributionsApi.create({
          videoId,
          channelId: ch.id,
          status: 'exported',
          exportPath: exportResult.exports?.[PLATFORM_FORMAT[ch.platform]],
          note: note.trim() || undefined,
        });
      }

      await refetchDists();
      setSelected(new Set());
      setNote('');
      setView('history');
    } catch (err) {
      setPrepareError((err as Error).message ?? t('common.error'));
    } finally {
      setPreparing(false);
    }
  };

  // Group channels by platform
  const grouped = activeChannels.reduce<Record<string, typeof activeChannels>>((acc, ch) => {
    (acc[ch.platform] ??= []).push(ch);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-c-bg border border-c-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-c-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-c-text">{t('distribution.modalTitle')}</h2>
            <p className="text-xs text-c-muted mt-0.5 truncate max-w-xs">{videoTitle}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-c-muted hover:text-c-text hover:bg-c-elevated transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-c-border shrink-0">
          {(['select', 'history'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setView(tab)}
              className={clsx(
                'flex-1 py-2.5 text-xs font-medium transition-colors',
                view === tab
                  ? 'text-[#9180ff] border-b-2 border-[#7c6af5]'
                  : 'text-c-muted hover:text-c-text'
              )}
            >
              {tab === 'select' ? t('distribution.tabSelect') : `${t('distribution.tabHistory')} (${distributions.length})`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {view === 'select' ? (
            <div className="p-4 space-y-4">
              {/* Workflow hint */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2.5 text-xs text-blue-300 space-y-1">
                <div className="font-medium">{t('distribution.workflowTitle')}</div>
                <div className="text-blue-300/70">{t('distribution.workflowSteps')}</div>
              </div>

              {activeChannels.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-c-muted">{t('distribution.noChannels')}</p>
                  <p className="text-xs text-c-dim mt-1">{t('distribution.noChannelsHint')}</p>
                </div>
              ) : (
                <>
                  {Object.entries(grouped).map(([platform, chs]) => (
                    <div key={platform}>
                      <div className="text-xs font-medium text-c-muted uppercase tracking-wider mb-2">
                        {PLATFORM_LABELS[platform] ?? platform}
                      </div>
                      <div className="space-y-1.5">
                        {chs.map((ch) => {
                          const alreadyDone = distributedChannelIds.has(ch.id);
                          const isSelected = selected.has(ch.id);
                          return (
                            <button
                              key={ch.id}
                              onClick={() => toggleChannel(ch.id)}
                              disabled={alreadyDone}
                              className={clsx(
                                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all',
                                alreadyDone
                                  ? 'border-green-500/30 bg-green-500/5 opacity-70 cursor-default'
                                  : isSelected
                                  ? 'border-[#7c6af5]/60 bg-[#7c6af5]/10'
                                  : 'border-c-border bg-c-surface hover:bg-c-elevated'
                              )}
                            >
                              <div className={clsx(
                                'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                                alreadyDone ? 'border-green-500 bg-green-500'
                                  : isSelected ? 'border-[#7c6af5] bg-[#7c6af5]'
                                  : 'border-c-border'
                              )}>
                                {(alreadyDone || isSelected) && <Check className="w-2.5 h-2.5 text-white" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-c-text font-medium">{ch.name}</div>
                                {ch.handle && <div className="text-xs text-c-muted">{ch.handle}</div>}
                              </div>
                              {alreadyDone && (
                                <span className="text-xs text-green-400 shrink-0">{t('distribution.alreadyPrepared')}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div>
                    <label className="block text-xs text-c-muted mb-1">{t('distribution.noteLabel')}</label>
                    <input
                      className="w-full bg-c-elevated border border-c-border rounded-lg px-3 py-2 text-sm text-c-text focus:outline-none focus:border-[#7c6af5]"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('distribution.notePlaceholder')}
                    />
                  </div>

                  {prepareError && (
                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      {prepareError}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {distributions.length === 0 ? (
                <div className="text-center py-8 text-sm text-c-muted">{t('distribution.noHistory')}</div>
              ) : (
                distributions.map((d) => (
                  <DistributionRow
                    key={d.id}
                    dist={d}
                    videoId={videoId}
                    onMarkUploaded={(url) =>
                      updateMutation.mutate({ id: d.id, data: { status: 'uploaded', platformUrl: url || null } })
                    }
                    onDelete={() => deleteMutation.mutate(d.id)}
                    onSavePerformanceNote={(note) =>
                      updateMutation.mutate({ id: d.id, data: { performanceNote: note || null } })
                    }
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {view === 'select' && activeChannels.length > 0 && (
          <div className="shrink-0 px-4 py-3 border-t border-c-border flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-c-muted hover:text-c-text rounded-lg hover:bg-c-elevated transition-colors">
              {t('common.cancel')}
            </button>
            <button
              onClick={handlePrepare}
              disabled={selected.size === 0 || preparing}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-[#7c6af5] hover:bg-[#6b5ce7] text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {preparing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Download className="w-3.5 h-3.5" />}
              {preparing ? t('distribution.preparing') : t('distribution.prepareBtn', { count: selected.size })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DistributionRow({
  dist,
  videoId,
  onMarkUploaded,
  onDelete,
  onSavePerformanceNote,
}: {
  dist: Distribution;
  videoId: string;
  onMarkUploaded: (url: string) => void;
  onDelete: () => void;
  onSavePerformanceNote: (note: string) => void;
}) {
  const { t } = useTranslation();
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteInput, setNoteInput] = useState(dist.performanceNote ?? '');

  const meta = STATUS_META[dist.status];
  const format = dist.channel ? PLATFORM_FORMAT[dist.channel.platform] : 'custom';
  const downloadUrl = distributionsApi.platformDownloadUrl(videoId, format);

  return (
    <div className="bg-c-surface border border-c-border rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx('flex items-center gap-1', meta.className)}>{meta.icon}</span>
            <span className="text-sm font-medium text-c-text">
              {dist.channel?.name ?? dist.channelId}
            </span>
            {dist.channel?.handle && (
              <span className="text-xs text-c-muted">{dist.channel.handle}</span>
            )}
            <span className={clsx('text-xs px-1.5 py-0.5 rounded-full', {
              'bg-c-elevated text-c-muted':    dist.status === 'pending',
              'bg-blue-500/10 text-blue-400':  dist.status === 'exported',
              'bg-green-500/10 text-green-400': dist.status === 'uploaded',
              'bg-red-500/10 text-red-400':    dist.status === 'failed',
            })}>
              {t(`distribution.status.${dist.status}`)}
            </span>
          </div>
          {dist.note && <p className="text-xs text-c-muted mt-0.5">{dist.note}</p>}
          {dist.platformUrl && (
            <a href={dist.platformUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#9180ff] hover:underline mt-0.5">
              <ExternalLink className="w-3 h-3" />{t('distribution.viewPost')}
            </a>
          )}
          {dist.publishedAt && (
            <div className="text-xs text-c-dim mt-0.5">
              {t('distribution.uploadedAt', { date: new Date(dist.publishedAt).toLocaleDateString() })}
            </div>
          )}
          {dist.status === 'uploaded' && dist.performanceNote && (
            <div className="text-xs text-c-muted mt-1 italic">{dist.performanceNote}</div>
          )}
        </div>
        <button onClick={onDelete}
          className="p-1.5 rounded-lg text-c-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Performance note for uploaded distributions */}
      {dist.status === 'uploaded' && !showNoteInput && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setNoteInput(dist.performanceNote ?? ''); setShowNoteInput(true); }}
            className="text-xs text-c-dim hover:text-c-muted flex items-center gap-1 transition-colors"
          >
            + {t('distribution.addPerformanceNote')}
          </button>
        </div>
      )}
      {dist.status === 'uploaded' && showNoteInput && (
        <div className="space-y-1.5">
          <label className="text-xs text-c-muted">{t('distribution.performanceNote')}</label>
          <textarea
            autoFocus
            className="w-full bg-c-elevated border border-c-border rounded-lg px-2.5 py-1.5 text-xs text-c-text focus:outline-none focus:border-[#7c6af5] resize-none h-16"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="views: 1200, likes: 80"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { onSavePerformanceNote(noteInput); setShowNoteInput(false); }}
              className="px-3 py-1 text-xs bg-[#7c6af5]/20 text-[#9180ff] border border-[#7c6af5]/30 rounded-lg hover:bg-[#7c6af5]/30 transition-colors"
            >
              {t('distribution.saveNote')}
            </button>
            <button
              onClick={() => setShowNoteInput(false)}
              className="px-3 py-1 text-xs text-c-muted hover:text-c-text rounded-lg hover:bg-c-elevated transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {dist.status !== 'uploaded' && (
        <div className="flex items-center gap-2 flex-wrap">
          {dist.status === 'exported' && (
            <a href={downloadUrl} download
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 transition-colors">
              <Download className="w-3 h-3" />
              {t('distribution.download', { platform: PLATFORM_LABELS[dist.channel?.platform ?? 'custom'] ?? dist.channel?.platform })}
            </a>
          )}
          {dist.status === 'exported' && !showUrlInput && (
            <button onClick={() => setShowUrlInput(true)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-500/20 transition-colors">
              <Upload className="w-3 h-3" />
              {t('distribution.markUploaded')}
            </button>
          )}
        </div>
      )}

      {showUrlInput && (
        <div className="flex gap-2">
          <input autoFocus
            className="flex-1 bg-c-elevated border border-c-border rounded-lg px-2.5 py-1.5 text-xs text-c-text focus:outline-none focus:border-[#7c6af5]"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={t('distribution.postUrlPlaceholder')}
          />
          <button onClick={() => { onMarkUploaded(urlInput); setShowUrlInput(false); }}
            className="px-3 py-1.5 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30 transition-colors">
            <Check className="w-3 h-3" />
          </button>
          <button onClick={() => setShowUrlInput(false)}
            className="px-3 py-1.5 text-xs text-c-muted hover:text-c-text rounded-lg hover:bg-c-elevated transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
