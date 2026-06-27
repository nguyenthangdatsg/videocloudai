import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { libraryApi } from '../lib/api';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { useAppStore } from '../store';
import {
  Search,
  Library,
  Film,
  Image,
  RefreshCw,
  Tag,
} from 'lucide-react';
import type { SceneMood, SceneStyle } from '@videocloudai/shared';
import { clsx } from 'clsx';

const MOODS: SceneMood[] = [
  'sad', 'hopeful', 'dramatic', 'energetic', 'calm',
  'mysterious', 'romantic', 'dark', 'uplifting', 'tense', 'melancholic', 'euphoric',
];

const STYLES: SceneStyle[] = [
  'anime-cinematic', 'documentary', 'noir', 'dark-fantasy',
  'sci-fi', 'emotional-storytelling', 'cyberpunk', 'natural', 'vintage', 'modern',
];

export function SceneLibrary() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMood, setSelectedMood] = useState<SceneMood | ''>(
    (searchParams.get('mood') as SceneMood) ?? ''
  );
  const [selectedStyle, setSelectedStyle] = useState<SceneStyle | ''>('');

  const { selectedSceneId, setSelectedSceneId } = useAppStore();

  const { data: scenes, isLoading } = useQuery({
    queryKey: ['library', 'scenes', selectedMood, selectedStyle],
    queryFn: () =>
      libraryApi.listScenes({
        mood: selectedMood || undefined,
        style: selectedStyle || undefined,
        limit: 100,
      }),
  });

  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ['library', 'search', searchQuery],
    queryFn: () => libraryApi.searchScenes(searchQuery),
    enabled: searchQuery.length > 2,
  });

  const { data: stats } = useQuery({
    queryKey: ['library', 'stats'],
    queryFn: libraryApi.stats,
  });

  const { data: selectedAssets } = useQuery({
    queryKey: ['library', 'assets', selectedSceneId],
    queryFn: () => libraryApi.listAssets(selectedSceneId!),
    enabled: !!selectedSceneId,
  });

  const displayedScenes = searchQuery.length > 2 ? (searchResults ?? []) : (scenes ?? []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={t('library.title')}
        subtitle={`${stats?.totalScenes ?? 0} ${t('library.scenes')} · ${stats?.totalAssets ?? 0} ${t('library.assets')}`}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Filters sidebar */}
        <div className="w-52 border-r border-c-border overflow-auto p-4 space-y-5 shrink-0">
          {/* Stats */}
          <div className="space-y-2">
            <div className="text-xs text-c-muted uppercase tracking-wider">{t('library.overview')}</div>
            {[
              { label: t('library.scenes'), value: stats?.totalScenes ?? 0 },
              { label: t('library.assets'), value: stats?.totalAssets ?? 0 },
              { label: t('library.clips'), value: stats?.totalReusableClips ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-c-muted">{label}</span>
                <span className="text-c-text font-medium">{value}</span>
              </div>
            ))}
          </div>

          {/* Mood filter */}
          <div>
            <div className="text-xs text-c-muted uppercase tracking-wider mb-2">{t('library.mood')}</div>
            <div className="space-y-0.5">
              <button
                onClick={() => { setSelectedMood(''); setSearchParams({}); }}
                className={clsx(
                  'w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors',
                  !selectedMood ? 'bg-[#7c6af520] text-[#9180ff]' : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                )}
              >
                {t('library.allMoods')}
              </button>
              {MOODS.map((mood) => (
                <button
                  key={mood}
                  onClick={() => { setSelectedMood(mood); setSearchParams({ mood }); }}
                  className={clsx(
                    'w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors flex items-center gap-2',
                    selectedMood === mood ? 'bg-[#7c6af520] text-[#9180ff]' : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                  )}
                >
                  <span className={`w-1.5 h-1.5 rounded-full mood-${mood}`} style={{ display: 'inline-block' }} />
                  <span className="capitalize">{mood}</span>
                  {stats?.byMood?.[mood] ? (
                    <span className="ml-auto text-c-dim">{stats.byMood[mood]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {/* Style filter */}
          <div>
            <div className="text-xs text-c-muted uppercase tracking-wider mb-2">{t('library.style')}</div>
            <div className="space-y-0.5">
              <button
                onClick={() => setSelectedStyle('')}
                className={clsx(
                  'w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors',
                  !selectedStyle ? 'bg-[#7c6af520] text-[#9180ff]' : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                )}
              >
                {t('library.allStyles')}
              </button>
              {STYLES.map((style) => (
                <button
                  key={style}
                  onClick={() => setSelectedStyle(style)}
                  className={clsx(
                    'w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors',
                    selectedStyle === style ? 'bg-[#7c6af520] text-[#9180ff]' : 'text-c-muted hover:text-c-text hover:bg-c-elevated'
                  )}
                >
                  {style.replace(/-/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search bar */}
          <div className="px-6 py-3 border-b border-c-border">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-c-dim" />
              <input
                className="input pl-9"
                placeholder={t('library.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto p-6">
            {(isLoading || searching) ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : displayedScenes.length === 0 ? (
              <div className="text-center py-16">
                <Library className="w-10 h-10 text-c-dim mx-auto mb-3" />
                <div className="text-sm text-c-muted">{t('library.emptyTitle')}</div>
                <div className="text-xs text-c-dim mt-1 max-w-xs mx-auto">{t('library.emptyHint')}</div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {displayedScenes.map((scene) => (
                  <button
                    key={scene.id}
                    onClick={() => setSelectedSceneId(selectedSceneId === scene.id ? null : scene.id)}
                    className={clsx(
                      'text-left card p-4 hover:border-[#7c6af5] transition-all',
                      selectedSceneId === scene.id && 'border-[#7c6af5] bg-[#7c6af508]'
                    )}
                  >
                    {/* Asset preview */}
                    <div className="w-full aspect-[9/16] max-h-32 bg-c-bg rounded-lg mb-3 flex items-center justify-center overflow-hidden">
                      {('asset' in scene) && scene.asset && (scene.asset as import('@videocloudai/shared').AssetRecord).type === 'image' ? (
                          <img
                            src={`/assets/${(scene.asset as import('@videocloudai/shared').AssetRecord).filename}`}
                            className="w-full h-full object-cover"
                            alt={scene.title}
                          />
                      ) : ('asset' in scene) && scene.asset ? (
                          <Film className="w-6 h-6 text-c-dim" />
                      ) : (
                        <Image className="w-6 h-6 text-c-dim" />
                      )}
                    </div>

                    <div className="text-sm text-c-text font-medium truncate mb-1">{scene.title}</div>

                    <div className="flex flex-wrap gap-1 mb-2">
                      <Badge mood={scene.mood}>{scene.mood}</Badge>
                      <Badge variant="default">{scene.style?.replace(/-/g, ' ')}</Badge>
                    </div>

                    <div className="flex items-center justify-between text-xs text-c-dim">
                      <span className="flex items-center gap-1">
                        <RefreshCw className="w-2.5 h-2.5" />
                        {scene.usageCount} {t('library.uses')}
                      </span>
                      <span>{scene.duration}s</span>
                    </div>

                    {scene.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {scene.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="flex items-center gap-0.5 text-xs text-c-dim">
                            <Tag className="w-2.5 h-2.5" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedSceneId && (
          <div className="w-64 border-l border-c-border overflow-auto p-4 shrink-0">
            <div className="text-sm font-medium text-c-text mb-4">{t('library.sceneDetails')}</div>
            <div className="space-y-3 text-xs text-c-muted">
              <div>
                <div className="text-c-dim mb-1">{t('library.assets')}</div>
                {selectedAssets?.map((asset) => (
                  <div key={asset.id} className="bg-c-surface rounded-lg p-2 mb-2">
                    <div className="text-c-text truncate">{asset.filename}</div>
                    <div className="text-c-dim mt-0.5">
                      {asset.type} · {(asset.filesize / 1024).toFixed(0)}KB
                    </div>
                  </div>
                ))}
                {!selectedAssets?.length && <div className="text-c-dim">{t('library.noAssets')}</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
