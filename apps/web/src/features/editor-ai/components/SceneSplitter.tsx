import { useState } from 'react';
import { clsx } from 'clsx';
import { Scissors, Zap, Film, Clock, Layers } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { videosApi } from '../../../lib/api';
import type { SceneLine, SceneMood, VideoProject } from '@videocloudai/shared';

interface Props {
  project: VideoProject;
}

interface Preset {
  id: string;
  labelKey: string;
  descKey: string;
  segmentDuration: number;
  icon: typeof Zap;
  color: string;
}

const PRESETS: Preset[] = [
  { id: 'rapid',  labelKey: 'editor.splitter.rapid',     descKey: 'editor.splitter.rapidDesc',     segmentDuration: 2, icon: Zap,   color: 'red' },
  { id: 'fast',   labelKey: 'editor.splitter.fast',      descKey: 'editor.splitter.fastDesc',      segmentDuration: 3, icon: Zap,   color: 'orange' },
  { id: 'normal', labelKey: 'editor.splitter.standard',  descKey: 'editor.splitter.standardDesc',  segmentDuration: 5, icon: Film,  color: 'blue' },
  { id: 'slow',   labelKey: 'editor.splitter.cinematic', descKey: 'editor.splitter.cinematicDesc', segmentDuration: 8, icon: Clock, color: 'purple' },
];

const MOOD_ROTATION: SceneMood[] = ['dramatic', 'calm', 'energetic', 'hopeful', 'mysterious', 'uplifting'];

const COLOR_RING: Record<string, string> = {
  red:    'border-red-700/40 hover:border-red-500 hover:bg-red-900/20',
  orange: 'border-orange-700/40 hover:border-orange-500 hover:bg-orange-900/20',
  blue:   'border-blue-700/40 hover:border-blue-500 hover:bg-blue-900/20',
  purple: 'border-purple-700/40 hover:border-purple-500 hover:bg-purple-900/20',
};

function buildScenesByDuration(
  totalDuration: number,
  segmentDuration: number,
  labelFn: (i: number, total: number) => { line: string; visual: string }
): SceneLine[] {
  const count = Math.max(1, Math.floor(totalDuration / segmentDuration));
  const remainder = totalDuration - count * segmentDuration;
  const scenes: SceneLine[] = [];
  for (let i = 0; i < count; i++) {
    const dur = i === count - 1 ? segmentDuration + remainder : segmentDuration;
    const { line, visual } = labelFn(i, count);
    scenes.push({
      line,
      visual,
      mood: MOOD_ROTATION[i % MOOD_ROTATION.length],
      duration: Math.round(dur * 10) / 10,
    });
  }
  return scenes;
}

function buildScenesByCount(
  totalDuration: number,
  count: number,
  labelFn: (i: number, total: number) => { line: string; visual: string }
): SceneLine[] {
  const segDuration = totalDuration / count;
  const scenes: SceneLine[] = [];
  for (let i = 0; i < count; i++) {
    const { line, visual } = labelFn(i, count);
    scenes.push({
      line,
      visual,
      mood: MOOD_ROTATION[i % MOOD_ROTATION.length],
      duration: Math.round(segDuration * 10) / 10,
    });
  }
  return scenes;
}

export function SceneSplitter({ project }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [customSegment, setCustomSegment] = useState('');
  const [customCount, setCustomCount] = useState('');

  const mutation = useMutation({
    mutationFn: (scenes: SceneLine[]) => videosApi.updateScenes(project.id, scenes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['video', project.id] }),
  });

  const totalDuration = project.duration ?? 30;

  const labelFn = (i: number, total: number) => ({
    line: t('editor.splitter.segmentLine', { index: i + 1 }),
    visual: t('editor.splitter.segmentVisual', { index: i + 1, total }),
  });

  function splitByDuration(segDur: number) {
    if (segDur <= 0) return;
    mutation.mutate(buildScenesByDuration(totalDuration, segDur, labelFn));
  }

  function splitByCount(count: number) {
    if (count <= 0 || count > 50) return;
    mutation.mutate(buildScenesByCount(totalDuration, count, labelFn));
  }

  return (
    <div className="mx-4 my-4 p-5 bg-c-surface border border-c-border rounded-xl">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center shrink-0">
          <Scissors className="w-4 h-4 text-accent-hover" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-c-text">{t('editor.splitter.title')}</h3>
          <p className="text-xs text-c-dim mt-0.5">
            {t('editor.splitter.description', { duration: totalDuration })}
          </p>
        </div>
      </div>

      {/* Time-based presets */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const sceneCount = Math.max(1, Math.floor(totalDuration / p.segmentDuration));
          return (
            <button
              key={p.id}
              onClick={() => splitByDuration(p.segmentDuration)}
              disabled={mutation.isPending}
              className={clsx(
                'flex items-start gap-2.5 px-3 py-2.5 rounded-lg border bg-c-bg text-left transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                COLOR_RING[p.color]
              )}
            >
              <Icon className="w-3.5 h-3.5 text-c-muted mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-c-text">{t(p.labelKey)}</div>
                <div className="text-[11px] text-c-dim mt-0.5 leading-tight">{t(p.descKey)}</div>
                <div className="text-[10px] text-c-dim mt-1 font-mono">
                  {t('editor.splitter.approxScenes', { count: sceneCount })}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom controls */}
      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-c-border">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-c-dim" />
          <span className="text-xs text-c-muted">{t('editor.splitter.customSeconds')}</span>
          <input
            type="number"
            min={1}
            step={0.5}
            value={customSegment}
            onChange={(e) => setCustomSegment(e.target.value)}
            placeholder="4"
            className="w-16 px-2 py-1 text-xs bg-c-bg border border-c-border rounded text-c-text focus:border-accent-primary focus:outline-none"
          />
          <button
            onClick={() => {
              const v = parseFloat(customSegment);
              if (!isNaN(v) && v > 0) splitByDuration(v);
            }}
            disabled={!customSegment || mutation.isPending}
            className="px-2 py-1 rounded text-xs bg-accent-primary hover:bg-accent-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('editor.splitter.split')}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-c-dim" />
          <span className="text-xs text-c-muted">{t('editor.splitter.orScenes')}</span>
          <input
            type="number"
            min={1}
            max={50}
            step={1}
            value={customCount}
            onChange={(e) => setCustomCount(e.target.value)}
            placeholder="6"
            className="w-16 px-2 py-1 text-xs bg-c-bg border border-c-border rounded text-c-text focus:border-accent-primary focus:outline-none"
          />
          <button
            onClick={() => {
              const v = parseInt(customCount, 10);
              if (!isNaN(v) && v > 0) splitByCount(v);
            }}
            disabled={!customCount || mutation.isPending}
            className="px-2 py-1 rounded text-xs bg-c-elevated hover:bg-c-border text-c-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('editor.splitter.splitEqually')}
          </button>
        </div>

        {mutation.isPending && (
          <span className="text-xs text-c-dim ml-auto">{t('editor.splitter.saving')}</span>
        )}
        {mutation.isError && (
          <span className="text-xs text-red-400 ml-auto">
            {t('editor.splitter.failed', { error: (mutation.error as Error).message })}
          </span>
        )}
      </div>
    </div>
  );
}
