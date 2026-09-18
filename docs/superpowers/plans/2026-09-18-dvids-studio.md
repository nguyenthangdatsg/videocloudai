# DVIDS Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a fully separate "DVIDS Studio" feature mirroring Script Studio's 4-step video production workflow, using DVIDS military videos as the primary stock source.

**Architecture:** Parameterize Script Studio's shared core (service functions, routes, frontend API client, editor component) with a table/config object. DVIDS Studio gets its own DB tables, API routes, and frontend pages, but shares all logic via configuration rather than duplication.

**Tech Stack:** TypeScript, Express 5, SQLite (better-sqlite3), React 18, TanStack Query, Zustand, react-i18next, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-09-18-dvids-studio-design.md`

**No test suite configured** — validation is manual via UI/API.

---

## File Map

### New Files
| File | Purpose |
|------|---------|
| `apps/server/src/routes/dvids-studio.routes.ts` | Thin wrapper: creates router with DVIDS table config |
| `apps/web/src/pages/dvids-studio/DvidsStudio.tsx` | Re-export of dashboard |
| `apps/web/src/pages/dvids-studio/DvidsStudioDashboard.tsx` | Document list page (clone of ScriptStudioDashboard with DVIDS config) |
| `apps/web/src/pages/dvids-studio/DvidsDoc.tsx` | Editor wrapper passing DVIDS config to ScriptDoc |

### Modified Files
| File | Change |
|------|--------|
| `apps/server/src/services/script-studio.service.ts` | Add `StudioTableConfig`, `ensureDvidsStudioTables()`, parameterize 38 DB functions |
| `apps/server/src/routes/script-studio.routes.ts` | Extract router body into `createStudioRouter(tables, defaultStock)` factory |
| `apps/server/src/app.ts` | Import & register DVIDS Studio router |
| `apps/web/src/lib/api.ts` | Extract `createStudioApi(basePath)` factory, export `dvidsStudioApi` |
| `apps/web/src/pages/script-studio/ScriptDoc.tsx` | Accept `studioConfig` prop controlling API, routes, query keys, defaults |
| `apps/web/src/App.tsx` | Add `/dvids-studio` and `/dvids-studio/:id` routes |
| `apps/web/src/components/layout/Sidebar.tsx` | Add DVIDS Studio nav entry |
| `apps/web/src/i18n/locales/en.json` | Add `dvidsStudio.*` keys |
| `apps/web/src/i18n/locales/vi.json` | Add `dvidsStudio.*` keys |

---

### Task 1: Add StudioTableConfig and DVIDS tables to service

**Files:**
- Modify: `apps/server/src/services/script-studio.service.ts`

- [ ] **Step 1: Add StudioTableConfig interface and constants**

Near the top of the file (after the existing type exports around line 119), add:

```typescript
export interface StudioTableConfig {
  docs: string;
  blocks: string;
  logs: string;
  checkpoints: string;
  defaultVisualType: string;
}

export const SCRIPT_STUDIO_TABLES: StudioTableConfig = {
  docs: 'script_docs',
  blocks: 'script_blocks',
  logs: 'script_doc_logs',
  checkpoints: 'production_checkpoints',
  defaultVisualType: 'pexels',
};

export const DVIDS_STUDIO_TABLES: StudioTableConfig = {
  docs: 'dvids_docs',
  blocks: 'dvids_blocks',
  logs: 'dvids_doc_logs',
  checkpoints: 'dvids_checkpoints',
  defaultVisualType: 'dvids',
};
```

- [ ] **Step 2: Add ensureDvidsStudioTables function**

After the existing `ensureScriptStudioTables()` function (ends around line 391), add a new function that creates the DVIDS tables. This function mirrors `ensureScriptStudioTables` but uses `dvids_` prefixed table names and defaults `visual_type` to `'dvids'`:

```typescript
export function ensureDvidsStudioTables(): void {
  try {
    dbRun(`CREATE TABLE IF NOT EXISTS dvids_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      raw_markdown TEXT NOT NULL,
      parsed_json TEXT NOT NULL DEFAULT '{}',
      source_ref TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      linked_storyboard_id TEXT,
      warnings_count INTEGER NOT NULL DEFAULT 0,
      segments_count INTEGER NOT NULL DEFAULT 0,
      blocks_count INTEGER NOT NULL DEFAULT 0,
      words_count INTEGER NOT NULL DEFAULT 0,
      est_duration_seconds INTEGER NOT NULL DEFAULT 0,
      subtitle_style TEXT,
      produce_options TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_dvids_docs_status ON dvids_docs(status)`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_dvids_docs_updated ON dvids_docs(updated_at)`);

    dbRun(`CREATE TABLE IF NOT EXISTS dvids_doc_logs (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES dvids_docs(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      level TEXT NOT NULL DEFAULT 'info',
      operation TEXT NOT NULL,
      message TEXT NOT NULL
    )`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_dvids_doc_logs_doc ON dvids_doc_logs(doc_id)`);

    dbRun(`CREATE TABLE IF NOT EXISTS dvids_checkpoints (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      doc_id TEXT NOT NULL REFERENCES dvids_docs(id) ON DELETE CASCADE,
      checkpoint TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      edits_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_dvids_checkpoints_job ON dvids_checkpoints(job_id)`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_dvids_checkpoints_doc ON dvids_checkpoints(doc_id, checkpoint, created_at)`);

    dbRun(`CREATE TABLE IF NOT EXISTS dvids_blocks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES dvids_docs(id) ON DELETE CASCADE,
      block_index INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      segment_name TEXT NOT NULL,
      narration TEXT NOT NULL DEFAULT '',
      pexels_query TEXT,
      chart_spec_json TEXT,
      overlays_json TEXT NOT NULL DEFAULT '[]',
      overlay_style_json TEXT,
      content_hash TEXT,
      audio_path TEXT,
      audio_duration_ms INTEGER,
      audio_engine TEXT,
      words_json TEXT,
      visual_type TEXT NOT NULL DEFAULT 'dvids',
      clip_asset_path TEXT,
      clips_json TEXT,
      motion TEXT NOT NULL DEFAULT 'slow-zoom',
      pace_hint TEXT,
      scene_number INTEGER NOT NULL DEFAULT 0,
      voice_config TEXT,
      ai_prompt TEXT,
      ai_asset_path TEXT,
      ai_meta_json TEXT,
      clip_start_sec REAL,
      clip_end_sec REAL,
      display_number INTEGER,
      opening_text TEXT,
      rendered_clip_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_msg TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(doc_id, block_index)
    )`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_dvids_blocks_doc ON dvids_blocks(doc_id, block_index)`);
  } catch {
    // tables already exist
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/services/script-studio.service.ts
git commit -m "feat(dvids-studio): add StudioTableConfig and DVIDS tables schema"
```

---

### Task 2: Parameterize all DB functions in script-studio.service.ts

**Files:**
- Modify: `apps/server/src/services/script-studio.service.ts`

This is a mechanical refactor: every function that uses hardcoded table names gets an optional `tables: StudioTableConfig = SCRIPT_STUDIO_TABLES` parameter, and all SQL string literals replace the table name with `${tables.docs}`, `${tables.blocks}`, `${tables.logs}`, or `${tables.checkpoints}`.

- [ ] **Step 1: Parameterize checkpoint functions**

For these 4 functions, add `tables = SCRIPT_STUDIO_TABLES` as the last parameter and replace table name strings:

**`saveCheckpoint` (line 408):**
```typescript
export function saveCheckpoint(jobId: string, docId: string, checkpoint: CheckpointName, state: Record<string, unknown>, tables = SCRIPT_STUDIO_TABLES): void {
```
Replace all `production_checkpoints` → `${tables.checkpoints}` in the function body.

**`loadCheckpoint` (line 428):**
```typescript
export function loadCheckpoint(jobId: string, tables = SCRIPT_STUDIO_TABLES): ProductionCheckpoint | null {
```
Replace `production_checkpoints` → `${tables.checkpoints}`.

**`loadLatestCheckpoint` (line 446):**
```typescript
export function loadLatestCheckpoint(docId: string, atOrBefore: CheckpointName, tables = SCRIPT_STUDIO_TABLES): ProductionCheckpoint | null {
```
Replace `production_checkpoints` → `${tables.checkpoints}`.

**`applyCheckpointEdits` (line 470):**
```typescript
export function applyCheckpointEdits(jobId: string, edits: Record<string, unknown>, tables = SCRIPT_STUDIO_TABLES): void {
```
Replace `production_checkpoints` → `${tables.checkpoints}`.

- [ ] **Step 2: Parameterize log and doc-meta functions**

**`addLog` (line 483):**
```typescript
export function addLog(docId: string, level: LogLevel, operation: LogOperation, message: string, tables = SCRIPT_STUDIO_TABLES): void {
```
Replace `script_doc_logs` → `${tables.logs}`.

**`updateDocMeta` (line ~490, private helper):** — If this is not exported, find where it's called and ensure it receives the tables config. Add `tables = SCRIPT_STUDIO_TABLES` parameter and replace `script_docs` → `${tables.docs}`.

**`getLogs` (line 1414):**
```typescript
export function getLogs(docId: string, limit = 200, tables = SCRIPT_STUDIO_TABLES) {
```
Replace `script_doc_logs` → `${tables.logs}`.

- [ ] **Step 3: Parameterize doc CRUD functions**

For each function, add `tables = SCRIPT_STUDIO_TABLES` as the last parameter. Replace `script_docs` → `${tables.docs}` and `script_blocks` → `${tables.blocks}` in all SQL queries within each function.

Functions to update (showing the new signature only — the body change is mechanical string replacement):

```typescript
export function createDoc(rawMarkdown: string, titleOverride?: string, sourceRef?: string, onLog?: LogCallback, tables = SCRIPT_STUDIO_TABLES)
export function updateDoc(id: string, rawMarkdown: string, titleOverride?: string, onLog?: LogCallback, tables = SCRIPT_STUDIO_TABLES)
export function getDoc(id: string, tables = SCRIPT_STUDIO_TABLES)
export function listDocs(tables = SCRIPT_STUDIO_TABLES)
export function deleteDoc(id: string, tables = SCRIPT_STUDIO_TABLES)
export function setDocStatus(id: string, status: DocStatus, tables = SCRIPT_STUDIO_TABLES)
export function linkStoryboard(id: string, storyboardId: string, tables = SCRIPT_STUDIO_TABLES)
export function markNarrationCopied(id: string, tables = SCRIPT_STUDIO_TABLES)
export function updateDocSubtitleStyle(id: string, style: any, tables = SCRIPT_STUDIO_TABLES)
export function updateDocProduceOptions(id: string, options: any, tables = SCRIPT_STUDIO_TABLES)
```

**Important:** `createDoc` and `updateDoc` call `syncBlocksFromParsed` and `addLog` internally — pass `tables` through to those calls. `createDoc` also does an INSERT into `${tables.docs}`. `updateDoc` also calls `updateDocMeta` — pass `tables` there too.

- [ ] **Step 4: Parameterize block functions**

Same pattern — add `tables = SCRIPT_STUDIO_TABLES` as last parameter, replace `script_blocks` → `${tables.blocks}` and `script_docs` → `${tables.docs}` where used:

```typescript
export function listBlocks(docId: string, tables = SCRIPT_STUDIO_TABLES)
export function getBlock(docId: string, blockIndex: number, tables = SCRIPT_STUDIO_TABLES)
export function updateBlockVisual(docId: string, blockIndex: number, fields: {...}, tables = SCRIPT_STUDIO_TABLES)
export function updateBlockClips(docId: string, blockIndex: number, clips: BlockClip[], tables = SCRIPT_STUDIO_TABLES)
export function updateBlockAudio(docId: string, blockIndex: number, fields: {...}, tables = SCRIPT_STUDIO_TABLES)
export function updateBlockClip(docId: string, blockIndex: number, clipAssetPath: string, visualType: string, tables = SCRIPT_STUDIO_TABLES)
export function updateBlockRendered(docId: string, blockIndex: number, renderedClipPath: string, tables = SCRIPT_STUDIO_TABLES)
export function updateBlockError(docId: string, blockIndex: number, errorMsg: string, tables = SCRIPT_STUDIO_TABLES)
export function updateBlockAi(docId: string, blockIndex: number, aiPrompt: string, aiAssetPath: string | null, aiMeta: Record<string, unknown> | null, tables = SCRIPT_STUDIO_TABLES)
```

- [ ] **Step 5: Parameterize block manipulation functions**

These functions touch both `script_blocks` and `script_docs` tables:

```typescript
export function splitBlock(docId: string, blockIndex: number, tables = SCRIPT_STUDIO_TABLES)
export function splitBlockAtText(docId: string, blockIndex: number, leftText: string, rightText: string, tables = SCRIPT_STUDIO_TABLES)
export function mergeBlockWithNext(docId: string, blockIndex: number, tables = SCRIPT_STUDIO_TABLES)
export function deleteBlock(docId: string, blockIndex: number, tables = SCRIPT_STUDIO_TABLES)
export function insertBlockBefore(docId: string, blockIndex: number, tables = SCRIPT_STUDIO_TABLES)
export function breakdownBlock(docId: string, blockIndex: number, tables = SCRIPT_STUDIO_TABLES)
export function syncBlocksFromParsed(docId: string, parsed: ParsedScript, tables = SCRIPT_STUDIO_TABLES)
```

These functions also call internal helpers (`updateMarkdownForSplitAt`, `mergeSceneInMarkdown`, `deleteSceneInMarkdown`, `insertSceneInMarkdown`, `updateMarkdownForBreakdown`) that reference `script_docs`. Either:
- Make those helpers accept `tables` too, OR
- They only do `UPDATE script_docs SET raw_markdown = ...` — replace with `UPDATE ${tables.docs} SET raw_markdown = ...`

Also, `syncBlocksFromParsed` references `${tables.blocks}` for SELECT/INSERT/UPDATE/DELETE of blocks and `${tables.docs}` for the doc update. It also uses `tables.defaultVisualType` where `'pexels'` is currently hardcoded as the default visual type for new blocks.

- [ ] **Step 6: Update deleteDocProduceJob and getJobStatus**

```typescript
export function deleteDocProduceJob(docId: string, tables = SCRIPT_STUDIO_TABLES)
```
This function references `script_docs` — replace with `${tables.docs}`.

```typescript
export function getJobStatus(jobId: string): string | null
```
This one queries the `jobs` table (shared, not studio-specific) — no change needed.

- [ ] **Step 7: Verify backward compatibility**

All existing callers (in `script-studio.routes.ts` and `video-producer.service.ts`) call these functions WITHOUT the `tables` parameter, so they default to `SCRIPT_STUDIO_TABLES`. Nothing breaks.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/script-studio.service.ts
git commit -m "refactor(script-studio): parameterize all DB functions with StudioTableConfig"
```

---

### Task 3: Extract router factory from script-studio.routes.ts

**Files:**
- Modify: `apps/server/src/routes/script-studio.routes.ts`

- [ ] **Step 1: Add StudioTableConfig import and convert to factory**

Add `StudioTableConfig` and `SCRIPT_STUDIO_TABLES` to the imports from `../services/script-studio.service`:

```typescript
import {
  // ...existing imports...
  type StudioTableConfig,
  SCRIPT_STUDIO_TABLES,
} from '../services/script-studio.service';
```

Rename the existing `createScriptStudioRouter()` to accept a tables config:

```typescript
export function createStudioRouter(tables: StudioTableConfig = SCRIPT_STUDIO_TABLES): Router {
```

- [ ] **Step 2: Pass tables to all service calls**

Throughout the router body, every call to a service function now passes `tables` as the last argument. For example:

```typescript
// Before:
const doc = getDoc(id);
// After:
const doc = getDoc(id, tables);

// Before:
const blocks = listBlocks(docId);
// After:
const blocks = listBlocks(docId, tables);
```

This is mechanical — find every call to a parameterized service function and add `, tables` at the end.

- [ ] **Step 3: Keep the existing export as a wrapper**

At the bottom of the file, keep backward compatibility:

```typescript
export function createScriptStudioRouter(): Router {
  return createStudioRouter(SCRIPT_STUDIO_TABLES);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/script-studio.routes.ts
git commit -m "refactor(script-studio): extract createStudioRouter factory with table config"
```

---

### Task 4: Create dvids-studio.routes.ts and register in app.ts

**Files:**
- Create: `apps/server/src/routes/dvids-studio.routes.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Create the DVIDS Studio routes file**

```typescript
import { Router } from 'express';
import { createStudioRouter } from './script-studio.routes';
import { DVIDS_STUDIO_TABLES, ensureDvidsStudioTables } from '../services/script-studio.service';

export function createDvidsStudioRouter(): Router {
  ensureDvidsStudioTables();
  return createStudioRouter(DVIDS_STUDIO_TABLES);
}
```

That's it — 6 lines. The factory does all the work.

- [ ] **Step 2: Register in app.ts**

Add import and registration in `apps/server/src/app.ts`:

```typescript
import { createDvidsStudioRouter } from './routes/dvids-studio.routes';
```

And in the route mounting section:

```typescript
app.use('/api/dvids-studio', createDvidsStudioRouter());
```

- [ ] **Step 3: Verify backend starts**

```bash
cd apps/server && npx tsx src/app.ts
```

Check for startup errors. The DVIDS tables should be created. Verify with:

```bash
curl -s http://localhost:3002/api/dvids-studio/docs | head -20
```

Expected: `{"docs":[]}` (empty list, no errors)

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/dvids-studio.routes.ts apps/server/src/app.ts
git commit -m "feat(dvids-studio): add DVIDS Studio API routes"
```

---

### Task 5: Extract createStudioApi factory in frontend api.ts

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Extract the factory function**

Replace the existing `scriptStudioApi` object (lines 1211-1496) with a factory function. The factory takes `basePath` (e.g., `/script-studio` or `/dvids-studio`) and returns the same object:

```typescript
function createStudioApi(basePath: string) {
  return {
    list: async () => {
      const res = await api.get(`${basePath}/docs`);
      return res.data.docs;
    },
    get: async (id: string) => {
      const res = await api.get(`${basePath}/docs/${id}`);
      return res.data;
    },
    create: async (rawMarkdown: string, title?: string) => {
      const res = await api.post(`${basePath}/docs`, { markdown: rawMarkdown, title });
      return res.data;
    },
    // ... ALL existing methods, replacing '/script-studio' with `${basePath}` ...
  };
}

export const scriptStudioApi = createStudioApi('/script-studio');
export const dvidsStudioApi = createStudioApi('/dvids-studio');
```

Every method in the existing `scriptStudioApi` that uses a URL like `/script-studio/docs/...` should use `${basePath}/docs/...` instead. The NDJSON streaming methods that use `fetch()` directly (like `ttsAll`, `exportUpscale`, `produce` progress) need the same URL substitution.

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep -i "api.ts"
```

Expected: no new errors from api.ts

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "refactor(api): extract createStudioApi factory, add dvidsStudioApi"
```

---

### Task 6: Parameterize ScriptDoc with studioConfig prop

**Files:**
- Modify: `apps/web/src/pages/script-studio/ScriptDoc.tsx`

- [ ] **Step 1: Define StudioConfig interface and accept it as prop**

At the top of the file, add:

```typescript
import { scriptStudioApi, dvidsStudioApi } from '../../lib/api';

export interface StudioConfig {
  api: typeof scriptStudioApi;
  queryKeyPrefix: string;     // 'script-studio' or 'dvids-studio'
  routePrefix: string;        // '/script-studio' or '/dvids-studio'
  defaultStockSource: 'pexels' | 'pixabay' | 'dvids';
  accentColor: string;        // 'cyan' for DVIDS, default for Script Studio
}

export const SCRIPT_STUDIO_CONFIG: StudioConfig = {
  api: scriptStudioApi,
  queryKeyPrefix: 'script-studio',
  routePrefix: '/script-studio',
  defaultStockSource: 'pexels',
  accentColor: 'accent',
};

export const DVIDS_STUDIO_CONFIG: StudioConfig = {
  api: dvidsStudioApi,
  queryKeyPrefix: 'dvids-studio',
  routePrefix: '/dvids-studio',
  defaultStockSource: 'dvids',
  accentColor: 'cyan',
};
```

Change the default export to accept an optional config:

```typescript
export default function ScriptDoc({ studioConfig = SCRIPT_STUDIO_CONFIG }: { studioConfig?: StudioConfig } = {}) {
```

- [ ] **Step 2: Replace scriptStudioApi references**

Create a local alias at the top of the component:

```typescript
const studioApi = studioConfig.api;
```

Then find-and-replace all `scriptStudioApi.` with `studioApi.` throughout the component (~80+ occurrences). This is mechanical.

- [ ] **Step 3: Replace query key strings**

Replace all hardcoded query key prefixes:

```typescript
// Before:
queryKey: ['script-studio-doc', id]
// After:
queryKey: [`${studioConfig.queryKeyPrefix}-doc`, id]

// Before:
queryKey: ['script-studio-blocks', id]
// After:
queryKey: [`${studioConfig.queryKeyPrefix}-blocks`, id]

// Before:
queryKey: ['script-studio-produce-status', id]
// After:
queryKey: [`${studioConfig.queryKeyPrefix}-produce-status`, id]

// Before:
queryKey: ['script-studio-logs', id]
// After:
queryKey: [`${studioConfig.queryKeyPrefix}-logs`, id]
```

Also update all `invalidateQueries` calls that use these keys.

- [ ] **Step 4: Replace route navigation**

```typescript
// Before:
navigate('/script-studio')
// After:
navigate(studioConfig.routePrefix)
```

- [ ] **Step 5: Update default stock source**

The `fetchAllSource` state should default to `studioConfig.defaultStockSource`:

```typescript
// Before:
const [fetchAllSource, setFetchAllSource] = useState<'pexels' | 'pixabay' | 'dvids'>('pexels');
// After:
const [fetchAllSource, setFetchAllSource] = useState<'pexels' | 'pixabay' | 'dvids'>(studioConfig.defaultStockSource);
```

- [ ] **Step 6: Pass studioConfig to inner BlockRow component**

The `BlockRow` inner component (which calls `fetchStock`, `fetchPexels`, etc.) needs access to the `studioApi`. Since it's defined inside `ScriptDoc`, it already has closure access to `studioApi`. Verify this works — if `BlockRow` is a separate function component receiving props, pass `studioApi` as a prop.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/script-studio/ScriptDoc.tsx
git commit -m "refactor(script-doc): parameterize with StudioConfig for multi-studio support"
```

---

### Task 7: Create DVIDS Studio frontend pages

**Files:**
- Create: `apps/web/src/pages/dvids-studio/DvidsStudio.tsx`
- Create: `apps/web/src/pages/dvids-studio/DvidsDoc.tsx`
- Create: `apps/web/src/pages/dvids-studio/DvidsStudioDashboard.tsx`

- [ ] **Step 1: Create DvidsDoc.tsx**

```typescript
import ScriptDoc, { DVIDS_STUDIO_CONFIG } from '../script-studio/ScriptDoc';

export default function DvidsDoc() {
  return <ScriptDoc studioConfig={DVIDS_STUDIO_CONFIG} />;
}
```

- [ ] **Step 2: Create DvidsStudioDashboard.tsx**

Clone `ScriptStudioDashboard.tsx` with these changes:
- Import `dvidsStudioApi` instead of `scriptStudioApi`
- Replace `scriptStudioApi` calls with `dvidsStudioApi`
- Replace navigate target from `/script-studio/${id}` to `/dvids-studio/${id}`
- Replace query key from `script-studio-docs` to `dvids-studio-docs`
- Replace i18n keys from `scriptStudio.*` to `dvidsStudio.*`
- Replace header icon from `BookOpen` to `Shield` (from lucide-react)
- Keep all the same functionality (paste modal, file upload, status menu, filters, table)

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileText, AlertTriangle, Shield, Search, MoreVertical, X, Clock, Hash, Type, Layers,
} from 'lucide-react';
import { dvidsStudioApi } from '../../lib/api';
import { useAppStore } from '../../store';
import { FormatGuide } from '../script-studio/FormatGuide';

// ... same component structure as ScriptStudioDashboard but with:
// - dvidsStudioApi instead of scriptStudioApi
// - '/dvids-studio/${id}' navigation
// - 'dvids-studio-docs' query key
// - t('dvidsStudio.*') i18n keys
// - Shield icon in header
// - Cyan accent where appropriate
```

The dashboard is ~410 lines. Copy the full `ScriptStudioDashboard.tsx` and make these substitutions:
1. `scriptStudioApi` → `dvidsStudioApi` (all occurrences)
2. `'/script-studio/${` → `'/dvids-studio/${` (navigation)
3. `'script-studio-docs'` → `'dvids-studio-docs'` (query key)
4. `t('scriptStudio.` → `t('dvidsStudio.` (all i18n keys)
5. `BookOpen` → `Shield` (header icon import and usage)
6. `navigate('/storyboard')` → remove or change to `navigate('/dvids')` (the "Storyboard" shortcut button)
7. Export name: `DvidsStudioDashboard`

- [ ] **Step 3: Create DvidsStudio.tsx re-export**

```typescript
export { DvidsStudioDashboard as DvidsStudio } from './DvidsStudioDashboard';
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/dvids-studio/
git commit -m "feat(dvids-studio): add DVIDS Studio dashboard and doc editor pages"
```

---

### Task 8: Add routes, sidebar entry, and i18n keys

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/i18n/locales/en.json`
- Modify: `apps/web/src/i18n/locales/vi.json`

- [ ] **Step 1: Add routes to App.tsx**

Add imports:

```typescript
import { DvidsStudio } from './pages/dvids-studio/DvidsStudio';
import DvidsDoc from './pages/dvids-studio/DvidsDoc';
```

Add routes alongside existing Script Studio routes:

```typescript
<Route path="/dvids-studio" element={<DvidsStudio />} />
<Route path="/dvids-studio/:id" element={<DvidsDoc />} />
```

- [ ] **Step 2: Add sidebar entry**

In `apps/web/src/components/layout/Sidebar.tsx`, find the nav items array (around line 58). Add DVIDS Studio entry near Script Studio:

```typescript
{ path: '/dvids-studio', icon: Shield, label: t('nav.dvidsStudio') },
```

Import `Shield` from lucide-react if not already imported.

- [ ] **Step 3: Add i18n keys to en.json**

Add nav key:
```json
"dvidsStudio": "DVIDS Studio"
```
inside the `"nav"` section.

Add `"dvidsStudio"` section mirroring `"scriptStudio"` with DVIDS-specific labels:

```json
"dvidsStudio": {
  "title": "DVIDS Studio",
  "subtitle": "Military Video Production",
  "pasteMarkdown": "Paste Markdown",
  "uploadMd": "Upload .md",
  "formatGuide": "Format Guide",
  "parseAndSave": "Parse & Save",
  "cancel": "Cancel",
  "chars": "chars",
  "lines": "lines",
  "pasteHere": "Paste your markdown script here...",
  "searchPlaceholder": "Search documents...",
  "allStatuses": "All Statuses",
  "emptyLibrary": "No DVIDS Studio documents yet",
  "colTitle": "Title",
  "colStatus": "Status",
  "colSegments": "Segments",
  "colBlocks": "Blocks",
  "colWords": "Words",
  "colDuration": "Duration",
  "colWarnings": "Warnings",
  "colStoryboard": "Storyboard",
  "colUpdated": "Updated",
  "deleted": "Document deleted",
  "deleteDoc": "Delete Document",
  "summaryStrip": "{{total}} docs · {{ready}} ready · {{published}} published · {{duration}}",
  "status": {
    "draft": "Draft",
    "parsed": "Parsed",
    "narration_copied": "Narration Copied",
    "aligned": "Aligned",
    "producing": "Producing",
    "ready": "Ready",
    "published": "Published"
  }
}
```

- [ ] **Step 4: Add i18n keys to vi.json**

Same structure with Vietnamese translations:

```json
"dvidsStudio": "DVIDS Studio"
```
in nav section, and:

```json
"dvidsStudio": {
  "title": "DVIDS Studio",
  "subtitle": "Sản xuất Video Quân sự",
  "pasteMarkdown": "Dán Markdown",
  "uploadMd": "Tải lên .md",
  "formatGuide": "Hướng dẫn định dạng",
  "parseAndSave": "Phân tích & Lưu",
  "cancel": "Hủy",
  "chars": "ký tự",
  "lines": "dòng",
  "pasteHere": "Dán kịch bản markdown tại đây...",
  "searchPlaceholder": "Tìm kiếm tài liệu...",
  "allStatuses": "Tất cả trạng thái",
  "emptyLibrary": "Chưa có tài liệu DVIDS Studio",
  "colTitle": "Tiêu đề",
  "colStatus": "Trạng thái",
  "colSegments": "Đoạn",
  "colBlocks": "Khối",
  "colWords": "Từ",
  "colDuration": "Thời lượng",
  "colWarnings": "Cảnh báo",
  "colStoryboard": "Storyboard",
  "colUpdated": "Cập nhật",
  "deleted": "Đã xóa tài liệu",
  "deleteDoc": "Xóa tài liệu",
  "summaryStrip": "{{total}} tài liệu · {{ready}} sẵn sàng · {{published}} đã xuất bản · {{duration}}",
  "status": {
    "draft": "Nháp",
    "parsed": "Đã phân tích",
    "narration_copied": "Đã sao chép",
    "aligned": "Đã căn chỉnh",
    "producing": "Đang sản xuất",
    "ready": "Sẵn sàng",
    "published": "Đã xuất bản"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/vi.json
git commit -m "feat(dvids-studio): add routes, sidebar entry, and i18n translations"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Start dev servers**

```bash
npm run dev
```

- [ ] **Step 2: Verify backend API**

```bash
# List DVIDS Studio docs (should be empty)
curl -s http://localhost:3002/api/dvids-studio/docs

# Verify Script Studio still works
curl -s http://localhost:3002/api/script-studio/docs
```

- [ ] **Step 3: Verify frontend pages**

Open browser:
1. `http://localhost:5174/dvids-studio` — should show empty dashboard with Shield icon
2. Sidebar should have "DVIDS Studio" entry
3. Paste a markdown script → should create doc and navigate to `/dvids-studio/:id`
4. In the editor, the "Fetch All" dropdown should default to "DVIDS"
5. Per-block fetch buttons should include "DVIDS"
6. Verify Script Studio (`/script-studio`) still works independently

- [ ] **Step 4: Test DVIDS fetch in editor**

1. Create a DVIDS Studio doc with a script about military aircraft
2. Go to Review step
3. Click "DVIDS" fetch button on a block
4. Verify it searches DVIDS and downloads a clip
5. Verify the clip appears in the block preview

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(dvids-studio): address issues found during e2e testing"
```
