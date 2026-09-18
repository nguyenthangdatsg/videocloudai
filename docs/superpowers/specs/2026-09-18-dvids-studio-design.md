# DVIDS Studio — Design Spec

**Date:** 2026-09-18
**Status:** Approved

## Overview

DVIDS Studio is a fully separate video production feature that mirrors Script Studio's 4-step workflow (Structure → Review → Produce → Result) but uses DVIDS military videos as the primary stock media source instead of Pexels.

## Architecture: Parameterized Shared Core

Rather than duplicating ~10,000 lines of service/component code, DVIDS Studio reuses Script Studio's core logic by parameterizing it with a table configuration object. The feature gets its own:

- **DB tables** (separate data)
- **API routes** (separate endpoints)
- **Frontend pages** (separate URL/identity)
- **Sidebar entry** (separate navigation)

But shares:
- Markdown parser, block management, sync logic
- TTS, Whisper, subtitle, motion effects
- Video producer pipeline
- Remotion renderer
- ScriptDoc editor component (via `studioMode` prop)

## Database

4 new tables mirroring `script_*` tables with `dvids_` prefix:

### `dvids_docs`
Same schema as `script_docs`:
```sql
CREATE TABLE IF NOT EXISTS dvids_docs (
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
);
```

### `dvids_blocks`
Same schema as `script_blocks` but `visual_type` defaults to `'dvids'`:
```sql
CREATE TABLE IF NOT EXISTS dvids_blocks (
  ...same columns as script_blocks...
  visual_type TEXT NOT NULL DEFAULT 'dvids',
  ...
);
```

### `dvids_doc_logs`
Same schema as `script_doc_logs`, references `dvids_docs(id)`.

### `dvids_checkpoints`
Same schema as `production_checkpoints`, references `dvids_docs(id)`.

## Backend

### Table Config Pattern

Refactor `script-studio.service.ts` to accept a table name configuration:

```typescript
export interface StudioTableConfig {
  docs: string;        // 'script_docs' | 'dvids_docs'
  blocks: string;      // 'script_blocks' | 'dvids_blocks'
  logs: string;        // 'script_doc_logs' | 'dvids_doc_logs'
  checkpoints: string; // 'production_checkpoints' | 'dvids_checkpoints'
  defaultVisualType: string; // 'pexels' | 'dvids'
}

export const SCRIPT_STUDIO_TABLES: StudioTableConfig = {
  docs: 'script_docs', blocks: 'script_blocks',
  logs: 'script_doc_logs', checkpoints: 'production_checkpoints',
  defaultVisualType: 'pexels',
};

export const DVIDS_STUDIO_TABLES: StudioTableConfig = {
  docs: 'dvids_docs', blocks: 'dvids_blocks',
  logs: 'dvids_doc_logs', checkpoints: 'dvids_checkpoints',
  defaultVisualType: 'dvids',
};
```

All DB-touching functions (createDoc, getDoc, listDocs, listBlocks, updateBlockVisual, etc.) gain an optional `tables?: StudioTableConfig` parameter defaulting to `SCRIPT_STUDIO_TABLES` for backward compatibility.

### New Files

**`apps/server/src/routes/dvids-studio.routes.ts`**
- Mirrors `script-studio.routes.ts` endpoints at `/api/dvids-studio/*`
- All route handlers call the same service functions but pass `DVIDS_STUDIO_TABLES`
- Stock fetch defaults: `fetch-dvids` instead of `fetch-pexels` for auto-fetch
- Alternatives endpoint defaults to `service: 'dvids'`
- Registered in `app.ts` as `app.use('/api/dvids-studio', createDvidsStudioRouter())`

### Endpoints (mirrors `/api/script-studio/`)

All endpoints under `/api/dvids-studio/`:
- `GET/POST /docs` — list/create
- `GET/PUT/DELETE /docs/:id` — CRUD
- `PATCH /docs/:id/status`
- `GET /docs/:id/narration`, `GET /docs/:id/logs`
- `GET/PATCH /docs/:id/blocks/:i`
- `POST .../sync-blocks`, `POST .../split-block|split-at|merge-next|breakdown|insert-before|delete`
- `POST .../fetch-dvids` (auto-fetch, default), `POST .../fetch-pexels` (also available)
- `POST .../apply-dvids-id|apply-pexels-id|apply-stock-image|generate-ai|paste-image`
- `GET .../alternatives` (defaults to `service=dvids`)
- `POST .../tts`, `POST .../tts-all`
- `POST /docs/:id/produce`, `GET .../produce/status`, `DELETE .../produce`
- `PUT .../subtitle-style|produce-options`

### Video Producer

`video-producer.service.ts` already resolves clips by filename from the doc render directory. No changes needed — the render directory for DVIDS Studio docs will be `renders/storyboard/doc_{id}/` (same pattern, since IDs are UUIDs and won't collide).

## Frontend

### New Files

**`apps/web/src/pages/dvids-studio/DvidsStudio.tsx`**
- Re-export of `DvidsStudioDashboard`

**`apps/web/src/pages/dvids-studio/DvidsStudioDashboard.tsx`**
- Clone of `ScriptStudioDashboard.tsx` with:
  - Uses `dvidsStudioApi` instead of `scriptStudioApi`
  - Navigates to `/dvids-studio/:id`
  - Cyan/military themed header with Shield icon
  - Query key: `dvids-studio-docs`
  - i18n keys: `dvidsStudio.*`

**`apps/web/src/pages/dvids-studio/DvidsDoc.tsx`**
- Wraps `ScriptDoc` component with DVIDS defaults:
  - `studioMode: 'dvids'` prop
  - Uses `dvidsStudioApi`
  - Route prefix: `/dvids-studio`

### ScriptDoc Changes

Add a `studioMode` prop to `ScriptDoc` (default: `'script'`):
- Controls which API module to use (`scriptStudioApi` vs `dvidsStudioApi`)
- Controls default stock source for fetch buttons and "Fetch All"
- Controls route prefix for navigation (`/script-studio` vs `/dvids-studio`)
- Controls query keys (`script-studio-*` vs `dvids-studio-*`)
- Controls branding (header icon, accent color)

### API Client

**`apps/web/src/lib/api.ts`**
- Add `dvidsStudioApi` object that mirrors `scriptStudioApi` but uses `/api/dvids-studio/` base path
- Extract shared method definitions into a factory function to avoid duplication:

```typescript
function createStudioApi(basePath: string) {
  return {
    list: () => api.get(`${basePath}/docs`).then(r => r.data.docs),
    create: (md: string) => api.post(`${basePath}/docs`, { markdown: md }).then(r => r.data),
    // ... all methods ...
  };
}

export const scriptStudioApi = createStudioApi('/script-studio');
export const dvidsStudioApi = createStudioApi('/dvids-studio');
```

### Routes

```
/dvids-studio      → DvidsStudioDashboard (list docs)
/dvids-studio/:id  → DvidsDoc (4-step editor)
```

### Sidebar

Add "DVIDS Studio" entry with Shield icon, positioned near Script Studio.

### i18n

Add `dvidsStudio.*` keys to `en.json` and `vi.json` mirroring `scriptStudio.*` keys but with DVIDS-specific labels (e.g., "DVIDS Studio", "DVIDS Military Video Production").

## What Changes vs What's New

### Modified Files
| File | Change |
|------|--------|
| `apps/server/src/services/script-studio.service.ts` | Add `StudioTableConfig` parameter to all DB functions |
| `apps/server/src/services/video-producer.service.ts` | Accept `StudioTableConfig` for production pipeline |
| `apps/server/src/app.ts` | Register DVIDS Studio routes |
| `apps/web/src/lib/api.ts` | Extract `createStudioApi()` factory, add `dvidsStudioApi` |
| `apps/web/src/pages/script-studio/ScriptDoc.tsx` | Accept `studioMode` prop for API/route/defaults |
| `apps/web/src/App.tsx` | Add DVIDS Studio routes |
| `apps/web/src/components/layout/Sidebar.tsx` | Add DVIDS Studio nav entry |
| `apps/web/src/i18n/locales/en.json` | Add `dvidsStudio.*` keys |
| `apps/web/src/i18n/locales/vi.json` | Add `dvidsStudio.*` keys |

### New Files
| File | Purpose |
|------|---------|
| `apps/server/src/routes/dvids-studio.routes.ts` | API routes for DVIDS Studio |
| `apps/web/src/pages/dvids-studio/DvidsStudio.tsx` | Dashboard re-export |
| `apps/web/src/pages/dvids-studio/DvidsStudioDashboard.tsx` | Document list page |
| `apps/web/src/pages/dvids-studio/DvidsDoc.tsx` | Doc editor wrapper |

## Out of Scope
- No new markdown block syntax (reuses `[PEXELS: query]` or can also use `[DVIDS: query]`)
- No DVIDS-specific filtering in the editor (branch/category) — uses the same query-based approach
- No changes to TTS, charts, subtitles, motion effects, or Remotion rendering
- No changes to the standalone DVIDS Browser page (`/dvids`)
