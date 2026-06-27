import { Router } from 'express';
import { checkYtDlp, isSupportedUrl } from '../services/import.service';
import { VideoService } from '../services/video.service';
import { getJobQueue } from '../queue/queue';

export function createImportRouter(_videoService: VideoService): Router {
  const router = Router();

  router.get('/check', async (_req, res) => {
    const ok = await checkYtDlp();
    res.json({ available: ok });
  });

  // Enqueues an import job and returns the jobId immediately. The client subscribes to
  // SSE job:progress / job:completed events to follow per-step progress and pick up the
  // resulting project id when done.
  router.post('/url', async (req, res) => {
    const { url } = req.body as { url?: string };

    if (!url?.trim()) {
      return res.status(400).json({ error: 'url is required' });
    }

    if (!isSupportedUrl(url)) {
      return res.status(400).json({ error: 'Unsupported URL. Supported: TikTok, Instagram, YouTube, Twitter/X, Facebook.' });
    }

    try {
      const job = getJobQueue().enqueue('import-url', { url }, { priority: 'high', maxRetries: 0 });
      return res.json({ jobId: job.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Import failed: ${message}` });
    }
  });

  return router;
}
