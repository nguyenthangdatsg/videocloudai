import { Router, Request, Response } from 'express';
import { SceneLibraryService } from '../services/scene-library.service';
import type { SceneMood, SceneStyle, SceneCategory, SceneLine } from '@videocloudai/shared';

export function createLibraryRouter(libraryService: SceneLibraryService): Router {
  const router = Router();

  // List scenes
  router.get('/scenes', (req: Request, res: Response) => {
    const { mood, style, category, limit, offset } = req.query as Record<string, string>;
    const scenes = libraryService.listScenes({
      mood: mood as SceneMood,
      style: style as SceneStyle,
      category: category as SceneCategory,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
    res.json({ scenes });
  });

  // Get scene
  router.get('/scenes/:id', (req: Request, res: Response) => {
    const scene = libraryService.getScene(req.params.id as string);
    if (!scene) {
      res.status(404).json({ error: 'Scene not found' });
      return;
    }
    res.json({ scene });
  });

  // Create scene
  router.post('/scenes', (req: Request, res: Response) => {
    try {
      const scene = libraryService.createScene(req.body);
      res.status(201).json({ scene });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Search scenes
  router.get('/scenes/search/:query', (req: Request, res: Response) => {
    const results = libraryService.searchScenes(
      req.params.query as string,
      req.query.limit ? parseInt(req.query.limit as string) : 20
    );
    res.json({ results });
  });

  // Find reuse matches for a scene line
  router.post('/scenes/reuse-matches', (req: Request, res: Response) => {
    const { sceneLine, limit } = req.body as { sceneLine: SceneLine; limit?: number };
    if (!sceneLine) {
      res.status(400).json({ error: 'sceneLine is required' });
      return;
    }
    const matches = libraryService.findReuseMatches(sceneLine, limit ?? 5);
    res.json({ matches });
  });

  // List assets
  router.get('/assets', (req: Request, res: Response) => {
    const { sceneId } = req.query as Record<string, string>;
    const assets = libraryService.listAssets(sceneId);
    res.json({ assets });
  });

  // Get asset
  router.get('/assets/:id', (req: Request, res: Response) => {
    const asset = libraryService.getAsset(req.params.id as string);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    res.json({ asset });
  });

  // Library stats
  router.get('/stats', (_req: Request, res: Response) => {
    res.json(libraryService.getLibraryStats());
  });

  return router;
}
