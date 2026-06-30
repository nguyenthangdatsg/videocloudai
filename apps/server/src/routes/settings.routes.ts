import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { getSettings } from '../services/settings.service';
import { initProviders } from '../providers';
import { VOICES } from '../services/narration.service';

const execFileAsync = promisify(execFile);

async function testGroq(): Promise<boolean> {
  const apiKey = getSettings().get('groq_api_key');
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function testAnthropic(): Promise<boolean> {
  const apiKey = getSettings().get('anthropic_api_key');
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: getSettings().get('anthropic_model') || 'claude-sonnet-4-6',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function testGemini(): Promise<boolean> {
  const apiKey = getSettings().get('gemini_api_key');
  if (!apiKey) return false;
  try {
    const model = getSettings().get('gemini_model') || 'gemini-2.5-flash';
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function testOpenRouter(): Promise<boolean> {
  const apiKey = getSettings().get('openrouter_api_key');
  if (!apiKey) return false;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function testCerebras(): Promise<boolean> {
  const apiKey = getSettings().get('cerebras_api_key');
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.cerebras.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function testGrok(): Promise<boolean> {
  const apiKey = getSettings().get('grok_api_key');
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.x.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function testOpenai(): Promise<boolean> {
  const apiKey = getSettings().get('openai_api_key');
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function testJamendo(): Promise<boolean> {
  const clientId = getSettings().get('jamendo_client_id');
  if (!clientId) return false;
  try {
    const res = await fetch(
      `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(clientId)}&limit=1&format=json`
    );
    const data = await res.json() as { headers?: { code: number } };
    return data.headers?.code === 0;
  } catch {
    return false;
  }
}

async function testFfmpeg(): Promise<boolean> {
  const ffmpegPath = getSettings().get('ffmpeg_path') || 'ffmpeg';
  try {
    await execFileAsync(ffmpegPath, ['-version'], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function testEdgeTts(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('edge-tts', ['--list-voices'], { timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
    return stdout.length > 50;
  } catch {
    return false;
  }
}


export function createSettingsRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ settings: getSettings().getAllMasked() });
  });

  router.put('/', (req, res) => {
    getSettings().setAll(req.body as Record<string, string>);
    initProviders();
    res.json({ ok: true });
  });

  router.post('/test', async (_req, res) => {
    const [gemini, groq, anthropic, openrouter, cerebras, jamendo, ffmpeg, edgeTts] = await Promise.all([
      testGemini(), testGroq(), testAnthropic(), testOpenRouter(), testCerebras(), testJamendo(), testFfmpeg(), testEdgeTts(),
    ]);
    res.json({
      gemini,
      groq,
      anthropic,
      openrouter,
      cerebras,
      jamendo,
      ffmpeg,
      'edge-tts': edgeTts,
    });
  });

  router.post('/test/gemini', async (_req, res) => {
    res.json({ gemini: await testGemini() });
  });

  router.post('/test/openrouter', async (_req, res) => {
    res.json({ openrouter: await testOpenRouter() });
  });

  router.post('/test/cerebras', async (_req, res) => {
    res.json({ cerebras: await testCerebras() });
  });

  router.post('/test/groq', async (_req, res) => {
    res.json({ groq: await testGroq() });
  });

  router.post('/test/anthropic', async (_req, res) => {
    res.json({ anthropic: await testAnthropic() });
  });

  router.post('/test/grok', async (_req, res) => {
    res.json({ grok: await testGrok() });
  });

  router.post('/test/openai', async (_req, res) => {
    res.json({ openai: await testOpenai() });
  });

  router.post('/test/jamendo', async (_req, res) => {
    res.json({ jamendo: await testJamendo() });
  });

  router.post('/test/ffmpeg', async (_req, res) => {
    res.json({ ffmpeg: await testFfmpeg() });
  });

  router.post('/test/edge-tts', async (_req, res) => {
    res.json({ 'edge-tts': await testEdgeTts() });
  });

  router.get('/voices', (_req, res) => {
    res.json({ voices: VOICES });
  });

  // Voice preview — generate a short TTS sample and stream it back as MP3
  router.post('/voices/preview', async (req, res) => {
    const { voice, rate, text } = req.body as { voice?: string; rate?: string; text?: string };
    const v = voice && voice in VOICES ? voice : 'en-US-GuyNeural';
    const r = rate ?? '+0%';
    const sampleText = text ?? (VOICES[v as keyof typeof VOICES]?.lang === 'vi'
      ? 'Xin chào, đây là giọng thuyết minh mẫu.'
      : 'Hello, this is a sample narration voice preview.');

    const cacheDir = path.join(process.env.CACHE_DIR ?? './cache', 'previews');
    fs.mkdirSync(cacheDir, { recursive: true });
    const hash = crypto.createHash('md5').update(`${v}|${r}|${sampleText}`).digest('hex');
    const outPath = path.join(cacheDir, `${hash}.mp3`);

    if (!fs.existsSync(outPath)) {
      const args = ['--voice', v, '--rate', r, '--text', sampleText, '--write-media', outPath];
      try {
        await execFileAsync('edge-tts', args, { timeout: 15000 });
      } catch {
        try {
          await execFileAsync('python', ['-m', 'edge_tts', ...args], { timeout: 15000 });
        } catch (err) {
          res.status(500).json({ error: `edge-tts failed: ${err}` });
          return;
        }
      }
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(outPath).pipe(res);
  });

  return router;
}
