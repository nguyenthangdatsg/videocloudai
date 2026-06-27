import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { VideoService } from '../services/video.service';
import { GenerationService } from '../services/generation.service';
import { SceneLibraryService } from '../services/scene-library.service';
import { getJobQueue } from '../queue/queue';
import { probeFile, transcodeToBrowserSafe, remuxFaststart } from '../services/import.service';
import type { SceneLine, VideoFormat, VideoDuration } from '@videocloudai/shared';

export function createVideosRouter(
  videoService: VideoService,
  generationService: GenerationService,
  libraryService: SceneLibraryService
): Router {
  const router = Router();

  // List projects
  router.get('/', (_req: Request, res: Response) => {
    const projects = videoService.listProjects();
    res.json({ projects });
  });

  // Create project
  router.post('/', (req: Request, res: Response) => {
    try {
      const { title, script, format, duration, narrationEnabled, narrationVoice, narrationRate, subtitlesEnabled, musicEnabled, musicMood, musicTrackPath } = req.body as {
        title: string;
        script: string;
        format?: VideoFormat;
        duration?: VideoDuration;
        narrationEnabled?: boolean;
        narrationVoice?: string;
        narrationRate?: string;
        subtitlesEnabled?: boolean;
        musicEnabled?: boolean;
        musicMood?: string;
        musicTrackPath?: string;
      };

      if (!title || !script) {
        res.status(400).json({ error: 'title and script are required' });
        return;
      }

      const project = videoService.createProject({
        title,
        script,
        format,
        duration,
        narrationEnabled,
        narrationVoice,
        narrationRate,
        subtitlesEnabled,
        musicEnabled,
        musicMood,
        musicTrackPath,
      });

      res.status(201).json({ project });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get project
  router.get('/:id', (req: Request, res: Response) => {
    const project = videoService.getProject(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }
    res.json({ project });
  });

  // Update music mood
  // Rename a video project. Body: { title: string }
  router.patch('/:id/title', (req: Request, res: Response) => {
    const { title } = req.body as { title?: string };
    const trimmed = (title ?? '').trim();
    if (!trimmed) { res.status(400).json({ error: 'title cannot be empty' }); return; }
    if (trimmed.length > 200) { res.status(400).json({ error: 'title too long (max 200 chars)' }); return; }
    try {
      const updated = videoService.updateTitle(req.params.id as string, trimmed);
      res.json({ project: updated });
    } catch (err) {
      const status = (err as Error & { status?: number }).status ?? 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  router.patch('/:id/music-mood', (req: Request, res: Response) => {
    const { mood } = req.body as { mood: string };
    if (!mood) { res.status(400).json({ error: 'mood required' }); return; }
    try {
      const updated = videoService.updateMusicMood(req.params.id as string, mood);
      res.json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Update music on/off and mute-original-audio flag
  router.patch('/:id/music-settings', (req: Request, res: Response) => {
    const { musicEnabled, muteOriginalAudio } = req.body as { musicEnabled?: boolean; muteOriginalAudio?: boolean };
    try {
      const updated = videoService.updateMusicSettings(req.params.id as string, { musicEnabled, muteOriginalAudio });
      res.json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Update blur regions
  router.patch('/:id/blur-regions', (req: Request, res: Response) => {
    const { regions } = req.body as { regions: unknown[] };
    if (!Array.isArray(regions)) {
      res.status(400).json({ error: 'regions must be an array' });
      return;
    }
    try {
      const updated = videoService.updateBlurRegions(req.params.id as string, regions as never[]);
      res.json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Update text overlays
  router.patch('/:id/text-overlays', (req: Request, res: Response) => {
    const { overlays } = req.body as { overlays: unknown[] };
    if (!Array.isArray(overlays)) {
      res.status(400).json({ error: 'overlays must be an array' });
      return;
    }
    try {
      const updated = videoService.updateTextOverlays(req.params.id as string, overlays);
      res.json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Pin / unpin a specific cached music track
  router.patch('/:id/music-track', (req: Request, res: Response) => {
    const { trackPath } = req.body as { trackPath: string | null };
    try {
      const updated = videoService.updateMusicTrack(req.params.id as string, trackPath ?? null);
      res.json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Update scenes
  router.put('/:id/scenes', (req: Request, res: Response) => {
    const { scenes } = req.body as { scenes: SceneLine[] };
    try {
      const updated = videoService.updateScenes(req.params.id as string, scenes);
      res.json({ project: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Queue scene generation for this video
  router.post('/:id/generate-scenes', async (req: Request, res: Response) => {
    const project = videoService.getProject(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const jobs: string[] = [];

    for (const scene of project.scenes) {
      // Check if we can reuse existing scene
      const matches = libraryService.findReuseMatches(scene, 1);
      if (matches.length > 0 && matches[0].score >= 0.5) {
        // Reuse existing asset
        continue;
      }

      const gen = await generationService.requestGeneration(scene, {
        videoId: project.id,
      });

      const job = getJobQueue().enqueue(
        'generate-scene',
        { generationId: gen.id, sceneLine: scene, videoId: project.id },
        { priority: 'normal' }
      );

      jobs.push(job.id);
    }

    res.json({ jobIds: jobs, totalScenes: project.scenes.length });
  });

  // Assemble video
  router.post('/:id/assemble', async (req: Request, res: Response) => {
    const project = videoService.getProject(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const { clips, effects, frameTransform } = req.body as {
      clips: unknown[];
      effects?: { motionEffect?: string; transition?: string };
      frameTransform?: { rotation: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; crop: { x: number; y: number; width: number; height: number } | null };
    };

    const job = getJobQueue().enqueue(
      'assemble-video',
      { videoId: project.id, clips: clips ?? [], effects, frameTransform },
      { priority: 'high' }
    );

    res.json({ jobId: job.id });
  });

  // Delete project
  router.delete('/:id', (req: Request, res: Response) => {
    videoService.deleteProject(req.params.id as string);
    res.json({ success: true });
  });

  // Re-encode the project's video to a browser-safe H.264/AAC MP4.
  // Useful for older imports whose raw yt-dlp file uses AV1/HEVC/etc. and shows black in browsers.
  router.post('/:id/optimize-preview', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const project = videoService.getProject(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    if (!project.outputPath || !fs.existsSync(project.outputPath)) {
      res.status(400).json({ error: 'No source video file found for this project' });
      return;
    }

    console.log(`[optimize-preview] starting for video ${id}: ${project.outputPath}`);
    try {
      const info = await probeFile(project.outputPath);
      console.log(
        `[optimize-preview] probe: video=${info.videoCodec ?? '?'}/${info.pixFmt ?? '?'} ` +
          `audio=${info.audioCodec ?? 'none'} hasAudio=${info.hasAudio}`
      );

      const browserSafeVideo =
        info.videoCodec === 'h264' && (info.pixFmt === 'yuv420p' || info.pixFmt === 'yuvj420p');
      const browserSafeAudio = !info.hasAudio || info.audioCodec === 'aac';

      const dir = path.dirname(project.outputPath);
      const base = path.basename(project.outputPath, path.extname(project.outputPath));
      const outPath = path.join(dir, `${base.replace(/_web$/, '')}_web.mp4`);

      if (browserSafeVideo && browserSafeAudio && outPath !== project.outputPath) {
        console.log('[optimize-preview] already browser-safe — remuxing for faststart');
        try {
          await remuxFaststart(project.outputPath, outPath);
        } catch (remuxErr) {
          console.warn('[optimize-preview] remux failed, falling back to transcode:', remuxErr);
          await transcodeToBrowserSafe(project.outputPath, outPath, { hasAudio: info.hasAudio });
        }
      } else {
        console.log('[optimize-preview] transcoding to H.264');
        await transcodeToBrowserSafe(project.outputPath, outPath, { hasAudio: info.hasAudio });
      }

      if (outPath !== project.outputPath) {
        try {
          fs.unlinkSync(project.outputPath);
        } catch {
          /* best effort */
        }
      }
      const updated = videoService.updateOutputPath(id, outPath);
      console.log(`[optimize-preview] done: ${outPath}`);
      res.json({ project: updated, codec: info.videoCodec, pixFmt: info.pixFmt });
    } catch (err) {
      console.error('[optimize-preview] failed:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Split video into equal-duration segments
  router.post('/:id/split', async (req: Request, res: Response) => {
    const { segmentDuration } = req.body as { segmentDuration: number };
    if (!segmentDuration || segmentDuration < 1) {
      res.status(400).json({ error: 'segmentDuration must be >= 1 second' });
      return;
    }
    try {
      const segments = await videoService.splitVideo(req.params.id as string, segmentDuration);
      res.json({ segments });
    } catch (err) {
      console.error('[split]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Download a split segment file
  router.get('/:id/splits/:filename', (req: Request, res: Response) => {
    const splitsDir = videoService.getSplitsDir(req.params.id as string);
    if (!splitsDir) { res.status(404).json({ error: 'Not found' }); return; }
    const filename = path.basename(req.params.filename as string); // prevent path traversal
    const filePath = path.join(splitsDir, filename);
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'Segment not found' }); return; }
    res.download(filePath, filename);
  });

  // Trim assembled video to [start, end] range
  router.post('/:id/trim', async (req: Request, res: Response) => {
    const { start, end } = req.body;
    if (typeof start !== 'number' || typeof end !== 'number') {
      res.status(400).json({ error: 'start and end must be numbers (seconds)' }); return;
    }
    try {
      const project = await videoService.trimVideoOutput(req.params.id as string, start, end);
      res.json({ project });
    } catch (err) {
      console.error('[trim]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Set the project's work-in-progress status. Body: { status: 'pending' | 'in_progress' | 'uploaded', note?: string }
  router.patch('/:id/upload-status', (req: Request, res: Response) => {
    const { status, note } = req.body as { status?: string; note?: string | null };
    if (status !== 'pending' && status !== 'in_progress' && status !== 'uploaded') {
      res.status(400).json({ error: "status must be 'pending', 'in_progress', or 'uploaded'" }); return;
    }
    try {
      const project = videoService.setUploadStatus(req.params.id as string, status, note ?? null);
      res.json({ project });
    } catch (err) {
      console.error('[upload-status]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Re-run Groq to rewrite the imported social-media description into the user's voice.
  // Returns the updated project so the client can refresh.
  router.post('/:id/generate-description', async (req: Request, res: Response) => {
    try {
      const project = await videoService.generateAiDescription(req.params.id as string);
      res.json({ project });
    } catch (err) {
      console.error('[generate-description]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Crop assembled video to a region (percentages 0-100)
  router.post('/:id/crop', async (req: Request, res: Response) => {
    const { x, y, width, height } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
      res.status(400).json({ error: 'x, y, width, height must be numbers (0-100 percentages)' }); return;
    }
    try {
      const project = await videoService.cropVideoOutput(req.params.id as string, x, y, width, height);
      res.json({ project });
    } catch (err) {
      console.error('[crop]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Stats
  router.get('/meta/stats', (_req: Request, res: Response) => {
    res.json(videoService.getProjectStats());
  });

  return router;
}
