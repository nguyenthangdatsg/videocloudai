import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import multer from 'multer';
import { dbAll, dbGet, dbRun } from '../db';

interface MediaLibraryRow {
  id: string;
  name: string;
  type: string;
  tags: string;
  category: string;
  filename: string;
  filepath: string;
  url: string;
  mime_type: string;
  filesize: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  usage_count: number;
  trigger_tags: string;
  created_at: string;
  updated_at: string;
}

function toApiItem(row: MediaLibraryRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    tags: JSON.parse(row.tags || '[]'),
    category: row.category,
    filename: row.filename,
    url: row.url,
    mimeType: row.mime_type,
    filesize: row.filesize,
    duration: row.duration,
    width: row.width,
    height: row.height,
    usageCount: row.usage_count,
    triggerTags: JSON.parse(row.trigger_tags || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ALLOWED_EXTENSIONS = new Set(['.png', '.gif', '.webp', '.svg', '.mp3', '.wav', '.ogg']);
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function getMediaDir(): string {
  const dir = path.resolve(process.env.ASSETS_DIR || './assets', 'media-library');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function createMediaLibraryRouter(): Router {
  const router = Router();

  const mediaDir = getMediaDir();

  // Multer config for media uploads
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        fs.mkdirSync(mediaDir, { recursive: true });
        cb(null, mediaDir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `media_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
        cb(null, uniqueName);
      },
    }),
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        cb(null, true);
      } else {
        cb(new Error(`Unsupported file type: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`));
      }
    },
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });

  // ── GET /categories — distinct categories with counts ──────────────
  router.get('/categories', (_req: Request, res: Response) => {
    const rows = dbAll<{ category: string; count: number }>(
      'SELECT category, COUNT(*) as count FROM media_library GROUP BY category ORDER BY count DESC',
    );
    res.json({ categories: rows });
  });

  // ── GET /suggest — suggest media by context tags overlap ───────────
  router.get('/suggest', (req: Request, res: Response) => {
    const contextStr = (req.query.context as string) || '';
    const contextTags = contextStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

    if (!contextTags.length) {
      res.json({ items: [] });
      return;
    }

    // Fetch all items and score by trigger_tags overlap
    const allItems = dbAll<MediaLibraryRow>('SELECT * FROM media_library');
    const scored: Array<{ item: MediaLibraryRow; overlap: number }> = [];

    for (const item of allItems) {
      let triggerTags: string[] = [];
      try {
        triggerTags = (JSON.parse(item.trigger_tags) as string[]).map(t => t.toLowerCase());
      } catch { /* skip */ }

      const overlap = contextTags.filter(ct => triggerTags.includes(ct)).length;
      if (overlap > 0) {
        scored.push({ item, overlap });
      }
    }

    scored.sort((a, b) => b.overlap - a.overlap);
    res.json({ items: scored.map(s => toApiItem(s.item)) });
  });

  // ── GET / — list all media with optional filters ───────────────────
  router.get('/', (req: Request, res: Response) => {
    const { type, category, search, tags } = req.query as Record<string, string | undefined>;

    let sql = 'SELECT * FROM media_library';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (search) {
      conditions.push('(name LIKE ? OR tags LIKE ? OR trigger_tags LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (tags) {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tagList) {
        conditions.push('trigger_tags LIKE ?');
        params.push(`%"${tag}"%`);
      }
    }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    const items = dbAll<MediaLibraryRow>(sql, params);
    res.json({ items: items.map(toApiItem) });
  });

  // ── GET /:id — get single item ────────────────────────────────────
  router.get('/:id', (req: Request, res: Response) => {
    const item = dbGet<MediaLibraryRow>('SELECT * FROM media_library WHERE id = ?', [req.params.id]);
    if (!item) {
      res.status(404).json({ error: 'Media item not found' });
      return;
    }
    res.json({ item: toApiItem(item) });
  });

  // ── POST /upload — single file upload ─────────────────────────────
  router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { name, type, category, tags, triggerTags } = req.body as {
      name?: string;
      type?: string;
      category?: string;
      tags?: string;
      triggerTags?: string;
    };

    const mediaType = type || 'sticker';
    if (!['sticker', 'icon', 'animation', 'sfx'].includes(mediaType)) {
      // Clean up uploaded file
      fs.unlinkSync(file.path);
      res.status(400).json({ error: 'Invalid type. Must be: sticker, icon, animation, or sfx' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = MIME_MAP[ext] || 'application/octet-stream';
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const parsedTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const parsedTriggerTags = triggerTags ? triggerTags.split(',').map(t => t.trim()).filter(Boolean) : [];

    dbRun(
      `INSERT INTO media_library (id, name, type, tags, category, filename, filepath, url, mime_type, filesize, trigger_tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        (name || file.originalname).trim(),
        mediaType,
        JSON.stringify(parsedTags),
        (category || 'general').trim(),
        file.filename,
        file.path,
        `/api/media-library/file/${file.filename}`,
        mimeType,
        file.size,
        JSON.stringify(parsedTriggerTags),
        now,
        now,
      ],
    );

    const item = dbGet<MediaLibraryRow>('SELECT * FROM media_library WHERE id = ?', [id]);
    res.status(201).json({ item: item ? toApiItem(item) : null });
  });

  // ── POST /bulk-upload — multiple files at once ────────────────────
  router.post('/bulk-upload', upload.array('files', 50), (req: Request, res: Response) => {
    const files = (req as any).files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const { type, category, tags, triggerTags } = req.body as {
      type?: string;
      category?: string;
      tags?: string;
      triggerTags?: string;
    };

    const mediaType = type || 'sticker';
    if (!['sticker', 'icon', 'animation', 'sfx'].includes(mediaType)) {
      // Clean up uploaded files
      for (const f of files) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } }
      res.status(400).json({ error: 'Invalid type. Must be: sticker, icon, animation, or sfx' });
      return;
    }

    const now = new Date().toISOString();
    const parsedTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const parsedTriggerTags = triggerTags ? triggerTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const items: MediaLibraryRow[] = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const mimeType = MIME_MAP[ext] || 'application/octet-stream';
      const id = crypto.randomUUID();

      dbRun(
        `INSERT INTO media_library (id, name, type, tags, category, filename, filepath, url, mime_type, filesize, trigger_tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          file.originalname.replace(/\.[^.]+$/, '').trim() || file.originalname,
          mediaType,
          JSON.stringify(parsedTags),
          (category || 'general').trim(),
          file.filename,
          file.path,
          `/api/media-library/file/${file.filename}`,
          mimeType,
          file.size,
          JSON.stringify(parsedTriggerTags),
          now,
          now,
        ],
      );

      const item = dbGet<MediaLibraryRow>('SELECT * FROM media_library WHERE id = ?', [id]);
      if (item) items.push(item);
    }

    res.status(201).json({ items: items.map(toApiItem), count: items.length });
  });

  // ── PUT /:id — update metadata ────────────────────────────────────
  router.put('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = dbGet<MediaLibraryRow>('SELECT * FROM media_library WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Media item not found' });
      return;
    }

    const { name, tags, category, triggerTags, type } = req.body as {
      name?: string;
      tags?: string[];
      category?: string;
      triggerTags?: string[];
      type?: string;
    };

    const sets: string[] = [];
    const params: unknown[] = [];

    if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()); }
    if (category !== undefined) { sets.push('category = ?'); params.push(category.trim()); }
    if (tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (triggerTags !== undefined) { sets.push('trigger_tags = ?'); params.push(JSON.stringify(triggerTags)); }
    if (type !== undefined && ['sticker', 'icon', 'animation', 'sfx'].includes(type)) {
      sets.push('type = ?');
      params.push(type);
    }

    if (!sets.length) {
      res.json({ item: toApiItem(existing) });
      return;
    }

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    dbRun(`UPDATE media_library SET ${sets.join(', ')} WHERE id = ?`, params);
    const item = dbGet<MediaLibraryRow>('SELECT * FROM media_library WHERE id = ?', [id]);
    res.json({ item: item ? toApiItem(item) : null });
  });

  // ── DELETE /:id — delete item and file ────────────────────────────
  router.delete('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = dbGet<MediaLibraryRow>('SELECT * FROM media_library WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Media item not found' });
      return;
    }

    // Delete the file
    try {
      const filePath = path.join(mediaDir, existing.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`[media-library] Failed to delete file ${existing.filename}:`, (err as Error).message);
    }

    dbRun('DELETE FROM media_library WHERE id = ?', [id]);
    res.json({ ok: true });
  });

  // ── GET /file/:filename — serve the actual file ───────────────────
  router.get('/file/:filename', (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename as string);
    const filePath = path.join(mediaDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  });

  return router;
}
