# DVIDS Military Footage Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate DVIDS public domain military footage into VideoCloudAI with a dedicated browser page, inline Storyboard/Script Studio integration, and Settings API key management.

**Architecture:** New backend service (`dvids.service.ts`) wraps the DVIDS API (`api.dvidshub.net`) for search/download/cache. New route file (`dvids.routes.ts`) exposes REST endpoints. Frontend adds a `/dvids` page with 3-panel layout, plus DVIDS tabs in Storyboard ImagesStep and Script Studio review. SQLite `dvids_assets` table stores imported footage metadata.

**Tech Stack:** Express 5, better-sqlite3, React 18, Tailwind CSS, Zustand, TanStack Query, Lucide icons, react-i18next

**Spec:** `docs/superpowers/specs/2026-09-17-dvids-integration-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/server/src/services/dvids.service.ts` | DVIDS API wrapper: search, asset details, download, batch, cache, suggestions |
| `apps/server/src/routes/dvids.routes.ts` | REST endpoints for `/api/dvids/*` |
| `apps/web/src/pages/DvidsBrowser.tsx` | Dedicated DVIDS browser page (3-panel layout) |
| `apps/web/src/pages/dvids/DvidsSearchPanel.tsx` | Left panel: filters + smart suggestions |
| `apps/web/src/pages/dvids/DvidsResultsGrid.tsx` | Center: search results + imported tabs |
| `apps/web/src/pages/dvids/DvidsDetailPanel.tsx` | Right panel: preview + metadata + actions |
| `apps/web/src/pages/dvids/DvidsVideoCard.tsx` | Individual video card component |
| `apps/web/src/pages/dvids/types.ts` | TypeScript types for DVIDS data |

### Modified Files
| File | Change |
|------|--------|
| `apps/server/src/db/schema.ts` | Add `dvids_assets` table to SCHEMA_SQL |
| `apps/server/src/app.ts` | Import + mount dvids router |
| `apps/server/src/routes/storyboard.routes.ts` | Add `/dvids-batch` endpoint |
| `apps/server/src/routes/script-studio.routes.ts` | Add `fetch-dvids`, `apply-dvids-id` endpoints, extend alternatives |
| `apps/web/src/App.tsx` | Add `/dvids` route |
| `apps/web/src/components/layout/Sidebar.tsx` | Add DVIDS nav item |
| `apps/web/src/lib/api.ts` | Add dvids API methods + storyboard dvidsBatch |
| `apps/web/src/pages/storyboard/components/ImagesStep.tsx` | Add DVIDS media type tab |
| `apps/web/src/pages/storyboard/Storyboard.tsx` | Add handleDvidsBatch handler |
| `apps/web/src/pages/script-studio/ScriptDoc.tsx` | Add 'dvids' to stock service picker |
| `apps/web/src/pages/Settings.tsx` | Add DVIDS API key section |
| `apps/web/src/i18n/locales/en.json` | Add all dvids.* translation keys |
| `apps/web/src/i18n/locales/vi.json` | Add all dvids.* translation keys |

---

## Task 1: Database Schema — Add `dvids_assets` Table

**Files:**
- Modify: `apps/server/src/db/schema.ts`

- [ ] **Step 1: Read the current schema file end to find where to add the table**

The last table in schema.ts is `transform_segments`. Add the new table after it.

- [ ] **Step 2: Add dvids_assets table to SCHEMA_SQL**

Add before the closing backtick of `SCHEMA_SQL`:

```sql
CREATE TABLE IF NOT EXISTS dvids_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dvids_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  short_description TEXT,
  virin TEXT,
  branch TEXT,
  unit_name TEXT,
  credit TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  keywords TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  date_published TEXT,
  duration REAL,
  aspect_ratio TEXT,
  thumbnail_url TEXT,
  local_filename TEXT,
  local_path TEXT,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  dvids_url TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  collection TEXT,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_dvids_branch ON dvids_assets(branch);
CREATE INDEX IF NOT EXISTS idx_dvids_category ON dvids_assets(category);
CREATE INDEX IF NOT EXISTS idx_dvids_collection ON dvids_assets(collection);
CREATE INDEX IF NOT EXISTS idx_dvids_favorite ON dvids_assets(is_favorite);
```

- [ ] **Step 3: Verify the server starts without errors**

Run: `cd apps/server && npx tsx src/db/index.ts` or just start the dev server.
Expected: `[DB] Schema OK` in logs, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/db/schema.ts
git commit -m "feat(dvids): add dvids_assets table to schema"
```

---

## Task 2: Backend Service — `dvids.service.ts`

**Files:**
- Create: `apps/server/src/services/dvids.service.ts`

- [ ] **Step 1: Create the service file with types and helpers**

```typescript
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
    // Prefer 1080p+ first, then highest width
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
  // Check if already imported
  const existing = dbGet<any>(`SELECT * FROM dvids_assets WHERE dvids_id = ?`, dvidsId);
  if (existing) return toApiRow(existing);

  const { filename, localPath, duration, width, height, fileSize, metadata } = await downloadDvidsVideo(dvidsId, destDir);

  const creditJson = JSON.stringify(metadata.credit.map(c => ({ name: c.name, rank: c.rank })));
  const keywordsJson = JSON.stringify(metadata.keywords);

  dbRun(
    `INSERT INTO dvids_assets (dvids_id, title, description, short_description, virin, branch, unit_name, credit, category, keywords, date_published, duration, aspect_ratio, thumbnail_url, local_filename, local_path, width, height, file_size, dvids_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    dvidsId,
    metadata.title,
    metadata.description,
    metadata.short_description,
    metadata.virin,
    metadata.branch,
    metadata.unit_name,
    creditJson,
    metadata.category,
    keywordsJson,
    metadata.date_published,
    duration,
    metadata.aspect_ratio,
    metadata.thumbnail,
    filename,
    localPath,
    width,
    height,
    fileSize,
    metadata.url,
  );

  const row = dbGet<any>(`SELECT * FROM dvids_assets WHERE dvids_id = ?`, dvidsId);
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
        // use cached result
        onProgress?.({ progress: true, step: 'downloading', detail: `Downloading: ${cached.title}` });
        try {
          const { filename } = await downloadDvidsVideo(cached.id);
          results.push({
            timestamp: q.timestamp,
            filename,
            url: `/api/dvids/file/${filename}`,
            query: candidate,
            dvidsId: cached.id,
            side: q.side,
          });
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
        if (searchResults.length === 0) {
          searchCache.set(candidate, null);
          continue;
        }
        const pick = searchResults[0];
        searchCache.set(candidate, pick);

        onProgress?.({ progress: true, step: 'downloading', detail: `Downloading: ${pick.title}` });
        const { filename } = await downloadDvidsVideo(pick.id);
        results.push({
          timestamp: q.timestamp,
          filename,
          url: `/api/dvids/file/${filename}`,
          query: candidate,
          dvidsId: pick.id,
          side: q.side,
        });
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
  page?: number;
  limit?: number;
  branch?: string;
  category?: string;
  collection?: string;
  favorite?: boolean;
  search?: string;
  tags?: string;
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

  const total = dbGet<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM dvids_assets ${where}`, ...params)?.cnt ?? 0;
  const rows = dbAll<any>(`SELECT * FROM dvids_assets ${where} ORDER BY imported_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);

  return { assets: rows.map(toApiRow), total };
}

export function getImportedAsset(id: number): DvidsImportedAsset | null {
  const row = dbGet<any>(`SELECT * FROM dvids_assets WHERE id = ?`, id);
  return row ? toApiRow(row) : null;
}

export function updateImportedAsset(id: number, data: { tags?: string[]; collection?: string; is_favorite?: boolean }): DvidsImportedAsset | null {
  if (data.tags !== undefined) dbRun(`UPDATE dvids_assets SET tags = ? WHERE id = ?`, JSON.stringify(data.tags), id);
  if (data.collection !== undefined) dbRun(`UPDATE dvids_assets SET collection = ? WHERE id = ?`, data.collection, id);
  if (data.is_favorite !== undefined) dbRun(`UPDATE dvids_assets SET is_favorite = ? WHERE id = ?`, data.is_favorite ? 1 : 0, id);
  return getImportedAsset(id);
}

export function deleteImportedAsset(id: number): boolean {
  const row = dbGet<any>(`SELECT local_path FROM dvids_assets WHERE id = ?`, id);
  if (!row) return false;
  if (row.local_path && fs.existsSync(row.local_path)) {
    try { fs.unlinkSync(row.local_path); } catch {}
  }
  dbRun(`DELETE FROM dvids_assets WHERE id = ?`, id);
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
  // Add from DVIDS keywords
  for (const kw of asset.keywords) {
    if (kw && kw.length > 2) tags.add(kw.toLowerCase());
  }
  // Add branch as tag
  if (asset.branch) tags.add(asset.branch.toLowerCase());
  const tagsArr = [...tags];
  dbRun(`UPDATE dvids_assets SET tags = ? WHERE id = ?`, JSON.stringify(tagsArr), id);
  return tagsArr;
}
```

- [ ] **Step 2: Verify the service compiles**

Run: `cd apps/server && npx tsc --noEmit src/services/dvids.service.ts`
Expected: No errors (or only import-related — check db imports match project pattern).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/services/dvids.service.ts
git commit -m "feat(dvids): add DVIDS backend service with search, download, cache, batch"
```

---

## Task 3: Backend Routes — `dvids.routes.ts`

**Files:**
- Create: `apps/server/src/routes/dvids.routes.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Create the routes file**

```typescript
import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import {
  searchDvids,
  getAssetDetails,
  importDvidsAsset,
  getImportedAssets,
  getImportedAsset,
  updateImportedAsset,
  deleteImportedAsset,
  getCollections,
  autoTagAsset,
  getSmartSuggestions,
  resolveDvidsCacheDir,
  searchAndDownloadBatch,
} from '../services/dvids.service';

export function createDvidsRouter(): Router {
  const router = Router();

  // Search DVIDS
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const { q, branch, category, aspectRatio, fromDate, toDate, hd, fromDuration, toDuration, sort, sortDir, page, maxResults } = req.query;
      if (!q) { res.status(400).json({ error: 'q (query) is required' }); return; }
      const result = await searchDvids(q as string, {
        branch: branch as string,
        category: category as string,
        aspectRatio: aspectRatio as string,
        fromDate: fromDate as string,
        toDate: toDate as string,
        hd: hd === '1' || hd === 'true',
        fromDuration: fromDuration ? Number(fromDuration) : undefined,
        toDuration: toDuration ? Number(toDuration) : undefined,
        sort: sort as string,
        sortDir: sortDir as string,
        page: page ? Number(page) : undefined,
        maxResults: maxResults ? Number(maxResults) : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get asset details
  router.get('/asset/:id', async (req: Request, res: Response) => {
    try {
      const dvidsId = req.params.id.includes(':') ? req.params.id : `video:${req.params.id}`;
      const asset = await getAssetDetails(dvidsId);
      res.json({ asset });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Smart suggestions
  router.get('/suggestions', (_req: Request, res: Response) => {
    const category = _req.query.category as string | undefined;
    res.json({ suggestions: getSmartSuggestions(category) });
  });

  // Download + import single video
  router.post('/download', async (req: Request, res: Response) => {
    try {
      const { dvidsId } = req.body;
      if (!dvidsId) { res.status(400).json({ error: 'dvidsId required' }); return; }
      const asset = await importDvidsAsset(dvidsId);
      res.json({ ok: true, asset });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Bulk download with NDJSON progress
  router.post('/download-batch', async (req: Request, res: Response) => {
    const { dvidsIds } = req.body as { dvidsIds: string[] };
    if (!dvidsIds?.length) { res.status(400).json({ error: 'dvidsIds required' }); return; }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    const results: any[] = [];
    for (let i = 0; i < dvidsIds.length; i++) {
      try {
        res.write(JSON.stringify({ progress: true, step: 'downloading', detail: `Importing ${i + 1}/${dvidsIds.length}...` }) + '\n');
        const asset = await importDvidsAsset(dvidsIds[i]);
        results.push(asset);
      } catch (err) {
        res.write(JSON.stringify({ progress: true, step: 'error', detail: `Failed: ${(err as Error).message}` }) + '\n');
      }
    }
    res.write(JSON.stringify({ done: true, assets: results }) + '\n');
    res.end();
  });

  // List imported assets
  router.get('/imported', (req: Request, res: Response) => {
    try {
      const { page, limit, branch, category, collection, favorite, search, tags } = req.query;
      const result = getImportedAssets({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        branch: branch as string,
        category: category as string,
        collection: collection as string,
        favorite: favorite === '1' || favorite === 'true',
        search: search as string,
        tags: tags as string,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get single imported asset
  router.get('/imported/:id', (req: Request, res: Response) => {
    try {
      const asset = getImportedAsset(Number(req.params.id));
      if (!asset) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ asset });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Update imported asset (tags, collection, favorite)
  router.put('/imported/:id', (req: Request, res: Response) => {
    try {
      const asset = updateImportedAsset(Number(req.params.id), req.body);
      if (!asset) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true, asset });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Delete imported asset
  router.delete('/imported/:id', (req: Request, res: Response) => {
    try {
      const ok = deleteImportedAsset(Number(req.params.id));
      if (!ok) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List collections
  router.get('/collections', (_req: Request, res: Response) => {
    try {
      res.json({ collections: getCollections() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Auto-tag from DVIDS keywords
  router.post('/imported/:id/auto-tag', (req: Request, res: Response) => {
    try {
      const tags = autoTagAsset(Number(req.params.id));
      res.json({ ok: true, tags });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve cached DVIDS video files
  router.get('/file/:filename', (req: Request, res: Response) => {
    const dir = resolveDvidsCacheDir();
    const filePath = path.join(dir, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  });

  return router;
}
```

- [ ] **Step 2: Register the router in app.ts**

In `apps/server/src/app.ts`, add import at line 29 (after the transform import):

```typescript
import { createDvidsRouter } from './routes/dvids.routes';
```

Add route registration at line 111 (after transform):

```typescript
app.use('/api/dvids', createDvidsRouter());
```

- [ ] **Step 3: Verify server starts**

Run: `npm run dev --workspace=apps/server`
Expected: Server starts, no import errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/dvids.routes.ts apps/server/src/app.ts
git commit -m "feat(dvids): add DVIDS API routes and register in app"
```

---

## Task 4: Storyboard + Script Studio Backend Integration

**Files:**
- Modify: `apps/server/src/routes/storyboard.routes.ts`
- Modify: `apps/server/src/routes/script-studio.routes.ts`

- [ ] **Step 1: Add `/dvids-batch` to storyboard routes**

In `apps/server/src/routes/storyboard.routes.ts`, add import at the top:

```typescript
import { searchAndDownloadBatch as dvidsBatch } from '../services/dvids.service';
```

Add the endpoint after the existing `/pexels-batch` handler (around line 3422):

```typescript
router.post('/dvids-batch', async (req: Request, res: Response) => {
  const { queries } = req.body as { queries: Array<{ timestamp: string; query: string; side?: string }> };
  if (!queries?.length) { res.status(400).json({ error: 'queries required' }); return; }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  try {
    const videos = await dvidsBatch(queries, (msg) => {
      res.write(JSON.stringify(msg) + '\n');
    });
    res.write(JSON.stringify({ done: true, videos }) + '\n');
  } catch (err) {
    res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
  }
  res.end();
});
```

- [ ] **Step 2: Add DVIDS endpoints to script-studio routes**

In `apps/server/src/routes/script-studio.routes.ts`, add import:

```typescript
import { searchDvids, downloadDvidsVideo, resolveDvidsCacheDir } from '../services/dvids.service';
```

Add `dvids` to the alternatives endpoint (find the `GET /docs/:id/blocks/alternatives` handler where `service` param is checked). Add a case for `service === 'dvids'`:

```typescript
} else if (service === 'dvids') {
  const { results } = await searchDvids(query, { maxResults: perPage, aspectRatio: orientation === 'portrait' ? 'portrait' : '16:9' });
  candidates = results.map(r => ({
    id: r.id,
    thumbnail: r.thumbnail,
    previewUrl: r.thumbnail,
    downloadUrl: r.url,
    duration: r.duration,
    width: r.width,
    height: r.height,
    pageUrl: r.url,
    title: r.title,
    source: 'dvids',
  }));
}
```

Add fetch-dvids endpoint (after existing fetch-pexels):

```typescript
router.post('/docs/:id/blocks/:blockIndex/fetch-dvids', async (req: Request, res: Response) => {
  try {
    const { id, blockIndex } = req.params;
    const { orientation } = req.body;
    const block = getBlock(id, Number(blockIndex));
    if (!block) { res.status(404).json({ error: 'Block not found' }); return; }

    const query = block.pexels_query || block.narration?.slice(0, 60) || '';
    if (!query) { res.status(400).json({ error: 'No query available' }); return; }

    const { results } = await searchDvids(query, { maxResults: 1, aspectRatio: orientation === 'portrait' ? 'portrait' : '16:9', hd: true });
    if (!results.length) { res.status(404).json({ error: 'No DVIDS results' }); return; }

    const pick = results[0];
    const docDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard', `doc_${id}`);
    const { filename, duration, width, height } = await downloadDvidsVideo(pick.id, docDir);

    res.json({ ok: true, filename, dvidsId: pick.id, duration, width, height });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

Add apply-dvids-id endpoint:

```typescript
router.post('/docs/:id/blocks/:blockIndex/apply-dvids-id', async (req: Request, res: Response) => {
  try {
    const { id, blockIndex } = req.params;
    const { dvidsId } = req.body;
    if (!dvidsId) { res.status(400).json({ error: 'dvidsId required' }); return; }

    const docDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard', `doc_${id}`);
    const { filename, duration, width, height } = await downloadDvidsVideo(dvidsId, docDir);

    res.json({ ok: true, filename, dvidsId, duration, width, height });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 3: Verify server starts**

Run: `npm run dev --workspace=apps/server`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/storyboard.routes.ts apps/server/src/routes/script-studio.routes.ts
git commit -m "feat(dvids): add DVIDS batch/fetch/apply endpoints to storyboard and script-studio"
```

---

## Task 5: i18n Translation Keys

**Files:**
- Modify: `apps/web/src/i18n/locales/en.json`
- Modify: `apps/web/src/i18n/locales/vi.json`

- [ ] **Step 1: Add DVIDS keys to en.json**

Add these keys to `en.json` (find appropriate location — after the last existing section):

```json
"nav": {
  "dvids": "DVIDS Military"
},
"dvids": {
  "title": "DVIDS Military Footage",
  "subtitle": "Public domain U.S. Department of Defense footage",
  "search": "Search DVIDS",
  "searchPlaceholder": "Search military footage...",
  "branch": "Branch",
  "allBranches": "All Branches",
  "category": "Category",
  "allCategories": "All Categories",
  "aspectRatio": "Aspect Ratio",
  "hdOnly": "HD Only",
  "duration": "Duration",
  "durationMin": "Min (sec)",
  "durationMax": "Max (sec)",
  "dateRange": "Date Range",
  "dateFrom": "From",
  "dateTo": "To",
  "sort": "Sort By",
  "sortDate": "Date",
  "sortScore": "Relevance",
  "sortRating": "Rating",
  "suggestions": "Smart Suggestions",
  "import": "Import",
  "importing": "Importing...",
  "importSelected": "Import Selected",
  "bulkImport": "Bulk Import",
  "downloaded": "Downloaded",
  "favorites": "Favorites",
  "collections": "Collections",
  "noCollection": "No Collection",
  "imported": "My Library",
  "searchResults": "Search Results",
  "noResults": "No results found. Try different keywords.",
  "noImported": "No imported footage yet. Search and import DVIDS clips above.",
  "attribution": "U.S. Department of Defense / Public Domain",
  "credit": "Credit",
  "virin": "VIRIN",
  "unit": "Unit",
  "keywords": "Keywords",
  "tags": "Tags",
  "addTag": "Add tag...",
  "collection": "Collection",
  "autoTag": "Auto-tag from keywords",
  "delete": "Delete",
  "deleteConfirm": "Delete this imported footage? The local file will be removed.",
  "apiKeyOptional": "Optional — works without key but with lower rate limits",
  "testConnection": "Test Connection",
  "connectionOk": "Connected to DVIDS API",
  "connectionFailed": "Failed to connect to DVIDS API",
  "fetchFromDvids": "Fetch from DVIDS",
  "stopFetch": "Stop",
  "aircraft": "Aircraft",
  "operations": "Operations",
  "naval": "Naval",
  "training": "Training",
  "equipment": "Equipment",
  "totalResults": "{{count}} results",
  "selectedCount": "{{count}} selected",
  "importingProgress": "Importing {{current}}/{{total}}..."
},
"storyboard": {
  "mediaTypeDvids": "DVIDS Military",
  "dvidsFetch": "Fetch from DVIDS",
  "dvidsStop": "Stop",
  "dvidsBranchFilter": "Branch Filter",
  "dvidsDesc": "Search and use public domain U.S. military footage from DVIDS"
},
"settings": {
  "dvidsTitle": "DVIDS (Military Footage)",
  "dvidsApiKey": "DVIDS API Key",
  "dvidsDesc": "Access public domain U.S. military footage. Get a key at api.dvidshub.net",
  "testDvids": "Test DVIDS"
}
```

Note: The `nav`, `storyboard`, and `settings` keys should be merged into the existing sections — do not create duplicate top-level keys. Add `"dvids"` key inside existing `"nav"` object, add `"mediaTypeDvids"` etc inside existing `"storyboard"` object, etc.

- [ ] **Step 2: Add DVIDS keys to vi.json**

Same structure with Vietnamese translations:

```json
"nav": {
  "dvids": "DVIDS Quân sự"
},
"dvids": {
  "title": "Video Quân sự DVIDS",
  "subtitle": "Video miễn phí từ Bộ Quốc phòng Hoa Kỳ",
  "search": "Tìm kiếm DVIDS",
  "searchPlaceholder": "Tìm video quân sự...",
  "branch": "Quân chủng",
  "allBranches": "Tất cả",
  "category": "Danh mục",
  "allCategories": "Tất cả",
  "aspectRatio": "Tỉ lệ khung hình",
  "hdOnly": "Chỉ HD",
  "duration": "Thời lượng",
  "durationMin": "Tối thiểu (giây)",
  "durationMax": "Tối đa (giây)",
  "dateRange": "Khoảng thời gian",
  "dateFrom": "Từ",
  "dateTo": "Đến",
  "sort": "Sắp xếp",
  "sortDate": "Ngày",
  "sortScore": "Độ phù hợp",
  "sortRating": "Đánh giá",
  "suggestions": "Gợi ý thông minh",
  "import": "Nhập",
  "importing": "Đang nhập...",
  "importSelected": "Nhập đã chọn",
  "bulkImport": "Nhập hàng loạt",
  "downloaded": "Đã tải",
  "favorites": "Yêu thích",
  "collections": "Bộ sưu tập",
  "noCollection": "Chưa phân loại",
  "imported": "Thư viện",
  "searchResults": "Kết quả tìm kiếm",
  "noResults": "Không tìm thấy kết quả. Thử từ khóa khác.",
  "noImported": "Chưa có video nào. Tìm và nhập từ DVIDS.",
  "attribution": "Bộ Quốc phòng Hoa Kỳ / Miền công cộng",
  "credit": "Tác giả",
  "virin": "VIRIN",
  "unit": "Đơn vị",
  "keywords": "Từ khóa",
  "tags": "Nhãn",
  "addTag": "Thêm nhãn...",
  "collection": "Bộ sưu tập",
  "autoTag": "Tự động gắn nhãn",
  "delete": "Xóa",
  "deleteConfirm": "Xóa video này? File cục bộ sẽ bị xóa.",
  "apiKeyOptional": "Tùy chọn — hoạt động không cần khóa nhưng giới hạn thấp hơn",
  "testConnection": "Kiểm tra kết nối",
  "connectionOk": "Đã kết nối DVIDS API",
  "connectionFailed": "Không thể kết nối DVIDS API",
  "fetchFromDvids": "Lấy từ DVIDS",
  "stopFetch": "Dừng",
  "aircraft": "Máy bay",
  "operations": "Hoạt động",
  "naval": "Hải quân",
  "training": "Huấn luyện",
  "equipment": "Trang bị",
  "totalResults": "{{count}} kết quả",
  "selectedCount": "{{count}} đã chọn",
  "importingProgress": "Đang nhập {{current}}/{{total}}..."
},
"storyboard": {
  "mediaTypeDvids": "DVIDS Quân sự",
  "dvidsFetch": "Lấy từ DVIDS",
  "dvidsStop": "Dừng",
  "dvidsBranchFilter": "Lọc quân chủng",
  "dvidsDesc": "Tìm và sử dụng video quân sự miễn phí từ DVIDS"
},
"settings": {
  "dvidsTitle": "DVIDS (Video Quân sự)",
  "dvidsApiKey": "Khóa API DVIDS",
  "dvidsDesc": "Truy cập video quân sự miễn phí. Lấy khóa tại api.dvidshub.net",
  "testDvids": "Kiểm tra DVIDS"
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/vi.json
git commit -m "feat(dvids): add i18n translation keys for DVIDS feature (EN + VI)"
```

---

## Task 6: Frontend API Client

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add DVIDS API methods**

Find the end of the API object (before the final export or closing brace). Add a `dvids` section:

```typescript
export const dvidsApi = {
  search: (params: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    return fetch(`/api/dvids/search?${qs}`).then(r => r.json());
  },
  asset: (id: string) => fetch(`/api/dvids/asset/${id}`).then(r => r.json()),
  suggestions: (category?: string) => {
    const qs = category ? `?category=${category}` : '';
    return fetch(`/api/dvids/suggestions${qs}`).then(r => r.json());
  },
  download: (dvidsId: string) =>
    fetch('/api/dvids/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dvidsId }) }).then(r => r.json()),
  downloadBatch: async (dvidsIds: string[], onProgress: (step: string, detail?: string) => void, signal?: AbortSignal) => {
    const res = await fetch('/api/dvids/download-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dvidsIds }),
      signal,
    });
    let result: any[] = [];
    await readNDJSON(res, (parsed: any) => {
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.progress) onProgress(parsed.step, parsed.detail);
      if (parsed.done) result = parsed.assets ?? [];
    });
    return result;
  },
  imported: (params?: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams();
    if (params) for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    return fetch(`/api/dvids/imported?${qs}`).then(r => r.json());
  },
  importedById: (id: number) => fetch(`/api/dvids/imported/${id}`).then(r => r.json()),
  updateImported: (id: number, data: any) =>
    fetch(`/api/dvids/imported/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
  deleteImported: (id: number) =>
    fetch(`/api/dvids/imported/${id}`, { method: 'DELETE' }).then(r => r.json()),
  collections: () => fetch('/api/dvids/collections').then(r => r.json()),
  autoTag: (id: number) =>
    fetch(`/api/dvids/imported/${id}/auto-tag`, { method: 'POST' }).then(r => r.json()),
};
```

- [ ] **Step 2: Add dvidsBatch to storyboard API section**

Find the existing `pexelsBatch` method in the storyboard API section. Add after it:

```typescript
dvidsBatch: async (
  queries: Array<{ timestamp: string; query: string; side?: string }>,
  onProgress: (step: string, detail?: string) => void,
  signal?: AbortSignal,
): Promise<Array<{ timestamp: string; filename: string; url: string; query: string; dvidsId: string; side?: string }>> => {
  const res = await fetch('/api/storyboard/dvids-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries }),
    signal,
  });
  let result: Array<{ timestamp: string; filename: string; url: string; query: string; dvidsId: string; side?: string }> = [];
  await readNDJSON(res, (parsed: any) => {
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.progress) onProgress(parsed.step, parsed.detail);
    if (parsed.done) result = parsed.videos ?? [];
  });
  return result;
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(dvids): add DVIDS API client methods and storyboard dvidsBatch"
```

---

## Task 7: Frontend Types

**Files:**
- Create: `apps/web/src/pages/dvids/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
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

export interface DvidsSearchFilters {
  q: string;
  branch: string;
  category: string;
  aspectRatio: string;
  hd: boolean;
  fromDuration: string;
  toDuration: string;
  fromDate: string;
  toDate: string;
  sort: string;
  sortDir: string;
  page: number;
}

export const DVIDS_BRANCHES = [
  'Air Force', 'Army', 'Navy', 'Marines', 'Coast Guard', 'Space Force', 'Joint', 'Civilian',
] as const;

export const DVIDS_CATEGORIES = [
  'B-Roll', 'Combat Operations', 'Interviews', 'Newscasts', 'Briefings',
  'Commercials', 'PSA', 'Series', 'Package', 'Miscellaneous',
] as const;

export const BRANCH_COLORS: Record<string, string> = {
  'Air Force': 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  'Army': 'bg-green-600/20 text-green-400 border-green-600/30',
  'Navy': 'bg-indigo-600/20 text-indigo-400 border-indigo-600/30',
  'Marines': 'bg-red-600/20 text-red-400 border-red-600/30',
  'Coast Guard': 'bg-orange-600/20 text-orange-400 border-orange-600/30',
  'Space Force': 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  'Joint': 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  'Civilian': 'bg-gray-600/20 text-gray-400 border-gray-600/30',
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/dvids/types.ts
git commit -m "feat(dvids): add frontend TypeScript types for DVIDS data"
```

---

## Task 8: Frontend — DvidsVideoCard Component

**Files:**
- Create: `apps/web/src/pages/dvids/DvidsVideoCard.tsx`

- [ ] **Step 1: Create the video card component**

```tsx
import { clsx } from 'clsx';
import { Play, Check } from 'lucide-react';
import { DvidsSearchResult, DvidsImportedAsset, BRANCH_COLORS } from './types';

interface Props {
  item: DvidsSearchResult | DvidsImportedAsset;
  selected?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  onCheck?: (checked: boolean) => void;
  showCheckbox?: boolean;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function DvidsVideoCard({ item, selected, checked, onSelect, onCheck, showCheckbox }: Props) {
  const title = item.title;
  const thumbnail = 'thumbnail' in item ? item.thumbnail : (item as DvidsImportedAsset).thumbnail_url;
  const duration = item.duration ?? 0;
  const branch = item.branch ?? '';
  const branchClass = BRANCH_COLORS[branch] || 'bg-gray-600/20 text-gray-400 border-gray-600/30';

  return (
    <div
      onClick={onSelect}
      className={clsx(
        'group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 border',
        selected
          ? 'border-cyan-500 ring-2 ring-cyan-500/30 scale-[1.02]'
          : 'border-c-border hover:border-c-dim hover:shadow-lg hover:scale-[1.01]',
        'bg-c-surface',
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-c-bg">
        {thumbnail ? (
          <img src={thumbnail} alt={title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-c-dim">
            <Play className="w-8 h-8" />
          </div>
        )}

        {/* Play overlay on hover */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play className="w-10 h-10 text-white" fill="white" />
        </div>

        {/* Duration badge */}
        {duration > 0 && (
          <span className="absolute bottom-2 right-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/70 text-white">
            {formatDuration(duration)}
          </span>
        )}

        {/* Checkbox */}
        {showCheckbox && (
          <button
            onClick={(e) => { e.stopPropagation(); onCheck?.(!checked); }}
            className={clsx(
              'absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
              checked
                ? 'bg-cyan-500 border-cyan-500 text-white'
                : 'border-white/60 bg-black/30 hover:border-white',
            )}
          >
            {checked && <Check className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5 space-y-1">
        <h4 className="text-xs font-medium text-c-text line-clamp-2 leading-tight">{title}</h4>
        {branch && (
          <span className={clsx('inline-block text-[9px] font-medium px-1.5 py-0.5 rounded border', branchClass)}>
            {branch}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/dvids/DvidsVideoCard.tsx
git commit -m "feat(dvids): add DvidsVideoCard component"
```

---

## Task 9: Frontend — DvidsSearchPanel (Left Panel)

**Files:**
- Create: `apps/web/src/pages/dvids/DvidsSearchPanel.tsx`

- [ ] **Step 1: Create the search/filter panel**

```tsx
import { useState, useEffect } from 'react';
import { Search, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dvidsApi } from '../../lib/api';
import { DvidsSearchFilters, DVIDS_BRANCHES, DVIDS_CATEGORIES } from './types';

interface Props {
  filters: DvidsSearchFilters;
  onChange: (filters: DvidsSearchFilters) => void;
  onSearch: () => void;
  importedCount: number;
}

export function DvidsSearchPanel({ filters, onChange, onSearch, importedCount }: Props) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    dvidsApi.suggestions().then((d: any) => setSuggestions(d.suggestions || d));
  }, []);

  const set = (key: keyof DvidsSearchFilters, value: any) => {
    onChange({ ...filters, [key]: value, page: 1 });
  };

  const reset = () => {
    onChange({ q: '', branch: '', category: '', aspectRatio: '', hd: false, fromDuration: '', toDuration: '', fromDate: '', toDate: '', sort: 'date', sortDir: 'desc', page: 1 });
  };

  return (
    <div className="w-[280px] flex-shrink-0 border-r border-c-border overflow-y-auto p-4 space-y-4">
      {/* Search */}
      <div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-c-dim" />
          <input
            type="text"
            placeholder={t('dvids.searchPlaceholder')}
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            className="input pl-8 text-sm w-full"
          />
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={onSearch} className="btn-primary text-xs flex-1">{t('dvids.search')}</button>
          <button onClick={reset} className="btn-secondary text-xs p-2" title="Reset"><RotateCcw className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Branch */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.branch')}</label>
        <select value={filters.branch} onChange={(e) => set('branch', e.target.value)} className="input text-sm w-full">
          <option value="">{t('dvids.allBranches')}</option>
          {DVIDS_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Category */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.category')}</label>
        <select value={filters.category} onChange={(e) => set('category', e.target.value)} className="input text-sm w-full">
          <option value="">{t('dvids.allCategories')}</option>
          {DVIDS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Aspect Ratio */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.aspectRatio')}</label>
        <div className="flex gap-1.5 flex-wrap">
          {['', '16:9', 'portrait', 'square'].map(ar => (
            <button
              key={ar}
              onClick={() => set('aspectRatio', ar)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                filters.aspectRatio === ar ? 'bg-cyan-600/20 text-cyan-400 border-cyan-600/30' : 'border-c-border text-c-muted hover:text-c-text'
              }`}
            >
              {ar || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* HD Toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={filters.hd} onChange={(e) => set('hd', e.target.checked)} className="rounded" />
        <span className="text-xs text-c-muted">{t('dvids.hdOnly')}</span>
      </label>

      {/* Duration */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.duration')}</label>
        <div className="flex gap-2">
          <input type="number" placeholder={t('dvids.durationMin')} value={filters.fromDuration} onChange={(e) => set('fromDuration', e.target.value)} className="input text-xs w-1/2" min="0" />
          <input type="number" placeholder={t('dvids.durationMax')} value={filters.toDuration} onChange={(e) => set('toDuration', e.target.value)} className="input text-xs w-1/2" min="0" />
        </div>
      </div>

      {/* Date Range */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.dateRange')}</label>
        <div className="space-y-1.5">
          <input type="date" value={filters.fromDate} onChange={(e) => set('fromDate', e.target.value)} className="input text-xs w-full" />
          <input type="date" value={filters.toDate} onChange={(e) => set('toDate', e.target.value)} className="input text-xs w-full" />
        </div>
      </div>

      {/* Sort */}
      <div>
        <label className="text-xs text-c-muted mb-1 block">{t('dvids.sort')}</label>
        <select value={filters.sort} onChange={(e) => set('sort', e.target.value)} className="input text-sm w-full">
          <option value="date">{t('dvids.sortDate')}</option>
          <option value="score">{t('dvids.sortScore')}</option>
          <option value="rating">{t('dvids.sortRating')}</option>
        </select>
      </div>

      {/* Smart Suggestions */}
      <div>
        <label className="text-xs text-c-muted mb-2 block">{t('dvids.suggestions')}</label>
        {Object.entries(suggestions).map(([cat, items]) => (
          <div key={cat} className="mb-2">
            <span className="text-[10px] font-medium text-c-dim uppercase tracking-wide">{t(`dvids.${cat}`)}</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {(items as string[]).slice(0, 6).map(kw => (
                <button
                  key={kw}
                  onClick={() => { onChange({ ...filters, q: kw, page: 1 }); onSearch(); }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-c-elevated text-c-muted hover:text-c-text hover:bg-c-surface border border-c-border transition-colors"
                >
                  {kw}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Imported count */}
      <div className="border-t border-c-border pt-3">
        <span className="text-xs text-c-dim">{t('dvids.imported')}: {importedCount}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/dvids/DvidsSearchPanel.tsx
git commit -m "feat(dvids): add DvidsSearchPanel component with filters and suggestions"
```

---

## Task 10: Frontend — DvidsDetailPanel (Right Panel)

**Files:**
- Create: `apps/web/src/pages/dvids/DvidsDetailPanel.tsx`

- [ ] **Step 1: Create the detail panel**

```tsx
import { useState } from 'react';
import { X, Star, Download, Tag, Trash2, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { DvidsSearchResult, DvidsImportedAsset, BRANCH_COLORS } from './types';

interface Props {
  item: DvidsSearchResult | DvidsImportedAsset | null;
  isImported?: boolean;
  onClose: () => void;
  onImport?: (id: string) => void;
  onFavorite?: (id: number, fav: boolean) => void;
  onUpdateTags?: (id: number, tags: string[]) => void;
  onUpdateCollection?: (id: number, collection: string) => void;
  onAutoTag?: (id: number) => void;
  onDelete?: (id: number) => void;
  importing?: boolean;
  collections?: string[];
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function DvidsDetailPanel({
  item, isImported, onClose, onImport, onFavorite, onUpdateTags, onUpdateCollection, onAutoTag, onDelete, importing, collections,
}: Props) {
  const { t } = useTranslation();
  const [newTag, setNewTag] = useState('');

  if (!item) return null;

  const imported = isImported ? (item as DvidsImportedAsset) : null;
  const search = !isImported ? (item as DvidsSearchResult) : null;

  const title = item.title;
  const branch = item.branch ?? '';
  const branchClass = BRANCH_COLORS[branch] || '';
  const duration = item.duration ?? 0;
  const thumbnail = search?.thumbnail ?? imported?.thumbnail_url;
  const videoSrc = imported?.local_filename ? `/api/dvids/file/${imported.local_filename}` : null;
  const dvidsUrl = search?.url ?? imported?.dvids_url;
  const credit = search?.credit ?? imported?.credit?.map(c => `${c.rank} ${c.name}`).join(', ') ?? '';
  const unit = search?.unit_name ?? imported?.unit_name ?? '';
  const virin = imported?.virin ?? '';
  const keywords = search?.keywords ?? imported?.keywords ?? [];
  const tags = imported?.tags ?? [];
  const datePub = search?.date_published ?? imported?.date_published ?? '';

  const addTag = () => {
    if (!newTag.trim() || !imported) return;
    onUpdateTags?.(imported.id, [...tags, newTag.trim()]);
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    if (!imported) return;
    onUpdateTags?.(imported.id, tags.filter(t => t !== tag));
  };

  return (
    <div className="w-[320px] flex-shrink-0 border-l border-c-border overflow-y-auto bg-c-surface">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-c-border">
        <span className="text-xs font-medium text-c-text truncate">{title}</span>
        <button onClick={onClose} className="text-c-dim hover:text-c-text"><X className="w-4 h-4" /></button>
      </div>

      {/* Preview */}
      <div className="aspect-video bg-black">
        {videoSrc ? (
          <video src={videoSrc} controls className="w-full h-full" poster={thumbnail ?? undefined} />
        ) : thumbnail ? (
          <img src={thumbnail} alt={title} className="w-full h-full object-cover" />
        ) : null}
      </div>

      <div className="p-3 space-y-3">
        {/* Branch + Duration */}
        <div className="flex items-center gap-2 flex-wrap">
          {branch && <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded border', branchClass)}>{branch}</span>}
          {duration > 0 && <span className="text-[10px] text-c-dim">{formatDuration(duration)}</span>}
          {datePub && <span className="text-[10px] text-c-dim">{new Date(datePub).toLocaleDateString()}</span>}
        </div>

        {/* Description */}
        {(search?.short_description || imported?.description) && (
          <p className="text-[11px] text-c-muted leading-relaxed">{search?.short_description || imported?.short_description || imported?.description?.slice(0, 200)}</p>
        )}

        {/* Metadata */}
        <div className="space-y-1.5 text-[11px]">
          {unit && <div><span className="text-c-dim">{t('dvids.unit')}:</span> <span className="text-c-text">{unit}</span></div>}
          {credit && <div><span className="text-c-dim">{t('dvids.credit')}:</span> <span className="text-c-text">{credit}</span></div>}
          {virin && <div><span className="text-c-dim">{t('dvids.virin')}:</span> <span className="text-c-text font-mono">{virin}</span></div>}
        </div>

        {/* Keywords */}
        {keywords.length > 0 && (
          <div>
            <span className="text-[10px] text-c-dim">{t('dvids.keywords')}</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {keywords.slice(0, 12).map(kw => (
                <span key={kw} className="text-[9px] px-1.5 py-0.5 rounded bg-c-elevated text-c-muted border border-c-border">{kw}</span>
              ))}
            </div>
          </div>
        )}

        {/* Tags (imported only) */}
        {imported && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-c-dim">{t('dvids.tags')}</span>
              <button onClick={() => onAutoTag?.(imported.id)} className="text-[9px] text-cyan-400 hover:underline">{t('dvids.autoTag')}</button>
            </div>
            <div className="flex flex-wrap gap-1">
              {tags.map(tag => (
                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-600/15 text-cyan-400 border border-cyan-600/20 flex items-center gap-1">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                placeholder={t('dvids.addTag')}
                className="text-[9px] px-1.5 py-0.5 bg-transparent border border-c-border rounded w-16 text-c-text outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        )}

        {/* Collection (imported only) */}
        {imported && (
          <div>
            <label className="text-[10px] text-c-dim block mb-1">{t('dvids.collection')}</label>
            <select
              value={imported.collection ?? ''}
              onChange={(e) => onUpdateCollection?.(imported.id, e.target.value)}
              className="input text-xs w-full"
            >
              <option value="">{t('dvids.noCollection')}</option>
              {collections?.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2 border-t border-c-border">
          {!isImported && (
            <button
              onClick={() => onImport?.(search?.id ?? '')}
              disabled={importing}
              className="btn-primary text-xs flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              {importing ? t('dvids.importing') : t('dvids.import')}
            </button>
          )}

          {imported && (
            <>
              <button
                onClick={() => onFavorite?.(imported.id, !imported.is_favorite)}
                className={clsx('text-xs flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-colors',
                  imported.is_favorite ? 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30' : 'border-c-border text-c-muted hover:text-c-text'
                )}
              >
                <Star className="w-3.5 h-3.5" fill={imported.is_favorite ? 'currentColor' : 'none'} />
                {t('dvids.favorites')}
              </button>
              <button
                onClick={() => { if (confirm(t('dvids.deleteConfirm'))) onDelete?.(imported.id); }}
                className="text-xs flex items-center justify-center gap-1.5 py-2 rounded-lg border border-red-600/30 text-red-400 hover:bg-red-600/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('dvids.delete')}
              </button>
            </>
          )}

          {dvidsUrl && (
            <a href={dvidsUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1 justify-center">
              <ExternalLink className="w-3 h-3" /> View on DVIDS
            </a>
          )}
        </div>

        {/* Attribution */}
        <div className="text-[9px] text-c-dim text-center pt-2 border-t border-c-border">
          {t('dvids.attribution')}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/dvids/DvidsDetailPanel.tsx
git commit -m "feat(dvids): add DvidsDetailPanel component with preview and metadata"
```

---

## Task 11: Frontend — DvidsResultsGrid (Center Panel)

**Files:**
- Create: `apps/web/src/pages/dvids/DvidsResultsGrid.tsx`

- [ ] **Step 1: Create the results grid with tabs**

```tsx
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { DvidsSearchResult, DvidsImportedAsset } from './types';
import { DvidsVideoCard } from './DvidsVideoCard';

interface Props {
  tab: 'search' | 'imported';
  onTabChange: (tab: 'search' | 'imported') => void;
  searchResults: DvidsSearchResult[];
  importedAssets: DvidsImportedAsset[];
  totalSearch: number;
  totalImported: number;
  page: number;
  onPageChange: (page: number) => void;
  selectedId: string | number | null;
  onSelect: (item: DvidsSearchResult | DvidsImportedAsset) => void;
  checkedIds: Set<string>;
  onCheck: (id: string, checked: boolean) => void;
  onBulkImport: () => void;
  loading?: boolean;
  bulkImporting?: boolean;
}

export function DvidsResultsGrid({
  tab, onTabChange, searchResults, importedAssets, totalSearch, totalImported,
  page, onPageChange, selectedId, onSelect, checkedIds, onCheck, onBulkImport, loading, bulkImporting,
}: Props) {
  const { t } = useTranslation();
  const items = tab === 'search' ? searchResults : importedAssets;
  const total = tab === 'search' ? totalSearch : totalImported;
  const perPage = 24;
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tabs + Bulk Actions */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-c-border">
        <div className="flex gap-1">
          <button
            onClick={() => onTabChange('search')}
            className={clsx('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              tab === 'search' ? 'bg-cyan-600/20 text-cyan-400' : 'text-c-muted hover:text-c-text'
            )}
          >
            {t('dvids.searchResults')} {totalSearch > 0 && `(${totalSearch})`}
          </button>
          <button
            onClick={() => onTabChange('imported')}
            className={clsx('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              tab === 'imported' ? 'bg-green-600/20 text-green-400' : 'text-c-muted hover:text-c-text'
            )}
          >
            {t('dvids.imported')} {totalImported > 0 && `(${totalImported})`}
          </button>
        </div>

        {tab === 'search' && checkedIds.size > 0 && (
          <button
            onClick={onBulkImport}
            disabled={bulkImporting}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {bulkImporting
              ? t('dvids.importing')
              : t('dvids.importSelected').replace('Selected', `${checkedIds.size}`)}
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-c-dim">
            <p className="text-sm">{tab === 'search' ? t('dvids.noResults') : t('dvids.noImported')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => {
              const itemId = 'dvids_id' in item ? (item as DvidsImportedAsset).dvids_id : (item as DvidsSearchResult).id;
              const numId = 'id' in item && typeof (item as any).id === 'number' ? (item as any).id : itemId;
              return (
                <DvidsVideoCard
                  key={itemId}
                  item={item}
                  selected={selectedId === numId || selectedId === itemId}
                  checked={checkedIds.has(String(itemId))}
                  onSelect={() => onSelect(item)}
                  onCheck={(c) => onCheck(String(itemId), c)}
                  showCheckbox={tab === 'search'}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-3 border-t border-c-border">
          <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="btn-secondary p-1.5 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-c-muted">{page} / {totalPages}</span>
          <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="btn-secondary p-1.5 disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/dvids/DvidsResultsGrid.tsx
git commit -m "feat(dvids): add DvidsResultsGrid component with tabs and pagination"
```

---

## Task 12: Frontend — DvidsBrowser Page (Main Page)

**Files:**
- Create: `apps/web/src/pages/DvidsBrowser.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create the main browser page**

```tsx
import { useState, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dvidsApi } from '../lib/api';
import { DvidsSearchFilters, DvidsSearchResult, DvidsImportedAsset } from './dvids/types';
import { DvidsSearchPanel } from './dvids/DvidsSearchPanel';
import { DvidsResultsGrid } from './dvids/DvidsResultsGrid';
import { DvidsDetailPanel } from './dvids/DvidsDetailPanel';

const DEFAULT_FILTERS: DvidsSearchFilters = {
  q: '', branch: '', category: '', aspectRatio: '', hd: false,
  fromDuration: '', toDuration: '', fromDate: '', toDate: '',
  sort: 'date', sortDir: 'desc', page: 1,
};

export function DvidsBrowser() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<DvidsSearchFilters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<'search' | 'imported'>('search');
  const [searchResults, setSearchResults] = useState<DvidsSearchResult[]>([]);
  const [importedAssets, setImportedAssets] = useState<DvidsImportedAsset[]>([]);
  const [totalSearch, setTotalSearch] = useState(0);
  const [totalImported, setTotalImported] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<DvidsSearchResult | DvidsImportedAsset | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [collections, setCollections] = useState<string[]>([]);

  const doSearch = useCallback(async (f?: DvidsSearchFilters) => {
    const ff = f ?? filters;
    if (!ff.q.trim()) return;
    setLoading(true);
    try {
      const data = await dvidsApi.search({
        q: ff.q, branch: ff.branch, category: ff.category, aspectRatio: ff.aspectRatio,
        hd: ff.hd || undefined, fromDuration: ff.fromDuration || undefined, toDuration: ff.toDuration || undefined,
        fromDate: ff.fromDate || undefined, toDate: ff.toDate || undefined,
        sort: ff.sort, sortDir: ff.sortDir, page: ff.page, maxResults: 24,
      });
      setSearchResults(data.results || []);
      setTotalSearch(data.pageInfo?.total ?? 0);
      setTab('search');
    } catch (err) {
      console.error('DVIDS search error:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadImported = useCallback(async (page = 1) => {
    try {
      const data = await dvidsApi.imported({ page, limit: 24 });
      setImportedAssets(data.assets || []);
      setTotalImported(data.total ?? 0);
      const colData = await dvidsApi.collections();
      setCollections(colData.collections || []);
    } catch (err) {
      console.error('Load imported error:', err);
    }
  }, []);

  const handleSearch = () => doSearch();

  const handleFiltersChange = (f: DvidsSearchFilters) => {
    setFilters(f);
  };

  const handleTabChange = (t: 'search' | 'imported') => {
    setTab(t);
    if (t === 'imported') loadImported();
  };

  const handleSelect = (item: DvidsSearchResult | DvidsImportedAsset) => {
    setSelectedItem(item);
  };

  const handleCheck = (id: string, checked: boolean) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleImport = async (dvidsId: string) => {
    setImporting(true);
    try {
      const data = await dvidsApi.download(dvidsId);
      if (data.ok) {
        setSelectedItem(data.asset);
        loadImported();
      }
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setImporting(false);
    }
  };

  const handleBulkImport = async () => {
    setBulkImporting(true);
    try {
      await dvidsApi.downloadBatch([...checkedIds], () => {});
      setCheckedIds(new Set());
      loadImported();
    } catch (err) {
      console.error('Bulk import error:', err);
    } finally {
      setBulkImporting(false);
    }
  };

  const handleFavorite = async (id: number, fav: boolean) => {
    await dvidsApi.updateImported(id, { is_favorite: fav });
    loadImported();
    if (selectedItem && 'id' in selectedItem && (selectedItem as any).id === id) {
      const data = await dvidsApi.importedById(id);
      setSelectedItem(data.asset);
    }
  };

  const handleUpdateTags = async (id: number, tags: string[]) => {
    await dvidsApi.updateImported(id, { tags });
    loadImported();
    const data = await dvidsApi.importedById(id);
    setSelectedItem(data.asset);
  };

  const handleUpdateCollection = async (id: number, collection: string) => {
    await dvidsApi.updateImported(id, { collection });
    loadImported();
  };

  const handleAutoTag = async (id: number) => {
    await dvidsApi.autoTag(id);
    loadImported();
    const data = await dvidsApi.importedById(id);
    setSelectedItem(data.asset);
  };

  const handleDelete = async (id: number) => {
    await dvidsApi.deleteImported(id);
    setSelectedItem(null);
    loadImported();
  };

  const handlePageChange = (p: number) => {
    if (tab === 'search') {
      const f = { ...filters, page: p };
      setFilters(f);
      doSearch(f);
    } else {
      loadImported(p);
    }
  };

  const isImported = tab === 'imported' || (selectedItem && 'imported_at' in selectedItem);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-c-border">
        <Shield className="w-5 h-5 text-cyan-400" />
        <div>
          <h1 className="text-sm font-semibold text-c-text">{t('dvids.title')}</h1>
          <p className="text-[10px] text-c-dim">{t('dvids.subtitle')}</p>
        </div>
      </div>

      {/* 3-Panel Layout */}
      <div className="flex flex-1 overflow-hidden">
        <DvidsSearchPanel
          filters={filters}
          onChange={handleFiltersChange}
          onSearch={handleSearch}
          importedCount={totalImported}
        />

        <DvidsResultsGrid
          tab={tab}
          onTabChange={handleTabChange}
          searchResults={searchResults}
          importedAssets={importedAssets}
          totalSearch={totalSearch}
          totalImported={totalImported}
          page={filters.page}
          onPageChange={handlePageChange}
          selectedId={selectedItem ? ('dvids_id' in selectedItem ? (selectedItem as any).id : (selectedItem as any).id) : null}
          onSelect={handleSelect}
          checkedIds={checkedIds}
          onCheck={handleCheck}
          onBulkImport={handleBulkImport}
          loading={loading}
          bulkImporting={bulkImporting}
        />

        {selectedItem && (
          <DvidsDetailPanel
            item={selectedItem}
            isImported={!!isImported}
            onClose={() => setSelectedItem(null)}
            onImport={handleImport}
            onFavorite={handleFavorite}
            onUpdateTags={handleUpdateTags}
            onUpdateCollection={handleUpdateCollection}
            onAutoTag={handleAutoTag}
            onDelete={handleDelete}
            importing={importing}
            collections={collections}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

In `apps/web/src/App.tsx`, add import after line 22:

```typescript
import { DvidsBrowser } from './pages/DvidsBrowser';
```

Add route after the transform route (line 56):

```tsx
<Route path="/dvids" element={<DvidsBrowser />} />
```

- [ ] **Step 3: Add sidebar nav item**

In `apps/web/src/components/layout/Sidebar.tsx`, add `Shield` to the lucide-react import (line 3-24):

```typescript
import { ..., Shield } from 'lucide-react';
```

Add nav item in `DEFAULT_NAV_ITEMS` array, after the transform entry (line 58):

```typescript
{ path: '/dvids', icon: Shield, label: t('nav.dvids') },
```

- [ ] **Step 4: Verify the page renders**

Run: `npm run dev --workspace=apps/web`
Navigate to `http://localhost:5174/dvids`
Expected: Page renders with 3-panel layout, sidebar shows DVIDS link.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/DvidsBrowser.tsx apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(dvids): add DvidsBrowser page with routing and sidebar nav"
```

---

## Task 13: Storyboard ImagesStep — DVIDS Tab

**Files:**
- Modify: `apps/web/src/pages/storyboard/components/ImagesStep.tsx`
- Modify: `apps/web/src/pages/storyboard/Storyboard.tsx`

- [ ] **Step 1: Add DVIDS button to media type selector in ImagesStep.tsx**

Find the media type toggle (around line 177-209). After the Pexels button, add:

```tsx
<button
  onClick={() => { setMediaType('dvids'); }}
  className={clsx(
    'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
    mediaType === 'dvids' ? 'bg-blue-600/20 text-blue-400' : 'text-c-muted hover:text-c-text',
  )}
>
  <Shield className="w-3.5 h-3.5" /> {t('storyboard.mediaTypeDvids')}
</button>
```

Add `Shield` to the lucide-react import at the top.

- [ ] **Step 2: Add DVIDS content section in ImagesStep.tsx**

After the Pexels content block (around line 238+), add:

```tsx
{mediaType === 'dvids' ? (
  <div className="space-y-3">
    <div className="border border-blue-800/30 rounded-xl p-4 bg-blue-900/10 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-medium text-blue-300">{t('storyboard.mediaTypeDvids')}</span>
      </div>
      <p className="text-[10px] text-c-dim">{t('storyboard.dvidsDesc')}</p>
      <div className="flex items-center gap-2">
        <button
          onClick={handleDvidsBatch}
          disabled={dvidsLoading || !prompts.length}
          className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
        >
          {dvidsLoading ? <Spinner size="sm" /> : <Shield className="w-3.5 h-3.5" />}
          {t('storyboard.dvidsFetch')}
        </button>
        {dvidsLoading && (
          <button
            onClick={cancelDvids}
            className="text-xs py-2 px-4 rounded-lg font-medium flex items-center gap-1.5 bg-red-600/20 text-red-400 hover:bg-red-600/30"
          >
            {t('storyboard.dvidsStop')}
          </button>
        )}
      </div>
      {dvidsProgress.length > 0 && (
        <div className="max-h-32 overflow-y-auto space-y-0.5 text-[10px] font-mono">
          {dvidsProgress.slice(-10).map((msg, i) => (
            <div key={i} className={msg.includes('Error') || msg.includes('Failed') ? 'text-red-400' : msg.includes('Done') ? 'text-green-400' : 'text-c-dim'}>
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
) : null}
```

- [ ] **Step 3: Add DVIDS batch handler in Storyboard.tsx**

In `Storyboard.tsx`, add state variables (near the pexels state):

```typescript
const [dvidsLoading, setDvidsLoading] = useState(false);
const [dvidsProgress, setDvidsProgress] = useState<string[]>([]);
const dvidsAbortRef = useRef<AbortController | null>(null);
```

Add handler function (near `handlePexelsBatch`):

```typescript
const handleDvidsBatch = async () => {
  if (!prompts.length) return;
  setDvidsLoading(true);
  setDvidsProgress([]);
  const abortCtrl = new AbortController();
  dvidsAbortRef.current = abortCtrl;

  try {
    const queries = prompts.map((p: any) => ({
      timestamp: p.timestamp ?? p.start ?? '0',
      query: (p.text || p.prompt || '').replace(/\[.*?\]/g, '').trim(),
      side: p.side,
    }));

    const videos = await storyboardApi.dvidsBatch(
      queries,
      (step: string, detail?: string) => {
        setDvidsProgress(prev => [...prev, detail || step]);
      },
      abortCtrl.signal,
    );

    // Map results to generatedImages
    const updated = [...generatedImages];
    for (const v of videos) {
      const idx = prompts.findIndex((p: any) => String(p.timestamp ?? p.start) === String(v.timestamp));
      if (idx >= 0) {
        updated[idx] = {
          filename: v.filename,
          url: v.url,
          mediaType: 'video',
          videoFilename: v.filename,
          status: 'done',
          side: v.side,
        };
      }
    }
    setGeneratedImages(updated);
    setDvidsProgress(prev => [...prev, 'Done!']);
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      setDvidsProgress(prev => [...prev, `Error: ${err.message}`]);
    }
  } finally {
    setDvidsLoading(false);
    dvidsAbortRef.current = null;
  }
};

const cancelDvids = () => {
  dvidsAbortRef.current?.abort();
  setDvidsLoading(false);
};
```

Pass these to the context/ImagesStep: `dvidsLoading`, `dvidsProgress`, `handleDvidsBatch`, `cancelDvids`.

- [ ] **Step 4: Verify the DVIDS tab appears in Storyboard**

Run dev server, open a storyboard project, go to Images step.
Expected: 4th tab "DVIDS Military" appears with blue styling.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/storyboard/components/ImagesStep.tsx apps/web/src/pages/storyboard/Storyboard.tsx
git commit -m "feat(dvids): add DVIDS tab to Storyboard ImagesStep with batch handler"
```

---

## Task 14: Script Studio — DVIDS Stock Source

**Files:**
- Modify: `apps/web/src/pages/script-studio/ScriptDoc.tsx`

- [ ] **Step 1: Add 'dvids' to the stock service picker**

Find the service tabs array (around line 2170) that maps over `['pexels', 'pixabay', 'mixkit', 'images']`. Add `'dvids'`:

```tsx
{(['pexels', 'pixabay', 'mixkit', 'dvids', 'images'] as const).map((svc) => (
```

Add color for dvids in the className conditional:

```tsx
: svc === 'dvids' ? 'bg-blue-600 text-white'
```

Add label for dvids:

```tsx
{svc === 'images' ? 'Image' : svc === 'dvids' ? 'DVIDS' : svc.charAt(0).toUpperCase() + svc.slice(1)}
```

- [ ] **Step 2: Handle dvids in apply handler**

Find the handler that applies a stock video (around lines 775-799). Add a case for dvids:

```typescript
} else if (service === 'dvids') {
  const resp = await fetch(`/api/script-studio/docs/${docId}/blocks/${bIdx}/apply-dvids-id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dvidsId: candidate.id }),
  });
  data = await resp.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/script-studio/ScriptDoc.tsx
git commit -m "feat(dvids): add DVIDS as stock source in Script Studio review step"
```

---

## Task 15: Settings Page — DVIDS API Key

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx`

- [ ] **Step 1: Add DVIDS API key section**

Find the settings sections (near line 400 where other API keys are). Add a DVIDS section following the same pattern:

```tsx
{/* DVIDS */}
<div className="space-y-2">
  <h3 className="text-sm font-medium text-c-text">{t('settings.dvidsTitle')}</h3>
  <p className="text-[10px] text-c-dim">{t('settings.dvidsDesc')}</p>
  <label className="text-xs text-c-muted mb-1 block">{t('settings.dvidsApiKey')}</label>
  <div className="relative">
    <input
      type={showKeys['dvids_api_key'] ? 'text' : 'password'}
      className="input pr-10 font-mono text-sm"
      placeholder="key-..."
      value={form['dvids_api_key'] ?? ''}
      onChange={(e) => set('dvids_api_key', e.target.value)}
    />
    <button
      type="button"
      onClick={() => setShowKeys((s) => ({ ...s, dvids_api_key: !s['dvids_api_key'] }))}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-c-dim hover:text-c-text"
    >
      {showKeys['dvids_api_key'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
    </button>
  </div>
  <p className="text-[9px] text-c-dim">{t('dvids.apiKeyOptional')}</p>
  <div className="flex items-center gap-3">
    <button onClick={() => testService('dvids')} disabled={testingService === 'dvids'} className="btn-secondary flex items-center gap-2 text-sm">
      {testingService === 'dvids' ? <Spinner size="sm" /> : <Zap className="w-3.5 h-3.5" />}
      {testingService === 'dvids' ? t('settings.testing') : t('settings.testDvids')}
    </button>
    {testResults['dvids'] !== undefined && (
      <div className="flex items-center gap-1.5">
        {testResults['dvids'] ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
        <span className={testResults['dvids'] ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>
          {testResults['dvids'] ? t('dvids.connectionOk') : t('dvids.connectionFailed')}
        </span>
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 2: Add DVIDS test handler**

Find the `testService` function. Add a case for dvids:

```typescript
case 'dvids': {
  const res = await fetch('/api/dvids/search?q=military&maxResults=1');
  const data = await res.json();
  return res.ok && data.results?.length >= 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/Settings.tsx
git commit -m "feat(dvids): add DVIDS API key configuration to Settings page"
```

---

## Task 16: End-to-End Verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Both server and web start without errors.

- [ ] **Step 2: Verify DVIDS browser page**

Navigate to `http://localhost:5174/dvids`
- Sidebar shows "DVIDS Military" link
- Page renders with 3-panel layout
- Search for "C-17" → results appear in grid
- Click a result → detail panel opens on right
- Smart suggestions appear in left panel

- [ ] **Step 3: Verify Storyboard integration**

Open a storyboard project → Images step → "DVIDS Military" tab visible
- (Cannot fully test without prompts, but verify tab renders)

- [ ] **Step 4: Verify Script Studio integration**

Open a script doc → Review step → stock picker shows "DVIDS" option

- [ ] **Step 5: Verify Settings**

Navigate to Settings → DVIDS section shows API key input + test button

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(dvids): complete DVIDS military footage integration"
```
