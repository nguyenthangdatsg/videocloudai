import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { dbGet, dbAll, dbRun } from '../db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DvidsSearchResult {
  id: string;
  title: string;
  short_description: string;
  date_published: string;
  branch: string;
  unit_name: string;
  category: string;
  duration: number;
  aspect_ratio: string;
  thumbnail: string;
  url: string;
  keywords: string[];
  credit: string;
  width: number;
  height: number;
}

export interface DvidsVideoFile {
  src: string;
  type: string;
  height: number;
  width: number;
  size: number;
  bitrate: string;
}

export interface DvidsAsset {
  id: string;
  title: string;
  description: string;
  short_description: string;
  date: string;
  date_published: string;
  branch: string;
  unit_name: string;
  category: string;
  keywords: string[];
  virin: string;
  credit: Array<{ id: number; name: string; rank: string; url: string }>;
  duration: number;
  aspect_ratio: string;
  thumbnail: string;
  url: string;
  files: DvidsVideoFile[];
  hls_url?: string;
  width: number;
  height: number;
}

export interface DvidsImportedAsset {
  id: number;
  dvids_id: string;
  title: string;
  description: string | null;
  short_description: string | null;
  virin: string | null;
  branch: string | null;
  unit_name: string | null;
  credit: Array<{ name: string; rank: string }>;
  category: string | null;
  keywords: string[];
  tags: string[];
  date_published: string | null;
  duration: number | null;
  aspect_ratio: string | null;
  thumbnail_url: string | null;
  local_filename: string | null;
  local_path: string | null;
  width: number | null;
  height: number | null;
  file_size: number | null;
  dvids_url: string | null;
  is_favorite: boolean;
  collection: string | null;
  imported_at: string;
}

interface DvidsSearchOpts {
  branch?: string;
  category?: string;
  aspectRatio?: string;
  fromDate?: string;
  toDate?: string;
  hd?: boolean;
  fromDuration?: number;
  toDuration?: number;
  sort?: string;
  sortDir?: string;
  page?: number;
  maxResults?: number;
}

export interface DvidsProgressEvent {
  progress?: boolean;
  step?: string;
  detail?: string;
  error?: string;
  done?: boolean;
  videos?: Array<{ timestamp: string; filename: string; url: string; query: string; dvidsId: string; side?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.dvidshub.net';

function getApiKey(): string | undefined {
  try {
    const row = dbGet<{ value: string }>(`SELECT value FROM settings WHERE key = 'dvids_api_key'`);
    return row?.value || undefined;
  } catch {
    return process.env.DVIDS_API_KEY || undefined;
  }
}

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

export function resolveDvidsCacheDir(): string {
  const dir = path.resolve(process.env.CACHE_DIR ?? './cache', 'dvids');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pickBestFile(files: DvidsVideoFile[]): DvidsVideoFile | null {
  if (!files || files.length === 0) return null;
  const sorted = [...files].sort((a, b) => {
    const a1080 = a.width >= 1920 ? 0 : 1;
    const b1080 = b.width >= 1920 ? 0 : 1;
    if (a1080 !== b1080) return a1080 - b1080;
    return b.width - a.width;
  });
  return sorted[0];
}

function toApiRow(row: any): DvidsImportedAsset {
  return {
    ...row,
    credit: JSON.parse(row.credit || '[]'),
    keywords: JSON.parse(row.keywords || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    is_favorite: !!row.is_favorite,
  };
}

// ---------------------------------------------------------------------------
// Stop-words for query fallback
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','it','this','that','are','was','were','be','been',
  'being','have','has','had','do','does','did','will','would','could',
  'should','may','might','shall','can','need','must','about','above',
  'after','before','between','into','through','during','over','under',
  'again','further','then','once','here','there','when','where','why',
  'how','all','each','every','both','few','more','most','other','some',
  'such','no','not','only','own','same','so','than','too','very',
  'just','because','as','until','while','also','back','even','still',
]);

// ---------------------------------------------------------------------------
// Core API Methods
// ---------------------------------------------------------------------------

export async function searchDvids(query: string, opts: DvidsSearchOpts = {}): Promise<{
  results: DvidsSearchResult[];
  pageInfo: { total: number; perPage: number; page: number };
}> {
  const params = new URLSearchParams();
  const apiKey = getApiKey();
  if (apiKey) params.set('api_key', apiKey);
  params.set('q', query);
  params.set('type', 'video');
  params.set('max_results', String(opts.maxResults ?? 24));
  params.set('page', String(opts.page ?? 1));
  if (opts.branch) params.set('branch', opts.branch);
  if (opts.category) params.set('category', opts.category);
  if (opts.aspectRatio) params.set('aspect_ratio', opts.aspectRatio);
  if (opts.fromDate) params.set('from_date', opts.fromDate);
  if (opts.toDate) params.set('to_date', opts.toDate);
  if (opts.hd) params.set('hd', '1');
  if (opts.fromDuration) params.set('from_duration', String(opts.fromDuration));
  if (opts.toDuration) params.set('to_duration', String(opts.toDuration));
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.sortDir) params.set('sortdir', opts.sortDir);
  params.set('fields', 'id,title,short_description,date_published,branch,unit_name,category,duration,aspect_ratio,thumbnail,url,keywords,credit,width,height');

  const res = await fetch(`${API_BASE}/search?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DVIDS search failed (${res.status}): ${text}`);
  }
  const data = await res.json();

  const results: DvidsSearchResult[] = (data.results || []).map((r: any) => ({
    id: r.id,
    title: r.title || '',
    short_description: r.short_description || '',
    date_published: r.date_published || '',
    branch: r.branch || '',
    unit_name: r.unit_name || '',
    category: r.category || '',
    duration: r.duration || 0,
    aspect_ratio: r.aspect_ratio || '',
    thumbnail: r.thumbnail || '',
    url: r.url || '',
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    credit: typeof r.credit === 'string' ? r.credit : (r.credit?.[0]?.name || ''),
    width: r.width || 0,
    height: r.height || 0,
  }));

  return {
    results,
    pageInfo: {
      total: data.page_info?.total_results ?? 0,
      perPage: data.page_info?.results_per_page ?? opts.maxResults ?? 24,
      page: opts.page ?? 1,
    },
  };
}

export async function getAssetDetails(dvidsId: string): Promise<DvidsAsset> {
  const params = new URLSearchParams();
  const apiKey = getApiKey();
  if (apiKey) params.set('api_key', apiKey);
  params.set('id', dvidsId);

  const res = await fetch(`${API_BASE}/asset?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DVIDS asset fetch failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return {
    id: data.id,
    title: data.title || '',
    description: data.description || '',
    short_description: data.short_description || '',
    date: data.date || '',
    date_published: data.date_published || '',
    branch: data.branch || '',
    unit_name: data.unit_name || '',
    category: data.category || '',
    keywords: Array.isArray(data.keywords) ? data.keywords : [],
    virin: data.virin || '',
    credit: Array.isArray(data.credit) ? data.credit : [],
    duration: data.duration || 0,
    aspect_ratio: data.aspect_ratio || '',
    thumbnail: data.thumbnail || '',
    url: data.url || '',
    files: Array.isArray(data.files) ? data.files : [],
    hls_url: data.hls_url,
    width: data.width || 0,
    height: data.height || 0,
  };
}

export async function downloadDvidsVideo(
  dvidsId: string,
  destDir?: string,
): Promise<{
  filename: string;
  localPath: string;
  duration: number;
  width: number;
  height: number;
  fileSize: number;
  metadata: DvidsAsset;
}> {
  const asset = await getAssetDetails(dvidsId);
  const bestFile = pickBestFile(asset.files);
  if (!bestFile) throw new Error(`No downloadable MP4 for DVIDS asset ${dvidsId}`);

  const dir = destDir ?? resolveDvidsCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const hash = hashUrl(bestFile.src);
  const filename = `dvids_${hash}.mp4`;
  const localPath = path.join(dir, filename);

  if (!fs.existsSync(localPath)) {
    const resp = await fetch(bestFile.src);
    if (!resp.ok) throw new Error(`DVIDS download failed (${resp.status})`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(localPath, buffer);
  }

  const stat = fs.statSync(localPath);

  return {
    filename,
    localPath,
    duration: asset.duration,
    width: bestFile.width,
    height: bestFile.height,
    fileSize: stat.size,
    metadata: asset,
  };
}

export async function importDvidsAsset(dvidsId: string, destDir?: string): Promise<DvidsImportedAsset> {
  const existing = dbGet<any>(`SELECT * FROM dvids_assets WHERE dvids_id = ?`, [dvidsId]);
  if (existing) return toApiRow(existing);

  const { filename, localPath, duration, width, height, fileSize, metadata } = await downloadDvidsVideo(dvidsId, destDir);

  const creditJson = JSON.stringify(metadata.credit.map(c => ({ name: c.name, rank: c.rank })));
  const keywordsJson = JSON.stringify(metadata.keywords);

  dbRun(
    `INSERT INTO dvids_assets (dvids_id, title, description, short_description, virin, branch, unit_name, credit, category, keywords, date_published, duration, aspect_ratio, thumbnail_url, local_filename, local_path, width, height, file_size, dvids_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [dvidsId, metadata.title, metadata.description, metadata.short_description,
    metadata.virin, metadata.branch, metadata.unit_name, creditJson, metadata.category,
    keywordsJson, metadata.date_published, duration, metadata.aspect_ratio,
    metadata.thumbnail, filename, localPath, width, height, fileSize, metadata.url],
  );

  const row = dbGet<any>(`SELECT * FROM dvids_assets WHERE dvids_id = ?`, [dvidsId]);
  return toApiRow(row);
}

export async function searchAndDownloadBatch(
  queries: Array<{ timestamp: string; query: string; side?: string }>,
  onProgress?: (event: DvidsProgressEvent) => void,
): Promise<Array<{ timestamp: string; filename: string; url: string; query: string; dvidsId: string; side?: string }>> {
  const results: Array<{ timestamp: string; filename: string; url: string; query: string; dvidsId: string; side?: string }> = [];
  const searchCache = new Map<string, DvidsSearchResult | null>();

  for (const q of queries) {
    const candidates = buildQueryCandidates(q.query);
    let found = false;

    for (const candidate of candidates) {
      if (searchCache.has(candidate)) {
        const cached = searchCache.get(candidate);
        if (!cached) continue;
        onProgress?.({ progress: true, step: 'downloading', detail: `Downloading: ${cached.title}` });
        try {
          const { filename } = await downloadDvidsVideo(cached.id);
          results.push({ timestamp: q.timestamp, filename, url: `/api/dvids/file/${filename}`, query: candidate, dvidsId: cached.id, side: q.side });
          found = true;
          break;
        } catch (err) {
          onProgress?.({ progress: true, step: 'warning', detail: `Download failed: ${(err as Error).message}` });
        }
        continue;
      }

      onProgress?.({ progress: true, step: 'searching', detail: `Searching: "${candidate}"` });
      try {
        const { results: searchResults } = await searchDvids(candidate, { maxResults: 3, hd: true });
        if (searchResults.length === 0) { searchCache.set(candidate, null); continue; }
        const pick = searchResults[0];
        searchCache.set(candidate, pick);

        onProgress?.({ progress: true, step: 'downloading', detail: `Downloading: ${pick.title}` });
        const { filename } = await downloadDvidsVideo(pick.id);
        results.push({ timestamp: q.timestamp, filename, url: `/api/dvids/file/${filename}`, query: candidate, dvidsId: pick.id, side: q.side });
        found = true;
        break;
      } catch (err) {
        onProgress?.({ progress: true, step: 'error', detail: `Search error: ${(err as Error).message}` });
        searchCache.set(candidate, null);
      }
    }

    if (!found) {
      onProgress?.({ progress: true, step: 'warning', detail: `No video found for: "${q.query}"` });
    }
  }

  return results;
}

function buildQueryCandidates(query: string): string[] {
  const candidates: string[] = [query];
  const words = query.split(/\s+/).filter(w => !STOP_WORDS.has(w.toLowerCase()) && w.length > 2);
  if (words.length > 3) candidates.push(words.slice(0, 3).join(' '));
  if (words.length > 2) candidates.push(words.slice(0, 2).join(' '));
  if (words.length > 0) candidates.push(words[0]);
  return [...new Set(candidates)];
}

// ---------------------------------------------------------------------------
// Smart Suggestions
// ---------------------------------------------------------------------------

const SUGGESTIONS: Record<string, string[]> = {
  aircraft: ['C-17 Globemaster', 'C-130 Hercules', 'F-35 Lightning', 'F-22 Raptor', 'B-2 Spirit', 'KC-135 Stratotanker', 'V-22 Osprey', 'CH-47 Chinook', 'UH-60 Black Hawk', 'AH-64 Apache', 'E-3 Sentry AWACS', 'P-8 Poseidon'],
  operations: ['airdrop', 'paratrooper', 'carrier landing', 'aerial refueling', 'formation flight', 'tactical landing', 'combat search and rescue', 'medevac', 'close air support'],
  naval: ['aircraft carrier', 'destroyer', 'submarine', 'amphibious assault', 'underway replenishment', 'flight deck operations'],
  training: ['live fire exercise', 'field training', 'SERE training', 'jump school', 'flight line', 'weapons qualification'],
  equipment: ['MRAP', 'Humvee', 'Bradley fighting vehicle', 'Abrams tank', 'Stryker', 'HIMARS'],
};

export function getSmartSuggestions(category?: string): Record<string, string[]> | string[] {
  if (category && SUGGESTIONS[category]) return SUGGESTIONS[category];
  return SUGGESTIONS;
}

// ---------------------------------------------------------------------------
// Imported Assets CRUD
// ---------------------------------------------------------------------------

export function getImportedAssets(opts: {
  page?: number; limit?: number; branch?: string; category?: string;
  collection?: string; favorite?: boolean; search?: string; tags?: string;
}): { assets: DvidsImportedAsset[]; total: number } {
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.branch) { conditions.push('branch = ?'); params.push(opts.branch); }
  if (opts.category) { conditions.push('category = ?'); params.push(opts.category); }
  if (opts.collection) { conditions.push('collection = ?'); params.push(opts.collection); }
  if (opts.favorite) { conditions.push('is_favorite = 1'); }
  if (opts.search) { conditions.push('(title LIKE ? OR description LIKE ? OR keywords LIKE ?)'); params.push(`%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`); }
  if (opts.tags) { conditions.push('tags LIKE ?'); params.push(`%${opts.tags}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 24;
  const offset = ((opts.page ?? 1) - 1) * limit;

  const total = dbGet<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM dvids_assets ${where}`, params)?.cnt ?? 0;
  const rows = dbAll<any>(`SELECT * FROM dvids_assets ${where} ORDER BY imported_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

  return { assets: rows.map(toApiRow), total };
}

export function getImportedAsset(id: number): DvidsImportedAsset | null {
  const row = dbGet<any>(`SELECT * FROM dvids_assets WHERE id = ?`, [id]);
  return row ? toApiRow(row) : null;
}

export function updateImportedAsset(id: number, data: { tags?: string[]; collection?: string; is_favorite?: boolean }): DvidsImportedAsset | null {
  if (data.tags !== undefined) dbRun(`UPDATE dvids_assets SET tags = ? WHERE id = ?`, [JSON.stringify(data.tags), id]);
  if (data.collection !== undefined) dbRun(`UPDATE dvids_assets SET collection = ? WHERE id = ?`, [data.collection, id]);
  if (data.is_favorite !== undefined) dbRun(`UPDATE dvids_assets SET is_favorite = ? WHERE id = ?`, [data.is_favorite ? 1 : 0, id]);
  return getImportedAsset(id);
}

export function deleteImportedAsset(id: number): boolean {
  const row = dbGet<any>(`SELECT local_path FROM dvids_assets WHERE id = ?`, [id]);
  if (!row) return false;
  if (row.local_path && fs.existsSync(row.local_path)) {
    try { fs.unlinkSync(row.local_path); } catch {}
  }
  dbRun(`DELETE FROM dvids_assets WHERE id = ?`, [id]);
  return true;
}

export function getCollections(): string[] {
  const rows = dbAll<{ collection: string }>(`SELECT DISTINCT collection FROM dvids_assets WHERE collection IS NOT NULL AND collection != '' ORDER BY collection`);
  return rows.map(r => r.collection);
}

export function autoTagAsset(id: number): string[] {
  const asset = getImportedAsset(id);
  if (!asset) return [];
  const tags = new Set<string>(asset.tags);
  for (const kw of asset.keywords) {
    if (kw && kw.length > 2) tags.add(kw.toLowerCase());
  }
  if (asset.branch) tags.add(asset.branch.toLowerCase());
  const tagsArr = [...tags];
  dbRun(`UPDATE dvids_assets SET tags = ? WHERE id = ?`, [JSON.stringify(tagsArr), id]);
  return tagsArr;
}
