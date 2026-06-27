import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ExternalLink, BarChart2 } from 'lucide-react';
import { clsx } from 'clsx';
import { distributionsApi, videosApi } from '../lib/api';
import type { DistributionStatus, Platform } from '@videocloudai/shared';

const STATUS_COLORS: Record<DistributionStatus, string> = {
  pending:  'bg-c-elevated text-c-muted',
  exported: 'bg-blue-500/10 text-blue-400',
  uploaded: 'bg-green-500/10 text-green-400',
  failed:   'bg-red-500/10 text-red-400',
};

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  'youtube-shorts': 'YouTube Shorts',
  'instagram-reels': 'Instagram Reels',
  'facebook-reels': 'Facebook Reels',
  twitter: 'Twitter / X',
  custom: 'Custom',
};

const PLATFORM_COLORS: Record<string, string> = {
  tiktok: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  'youtube-shorts': 'bg-red-500/15 text-red-400 border-red-500/30',
  'instagram-reels': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  'facebook-reels': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  twitter: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  custom: 'bg-c-elevated text-c-muted border-c-border',
};

const ALL_STATUSES: DistributionStatus[] = ['pending', 'exported', 'uploaded', 'failed'];

export function Distributions() {
  const { t } = useTranslation();
  const [filterStatus, setFilterStatus] = useState<DistributionStatus | ''>('');
  const [filterPlatform, setFilterPlatform] = useState<Platform | ''>('');

  const { data: distributions = [], isLoading } = useQuery({
    queryKey: ['distributions'],
    queryFn: () => distributionsApi.list(),
  });

  const { data: videos = [] } = useQuery({
    queryKey: ['videos'],
    queryFn: () => videosApi.list(),
  });

  const videoMap = new Map(videos.map((v) => [v.id, v.title]));

  const filtered = distributions.filter((d) => {
    if (filterStatus && d.status !== filterStatus) return false;
    if (filterPlatform && d.channel?.platform !== filterPlatform) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-c-border">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-c-text flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-[#7c6af5]" />
              {t('distributions.title')}
            </h1>
            <p className="text-xs text-c-muted mt-0.5">{t('distributions.subtitle')}</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <select
            className="bg-c-elevated border border-c-border rounded-lg px-3 py-1.5 text-sm text-c-text focus:outline-none focus:border-[#7c6af5]"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as DistributionStatus | '')}
          >
            <option value="">{t('distributions.filterAll')}</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{t(`distribution.status.${s}`)}</option>
            ))}
          </select>
          <select
            className="bg-c-elevated border border-c-border rounded-lg px-3 py-1.5 text-sm text-c-text focus:outline-none focus:border-[#7c6af5]"
            value={filterPlatform}
            onChange={(e) => setFilterPlatform(e.target.value as Platform | '')}
          >
            <option value="">{t('channels.allPlatforms')}</option>
            {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {(filterStatus || filterPlatform) && (
            <button
              onClick={() => { setFilterStatus(''); setFilterPlatform(''); }}
              className="text-xs text-c-muted hover:text-c-text transition-colors"
            >
              {t('distributions.filterAll')} ×
            </button>
          )}
          <span className="text-xs text-c-dim ml-auto">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="text-sm text-c-muted text-center py-12">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <BarChart2 className="w-10 h-10 text-c-dim mx-auto mb-3" />
            <div className="text-sm text-c-muted">{t('distributions.noDistributions')}</div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((d) => {
              const videoTitle = videoMap.get(d.videoId) ?? d.videoId;
              const platform = d.channel?.platform ?? 'custom';
              const platformLabel = PLATFORM_LABELS[platform] ?? platform;
              const platformColor = PLATFORM_COLORS[platform] ?? PLATFORM_COLORS.custom;

              return (
                <div
                  key={d.id}
                  className="bg-c-surface border border-c-border rounded-xl p-4 flex items-start gap-4"
                >
                  {/* Left: video title + channel */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-medium text-c-text truncate">{videoTitle}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', platformColor)}>
                        {platformLabel}
                      </span>
                      {d.channel?.name && (
                        <span className="text-xs text-c-muted">{d.channel.name}</span>
                      )}
                      {d.channel?.handle && (
                        <span className="text-xs text-c-dim">{d.channel.handle}</span>
                      )}
                    </div>
                    {d.note && (
                      <p className="text-xs text-c-muted">{d.note}</p>
                    )}
                    {d.performanceNote && (
                      <p className="text-xs text-c-muted italic">📊 {d.performanceNote}</p>
                    )}
                  </div>

                  {/* Right: status + date + link */}
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[d.status])}>
                      {t(`distribution.status.${d.status}`)}
                    </span>
                    {d.publishedAt && (
                      <span className="text-xs text-c-dim">
                        {new Date(d.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                    {!d.publishedAt && (
                      <span className="text-xs text-c-dim">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </span>
                    )}
                    {d.platformUrl && (
                      <a
                        href={d.platformUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#9180ff] hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {t('distribution.viewPost')}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
