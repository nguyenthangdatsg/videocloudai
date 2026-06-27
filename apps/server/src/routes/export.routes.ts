import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { VideoService } from '../services/video.service';
import { exportForPlatform } from '@videocloudai/ffmpeg';
import type { VideoFormat } from '@videocloudai/shared';

export function createExportRouter(videoService: VideoService): Router {
  const router = Router();

  // Export video to platforms
  router.post('/:videoId', async (req: Request, res: Response) => {
    const project = videoService.getProject(req.params.videoId as string);
    if (!project) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    if (!project.outputPath || !fs.existsSync(project.outputPath)) {
      res.status(400).json({ error: 'Video not assembled yet' });
      return;
    }

    const { formats } = req.body as { formats?: VideoFormat[] };
    const targetFormats = formats ?? ['tiktok'];

    try {
      const rendersDir = process.env.RENDERS_DIR ?? './renders';
      const exportDir = path.join(rendersDir, `exports_${project.id}`);
      fs.mkdirSync(exportDir, { recursive: true });

      const exports = await exportForPlatform(project.outputPath, exportDir, targetFormats);

      res.json({ exports, videoId: project.id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Download platform-encoded export (e.g. export_tiktok.mp4)
  router.get('/:videoId/platform/:format/download', (req: Request, res: Response) => {
    const { videoId, format } = req.params as { videoId: string; format: string };
    const rendersDir = process.env.RENDERS_DIR ?? './renders';
    const filePath = path.resolve(path.join(rendersDir, `exports_${videoId}`, `export_${format}.mp4`));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Export not found — prepare the video first' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.download(filePath, `${format}_${videoId}.mp4`);
  });

  // Download video file
  router.get('/:videoId/download', (req: Request, res: Response) => {
    const project = videoService.getProject(req.params.videoId as string);
    if (!project?.outputPath || !fs.existsSync(project.outputPath)) {
      res.status(404).json({ error: 'Video file not found' });
      return;
    }

    // Never cache downloads — the file at this URL changes after every Assemble.
    res.setHeader('Cache-Control', 'no-store');
    res.download(project.outputPath, `${project.title}.mp4`);
  });

  // Stream video inline (for <video> preview)
  router.get('/:videoId/preview', (req: Request, res: Response) => {
    const project = videoService.getProject(req.params.videoId as string);
    if (!project?.outputPath || !fs.existsSync(project.outputPath)) {
      res.status(404).json({ error: 'Video file not found' });
      return;
    }

    const filePath = path.resolve(project.outputPath);
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Identify *this exact rendered file* — if assemble swaps the file under the same URL,
    // the ETag changes and any cached browser copy is invalidated. Combined with the
    // ?v=updatedAt cache-buster from the client, this means a fresh Assemble always serves
    // fresh bytes.
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const lastModified = stat.mtime.toUTCString();

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const cacheHeaders = {
      ETag: etag,
      'Last-Modified': lastModified,
      // Allow caching but force the browser to revalidate every time
      'Cache-Control': 'no-cache, must-revalidate',
    };

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        ...cacheHeaders,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        ...cacheHeaders,
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Download thumbnail
  router.get('/:videoId/thumbnail', (req: Request, res: Response) => {
    const project = videoService.getProject(req.params.videoId as string);
    if (!project?.thumbnailPath || !fs.existsSync(project.thumbnailPath)) {
      res.status(404).json({ error: 'Thumbnail not found' });
      return;
    }
    const thumbPath = path.resolve(project.thumbnailPath);
    const stat = fs.statSync(thumbPath);
    res.set({
      ETag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': 'no-cache, must-revalidate',
    });
    res.sendFile(thumbPath);
  });

  return router;
}
