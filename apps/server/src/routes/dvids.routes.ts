import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import {
  searchDvids,
  getAssetDetails,
  importDvidsAsset,
  getImportedAssets,
  getImportedAsset,
  updateImportedAsset,
  deleteImportedAsset,
  getCollections,
  autoTagAsset,
  getSmartSuggestions,
  resolveDvidsCacheDir,
  searchAndDownloadBatch,
} from '../services/dvids.service';

export function createDvidsRouter(): Router {
  const router = Router();

  // Search DVIDS
  router.get('/search', async (req: Request, res: Response) => {
    try {
      const { q, branch, category, aspectRatio, fromDate, toDate, hd, fromDuration, toDuration, sort, sortDir, page, maxResults } = req.query;
      if (!q) { res.status(400).json({ error: 'q (query) is required' }); return; }
      const result = await searchDvids(q as string, {
        branch: branch as string,
        category: category as string,
        aspectRatio: aspectRatio as string,
        fromDate: fromDate as string,
        toDate: toDate as string,
        hd: hd === '1' || hd === 'true',
        fromDuration: fromDuration ? Number(fromDuration) : undefined,
        toDuration: toDuration ? Number(toDuration) : undefined,
        sort: sort as string,
        sortDir: sortDir as string,
        page: page ? Number(page) : undefined,
        maxResults: maxResults ? Number(maxResults) : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get asset details
  router.get('/asset/:id', async (req: Request, res: Response) => {
    try {
      const dvidsId = req.params.id.includes(':') ? req.params.id : `video:${req.params.id}`;
      const asset = await getAssetDetails(dvidsId);
      res.json({ asset });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Smart suggestions
  router.get('/suggestions', (_req: Request, res: Response) => {
    const category = _req.query.category as string | undefined;
    res.json({ suggestions: getSmartSuggestions(category) });
  });

  // Download + import single video
  router.post('/download', async (req: Request, res: Response) => {
    try {
      const { dvidsId } = req.body;
      if (!dvidsId) { res.status(400).json({ error: 'dvidsId required' }); return; }
      const asset = await importDvidsAsset(dvidsId);
      res.json({ ok: true, asset });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Bulk download with NDJSON progress
  router.post('/download-batch', async (req: Request, res: Response) => {
    const { dvidsIds } = req.body as { dvidsIds: string[] };
    if (!dvidsIds?.length) { res.status(400).json({ error: 'dvidsIds required' }); return; }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    const results: any[] = [];
    for (let i = 0; i < dvidsIds.length; i++) {
      try {
        res.write(JSON.stringify({ progress: true, step: 'downloading', detail: `Importing ${i + 1}/${dvidsIds.length}...` }) + '\n');
        const asset = await importDvidsAsset(dvidsIds[i]);
        results.push(asset);
      } catch (err) {
        res.write(JSON.stringify({ progress: true, step: 'error', detail: `Failed: ${(err as Error).message}` }) + '\n');
      }
    }
    res.write(JSON.stringify({ done: true, assets: results }) + '\n');
    res.end();
  });

  // List imported assets
  router.get('/imported', (req: Request, res: Response) => {
    try {
      const { page, limit, branch, category, collection, favorite, search, tags } = req.query;
      const result = getImportedAssets({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        branch: branch as string,
        category: category as string,
        collection: collection as string,
        favorite: favorite === '1' || favorite === 'true',
        search: search as string,
        tags: tags as string,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get single imported asset
  router.get('/imported/:id', (req: Request, res: Response) => {
    try {
      const asset = getImportedAsset(Number(req.params.id));
      if (!asset) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ asset });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Update imported asset (tags, collection, favorite)
  router.put('/imported/:id', (req: Request, res: Response) => {
    try {
      const asset = updateImportedAsset(Number(req.params.id), req.body);
      if (!asset) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true, asset });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Delete imported asset
  router.delete('/imported/:id', (req: Request, res: Response) => {
    try {
      const ok = deleteImportedAsset(Number(req.params.id));
      if (!ok) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List collections
  router.get('/collections', (_req: Request, res: Response) => {
    try {
      res.json({ collections: getCollections() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Auto-tag from DVIDS keywords
  router.post('/imported/:id/auto-tag', (req: Request, res: Response) => {
    try {
      const tags = autoTagAsset(Number(req.params.id));
      res.json({ ok: true, tags });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve cached DVIDS video files
  router.get('/file/:filename', (req: Request, res: Response) => {
    const dir = resolveDvidsCacheDir();
    const filePath = path.join(dir, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  });

  return router;
}
