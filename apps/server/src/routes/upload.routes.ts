import { Router, Request, Response } from 'express';
import { PlatformUploadService } from '../services/platform-upload.service';
import { DistributionService } from '../services/distribution.service';
import { getJobQueue } from '../queue/queue';
import { dbAll } from '../db';

interface DbJobRow {
  id: string;
  type: string;
  payload: string;
  created_at: string;
}

export function createUploadRouter(
  uploadService: PlatformUploadService,
  distributionService: DistributionService
): Router {
  const router = Router();

  // POST /api/upload/:distributionId
  // body: { title?, description?, tags?, privacyStatus? }
  router.post('/:distributionId', (req: Request, res: Response): void => {
    const distributionId = req.params['distributionId'] as string;
    const {
      title,
      description,
      tags,
      privacyStatus = 'public',
    } = req.body as {
      title?: string;
      description?: string;
      tags?: string[];
      privacyStatus?: 'public' | 'private' | 'unlisted';
    };

    const distribution = distributionService.get(distributionId);
    if (!distribution) {
      res.status(404).json({ error: 'Distribution not found' });
      return;
    }

    const resolvedTitle = title ?? distribution.channel?.name ?? distribution.channelId;

    try {
      const job = uploadService.queueUpload(distributionId, {
        title: resolvedTitle,
        description,
        tags,
        privacyStatus,
      });

      res.json({ jobId: job.id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/upload/distributions/:distributionId/status
  router.get('/distributions/:distributionId/status', (req: Request, res: Response): void => {
    const distributionId = req.params['distributionId'] as string;

    const distribution = distributionService.get(distributionId);
    if (!distribution) {
      res.status(404).json({ error: 'Distribution not found' });
      return;
    }

    // Find the most recent upload job for this distribution by querying SQLite directly
    const rows = dbAll<DbJobRow>(
      `SELECT id, type, payload, created_at FROM jobs
       WHERE type = 'upload-to-platform'
       ORDER BY created_at DESC LIMIT 50`
    );
    const queue = getJobQueue();
    const matchingRow = rows.find((r) => {
      try {
        const p = JSON.parse(r.payload) as { distributionId?: string };
        return p.distributionId === distributionId;
      } catch {
        return false;
      }
    });
    const job = matchingRow ? queue.getJob(matchingRow.id) : null;

    res.json({ distribution, job: job ?? null });
  });

  return router;
}
