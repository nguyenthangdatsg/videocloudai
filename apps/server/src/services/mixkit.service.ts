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

/** Extract numeric ID from Mixkit @id URL like "https://mixkit.co/free-stock-video/slug-1234/#video" */
function extractIdFromAtId(atId: string): number {
  const m = atId.match(/-(\d+)\/#video$/);
  return m ? parseInt(m[1]) : 0;
}

/** Extract page URL from @id (strip #video fragment) */
function pageUrlFromAtId(atId: string): string {
  return atId.replace(/#video$/, '');
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
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/**
 * Search Mixkit using their discover URL and extract VideoObject items from JSON-LD.
 * Falls back to individual keywords if multi-word query returns no results.
 * Note: Mixkit JSON-LD does not include video dimensions, so orientation filtering
 * is skipped (all results returned regardless of orientation setting).
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
      const results = parseJsonLd(html, perPage);
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
    const results = parseJsonLd(html, perPage);
    if (results.length > 0) return results;
  }

  return [];
}

function parseJsonLd(html: string, perPage: number): MixkitCandidate[] {
  // Extract all <script type="application/ld+json"> blocks
  const scriptRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  const candidates: MixkitCandidate[] = [];

  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    let data: any;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }

    // Flatten graph if present
    const nodes: any[] = Array.isArray(data['@graph']) ? data['@graph'] : [data];

    for (const node of nodes) {
      if (node['@type'] !== 'VideoObject') continue;
      const contentUrl: string = node.contentUrl;
      const embedUrl: string = node.embedUrl;
      const thumbnail: string = node.thumbnailUrl ?? '';
      const name: string = node.name ?? '';
      const atId: string = node['@id'] ?? '';
      if (!contentUrl) continue;

      candidates.push({
        mixkitId: extractIdFromAtId(atId),
        thumbnail,
        previewUrl: embedUrl || null,
        downloadUrl: contentUrl,
        duration: 0, // not in JSON-LD
        width: 1920,  // assumed landscape; JSON-LD has no dimension data
        height: 1080,
        pageURL: pageUrlFromAtId(atId),
        title: name,
      });

      if (candidates.length >= perPage) break;
    }

    if (candidates.length >= perPage) break;
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
): Promise<{ filename: string; url: string; duration: number }> {
  const cacheDir = destDir ?? resolveImageCacheDir();
  const hash = hashUrl(downloadUrl);
  const filename = `mixkit_${hash}.mp4`;
  const destPath = path.join(cacheDir, filename);

  if (!fs.existsSync(destPath)) {
    const resp = await fetch(downloadUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) throw new Error(`Failed to download Mixkit video: ${resp.status} ${resp.statusText}`);
    fs.writeFileSync(destPath, Buffer.from(await resp.arrayBuffer()));
  }

  return { filename, url: `/api/image/file/${filename}`, duration };
}
