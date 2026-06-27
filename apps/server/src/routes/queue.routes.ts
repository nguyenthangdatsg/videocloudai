import { Router, Request, Response } from 'express';
import { getJobQueue } from '../queue/queue';
import type { JobStatus } from '@videocloudai/shared';

export function createQueueRouter(): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const { status, limit } = req.query as { status?: JobStatus; limit?: string };
    const jobs = getJobQueue().listJobs(status, limit ? parseInt(limit) : 50);
    res.json({ jobs });
  });

  router.get('/stats', (_req: Request, res: Response) => {
    res.json(getJobQueue().getStats());
  });

  router.get('/:id', (req: Request, res: Response) => {
    const job = getJobQueue().getJob(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({ job });
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const q = getJobQueue();
    const force = req.query.force === '1';
    if (force) {
      q.deleteJob(req.params.id as string);
    } else {
      q.cancelJob(req.params.id as string);
    }
    res.json({ success: true });
  });

  return router;
}
