import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { getMusicService, MOOD_TAGS } from '../services/music.service';

export function createMusicRouter(): Router {
  const router = Router();

  // Multer for music file uploads — store directly in the music cache dir
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, getMusicService().getCacheDir()),
      filename: (_req, file, cb) => {
        // Sanitize and preserve original name, avoid overwriting
        const base = path.basename(file.originalname, path.extname(file.originalname))
          .replace(/[^a-zA-Z0-9_\-. ]/g, '_').slice(0, 60);
        const ext = path.extname(file.originalname) || '.mp3';
        const name = `${base}_${Date.now()}${ext}`;
        cb(null, name);
      },
    }),
    fileFilter: (_req, file, cb) => {
      const allowed = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    },
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });

  // Search tracks by mood
  router.get('/search', async (req, res) => {
    const mood = (req.query.mood as string) ?? 'dramatic';
    const limit = parseInt((req.query.limit as string) ?? '10');
    try {
      const tracks = await getMusicService().searchTracks(mood, limit);
      res.json({ tracks, mood });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Download & cache a specific track
  router.post('/download', async (req, res) => {
    const { track } = req.body as { track: { id: string; name: string; artist_name: string; duration: number; audio: string; audiodownload: string; image: string; shareurl: string } };
    if (!track?.id) return res.status(400).json({ error: 'track required' });
    try {
      const localPath = await getMusicService().downloadTrack(track);
      res.json({ localPath, trackId: track.id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Upload a local music file
  router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    const filename = req.file.filename;
    const duration = await getMusicService().probeAudioDuration(req.file.path);
    res.json({ filename, duration, sizeKB: Math.round(req.file.size / 1024) });
  });

  // Search Epidemic Sound tracks (no API key needed)
  router.get('/epidemic/search', async (req, res) => {
    const mood = (req.query.mood as string) ?? '';
    const term = (req.query.term as string) ?? '';
    const limit = parseInt((req.query.limit as string) ?? '15');
    try {
      const tracks = await getMusicService().searchEpidemic(mood, term || undefined, limit);
      res.json({ tracks });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Download an Epidemic Sound preview track
  router.post('/epidemic/download', async (req, res) => {
    const { track } = req.body as { track: { id: number; title: string; artist: string; duration: number; previewUrl: string } };
    if (!track?.id || !track?.previewUrl) return res.status(400).json({ error: 'track with id and previewUrl required' });
    try {
      const localPath = await getMusicService().downloadEpidemicTrack(track as any);
      const filename = path.basename(localPath);
      const duration = await getMusicService().probeAudioDuration(localPath);
      res.json({ filename, localPath, duration });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List cached tracks (with duration)
  router.get('/cached', async (_req, res) => {
    const tracks = await getMusicService().listCachedWithDuration();
    res.json({ tracks });
  });

  // Stream a cached music file for preview playback
  router.get('/stream/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = getMusicService().getFilePath(filename);
    if (!filePath) return res.status(404).json({ error: 'Track not found' });

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'audio/mpeg',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Delete a single cached track
  router.delete('/cached/:filename', (req, res) => {
    const filePath = getMusicService().getFilePath(req.params.filename);
    if (!filePath) return res.status(404).json({ error: 'Track not found' });
    try { fs.unlinkSync(filePath); } catch { /* best effort */ }
    res.json({ ok: true });
  });

  // Clear all music cache
  router.delete('/cached', (_req, res) => {
    getMusicService().clearCache();
    res.json({ ok: true });
  });

  // List available moods and their tags
  router.get('/moods', (_req, res) => {
    res.json({ moods: MOOD_TAGS });
  });

  return router;
}
