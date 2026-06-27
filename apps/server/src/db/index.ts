import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { SCHEMA_SQL } from './schema';

// Coerce JS values to better-sqlite3-compatible bind values.
// undefined → null, boolean → 0|1; everything else passed as-is.
function toSqlParams(params: unknown[]): never[] {
  return params.map((p): unknown => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  }) as never[];
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  // Resolve relative DATABASE_PATH from monorepo root, not CWD
  const monorepoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const rawDbPath = process.env.DATABASE_PATH ?? './database/videocloudai.db';
  const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(monorepoRoot, rawDbPath);
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.exec(SCHEMA_SQL);

  // Column migrations — safe to re-run; ALTER TABLE fails silently if column exists
  const columnMigrations = [
    `ALTER TABLE videos ADD COLUMN music_mood TEXT DEFAULT 'dramatic'`,
    `ALTER TABLE videos ADD COLUMN music_track_path TEXT`,
    `ALTER TABLE videos ADD COLUMN mute_original_audio INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE videos ADD COLUMN category TEXT`,
    `ALTER TABLE videos ADD COLUMN content_tags TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE videos ADD COLUMN source_video_id TEXT`,
    `ALTER TABLE videos ADD COLUMN blur_regions TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE videos ADD COLUMN original_description TEXT`,
    `ALTER TABLE videos ADD COLUMN imported_from_url TEXT`,
    `ALTER TABLE videos ADD COLUMN ai_description TEXT`,
    `ALTER TABLE videos ADD COLUMN original_author TEXT`,
    `ALTER TABLE videos ADD COLUMN original_author_url TEXT`,
    `ALTER TABLE videos ADD COLUMN upload_status TEXT NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE videos ADD COLUMN uploaded_at TEXT`,
    `ALTER TABLE videos ADD COLUMN upload_note TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_videos_category ON videos(category)`,
    `CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source_video_id)`,
    `ALTER TABLE distributions ADD COLUMN export_path TEXT`,
    `ALTER TABLE channels ADD COLUMN oauth_access_token TEXT`,
    `ALTER TABLE channels ADD COLUMN oauth_refresh_token TEXT`,
    `ALTER TABLE channels ADD COLUMN oauth_expires_at TEXT`,
    `ALTER TABLE channels ADD COLUMN platform_user_id TEXT`,
    `ALTER TABLE channels ADD COLUMN platform_username TEXT`,
    `ALTER TABLE channels ADD COLUMN default_caption TEXT`,
    `ALTER TABLE channels ADD COLUMN default_hashtags TEXT`,
    `ALTER TABLE distributions ADD COLUMN performance_note TEXT`,
    `ALTER TABLE videos ADD COLUMN text_overlays TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE videos ADD COLUMN narration_rate TEXT DEFAULT '+0%'`,
    `CREATE TABLE IF NOT EXISTS image_library (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'uncategorized',
      tags TEXT NOT NULL DEFAULT '[]',
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      filesize INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      prompt TEXT,
      provider TEXT,
      aspect_ratio TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_image_library_category ON image_library(category)`,
    `CREATE INDEX IF NOT EXISTS idx_image_library_name ON image_library(name)`,
    `ALTER TABLE storyboards ADD COLUMN result_size_kb INTEGER`,
    `ALTER TABLE storyboards ADD COLUMN template_id TEXT`,
    `ALTER TABLE storyboard_templates ADD COLUMN youtube_url TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboard_templates ADD COLUMN memo TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboard_templates ADD COLUMN niche_status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE storyboard_templates ADD COLUMN stage_prompts TEXT NOT NULL DEFAULT '{}'`,
    `ALTER TABLE storyboard_templates ADD COLUMN stage_parts TEXT NOT NULL DEFAULT '{}'`,
    `ALTER TABLE storyboard_templates ADD COLUMN visual_style TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN bg_music_filename TEXT`,
    `ALTER TABLE storyboards ADD COLUMN voice_volume REAL NOT NULL DEFAULT 1.0`,
    `ALTER TABLE storyboards ADD COLUMN music_volume REAL NOT NULL DEFAULT 0.3`,
  ];
  for (const sql of columnMigrations) {
    try { db.exec(sql); } catch { /* column already exists or index already exists */ }
  }

  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export function dbGet<T>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = getDb().prepare(sql);
  return stmt.get(...toSqlParams(params)) as T | undefined;
}

export function dbAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql);
  return stmt.all(...toSqlParams(params)) as T[];
}

export function dbRun(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid: number | bigint } {
  const stmt = getDb().prepare(sql);
  return stmt.run(...toSqlParams(params)) as { changes: number; lastInsertRowid: number | bigint };
}

export function dbTransaction<T>(fn: () => T): T {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}
