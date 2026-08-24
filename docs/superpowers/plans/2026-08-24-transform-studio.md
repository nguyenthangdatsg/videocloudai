# Transform Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated Transform Studio feature for creating static-camera before/after transformation reveal videos with Quick and Advanced modes.

**Architecture:** New backend route + service + 2 DB tables handle CRUD and FFmpeg assembly. Frontend Zustand store handles Chrome extension communication via `Han2YT_transform_*` events. All isolated from existing features (own tables, store, routes, events, i18n namespace).

**Tech Stack:** Express 5, SQLite (better-sqlite3), Zustand, TanStack Query, React, Tailwind, Gemini Vision API, FFmpeg/VideoAssembler.

---

### Task 1: Database Schema — Transform Tables

**Files:**
- Modify: `apps/server/src/db/schema.ts:440` (append before closing backtick)

- [ ] **Step 1: Add transform tables to schema**

In `apps/server/src/db/schema.ts`, find line 439 (`CREATE INDEX IF NOT EXISTS idx_drama_shots_scene ON drama_shots(scene_id);`) and add the following new tables before the closing backtick on line 440:

```sql
CREATE TABLE IF NOT EXISTS transform_projects (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'quick' CHECK(mode IN ('quick', 'advanced')),
  locked_camera_anchor TEXT NOT NULL DEFAULT '',
  source_image_path TEXT,
  instruction TEXT NOT NULL DEFAULT '',
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

- [ ] **Step 2: Verify the schema loads**

Run: `cd apps/server && npx ts-node -e "require('./src/db'); console.log('DB OK')"`
Expected: `DB OK` — tables are auto-created on import.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/db/schema.ts
git commit -m "feat(transform): add transform_projects and transform_segments tables"
```

---

### Task 2: Backend Service — TransformService

**Files:**
- Create: `apps/server/src/services/transform.service.ts`

- [ ] **Step 1: Create the transform service**

Create `apps/server/src/services/transform.service.ts`:

```typescript
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { dbGet, dbAll, dbRun } from '../db';
import { getSettings } from './settings.service';

export interface TransformProject {
  id: string;
  mode: 'quick' | 'advanced';
  lockedCameraAnchor: string;
  sourceImagePath: string | null;
  instruction: string;
  status: string;
  resultPath: string | null;
  createdAt: string;
  updatedAt: string;
  segments?: TransformSegment[];
}

export interface TransformSegment {
  id: string;
  projectId: string;
  segmentOrder: number;
  prompt: string;
  lighting: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  assetPath: string | null;
  retries: number;
  createdAt: string;
}

interface DbProject {
  id: string;
  mode: string;
  locked_camera_anchor: string;
  source_image_path: string | null;
  instruction: string;
  status: string;
  result_path: string | null;
  created_at: string;
  updated_at: string;
}

interface DbSegment {
  id: string;
  project_id: string;
  segment_order: number;
  prompt: string;
  lighting: string;
  status: string;
  asset_path: string | null;
  retries: number;
  created_at: string;
}

function mapProject(row: DbProject): TransformProject {
  return {
    id: row.id,
    mode: row.mode as 'quick' | 'advanced',
    lockedCameraAnchor: row.locked_camera_anchor,
    sourceImagePath: row.source_image_path,
    instruction: row.instruction,
    status: row.status,
    resultPath: row.result_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSegment(row: DbSegment): TransformSegment {
  return {
    id: row.id,
    projectId: row.project_id,
    segmentOrder: row.segment_order,
    prompt: row.prompt,
    lighting: row.lighting,
    status: row.status as TransformSegment['status'],
    assetPath: row.asset_path,
    retries: row.retries,
    createdAt: row.created_at,
  };
}

export class TransformService {
  // ── Project CRUD ──

  createProject(mode: 'quick' | 'advanced', opts: {
    lockedCameraAnchor?: string;
    sourceImagePath?: string;
    instruction?: string;
  } = {}): TransformProject {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO transform_projects (id, mode, locked_camera_anchor, source_image_path, instruction, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [id, mode, opts.lockedCameraAnchor || '', opts.sourceImagePath || null, opts.instruction || '', now, now],
    );
    return this.getProject(id)!;
  }

  getProject(id: string): TransformProject | null {
    const row = dbGet<DbProject>('SELECT * FROM transform_projects WHERE id = ?', [id]);
    if (!row) return null;
    const project = mapProject(row);
    project.segments = this.getSegments(id);
    return project;
  }

  listProjects(): TransformProject[] {
    const rows = dbAll<DbProject>('SELECT * FROM transform_projects ORDER BY created_at DESC');
    return rows.map(mapProject);
  }

  updateProject(id: string, updates: Partial<Pick<TransformProject, 'lockedCameraAnchor' | 'instruction' | 'status' | 'resultPath' | 'sourceImagePath'>>): TransformProject | null {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.lockedCameraAnchor !== undefined) { sets.push('locked_camera_anchor = ?'); vals.push(updates.lockedCameraAnchor); }
    if (updates.instruction !== undefined) { sets.push('instruction = ?'); vals.push(updates.instruction); }
    if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
    if (updates.resultPath !== undefined) { sets.push('result_path = ?'); vals.push(updates.resultPath); }
    if (updates.sourceImagePath !== undefined) { sets.push('source_image_path = ?'); vals.push(updates.sourceImagePath); }
    if (sets.length === 0) return this.getProject(id);
    sets.push("updated_at = datetime('now')");
    vals.push(id);
    dbRun(`UPDATE transform_projects SET ${sets.join(', ')} WHERE id = ?`, vals);
    return this.getProject(id);
  }

  deleteProject(id: string): boolean {
    dbRun('DELETE FROM transform_projects WHERE id = ?', [id]);
    return true;
  }

  // ── Segment CRUD ──

  addSegment(projectId: string, prompt: string, lighting: string, order: number): TransformSegment {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO transform_segments (id, project_id, segment_order, prompt, lighting, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, projectId, order, prompt, lighting, now],
    );
    return this.getSegment(id)!;
  }

  getSegment(id: string): TransformSegment | null {
    const row = dbGet<DbSegment>('SELECT * FROM transform_segments WHERE id = ?', [id]);
    return row ? mapSegment(row) : null;
  }

  getSegments(projectId: string): TransformSegment[] {
    const rows = dbAll<DbSegment>(
      'SELECT * FROM transform_segments WHERE project_id = ? ORDER BY segment_order ASC',
      [projectId],
    );
    return rows.map(mapSegment);
  }

  updateSegment(id: string, updates: Partial<Pick<TransformSegment, 'prompt' | 'lighting' | 'status' | 'assetPath' | 'retries' | 'segmentOrder'>>): TransformSegment | null {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.prompt !== undefined) { sets.push('prompt = ?'); vals.push(updates.prompt); }
    if (updates.lighting !== undefined) { sets.push('lighting = ?'); vals.push(updates.lighting); }
    if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
    if (updates.assetPath !== undefined) { sets.push('asset_path = ?'); vals.push(updates.assetPath); }
    if (updates.retries !== undefined) { sets.push('retries = ?'); vals.push(updates.retries); }
    if (updates.segmentOrder !== undefined) { sets.push('segment_order = ?'); vals.push(updates.segmentOrder); }
    if (sets.length === 0) return this.getSegment(id);
    vals.push(id);
    dbRun(`UPDATE transform_segments SET ${sets.join(', ')} WHERE id = ?`, vals);
    return this.getSegment(id);
  }

  deleteSegment(id: string): boolean {
    dbRun('DELETE FROM transform_segments WHERE id = ?', [id]);
    return true;
  }

  reorderSegments(projectId: string, segmentIds: string[]): void {
    for (let i = 0; i < segmentIds.length; i++) {
      dbRun('UPDATE transform_segments SET segment_order = ? WHERE id = ? AND project_id = ?', [i, segmentIds[i], projectId]);
    }
  }

  // ── Prompt Construction ──

  buildPrompt(lockedCameraAnchor: string, segmentPrompt: string, lighting: string): string {
    return [
      'Static locked-off camera, same angle throughout, no camera movement.',
      `Consistent background: ${lockedCameraAnchor}.`,
      `Current stage: ${segmentPrompt}.`,
      `Lighting: ${lighting}.`,
      'Photorealistic, vertical 9:16, no on-screen text, no camera movement.',
    ].join('\n');
  }

  buildAllPrompts(projectId: string): Array<{ segmentId: string; composedPrompt: string }> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const segments = project.segments || [];
    return segments.map((seg) => ({
      segmentId: seg.id,
      composedPrompt: this.buildPrompt(project.lockedCameraAnchor, seg.prompt, seg.lighting),
    }));
  }

  // ── LLM Vision — Derive Anchor ──

  async deriveAnchor(imagePath: string): Promise<string> {
    const s = getSettings();
    const apiKey = s.get('gemini_api_key');
    if (!apiKey) throw new Error('Gemini API key required for image analysis. Add it in Settings.');

    const absPath = path.resolve(imagePath);
    if (!fs.existsSync(absPath)) throw new Error(`Image not found: ${absPath}`);

    const imageData = fs.readFileSync(absPath);
    const base64 = imageData.toString('base64');
    const ext = path.extname(absPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const model = s.get('gemini_model') || 'gemini-2.5-flash';

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: 'Describe the fixed background elements in this image in one concise sentence (e.g., architecture, landscape, structures). Focus only on permanent elements that would remain constant across a transformation sequence. Do not describe furniture, decorations, or movable objects.' },
            ],
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
        }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini vision failed (${res.status}): ${err.substring(0, 200)}`);
    }

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Empty response from Gemini vision');
    return text;
  }

  // ── Assembly ──

  async assembleProject(projectId: string, onProgress?: (p: { stage: string; percent: number }) => void): Promise<string> {
    const project = this.getProject(projectId);
    if (!project) throw new Error('Project not found');
    const segments = (project.segments || []).filter((s) => s.status === 'done' && s.assetPath);
    if (segments.length === 0) throw new Error('No completed segments to assemble');

    // Dynamic import to avoid circular deps
    const { VideoAssembler } = await import('@videocloudai/ffmpeg');
    const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders');
    fs.mkdirSync(rendersDir, { recursive: true });

    const outputPath = path.join(rendersDir, `transform_${projectId}_${Date.now()}.mp4`);
    const assembler = new VideoAssembler({
      ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
      ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
      width: 1080,
      height: 1920,
      fps: 24,
      outputDir: rendersDir,
    });

    const timeline = {
      clips: segments.map((seg) => ({
        assetPath: path.resolve(seg.assetPath!),
        duration: 4, // default 4s per segment
        motionEffect: 'static' as const,
        transition: 'fade' as const,
      })),
    };

    await assembler.assembleVideo(timeline, outputPath, onProgress);

    this.updateProject(projectId, { status: 'completed', resultPath: outputPath });
    return outputPath;
  }

  // ── Quick -> Advanced Conversion ──

  convertToAdvanced(quickProjectId: string): TransformProject {
    const quick = this.getProject(quickProjectId);
    if (!quick) throw new Error('Quick project not found');

    const advanced = this.createProject('advanced', {
      lockedCameraAnchor: quick.lockedCameraAnchor,
      sourceImagePath: quick.sourceImagePath || undefined,
    });

    // If quick project has a result, add it as segment #1
    if (quick.resultPath) {
      this.addSegment(advanced.id, quick.instruction || 'Initial transformation', 'natural daylight', 0);
      const segments = this.getSegments(advanced.id);
      if (segments[0]) {
        this.updateSegment(segments[0].id, { status: 'done', assetPath: quick.resultPath });
      }
    }

    return this.getProject(advanced.id)!;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/server && npx tsc --noEmit src/services/transform.service.ts 2>&1 | head -20`

If there are import issues with `@videocloudai/ffmpeg`, check the actual package export path and fix the import. The VideoAssembler import may need to be `from '../../packages/ffmpeg/src/assembler'` or similar depending on the monorepo setup.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/services/transform.service.ts
git commit -m "feat(transform): add TransformService with CRUD, prompt builder, vision anchor, assembly"
```

---

### Task 3: Backend Routes — transform.routes.ts

**Files:**
- Create: `apps/server/src/routes/transform.routes.ts`
- Modify: `apps/server/src/app.ts:27,72,106` (import, instantiate, mount)

- [ ] **Step 1: Create the route file**

Create `apps/server/src/routes/transform.routes.ts`:

```typescript
import { Router } from 'express';
import { TransformService } from '../services/transform.service';

export function createTransformRouter(transformService: TransformService): Router {
  const router = Router();

  // ── Projects ──

  router.get('/projects', (req, res) => {
    try {
      const projects = transformService.listProjects();
      res.json({ projects });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects', (req, res) => {
    try {
      const { mode, lockedCameraAnchor, sourceImagePath, instruction } = req.body;
      const project = transformService.createProject(mode || 'advanced', {
        lockedCameraAnchor,
        sourceImagePath,
        instruction,
      });
      res.status(201).json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/projects/:id', (req, res) => {
    try {
      const project = transformService.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.put('/projects/:id', (req, res) => {
    try {
      const project = transformService.updateProject(req.params.id, req.body);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/projects/:id', (req, res) => {
    try {
      transformService.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Quick Mode ──

  router.post('/quick', async (req, res) => {
    try {
      const { sourceImagePath, instruction } = req.body;
      if (!sourceImagePath || !instruction) {
        return res.status(400).json({ error: 'sourceImagePath and instruction are required' });
      }
      const project = transformService.createProject('quick', { sourceImagePath, instruction });

      // Auto-derive anchor from image
      try {
        const anchor = await transformService.deriveAnchor(sourceImagePath);
        transformService.updateProject(project.id, { lockedCameraAnchor: anchor });
      } catch (err) {
        console.warn('[Transform] Failed to derive anchor:', (err as Error).message);
      }

      const updated = transformService.getProject(project.id);
      res.status(201).json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/quick/:id/to-advanced', (req, res) => {
    try {
      const project = transformService.convertToAdvanced(req.params.id);
      res.status(201).json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Segments ──

  router.post('/projects/:id/segments', (req, res) => {
    try {
      const { prompt, lighting, order } = req.body;
      const segment = transformService.addSegment(req.params.id, prompt || '', lighting || 'natural daylight', order ?? 0);
      res.status(201).json({ segment });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.put('/segments/:id', (req, res) => {
    try {
      const segment = transformService.updateSegment(req.params.id, req.body);
      if (!segment) return res.status(404).json({ error: 'Segment not found' });
      res.json({ segment });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/segments/:id', (req, res) => {
    try {
      transformService.deleteSegment(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:id/segments/reorder', (req, res) => {
    try {
      const { segmentIds } = req.body;
      transformService.reorderSegments(req.params.id, segmentIds);
      const project = transformService.getProject(req.params.id);
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Prompts & Assembly ──

  router.post('/projects/:id/build-prompts', (req, res) => {
    try {
      const prompts = transformService.buildAllPrompts(req.params.id);
      res.json({ prompts });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:id/derive-anchor', async (req, res) => {
    try {
      const project = transformService.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      if (!project.sourceImagePath) return res.status(400).json({ error: 'No source image' });
      const anchor = await transformService.deriveAnchor(project.sourceImagePath);
      transformService.updateProject(req.params.id, { lockedCameraAnchor: anchor });
      res.json({ anchor });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:id/assemble', async (req, res) => {
    try {
      const outputPath = await transformService.assembleProject(req.params.id, (p) => {
        console.log(`[Transform] Assembly: ${p.stage} (${p.percent}%)`);
      });
      const project = transformService.getProject(req.params.id);
      res.json({ project, outputPath, url: `/renders/${require('path').basename(outputPath)}` });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Wire up in app.ts**

In `apps/server/src/app.ts`:

Add import after line 27 (`import { createScriptStudioRouter } ...`):
```typescript
import { createTransformRouter } from './routes/transform.routes';
import { TransformService } from './services/transform.service';
```

Add service instantiation after line 71 (`const videoService = ...`):
```typescript
  const transformService = new TransformService();
```

Add route mount after line 106 (`app.use('/api/script-studio', ...)`):
```typescript
  app.use('/api/transform', createTransformRouter(transformService));
```

- [ ] **Step 3: Verify server starts**

Run: `cd apps/server && npx ts-node src/index.ts &` then `curl http://localhost:3002/api/transform/projects`
Expected: `{"projects":[]}`

Kill the server after verifying.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/transform.routes.ts apps/server/src/app.ts
git commit -m "feat(transform): add transform routes and wire up in app"
```

---

### Task 4: Frontend — i18n Keys

**Files:**
- Modify: `apps/web/src/i18n/locales/en.json:29` (add nav key)
- Modify: `apps/web/src/i18n/locales/vi.json` (add nav key)
- Add `transformStudio` namespace to both files

- [ ] **Step 1: Add English translations**

In `apps/web/src/i18n/locales/en.json`, add to the `nav` object (after line 28 `"scriptStudio": "Script Studio"`):
```json
    "transformStudio": "Transform Studio",
```

Add a new top-level `transformStudio` key (NOT under `videoEditor` — that has its own `transform` for crop/flip). Add this at the end of the JSON, before the final closing `}`:

```json
  "transformStudio": {
    "title": "Transform Studio",
    "quickMode": "Quick Mode",
    "advancedMode": "Advanced Mode",
    "uploadImage": "Upload source image",
    "uploadImageHint": "Upload the 'before' photo (the starting state)",
    "instruction": "Describe the transformation",
    "instructionPlaceholder": "e.g., Transform this bare balcony into a cozy furnished patio with string lights at dusk...",
    "generate": "Generate",
    "generating": "Generating...",
    "download": "Download",
    "sendToAdvanced": "Send to Advanced Mode",
    "lockedCameraAnchor": "Fixed background description",
    "lockedCameraAnchorHint": "Describe elements that stay constant (house, railing, mountains...)",
    "autoDerive": "Auto-derive from image",
    "deriving": "Analyzing image...",
    "addSegment": "Add Segment",
    "segmentPrompt": "Segment prompt",
    "segmentPromptPlaceholder": "Describe what happens in this stage...",
    "lighting": "Lighting / Time of day",
    "regenerate": "Regenerate",
    "assemble": "Assemble Video",
    "assembling": "Assembling...",
    "retry": "Retry",
    "pending": "Pending",
    "done": "Done",
    "failed": "Failed",
    "deleteSegment": "Delete segment",
    "deleteProject": "Delete project",
    "setup": "Setup",
    "segments": "Segments",
    "export": "Export",
    "noProjects": "No transform projects yet",
    "createNew": "Create New",
    "composedPrompt": "Composed prompt (read-only)",
    "provider": "Generation Provider",
    "resultReady": "Your transformation video is ready!",
    "allSegmentsDone": "All segments completed. Ready to assemble.",
    "segmentsIncomplete": "Complete all segments before assembling.",
    "confirmDelete": "Are you sure you want to delete this project?",
    "convertedToAdvanced": "Converted to advanced project"
  }
```

- [ ] **Step 2: Add Vietnamese translations**

In `apps/web/src/i18n/locales/vi.json`, add the same structure with Vietnamese translations:

Nav key:
```json
    "transformStudio": "Xưởng Biến Đổi",
```

Top-level namespace:
```json
  "transformStudio": {
    "title": "Xưởng Biến Đổi",
    "quickMode": "Chế độ Nhanh",
    "advancedMode": "Chế độ Nâng cao",
    "uploadImage": "Tải ảnh nguồn lên",
    "uploadImageHint": "Tải ảnh 'trước' (trạng thái ban đầu)",
    "instruction": "Mô tả sự biến đổi",
    "instructionPlaceholder": "VD: Biến ban công trống thành sân thượng ấm cúng với đèn dây lúc hoàng hôn...",
    "generate": "Tạo",
    "generating": "Đang tạo...",
    "download": "Tải xuống",
    "sendToAdvanced": "Chuyển sang Nâng cao",
    "lockedCameraAnchor": "Mô tả nền cố định",
    "lockedCameraAnchorHint": "Mô tả các yếu tố không đổi (nhà, lan can, núi...)",
    "autoDerive": "Tự phân tích từ ảnh",
    "deriving": "Đang phân tích ảnh...",
    "addSegment": "Thêm Phân đoạn",
    "segmentPrompt": "Prompt phân đoạn",
    "segmentPromptPlaceholder": "Mô tả điều gì xảy ra ở giai đoạn này...",
    "lighting": "Ánh sáng / Thời điểm trong ngày",
    "regenerate": "Tạo lại",
    "assemble": "Ghép Video",
    "assembling": "Đang ghép...",
    "retry": "Thử lại",
    "pending": "Chờ",
    "done": "Xong",
    "failed": "Thất bại",
    "deleteSegment": "Xóa phân đoạn",
    "deleteProject": "Xóa dự án",
    "setup": "Thiết lập",
    "segments": "Phân đoạn",
    "export": "Xuất",
    "noProjects": "Chưa có dự án biến đổi nào",
    "createNew": "Tạo mới",
    "composedPrompt": "Prompt hoàn chỉnh (chỉ đọc)",
    "provider": "Nhà cung cấp",
    "resultReady": "Video biến đổi đã sẵn sàng!",
    "allSegmentsDone": "Tất cả phân đoạn hoàn tất. Sẵn sàng ghép.",
    "segmentsIncomplete": "Hoàn tất tất cả phân đoạn trước khi ghép.",
    "confirmDelete": "Bạn có chắc muốn xóa dự án này?",
    "convertedToAdvanced": "Đã chuyển sang dự án nâng cao"
  }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/vi.json
git commit -m "feat(transform): add i18n keys for Transform Studio (en + vi)"
```

---

### Task 5: Frontend — API Client

**Files:**
- Modify: `apps/web/src/lib/api.ts:1427` (append after last API namespace)

- [ ] **Step 1: Add transformApi namespace**

In `apps/web/src/lib/api.ts`, after line 1427 (closing `};` of `scriptStudioApi`), add:

```typescript
// ── Transform Studio ──

export const transformApi = {
  // Projects
  listProjects: () =>
    api.get<{ projects: any[] }>('/transform/projects').then((r) => r.data.projects),

  getProject: (id: string) =>
    api.get<{ project: any }>(`/transform/projects/${id}`).then((r) => r.data.project),

  createProject: (data: { mode: string; lockedCameraAnchor?: string; sourceImagePath?: string; instruction?: string }) =>
    api.post<{ project: any }>('/transform/projects', data).then((r) => r.data.project),

  updateProject: (id: string, data: Record<string, unknown>) =>
    api.put<{ project: any }>(`/transform/projects/${id}`, data).then((r) => r.data.project),

  deleteProject: (id: string) =>
    api.delete(`/transform/projects/${id}`),

  // Quick mode
  createQuickJob: (data: { sourceImagePath: string; instruction: string }) =>
    api.post<{ project: any }>('/transform/quick', data).then((r) => r.data.project),

  convertToAdvanced: (id: string) =>
    api.post<{ project: any }>(`/transform/quick/${id}/to-advanced`).then((r) => r.data.project),

  // Segments
  addSegment: (projectId: string, data: { prompt: string; lighting: string; order: number }) =>
    api.post<{ segment: any }>(`/transform/projects/${projectId}/segments`, data).then((r) => r.data.segment),

  updateSegment: (id: string, data: Record<string, unknown>) =>
    api.put<{ segment: any }>(`/transform/segments/${id}`, data).then((r) => r.data.segment),

  deleteSegment: (id: string) =>
    api.delete(`/transform/segments/${id}`),

  reorderSegments: (projectId: string, segmentIds: string[]) =>
    api.post(`/transform/projects/${projectId}/segments/reorder`, { segmentIds }),

  // Prompts & assembly
  buildPrompts: (projectId: string) =>
    api.post<{ prompts: Array<{ segmentId: string; composedPrompt: string }> }>(`/transform/projects/${projectId}/build-prompts`).then((r) => r.data.prompts),

  deriveAnchor: (projectId: string) =>
    api.post<{ anchor: string }>(`/transform/projects/${projectId}/derive-anchor`).then((r) => r.data.anchor),

  assemble: (projectId: string) =>
    api.post<{ project: any; outputPath: string; url: string }>(`/transform/projects/${projectId}/assemble`).then((r) => r.data),
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(transform): add transformApi client"
```

---

### Task 6: Frontend — Zustand Store

**Files:**
- Create: `apps/web/src/store/transform.ts`

- [ ] **Step 1: Create the transform store**

Create `apps/web/src/store/transform.ts`:

```typescript
import { create } from 'zustand';

export interface TransformSegmentStatus {
  segmentId: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  progress: string[];
  resultUrl: string | null;
  error: string | null;
}

interface QuickJobState {
  projectId: string;
  status: 'idle' | 'generating' | 'done' | 'failed';
  progress: string[];
  resultUrl: string | null;
  error: string | null;
}

// Track cleanup functions and session IDs outside the store (same pattern as ImageGenStore)
const transformCleanups = new Map<string, () => void>();
const transformSessionIds = new Map<string, string>();

function generateSessionId(): string {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

interface TransformStore {
  // Quick mode
  quickJob: QuickJobState | null;
  setQuickJob: (job: QuickJobState | null) => void;

  // Advanced mode segment statuses
  segmentStatuses: Map<string, TransformSegmentStatus>;
  updateSegmentStatus: (segmentId: string, update: Partial<TransformSegmentStatus>) => void;
  clearSegmentStatuses: () => void;

  // Extension bridge — start generation for a single prompt
  startGeneration: (
    key: string,
    prompt: string,
    mediaType: 'image' | 'video',
    provider: 'google-flow' | 'grok' | 'chatgpt',
    onDone: (result: { filename: string; url: string }) => void,
    onError: (error: string) => void,
  ) => void;

  stopGeneration: (key: string) => void;
}

export const useTransformStore = create<TransformStore>((set, get) => ({
  quickJob: null,
  setQuickJob: (job) => set({ quickJob: job }),

  segmentStatuses: new Map(),
  updateSegmentStatus: (segmentId, update) =>
    set((s) => {
      const next = new Map(s.segmentStatuses);
      const existing = next.get(segmentId) || {
        segmentId,
        status: 'pending' as const,
        progress: [],
        resultUrl: null,
        error: null,
      };
      next.set(segmentId, { ...existing, ...update });
      return { segmentStatuses: next };
    }),
  clearSegmentStatuses: () => set({ segmentStatuses: new Map() }),

  startGeneration: (key, prompt, mediaType, provider, onDone, onError) => {
    // Clean up any existing listeners for this key
    const oldCleanup = transformCleanups.get(key);
    if (oldCleanup) oldCleanup();

    const sessionId = generateSessionId();
    transformSessionIds.set(key, sessionId);

    const onProgress = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      if (d.detail) {
        // Update progress for quick job or segment
        const quickJob = get().quickJob;
        if (quickJob && key === quickJob.projectId) {
          set({ quickJob: { ...quickJob, progress: [...quickJob.progress, d.detail] } });
        } else {
          get().updateSegmentStatus(key, {
            progress: [...(get().segmentStatuses.get(key)?.progress || []), d.detail],
          });
        }
      }
    };

    const onImage = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      if (d.status === 'done') {
        onDone({ filename: d.filename, url: d.url });
      } else if (d.status === 'error') {
        onError(d.error || 'Generation failed');
      }
    };

    const onVideo = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      if (d.status === 'done') {
        onDone({ filename: d.filename, url: d.url });
      } else if (d.status === 'error') {
        onError(d.error || 'Generation failed');
      }
    };

    const onDoneEvent = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      cleanup();
    };

    const onErrorEvent = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      onError(d.error || 'Extension error');
      cleanup();
    };

    window.addEventListener('Han2YT_transform_progress', onProgress);
    window.addEventListener('Han2YT_transform_image', onImage);
    window.addEventListener('Han2YT_transform_video', onVideo);
    window.addEventListener('Han2YT_transform_done', onDoneEvent);
    window.addEventListener('Han2YT_transform_error', onErrorEvent);

    const cleanup = () => {
      window.removeEventListener('Han2YT_transform_progress', onProgress);
      window.removeEventListener('Han2YT_transform_image', onImage);
      window.removeEventListener('Han2YT_transform_video', onVideo);
      window.removeEventListener('Han2YT_transform_done', onDoneEvent);
      window.removeEventListener('Han2YT_transform_error', onErrorEvent);
      transformCleanups.delete(key);
      transformSessionIds.delete(key);
    };
    transformCleanups.set(key, cleanup);

    // Dispatch start event to Chrome extension
    window.dispatchEvent(
      new CustomEvent('Han2YT_transform_start', {
        detail: {
          prompts: [{ prompt, timestamp: Date.now().toString() }],
          delayMin: 5,
          delayMax: 15,
          mediaType,
          provider,
          sessionId,
        },
      }),
    );
  },

  stopGeneration: (key) => {
    const cleanup = transformCleanups.get(key);
    if (cleanup) cleanup();
    window.dispatchEvent(new CustomEvent('Han2YT_transform_stop'));
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/store/transform.ts
git commit -m "feat(transform): add Zustand transform store with Han2YT_transform_* bridge"
```

---

### Task 7: Frontend — TransformStudio Page + Quick Mode

**Files:**
- Create: `apps/web/src/pages/transform/TransformStudio.tsx`
- Create: `apps/web/src/pages/transform/QuickMode.tsx`
- Create: `apps/web/src/pages/transform/index.ts`

- [ ] **Step 1: Create the index barrel export**

Create `apps/web/src/pages/transform/index.ts`:

```typescript
export { TransformStudio } from './TransformStudio';
```

- [ ] **Step 2: Create TransformStudio (mode toggle + routing)**

Create `apps/web/src/pages/transform/TransformStudio.tsx`:

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wand2 } from 'lucide-react';
import { QuickMode } from './QuickMode';
import { SetupPanel } from './AdvancedMode/SetupPanel';
import { SegmentList } from './AdvancedMode/SegmentList';
import { AssemblePanel } from './AdvancedMode/AssemblePanel';

export function TransformStudio() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'quick' | 'advanced'>('quick');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Wand2 className="w-6 h-6 text-purple-400" />
          <h1 className="text-2xl font-bold">{t('transformStudio.title')}</h1>
        </div>

        {/* Mode Toggle */}
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          <button
            onClick={() => setMode('quick')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'quick'
                ? 'bg-purple-600 text-white'
                : 'bg-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t('transformStudio.quickMode')}
          </button>
          <button
            onClick={() => setMode('advanced')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              mode === 'advanced'
                ? 'bg-purple-600 text-white'
                : 'bg-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t('transformStudio.advancedMode')}
          </button>
        </div>
      </div>

      {/* Content */}
      {mode === 'quick' ? (
        <QuickMode
          onSendToAdvanced={(projectId) => {
            setActiveProjectId(projectId);
            setMode('advanced');
          }}
        />
      ) : (
        <div className="space-y-6">
          <SetupPanel
            activeProjectId={activeProjectId}
            onProjectCreated={setActiveProjectId}
          />
          {activeProjectId && (
            <>
              <SegmentList projectId={activeProjectId} />
              <AssemblePanel projectId={activeProjectId} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create QuickMode component**

Create `apps/web/src/pages/transform/QuickMode.tsx`:

```typescript
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Play, Download, ArrowRight, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { transformApi, imageApi } from '../../lib/api';
import { useTransformStore } from '../../store/transform';

interface QuickModeProps {
  onSendToAdvanced: (projectId: string) => void;
}

export function QuickMode({ onSendToAdvanced }: QuickModeProps) {
  const { t } = useTranslation();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [provider, setProvider] = useState<'google-flow' | 'grok' | 'chatgpt'>('google-flow');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const quickJob = useTransformStore((s) => s.quickJob);
  const setQuickJob = useTransformStore((s) => s.setQuickJob);
  const startGeneration = useTransformStore((s) => s.startGeneration);
  const stopGeneration = useTransformStore((s) => s.stopGeneration);

  const createQuickMutation = useMutation({
    mutationFn: transformApi.createQuickJob,
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => transformApi.convertToAdvanced(id),
    onSuccess: (project) => {
      onSendToAdvanced(project.id);
    },
  });

  const handleImageUpload = async (file: File) => {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleGenerate = async () => {
    if (!imageFile || !instruction.trim()) return;

    // Upload image first
    const formData = new FormData();
    formData.append('file', imageFile);
    let uploadedPath: string;
    try {
      const result = await imageApi.upload(formData);
      uploadedPath = result.filename;
    } catch {
      setQuickJob({ projectId: '', status: 'failed', progress: ['Failed to upload image'], resultUrl: null, error: 'Upload failed' });
      return;
    }

    // Create quick project
    try {
      const project = await createQuickMutation.mutateAsync({
        sourceImagePath: uploadedPath,
        instruction: instruction.trim(),
      });

      setQuickJob({
        projectId: project.id,
        status: 'generating',
        progress: ['Starting generation...'],
        resultUrl: null,
        error: null,
      });

      // Build the prompt using the project's derived anchor
      const anchor = project.lockedCameraAnchor || 'the scene as shown';
      const composedPrompt = [
        'Static locked-off camera, same angle throughout, no camera movement.',
        `Consistent background: ${anchor}.`,
        `Current stage: ${instruction.trim()}.`,
        'Lighting: natural daylight.',
        'Photorealistic, vertical 9:16, no on-screen text, no camera movement.',
      ].join('\n');

      // Dispatch to Chrome extension
      startGeneration(
        project.id,
        composedPrompt,
        'video',
        provider,
        (result) => {
          // Update segment asset path on server
          transformApi.updateProject(project.id, { status: 'completed', resultPath: result.url });
          setQuickJob({
            projectId: project.id,
            status: 'done',
            progress: [...(useTransformStore.getState().quickJob?.progress || []), 'Generation complete!'],
            resultUrl: result.url,
            error: null,
          });
        },
        (error) => {
          setQuickJob({
            projectId: project.id,
            status: 'failed',
            progress: [...(useTransformStore.getState().quickJob?.progress || []), `Error: ${error}`],
            resultUrl: null,
            error,
          });
        },
      );
    } catch (err) {
      setQuickJob({ projectId: '', status: 'failed', progress: [`Error: ${(err as Error).message}`], resultUrl: null, error: (err as Error).message });
    }
  };

  const isGenerating = quickJob?.status === 'generating';
  const isDone = quickJob?.status === 'done';
  const isFailed = quickJob?.status === 'failed';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Image Upload */}
      <div className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center hover:border-purple-500/50 transition-colors">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
        />
        {imagePreview ? (
          <div className="space-y-4">
            <img src={imagePreview} alt="Source" className="max-h-64 mx-auto rounded-lg" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-sm text-purple-400 hover:text-purple-300"
            >
              {t('transformStudio.uploadImage')}
            </button>
          </div>
        ) : (
          <button onClick={() => fileInputRef.current?.click()} className="space-y-3">
            <Upload className="w-12 h-12 mx-auto text-gray-500" />
            <p className="text-gray-400">{t('transformStudio.uploadImage')}</p>
            <p className="text-xs text-gray-600">{t('transformStudio.uploadImageHint')}</p>
          </button>
        )}
      </div>

      {/* Instruction */}
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={t('transformStudio.instructionPlaceholder')}
        className="w-full h-32 bg-white/5 border border-white/10 rounded-lg p-4 text-sm resize-none focus:outline-none focus:border-purple-500/50"
      />

      {/* Provider selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-400">{t('transformStudio.provider')}:</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as typeof provider)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        >
          <option value="google-flow">Google Flow</option>
          <option value="grok">Grok</option>
          <option value="chatgpt">ChatGPT</option>
        </select>
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!imageFile || !instruction.trim() || isGenerating}
        className="w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('transformStudio.generating')}
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            {t('transformStudio.generate')}
          </>
        )}
      </button>

      {/* Progress log */}
      {quickJob && quickJob.progress.length > 0 && (
        <div className="bg-black/30 rounded-lg p-4 max-h-40 overflow-auto">
          <div className="font-mono text-xs space-y-1">
            {quickJob.progress.map((line, i) => (
              <div key={i} className={i === quickJob.progress.length - 1 ? 'text-purple-300' : 'text-gray-500'}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {isFailed && quickJob?.error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {quickJob.error}
        </div>
      )}

      {/* Result */}
      {isDone && quickJob?.resultUrl && (
        <div className="space-y-4 bg-white/5 rounded-xl p-6">
          <p className="text-green-400 font-medium">{t('transformStudio.resultReady')}</p>
          <video src={quickJob.resultUrl} controls className="w-full rounded-lg" />
          <div className="flex gap-3">
            <a
              href={quickJob.resultUrl}
              download
              className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-center flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              {t('transformStudio.download')}
            </a>
            <button
              onClick={() => quickJob.projectId && convertMutation.mutate(quickJob.projectId)}
              disabled={convertMutation.isPending}
              className="flex-1 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-center flex items-center justify-center gap-2 transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              {t('transformStudio.sendToAdvanced')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/transform/
git commit -m "feat(transform): add TransformStudio page and QuickMode component"
```

---

### Task 8: Frontend — Advanced Mode Components

**Files:**
- Create: `apps/web/src/pages/transform/AdvancedMode/SetupPanel.tsx`
- Create: `apps/web/src/pages/transform/AdvancedMode/SegmentList.tsx`
- Create: `apps/web/src/pages/transform/AdvancedMode/SegmentEditor.tsx`
- Create: `apps/web/src/pages/transform/AdvancedMode/AssemblePanel.tsx`

- [ ] **Step 1: Create SetupPanel**

Create `apps/web/src/pages/transform/AdvancedMode/SetupPanel.tsx`:

```typescript
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Sparkles, Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { transformApi, imageApi } from '../../../lib/api';

interface SetupPanelProps {
  activeProjectId: string | null;
  onProjectCreated: (id: string) => void;
}

export function SetupPanel({ activeProjectId, onProjectCreated }: SetupPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [anchor, setAnchor] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = useQuery({
    queryKey: ['transform-project', activeProjectId],
    queryFn: () => transformApi.getProject(activeProjectId!),
    enabled: !!activeProjectId,
  });

  // Sync anchor from loaded project
  if (project && anchor === '' && project.lockedCameraAnchor) {
    setAnchor(project.lockedCameraAnchor);
  }

  const createMutation = useMutation({
    mutationFn: (data: { lockedCameraAnchor: string; sourceImagePath?: string }) =>
      transformApi.createProject({ mode: 'advanced', ...data }),
    onSuccess: (project) => {
      onProjectCreated(project.id);
      queryClient.invalidateQueries({ queryKey: ['transform-projects'] });
    },
  });

  const deriveMutation = useMutation({
    mutationFn: (projectId: string) => transformApi.deriveAnchor(projectId),
    onSuccess: (anchorText) => {
      setAnchor(anchorText);
      if (activeProjectId) {
        transformApi.updateProject(activeProjectId, { lockedCameraAnchor: anchorText });
      }
    },
  });

  const updateAnchorMutation = useMutation({
    mutationFn: (newAnchor: string) => {
      if (!activeProjectId) throw new Error('No project');
      return transformApi.updateProject(activeProjectId, { lockedCameraAnchor: newAnchor });
    },
  });

  const handleImageUpload = async (file: File) => {
    setImagePreview(URL.createObjectURL(file));
    const formData = new FormData();
    formData.append('file', file);
    try {
      const result = await imageApi.upload(formData);
      if (!activeProjectId) {
        const project = await createMutation.mutateAsync({
          lockedCameraAnchor: anchor,
          sourceImagePath: result.filename,
        });
        // Auto-seed default segments for new projects
        const defaults = [
          { prompt: 'Empty room / bare space — starting state', lighting: 'natural daylight', order: 0 },
          { prompt: 'Preparation and cleanup — clearing debris', lighting: 'morning light', order: 1 },
          { prompt: 'Flooring and base elements installed', lighting: 'midday sun', order: 2 },
          { prompt: 'Furniture placement — key pieces arranged', lighting: 'afternoon light', order: 3 },
          { prompt: 'Decorative touches — plants, cushions, art', lighting: 'golden hour', order: 4 },
          { prompt: 'Final reveal with full styling complete', lighting: 'dusk with warm string lights', order: 5 },
        ];
        for (const seg of defaults) {
          await transformApi.addSegment(project.id, seg);
        }
        queryClient.invalidateQueries({ queryKey: ['transform-project', project.id] });
      } else {
        await transformApi.updateProject(activeProjectId, { sourceImagePath: result.filename });
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }
  };

  return (
    <div className="bg-white/5 rounded-xl p-6 space-y-4">
      <h2 className="text-lg font-semibold">{t('transformStudio.setup')}</h2>

      {/* Source image upload */}
      <div className="border-2 border-dashed border-white/20 rounded-lg p-6 text-center">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
        />
        {imagePreview || project?.sourceImagePath ? (
          <div className="space-y-3">
            <img
              src={imagePreview || `/api/image/file/${project?.sourceImagePath}`}
              alt="Source"
              className="max-h-48 mx-auto rounded-lg"
            />
            <button onClick={() => fileInputRef.current?.click()} className="text-sm text-purple-400 hover:text-purple-300">
              Change image
            </button>
          </div>
        ) : (
          <button onClick={() => fileInputRef.current?.click()} className="space-y-2">
            <Upload className="w-10 h-10 mx-auto text-gray-500" />
            <p className="text-gray-400 text-sm">{t('transformStudio.uploadImage')}</p>
          </button>
        )}
      </div>

      {/* Locked Camera Anchor */}
      <div className="space-y-2">
        <label className="text-sm text-gray-400">{t('transformStudio.lockedCameraAnchor')}</label>
        <textarea
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
          onBlur={() => activeProjectId && anchor && updateAnchorMutation.mutate(anchor)}
          placeholder={t('transformStudio.lockedCameraAnchorHint')}
          className="w-full h-20 bg-white/5 border border-white/10 rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-purple-500/50"
        />
        {activeProjectId && project?.sourceImagePath && (
          <button
            onClick={() => deriveMutation.mutate(activeProjectId)}
            disabled={deriveMutation.isPending}
            className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 disabled:opacity-50"
          >
            {deriveMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {deriveMutation.isPending ? t('transformStudio.deriving') : t('transformStudio.autoDerive')}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create SegmentEditor**

Create `apps/web/src/pages/transform/AdvancedMode/SegmentEditor.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, RotateCcw, Trash2, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { transformApi } from '../../../lib/api';
import { useTransformStore } from '../../../store/transform';

interface Segment {
  id: string;
  projectId: string;
  segmentOrder: number;
  prompt: string;
  lighting: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  assetPath: string | null;
}

interface SegmentEditorProps {
  segment: Segment;
  lockedCameraAnchor: string;
  provider: 'google-flow' | 'grok' | 'chatgpt';
}

export function SegmentEditor({ segment, lockedCameraAnchor, provider }: SegmentEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState(segment.prompt);
  const [lighting, setLighting] = useState(segment.lighting);
  const startGeneration = useTransformStore((s) => s.startGeneration);
  const segmentStatus = useTransformStore((s) => s.segmentStatuses.get(segment.id));
  const updateSegmentStatus = useTransformStore((s) => s.updateSegmentStatus);

  useEffect(() => {
    setPrompt(segment.prompt);
    setLighting(segment.lighting);
  }, [segment.id, segment.prompt, segment.lighting]);

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => transformApi.updateSegment(segment.id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transform-project', segment.projectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => transformApi.deleteSegment(segment.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transform-project', segment.projectId] }),
  });

  const handleSave = () => {
    if (prompt !== segment.prompt || lighting !== segment.lighting) {
      updateMutation.mutate({ prompt, lighting });
    }
  };

  const handleGenerate = () => {
    handleSave();
    updateSegmentStatus(segment.id, { status: 'generating', progress: ['Starting...'], error: null });

    const composedPrompt = [
      'Static locked-off camera, same angle throughout, no camera movement.',
      `Consistent background: ${lockedCameraAnchor}.`,
      `Current stage: ${prompt}.`,
      `Lighting: ${lighting}.`,
      'Photorealistic, vertical 9:16, no on-screen text, no camera movement.',
    ].join('\n');

    startGeneration(
      segment.id,
      composedPrompt,
      'video',
      provider,
      (result) => {
        updateSegmentStatus(segment.id, { status: 'done', resultUrl: result.url });
        transformApi.updateSegment(segment.id, { status: 'done', assetPath: result.filename });
        queryClient.invalidateQueries({ queryKey: ['transform-project', segment.projectId] });
      },
      (error) => {
        updateSegmentStatus(segment.id, { status: 'failed', error });
        const retries = (segment as any).retries || 0;
        transformApi.updateSegment(segment.id, { status: 'failed', retries: retries + 1 });
        queryClient.invalidateQueries({ queryKey: ['transform-project', segment.projectId] });
      },
    );
  };

  const isGenerating = segmentStatus?.status === 'generating' || segment.status === 'generating';
  const isDone = segment.status === 'done';
  const isFailed = segment.status === 'failed';

  const statusIcon = isGenerating ? <Loader2 className="w-4 h-4 animate-spin text-yellow-400" />
    : isDone ? <CheckCircle className="w-4 h-4 text-green-400" />
    : isFailed ? <XCircle className="w-4 h-4 text-red-400" />
    : <div className="w-4 h-4 rounded-full border border-gray-600" />;

  return (
    <div className="bg-white/5 rounded-lg p-4 space-y-3 border border-white/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {statusIcon}
          <span className="text-sm font-medium">#{segment.segmentOrder + 1}</span>
        </div>
        <button
          onClick={() => deleteMutation.mutate()}
          className="text-gray-500 hover:text-red-400 transition-colors"
          title={t('transformStudio.deleteSegment')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={handleSave}
        placeholder={t('transformStudio.segmentPromptPlaceholder')}
        className="w-full h-20 bg-white/5 border border-white/10 rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-purple-500/50"
      />

      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-500">{t('transformStudio.lighting')}:</label>
        <input
          value={lighting}
          onChange={(e) => setLighting(e.target.value)}
          onBlur={handleSave}
          className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm focus:outline-none focus:border-purple-500/50"
        />
      </div>

      {/* Progress */}
      {segmentStatus?.progress && segmentStatus.progress.length > 0 && isGenerating && (
        <div className="bg-black/30 rounded p-2 max-h-20 overflow-auto font-mono text-[10px] text-gray-500">
          {segmentStatus.progress.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {/* Error */}
      {segmentStatus?.error && (
        <div className="text-xs text-red-400">{segmentStatus.error}</div>
      )}

      {/* Asset preview */}
      {isDone && segment.assetPath && (
        <video src={`/api/image/file/${segment.assetPath}`} controls className="w-full rounded max-h-40" />
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : isDone || isFailed ? <RotateCcw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {isDone || isFailed ? t('transformStudio.regenerate') : t('transformStudio.generate')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create SegmentList**

Create `apps/web/src/pages/transform/AdvancedMode/SegmentList.tsx`:

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { transformApi } from '../../../lib/api';
import { SegmentEditor } from './SegmentEditor';

interface SegmentListProps {
  projectId: string;
}

export function SegmentList({ projectId }: SegmentListProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<'google-flow' | 'grok' | 'chatgpt'>('google-flow');

  const { data: project } = useQuery({
    queryKey: ['transform-project', projectId],
    queryFn: () => transformApi.getProject(projectId),
  });

  const addSegmentMutation = useMutation({
    mutationFn: () => {
      const order = (project?.segments?.length || 0);
      return transformApi.addSegment(projectId, { prompt: '', lighting: 'natural daylight', order });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transform-project', projectId] }),
  });

  const segments = project?.segments || [];

  return (
    <div className="bg-white/5 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('transformStudio.segments')} ({segments.length})</h2>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-400">{t('transformStudio.provider')}:</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm focus:outline-none"
          >
            <option value="google-flow">Google Flow</option>
            <option value="grok">Grok</option>
            <option value="chatgpt">ChatGPT</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {segments.map((seg: any) => (
          <SegmentEditor
            key={seg.id}
            segment={seg}
            lockedCameraAnchor={project?.lockedCameraAnchor || ''}
            provider={provider}
          />
        ))}
      </div>

      <button
        onClick={() => addSegmentMutation.mutate()}
        className="w-full py-2 border border-dashed border-white/20 rounded-lg text-sm text-gray-400 hover:text-white hover:border-purple-500/50 flex items-center justify-center gap-2 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {t('transformStudio.addSegment')}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create AssemblePanel**

Create `apps/web/src/pages/transform/AdvancedMode/AssemblePanel.tsx`:

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, Download, Loader2 } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { transformApi } from '../../../lib/api';

interface AssemblePanelProps {
  projectId: string;
}

export function AssemblePanel({ projectId }: AssemblePanelProps) {
  const { t } = useTranslation();
  const [assembleResult, setAssembleResult] = useState<{ url: string } | null>(null);

  const { data: project } = useQuery({
    queryKey: ['transform-project', projectId],
    queryFn: () => transformApi.getProject(projectId),
  });

  const assembleMutation = useMutation({
    mutationFn: () => transformApi.assemble(projectId),
    onSuccess: (data) => {
      setAssembleResult({ url: data.url });
    },
  });

  const segments = project?.segments || [];
  const allDone = segments.length > 0 && segments.every((s: any) => s.status === 'done');
  const doneCount = segments.filter((s: any) => s.status === 'done').length;

  return (
    <div className="bg-white/5 rounded-xl p-6 space-y-4">
      <h2 className="text-lg font-semibold">{t('transformStudio.export')}</h2>

      <div className="text-sm text-gray-400">
        {allDone
          ? t('transformStudio.allSegmentsDone')
          : `${t('transformStudio.segmentsIncomplete')} (${doneCount}/${segments.length})`
        }
      </div>

      <button
        onClick={() => assembleMutation.mutate()}
        disabled={!allDone || assembleMutation.isPending}
        className="w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {assembleMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('transformStudio.assembling')}
          </>
        ) : (
          <>
            <Film className="w-4 h-4" />
            {t('transformStudio.assemble')}
          </>
        )}
      </button>

      {assembleMutation.isError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
          {(assembleMutation.error as Error).message}
        </div>
      )}

      {assembleResult && (
        <div className="space-y-4">
          <p className="text-green-400 font-medium">{t('transformStudio.resultReady')}</p>
          <video src={assembleResult.url} controls className="w-full rounded-lg" />
          <a
            href={assembleResult.url}
            download
            className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-700 text-center flex items-center justify-center gap-2 transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('transformStudio.download')}
          </a>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/transform/AdvancedMode/
git commit -m "feat(transform): add Advanced Mode components (Setup, SegmentList, SegmentEditor, Assemble)"
```

---

### Task 9: Frontend — Wire Up Routes + Sidebar

**Files:**
- Modify: `apps/web/src/App.tsx:20,54` (import + route)
- Modify: `apps/web/src/components/layout/Sidebar.tsx:3,22,56` (import icon + nav item)

- [ ] **Step 1: Add route in App.tsx**

In `apps/web/src/App.tsx`:

Add import after line 20 (`import ScriptDoc ...`):
```typescript
import { TransformStudio } from './pages/transform';
```

Add route after line 54 (`<Route path="/script-studio/:id" ...`):
```typescript
            <Route path="/transform" element={<TransformStudio />} />
```

- [ ] **Step 2: Add sidebar nav item**

In `apps/web/src/components/layout/Sidebar.tsx`:

Add `Wand2` to the lucide-react import on line 3-23 (add it to the existing destructured imports):
```typescript
  Wand2,
```

Add nav item after line 56 (`{ path: '/script-studio', icon: BookOpen, label: t('nav.scriptStudio') },`):
```typescript
    { path: '/transform', icon: Wand2, label: t('nav.transformStudio') },
```

- [ ] **Step 3: Verify the page loads**

Run dev server: `npm run dev`
Navigate to `http://localhost:5174/transform`
Expected: Transform Studio page renders with Quick/Advanced mode toggle.
Verify sidebar shows "Transform Studio" with a wand icon.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(transform): wire up /transform route and sidebar nav"
```

---

### Task 10: Verify End-to-End + Fix Issues

- [ ] **Step 1: Verify backend API**

Test project CRUD:
```bash
# Create project
curl -X POST http://localhost:3002/api/transform/projects -H 'Content-Type: application/json' -d '{"mode":"advanced","lockedCameraAnchor":"A balcony with mountain view"}'

# List projects
curl http://localhost:3002/api/transform/projects

# Add segment
curl -X POST http://localhost:3002/api/transform/projects/<ID>/segments -H 'Content-Type: application/json' -d '{"prompt":"Empty balcony","lighting":"morning light","order":0}'

# Build prompts
curl -X POST http://localhost:3002/api/transform/projects/<ID>/build-prompts

# Delete project
curl -X DELETE http://localhost:3002/api/transform/projects/<ID>
```

Expected: All return proper JSON responses with correct data.

- [ ] **Step 2: Verify frontend renders**

Open `http://localhost:5174/transform`:
1. Quick Mode: Upload image, type instruction, verify UI elements render
2. Switch to Advanced Mode: Verify setup panel renders
3. Sidebar: "Transform Studio" appears with wand icon, clicking navigates correctly

- [ ] **Step 3: Verify isolation**

Confirm:
- No imports from `image-generation.ts` in any transform file
- No references to `storyboard`, `videos`, `drama` tables in transform service
- `Han2YT_transform_*` event names used (not `Han2YT_flow_*`)
- i18n keys under `transformStudio` namespace (not conflicting with `videoEditor.transform`)

- [ ] **Step 4: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix(transform): address integration issues from end-to-end verification"
```

---

### Task 11: Final Image Upload Integration Fix

The `imageApi.upload` call in QuickMode uses `FormData`, but the existing upload endpoint at `/api/image/upload` may expect a different format. Verify and fix.

**Files:**
- Possibly modify: `apps/web/src/pages/transform/QuickMode.tsx`

- [ ] **Step 1: Check existing image upload API**

Read `apps/server/src/routes/image.routes.ts` to verify the upload endpoint signature. The existing endpoint may use data URLs (base64) rather than FormData. If so, update QuickMode to convert the file to a data URL before uploading:

```typescript
const reader = new FileReader();
reader.onload = async () => {
  const dataUrl = reader.result as string;
  const result = await imageApi.uploadDataUrl(dataUrl);
  // use result.filename
};
reader.readAsDataURL(file);
```

Adjust based on what the actual API expects.

- [ ] **Step 2: Test image upload flow**

Upload an image in Quick Mode and verify it saves correctly and the path is usable.

- [ ] **Step 3: Commit if changes needed**

```bash
git add apps/web/src/pages/transform/QuickMode.tsx
git commit -m "fix(transform): fix image upload integration"
```
