import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun } from '../db';
import { VideoService } from '../services/video.service';
import { getJobQueue } from '../queue/queue';

export function createBatchRouter(videoService: VideoService): Router {
  const router = Router();

  // List batch jobs
  router.get('/', (_req: Request, res: Response) => {
    const rows = dbAll('SELECT * FROM batch_jobs ORDER BY created_at DESC LIMIT 50');
    res.json({ batchJobs: rows });
  });

  // Create batch job
  router.post('/', (req: Request, res: Response) => {
    const { templateVideoId, count } = req.body as {
      templateVideoId: string;
      count: number;
    };

    if (!templateVideoId || !count || count < 1 || count > 50) {
      res.status(400).json({ error: 'templateVideoId and count (1-50) required' });
      return;
    }

    const template = videoService.getProject(templateVideoId);
    if (!template) {
      res.status(404).json({ error: 'Template video not found' });
      return;
    }

    const batchId = uuidv4();
    const now = new Date().toISOString();

    dbRun(
      `INSERT INTO batch_jobs (id, template_video_id, variation_count, status,
       completed_count, failed_count, output_video_ids, created_at)
       VALUES (?, ?, ?, 'queued', 0, 0, '[]', ?)`,
      [batchId, templateVideoId, count, now]
    );

    const job = getJobQueue().enqueue(
      'batch-generate',
      { batchJobId: batchId, templateVideoId, count },
      { priority: 'low' }
    );

    res.status(201).json({ batchJobId: batchId, jobId: job.id });
  });

  // Get batch job
  router.get('/:id', (req: Request, res: Response) => {
    const row = dbGet('SELECT * FROM batch_jobs WHERE id = ?', [req.params.id as string]);
    if (!row) {
      res.status(404).json({ error: 'Batch job not found' });
      return;
    }
    res.json({ batchJob: row });
  });

  return router;
}
