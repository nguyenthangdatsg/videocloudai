import { Router } from 'express';
import * as path from 'path';
import { TransformService } from '../services/transform.service';

export function createTransformRouter(transformService: TransformService): Router {
  const router = Router();

  // ── Projects CRUD ──

  router.get('/projects', (req, res) => {
    try {
      const projects = transformService.listProjects();
      res.json({ projects });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects', (req, res) => {
    try {
      const { mode, lockedCameraAnchor, sourceImagePath, instruction } = req.body;
      const project = transformService.createProject({
        mode,
        lockedCameraAnchor,
        sourceImagePath,
        instruction,
      });
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/projects/:id', (req, res) => {
    try {
      const project = transformService.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.put('/projects/:id', (req, res) => {
    try {
      const project = transformService.updateProject(req.params.id, req.body);
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/projects/:id', (req, res) => {
    try {
      transformService.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Quick mode ──

  router.post('/quick', async (req, res) => {
    try {
      const { sourceImagePath, instruction } = req.body;
      const project = transformService.createProject({
        mode: 'quick',
        sourceImagePath,
        instruction,
      });
      // Auto-derive anchor from source image
      if (sourceImagePath) {
        const anchor = await transformService.deriveAnchor(sourceImagePath);
        transformService.updateProject(project.id, { lockedCameraAnchor: anchor });
      }
      const updated = transformService.getProject(project.id);
      res.json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/quick/:id/to-advanced', (req, res) => {
    try {
      const project = transformService.convertToAdvanced(req.params.id);
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Segments ──

  router.post('/projects/:id/segments', (req, res) => {
    try {
      const { prompt, lighting, order } = req.body;
      const segment = transformService.addSegment(req.params.id, { prompt, lighting, segmentOrder: order });
      res.json({ segment });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.put('/segments/:id', (req, res) => {
    try {
      const segment = transformService.updateSegment(req.params.id, req.body);
      res.json({ segment });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/segments/:id', (req, res) => {
    try {
      transformService.deleteSegment(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:id/segments/reorder', (req, res) => {
    try {
      const { segmentIds } = req.body;
      transformService.reorderSegments(req.params.id, segmentIds);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Generation ──

  router.post('/projects/:id/build-prompts', (req, res) => {
    try {
      const result = transformService.buildAllPrompts(req.params.id);
      res.json({ prompts: result.map(r => ({ segmentId: r.segmentId, composedPrompt: r.prompt })) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:id/derive-anchor', async (req, res) => {
    try {
      const project = transformService.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      if (!project.sourceImagePath) {
        res.status(400).json({ error: 'No source image path set' });
        return;
      }
      const anchor = await transformService.deriveAnchor(project.sourceImagePath);
      transformService.updateProject(req.params.id, { lockedCameraAnchor: anchor });
      res.json({ anchor });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:id/assemble', async (req, res) => {
    try {
      const outputPath = await transformService.assembleProject(req.params.id);
      const url = `/renders/${path.basename(outputPath)}`;
      const project = transformService.getProject(req.params.id);
      res.json({ project, url });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
