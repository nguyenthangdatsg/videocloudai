# DVIDS Military Footage Integration — Design Spec

**Date:** 2026-09-17
**Status:** Approved
**Approach:** B — Enhanced Military Library + Inline Integration

## Goal

Integrate public domain U.S. military footage from DVIDS (Defense Visual Information Distribution Service) into VideoCloudAI. Users can search, preview, download, and use high-quality DoD B-roll directly inside the Storyboard pipeline, Script Studio, and a dedicated browser page.

Critical for military aviation / "caught on camera" style channels that rely on real DoD footage (C-17, C-130, F-35, carriers, paratroopers, training exercises).

---

## 1. Backend Service (`apps/server/src/services/dvids.service.ts`)

### DVIDS API

- **Base URL:** `https://api.dvidshub.net`
- **Search:** `GET /search` — type=video, filters for branch/category/aspect_ratio/date/duration/HD/sort
- **Asset:** `GET /asset` — id=video:<numericId>, returns full metadata + `files[]` array with MP4 URLs
- **Auth:** `?api_key=<key>` query param. Optional — works without key but lower rate limits.
- **Pagination:** `page` + `max_results` (max 50), ceiling at page*max_results=1000

### Service Methods

```typescript
// Search DVIDS videos with filters
searchDvids(query: string, opts?: {
  branch?: string;          // Air Force, Army, Navy, Marines, Coast Guard, Space Force, Joint, Civilian
  category?: string;        // B-Roll, Combat Operations, Interviews, etc.
  aspectRatio?: string;     // 16:9, portrait, square, landscape
  fromDate?: string;        // ISO8601
  toDate?: string;          // ISO8601
  hd?: boolean;
  fromDuration?: number;    // seconds
  toDuration?: number;
  sort?: string;            // date, publishdate, score, rating
  sortDir?: string;         // asc, desc
  page?: number;
  maxResults?: number;      // 1-50, default 24
}): Promise<{ results: DvidsSearchResult[], pageInfo: { total: number, perPage: number, page: number } }>

// Get full asset details including download URLs
getAssetDetails(dvidsId: string): Promise<DvidsAsset>

// Download single video — picks best quality (prefer 1080p+), caches locally
downloadDvidsVideo(dvidsId: string, destDir?: string): Promise<{
  filename: string;
  localPath: string;
  duration: number;
  width: number;
  height: number;
  fileSize: number;
  metadata: DvidsAssetMetadata;
}>

// Batch search+download with NDJSON progress
searchAndDownloadBatch(
  queries: Array<{ timestamp: number; query: string; side?: string }>,
  onProgress?: (event: ProgressEvent) => void
): Promise<DvidsBatchResult[]>

// Curated keyword suggestions
getSmartSuggestions(category?: string): string[]
```

### Caching

- **File cache:** `cache/dvids/dvids_<sha256(downloadUrl)[0:16]>.mp4`
- Check `fs.existsSync()` before downloading
- Directory auto-created on first use via `resolveDvidsCacheDir()`

### Quality Selection

`pickBestFile(files[])` — Sort by width descending, prefer:
1. 1920px+ width (1080p)
2. 1280px+ width (720p)
3. Highest available

### Query Fallback (batch mode)

Same strategy as Pexels:
1. Full query
2. Longest sentence fragment
3. Top 3 keywords (stop-words filtered)
4. Top 2 keywords
5. First keyword only

### Rate Limiting

Simple in-memory token bucket: 10 requests/second default. Configurable via settings.

### API Key

- Read from settings table: `dvids_api_key`
- Passed as `?api_key=` query param
- Optional — feature works without key (lower limits)
- `getApiKey()` helper returns key or undefined

---

## 2. Database Schema

### New Table: `dvids_assets`

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
  credit TEXT,                -- JSON: [{name, rank}]
  category TEXT,
  keywords TEXT,              -- JSON: string[]
  tags TEXT,                  -- JSON: string[] (user-added for Scene Library)
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
  is_favorite INTEGER DEFAULT 0,
  collection TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_dvids_assets_branch ON dvids_assets(branch);
CREATE INDEX idx_dvids_assets_category ON dvids_assets(category);
CREATE INDEX idx_dvids_assets_collection ON dvids_assets(collection);
CREATE INDEX idx_dvids_assets_is_favorite ON dvids_assets(is_favorite);
```

No changes to existing tables. DVIDS clip references in storyboard/script-studio use:
```json
{
  "type": "dvids",
  "filename": "dvids_abc123.mp4",
  "url": "/api/dvids/file/dvids_abc123.mp4",
  "duration": 15.2,
  "dvidsId": "video:123456",
  "credit": "SSgt John Doe / 62nd Airlift Wing",
  "branch": "Air Force"
}
```

---

## 3. API Routes (`apps/server/src/routes/dvids.routes.ts`)

### DVIDS Routes (`/api/dvids/*`)

| Method | Endpoint | Body/Params | Response | Purpose |
|--------|----------|-------------|----------|---------|
| GET | `/search` | query, branch, category, aspectRatio, fromDate, toDate, hd, fromDuration, toDuration, sort, sortDir, page, maxResults | `{ results, pageInfo }` | Search DVIDS videos |
| GET | `/asset/:id` | — | `{ asset }` | Full asset details |
| GET | `/suggestions` | category? | `{ suggestions: string[] }` | Smart keyword suggestions |
| POST | `/download` | `{ dvidsId }` | `{ ok, asset }` | Download + save to dvids_assets |
| POST | `/download-batch` | `{ dvidsIds: string[] }` | NDJSON stream | Bulk download with progress |
| GET | `/imported` | page, limit, branch, category, collection, favorite, search, tags | `{ assets, total }` | List imported assets |
| GET | `/imported/:id` | — | `{ asset }` | Single imported asset |
| PUT | `/imported/:id` | tags?, collection?, is_favorite? | `{ ok, asset }` | Update metadata |
| DELETE | `/imported/:id` | — | `{ ok }` | Delete asset + file |
| GET | `/collections` | — | `{ collections: string[] }` | List collection names |
| POST | `/imported/:id/auto-tag` | — | `{ ok, tags }` | Generate tags from DVIDS keywords |
| GET | `/file/:filename` | — | Static file | Serve cached video |

### Storyboard Integration (add to `storyboard.routes.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/dvids-batch` | Batch search+download for storyboard segments, NDJSON stream |

### Script Studio Integration (add to `script-studio.routes.ts`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/docs/:id/blocks/:i/fetch-dvids` | Auto-fetch best DVIDS clip for block |
| POST | `/docs/:id/blocks/:i/apply-dvids-id` | Apply specific DVIDS video to block |

Existing alternatives endpoint (`GET /docs/:id/blocks/alternatives`) extended with `service=dvids`.

---

## 4. Frontend — Dedicated DVIDS Browser Page

### Route & Component

- **Route:** `/dvids` → `DvidsBrowser.tsx`
- **Sidebar:** Add "DVIDS" menu item with Shield icon (Lucide `Shield` or `Plane`)

### Layout: 3-Panel

```
┌─────────────────────────────────────────────────────────────┐
│  Header: "DVIDS Military Footage"        [API Key Status]   │
├────────────┬──────────────────────────────┬─────────────────┤
│ LEFT PANEL │     CENTER: Results Grid     │  RIGHT PANEL    │
│ (280px)    │     or Imported Library      │  (320px, when   │
│            │                              │  item selected) │
│ Search box │  Tabs: [Search] [Imported]   │                 │
│            │                              │  Video Preview  │
│ Branch     │  Responsive grid:            │  (HTML5 video)  │
│ checkboxes │  2/3/4 cols by breakpoint    │                 │
│            │                              │  Title          │
│ Category   │  Cards: thumbnail, duration  │  Branch badge   │
│ dropdown   │  badge, title, branch badge, │  Unit           │
│            │  checkbox for bulk select    │  VIRIN          │
│ Aspect     │                              │  Duration       │
│ radio      │  Hover: scale(1.02),         │  Date           │
│            │  play overlay                │  Credit         │
│ HD toggle  │                              │  Keywords       │
│            │  Pagination at bottom        │                 │
│ Duration   │                              │  [Favorite]     │
│ min/max    │  Bulk action bar (when       │  [Collection]   │
│            │  items selected):            │  [Tags: +add]   │
│ Date range │  "Import 3 selected"         │                 │
│ from/to    │                              │  [Import]       │
│            │                              │                 │
│ Smart      │                              │  Attribution:   │
│ Suggestions│                              │  "U.S. DoD /    │
│ (clickable │                              │   Public Domain"│
│  chips)    │                              │                 │
│            │                              │                 │
│ Imported   │                              │                 │
│ count link │                              │                 │
└────────────┴──────────────────────────────┴─────────────────┘
```

### Results Grid Cards

- Thumbnail with duration badge (bottom-right, semi-transparent bg)
- Title (max 2 lines, truncated with ellipsis)
- Branch badge (color-coded: blue=Air Force, green=Army, navy=Navy, red=Marines, orange=Coast Guard, purple=Space Force)
- Checkbox (top-left) for bulk select
- Hover: `transform scale-[1.02]`, elevated shadow, play icon center overlay
- Click: select → detail panel opens on right

### Imported Library Tab

- Same grid layout but shows locally-stored assets
- Additional filters: collection dropdown, favorites toggle, tag filter
- Cards show local thumbnail, can play locally
- Delete action available

### Smart Keyword Suggestions

Organized by category (clickable chips in left panel):

- **Aircraft:** C-17 Globemaster, C-130 Hercules, F-35 Lightning, F-22 Raptor, B-2 Spirit, KC-135 Stratotanker, V-22 Osprey, MV-22, CH-47 Chinook, UH-60 Black Hawk, AH-64 Apache, E-3 Sentry AWACS, P-8 Poseidon
- **Operations:** airdrop, paratrooper, carrier landing, aerial refueling, formation flight, tactical landing, combat search and rescue, medevac, close air support
- **Naval:** aircraft carrier, destroyer, submarine, amphibious assault, underway replenishment, flight deck operations
- **Training:** live fire exercise, field training, SERE, jump school, flight line, weapons qualification
- **Equipment:** MRAP, Humvee, Bradley, Abrams tank, Stryker, HIMARS

### UI/UX Guidelines Applied

Per ui-ux-pro-max recommendations:
- Touch targets min 44x44px
- Branch badge colors meet 4.5:1 contrast ratio on all 5 themes
- Skeleton loading for grid while searching
- Empty state: illustration + "Search DVIDS for military footage" message
- Error state: clear message + retry button
- Responsive: collapses to single column on mobile, hides right panel
- All animations 150-300ms, respect prefers-reduced-motion
- Video preview in detail panel uses native HTML5 `<video>` with controls

---

## 5. Frontend — Inline Integration

### Storyboard ImagesStep

Add 4th media type option:

```
[AI Image] [AI Video] [Pexels Stock] [DVIDS Military]
```

When DVIDS selected:
- Branch filter dropdown (optional, defaults to all)
- "Fetch from DVIDS" button → `handleDvidsBatch()`
- Progress log (last 10 messages, color-coded, max-height scrollable)
- "Stop" button for abort
- Results populate `generatedImages[]` with `mediaType: 'video'`

Handler flow (mirrors `handlePexelsBatch`):
1. Extract search queries from prompts
2. Call `storyboardApi.dvidsBatch(queries, onProgress, abortSignal)`
3. Stream progress events → `dvidsProgress` state array
4. Map results to `generatedImages` by timestamp
5. Save project state

### Script Studio Review Step

- Add "DVIDS" option in stock alternatives service dropdown
- `fetch-dvids` endpoint auto-fetches best match for block's pexels_query
- `apply-dvids-id` lets user pick specific DVIDS video
- Downloaded to doc directory: `renders/storyboard/doc_<docId>/dvids_<hash>.mp4`

### Attribution Auto-Generation

When DVIDS clips used in a project:
- Store credit metadata in clip reference object
- During metadata generation (Storyboard Step 6 or Script Studio produce):
  - Auto-append to description: `"Footage courtesy of U.S. Department of Defense / Public Domain"`
  - Per-clip credits: `"[timestamp] — Credit: [rank] [name] / [unit_name] / DVIDS"`

---

## 6. Settings Integration

In Settings page, add "DVIDS" section:
- API key input (masked display, same pattern as other keys)
- "Test Connection" button → `GET /api/dvids/search?q=test&maxResults=1`
- Status indicator (green check / red x / gray if not configured)
- Help text: "Optional — DVIDS works without an API key but with lower rate limits. Get a key at api.dvidshub.net"

Stored in `settings` table as key `dvids_api_key`.

---

## 7. API Client (`apps/web/src/lib/api.ts`)

Add DVIDS section to the API client:

```typescript
dvids: {
  search: (params) => get('/dvids/search', params),
  asset: (id) => get(`/dvids/asset/${id}`),
  suggestions: (category?) => get('/dvids/suggestions', { category }),
  download: (dvidsId) => post('/dvids/download', { dvidsId }),
  downloadBatch: (dvidsIds, onProgress, signal) => postNDJSON('/dvids/download-batch', { dvidsIds }, onProgress, signal),
  imported: (params) => get('/dvids/imported', params),
  importedById: (id) => get(`/dvids/imported/${id}`),
  updateImported: (id, data) => put(`/dvids/imported/${id}`, data),
  deleteImported: (id) => del(`/dvids/imported/${id}`),
  collections: () => get('/dvids/collections'),
  autoTag: (id) => post(`/dvids/imported/${id}/auto-tag`),
}
```

Storyboard API additions:
```typescript
dvidsBatch: (queries, onProgress, signal) => postNDJSON('/storyboard/dvids-batch', { queries }, onProgress, signal),
```

---

## 8. i18n Keys

All user-visible strings in both `en.json` and `vi.json`:

```
dvids.title = "DVIDS Military Footage"
dvids.search = "Search DVIDS"
dvids.searchPlaceholder = "Search military footage..."
dvids.branch = "Branch"
dvids.category = "Category"
dvids.aspectRatio = "Aspect Ratio"
dvids.hdOnly = "HD Only"
dvids.duration = "Duration"
dvids.dateRange = "Date Range"
dvids.sort = "Sort By"
dvids.suggestions = "Smart Suggestions"
dvids.import = "Import"
dvids.bulkImport = "Import Selected"
dvids.importing = "Importing..."
dvids.downloaded = "Downloaded"
dvids.favorites = "Favorites"
dvids.collections = "Collections"
dvids.imported = "Imported"
dvids.myLibrary = "My Library"
dvids.noResults = "No results found"
dvids.noImported = "No imported footage yet"
dvids.attribution = "U.S. Department of Defense / Public Domain"
dvids.credit = "Credit"
dvids.virin = "VIRIN"
dvids.unit = "Unit"
dvids.keywords = "Keywords"
dvids.tags = "Tags"
dvids.addTag = "Add tag"
dvids.collection = "Collection"
dvids.autoTag = "Auto-tag"
dvids.delete = "Delete"
dvids.deleteConfirm = "Delete this imported footage?"
dvids.apiKeyOptional = "Optional - works without key but with lower rate limits"
dvids.testConnection = "Test Connection"
dvids.connectionOk = "Connected to DVIDS API"
dvids.connectionFailed = "Failed to connect to DVIDS API"
dvids.fetchFromDvids = "Fetch from DVIDS"
dvids.stopFetch = "Stop"
dvids.aircraft = "Aircraft"
dvids.operations = "Operations"
dvids.naval = "Naval"
dvids.training = "Training"
dvids.equipment = "Equipment"

storyboard.mediaType.dvids = "DVIDS Military"
storyboard.dvids.fetch = "Fetch from DVIDS"
storyboard.dvids.stop = "Stop"
storyboard.dvids.branchFilter = "Branch Filter"

settings.dvids.title = "DVIDS (Military Footage)"
settings.dvids.apiKey = "DVIDS API Key"
settings.dvids.description = "Access public domain U.S. military footage"
```

---

## 9. File Structure (New Files)

```
apps/server/src/
  services/dvids.service.ts          — Core service (search, download, cache, batch)
  routes/dvids.routes.ts             — API routes

apps/web/src/
  pages/DvidsBrowser.tsx             — Dedicated browser page
  pages/dvids/
    DvidsSearchPanel.tsx             — Left panel (filters + suggestions)
    DvidsResultsGrid.tsx             — Center grid (search + imported tabs)
    DvidsDetailPanel.tsx             — Right panel (preview + metadata)
    DvidsVideoCard.tsx               — Individual result card
    types.ts                         — TypeScript types
```

Modified files:
- `apps/server/src/db/schema.ts` — Add dvids_assets table
- `apps/server/src/routes/storyboard.routes.ts` — Add /dvids-batch endpoint
- `apps/server/src/routes/script-studio.routes.ts` — Add fetch-dvids, apply-dvids-id endpoints
- `apps/web/src/lib/api.ts` — Add dvids API methods
- `apps/web/src/App.tsx` (or router config) — Add /dvids route
- `apps/web/src/pages/storyboard/components/ImagesStep.tsx` — Add DVIDS tab
- `apps/web/src/pages/Settings.tsx` — Add DVIDS API key section
- `apps/web/src/i18n/locales/en.json` — Add all dvids.* keys
- `apps/web/src/i18n/locales/vi.json` — Add all dvids.* keys (Vietnamese)
- Sidebar navigation — Add DVIDS menu item

---

## 10. Non-Goals (Out of Scope)

- DVIDS image/photo support (video only for now)
- DVIDS news article integration
- OAuth-based DVIDS authentication (API key only)
- DVIDS upload/publish functionality
- Live stream integration
- Watermark/overlay on DVIDS footage (it's public domain)
