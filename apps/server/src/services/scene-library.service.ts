import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun } from '../db';
import { SceneReuseEngine } from '@videocloudai/core';
import type {
  SceneMetadata,
  AssetRecord,
  SceneLine,
  SceneMatch,
  SceneMood,
  SceneStyle,
  SceneCategory,
  ReusableClip,
} from '@videocloudai/shared';

interface DbScene {
  id: string;
  title: string;
  description: string;
  category: SceneCategory;
  tags: string;
  mood: SceneMood;
  style: SceneStyle;
  camera_type: string;
  atmosphere: string;
  duration: number;
  reuse_keywords: string;
  usage_count: number;
  quality_score: number;
  created_at: string;
  updated_at: string;
}

interface DbAsset {
  id: string;
  scene_id: string;
  generation_id: string;
  type: string;
  filename: string;
  filepath: string;
  url: string;
  width: number;
  height: number;
  duration: number;
  filesize: number;
  mime_type: string;
  checksum: string;
  status: string;
  tags: string;
  mood: string;
  style: string;
  camera_type: string;
  atmosphere: string;
  reuse_keywords: string;
  usage_count: number;
  quality_score: number;
  created_at: string;
}

function mapDbScene(row: DbScene): SceneMetadata {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: JSON.parse(row.tags),
    mood: row.mood,
    style: row.style,
    cameraType: row.camera_type as SceneMetadata['cameraType'],
    atmosphere: row.atmosphere as SceneMetadata['atmosphere'],
    duration: row.duration,
    reuseKeywords: JSON.parse(row.reuse_keywords),
    usageCount: row.usage_count,
    qualityScore: row.quality_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDbAsset(row: DbAsset): AssetRecord {
  return {
    id: row.id,
    sceneId: row.scene_id,
    generationId: row.generation_id,
    type: row.type as AssetRecord['type'],
    filename: row.filename,
    filepath: row.filepath,
    url: row.url,
    width: row.width,
    height: row.height,
    duration: row.duration,
    filesize: row.filesize,
    mimeType: row.mime_type,
    checksum: row.checksum,
    status: row.status as AssetRecord['status'],
    metadata: {
      tags: JSON.parse(row.tags ?? '[]'),
      mood: row.mood as SceneMood,
      style: row.style as SceneStyle,
      cameraType: row.camera_type as AssetRecord['metadata']['cameraType'],
      atmosphere: row.atmosphere as AssetRecord['metadata']['atmosphere'],
      reuseKeywords: JSON.parse(row.reuse_keywords ?? '[]'),
      usageCount: row.usage_count,
      qualityScore: row.quality_score,
    },
    createdAt: row.created_at,
  };
}

export class SceneLibraryService {
  private reuseEngine: SceneReuseEngine;

  constructor() {
    this.reuseEngine = new SceneReuseEngine({ minScore: 0.25 });
  }

  createScene(data: Partial<SceneMetadata> & { title: string; mood: SceneMood; style: SceneStyle }): SceneMetadata {
    const now = new Date().toISOString();
    const id = uuidv4();

    dbRun(
      `INSERT INTO scenes (id, title, description, category, tags, mood, style, camera_type, atmosphere,
       duration, reuse_keywords, usage_count, quality_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0.5, ?, ?)`,
      [
        id,
        data.title,
        data.description ?? '',
        data.category ?? 'custom',
        JSON.stringify(data.tags ?? []),
        data.mood,
        data.style,
        data.cameraType ?? null,
        data.atmosphere ?? null,
        data.duration ?? 4,
        JSON.stringify(data.reuseKeywords ?? []),
        now,
        now,
      ]
    );

    return this.getScene(id)!;
  }

  getScene(id: string): SceneMetadata | undefined {
    const row = dbGet<DbScene>('SELECT * FROM scenes WHERE id = ?', [id]);
    return row ? mapDbScene(row) : undefined;
  }

  listScenes(filters?: {
    mood?: SceneMood;
    style?: SceneStyle;
    category?: SceneCategory;
    limit?: number;
    offset?: number;
  }): SceneMetadata[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.mood) { conditions.push('mood = ?'); params.push(filters.mood); }
    if (filters?.style) { conditions.push('style = ?'); params.push(filters.style); }
    if (filters?.category) { conditions.push('category = ?'); params.push(filters.category); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const rows = dbAll<DbScene>(
      `SELECT * FROM scenes ${where} ORDER BY quality_score DESC, usage_count DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return rows.map(mapDbScene);
  }

  findReuseMatches(sceneLine: SceneLine, limit = 5): SceneMatch[] {
    const scenes = dbAll<DbScene>('SELECT * FROM scenes ORDER BY quality_score DESC LIMIT 200');
    const candidates: Array<{ scene: SceneMetadata; asset: AssetRecord }> = [];

    for (const dbScene of scenes) {
      const scene = mapDbScene(dbScene);
      const asset = dbGet<DbAsset>(
        'SELECT * FROM assets WHERE scene_id = ? AND status = "active" ORDER BY quality_score DESC LIMIT 1',
        [scene.id]
      );
      if (asset) {
        candidates.push({ scene, asset: mapDbAsset(asset) });
      }
    }

    return this.reuseEngine.findMatches(sceneLine, candidates).slice(0, limit);
  }

  searchScenes(query: string, limit = 20): Array<SceneMetadata & { asset?: AssetRecord }> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 5);

    if (!terms.length) return [];

    const rows = dbAll<DbScene>(
      `SELECT * FROM scenes WHERE ${terms.map(() => "(title LIKE ? OR tags LIKE ? OR mood LIKE ? OR reuse_keywords LIKE ?)").join(' OR ')} LIMIT ?`,
      [...terms.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`]), limit]
    );

    return rows.map((row) => {
      const scene = mapDbScene(row);
      const assetRow = dbGet<DbAsset>(
        'SELECT * FROM assets WHERE scene_id = ? AND status = "active" LIMIT 1',
        [row.id]
      );
      return { ...scene, asset: assetRow ? mapDbAsset(assetRow) : undefined };
    });
  }

  incrementUsage(sceneId: string): void {
    dbRun(
      'UPDATE scenes SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?',
      [new Date().toISOString(), sceneId]
    );
  }

  createAsset(data: {
    sceneId?: string;
    generationId?: string;
    type: AssetRecord['type'];
    filename: string;
    filepath: string;
    filesize: number;
    mimeType: string;
    checksum: string;
    width?: number;
    height?: number;
    duration?: number;
    metadata?: Partial<AssetRecord['metadata']>;
  }): AssetRecord {
    const id = uuidv4();
    const now = new Date().toISOString();
    const meta = data.metadata ?? {};

    dbRun(
      `INSERT INTO assets (id, scene_id, generation_id, type, filename, filepath, filesize, mime_type, checksum,
       width, height, duration, status, tags, mood, style, camera_type, atmosphere, reuse_keywords,
       usage_count, quality_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        id,
        data.sceneId ?? null,
        data.generationId ?? null,
        data.type,
        data.filename,
        data.filepath,
        data.filesize,
        data.mimeType,
        data.checksum,
        data.width ?? null,
        data.height ?? null,
        data.duration ?? null,
        JSON.stringify(meta.tags ?? []),
        meta.mood ?? null,
        meta.style ?? null,
        meta.cameraType ?? null,
        meta.atmosphere ?? null,
        JSON.stringify(meta.reuseKeywords ?? []),
        meta.qualityScore ?? 0.5,
        now,
      ]
    );

    return this.getAsset(id)!;
  }

  getAsset(id: string): AssetRecord | undefined {
    const row = dbGet<DbAsset>('SELECT * FROM assets WHERE id = ?', [id]);
    return row ? mapDbAsset(row) : undefined;
  }

  listAssets(sceneId?: string): AssetRecord[] {
    const rows = sceneId
      ? dbAll<DbAsset>('SELECT * FROM assets WHERE scene_id = ? AND status = "active" ORDER BY created_at DESC', [sceneId])
      : dbAll<DbAsset>('SELECT * FROM assets WHERE status = "active" ORDER BY created_at DESC LIMIT 100');
    return rows.map(mapDbAsset);
  }

  getLibraryStats(): {
    totalScenes: number;
    totalAssets: number;
    totalReusableClips: number;
    byMood: Record<string, number>;
    byStyle: Record<string, number>;
  } {
    const totalScenes = (dbGet<{ count: number }>('SELECT COUNT(*) as count FROM scenes') ?? { count: 0 }).count;
    const totalAssets = (dbGet<{ count: number }>("SELECT COUNT(*) as count FROM assets WHERE status='active'") ?? { count: 0 }).count;
    const totalReusableClips = (dbGet<{ count: number }>('SELECT COUNT(*) as count FROM reusable_clips') ?? { count: 0 }).count;

    const moodRows = dbAll<{ mood: string; count: number }>('SELECT mood, COUNT(*) as count FROM scenes GROUP BY mood');
    const styleRows = dbAll<{ style: string; count: number }>('SELECT style, COUNT(*) as count FROM scenes GROUP BY style');

    const byMood: Record<string, number> = {};
    const byStyle: Record<string, number> = {};
    moodRows.forEach((r) => { byMood[r.mood] = r.count; });
    styleRows.forEach((r) => { byStyle[r.style] = r.count; });

    return { totalScenes, totalAssets, totalReusableClips, byMood, byStyle };
  }
}
