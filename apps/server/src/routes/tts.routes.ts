import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import multer from 'multer';
import { NarrationService, VOICES, LANGUAGE_LABELS } from '../services/narration.service';
import { SubtitleService } from '../services/subtitle.service';

export function createTtsRouter(narrationService: NarrationService, subtitleService: SubtitleService): Router {
  const router = Router();

  // Multer for audio uploads (transcription)
  const transcribeDir = path.join(process.env.CACHE_DIR ?? './cache', 'transcribe');
  fs.mkdirSync(transcribeDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, transcribeDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp3';
        cb(null, `upload_${Date.now()}${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      const allowed = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm', '.mp4'];
      cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
    },
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  });

  // List all available voices with metadata
  router.get('/voices', (_req: Request, res: Response) => {
    res.json({ voices: VOICES, languages: LANGUAGE_LABELS });
  });

  // Get styles for a specific voice
  router.get('/voices/:voiceId/styles', (req: Request, res: Response) => {
    const voiceId = req.params.voiceId as string;
    const styles = narrationService.getVoiceStyles(voiceId);
    res.json({ styles });
  });

  // Generate full TTS audio from text
  router.post('/generate', async (req: Request, res: Response) => {
    const { text, voice, rate, pitch, volume, style, stream } = req.body as {
      text?: string;
      voice?: string;
      rate?: string;
      pitch?: string;
      volume?: string;
      style?: string;
      stream?: boolean;
    };

    if (!text?.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    // Streaming mode: send progress as newline-delimited JSON
    if (stream) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Transfer-Encoding', 'chunked');
    }

    try {
      const result = await narrationService.generateNarration(text, {
        voice: voice || undefined,
        rate,
        pitch,
        volume,
        style,
        onProgress: stream ? (step, detail) => {
          res.write(JSON.stringify({ progress: true, step, detail }) + '\n');
        } : undefined,
      });
      const filename = path.basename(result.totalPath);
      const data = { filename, duration: result.duration, url: `/api/tts/audio/${filename}` };
      if (stream) {
        res.write(JSON.stringify(data) + '\n');
        res.end();
      } else {
        res.json(data);
      }
    } catch (err) {
      if (stream) {
        res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
        res.end();
      } else {
        res.status(500).json({ error: (err as Error).message });
      }
    }
  });

  // Preview — generate short sample and stream back as blob
  router.post('/preview', async (req: Request, res: Response) => {
    const { voice, rate, pitch, volume, style, text } = req.body as {
      voice?: string;
      rate?: string;
      pitch?: string;
      volume?: string;
      style?: string;
      text?: string;
    };

    const v = voice || 'en-US-GuyNeural';
    const voiceInfo = VOICES[v];
    const sampleText = text ?? (voiceInfo?.lang === 'vi'
      ? 'Xin chào, đây là giọng thuyết minh mẫu cho bạn nghe thử.'
      : voiceInfo?.lang === 'es'
        ? 'Hola, esta es una muestra de voz de narración.'
        : voiceInfo?.lang === 'fr'
          ? 'Bonjour, ceci est un aperçu de la voix de narration.'
          : voiceInfo?.lang === 'de'
            ? 'Hallo, dies ist eine Vorschau der Erzählerstimme.'
            : voiceInfo?.lang === 'ja'
              ? 'こんにちは、これはナレーション音声のプレビューです。'
              : voiceInfo?.lang === 'ko'
                ? '안녕하세요, 이것은 내레이션 음성 미리보기입니다.'
                : voiceInfo?.lang === 'zh'
                  ? '你好，这是旁白配音的预览。'
                  : 'Hello, this is a sample narration voice preview. Let me show you how this voice sounds with different expressions and tones.');

    try {
      const result = await narrationService.generateNarration(sampleText, {
        voice: v,
        rate,
        pitch,
        volume,
        style,
      });

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(result.totalPath).pipe(res);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Stream audio file
  router.get('/audio/:filename', (req: Request, res: Response) => {
    const cacheDir = path.join(process.env.CACHE_DIR ?? './cache', 'narration');
    const audioDir = path.join(process.env.ASSETS_DIR ?? './assets', 'audio');
    const filename = path.basename(req.params.filename as string);

    let filePath = path.join(cacheDir, filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(audioDir, filename);
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Audio file not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  });

  // Delete a TTS audio file
  router.delete('/audio/:filename', (req: Request, res: Response) => {
    const cacheDir = path.join(process.env.CACHE_DIR ?? './cache', 'narration');
    const audioDir = path.join(process.env.ASSETS_DIR ?? './assets', 'audio');
    const filename = path.basename(req.params.filename as string);

    let filePath = path.join(cacheDir, filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(audioDir, filename);
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    fs.unlinkSync(filePath);
    res.json({ ok: true });
  });

  // List previously generated TTS files
  router.get('/history', async (_req: Request, res: Response) => {
    const cacheDir = path.join(process.env.CACHE_DIR ?? './cache', 'narration');
    if (!fs.existsSync(cacheDir)) {
      res.json({ files: [] });
      return;
    }

    const entries = fs.readdirSync(cacheDir)
      .filter((f) => f.endsWith('.mp3') && !f.startsWith('seg_'))
      .map((f) => {
        const filePath = path.join(cacheDir, f);
        const stat = fs.statSync(filePath);
        return { filename: f, filePath, sizeKB: Math.round(stat.size / 1024), createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);

    const files = await Promise.all(entries.map(async (e) => {
      const duration = await narrationService.getAudioDuration(e.filePath);
      return {
        filename: e.filename,
        url: `/api/tts/audio/${e.filename}`,
        sizeKB: e.sizeKB,
        duration: Math.round(duration * 10) / 10,
        createdAt: e.createdAt,
      };
    }));

    res.json({ files });
  });

  // ═══ Transcription (Speech-to-Text) ═══

  // Transcribe an uploaded audio file
  router.post('/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
    const file = req.file;
    const existingFile = req.body?.filename as string | undefined;
    const model = (req.body?.model as string) || undefined;
    const language = (req.body?.language as string) || undefined;

    let audioPath: string;

    if (file) {
      audioPath = file.path;
    } else if (existingFile) {
      // Use an existing TTS history file
      const cacheDir = path.join(process.env.CACHE_DIR ?? './cache', 'narration');
      const candidate = path.join(cacheDir, path.basename(existingFile));
      if (!fs.existsSync(candidate)) {
        res.status(404).json({ error: 'Audio file not found' });
        return;
      }
      audioPath = candidate;
    } else {
      res.status(400).json({ error: 'No audio file provided' });
      return;
    }

    try {
      // Stream progress
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Transfer-Encoding', 'chunked');

      res.write(JSON.stringify({ progress: true, step: 'start', detail: `Transcribing audio (model: ${model || 'tiny'})...` }) + '\n');

      const outBase = path.resolve(transcribeDir, `transcript_${Date.now()}`);
      await subtitleService.runWhisper(path.resolve(audioPath), outBase, { model, language });

      res.write(JSON.stringify({ progress: true, step: 'parsing', detail: 'Parsing results...' }) + '\n');

      const srtPath = `${outBase}.srt`;
      if (!fs.existsSync(srtPath)) {
        res.write(JSON.stringify({ error: 'Transcription produced no output' }) + '\n');
        res.end();
        return;
      }

      const result = subtitleService.parseSRTFile(srtPath);
      const fullText = result.entries.map((e) => e.text).join(' ');

      res.write(JSON.stringify({
        text: fullText,
        entries: result.entries,
        duration: result.duration,
        srtPath: path.basename(srtPath),
      }) + '\n');
      res.end();
    } catch (err) {
      res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
      res.end();
    }
  });

  // Download SRT file
  router.get('/transcribe/srt/:filename', (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename as string);
    const filePath = path.join(transcribeDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'SRT not found' });
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  });

  return router;
}
