import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import multer from 'multer';
import { NarrationService, VOICES, LANGUAGE_LABELS } from '../services/narration.service';
import type { TtsEngine } from '../services/narration.service';
import { SubtitleService } from '../services/subtitle.service';
import { isReachable as omnivoiceReachable, listVoices as omnivoiceListVoices, getBaseUrl as omnivoiceBaseUrl } from '../providers/omnivoice.provider';
import { isAvailable as kokoroIsAvailable, listVoices as kokoroListVoices, listVoicesFormatted as kokoroListVoicesFormatted, type KokoroVoiceEntry } from '../providers/kokoro.provider';
import { isAvailable as googleTtsAvailable, isHealthy as googleTtsHealthy, listVoices as googleTtsListVoices, invalidateTokenCache as googleTtsInvalidateToken, getUsageStats as googleTtsUsageStats, resetUsageStats as googleTtsResetUsage, checkQuota as googleTtsCheckQuota, getVoiceType as googleTtsGetVoiceType, EMOTION_PRESETS } from '../providers/google-tts.provider';
import { getSettings } from '../services/settings.service';
import { dbRun, dbGet, dbAll } from '../db';

const execFileAsync = promisify(execFile);

// ═══ TTS Stories table ═══
function initTtsStoriesTable() {
  dbRun(`CREATE TABLE IF NOT EXISTS tts_stories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Untitled Story',
    content TEXT NOT NULL DEFAULT '',
    voice_groups TEXT,
    paragraph_count INTEGER DEFAULT 0,
    audio_path TEXT,
    duration REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  dbRun(`CREATE INDEX IF NOT EXISTS idx_tts_stories_updated ON tts_stories(updated_at)`);

  // Add para_durations column if missing (migration)
  try {
    dbRun(`ALTER TABLE tts_stories ADD COLUMN para_durations TEXT`);
  } catch { /* column already exists */ }

  dbRun(`CREATE TABLE IF NOT EXISTS tts_audio_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    story_id TEXT,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (story_id) REFERENCES tts_stories(id) ON DELETE SET NULL
  )`);
  dbRun(`CREATE INDEX IF NOT EXISTS idx_tts_audio_history_story ON tts_audio_history(story_id)`);
}

interface TtsStoryRow {
  id: string;
  title: string;
  content: string;
  voice_groups: string | null;
  paragraph_count: number;
  audio_path: string | null;
  duration: number;
  para_durations: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function createTtsRouter(narrationService: NarrationService, subtitleService: SubtitleService): Router {
  const router = Router();

  initTtsStoriesTable();

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
    const { text, voice, rate, pitch, volume, style, stream, engine } = req.body as {
      text?: string;
      voice?: string;
      rate?: string;
      pitch?: string;
      volume?: string;
      style?: string;
      stream?: boolean;
      engine?: TtsEngine;
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
        engine,
        onProgress: stream ? (step, detail) => {
          res.write(JSON.stringify({ progress: true, step, detail }) + '\n');
        } : undefined,
      });
      const filename = path.basename(result.totalPath);
      const data = { filename, duration: result.duration, url: `/api/tts/audio/${filename}` };
      // Record in audio history (no project)
      const label = (text || '').slice(0, 60).replace(/\n/g, ' ').trim();
      dbRun(
        `INSERT OR REPLACE INTO tts_audio_history (filename, story_id, label) VALUES (?, NULL, ?)`,
        [filename, label],
      );
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

  // ═══ Story parser helper ═══
  interface VGroup { id: string; engine: string; voiceId: string; emotion?: string; rate?: string; pitch?: string }
  interface StoryParagraph { group: string; emotion?: string; pace?: string; text: string }

  function parseStory(text: string): { title: string; voiceGroups: VGroup[]; paragraphs: StoryParagraph[] } {
    const voiceGroups: VGroup[] = [];
    const vgRegex = /^\[VOICE_GROUP:\s*(.+?)\]\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = vgRegex.exec(text)) !== null) {
      const parts = m[1].split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const id = parts[0];
      let engine = 'edge-tts', voiceId = '', emotion: string | undefined, rate: string | undefined, pitch: string | undefined;
      for (let i = 1; i < parts.length; i++) {
        const ci = parts[i].indexOf(':');
        if (ci > 0) {
          const k = parts[i].slice(0, ci).trim().toLowerCase();
          const v = parts[i].slice(ci + 1).trim();
          if (k === 'engine') engine = v;
          else if (k === 'voice') voiceId = v;
          else if (k === 'emotion') emotion = v;
          else if (k === 'rate') rate = v;
          else if (k === 'pitch') pitch = v;
        }
      }
      voiceGroups.push({ id, engine, voiceId, emotion, rate, pitch });
    }

    let title = 'Untitled Story';
    const paragraphs: StoryParagraph[] = [];
    const lines = text.split('\n');
    let curGroup = voiceGroups[0]?.id || 'narrator';
    let curEmotion: string | undefined;
    let curPace: string | undefined;
    let narrationLines: string[] = [];

    const flushParagraph = () => {
      const narr = narrationLines.join(' ').trim();
      if (narr) {
        paragraphs.push({ group: curGroup, emotion: curEmotion, pace: curPace, text: narr });
        curPace = undefined;
      }
      narrationLines = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { flushParagraph(); continue; }
      const titleMatch = trimmed.match(/^#\s+(.+)$/);
      if (titleMatch) { title = titleMatch[1].trim(); continue; }
      if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) continue;
      if (/^\[VOICE_GROUP:/i.test(trimmed)) continue;
      if (/^\[CHARACTER:/i.test(trimmed)) continue;
      if (trimmed === '---') continue;
      const voiceMatch = trimmed.match(/^\[VOICE:\s*(.+?)\]\s*$/i);
      if (voiceMatch) {
        flushParagraph();
        const vParts = voiceMatch[1].split('|').map(s => s.trim());
        for (const p of vParts) {
          const ci = p.indexOf(':');
          if (ci > 0) {
            const k = p.slice(0, ci).trim().toLowerCase();
            const v = p.slice(ci + 1).trim();
            if (k === 'group') curGroup = v;
            else if (k === 'emotion') curEmotion = v;
          }
        }
        continue;
      }
      const paceMatch = trimmed.match(/^\[PACE:\s*(slow|fast)\]\s*$/i);
      if (paceMatch) { curPace = paceMatch[1].toLowerCase(); continue; }
      if (/^\[.+?:.*\]\s*$/.test(trimmed)) continue;
      narrationLines.push(trimmed);
    }
    flushParagraph();
    return { title, voiceGroups, paragraphs };
  }

  async function generateStoryAudio(
    text: string,
    send: (obj: Record<string, unknown>) => void,
  ): Promise<{ filename: string; duration: number; url: string; audioPath: string; paraDurations: number[] }> {
    const { voiceGroups, paragraphs } = parseStory(text);
    send({ progress: true, step: 'parse', detail: `Found ${voiceGroups.length} voice groups, ${paragraphs.length} paragraphs` });

    if (paragraphs.length === 0) throw new Error('No narration paragraphs found in story');

    const cacheDir = path.join(process.env.CACHE_DIR ?? './cache', 'tts');
    fs.mkdirSync(cacheDir, { recursive: true });
    const audioParts: string[] = [];
    const paraDurations: number[] = new Array(paragraphs.length).fill(0);

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const vg = voiceGroups.find(g => g.id === para.group);
      const engine = (vg?.engine || 'edge-tts') as TtsEngine;
      const voice = vg?.voiceId || 'en-US-GuyNeural';
      const emotion = para.emotion || vg?.emotion;
      const rateVal = para.pace === 'slow' ? '-15%' : para.pace === 'fast' ? '+15%' : (vg?.rate || '+0%');

      send({ progress: true, step: 'tts', detail: `[${i + 1}/${paragraphs.length}] ${para.group} (${emotion || 'default'})` });

      try {
        const result = await narrationService.generateNarration(para.text, { voice, engine, rate: rateVal, pitch: vg?.pitch, style: emotion });
        audioParts.push(result.totalPath);
        paraDurations[i] = result.duration;
        send({ progress: true, step: 'tts-done', detail: `[${i + 1}/${paragraphs.length}]`, paraDuration: result.duration });
      } catch (err) {
        send({ progress: true, step: 'tts', detail: `[${i + 1}/${paragraphs.length}] FAILED: ${(err as Error).message}` });
      }
    }

    if (audioParts.length === 0) throw new Error('All TTS generations failed');

    send({ progress: true, step: 'concat', detail: `Combining ${audioParts.length} audio clips...` });

    const { resolveFfmpegPathSync } = await import('../services/import.service');
    const ffmpeg = resolveFfmpegPathSync('ffmpeg');
    const outputDir = path.join(process.env.OUTPUT_DIR ?? './output', 'tts');
    fs.mkdirSync(outputDir, { recursive: true });
    const timestamp = Date.now();
    const outputFile = path.join(outputDir, `story_${timestamp}.mp3`);

    if (audioParts.length === 1) {
      fs.copyFileSync(audioParts[0], outputFile);
    } else {
      const listFile = path.join(cacheDir, `concat_${timestamp}.txt`);
      const listContent = audioParts.map(p => `file '${p.replace(/\\/g, '\\\\').replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(listFile, listContent);
      await execFileAsync(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', outputFile], { timeout: 300_000 });
      try { fs.unlinkSync(listFile); } catch { /* ignore */ }
    }

    const ffprobe = resolveFfmpegPathSync('ffprobe');
    let duration = 0;
    try {
      const { stdout } = await execFileAsync(ffprobe, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', outputFile]);
      duration = parseFloat(stdout.trim()) || 0;
    } catch { /* ignore */ }

    const filename = path.basename(outputFile);
    return { filename, duration, url: `/api/tts/audio/${filename}`, audioPath: outputFile, paraDurations };
  }

  // ═══ Story Projects CRUD ═══

  // List all stories
  router.get('/stories', (_req: Request, res: Response) => {
    const rows = dbAll<TtsStoryRow>('SELECT * FROM tts_stories ORDER BY updated_at DESC');
    res.json(rows);
  });

  // Get single story
  router.get('/stories/:id', (req: Request, res: Response) => {
    const row = dbGet<TtsStoryRow>('SELECT * FROM tts_stories WHERE id = ?', [req.params.id]);
    if (!row) { res.status(404).json({ error: 'Story not found' }); return; }
    res.json(row);
  });

  // Create story
  router.post('/stories', (req: Request, res: Response) => {
    const { content, title } = req.body as { content?: string; title?: string };

    const id = crypto.randomUUID();
    const storyContent = content ?? '';
    const parsed = parseStory(storyContent);
    const storyTitle = title?.trim() || parsed.title;

    dbRun(
      `INSERT INTO tts_stories (id, title, content, voice_groups, paragraph_count, status)
       VALUES (?, ?, ?, ?, ?, 'draft')`,
      [id, storyTitle, storyContent, JSON.stringify(parsed.voiceGroups), parsed.paragraphs.length],
    );

    const row = dbGet<TtsStoryRow>('SELECT * FROM tts_stories WHERE id = ?', [id]);
    res.status(201).json(row);
  });

  // Update story content
  router.put('/stories/:id', (req: Request, res: Response) => {
    const { content, title } = req.body as { content?: string; title?: string };
    const row = dbGet<TtsStoryRow>('SELECT * FROM tts_stories WHERE id = ?', [req.params.id]);
    if (!row) { res.status(404).json({ error: 'Story not found' }); return; }

    const newContent = content ?? row.content;
    const parsed = parseStory(newContent);
    const newTitle = title?.trim() || (content ? parsed.title : row.title);

    dbRun(
      `UPDATE tts_stories SET title = ?, content = ?, voice_groups = ?, paragraph_count = ?,
       status = CASE WHEN content != ? THEN 'draft' ELSE status END,
       updated_at = datetime('now') WHERE id = ?`,
      [newTitle, newContent, JSON.stringify(parsed.voiceGroups), parsed.paragraphs.length, newContent, req.params.id],
    );

    const updated = dbGet<TtsStoryRow>('SELECT * FROM tts_stories WHERE id = ?', [req.params.id]);
    res.json(updated);
  });

  // Delete story
  router.delete('/stories/:id', (req: Request, res: Response) => {
    const row = dbGet<TtsStoryRow>('SELECT * FROM tts_stories WHERE id = ?', [req.params.id]);
    if (!row) { res.status(404).json({ error: 'Story not found' }); return; }
    if (row.audio_path && fs.existsSync(row.audio_path)) {
      try { fs.unlinkSync(row.audio_path); } catch { /* ignore */ }
    }
    dbRun('DELETE FROM tts_stories WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  // Generate audio for a story project (NDJSON stream)
  router.post('/stories/:id/generate', async (req: Request, res: Response) => {
    const row = dbGet<TtsStoryRow>('SELECT * FROM tts_stories WHERE id = ?', [req.params.id]);
    if (!row) { res.status(404).json({ error: 'Story not found' }); return; }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');
    const send = (obj: Record<string, unknown>) => res.write(JSON.stringify(obj) + '\n');

    dbRun(`UPDATE tts_stories SET status = 'generating', updated_at = datetime('now') WHERE id = ?`, [req.params.id]);

    try {
      const result = await generateStoryAudio(row.content, send);

      // Delete old audio if exists
      if (row.audio_path && fs.existsSync(row.audio_path)) {
        try { fs.unlinkSync(row.audio_path); } catch { /* ignore */ }
      }

      dbRun(
        `UPDATE tts_stories SET status = 'ready', audio_path = ?, duration = ?, para_durations = ?, updated_at = datetime('now') WHERE id = ?`,
        [result.audioPath, result.duration, JSON.stringify(result.paraDurations), req.params.id],
      );

      // Record in audio history
      dbRun(
        `INSERT OR REPLACE INTO tts_audio_history (filename, story_id, label) VALUES (?, ?, ?)`,
        [result.filename, req.params.id, row.title || 'Story'],
      );

      send({ filename: result.filename, duration: result.duration, url: result.url });
      res.end();
    } catch (err) {
      dbRun(`UPDATE tts_stories SET status = 'failed', updated_at = datetime('now') WHERE id = ?`, [req.params.id]);
      send({ error: (err as Error).message });
      res.end();
    }
  });

  // Quick generate (no project — backwards compat)
  router.post('/generate-story', async (req: Request, res: Response) => {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return; }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');
    const send = (obj: Record<string, unknown>) => res.write(JSON.stringify(obj) + '\n');

    try {
      const result = await generateStoryAudio(text, send);
      // Record in audio history (no project)
      const label = text.slice(0, 60).replace(/\n/g, ' ').trim();
      dbRun(
        `INSERT OR REPLACE INTO tts_audio_history (filename, story_id, label) VALUES (?, NULL, ?)`,
        [result.filename, label],
      );
      send({ filename: result.filename, duration: result.duration, url: result.url });
      res.end();
    } catch (err) {
      send({ error: (err as Error).message });
      res.end();
    }
  });

  // Preview — generate short sample and stream back as blob
  router.post('/preview', async (req: Request, res: Response) => {
    const { voice, rate, pitch, volume, style, text, engine } = req.body as {
      voice?: string;
      rate?: string;
      pitch?: string;
      volume?: string;
      style?: string;
      text?: string;
      engine?: TtsEngine;
    };

    const v = voice || (engine === 'kokoro' ? 'af_heart' : 'en-US-GuyNeural');
    // Resolve language from edge-tts or Kokoro voice maps
    const edgeVoiceInfo = VOICES[v];
    const kokoroVoiceInfo: KokoroVoiceEntry | undefined = engine === 'kokoro'
      ? kokoroListVoices().find((kv) => kv.voice_id === v)
      : undefined;
    const lang = edgeVoiceInfo?.lang ?? kokoroVoiceInfo?.lang;

    const SAMPLE_TEXT: Record<string, string> = {
      vi: 'Xin chào, đây là giọng thuyết minh mẫu cho bạn nghe thử.',
      es: 'Hola, esta es una muestra de voz de narración.',
      fr: 'Bonjour, ceci est un aperçu de la voix de narration.',
      'fr-fr': 'Bonjour, ceci est un aperçu de la voix de narration.',
      de: 'Hallo, dies ist eine Vorschau der Erzählerstimme.',
      ja: 'こんにちは、これはナレーション音声のプレビューです。',
      ko: '안녕하세요, 이것은 내레이션 음성 미리보기입니다.',
      zh: '你好，这是旁白配音的预览。',
      cmn: '你好，这是旁白配音的预览。',
      hi: 'नमस्ते, यह नैरेशन वॉयस प्रीव्यू है।',
      it: 'Ciao, questa è un\'anteprima della voce di narrazione.',
      'pt-br': 'Olá, esta é uma prévia da voz de narração.',
    };
    const sampleText = text ?? SAMPLE_TEXT[lang ?? ''] ?? 'Hello, this is a sample narration voice preview. Let me show you how this voice sounds with different expressions and tones.';

    try {
      const result = await narrationService.generateNarration(sampleText, {
        voice: v,
        rate,
        pitch,
        volume,
        style,
        engine,
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
    const storyDir = path.join(process.env.OUTPUT_DIR ?? './output', 'tts');
    const filename = path.basename(req.params.filename as string);

    let filePath = path.join(cacheDir, filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(audioDir, filename);
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(storyDir, filename);
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
    const storyDir = path.join(process.env.OUTPUT_DIR ?? './output', 'tts');
    const filename = path.basename(req.params.filename as string);

    let filePath = path.join(cacheDir, filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(audioDir, filename);
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(storyDir, filename);
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    fs.unlinkSync(filePath);
    dbRun('DELETE FROM tts_audio_history WHERE filename = ?', [filename]);
    res.json({ ok: true });
  });

  // List previously generated TTS files
  // ?storyId=xxx — filter to a specific project
  // ?storyId=none — only files without a project
  // no param — all files
  router.get('/history', async (req: Request, res: Response) => {
    const storyIdFilter = req.query.storyId as string | undefined;

    // Build lookup of filename -> { story_id, label } from DB
    const historyRows = dbAll<{ filename: string; story_id: string | null; label: string | null }>(
      'SELECT filename, story_id, label FROM tts_audio_history'
    );
    const historyMap = new Map(historyRows.map(r => [r.filename, r]));

    const cacheDir = path.join(process.env.CACHE_DIR ?? './cache', 'narration');
    // Also check output/tts for story files
    const outputDir = path.join(process.env.OUTPUT_DIR ?? './output', 'tts');

    const allFiles: Array<{ filename: string; filePath: string; sizeKB: number; createdAt: string }> = [];

    for (const dir of [cacheDir, outputDir]) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.mp3') || f.startsWith('seg_')) continue;
        if (allFiles.some(e => e.filename === f)) continue; // dedup
        const filePath = path.join(dir, f);
        const stat = fs.statSync(filePath);
        allFiles.push({ filename: f, filePath, sizeKB: Math.round(stat.size / 1024), createdAt: stat.mtime.toISOString() });
      }
    }

    // Filter by storyId
    let filtered = allFiles;
    if (storyIdFilter === 'none') {
      // Only files not belonging to any project
      filtered = allFiles.filter(e => {
        const h = historyMap.get(e.filename);
        return !h || !h.story_id;
      });
    } else if (storyIdFilter) {
      // Only files belonging to this project
      filtered = allFiles.filter(e => {
        const h = historyMap.get(e.filename);
        return h && h.story_id === storyIdFilter;
      });
    }

    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    filtered = filtered.slice(0, 50);

    const files = await Promise.all(filtered.map(async (e) => {
      const duration = await narrationService.getAudioDuration(e.filePath);
      const h = historyMap.get(e.filename);
      return {
        filename: e.filename,
        url: `/api/tts/audio/${e.filename}`,
        sizeKB: e.sizeKB,
        duration: Math.round(duration * 10) / 10,
        createdAt: e.createdAt,
        storyId: h?.story_id || null,
        label: h?.label || null,
      };
    }));

    res.json({ files });
  });

  // ═══ OmniVoice Integration ═══

  // OmniVoice health check
  router.get('/omnivoice/health', async (_req: Request, res: Response) => {
    try {
      const reachable = await omnivoiceReachable();
      res.json({ reachable, baseUrl: omnivoiceBaseUrl() });
    } catch {
      res.json({ reachable: false, baseUrl: omnivoiceBaseUrl() });
    }
  });

  // OmniVoice available voices
  router.get('/omnivoice/voices', async (_req: Request, res: Response) => {
    try {
      const voices = await omnivoiceListVoices();
      res.json({ voices });
    } catch {
      res.json({ voices: [] });
    }
  });

  // ═══ Kokoro TTS Integration ═══

  // Kokoro health check
  router.get('/kokoro/health', async (_req: Request, res: Response) => {
    try {
      const available = await kokoroIsAvailable();
      res.json({ available });
    } catch {
      res.json({ available: false });
    }
  });

  // Kokoro available voices (raw format)
  router.get('/kokoro/voices', (_req: Request, res: Response) => {
    const voices = kokoroListVoices();
    res.json({ voices });
  });

  // Kokoro voices in same format as edge-tts (for voice selector UI)
  router.get('/kokoro/voices/formatted', (_req: Request, res: Response) => {
    res.json(kokoroListVoicesFormatted());
  });

  // Default engine
  router.get('/engine', (_req: Request, res: Response) => {
    res.json({ engine: narrationService.getDefaultEngine() });
  });

  // ═══ Google Cloud TTS Integration ═══

  // Google TTS health check
  router.get('/google-tts/health', async (_req: Request, res: Response) => {
    try {
      const available = await googleTtsAvailable();
      if (!available) {
        res.json({ available: false, healthy: false });
        return;
      }
      const healthy = await googleTtsHealthy();
      res.json({ available: true, healthy });
    } catch {
      res.json({ available: false, healthy: false });
    }
  });

  // Google TTS voice list
  router.get('/google-tts/voices', async (req: Request, res: Response) => {
    try {
      const lang = req.query.lang as string | undefined;
      const voices = await googleTtsListVoices(lang);
      res.json({ voices });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Google TTS config — get (masked)
  router.get('/google-tts/config', (_req: Request, res: Response) => {
    const settings = getSettings();
    const credJson = settings.get('google_tts_credentials_json');
    res.json({
      projectId: settings.get('google_tts_project_id'),
      hasCredentials: !!credJson,
      credentialsPreview: credJson ? `${credJson.slice(0, 30)}...` : '',
      credentialsPath: settings.get('google_tts_credentials_path'),
      defaultVoice: settings.get('google_tts_default_voice') || 'en-US-Neural2-D',
      speakingRate: settings.get('google_tts_speaking_rate') || '1.0',
      pitch: settings.get('google_tts_pitch') || '0',
    });
  });

  // Google TTS config — save
  router.post('/google-tts/config', (req: Request, res: Response) => {
    const { projectId, credentialsJson, credentialsPath, defaultVoice, speakingRate, pitch } = req.body as {
      projectId?: string;
      credentialsJson?: string;
      credentialsPath?: string;
      defaultVoice?: string;
      speakingRate?: string;
      pitch?: string;
    };

    const settings = getSettings();
    if (projectId !== undefined) settings.set('google_tts_project_id', projectId);
    if (credentialsJson !== undefined) settings.set('google_tts_credentials_json', credentialsJson);
    if (credentialsPath !== undefined) settings.set('google_tts_credentials_path', credentialsPath);
    if (defaultVoice !== undefined) settings.set('google_tts_default_voice', defaultVoice);
    if (speakingRate !== undefined) settings.set('google_tts_speaking_rate', speakingRate);
    if (pitch !== undefined) settings.set('google_tts_pitch', pitch);

    // Invalidate cached access token so new credentials take effect
    googleTtsInvalidateToken();

    res.json({ ok: true });
  });

  // Google TTS — reload config (invalidate token cache)
  router.post('/google-tts/reload', (_req: Request, res: Response) => {
    googleTtsInvalidateToken();
    res.json({ ok: true });
  });

  // Google TTS usage stats
  router.get('/google-tts/usage', (_req: Request, res: Response) => {
    res.json({ usage: googleTtsUsageStats() });
  });

  // Google TTS reset usage
  router.post('/google-tts/usage/reset', (_req: Request, res: Response) => {
    googleTtsResetUsage();
    res.json({ ok: true });
  });

  // Google TTS available emotion presets for SSML prosody
  router.get('/google-tts/emotions', (_req: Request, res: Response) => {
    const emotions = Object.entries(EMOTION_PRESETS).map(([name, preset]) => ({
      name,
      rateDelta: preset.rateDelta,
      pitchDelta: preset.pitchDelta,
      volumeDb: preset.volumeDb,
      description: preset.emphasis ? `${preset.emphasis} emphasis` : undefined,
    }));
    res.json({ emotions });
  });

  // Google TTS quota pre-check — call before synthesis to verify free tier won't be exceeded
  router.post('/google-tts/check-quota', (req: Request, res: Response) => {
    const { voice, charCount } = req.body as { voice?: string; charCount?: number };
    if (!voice || !charCount) {
      res.status(400).json({ error: 'voice and charCount are required' });
      return;
    }
    const result = googleTtsCheckQuota(voice, charCount);
    res.json({ ...result, voiceType: googleTtsGetVoiceType(voice) });
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
