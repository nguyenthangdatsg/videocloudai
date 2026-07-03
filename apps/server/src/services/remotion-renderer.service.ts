import * as path from 'path';
import * as fs from 'fs';
import type { IntroConfig, OutroConfig, SceneClipConfig } from '../remotion/types';
import { getSettings } from './settings.service';

let cachedBundleUrl: string | null = null;

function getRootTsxPath(): string {
  // Works for both ts-node-dev (src/) and compiled (dist/) runtime
  const fromSrc = path.resolve(__dirname, '../remotion/Root.tsx');
  const fromDist = path.resolve(__dirname, '../../src/remotion/Root.tsx');
  return fs.existsSync(fromSrc) ? fromSrc : fromDist;
}

async function getBundleUrl(): Promise<string> {
  if (cachedBundleUrl) return cachedBundleUrl;
  const { bundle } = await import('@remotion/bundler');
  const entryPoint = getRootTsxPath();
  cachedBundleUrl = await bundle({ entryPoint });
  return cachedBundleUrl;
}

export function invalidateBundle(): void {
  cachedBundleUrl = null;
}

const MAX_RENDER_RETRIES = 2;

async function renderComposition(
  compositionId: 'Intro' | 'Outro' | 'SceneClip',
  outputPath: string,
  props: IntroConfig | OutroConfig | SceneClipConfig,
  overrides?: { width?: number; height?: number },
): Promise<void> {
  const { renderMedia, getCompositions } = await import('@remotion/renderer');
  const s = getSettings();
  const browserExecutable = s.get('chrome_executable_path') || undefined;

  const serveUrl = await getBundleUrl();
  const inputProps = props as unknown as Record<string, unknown>;

  const chromiumOptions = {
    disableWebSecurity: true,
    gl: 'angle' as const,
  };

  const compositions = await getCompositions(serveUrl, {
    inputProps,
    browserExecutable,
    chromiumOptions,
  });

  const composition = compositions.find((c) => c.id === compositionId);
  if (!composition) throw new Error(`Composition "${compositionId}" not found in bundle`);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RENDER_RETRIES; attempt++) {
    try {
      await renderMedia({
        composition: {
          ...composition,
          durationInFrames: props.durationInFrames,
          ...(overrides?.width ? { width: overrides.width } : {}),
          ...(overrides?.height ? { height: overrides.height } : {}),
        },
        serveUrl,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps,
        browserExecutable,
        chromiumOptions,
        muted: true,
      });
      return;
    } catch (err: any) {
      lastError = err;
      const isTargetClosed = err?.message?.includes('Target closed');
      if (!isTargetClosed || attempt === MAX_RENDER_RETRIES) throw err;
      console.warn(`[remotion] Target closed on attempt ${attempt + 1}, retrying...`);
    }
  }
  throw lastError;
}

export async function renderIntroClip(outputPath: string, config: IntroConfig): Promise<void> {
  await renderComposition('Intro', outputPath, config);
}

export async function renderOutroClip(outputPath: string, config: OutroConfig): Promise<void> {
  await renderComposition('Outro', outputPath, config);
}

export async function renderSceneClip(
  outputPath: string,
  config: SceneClipConfig,
  width: number,
  height: number,
): Promise<void> {
  await renderComposition('SceneClip', outputPath, config, { width, height });
}
