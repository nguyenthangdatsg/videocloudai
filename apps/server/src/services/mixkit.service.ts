import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { resolveImageCacheDir } from './pexels.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MixkitCandidate {
  mixkitId: number;
  thumbnail: string;
  previewUrl: string | null;
  downloadUrl: string;
  duration: number;
  width: number;
  height: number;
  pageURL: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(['a','an','the','in','on','at','of','for','to','and','or','is','are','was','were','with','from','by','as','its','it','be','this','that','these','those','has','have','had','not','but','so','up','do','did','how','what','when','where','who','which','about','into','out','over','under','than','then','now','just','very','also','some','any','all','one','two','three','no','new','old']);

function toSlug(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function fetchMixkitPage(slug: string): Promise<string | null> {
  if (!slug) return null;
  const url = `https://mixkit.co/free-stock-video/discover/${encodeURIComponent(slug)}/`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/**
 * Search Mixkit using their discover URL and extract video items from HTML.
 * Falls back to individual keywords if multi-word query returns no results.
 */
export async function searchMixkitCandidates(
  query: string,
  _orientation: 'landscape' | 'portrait' = 'landscape',
  perPage = 12,
): Promise<MixkitCandidate[]> {
  // Try full slug first
  const fullSlug = toSlug(query);
  if (fullSlug) {
    const html = await fetchMixkitPage(fullSlug);
    if (html) {
      const results = parseHtmlItems(html, perPage);
      if (results.length > 0) return results;
    }
  }

  // Fallback: try individual keywords (longest first, skip stop words)
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .sort((a, b) => b.length - a.length);

  for (const word of words) {
    const html = await fetchMixkitPage(word);
    if (!html) continue;
    const results = parseHtmlItems(html, perPage);
    if (results.length > 0) return results;
  }

  return [];
}

/**
 * Parse Mixkit discover/category page HTML to extract video items.
 * Works with both discover pages (HTML grid) and category pages (JSON-LD).
 */
function parseHtmlItems(html: string, perPage: number): MixkitCandidate[] {
  const candidates: MixkitCandidate[] = [];

  // Strategy 1: Parse HTML video grid items (works on discover pages)
  // Each item has: <video src="...360.mp4">, <a href="/free-stock-video/slug-ID/">, <img> thumbnail
  const itemRe = /data-algolia-analytics-object-id="video-(\d+)"[\s\S]*?<video\s+src="([^"]+)"[\s\S]*?<a\s+href="(\/free-stock-video\/[^"]+\/)"[^>]*>\s*([\s\S]*?)\s*<\/a>/g;

  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(html)) !== null) {
    const [, idStr, previewUrl, pagePath, title] = match;
    const mixkitId = parseInt(idStr);

    // Build download URL: replace 360.mp4 with 720.mp4 for better quality
    const downloadUrl = previewUrl.replace(/-360\.mp4$/, '-720.mp4');

    // Find thumbnail near this item
    const thumbRe = new RegExp(`videos/${idStr}/${idStr}-thumb-360-0\\.jpg`);
    const thumbMatch = html.match(thumbRe);
    const thumbnail = thumbMatch ? `https://assets.mixkit.co/videos/${idStr}/${idStr}-thumb-360-0.jpg` : '';

    candidates.push({
      mixkitId,
      thumbnail,
      previewUrl: previewUrl || null,
      downloadUrl,
      duration: 0,
      width: 1920,
      height: 1080,
      pageURL: `https://mixkit.co${pagePath}`,
      title: title.trim(),
    });

    if (candidates.length >= perPage) break;
  }

  // Strategy 2: Fallback to JSON-LD (works on category pages like /free-stock-video/nature/)
  if (candidates.length === 0) {
    const scriptRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = scriptRe.exec(html)) !== null) {
      let data: any;
      try { data = JSON.parse(scriptMatch[1]); } catch { continue; }

      const nodes: any[] = Array.isArray(data['@graph']) ? data['@graph'] : [data];
      for (const node of nodes) {
        if (node['@type'] !== 'VideoObject') continue;
        const contentUrl: string = node.contentUrl;
        const thumbnail: string = node.thumbnailUrl ?? '';
        const name: string = node.name ?? '';
        const atId: string = node['@id'] ?? '';
        if (!contentUrl) continue;

        const idMatch = atId.match(/-(\d+)\/#video$/);
        const mixkitId = idMatch ? parseInt(idMatch[1]) : 0;
        const pageURL = atId.replace(/#video$/, '');

        candidates.push({
          mixkitId,
          thumbnail,
          previewUrl: node.embedUrl || null,
          downloadUrl: contentUrl,
          duration: 0,
          width: 1920,
          height: 1080,
          pageURL,
          title: name,
        });
        if (candidates.length >= perPage) break;
      }
      if (candidates.length >= perPage) break;
    }
  }

  return candidates;
}

/**
 * Download a Mixkit video from a known URL.
 */
export async function downloadMixkitVideo(
  downloadUrl: string,
  duration = 0,
  width = 0,
  height = 0,
  destDir?: string,
): Promise<{ filename: string; url: string; duration: number; width: number; height: number }> {
  const cacheDir = destDir ?? resolveImageCacheDir();
  const hash = hashUrl(downloadUrl);
  const filename = `mixkit_${hash}.mp4`;
  const destPath = path.join(cacheDir, filename);

  if (!fs.existsSync(destPath)) {
    // Try the requested URL first; if 404 (e.g. 720p not available), fall back to 360p
    let resp = await fetch(downloadUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok && downloadUrl.includes('-720.mp4')) {
      const fallbackUrl = downloadUrl.replace(/-720\.mp4$/, '-360.mp4');
      resp = await fetch(fallbackUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(60000),
      });
    }
    if (!resp.ok) throw new Error(`Failed to download Mixkit video: ${resp.status} ${resp.statusText}`);
    fs.writeFileSync(destPath, Buffer.from(await resp.arrayBuffer()));
  }

  return { filename, url: `/api/image/file/${filename}`, duration, width, height };
}
