import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import multer from 'multer';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { dbAll, dbGet, dbRun } from '../db';
import { resolveFfmpegPathSync } from '../services/import.service';

const execFileAsync = promisify(execFile);

interface FrameVideoRow {
  id: string;
  name: string;
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
  created_at: string;
  updated_at: string;
}

function toApiItem(row: FrameVideoRow) {
  const isHtml = row.mime_type === 'text/html' || row.filename.endsWith('.html');
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    filename: row.filename,
    url: isHtml ? `/api/frame-video-library/view/${row.id}` : row.url,
    mimeType: row.mime_type,
    filesize: row.filesize,
    duration: row.duration,
    width: row.width,
    height: row.height,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.html']);
const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.html': 'text/html',
};

function getFrameVideoDir(): string {
  const dir = path.resolve(process.env.ASSETS_DIR || './assets', 'frame-video-library');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function getVideoMetadata(filePath: string): Promise<{ duration: number; width: number; height: number }> {
  if (filePath.toLowerCase().endsWith('.html')) {
    return { duration: 0, width: 1920, height: 1080 };
  }
  const ffprobe = resolveFfmpegPathSync('ffprobe');
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath,
    ]);
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ width?: number; height?: number; codec_type?: string }>;
    };
    const duration = parseFloat(data.format?.duration ?? '0');
    const vStream = data.streams?.find(s => s.codec_type === 'video');
    const width = vStream?.width ?? 0;
    const height = vStream?.height ?? 0;
    return { duration, width, height };
  } catch (err) {
    console.error('[frame-video-library] ffprobe failed:', err);
    return { duration: 0, width: 0, height: 0 };
  }
}

export function createFrameVideoLibraryRouter(): Router {
  const router = Router();
  const mediaDir = getFrameVideoDir();

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        fs.mkdirSync(mediaDir, { recursive: true });
        cb(null, mediaDir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `frame_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
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
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  });

  // ── GET /categories — distinct categories with counts ──────────────
  router.get('/categories', (_req: Request, res: Response) => {
    const rows = dbAll<{ category: string; count: number }>(
      'SELECT category, COUNT(*) as count FROM frame_video_library GROUP BY category ORDER BY count DESC',
    );
    const finalCategories: Array<{ category: string; count: number }> = [];
    const comparisonIndex = rows.findIndex(r => r.category.toLowerCase() === 'comparison');

    if (comparisonIndex !== -1) {
      finalCategories.push(rows[comparisonIndex]);
      rows.splice(comparisonIndex, 1);
    } else {
      finalCategories.push({ category: 'comparison', count: 0 });
    }
    finalCategories.push(...rows);
    res.json({ categories: finalCategories });
  });

  // ── GET / — list all frame videos with optional filters ─────────────
  router.get('/', (req: Request, res: Response) => {
    const { category, search } = req.query as Record<string, string | undefined>;

    let sql = 'SELECT * FROM frame_video_library';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (search) {
      conditions.push('name LIKE ?');
      params.push(`%${search}%`);
    }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';

    const items = dbAll<FrameVideoRow>(sql, params);
    res.json({ items: items.map(toApiItem) });
  });

  // ── GET /:id — get single item ────────────────────────────────────
  router.get('/:id', (req: Request, res: Response) => {
    const item = dbGet<FrameVideoRow>('SELECT * FROM frame_video_library WHERE id = ?', [req.params.id]);
    if (!item) {
      res.status(404).json({ error: 'Frame video not found' });
      return;
    }
    res.json({ item: toApiItem(item) });
  });

  // ── POST /upload — single file upload ─────────────────────────────
  router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { name, category } = req.body as {
      name?: string;
      category?: string;
    };

    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = MIME_MAP[ext] || 'application/octet-stream';
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const meta = await getVideoMetadata(file.path);

    dbRun(
      `INSERT INTO frame_video_library (id, name, category, filename, filepath, url, mime_type, filesize, duration, width, height, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        (name || file.originalname).trim(),
        (category || 'comparison').trim(), // Default to comparison if category is empty
        file.filename,
        file.path,
        `/api/frame-video-library/file/${file.filename}`,
        mimeType,
        file.size,
        meta.duration || null,
        meta.width || null,
        meta.height || null,
        now,
        now,
      ],
    );

    const item = dbGet<FrameVideoRow>('SELECT * FROM frame_video_library WHERE id = ?', [id]);
    res.status(201).json({ item: item ? toApiItem(item) : null });
  });

  // ── POST /bulk-upload ─────────────────────────────────────────────
  router.post('/bulk-upload', upload.array('files', 50), async (req: Request, res: Response) => {
    const files = (req as any).files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const { category } = req.body as {
      category?: string;
    };

    const now = new Date().toISOString();
    const items: FrameVideoRow[] = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const mimeType = MIME_MAP[ext] || 'application/octet-stream';
      const id = crypto.randomUUID();

      const meta = await getVideoMetadata(file.path);

      dbRun(
        `INSERT INTO frame_video_library (id, name, category, filename, filepath, url, mime_type, filesize, duration, width, height, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          file.originalname.replace(/\.[^.]+$/, '').trim() || file.originalname,
          (category || 'comparison').trim(),
          file.filename,
          file.path,
          `/api/frame-video-library/file/${file.filename}`,
          mimeType,
          file.size,
          meta.duration || null,
          meta.width || null,
          meta.height || null,
          now,
          now,
        ],
      );

      const item = dbGet<FrameVideoRow>('SELECT * FROM frame_video_library WHERE id = ?', [id]);
      if (item) items.push(item);
    }

    res.status(201).json({ items: items.map(toApiItem), count: items.length });
  });

  // ── PUT /:id — update metadata ────────────────────────────────────
  router.put('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = dbGet<FrameVideoRow>('SELECT * FROM frame_video_library WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Frame video not found' });
      return;
    }

    const { name, category } = req.body as {
      name?: string;
      category?: string;
    };

    const sets: string[] = [];
    const params: unknown[] = [];

    if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()); }
    if (category !== undefined) { sets.push('category = ?'); params.push(category.trim()); }

    if (!sets.length) {
      res.json({ item: toApiItem(existing) });
      return;
    }

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    dbRun(`UPDATE frame_video_library SET ${sets.join(', ')} WHERE id = ?`, params);
    const item = dbGet<FrameVideoRow>('SELECT * FROM frame_video_library WHERE id = ?', [id]);
    res.json({ item: item ? toApiItem(item) : null });
  });

  // ── DELETE /:id — delete item and file ────────────────────────────
  router.delete('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = dbGet<FrameVideoRow>('SELECT * FROM frame_video_library WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Frame video not found' });
      return;
    }

    try {
      const filePath = path.join(mediaDir, existing.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`[frame-video-library] Failed to delete file ${existing.filename}:`, (err as Error).message);
    }

    dbRun('DELETE FROM frame_video_library WHERE id = ?', [id]);
    res.json({ ok: true });
  });

  // ── GET /view/:id — view the frame page directly ──────────────────
  router.get('/view/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = dbGet<FrameVideoRow>('SELECT * FROM frame_video_library WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).send('Frame not found');
      return;
    }

    const filePath = path.join(mediaDir, existing.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).send('File not found');
      return;
    }

    res.setHeader('Content-Type', existing.mime_type || 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    fs.createReadStream(filePath).pipe(res);
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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    fs.createReadStream(filePath).pipe(res);
  });

  return router;
}
