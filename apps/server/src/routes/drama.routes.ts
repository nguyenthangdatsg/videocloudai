import { Router } from 'express';
import { DramaService } from '../services/drama.service';

export function createDramaRouter(dramaService: DramaService): Router {
  const router = Router();

  // ── Projects ──

  router.get('/projects', (_req, res) => {
    try {
      const projects = dramaService.listProjects();
      res.json(projects);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/projects/:id', (req, res) => {
    try {
      const project = dramaService.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects', (req, res) => {
    try {
      const project = dramaService.createProject(req.body);
      res.status(201).json(project);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.patch('/projects/:id', (req, res) => {
    try {
      const project = dramaService.updateProject(req.params.id, req.body);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/projects/:id', (req, res) => {
    try {
      const deleted = dramaService.deleteProject(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Project not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Episodes ──

  router.get('/projects/:projectId/episodes', (req, res) => {
    try {
      const episodes = dramaService.listEpisodes(req.params.projectId);
      res.json(episodes);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/episodes/:id', (req, res) => {
    try {
      const episode = dramaService.getEpisode(req.params.id);
      if (!episode) return res.status(404).json({ error: 'Episode not found' });
      res.json(episode);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.patch('/episodes/:id', (req, res) => {
    try {
      const episode = dramaService.updateEpisode(req.params.id, req.body);
      if (!episode) return res.status(404).json({ error: 'Episode not found' });
      res.json(episode);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Characters ──

  router.get('/projects/:projectId/characters', (req, res) => {
    try {
      const characters = dramaService.listCharacters(req.params.projectId);
      res.json(characters);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:projectId/characters', (req, res) => {
    try {
      const character = dramaService.createCharacter(req.params.projectId, req.body);
      res.status(201).json(character);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.patch('/characters/:id', (req, res) => {
    try {
      const character = dramaService.updateCharacter(req.params.id, req.body);
      if (!character) return res.status(404).json({ error: 'Character not found' });
      res.json(character);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/characters/:id', (req, res) => {
    try {
      const deleted = dramaService.deleteCharacter(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Character not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Locations ──

  router.get('/projects/:projectId/locations', (req, res) => {
    try {
      const locations = dramaService.listLocations(req.params.projectId);
      res.json(locations);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:projectId/locations', (req, res) => {
    try {
      const location = dramaService.createLocation(req.params.projectId, req.body);
      res.status(201).json(location);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.patch('/locations/:id', (req, res) => {
    try {
      const location = dramaService.updateLocation(req.params.id, req.body);
      if (!location) return res.status(404).json({ error: 'Location not found' });
      res.json(location);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/locations/:id', (req, res) => {
    try {
      const deleted = dramaService.deleteLocation(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Location not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Scenes ──

  router.get('/episodes/:episodeId/scenes', (req, res) => {
    try {
      const scenes = dramaService.listScenes(req.params.episodeId);
      res.json(scenes);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/episodes/:episodeId/scenes', (req, res) => {
    try {
      const scene = dramaService.createScene(req.params.episodeId, req.body);
      res.status(201).json(scene);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/scenes/:id', (req, res) => {
    try {
      const scene = dramaService.getScene(req.params.id);
      if (!scene) return res.status(404).json({ error: 'Scene not found' });
      res.json(scene);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.patch('/scenes/:id', (req, res) => {
    try {
      const scene = dramaService.updateScene(req.params.id, req.body);
      if (!scene) return res.status(404).json({ error: 'Scene not found' });
      res.json(scene);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/scenes/:id', (req, res) => {
    try {
      const deleted = dramaService.deleteScene(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Scene not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Shots ──

  router.get('/scenes/:sceneId/shots', (req, res) => {
    try {
      const shots = dramaService.listShots(req.params.sceneId);
      res.json(shots);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/scenes/:sceneId/shots', (req, res) => {
    try {
      const shot = dramaService.createShot(req.params.sceneId, req.body);
      res.status(201).json(shot);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/shots/:id', (req, res) => {
    try {
      const shot = dramaService.getShot(req.params.id);
      if (!shot) return res.status(404).json({ error: 'Shot not found' });
      res.json(shot);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.patch('/shots/:id', (req, res) => {
    try {
      const shot = dramaService.updateShot(req.params.id, req.body);
      if (!shot) return res.status(404).json({ error: 'Shot not found' });
      res.json(shot);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/shots/:id', (req, res) => {
    try {
      const deleted = dramaService.deleteShot(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Shot not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── AI Generation ──

  router.post('/projects/:projectId/episodes/:episodeId/generate-outline', async (req, res) => {
    try {
      const episode = await dramaService.generateOutline(req.params.projectId, req.params.episodeId);
      res.json(episode);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:projectId/episodes/:episodeId/generate-script', async (req, res) => {
    try {
      const episode = await dramaService.generateScript(req.params.projectId, req.params.episodeId);
      res.json(episode);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:projectId/episodes/:episodeId/extract-characters', async (req, res) => {
    try {
      const characters = await dramaService.extractCharacters(req.params.projectId, req.params.episodeId);
      res.json(characters);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:projectId/episodes/:episodeId/extract-locations', async (req, res) => {
    try {
      const locations = await dramaService.extractLocations(req.params.projectId, req.params.episodeId);
      res.json(locations);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:projectId/episodes/:episodeId/generate-storyboard', async (req, res) => {
    try {
      const scenes = await dramaService.generateStoryboard(req.params.projectId, req.params.episodeId);
      res.json(scenes);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:projectId/shots/:shotId/generate-prompt', async (req, res) => {
    try {
      const shot = await dramaService.generateShotPrompt(req.params.projectId, req.params.shotId);
      res.json(shot);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:projectId/episodes/:episodeId/review', async (req, res) => {
    try {
      const result = await dramaService.reviewEpisode(req.params.projectId, req.params.episodeId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Stats ──

  router.get('/stats', (_req, res) => {
    try {
      res.json(dramaService.getStats());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
