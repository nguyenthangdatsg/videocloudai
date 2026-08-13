/**
 * chart-renderer.service.ts
 *
 * Renders animated chart Remotion compositions to MP4 clips.
 * Clips are cached by a SHA-256 hash of (spec + orientation + accentColor).
 *
 * New file — does not modify any existing service.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { ChartSpec } from './script-studio.service';
import type {
  ChartBigNumberConfig,
  ChartLineConfig,
  ChartBarsConfig,
  ChartVsConfig,
} from '../remotion/types';
import { getSettings } from './settings.service';

// ── Bundle cache (shared with remotion-renderer but independently managed here) ──

function getRootTsxPath(): string {
  const fromSrc = path.resolve(__dirname, '../remotion/Root.tsx');
  const fromDist = path.resolve(__dirname, '../../src/remotion/Root.tsx');
  return fs.existsSync(fromSrc) ? fromSrc : fromDist;
}

async function getBundleUrl(): Promise<string> {
  const { bundle } = await import('@remotion/bundler');
  return await bundle({ entryPoint: getRootTsxPath() });
}

// ── Chart render dir ──

function getChartDir(): string {
  const dir = path.resolve(process.env.CACHE_DIR ?? './cache', 'charts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Spec → composition props ──

type ChartCompositionId = 'ChartBigNumber' | 'ChartLine' | 'ChartBars' | 'ChartVs';

interface ChartRenderSpec {
  compositionId: ChartCompositionId;
  props: ChartBigNumberConfig | ChartLineConfig | ChartBarsConfig | ChartVsConfig;
  width: number;
  height: number;
}

function buildRenderSpec(
  spec: ChartSpec,
  orientation: 'landscape' | 'portrait',
  accentColor: string,
  bgColor: string,
  durationSec: number,
  animationDurationSec?: number,
): ChartRenderSpec {
  const durationInFrames = Math.max(Math.round(durationSec * 24), 24);
  const animationFrames = animationDurationSec != null
    ? Math.max(Math.round(animationDurationSec * 24), 12)
    : undefined;
  const isPortrait = orientation === 'portrait';
  const width = isPortrait ? 1080 : 1920;
  const height = isPortrait ? 1920 : 1080;

  const base = { durationInFrames, animationFrames, accentColor, bgColor };

  if (spec.type === 'big-number') {
    const pd = spec.parsedData ?? {};
    return {
      compositionId: 'ChartBigNumber',
      props: {
        ...base,
        value: pd.value ?? 0,
        prefix: pd.prefix,
        suffix: pd.suffix,
        label: spec.title,
        sourceLabel: spec.sourceLabel,
      } as ChartBigNumberConfig,
      width,
      height,
    };
  }

  if (spec.type === 'line') {
    return {
      compositionId: 'ChartLine',
      props: {
        ...base,
        dataPoints: spec.parsedData?.points ?? [],
        title: spec.title,
        sourceLabel: spec.sourceLabel,
      } as ChartLineConfig,
      width,
      height,
    };
  }

  if (spec.type === 'bars') {
    return {
      compositionId: 'ChartBars',
      props: {
        ...base,
        bars: spec.parsedData?.bars ?? [],
        title: spec.title,
        sourceLabel: spec.sourceLabel,
        sortOrder: 'scripted',
      } as ChartBarsConfig,
      width,
      height,
    };
  }

  // vs
  const pd = spec.parsedData ?? {};
  return {
    compositionId: 'ChartVs',
    props: {
      ...base,
      leftLabel: pd.leftLabel ?? 'Left',
      leftValue: pd.leftValue ?? '0',
      rightLabel: pd.rightLabel ?? 'Right',
      rightValue: pd.rightValue ?? '0',
      title: spec.title,
      sourceLabel: spec.sourceLabel,
    } as ChartVsConfig,
    width,
    height,
  };
}

// ── Public API ──

export interface ChartRenderResult {
  filename: string;
  filePath: string;
  durationSec: number;
}

export async function renderChart(
  spec: ChartSpec,
  orientation: 'landscape' | 'portrait' = 'landscape',
  accentColor = '#7c6af5',
  bgColor = '#0d0e12',
  durationSec = 6,
  onLog?: (msg: string) => void,
  animationDurationSec?: number,
): Promise<ChartRenderResult> {
  const log = onLog ?? ((m: string) => console.log(`[chart-renderer] ${m}`));

  const hashInput = JSON.stringify({ spec, orientation, accentColor, bgColor, durationSec, animationDurationSec, t: Date.now() });
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
  const filename = `chart_${hash}.mp4`;
  const filePath = path.join(getChartDir(), filename);

  const animStr = animationDurationSec != null ? ` anim=${animationDurationSec.toFixed(1)}s` : '';
  log(`Rendering chart: type=${spec.type} orientation=${orientation} duration=${durationSec}s${animStr}`);
  const t0 = Date.now();

  const renderSpec = buildRenderSpec(spec, orientation, accentColor, bgColor, durationSec, animationDurationSec);
  const { renderMedia, getCompositions } = await import('@remotion/renderer');
  const s = getSettings();
  const browserExecutable = s.get('chrome_executable_path') || undefined;
  const chromiumOptions = { disableWebSecurity: true, gl: 'angle' as const };

  const serveUrl = await getBundleUrl();
  const inputProps = renderSpec.props as unknown as Record<string, unknown>;

  const compositions = await getCompositions(serveUrl, { inputProps, browserExecutable, chromiumOptions });
  const composition = compositions.find((c) => c.id === renderSpec.compositionId);
  if (!composition) throw new Error(`Chart composition "${renderSpec.compositionId}" not found in bundle`);

  await renderMedia({
    composition: {
      ...composition,
      durationInFrames: renderSpec.props.durationInFrames,
      width: renderSpec.width,
      height: renderSpec.height,
    },
    serveUrl,
    codec: 'h264',
    outputLocation: filePath,
    inputProps,
    browserExecutable,
    chromiumOptions,
    muted: true,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`Chart rendered in ${elapsed}s → ${filename}`);

  return { filename, filePath, durationSec };
}

export function invalidateChartBundle(): void {
  // no-op: bundle caching disabled
}
