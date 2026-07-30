import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { resolveImageCacheDir } from './pexels.service';

// ---------------------------------------------------------------------------
// Pixabay API types
// ---------------------------------------------------------------------------

interface PixabayVideoHit {
  id: number;
  pageURL: string;
  duration: number;
  picture_id: string;
  videos: {
    large: PixabayVideoFile;
    medium: PixabayVideoFile;
    small: PixabayVideoFile;
    tiny: PixabayVideoFile;
  };
}

interface PixabayVideoFile {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail: string;
}

interface PixabaySearchResponse {
  total: number;
  totalHits: number;
  hits: PixabayVideoHit[];
}

export interface PixabayResult {
  filename: string;
  url: string;       // local serving URL: /api/image/file/<filename>
  pageURL: string;   // original Pixabay page URL
  duration: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new Error('PIXABAY_API_KEY environment variable is not set');
  return key;
}

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/** Pick best video file from a Pixabay hit. Prefers large, then medium. */
function pickBestFile(hit: PixabayVideoHit): { url: string; width: number; height: number } | null {
  const files = [hit.videos.large, hit.videos.medium, hit.videos.small, hit.videos.tiny];
  for (const f of files) {
    if (f?.url) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Search Pixabay for videos (no download).
 */
export async function searchPixabayVideos(
  query: string,
  opts?: {
    orientation?: 'landscape' | 'portrait';
    perPage?: number;
  },
): Promise<PixabayVideoHit[]> {
  const apiKey = getApiKey();
  const perPage = opts?.perPage ?? 5;
  const orientation = opts?.orientation === 'portrait' ? 'vertical' : 'horizontal';

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    video_type: 'film',
    orientation,
    per_page: String(perPage),
    safesearch: 'true',
  });

  const res = await fetch(`https://pixabay.com/api/videos/?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pixabay API error ${res.status}: ${body}`);
  }

  const text = await res.text();
  // Detect Cloudflare challenge page (returns HTML instead of JSON)
  if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
    throw new Error('Pixabay API blocked by Cloudflare challenge');
  }

  const data = JSON.parse(text) as PixabaySearchResponse;
  return data.hits ?? [];
}

export interface PixabayCandidate {
  pixabayId: number;
  thumbnail: string;
  previewUrl: string | null;
  downloadUrl: string;
  duration: number;
  width: number;
  height: number;
  pageURL: string;
}

/**
 * Search Pixabay and return candidate metadata for the picker UI (no download).
 */
export async function searchPixabayCandidates(
  query: string,
  orientation: 'landscape' | 'portrait',
  perPage = 10,
): Promise<PixabayCandidate[]> {
  try {
    const hits = await searchPixabayVideos(query, { orientation, perPage });
    return hits
      .map((hit): PixabayCandidate | null => {
        const best = hit.videos.large?.url ? hit.videos.large : hit.videos.medium;
        const preview = hit.videos.small?.url ? hit.videos.small : hit.videos.tiny;
        const thumb =
          hit.videos.small?.thumbnail ||
          hit.videos.medium?.thumbnail ||
          hit.videos.large?.thumbnail ||
          '';
        if (!best?.url) return null;
        return {
          pixabayId: hit.id,
          thumbnail: thumb,
          previewUrl: preview?.url ?? null,
          downloadUrl: best.url,
          duration: hit.duration,
          width: best.width,
          height: best.height,
          pageURL: hit.pageURL,
        };
      })
      .filter((c): c is PixabayCandidate => c !== null);
  } catch (err) {
    console.warn('[pixabay] Search failed:', (err as Error).message);
    throw err;
  }
}

/**
 * Download a specific Pixabay video from a known URL and apply it to a block.
 */
export async function downloadPixabayVideoFromUrl(
  downloadUrl: string,
  duration = 0,
  width = 0,
  height = 0,
  destDir?: string,
): Promise<PixabayResult> {
  const cacheDir = destDir ?? resolveImageCacheDir();
  const hash = hashUrl(downloadUrl);
  const filename = `pixabay_${hash}.mp4`;
  const destPath = path.join(cacheDir, filename);

  if (!fs.existsSync(destPath)) {
    const resp = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`Failed to download Pixabay video: ${resp.status}`);
    fs.writeFileSync(destPath, Buffer.from(await resp.arrayBuffer()));
  }

  return { filename, url: `/api/image/file/${filename}`, pageURL: '', duration, width, height };
}

/**
 * Search Pixabay, download the best clip, return cached file info.
 * Returns null if no results found.
 */
export async function searchAndDownloadPixabayVideo(
  query: string,
  opts?: { orientation?: 'landscape' | 'portrait'; destDir?: string },
): Promise<PixabayResult | null> {
  const cacheDir = opts?.destDir ?? resolveImageCacheDir();
  const hits = await searchPixabayVideos(query, opts);
  if (hits.length === 0) return null;

  const hit = hits[0];
  const best = pickBestFile(hit);
  if (!best?.url) return null;

  const hash = hashUrl(best.url);
  const filename = `pixabay_${hash}.mp4`;
  const destPath = path.join(cacheDir, filename);

  if (!fs.existsSync(destPath)) {
    const resp = await fetch(best.url);
    if (!resp.ok) throw new Error(`Failed to download Pixabay video: ${resp.status}`);
    fs.writeFileSync(destPath, Buffer.from(await resp.arrayBuffer()));
  }

  return {
    filename,
    url: `/api/image/file/${filename}`,
    pageURL: hit.pageURL,
    duration: hit.duration,
    width: best.width,
    height: best.height,
  };
}
