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

  console.log('[DB] __dirname:', __dirname);
  console.log('[DB] monorepoRoot:', monorepoRoot);
  console.log('[DB] rawDbPath:', rawDbPath);
  console.log('[DB] Resolved database path:', dbPath);
  console.log('[DB] Database dir exists:', fs.existsSync(dir));

  // Force DELETE journal mode by checkpointing WAL, closing, patching header, then reopening.
  // SQLite stores journal mode at byte offsets 18-19 in the header:
  //   1,1 = DELETE mode (rollback journal)
  //   2,2 = WAL mode
  try {
    const header = Buffer.alloc(20);
    const fd = fs.openSync(dbPath, 'r');
    fs.readSync(fd, header, 0, 20, 0);
    fs.closeSync(fd);
    const isWal = header[18] === 2 && header[19] === 2;
    if (isWal) {
      console.log('[DB] Database is in WAL mode, converting to DELETE...');
      // Open, checkpoint all WAL data, close
      const tempDb = new Database(dbPath);
      try { tempDb.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* empty WAL */ }
      tempDb.close();
      // Remove WAL/SHM files that close() recreated
      for (const suffix of ['-wal', '-shm']) {
        const f = dbPath + suffix;
        if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
      }
      // Patch header bytes 18-19 from WAL (2,2) to DELETE (1,1) AFTER removing WAL files
      const fdw = fs.openSync(dbPath, 'r+');
      const patch = Buffer.from([1, 1]);
      fs.writeSync(fdw, patch, 0, 2, 18);
      fs.closeSync(fdw);
      console.log('[DB] Converted to DELETE mode');
    }
  } catch (e) {
    console.warn('[DB] WAL conversion warning:', (e as Error).message);
  }

  try {
    db = new Database(dbPath);
    db.pragma('busy_timeout = 5000');
    const actualMode = (db.pragma('journal_mode') as { journal_mode: string }[])[0]?.journal_mode;
    console.log('[DB] Database opened OK, journal_mode:', actualMode);
  } catch (e) {
    console.error('[DB] FAILED to open database:', (e as Error).message);
    throw e;
  }
  console.log('[DB] Executing schema SQL...');
  try {
    db.exec(SCHEMA_SQL);
    console.log('[DB] Schema OK');
  } catch (e) {
    console.error('[DB] Schema execution FAILED:', (e as Error).message);
    throw e;
  }

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
    `CREATE TABLE IF NOT EXISTS image_prompt_cache (
      prompt_hash TEXT PRIMARY KEY,
      prompt_text TEXT NOT NULL,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_image_prompt_cache_hash ON image_prompt_cache(prompt_hash)`,
    `ALTER TABLE storyboards ADD COLUMN bg_music_filename TEXT`,
    `ALTER TABLE storyboards ADD COLUMN voice_volume REAL NOT NULL DEFAULT 1.0`,
    `ALTER TABLE storyboards ADD COLUMN music_volume REAL NOT NULL DEFAULT 0.3`,
    `ALTER TABLE storyboards ADD COLUMN thumbnail_url TEXT`,
    `ALTER TABLE storyboards ADD COLUMN thumbnail_prompt TEXT`,
    `ALTER TABLE storyboards ADD COLUMN speed REAL DEFAULT 1.0`,
    `ALTER TABLE storyboards ADD COLUMN thumbnail_bg_color TEXT DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN bg_color TEXT DEFAULT 'white'`,
    `ALTER TABLE drama_episodes ADD COLUMN audio_filename TEXT`,
    `ALTER TABLE drama_episodes ADD COLUMN audio_duration REAL`,
    `ALTER TABLE drama_episodes ADD COLUMN srt_filename TEXT`,
    `ALTER TABLE drama_episodes ADD COLUMN video_filename TEXT`,
    `ALTER TABLE drama_projects ADD COLUMN mode TEXT NOT NULL DEFAULT 'video'`,
    `ALTER TABLE storyboards ADD COLUMN subtitle_style TEXT`,
    `ALTER TABLE storyboards ADD COLUMN video_mode TEXT NOT NULL DEFAULT 'standard'`,
    `ALTER TABLE storyboards ADD COLUMN mascot_prompt TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN mascot_image TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN mascot_image_left TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN mascot_image_right TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN mascot_image_both TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN mascot_image_win TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN comparison_items TEXT NOT NULL DEFAULT '{}'`,
    `ALTER TABLE storyboard_templates ADD COLUMN mascot_prompt TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboard_templates ADD COLUMN mascot_image TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboard_templates ADD COLUMN mascot_image_left TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboard_templates ADD COLUMN mascot_image_right TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboard_templates ADD COLUMN mascot_image_both TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboard_templates ADD COLUMN mascot_image_win TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN comp_media_source TEXT NOT NULL DEFAULT 'flow'`,
    `ALTER TABLE storyboards ADD COLUMN comp_round_panels INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE storyboards ADD COLUMN comp_bg_source TEXT NOT NULL DEFAULT 'color'`,
    `ALTER TABLE storyboards ADD COLUMN comp_bg_query TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE storyboards ADD COLUMN frame_template_id TEXT NOT NULL DEFAULT ''`,
    `CREATE TABLE IF NOT EXISTS media_library (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('sticker', 'icon', 'animation', 'sfx', 'screen-effect')),
      tags TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT 'general',
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      url TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'image/png',
      filesize INTEGER NOT NULL DEFAULT 0,
      duration REAL,
      width INTEGER,
      height INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      trigger_tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_media_library_type ON media_library(type)`,
    `CREATE INDEX IF NOT EXISTS idx_media_library_category ON media_library(category)`,
    `CREATE TABLE IF NOT EXISTS frame_video_library (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'comparison',
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      url TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'video/mp4',
      filesize INTEGER NOT NULL DEFAULT 0,
      duration REAL,
      width INTEGER,
      height INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_frame_video_library_category ON frame_video_library(category)`,
    `ALTER TABLE drama_projects ADD COLUMN ai_long_scene_mode TEXT NOT NULL DEFAULT 'freeze_hold'`,
    `ALTER TABLE drama_projects ADD COLUMN pacing TEXT NOT NULL DEFAULT 'normal'`,
    `ALTER TABLE transform_segments ADD COLUMN style TEXT NOT NULL DEFAULT 'natural'`,
    `ALTER TABLE transform_segments ADD COLUMN speed REAL NOT NULL DEFAULT 1.0`,
    `ALTER TABLE transform_segments ADD COLUMN duration INTEGER NOT NULL DEFAULT 6`,
    `ALTER TABLE transform_segments ADD COLUMN preview_path TEXT`,
  ];

  // ── Migrate media_library CHECK constraint to include 'screen-effect' ──
  try {
    const hasScreenEffect = db.prepare(`SELECT COUNT(*) as c FROM media_library WHERE type = 'screen-effect'`).get() as { c: number } | undefined;
    // Test if constraint allows screen-effect by attempting a dummy insert + rollback
    try {
      db.exec(`BEGIN; INSERT INTO media_library (id,name,type,filename,filepath,url,created_at,updated_at) VALUES ('__test_se','t','screen-effect','t','t','t','t','t'); DELETE FROM media_library WHERE id='__test_se'; COMMIT;`);
    } catch (checkErr) {
      // Roll back the failed BEGIN transaction before attempting migration
      try { db.exec('ROLLBACK'); } catch { /* not in transaction */ }
      // Old CHECK constraint — recreate table
      db.exec(`
        ALTER TABLE media_library RENAME TO media_library_old;
        CREATE TABLE media_library (
          id TEXT PRIMARY KEY, name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('sticker','icon','animation','sfx','screen-effect')),
          tags TEXT NOT NULL DEFAULT '[]', category TEXT NOT NULL DEFAULT 'general',
          filename TEXT NOT NULL, filepath TEXT NOT NULL, url TEXT NOT NULL,
          mime_type TEXT NOT NULL DEFAULT 'image/png', filesize INTEGER NOT NULL DEFAULT 0,
          duration REAL, width INTEGER, height INTEGER,
          usage_count INTEGER NOT NULL DEFAULT 0, trigger_tags TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        INSERT INTO media_library SELECT * FROM media_library_old;
        DROP TABLE media_library_old;
        CREATE INDEX IF NOT EXISTS idx_media_library_type ON media_library(type);
        CREATE INDEX IF NOT EXISTS idx_media_library_category ON media_library(category);
      `);
      console.log('[DB] Migrated media_library CHECK constraint to include screen-effect');
    }
  } catch (e) {
    console.warn('[DB] media_library migration warning:', (e as Error).message);
  }
  let migrationOk = 0, migrationSkip = 0;
  for (const sql of columnMigrations) {
    try { db.exec(sql); migrationOk++; } catch (e) {
      migrationSkip++;
      const msg = (e as Error).message || '';
      if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
        console.warn('[DB] Migration warning:', msg, '| SQL:', sql.substring(0, 80));
      }
    }
  }
  console.log('[DB] Migrations: %d applied, %d skipped (already exist)', migrationOk, migrationSkip);

  // Seed default templates if database does not have them
  try {
    // 1. Ancient History
    const existingHistory = db.prepare("SELECT COUNT(*) as count FROM storyboard_templates WHERE id = ?").get("64ef80eb-360a-447f-8a1f-fd0f8a08ee15") as { count: number } | undefined;
    if (!existingHistory || existingHistory.count === 0) {
      db.prepare(`
        INSERT INTO storyboard_templates (
          id, name, niche, description, template_text, custom_prompts, stage_prompts, stage_parts, color, youtube_url, memo, niche_status, visual_style, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "64ef80eb-360a-447f-8a1f-fd0f8a08ee15",
        "Ancient History",
        "History",
        "Ancient civilizations, lost empires, historical secrets – educational + viral combo",
        "",
        '{"prompts":"You are an image prompt generator for \\"History\\" YouTube videos.\\nVisual style: \\"stick figure doodle\\"\\n\\nRules:\\n- Format: \\"Simple stick figure doodle of [subject doing action] in ancient style, wearing primitive clothing or animal fur, colorful illustration style. Plain totally white background. Minimal detail, no shading, clean black outlines with soft colors.\\"\\n- Describe only ONE subject doing ONE thing\\n- Do NOT add lighting, camera angles, textures, colors, or backgrounds\\n- Every prompt must start with \\"Simple stick figure doodle of\\""}',
        '{"prompts":"You are an image prompt generator for \\"History\\" YouTube videos.\\nVisual style: \\"stick figure doodle\\"\\n\\nRules:\\n- Format: \\"Simple stick figure doodle of [subject doing action] in ancient style, wearing primitive clothing or animal fur, colorful illustration style. Plain totally white background. Minimal detail, no shading, clean black outlines with soft colors.\\"\\n- Describe only ONE subject doing ONE thing\\n- Do NOT add lighting, camera angles, textures, colors, or backgrounds\\n- Every prompt must start with \\"Simple stick figure doodle of\\""}',
        "{}",
        "#f59e0b",
        "https://studio.youtube.com/channel/UCPNJhFfEsORbh3r-e-0pjnw",
        "",
        "active",
        "stick figure doodle",
        "2026-06-18T03:37:28.601Z",
        "2026-06-29T14:54:33.957Z"
      );
    }

    // 2. Modern Comparison
    const existingComparison = db.prepare("SELECT COUNT(*) as count FROM storyboard_templates WHERE id = ?").get("78cf80eb-360a-447f-8a1f-fd0f8a08ee15") as { count: number } | undefined;
    if (!existingComparison || existingComparison.count === 0) {
      db.prepare(`
        INSERT INTO storyboard_templates (
          id, name, niche, description, template_text, custom_prompts, stage_prompts, stage_parts, color, youtube_url, memo, niche_status, visual_style, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "78cf80eb-360a-447f-8a1f-fd0f8a08ee15",
        "Modern Comparison",
        "Comparison",
        "Comparing different things, sizes, scales, and concepts – modern flat infographic visual style",
        "",
        '{"prompts":"You are an image prompt generator for \\"Comparison\\" YouTube videos.\\nVisual style: \\"modern vector infographic\\"\\n\\nRules:\\n- Format: \\"Modern flat design vector illustration comparing [Item A] versus [Item B], clean comparison style, infographic elements, colorful minimalist design. Plain totally white background. Clean sharp black outlines with bright modern color fills, no shading, high contrast.\\"\\n- Describe the comparison clearly (e.g., scale comparison, old vs new, size difference)\\n- Do NOT add photographic textures, gradients, or complex backgrounds\\n- Every prompt must start with \\"Modern flat design vector illustration\\""}',
        '{"prompts":"You are an image prompt generator for \\"Comparison\\" YouTube videos.\\nVisual style: \\"modern vector infographic\\"\\n\\nRules:\\n- Format: \\"Modern flat design vector illustration comparing [Item A] versus [Item B], clean comparison style, infographic elements, colorful minimalist design. Plain totally white background. Clean sharp black outlines with bright modern color fills, no shading, high contrast.\\"\\n- Describe the comparison clearly (e.g., scale comparison, old vs new, size difference)\\n- Do NOT add photographic textures, gradients, or complex backgrounds\\n- Every prompt must start with \\"Modern flat design vector illustration\\""}',
        "{}",
        "#3b82f6",
        "",
        "",
        "active",
        "modern vector infographic",
        "2026-06-30T07:56:00.000Z",
        "2026-06-30T07:56:00.000Z"
      );
    }
  } catch (err) {
    console.error('[Database] Failed to seed default templates:', err);
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
