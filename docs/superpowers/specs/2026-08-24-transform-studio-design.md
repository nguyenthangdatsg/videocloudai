# Transform Studio Design Spec

**Date:** 2026-08-24
**Feature:** Static-camera before/after transformation reveal videos

## Overview

Transform Studio generates "static-camera before/after transformation reveal" videos (e.g., a bare balcony turning into a furnished patio at dusk, same locked camera angle throughout). It reuses the Han2YT Chrome extension bridge but with a completely isolated event namespace (`Han2YT_transform_*`).

Two modes in one UI, switchable by a toggle:

- **Quick Mode** (default) — Single-page minimal flow: upload image + instruction -> generate -> result
- **Advanced Mode** — Multi-segment wizard with per-segment prompt editing, regeneration, and assembly

## Isolation Requirements

- No imports from or writes to `ImageGenStore`
- No rows added to `videos`, `storyboards`, `storyboard_templates`, or `drama_*` tables
- No reuse of `/api/storyboard/*` or `/api/videos/*` routes
- Own: sidebar entry, i18n namespace (`transform`), Zustand slice, DB tables, routes, event namespace
- All independently removable without affecting existing features
- Reuses: Chrome extension bridge mechanism, job queue, SSE stream, `VideoAssembler`, UI component library/theme

## Backend

### New Files

- `apps/server/src/routes/transform.routes.ts` — mounted at `/api/transform/*`
- `apps/server/src/services/transform.service.ts` — all business logic

### Route Handlers (thin, delegate to service)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/transform/quick` | Create quick-mode project (image + instruction) |
| POST | `/api/transform/projects` | Create advanced-mode project |
| GET | `/api/transform/projects` | List all transform projects |
| GET | `/api/transform/projects/:id` | Get project with segments |
| DELETE | `/api/transform/projects/:id` | Delete project |
| PUT | `/api/transform/projects/:id` | Update project (lockedCameraAnchor, status) |
| POST | `/api/transform/projects/:id/segments` | Add segment |
| PUT | `/api/transform/segments/:id` | Update segment (prompt, lighting, order, status, asset_path) |
| DELETE | `/api/transform/segments/:id` | Delete segment |
| POST | `/api/transform/segments/:id/reorder` | Reorder segments |
| POST | `/api/transform/projects/:id/build-prompts` | Build composed prompts for all segments |
| POST | `/api/transform/projects/:id/assemble` | Assemble final video via VideoAssembler |
| POST | `/api/transform/projects/:id/derive-anchor` | Use LLM vision to derive lockedCameraAnchor from source image |
| POST | `/api/transform/quick/:id/to-advanced` | Convert quick result to advanced project |

### Database Tables

Added to `apps/server/src/db/schema.ts` (new tables only, no existing table modifications):

```sql
CREATE TABLE IF NOT EXISTS transform_projects (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'quick' CHECK(mode IN ('quick', 'advanced')),
  locked_camera_anchor TEXT NOT NULL DEFAULT '',
  source_image_path TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  result_path TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS transform_segments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  segment_order INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL DEFAULT '',
  lighting TEXT NOT NULL DEFAULT 'natural daylight',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'done', 'failed')),
  asset_path TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES transform_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transform_segments_project ON transform_segments(project_id);
```

### Service: `transform.service.ts`

```typescript
export class TransformService {
  // Project CRUD
  createQuickProject(sourceImagePath: string, instruction: string): TransformProject
  createAdvancedProject(lockedCameraAnchor: string, sourceImagePath?: string): TransformProject
  getProject(id: string): TransformProject | null
  listProjects(): TransformProject[]
  updateProject(id: string, updates: Partial<TransformProject>): TransformProject | null
  deleteProject(id: string): boolean

  // Segment CRUD
  addSegment(projectId: string, prompt: string, lighting: string, order: number): TransformSegment
  updateSegment(id: string, updates: Partial<TransformSegment>): TransformSegment | null
  deleteSegment(id: string): boolean
  reorderSegments(projectId: string, segmentIds: string[]): void
  getSegments(projectId: string): TransformSegment[]

  // Prompt construction
  buildPrompt(lockedCameraAnchor: string, segmentPrompt: string, lighting: string): string
  buildAllPrompts(projectId: string): { segmentId: string; prompt: string }[]

  // LLM vision anchor derivation
  deriveAnchor(imagePath: string): Promise<string>

  // Assembly (calls VideoAssembler from packages/ffmpeg)
  assembleProject(projectId: string, onProgress?: (p: AssemblyProgress) => void): Promise<string>

  // Quick -> Advanced conversion
  convertToAdvanced(quickProjectId: string): TransformProject
}
```

### Prompt Template (server-side, used by both modes)

```
Static locked-off camera, same angle throughout, no camera movement.
Consistent background: {lockedCameraAnchor}.
Current stage: {segmentPrompt}.
Lighting: {lighting}.
Photorealistic, vertical 9:16, no on-screen text, no camera movement.
```

For Quick Mode:
- `lockedCameraAnchor` = auto-derived from uploaded image via LLM vision (`llm.service.ts`)
- `segmentPrompt` = user's free-text instruction directly

### Assembly Pipeline

`assembleProject()` gathers all completed segments, builds a `VideoTimeline`:
```typescript
{
  clips: segments.map(s => ({
    assetPath: s.asset_path,
    duration: segmentDuration, // derived from asset or default
    motionEffect: 'static',   // locked camera = no motion
    transition: 'fade'
  })),
  // No narration/music by default (user can add later)
}
```
Passes to `VideoAssembler.assembleVideo()` from `packages/ffmpeg`.

### Job Queue Integration

Jobs tagged with:
- `type: 'transform_quick'` — for quick mode (single generation)
- `type: 'transform_assemble'` — for assembly

These are distinguishable in the `/api/queue/*` monitoring UI. SSE progress emitted on existing `/api/events` stream.

## Frontend

### New Files

```
apps/web/src/pages/transform/
  TransformStudio.tsx          -- Mode toggle (Quick/Advanced), routes to sub-views
  QuickMode.tsx                -- Upload, instruction textarea, generate, result player
  AdvancedMode/
    SetupPanel.tsx             -- Source image + lockedCameraAnchor field
    SegmentList.tsx            -- Reorderable list with status badges
    SegmentEditor.tsx          -- Prompt/lighting editor + regenerate action
    AssemblePanel.tsx          -- Final assemble + export

apps/web/src/store/transform.ts  -- Zustand store (isolated from ImageGenStore)
```

### Route

`/transform` -> `TransformStudio` page, added to `App.tsx` routes.

### Sidebar

New entry in `DEFAULT_NAV_ITEMS` in `Sidebar.tsx`:
```typescript
{ path: '/transform', icon: Wand2, label: t('nav.transformStudio') }
```
Positioned after Drama Studio entries.

### Zustand Store: `transform.ts`

```typescript
interface TransformStore {
  // Quick mode state
  quickJob: {
    projectId: string;
    status: 'idle' | 'generating' | 'done' | 'failed';
    progress: string[];
    resultUrl: string | null;
    error: string | null;
  } | null;
  setQuickJob: (job: TransformStore['quickJob']) => void;

  // Advanced mode state
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  segmentStatuses: Map<string, 'pending' | 'generating' | 'done' | 'failed'>;
  updateSegmentStatus: (segmentId: string, status: string) => void;

  // Extension bridge (Han2YT_transform_*)
  flowSessionId: string | null;
  startGeneration: (projectId: string, prompts: string[], mediaType: 'image' | 'video', provider: string) => void;
  stopGeneration: () => void;

  // Listener lifecycle
  initListeners: () => void;
  cleanupListeners: () => void;
}
```

**Event namespace** (completely separate from Han2YT_flow_*):
- Dispatch: `Han2YT_transform_start`, `Han2YT_transform_stop`
- Listen: `Han2YT_transform_progress`, `Han2YT_transform_image`, `Han2YT_transform_video`, `Han2YT_transform_done`, `Han2YT_transform_error`

**Session ID filtering:** Same pattern as ImageGenStore — generate unique sessionId per generation, ignore events with mismatched sessionId.

### API Client (`api.ts`)

```typescript
export const transformApi = {
  // Quick mode
  createQuickJob: (data: { imagePath: string; instruction: string }) =>
    api.post('/transform/quick', data).then(r => r.data),

  // Projects
  listProjects: () =>
    api.get('/transform/projects').then(r => r.data.projects),
  getProject: (id: string) =>
    api.get(`/transform/projects/${id}`).then(r => r.data.project),
  createProject: (data: { lockedCameraAnchor: string; sourceImagePath?: string }) =>
    api.post('/transform/projects', data).then(r => r.data.project),
  updateProject: (id: string, data: Partial<TransformProject>) =>
    api.put(`/transform/projects/${id}`, data).then(r => r.data.project),
  deleteProject: (id: string) =>
    api.delete(`/transform/projects/${id}`),

  // Segments
  addSegment: (projectId: string, data: { prompt: string; lighting: string; order: number }) =>
    api.post(`/transform/projects/${projectId}/segments`, data).then(r => r.data.segment),
  updateSegment: (id: string, data: Partial<TransformSegment>) =>
    api.put(`/transform/segments/${id}`, data).then(r => r.data.segment),
  deleteSegment: (id: string) =>
    api.delete(`/transform/segments/${id}`),
  reorderSegments: (projectId: string, segmentIds: string[]) =>
    api.post(`/transform/projects/${projectId}/segments/reorder`, { segmentIds }),

  // Prompts & assembly
  buildPrompts: (projectId: string) =>
    api.post(`/transform/projects/${projectId}/build-prompts`).then(r => r.data.prompts),
  deriveAnchor: (projectId: string) =>
    api.post(`/transform/projects/${projectId}/derive-anchor`).then(r => r.data.anchor),
  assemble: (projectId: string) =>
    api.post(`/transform/projects/${projectId}/assemble`).then(r => r.data),

  // Quick -> Advanced
  convertToAdvanced: (id: string) =>
    api.post(`/transform/quick/${id}/to-advanced`).then(r => r.data.project),
};
```

### i18n

New namespace `transform` in both `en.json` and `vi.json`:

```json
{
  "transform": {
    "title": "Transform Studio",
    "quickMode": "Quick Mode",
    "advancedMode": "Advanced Mode",
    "uploadImage": "Upload source image",
    "instruction": "Describe the transformation...",
    "generate": "Generate",
    "generating": "Generating...",
    "download": "Download",
    "sendToAdvanced": "Send to Advanced Mode",
    "lockedCameraAnchor": "Fixed background description",
    "lockedCameraAnchorHint": "Describe elements that stay constant (house, railing, mountains...)",
    "addSegment": "Add Segment",
    "segmentPrompt": "Segment prompt",
    "lighting": "Lighting / Time of day",
    "regenerate": "Regenerate",
    "assemble": "Assemble Video",
    "assembling": "Assembling...",
    "retry": "Retry",
    "pending": "Pending",
    "done": "Done",
    "failed": "Failed",
    "deleteSegment": "Delete segment",
    "setup": "Setup",
    "segments": "Segments",
    "export": "Export"
  },
  "nav": {
    "transformStudio": "Transform Studio"
  }
}
```

### TanStack Query Usage

```typescript
// Queries
useQuery({ queryKey: ['transform-projects'], queryFn: transformApi.listProjects })
useQuery({ queryKey: ['transform-project', id], queryFn: () => transformApi.getProject(id) })

// Mutations
useMutation({ mutationFn: transformApi.createQuickJob, onSuccess: invalidate })
useMutation({ mutationFn: (data) => transformApi.addSegment(projectId, data), onSuccess: invalidate })
useMutation({ mutationFn: () => transformApi.assemble(projectId), onSuccess: invalidate })
```

### UI Component Details

**TransformStudio.tsx:**
- Top toggle: Quick Mode / Advanced Mode (tabs or segmented control)
- Renders `QuickMode` or `AdvancedMode/*` based on selection
- If navigated with a projectId param, loads that project and sets appropriate mode

**QuickMode.tsx:**
- Image upload area (drag & drop or click)
- Instruction textarea
- Provider selector (Google Flow / Grok / ChatGPT — same options as ImageGenStore)
- Generate button -> shows progress log -> shows result video player
- Download button + "Send to Advanced Mode" button on result

**AdvancedMode/SetupPanel.tsx:**
- Source image upload (optional for advanced, required for anchor derivation)
- `lockedCameraAnchor` textarea with "Auto-derive from image" button
- "Auto-derive" calls `POST /api/transform/projects/:id/derive-anchor`

**AdvancedMode/SegmentList.tsx:**
- Drag-to-reorder list of segments
- Each segment shows: order number, prompt preview (truncated), lighting tag, status badge (color-coded)
- "Add Segment" button at bottom with default seed prompts for new projects:
  1. Empty room / bare space
  2. Preparation and cleanup
  3. Flooring and base elements
  4. Furniture placement
  5. Decorative touches
  6. Final reveal with styling

**AdvancedMode/SegmentEditor.tsx:**
- Prompt textarea (full editable)
- Lighting/time-of-day input
- Preview of composed prompt (read-only, shows what will be sent to extension)
- "Generate" button (single segment) / "Regenerate" button (if already done/failed)
- Status indicator + asset preview (image/video) when done

**AdvancedMode/AssemblePanel.tsx:**
- Mirrors `AssembleStep.tsx` UX: assemble button, progress log, result player
- Only enabled when all segments are `done`
- Calls `POST /api/transform/projects/:id/assemble`
- Shows final MP4 with download button

### "Send to Advanced Mode" Flow

1. User clicks "Send to Advanced Mode" on Quick Mode result
2. Calls `POST /api/transform/quick/:id/to-advanced`
3. Backend creates new advanced project:
   - Copies `locked_camera_anchor` from quick project
   - Creates segment #1 with the quick result's asset as `asset_path`, status `done`
   - Returns new project
4. Frontend switches to Advanced Mode with the new project loaded
5. User can add more segments and continue editing

## Acceptance Checklist

- [ ] `/transform` page reachable from Sidebar, does not affect existing nav
- [ ] Quick Mode: upload -> instruction -> extension dispatch -> progress -> finished video -> download
- [ ] Advanced Mode: setup -> add/edit/reorder segments -> per-segment generate/retry -> assemble -> export
- [ ] "Send to Advanced Mode" carries over the Quick result as segment #1
- [ ] New DB tables created via schema, no existing tables modified
- [ ] Han2YT_transform_* events isolated from Han2YT_flow_* events
- [ ] All strings use i18n (en + vi)
- [ ] TanStack Query for all server state
- [ ] Zustand store isolated from ImageGenStore
- [ ] Job queue jobs tagged with transform_quick / transform_assemble
- [ ] Assembly uses existing VideoAssembler from packages/ffmpeg
