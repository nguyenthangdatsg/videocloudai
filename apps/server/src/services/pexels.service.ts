import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Cache directory resolution (reusable)
// ---------------------------------------------------------------------------

/** Resolve the shared image cache directory (cache/images) */
export function resolveImageCacheDir(): string {
  const dir = path.resolve(process.env.CACHE_DIR ?? './cache', 'images');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Pexels API types
// ---------------------------------------------------------------------------

interface PexelsVideoFile {
  id: number;
  quality: string;   // "hd" | "sd" | "uhd"
  file_type: string;  // "video/mp4"
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  url: string;        // Pexels page URL
  duration: number;   // seconds
  width: number;
  height: number;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  page: number;
  per_page: number;
  total_results: number;
  videos: PexelsVideo[];
}

export interface PexelsResult {
  filename: string;
  url: string;         // local serving URL: /api/image/file/<filename>
  pexelsUrl: string;   // original Pexels page URL
  duration: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error('PEXELS_API_KEY environment variable is not set');
  return key;
}

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Pick the best video file from a Pexels video result.
 * Prefers HD quality, landscape, width closest to 1920.
 */
function pickBestFile(video: PexelsVideo): PexelsVideoFile | null {
  const mp4Files = video.video_files.filter(f => f.file_type === 'video/mp4');
  if (mp4Files.length === 0) return null;

  // Sort: prefer HD, then by closeness to 1920 width
  const sorted = [...mp4Files].sort((a, b) => {
    // Prefer HD quality
    const qualityOrder: Record<string, number> = { hd: 0, uhd: 1, sd: 2 };
    const qa = qualityOrder[a.quality] ?? 3;
    const qb = qualityOrder[b.quality] ?? 3;
    if (qa !== qb) return qa - qb;

    // Then prefer closest to 1920 width
    const diffA = Math.abs(a.width - 1920);
    const diffB = Math.abs(b.width - 1920);
    return diffA - diffB;
  });

  return sorted[0];
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Search Pexels for videos and return raw results (no download).
 */
export async function searchPexelsVideos(
  query: string,
  opts?: {
    orientation?: 'landscape' | 'portrait' | 'square';
    minDuration?: number;
    maxDuration?: number;
    perPage?: number;
  },
): Promise<PexelsVideo[]> {
  const apiKey = getApiKey();
  const orientation = opts?.orientation ?? 'landscape';
  const perPage = opts?.perPage ?? 5;

  const params = new URLSearchParams({
    query,
    per_page: String(perPage),
    orientation,
  });

  const res = await fetch(`https://api.pexels.com/videos/search?${params}`, {
    headers: { Authorization: apiKey },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pexels API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as PexelsSearchResponse;
  let videos = data.videos ?? [];

  // Filter by duration if requested
  if (opts?.minDuration) {
    videos = videos.filter(v => v.duration >= opts.minDuration!);
  }
  if (opts?.maxDuration) {
    videos = videos.filter(v => v.duration <= opts.maxDuration!);
  }

  return videos;
}

/**
 * Download a Pexels video file to the cache directory.
 * Returns the local filename and serving URL, or null if already cached.
 */
async function downloadVideoFile(
  fileUrl: string,
  cacheDir: string,
): Promise<string> {
  const hash = hashUrl(fileUrl);
  const filename = `pexels_${hash}.mp4`;
  const destPath = path.join(cacheDir, filename);

  // Cache hit
  if (fs.existsSync(destPath)) {
    return filename;
  }

  // Download
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to download Pexels video: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(destPath, buffer);

  return filename;
}

/**
 * Search Pexels for a video matching the query, download the best clip,
 * and return cached file info. Returns null if no results found.
 */
export async function searchAndDownloadPexelsVideo(
  query: string,
  opts?: {
    orientation?: 'landscape' | 'portrait' | 'square';
    minDuration?: number;
    maxDuration?: number;
  },
): Promise<PexelsResult | null> {
  const cacheDir = resolveImageCacheDir();
  const videos = await searchPexelsVideos(query, opts);

  if (videos.length === 0) return null;

  // Pick first result, find best file
  const video = videos[0];
  const bestFile = pickBestFile(video);
  if (!bestFile) return null;

  const filename = await downloadVideoFile(bestFile.link, cacheDir);

  return {
    filename,
    url: `/api/image/file/${filename}`,
    pexelsUrl: video.url,
    duration: video.duration,
    width: bestFile.width,
    height: bestFile.height,
  };
}

/**
 * Search and download multiple videos for a batch of queries.
 * Yields progress events for NDJSON streaming.
 */
export async function searchAndDownloadBatch(
  queries: Array<{ timestamp: string; query: string; side?: string }>,
  onProgress?: (msg: Record<string, unknown>) => void,
): Promise<Array<{ timestamp: string; filename: string; url: string; query: string; side?: string }>> {
  const cacheDir = resolveImageCacheDir();
  const results: Array<{ timestamp: string; filename: string; url: string; query: string; side?: string }> = [];
  const searchCache = new Map<string, PexelsVideo[]>();

  for (let i = 0; i < queries.length; i++) {
    const { timestamp, query, side } = queries[i];
    onProgress?.({
      progress: true,
      step: 'searching',
      detail: `(${i + 1}/${queries.length}) ${query}`,
    });

    try {
      let videos: PexelsVideo[] = [];
      let matchedQuery = query;

      // 1. Generate query candidates in order of specificity
      const candidates: string[] = [query];

      // Remove punctuation and extra spaces for clean sentences
      const sentences = query
        .split(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/)
        .map(s => s.trim())
        .filter(s => s.length > 3);

      if (sentences.length > 1) {
        // Try longest sentence
        const sortedSentences = [...sentences].sort((a, b) => b.length - a.length);
        candidates.push(sortedSentences[0]);
        // Try first sentence
        candidates.push(sentences[0]);
      }

      // Stop words helper
      const stopWords = new Set([
        'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
        'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'about', 'against',
        'between', 'into', 'through', 'during', 'before', 'after', 'above',
        'below', 'from', 'up', 'down', 'out', 'off', 'over', 'under',
        'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
        'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
        'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
        'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don',
        'should', 'now', 'we', 'our', 'us', 'you', 'they', 'them', 'he', 'she', 'it'
      ]);

      const cleanWords = query
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

      if (cleanWords.length > 0) {
        candidates.push(cleanWords.slice(0, 3).join(' '));
        candidates.push(cleanWords.slice(0, 2).join(' '));
        candidates.push(cleanWords[0]);
      }

      // Add clean individual sentences and their first few keywords
      for (const s of sentences) {
        candidates.push(s);
        const sWords = s.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));
        if (sWords.length > 1) {
          candidates.push(sWords.slice(0, 3).join(' '));
          candidates.push(sWords.slice(0, 2).join(' '));
        }
      }

      // Unique candidate list while keeping insertion order
      const uniqueCandidates = Array.from(new Set(candidates)).filter(c => c && c.trim().length > 0);

      // Try searching Pexels with candidates in order
      for (const cand of uniqueCandidates) {
        try {
          let res = searchCache.get(cand);
          if (!res) {
            res = await searchPexelsVideos(cand, { orientation: 'landscape', perPage: 3 });
            searchCache.set(cand, res);
          }
          if (res && res.length > 0) {
            videos = res;
            matchedQuery = cand;
            break;
          }
        } catch (e) {
          // Ignore error and try next candidate
        }
      }

      if (videos.length === 0) {
        onProgress?.({
          progress: true,
          step: 'warning',
          detail: `(${i + 1}/${queries.length}) No results for: ${query}`,
        });
        continue;
      }

      // Log if fallback was used
      if (matchedQuery !== query) {
        onProgress?.({
          progress: true,
          step: 'info',
          detail: `(${i + 1}/${queries.length}) Matched via: "${matchedQuery}"`,
        });
      }

      const video = videos[0];
      const bestFile = pickBestFile(video);
      if (!bestFile) continue;

      onProgress?.({
        progress: true,
        step: 'downloading',
        detail: `(${i + 1}/${queries.length}) Downloading clip...`,
      });

      const filename = await downloadVideoFile(bestFile.link, cacheDir);

      results.push({
        timestamp,
        filename,
        url: `/api/image/file/${filename}`,
        query: matchedQuery,
        ...(side ? { side } : {}),
      });
    } catch (err: any) {
      onProgress?.({
        progress: true,
        step: 'error',
        detail: `(${i + 1}/${queries.length}) Failed: ${err.message}`,
      });
    }
  }

  return results;
}
