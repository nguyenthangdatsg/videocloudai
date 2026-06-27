import { Router, Request, Response } from 'express';
import { GenerationService } from '../services/generation.service';
import { getJobQueue } from '../queue/queue';
import { getAvailableProviders } from '../providers';
import type { SceneLine } from '@videocloudai/shared';

export function createGenerationRouter(generationService: GenerationService): Router {
  const router = Router();

  // List generations
  router.get('/', (req: Request, res: Response) => {
    const { status } = req.query as { status?: string };
    const generations = generationService.listGenerations(status);
    res.json({ generations });
  });

  // Get single generation
  router.get('/:id', (req: Request, res: Response) => {
    const gen = generationService.getGeneration(req.params.id as string);
    if (!gen) {
      res.status(404).json({ error: 'Generation not found' });
      return;
    }
    res.json({ generation: gen });
  });

  // Request new generation
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { sceneLine, provider, forceNew } = req.body as {
        sceneLine: SceneLine;
        provider?: string;
        forceNew?: boolean;
      };

      if (!sceneLine?.visual) {
        res.status(400).json({ error: 'sceneLine.visual is required' });
        return;
      }

      const gen = await generationService.requestGeneration(sceneLine, {
        provider: provider as never,
        forceNew,
      });

      // Enqueue job
      const job = getJobQueue().enqueue(
        'generate-scene',
        { generationId: gen.id, sceneLine },
        { priority: 'normal' }
      );

      res.status(201).json({ generation: gen, jobId: job.id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get available providers
  router.get('/meta/providers', (_req: Request, res: Response) => {
    res.json({ providers: getAvailableProviders() });
  });

  return router;
}
