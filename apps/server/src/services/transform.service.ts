import * as fs from 'fs';
import * as path from 'path';
import { dbGet, dbAll, dbRun } from '../db';
import { getSettings } from './settings.service';
import { resolveFfmpegPathSync } from './import.service';
import type { VideoTimeline, TimelineClip } from '@videocloudai/shared';

// ── Types ──

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

// ── Mapping ──

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

// ── Service ──

export class TransformService {

  // ── Project CRUD ──

  createProject(input: {
    mode?: 'quick' | 'advanced';
    sourceImagePath?: string;
    instruction?: string;
    lockedCameraAnchor?: string;
  }): TransformProject {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO transform_projects (id, mode, locked_camera_anchor, source_image_path, instruction, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        id,
        input.mode ?? 'quick',
        input.lockedCameraAnchor ?? '',
        input.sourceImagePath ?? null,
        input.instruction ?? '',
        now,
        now,
      ]
    );
    return this.getProject(id)!;
  }

  getProject(id: string): TransformProject | undefined {
    const row = dbGet<DbProject>('SELECT * FROM transform_projects WHERE id = ?', [id]);
    if (!row) return undefined;
    const project = mapProject(row);
    project.segments = this.getSegments(id);
    return project;
  }

  listProjects(): TransformProject[] {
    const rows = dbAll<DbProject>('SELECT * FROM transform_projects ORDER BY created_at DESC');
    return rows.map(mapProject);
  }

  updateProject(id: string, updates: Partial<Pick<TransformProject, 'mode' | 'lockedCameraAnchor' | 'sourceImagePath' | 'instruction' | 'status' | 'resultPath'>>): TransformProject | undefined {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.mode !== undefined) { sets.push('mode = ?'); params.push(updates.mode); }
    if (updates.lockedCameraAnchor !== undefined) { sets.push('locked_camera_anchor = ?'); params.push(updates.lockedCameraAnchor); }
    if (updates.sourceImagePath !== undefined) { sets.push('source_image_path = ?'); params.push(updates.sourceImagePath); }
    if (updates.instruction !== undefined) { sets.push('instruction = ?'); params.push(updates.instruction); }
    if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
    if (updates.resultPath !== undefined) { sets.push('result_path = ?'); params.push(updates.resultPath); }

    if (sets.length === 0) return this.getProject(id);

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    dbRun(`UPDATE transform_projects SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.getProject(id);
  }

  deleteProject(id: string): boolean {
    const { changes } = dbRun('DELETE FROM transform_projects WHERE id = ?', [id]);
    return changes > 0;
  }

  // ── Segment CRUD ──

  addSegment(projectId: string, input: {
    prompt?: string;
    lighting?: string;
    segmentOrder?: number;
  }): TransformSegment {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // If no order specified, append after last segment
    let order = input.segmentOrder;
    if (order === undefined) {
      const last = dbGet<{ max_order: number | null }>(
        'SELECT MAX(segment_order) as max_order FROM transform_segments WHERE project_id = ?',
        [projectId]
      );
      order = (last?.max_order ?? -1) + 1;
    }

    dbRun(
      `INSERT INTO transform_segments (id, project_id, segment_order, prompt, lighting, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, projectId, order, input.prompt ?? '', input.lighting ?? 'natural daylight', now]
    );
    return this.getSegment(id)!;
  }

  getSegment(id: string): TransformSegment | undefined {
    const row = dbGet<DbSegment>('SELECT * FROM transform_segments WHERE id = ?', [id]);
    return row ? mapSegment(row) : undefined;
  }

  getSegments(projectId: string): TransformSegment[] {
    const rows = dbAll<DbSegment>(
      'SELECT * FROM transform_segments WHERE project_id = ? ORDER BY segment_order ASC',
      [projectId]
    );
    return rows.map(mapSegment);
  }

  updateSegment(id: string, updates: Partial<Pick<TransformSegment, 'prompt' | 'lighting' | 'status' | 'assetPath' | 'retries' | 'segmentOrder'>>): TransformSegment | undefined {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.prompt !== undefined) { sets.push('prompt = ?'); params.push(updates.prompt); }
    if (updates.lighting !== undefined) { sets.push('lighting = ?'); params.push(updates.lighting); }
    if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
    if (updates.assetPath !== undefined) { sets.push('asset_path = ?'); params.push(updates.assetPath); }
    if (updates.retries !== undefined) { sets.push('retries = ?'); params.push(updates.retries); }
    if (updates.segmentOrder !== undefined) { sets.push('segment_order = ?'); params.push(updates.segmentOrder); }

    if (sets.length === 0) return this.getSegment(id);

    params.push(id);
    dbRun(`UPDATE transform_segments SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.getSegment(id);
  }

  deleteSegment(id: string): boolean {
    const { changes } = dbRun('DELETE FROM transform_segments WHERE id = ?', [id]);
    return changes > 0;
  }

  reorderSegments(projectId: string, segmentIds: string[]): void {
    for (let i = 0; i < segmentIds.length; i++) {
      dbRun(
        'UPDATE transform_segments SET segment_order = ? WHERE id = ? AND project_id = ?',
        [i, segmentIds[i], projectId]
      );
    }
  }

  // ── Prompt Construction ──

  buildPrompt(anchor: string, segmentPrompt: string, lighting: string): string {
    return [
      'Static locked-off camera, same angle throughout, no camera movement.',
      `Consistent background: ${anchor}.`,
      `Current stage: ${segmentPrompt}.`,
      `Lighting: ${lighting}.`,
      'Photorealistic, vertical 9:16, no on-screen text, no camera movement.',
    ].join('\n');
  }

  buildAllPrompts(projectId: string): { segmentId: string; prompt: string }[] {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const segments = project.segments ?? this.getSegments(projectId);
    return segments.map((seg) => ({
      segmentId: seg.id,
      prompt: this.buildPrompt(project.lockedCameraAnchor, seg.prompt, seg.lighting),
    }));
  }

  // ── LLM Vision — Derive Anchor ──

  async deriveAnchor(imagePath: string): Promise<string> {
    const absolutePath = path.isAbsolute(imagePath) ? imagePath : path.resolve(imagePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Image file not found: ${absolutePath}`);
    }

    const imageBuffer = fs.readFileSync(absolutePath);
    const base64Data = imageBuffer.toString('base64');

    // Detect MIME type from extension
    const ext = path.extname(absolutePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    const mimeType = mimeMap[ext] ?? 'image/jpeg';

    const settings = getSettings();
    const apiKey = settings.get('gemini_api_key') || process.env.GOOGLE_FLOW_API_KEY || '';
    const model = settings.get('gemini_model') || 'gemini-2.5-flash';

    if (!apiKey) {
      throw new Error('No Gemini API key configured. Set gemini_api_key in settings or GOOGLE_FLOW_API_KEY env var.');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: 'Describe the fixed background elements in this image that would remain constant across a time-lapse or transformation sequence. Focus on: the setting/location, architectural elements, furniture, walls, floor, lighting fixtures, and any permanent objects. Do NOT describe people, their clothing, poses, or any transient elements. Output a concise paragraph (2-4 sentences) suitable for use as a "locked camera anchor" description.',
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 300,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini vision API error (${response.status}): ${errText}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini vision API returned no text content');
    }

    return text.trim();
  }

  // ── Assembly ──

  async assembleProject(
    projectId: string,
    onProgress?: (p: { stage: string; percent: number }) => void
  ): Promise<string> {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const segments = project.segments ?? this.getSegments(projectId);
    const doneSegments = segments
      .filter((s) => s.status === 'done' && s.assetPath)
      .sort((a, b) => a.segmentOrder - b.segmentOrder);

    if (doneSegments.length === 0) {
      throw new Error('No completed segments to assemble');
    }

    // Update project status
    this.updateProject(projectId, { status: 'assembling' });

    onProgress?.({ stage: 'Preparing timeline', percent: 5 });

    // Build a VideoTimeline for the assembler
    const clipDuration = 4; // seconds per segment image
    const clips: TimelineClip[] = doneSegments.map((seg, i) => ({
      id: seg.id,
      assetPath: seg.assetPath!,
      startTime: i * clipDuration,
      duration: clipDuration,
      transition: i > 0 ? 'fade' as const : 'cut' as const,
      motionEffect: 'static' as const,
    }));

    const timeline: VideoTimeline = {
      videoId: projectId,
      clips,
      totalDuration: clips.length * clipDuration,
    };

    // Resolve output path
    const rendersDir = process.env.RENDERS_DIR ?? path.resolve('renders');
    fs.mkdirSync(rendersDir, { recursive: true });
    const outputPath = path.join(rendersDir, `transform_${projectId}.mp4`);

    try {
      // Dynamic import to avoid circular dependencies
      const { VideoAssembler } = await import('@videocloudai/ffmpeg');

      const assembler = new VideoAssembler({
        ffmpegPath: resolveFfmpegPathSync('ffmpeg'),
        ffprobePath: resolveFfmpegPathSync('ffprobe'),
        width: 1080,
        height: 1920,
        fps: 24,
        outputDir: rendersDir,
      });

      await assembler.assembleVideo(timeline, outputPath, (p) => {
        onProgress?.({ stage: p.stage, percent: p.percent });
      });

      this.updateProject(projectId, { status: 'done', resultPath: outputPath });
      onProgress?.({ stage: 'Complete', percent: 100 });
      return outputPath;
    } catch (err) {
      this.updateProject(projectId, { status: 'failed' });
      throw err;
    }
  }

  // ── Convert Quick → Advanced ──

  convertToAdvanced(quickProjectId: string): TransformProject {
    const quick = this.getProject(quickProjectId);
    if (!quick) throw new Error(`Project ${quickProjectId} not found`);
    if (quick.mode !== 'quick') throw new Error('Project is already in advanced mode');

    const advanced = this.createProject({
      mode: 'advanced',
      sourceImagePath: quick.sourceImagePath ?? undefined,
      lockedCameraAnchor: quick.lockedCameraAnchor,
      instruction: quick.instruction,
    });

    // If the quick project has a result, add it as the first segment
    if (quick.resultPath && fs.existsSync(quick.resultPath)) {
      this.addSegment(advanced.id, {
        prompt: quick.instruction || 'Initial transformation',
        lighting: 'natural daylight',
        segmentOrder: 0,
      });
      // Update the segment with the result asset
      const segments = this.getSegments(advanced.id);
      if (segments.length > 0) {
        this.updateSegment(segments[0].id, {
          assetPath: quick.resultPath,
          status: 'done',
        });
      }
    }

    return this.getProject(advanced.id)!;
  }
}

// Singleton
let _instance: TransformService | null = null;
export function getTransformService(): TransformService {
  if (!_instance) _instance = new TransformService();
  return _instance;
}
