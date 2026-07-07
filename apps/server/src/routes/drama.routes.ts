import { Router } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { DramaService } from '../services/drama.service';
import { NarrationService } from '../services/narration.service';
import { SubtitleService } from '../services/subtitle.service';
import { generateVideoClip } from '../services/image-providers';

function getZoompanFilter(movement: string, w: number, h: number, duration: number): string {
  const frames = Math.ceil(duration * 24);
  const size = `${w}x${h}`;
  const scaleIn = `scale=w=${w * 2}:h=${h * 2}:force_original_aspect_ratio=decrease,pad=w=${w * 2}:h=${h * 2}:x=(ow-iw)/2:y=(oh-ih)/2:color=black`;

  switch (movement) {
    case 'zoom-in':
    case 'dolly-in':
      return `${scaleIn}[sc];[sc]zoompan=z='min(zoom+0.0015,1.5)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${size},fps=24,setsar=1/1,format=yuv420p[out]`;
    case 'zoom-out':
    case 'dolly-out':
      return `${scaleIn}[sc];[sc]zoompan=z='max(1.5-0.0015*on,1.0)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${size},fps=24,setsar=1/1,format=yuv420p[out]`;
    case 'pan-left':
      return `${scaleIn}[sc];[sc]zoompan=z=1.3:d=${frames}:x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':s=${size},fps=24,setsar=1/1,format=yuv420p[out]`;
    case 'pan-right':
    case 'tracking':
      return `${scaleIn}[sc];[sc]zoompan=z=1.3:d=${frames}:x='(iw-iw/zoom)*(on/${frames})':y='ih/2-(ih/zoom/2)':s=${size},fps=24,setsar=1/1,format=yuv420p[out]`;
    case 'tilt-up':
      return `${scaleIn}[sc];[sc]zoompan=z=1.3:d=${frames}:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/${frames})':s=${size},fps=24,setsar=1/1,format=yuv420p[out]`;
    case 'tilt-down':
      return `${scaleIn}[sc];[sc]zoompan=z=1.3:d=${frames}:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(on/${frames})':s=${size},fps=24,setsar=1/1,format=yuv420p[out]`;
    case 'static':
    default:
      return `[0:v]scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease[scaled];[scaled]pad=w=${w}:h=${h}:x=(ow-iw)/2:y=(oh-ih)/2:color=black[padded];[padded]fps=24,setsar=1/1,format=yuv420p[out]`;
  }
}

export function createDramaRouter(
  dramaService: DramaService,
  narrationService: NarrationService,
  subtitleService: SubtitleService
): Router {
  const router = Router();

  // ── Projects ──

  router.get('/projects', (req, res) => {
    try {
      const mode = req.query.mode as 'video' | 'image' | undefined;
      const projects = dramaService.listProjects(mode);
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

  router.post('/projects/:projectId/shots/:shotId/generate-video', async (req, res) => {
    const { projectId, shotId } = req.params;
    const { model, mode = 'motion' } = req.body as { model?: string; mode?: 'ai' | 'motion' };

    try {
      const shot = dramaService.getShot(shotId);
      if (!shot) return res.status(404).json({ error: 'Shot not found' });

      const project = dramaService.getProject(projectId);
      const ar = project?.aspectRatio || '9:16';
      let w = 720;
      let h = 1280;
      if (ar === '16:9') {
        w = 1280;
        h = 720;
      }

      const duration = shot.duration || 4.0;
      const filename = `drama_shot_${shotId}_${Date.now()}.mp4`;
      const videosDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'videos');
      fs.mkdirSync(videosDir, { recursive: true });
      const destPath = path.join(videosDir, filename);

      if (mode === 'ai') {
        if (!shot.prompt) return res.status(400).json({ error: 'Shot has no prompt generated yet' });
        await generateVideoClip(shot.prompt, ar, destPath, duration, model);
      } else {
        if (!shot.keyframeUrl) return res.status(400).json({ error: 'Shot has no keyframe image generated yet' });
        const imagesDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'images');
        const imgPath = path.join(imagesDir, path.basename(shot.keyframeUrl));
        if (!fs.existsSync(imgPath)) return res.status(400).json({ error: 'Keyframe image file not found on disk' });

        const filter = getZoompanFilter(shot.cameraMovement || 'static', w, h, duration);

        await new Promise<void>((resolve, reject) => {
          const { spawn } = require('child_process');
          const proc = spawn('ffmpeg', [
            '-y',
            '-loop', '1',
            '-i', imgPath,
            '-filter_complex', filter,
            '-map', '[out]',
            '-t', String(duration),
            '-an',
            destPath
          ]);
          proc.on('close', (code: number) => {
            if (code === 0) resolve();
            else reject(new Error('FFmpeg failed generating zoompan video clip'));
          });
        });
      }

      const videoUrl = `/api/image/video/file/${filename}`;

      const updated = dramaService.updateShot(shotId, {
        videoUrl,
        generationStatus: 'completed'
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Batch generate prompts for all shots missing prompts
  router.post('/projects/:projectId/episodes/:episodeId/generate-all-prompts', async (req, res) => {
    try {
      const scenes = dramaService.listScenes(req.params.episodeId);
      const shotsWithoutPrompt = scenes.flatMap(s => s.shots).filter(sh => !sh.prompt);
      const results: Array<{ id: string; prompt: string }> = [];
      for (const shot of shotsWithoutPrompt) {
        const updated = await dramaService.generateShotPrompt(req.params.projectId, shot.id);
        results.push({ id: updated.id, prompt: updated.prompt });
      }
      res.json({ generated: results.length, shots: results });
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

  router.post('/projects/:projectId/episodes/:episodeId/apply-fixes', async (req, res) => {
    try {
      const { issues } = req.body;
      if (!Array.isArray(issues) || issues.length === 0) {
        return res.status(400).json({ error: 'issues array is required' });
      }
      const result = await dramaService.applyReviewFixes(req.params.projectId, req.params.episodeId, issues);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/projects/:projectId/episodes/:episodeId/images', (req, res) => {
    try {
      const cleared = dramaService.clearEpisodeImages(req.params.episodeId);
      res.json({ cleared });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Audio & Subtitles Generation ──

  router.post('/projects/:projectId/episodes/:episodeId/generate-audio', async (req, res) => {
    const { projectId, episodeId } = req.params;
    const { voiceVolume = 1.0, musicVolume = 0.2, bgMusicTrack } = req.body as { voiceVolume?: number; musicVolume?: number; bgMusicTrack?: string };

    try {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Transfer-Encoding', 'chunked');

      res.write(JSON.stringify({ progress: true, step: 'start', detail: 'Fetching episode and scenes...' }) + '\n');
      const episode = dramaService.getEpisode(episodeId);
      if (!episode) throw new Error('Episode not found');

      const scenes = dramaService.listScenes(episodeId);
      scenes.sort((a, b) => a.sortOrder - b.sortOrder);

      const characters = dramaService.listCharacters(projectId);
      const charMap = new Map(characters.map(c => [c.id, c]));

      const allShots: any[] = [];
      for (const scene of scenes) {
        const sceneShots = dramaService.listShots(scene.id);
        sceneShots.sort((a, b) => a.sortOrder - b.sortOrder);
        allShots.push(...sceneShots);
      }

      if (allShots.length === 0) {
        throw new Error('No shots found in this episode');
      }

      const workDir = path.join(process.env.CACHE_DIR ?? './cache', 'drama_assembly', episodeId);
      fs.mkdirSync(workDir, { recursive: true });

      const shotAudioPaths: string[] = [];
      let totalDuration = 0;

      for (let i = 0; i < allShots.length; i++) {
        const shot = allShots[i];
        const shotIndex = i + 1;
        const shotDur = shot.duration || 4.0;
        totalDuration += shotDur;

        res.write(JSON.stringify({ progress: true, step: 'tts', detail: `Processing shot ${shotIndex}/${allShots.length} (duration: ${shotDur}s)...` }) + '\n');

        const shotWavPath = path.join(workDir, `shot_${shotIndex}.wav`);
        shotAudioPaths.push(shotWavPath);

        const text = shot.dialogueLine ? shot.dialogueLine.trim() : '';

        if (text) {
          let voiceId = 'en-US-AndrewMultilingualNeural';
          if (shot.characterIds && shot.characterIds.length > 0) {
            const firstChar = charMap.get(shot.characterIds[0]);
            if (firstChar && firstChar.voiceId) {
              voiceId = firstChar.voiceId;
            }
          }

          res.write(JSON.stringify({ progress: true, step: 'tts', detail: `Generating TTS for shot ${shotIndex}: "${text.substring(0, 30)}..." using voice ${voiceId}` }) + '\n');
          const ttsResult = await narrationService.generateNarration(text, { voice: voiceId });
          const rawTtsPath = ttsResult.totalPath;

          await new Promise<void>((resolve, reject) => {
            const { spawn } = require('child_process');
            const proc = spawn('ffmpeg', [
              '-y',
              '-i', rawTtsPath,
              '-filter_complex', `apad=whole_dur=${shotDur}`,
              '-t', String(shotDur),
              shotWavPath
            ]);
            proc.on('close', (code: number) => {
              if (code === 0) resolve();
              else reject(new Error(`FFmpeg failed with code ${code} on shot ${shotIndex}`));
            });
          });
        } else {
          await new Promise<void>((resolve, reject) => {
            const { spawn } = require('child_process');
            const proc = spawn('ffmpeg', [
              '-y',
              '-f', 'lavfi',
              '-i', `anullsrc=r=44100:cl=mono`,
              '-t', String(shotDur),
              shotWavPath
            ]);
            proc.on('close', (code: number) => {
              if (code === 0) resolve();
              else reject(new Error(`FFmpeg failed to generate silence for shot ${shotIndex}`));
            });
          });
        }
      }

      res.write(JSON.stringify({ progress: true, step: 'concat', detail: 'Combining audio chunks...' }) + '\n');
      const concatListPath = path.join(workDir, 'concat_list.txt');
      const fileLines = shotAudioPaths.map(p => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n');
      fs.writeFileSync(concatListPath, fileLines, 'utf-8');

      const narrationPath = path.join(workDir, 'narration.wav');
      await new Promise<void>((resolve, reject) => {
        const { spawn } = require('child_process');
        const proc = spawn('ffmpeg', [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-c', 'copy',
          narrationPath
        ]);
        proc.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg failed during audio concatenation`));
        });
      });

      const outputDir = path.join(process.env.CACHE_DIR ?? './cache', 'narration');
      fs.mkdirSync(outputDir, { recursive: true });
      const finalFilename = `drama_episode_${episodeId}_${Date.now()}.mp3`;
      const finalAudioPath = path.join(outputDir, finalFilename);

      let finalArgs: string[] = [];

      if (bgMusicTrack) {
        res.write(JSON.stringify({ progress: true, step: 'mux', detail: `Mixing background music: ${bgMusicTrack}...` }) + '\n');
        const musicPath = path.join(path.resolve(process.env.ASSETS_DIR ?? './assets', 'music'), path.basename(bgMusicTrack));
        if (fs.existsSync(musicPath)) {
          finalArgs = [
            '-y',
            '-i', narrationPath,
            '-i', musicPath,
            '-filter_complex', `[0:a]volume=${voiceVolume}[v];[1:a]aloop=loop=-1:size=2e+09,atrim=0:${totalDuration},afade=t=out:st=${Math.max(0, totalDuration - 3)}:d=3,volume=${musicVolume}[m];[v][m]amix=inputs=2:duration=first[a]`,
            '-map', '[a]',
            '-c:a', 'libmp3lame',
            '-q:a', '2',
            finalAudioPath
          ];
        } else {
          finalArgs = ['-y', '-i', narrationPath, '-c:a', 'libmp3lame', '-q:a', '2', finalAudioPath];
        }
      } else {
        finalArgs = ['-y', '-i', narrationPath, '-c:a', 'libmp3lame', '-q:a', '2', finalAudioPath];
      }

      await new Promise<void>((resolve, reject) => {
        const { spawn } = require('child_process');
        const proc = spawn('ffmpeg', finalArgs);
        proc.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error('FFmpeg failed during audio mix/output compression'));
        });
      });

      dramaService.updateEpisode(episodeId, {
        audioFilename: finalFilename,
        audioDuration: totalDuration
      });

      res.write(JSON.stringify({
        success: true,
        audioFilename: finalFilename,
        audioDuration: totalDuration,
        url: `/api/tts/audio/${finalFilename}`
      }) + '\n');
      res.end();

      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch { /* ignore */ }

    } catch (err) {
      res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
      res.end();
    }
  });

  router.post('/projects/:projectId/episodes/:episodeId/generate-subtitles', (req, res) => {
    const { projectId, episodeId } = req.params;
    try {
      const episode = dramaService.getEpisode(episodeId);
      if (!episode) return res.status(404).json({ error: 'Episode not found' });

      const scenes = dramaService.listScenes(episodeId);
      scenes.sort((a, b) => a.sortOrder - b.sortOrder);

      const characters = dramaService.listCharacters(projectId);
      const charMap = new Map(characters.map(c => [c.id, c]));

      const srtEntries: string[] = [];
      let currentMs = 0;
      let counter = 1;

      for (const scene of scenes) {
        const shots = dramaService.listShots(scene.id);
        shots.sort((a, b) => a.sortOrder - b.sortOrder);

        for (const shot of shots) {
          const durationMs = Math.round((shot.duration || 4.0) * 1000);
          const startMs = currentMs;
          const endMs = currentMs + durationMs;

          if (shot.dialogueLine && shot.dialogueLine.trim()) {
            let prefix = '';
            if (shot.characterIds && shot.characterIds.length > 0) {
              const firstChar = charMap.get(shot.characterIds[0]);
              if (firstChar) {
                prefix = `${firstChar.name}: `;
              }
            }

            const text = `${prefix}${shot.dialogueLine.trim()}`;
            
            const fmtTime = (ms: number) => {
              const h = Math.floor(ms / 3600000);
              const m = Math.floor((ms % 3600000) / 60000);
              const s = Math.floor((ms % 60000) / 1000);
              const msVal = ms % 1000;
              return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msVal).padStart(3, '0')}`;
            };

            srtEntries.push(
              `${counter}\n${fmtTime(startMs)} --> ${fmtTime(endMs)}\n${text}\n`
            );
            counter++;
          }
          currentMs = endMs;
        }
      }

      const srtContent = srtEntries.join('\n');
      const srtDir = path.join(process.env.CACHE_DIR ?? './cache', 'transcribe');
      fs.mkdirSync(srtDir, { recursive: true });

      const srtFilename = `drama_episode_${episodeId}.srt`;
      const srtPath = path.join(srtDir, srtFilename);
      fs.writeFileSync(srtPath, srtContent, 'utf-8');

      dramaService.updateEpisode(episodeId, {
        srtFilename: srtFilename
      });

      res.json({
        success: true,
        srtFilename: srtFilename,
        srtContent: srtContent
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/projects/:projectId/episodes/:episodeId/export', async (req, res) => {
    const { projectId, episodeId } = req.params;
    const { preset = 'tiktok', ratio = '9:16' } = req.body as { preset?: string; ratio?: string };

    try {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Transfer-Encoding', 'chunked');

      res.write(JSON.stringify({ progress: true, step: 'start', detail: 'Locating scenes and shots...' }) + '\n');
      const episode = dramaService.getEpisode(episodeId);
      if (!episode) throw new Error('Episode not found');

      const scenes = dramaService.listScenes(episodeId);
      scenes.sort((a, b) => a.sortOrder - b.sortOrder);

      const allShots: any[] = [];
      for (const scene of scenes) {
        const sceneShots = dramaService.listShots(scene.id);
        sceneShots.sort((a, b) => a.sortOrder - b.sortOrder);
        allShots.push(...sceneShots);
      }

      if (allShots.length === 0) {
        throw new Error('No shots found in this episode');
      }

      let w = 720;
      let h = 1280;
      if (preset === 'youtube' || ratio === '16:9') {
        w = 1280;
        h = 720;
      }

      const tempDir = path.join(process.env.CACHE_DIR ?? './cache', 'drama_export', `${episodeId}_${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const clipPaths: string[] = [];

      const imagesDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'images');
      const videosDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'videos');

      for (let i = 0; i < allShots.length; i++) {
        const shot = allShots[i];
        const shotIndex = i + 1;
        const duration = shot.duration || 4.0;
        const clipPath = path.join(tempDir, `clip_${shotIndex}.mp4`);
        clipPaths.push(clipPath);

        res.write(JSON.stringify({ progress: true, step: 'clip', detail: `Processing clip ${shotIndex}/${allShots.length} (${duration}s)...` }) + '\n');

        let inputPath = '';
        let isVideo = false;

        if (shot.videoUrl) {
          const vPath = path.join(videosDir, path.basename(shot.videoUrl));
          if (fs.existsSync(vPath)) {
            inputPath = vPath;
            isVideo = true;
          }
        }

        if (!inputPath && shot.keyframeUrl) {
          const imgPath = path.join(imagesDir, path.basename(shot.keyframeUrl));
          if (fs.existsSync(imgPath)) {
            inputPath = imgPath;
            isVideo = false;
          }
        }

        const filter = isVideo
          ? `[0:v]scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease[scaled];[scaled]pad=w=${w}:h=${h}:x=(ow-iw)/2:y=(oh-ih)/2:color=black[padded];[padded]fps=24,setsar=1/1,format=yuv420p[out]`
          : getZoompanFilter(shot.cameraMovement || 'static', w, h, duration);

        if (inputPath) {
          await new Promise<void>((resolve, reject) => {
            const { spawn } = require('child_process');
            const args = isVideo ? [
              '-y',
              '-i', inputPath,
              '-filter_complex', filter,
              '-map', '[out]',
              '-t', String(duration),
              '-an',
              clipPath
            ] : [
              '-y',
              '-loop', '1',
              '-i', inputPath,
              '-filter_complex', filter,
              '-map', '[out]',
              '-t', String(duration),
              '-an',
              clipPath
            ];
            const proc = spawn('ffmpeg', args);
            proc.on('close', (code: number) => {
              if (code === 0) resolve();
              else reject(new Error(`FFmpeg failed on clip ${shotIndex}`));
            });
          });
        } else {
          await new Promise<void>((resolve, reject) => {
            const { spawn } = require('child_process');
            const proc = spawn('ffmpeg', [
              '-y',
              '-f', 'lavfi',
              '-i', `color=c=black:s=${w}x${h}:r=24`,
              '-t', String(duration),
              '-pix_fmt', 'yuv420p',
              '-an',
              clipPath
            ]);
            proc.on('close', (code: number) => {
              if (code === 0) resolve();
              else reject(new Error(`FFmpeg failed blank clip ${shotIndex}`));
            });
          });
        }
      }

      res.write(JSON.stringify({ progress: true, step: 'concat', detail: 'Stitching video clips together...' }) + '\n');
      const concatList = path.join(tempDir, 'concat.txt');
      const concatContent = clipPaths.map(p => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n');
      fs.writeFileSync(concatList, concatContent, 'utf-8');

      const mergedVideoOnly = path.join(tempDir, 'merged_video.mp4');
      await new Promise<void>((resolve, reject) => {
        const { spawn } = require('child_process');
        const proc = spawn('ffmpeg', [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatList,
          '-c', 'copy',
          mergedVideoOnly
        ]);
        proc.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error('FFmpeg failed concatenating video clips'));
        });
      });

      const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders');
      fs.mkdirSync(rendersDir, { recursive: true });

      const finalFilename = `drama_episode_${episodeId}.mp4`;
      const finalOutputPath = path.join(rendersDir, finalFilename);

      let finalArgs: string[] = [];
      const narrationDir = path.join(process.env.CACHE_DIR ?? './cache', 'narration');
      let audioPath = '';

      if (episode.audioFilename) {
        audioPath = path.join(narrationDir, episode.audioFilename);
      }

      if (audioPath && fs.existsSync(audioPath)) {
        res.write(JSON.stringify({ progress: true, step: 'mux', detail: 'Dubbing dialogue audio and sound effects track...' }) + '\n');
        finalArgs = [
          '-y',
          '-i', mergedVideoOnly,
          '-i', audioPath,
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-shortest',
          finalOutputPath
        ];
      } else {
        res.write(JSON.stringify({ progress: true, step: 'mux', detail: 'No generated audio track found. Exporting silent video...' }) + '\n');
        finalArgs = [
          '-y',
          '-i', mergedVideoOnly,
          '-f', 'lavfi',
          '-i', 'anullsrc=r=44100:cl=mono',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-shortest',
          finalOutputPath
        ];
      }

      await new Promise<void>((resolve, reject) => {
        const { spawn } = require('child_process');
        const proc = spawn('ffmpeg', finalArgs);
        proc.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error('FFmpeg failed dubbing audio into video'));
        });
      });

      dramaService.updateEpisode(episodeId, {
        videoFilename: finalFilename
      });

      res.write(JSON.stringify({
        success: true,
        videoFilename: finalFilename,
        url: `/renders/${finalFilename}`
      }) + '\n');
      res.end();

      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch { /* ignore */ }

    } catch (err) {
      res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
      res.end();
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
