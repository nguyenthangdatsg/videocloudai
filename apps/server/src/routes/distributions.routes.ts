import { Router, Request, Response } from 'express';
import { DistributionService } from '../services/distribution.service';
import type { DistributionStatus } from '@videocloudai/shared';

export function createDistributionsRouter(distributionService: DistributionService): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const { videoId, channelId, status } = req.query as {
      videoId?: string;
      channelId?: string;
      status?: DistributionStatus;
    };
    res.json({ distributions: distributionService.list({ videoId, channelId, status }) });
  });

  router.get('/:id', (req: Request, res: Response) => {
    const dist = distributionService.get(req.params['id'] as string);
    if (!dist) { res.status(404).json({ error: 'Distribution not found' }); return; }
    res.json({ distribution: dist });
  });

  router.post('/', (req: Request, res: Response) => {
    const { videoId, channelId, status, exportPath, note } = req.body as {
      videoId?: string;
      channelId?: string;
      status?: DistributionStatus;
      exportPath?: string;
      note?: string;
    };
    if (!videoId) { res.status(400).json({ error: 'videoId is required' }); return; }
    if (!channelId) { res.status(400).json({ error: 'channelId is required' }); return; }

    try {
      const dist = distributionService.create({ videoId, channelId, status, exportPath, note });
      res.status(201).json({ distribution: dist });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('UNIQUE')) {
        res.status(409).json({ error: 'Already distributed to this channel' });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const { status, exportPath, publishedAt, platformUrl, note, performanceNote, errorMessage } = req.body as {
      status?: DistributionStatus;
      exportPath?: string | null;
      publishedAt?: string | null;
      platformUrl?: string | null;
      note?: string | null;
      performanceNote?: string | null;
      errorMessage?: string | null;
    };
    const dist = distributionService.update(req.params['id'] as string, {
      status, exportPath, publishedAt, platformUrl, note, performanceNote, errorMessage,
    });
    if (!dist) { res.status(404).json({ error: 'Distribution not found' }); return; }
    res.json({ distribution: dist });
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const deleted = distributionService.delete(req.params['id'] as string);
    if (!deleted) { res.status(404).json({ error: 'Distribution not found' }); return; }
    res.json({ success: true });
  });

  return router;
}
