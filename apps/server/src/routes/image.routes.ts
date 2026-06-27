import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { dbAll, dbGet, dbRun } from '../db';
import { generateImageWithFallback, getAvailableImageProviders, getImageProviders, generateVideoClip, isVideoGenerationAvailable, getVideoModels } from '../services/image-providers';

export function createImageRouter(): Router {
  const router = Router();

  const outputDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'images');
  fs.mkdirSync(outputDir, { recursive: true });

  // Multer for zip uploads
  const uploadDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => cb(null, `zip_${Date.now()}${path.extname(file.originalname)}`),
    }),
    fileFilter: (_req, file, cb) => {
      cb(null, path.extname(file.originalname).toLowerCase() === '.zip');
    },
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  });

  // Multer for single file upload (image or video)
  const singleUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, outputDir),
      filename: (_req, file, cb) => cb(null, file.originalname || `flow_${Date.now()}.bin`),
    }),
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  });

  // Upload single image or video (base64 data URL from external tools like Chrome extensions)
  router.post('/upload', (req: Request, res: Response) => {
    const { dataUrl, filename: suggestedName } = req.body as { dataUrl?: string; filename?: string };
    if (!dataUrl) {
      res.status(400).json({ error: 'No dataUrl provided' });
      return;
    }
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      console.error('[image/upload] Invalid data URL, prefix:', dataUrl?.slice(0, 80));
      res.status(400).json({ error: 'Invalid data URL format' });
      return;
    }
    const mimeType = match[1]; // e.g. "image/png", "video/mp4", "application/octet-stream"
    const mediaType = mimeType.split('/')[0]; // "image", "video", etc.
    const mimeExt = mimeType.split('/')[1] || 'bin';
    const ext = mimeExt === 'jpeg' ? 'jpg' : mimeExt;
    const buffer = Buffer.from(match[2], 'base64');
    const filename = suggestedName || `flow_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const destPath = path.join(outputDir, filename);
    fs.writeFileSync(destPath, buffer);
    console.log(`[${mediaType}/upload] saved ${filename} (${Math.round(buffer.length / 1024)}KB)`);
    res.json({ filename, url: `/api/image/file/${filename}` });
  });

  // Upload single file (image or video) via multipart form — used for large files like videos
  router.post('/upload-single', singleUpload.single('file'), (req: Request, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const filename = file.filename;
    console.log(`[media/upload-single] saved ${filename} (${Math.round(file.size / 1024)}KB)`);
    res.json({ filename, url: `/api/image/file/${filename}` });
  });

  // Upload zip of timeline images (JFIF numbered 001-xxx)
  router.post('/upload-zip', upload.single('file'), (req: Request, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: 'No zip file uploaded' });
      return;
    }

    try {
      const zip = new AdmZip(file.path);
      const entries = zip.getEntries()
        .filter(e => !e.isDirectory && /\.(jfif|jpg|jpeg|png|webp)$/i.test(e.entryName))
        .sort((a, b) => {
          // Sort by leading number prefix: 001_xxx.jfif, 002_xxx.jfif, etc.
          const numA = parseInt(path.basename(a.entryName).match(/^(\d+)/)?.[1] || '0', 10);
          const numB = parseInt(path.basename(b.entryName).match(/^(\d+)/)?.[1] || '0', 10);
          return numA - numB;
        });

      if (!entries.length) {
        fs.unlinkSync(file.path);
        res.status(400).json({ error: 'No image files found in zip (supports .jfif, .jpg, .jpeg, .png, .webp)' });
        return;
      }

      console.log(`[upload-zip] extracting ${entries.length} images from ${file.originalname}`);

      const images: Array<{ index: number; filename: string; url: string; originalName: string }> = [];

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const data = entry.getData();
        // Save as jpg for consistency
        const filename = `upload_${Date.now()}_${String(i + 1).padStart(3, '0')}.jpg`;
        const destPath = path.join(outputDir, filename);
        fs.writeFileSync(destPath, data);

        images.push({
          index: i,
          filename,
          url: `/api/image/file/${filename}`,
          originalName: path.basename(entry.entryName),
        });
      }

      // Cleanup uploaded zip
      fs.unlinkSync(file.path);

      console.log(`[upload-zip] extracted ${images.length} images`);
      res.json({ images, count: images.length });
    } catch (err) {
      // Cleanup on error
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      console.error(`[upload-zip] error:`, (err as Error).message);
      res.status(500).json({ error: `Failed to extract zip: ${(err as Error).message}` });
    }
  });

  // List available image providers
  router.get('/providers', (_req: Request, res: Response) => {
    const all = getImageProviders().map(p => ({
      id: p.id, name: p.name, free: p.free, quality: p.quality,
      needsKey: p.needsKey, available: p.isAvailable(),
      models: p.models ? [...p.models] : [],
    }));
    res.json({ providers: all });
  });

  // Generate image from prompt (with fallback)
  router.post('/generate', async (req: Request, res: Response) => {
    const { prompt, aspectRatio, count, provider: preferredProvider, model } = req.body as {
      prompt?: string;
      aspectRatio?: string;
      count?: number;
      provider?: string;
      model?: string;
    };

    if (!prompt?.trim()) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const sampleCount = Math.min(Math.max(count ?? 1, 1), 4);
    const ar = aspectRatio || '16:9';

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    const results: Array<{ filename: string; url: string }> = [];

    try {
      for (let i = 0; i < sampleCount; i++) {
        res.write(JSON.stringify({ progress: true, step: 'generating', detail: `Generating image ${i + 1}/${sampleCount}...` }) + '\n');

        const requestId = `img_${Date.now()}_${i}`;
        const filename = `${requestId}.jpg`;
        const destPath = path.join(outputDir, filename);

        const { providerId } = await generateImageWithFallback(
          prompt, ar, destPath, preferredProvider || undefined,
          (fromId, toId, reason) => {
            res.write(JSON.stringify({ progress: true, step: 'fallback', detail: `[${fromId}] failed: ${reason}. Trying ${toId}...` }) + '\n');
          },
          model,
        );

        results.push({ filename, url: `/api/image/file/${filename}` });
        res.write(JSON.stringify({ progress: true, step: 'done', detail: `[${providerId}] Image ${i + 1} ready.` }) + '\n');
      }

      res.write(JSON.stringify({ images: results }) + '\n');
      res.end();
    } catch (err) {
      res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
      res.end();
    }
  });

  // Batch generate — multiple prompts, each with optional [timestamp] prefix
  router.post('/generate-batch', async (req: Request, res: Response) => {
    const { prompts, aspectRatio, provider: preferredProvider, model } = req.body as {
      prompts?: Array<{ timestamp: string; prompt: string }>;
      aspectRatio?: string;
      provider?: string;
      model?: string;
    };

    if (!prompts?.length) {
      res.status(400).json({ error: 'prompts array is required' });
      return;
    }

    const ar = aspectRatio || '16:9';

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    const results: Array<{ timestamp: string; filename: string; url: string; prompt: string }> = [];
    const total = prompts.length;

    for (let i = 0; i < total; i++) {
      const { timestamp, prompt } = prompts[i];

      // Small delay between requests to avoid hammering
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));

      res.write(JSON.stringify({ progress: true, step: 'generating', current: i + 1, total, detail: `(${i + 1}/${total}) [${timestamp}] Generating...` }) + '\n');

      try {
        const requestId = `img_${Date.now()}_${i}`;
        const filename = `${requestId}.jpg`;
        const destPath = path.join(outputDir, filename);

        const { providerId } = await generateImageWithFallback(
          prompt, ar, destPath, preferredProvider || undefined,
          (fromId, toId, reason) => {
            res.write(JSON.stringify({ progress: true, step: 'fallback', current: i + 1, total, detail: `[${fromId}] → [${toId}]: ${reason}` }) + '\n');
          },
          model,
        );

        const entry = { timestamp, filename, url: `/api/image/file/${filename}`, prompt: prompt.slice(0, 100) };
        results.push(entry);
        res.write(JSON.stringify({ progress: true, step: 'done', current: i + 1, total, detail: `[${providerId}] [${timestamp}] Done.`, image: entry }) + '\n');
      } catch (err) {
        res.write(JSON.stringify({ progress: true, step: 'error', current: i + 1, total, detail: `[${timestamp}] Failed: ${(err as Error).message}` }) + '\n');
      }
    }

    res.write(JSON.stringify({ images: results }) + '\n');
    res.end();
  });

  // Serve generated images
  router.get('/file/:filename', (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename as string);
    const filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';

    // For video files, support range requests for proper playback
    if (ext === '.mp4' || ext === '.webm' || ext === '.mov') {
      const stat = fs.statSync(filePath);
      const range = req.headers.range;
      if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': mime,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  });

  // List generated images
  router.get('/history', (_req: Request, res: Response) => {
    if (!fs.existsSync(outputDir)) {
      res.json([]);
      return;
    }
    const files = fs.readdirSync(outputDir)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map((f) => {
        const stat = fs.statSync(path.join(outputDir, f));
        return {
          filename: f,
          url: `/api/image/file/${f}`,
          sizeKB: Math.round(stat.size / 1024),
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);
    res.json(files);
  });

  // Delete an image
  router.delete('/file/:filename', (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename as string);
    const filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  });

  // Export images to assets directory (for use in video scenes)
  router.post('/export-assets', (req: Request, res: Response) => {
    const { images } = req.body as {
      images: Array<{ filename: string; timestamp?: string }>;
    };

    if (!images?.length) {
      res.status(400).json({ error: 'No images to export' });
      return;
    }

    const assetsDir = path.resolve(process.env.ASSETS_DIR ?? './assets', 'scenes');
    fs.mkdirSync(assetsDir, { recursive: true });

    let count = 0;
    for (const img of images) {
      const src = path.join(outputDir, path.basename(img.filename));
      if (!fs.existsSync(src)) continue;
      const dest = path.join(assetsDir, path.basename(img.filename));
      fs.copyFileSync(src, dest);
      count++;
    }

    res.json({ ok: true, count, dir: assetsDir });
  });

  // ── Image Library ──────────────────────────────────────────────────

  // Save image to library
  router.post('/library', (req: Request, res: Response) => {
    const { filename, name, description, category, tags, prompt, provider: prov, aspectRatio: ar2 } = req.body as {
      filename: string;
      name: string;
      description?: string;
      category?: string;
      tags?: string[];
      prompt?: string;
      provider?: string;
      aspectRatio?: string;
    };

    if (!filename || !name?.trim()) {
      res.status(400).json({ error: 'filename and name are required' });
      return;
    }

    const srcPath = path.join(outputDir, path.basename(filename));
    if (!fs.existsSync(srcPath)) {
      res.status(404).json({ error: 'Source image not found' });
      return;
    }

    const stat = fs.statSync(srcPath);
    const ext = path.extname(filename).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    dbRun(
      `INSERT INTO image_library (id, name, description, category, tags, filename, filepath, url, filesize, mime_type, prompt, provider, aspect_ratio, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), description?.trim() || null, category?.trim() || 'uncategorized', JSON.stringify(tags || []), filename, srcPath, `/api/image/file/${filename}`, stat.size, mime, prompt || null, prov || null, ar2 || null, now, now],
    );

    const item = dbGet('SELECT * FROM image_library WHERE id = ?', [id]);
    res.json({ item });
  });

  // List library images
  router.get('/library', (req: Request, res: Response) => {
    const { category, tag, q, limit } = req.query as { category?: string; tag?: string; q?: string; limit?: string };
    let sql = 'SELECT * FROM image_library';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (tag) {
      conditions.push('tags LIKE ?');
      params.push(`%"${tag}"%`);
    }
    if (q) {
      conditions.push('(name LIKE ? OR description LIKE ? OR tags LIKE ? OR prompt LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit, 10)); }

    const items = dbAll(sql, params);
    res.json({ items });
  });

  // Get library categories
  router.get('/library/categories', (_req: Request, res: Response) => {
    const rows = dbAll<{ category: string; count: number }>(
      'SELECT category, COUNT(*) as count FROM image_library GROUP BY category ORDER BY count DESC',
    );
    res.json({ categories: rows });
  });

  // Get library tags
  router.get('/library/tags', (_req: Request, res: Response) => {
    const rows = dbAll<{ tags: string }>('SELECT tags FROM image_library');
    const tagMap: Record<string, number> = {};
    for (const row of rows) {
      try {
        const arr = JSON.parse(row.tags) as string[];
        for (const t of arr) { tagMap[t] = (tagMap[t] || 0) + 1; }
      } catch { /* skip */ }
    }
    const tags = Object.entries(tagMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    res.json({ tags });
  });

  // Update library item
  router.put('/library/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, description, category, tags } = req.body as {
      name?: string;
      description?: string;
      category?: string;
      tags?: string[];
    };

    const existing = dbGet('SELECT id FROM image_library WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Library item not found' });
      return;
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description.trim() || null); }
    if (category !== undefined) { sets.push('category = ?'); params.push(category.trim() || 'uncategorized'); }
    if (tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(tags)); }
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    dbRun(`UPDATE image_library SET ${sets.join(', ')} WHERE id = ?`, params);
    const item = dbGet('SELECT * FROM image_library WHERE id = ?', [id]);
    res.json({ item });
  });

  // Delete library item
  router.delete('/library/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const existing = dbGet<{ id: string }>('SELECT id FROM image_library WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Library item not found' });
      return;
    }
    dbRun('DELETE FROM image_library WHERE id = ?', [id]);
    res.json({ ok: true });
  });

  // ── Video Generation ─────────────────────────────────────────────────

  const videoOutputDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'videos');
  fs.mkdirSync(videoOutputDir, { recursive: true });

  // Check if video generation is available
  router.get('/video/providers', (_req: Request, res: Response) => {
    res.json({
      available: isVideoGenerationAvailable(),
      models: [...getVideoModels()],
    });
  });

  // Generate single video clip
  router.post('/video/generate', async (req: Request, res: Response) => {
    const { prompt, aspectRatio, duration, model } = req.body as {
      prompt?: string;
      aspectRatio?: string;
      duration?: number;
      model?: string;
    };

    if (!prompt?.trim()) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const ar = aspectRatio || '16:9';
    const dur = Math.min(Math.max(duration ?? 5, 2), 8);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
      res.write(JSON.stringify({ progress: true, step: 'generating', detail: `Generating video clip (${dur}s)...` }) + '\n');

      const requestId = `vid_${Date.now()}`;
      const filename = `${requestId}.mp4`;
      const destPath = path.join(videoOutputDir, filename);

      const { providerId } = await generateVideoClip(prompt, ar, destPath, dur, model);

      const result = { filename, url: `/api/image/video/file/${filename}` };
      res.write(JSON.stringify({ progress: true, step: 'done', detail: `[${providerId}] Video clip ready.` }) + '\n');
      res.write(JSON.stringify({ video: result }) + '\n');
      res.end();
    } catch (err) {
      res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
      res.end();
    }
  });

  // Batch generate video clips
  router.post('/video/generate-batch', async (req: Request, res: Response) => {
    const { prompts, aspectRatio, duration, model } = req.body as {
      prompts?: Array<{ timestamp: string; prompt: string }>;
      aspectRatio?: string;
      duration?: number;
      model?: string;
    };

    if (!prompts?.length) {
      res.status(400).json({ error: 'prompts array is required' });
      return;
    }

    const ar = aspectRatio || '16:9';
    const dur = Math.min(Math.max(duration ?? 5, 2), 8);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    const results: Array<{ timestamp: string; filename: string; url: string; prompt: string }> = [];
    const total = prompts.length;

    for (let i = 0; i < total; i++) {
      const { timestamp, prompt } = prompts[i];

      // Longer delay between video requests to avoid rate limits
      if (i > 0) await new Promise((r) => setTimeout(r, 3000));

      res.write(JSON.stringify({ progress: true, step: 'generating', current: i + 1, total, detail: `(${i + 1}/${total}) [${timestamp}] Generating video clip (${dur}s)...` }) + '\n');

      try {
        const requestId = `vid_${Date.now()}_${i}`;
        const filename = `${requestId}.mp4`;
        const destPath = path.join(videoOutputDir, filename);

        const { providerId } = await generateVideoClip(prompt, ar, destPath, dur, model);

        const entry = { timestamp, filename, url: `/api/image/video/file/${filename}`, prompt: prompt.slice(0, 100) };
        results.push(entry);
        res.write(JSON.stringify({ progress: true, step: 'done', current: i + 1, total, detail: `[${providerId}] [${timestamp}] Done.`, video: entry }) + '\n');
      } catch (err) {
        res.write(JSON.stringify({ progress: true, step: 'error', current: i + 1, total, detail: `[${timestamp}] Failed: ${(err as Error).message}` }) + '\n');
      }
    }

    res.write(JSON.stringify({ videos: results }) + '\n');
    res.end();
  });

  // Serve generated video files
  router.get('/video/file/:filename', (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename as string);
    const filePath = path.join(videoOutputDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Batch save to library
  router.post('/library/batch', (req: Request, res: Response) => {
    const { images } = req.body as {
      images: Array<{
        filename: string;
        name: string;
        description?: string;
        category?: string;
        tags?: string[];
        prompt?: string;
        provider?: string;
        aspectRatio?: string;
      }>;
    };

    if (!images?.length) {
      res.status(400).json({ error: 'images array is required' });
      return;
    }

    const now = new Date().toISOString();
    const saved: unknown[] = [];

    for (const img of images) {
      const srcPath = path.join(outputDir, path.basename(img.filename));
      if (!fs.existsSync(srcPath)) continue;

      const stat = fs.statSync(srcPath);
      const ext = path.extname(img.filename).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const id = crypto.randomUUID();

      dbRun(
        `INSERT INTO image_library (id, name, description, category, tags, filename, filepath, url, filesize, mime_type, prompt, provider, aspect_ratio, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, img.name?.trim() || img.filename, img.description?.trim() || null, img.category?.trim() || 'uncategorized', JSON.stringify(img.tags || []), img.filename, srcPath, `/api/image/file/${img.filename}`, stat.size, mime, img.prompt || null, img.provider || null, img.aspectRatio || null, now, now],
      );
      saved.push(dbGet('SELECT * FROM image_library WHERE id = ?', [id]));
    }

    res.json({ items: saved, count: saved.length });
  });

  return router;
}
