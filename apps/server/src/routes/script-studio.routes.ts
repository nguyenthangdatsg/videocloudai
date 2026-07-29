import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import {
  ensureScriptStudioTables,
  createDoc,
  updateDoc,
  getDoc,
  listDocs,
  deleteDoc,
  getCleanNarration,
  setDocStatus,
  getLogs,
  listBlocks,
  getBlock,
  updateBlockVisual,
  updateBlockAi,
  updateBlockClip,
  updateBlockClips,
  updateBlockAudio,
  type BlockClip,
  buildFlowPrompt,
  syncBlocksFromParsed,
  DocStatus,
  type ParsedScript,
  resolveBlockVoice,
  type VoiceGroup,
} from '../services/script-studio.service';
import { getJobQueue } from '../queue/queue';
import type { ProduceOptions } from '../services/video-producer.service';
import { searchPexelsCandidates, runBlockTts, runOmnivoiceTts, normalizeTtsText } from '../services/video-producer.service';
import { getSettings } from '../services/settings.service';
import { generateVideoClip } from '../services/image-providers';
import { resolveImageCacheDir, downloadPexelsVideoById } from '../services/pexels.service';
import { dbGet } from '../db';
import { isReachable as omnivoiceReachable, getBaseUrl as omnivoiceBaseUrl, listVoices as omnivoiceListVoices } from '../providers/omnivoice.provider';

function setupNDJSON(res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');
}

function ndLine(res: Response, data: Record<string, unknown>) {
  res.write(JSON.stringify(data) + '\n');
}

export function createScriptStudioRouter(): Router {
  ensureScriptStudioTables();
  const router = Router();

  // ── Docs CRUD ──

  router.get('/docs', (_req: Request, res: Response) => {
    const docs = listDocs();
    const enriched = docs.map((doc) => {
      let linkedStoryboardName: string | null = null;
      if (doc.linkedStoryboardId) {
        const sb = dbGet<{ name: string }>(`SELECT name FROM storyboards WHERE id = ?`, [doc.linkedStoryboardId]);
        if (sb) linkedStoryboardName = sb.name;
      }
      return { ...doc, linkedStoryboardName };
    });
    res.json({ docs: enriched });
  });

  router.get('/docs/:id', (req: Request, res: Response) => {
    const doc = getDoc(req.params.id as string);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }
    res.json({ doc });
  });

  router.post('/docs', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { raw_markdown?: string; title?: string };
    const raw_markdown = body.raw_markdown;
    const title = body.title;
    if (!raw_markdown) { res.status(400).json({ error: 'raw_markdown is required' }); return; }

    setupNDJSON(res);
    try {
      const result = createDoc(raw_markdown, title, undefined, (level, message) => {
        ndLine(res, { type: 'log', level, message, ts: new Date().toISOString() });
      });
      ndLine(res, { type: 'result', doc: { id: result.id, title: result.title, parsed: result.parsed } });
    } catch (err) {
      ndLine(res, { type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    res.end();
  });

  router.put('/docs/:id', (req: Request, res: Response) => {
    const existing = getDoc(req.params.id as string);
    if (!existing) { res.status(404).json({ error: 'Script doc not found' }); return; }
    const body2 = (req.body ?? {}) as { raw_markdown?: string; title?: string };
    const raw_markdown = body2.raw_markdown;
    const title = body2.title;
    if (!raw_markdown) { res.status(400).json({ error: 'raw_markdown is required' }); return; }

    setupNDJSON(res);
    try {
      const result = updateDoc(req.params.id as string, raw_markdown, title, (level, message) => {
        ndLine(res, { type: 'log', level, message, ts: new Date().toISOString() });
      });
      ndLine(res, { type: 'result', doc: { id: result.id, title: result.title, parsed: result.parsed } });
    } catch (err) {
      ndLine(res, { type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    res.end();
  });

  router.delete('/docs/:id', (req: Request, res: Response) => {
    deleteDoc(req.params.id as string);
    res.json({ ok: true });
  });

  router.patch('/docs/:id/status', (req: Request, res: Response) => {
    const { status } = req.body as { status?: DocStatus };
    if (!status) { res.status(400).json({ error: 'status is required' }); return; }
    const doc = getDoc(req.params.id as string);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }
    setDocStatus(req.params.id as string, status);
    res.json({ ok: true, status });
  });

  router.get('/docs/:id/narration', (req: Request, res: Response) => {
    const doc = getDoc(req.params.id as string);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }
    const narration = getCleanNarration(doc.parsed);
    res.json({ narration });
  });

  router.get('/docs/:id/logs', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 200;
    const logs = getLogs(req.params.id as string, limit);
    res.json({ logs });
  });

  // ── Blocks ──

  router.get('/docs/:id/blocks', (req: Request, res: Response) => {
    const docId = req.params.id as string;
    try {
      const doc = getDoc(docId);
      if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }
      let blocks = listBlocks(docId);
      // Lazy migration: sync blocks if none exist but doc has parsed content
      if (blocks.length === 0 && doc.parsed?.segments?.length) {
        syncBlocksFromParsed(docId, doc.parsed as ParsedScript);
        blocks = listBlocks(docId);
      }
      res.json({ blocks });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Re-parse raw markdown + re-sync blocks (picks up latest parser changes)
  router.post('/docs/:id/sync-blocks', (req: Request, res: Response) => {
    const docId = req.params.id as string;
    try {
      const doc = getDoc(docId);
      if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }
      if (!doc.rawMarkdown) { res.status(422).json({ error: 'No raw markdown to re-parse' }); return; }
      // Re-parse from source so blocks reflect current parser behavior
      updateDoc(docId, doc.rawMarkdown);
      const blocks = listBlocks(docId);
      res.json({ ok: true, blocks });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.patch('/docs/:id/blocks/:blockIndex', (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    // Only pass fields that were explicitly sent (avoid wiping columns with undefined)
    const fields: Parameters<typeof updateBlockVisual>[2] = {};
    if ('pexelsQuery' in body) fields.pexelsQuery = (body.pexelsQuery ?? null) as string | null;
    if ('motion' in body && body.motion != null) fields.motion = body.motion as string;
    if ('clipAssetPath' in body) fields.clipAssetPath = (body.clipAssetPath ?? null) as string | null;
    if ('visualType' in body && body.visualType != null) fields.visualType = body.visualType as string;
    if ('aiPrompt' in body) fields.aiPrompt = (body.aiPrompt ?? null) as string | null;

    updateBlockVisual(docId, blockIndex, fields);
    res.json({ ok: true });
  });

  // Auto-fetch top Pixabay clip for a block and store it locally
  router.post('/docs/:id/blocks/:blockIndex/fetch-pixabay', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const block = getBlock(docId, blockIndex);
    if (!block) { res.status(404).json({ error: 'Block not found' }); return; }

    const { orientation = 'landscape' } = (req.body ?? {}) as { orientation?: string };
    const orient = orientation === 'portrait' ? 'portrait' as const : 'landscape' as const;
    const query = block.pexelsQuery || block.narration.split(/\s+/).slice(0, 5).join(' ');

    try {
      const { searchAndDownloadPixabayVideo } = await import('../services/pixabay.service');
      const result = await searchAndDownloadPixabayVideo(query, { orientation: orient });
      if (!result) { res.status(422).json({ error: 'No Pixabay results for this query' }); return; }

      updateBlockClip(docId, blockIndex, result.filename, 'pexels');
      res.json({ ok: true, filename: result.filename, duration: result.duration });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Auto-fetch top Pexels clip for a block and store it locally
  router.post('/docs/:id/blocks/:blockIndex/fetch-pexels', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const block = getBlock(docId, blockIndex);
    if (!block) { res.status(404).json({ error: 'Block not found' }); return; }

    const { orientation = 'landscape' } = (req.body ?? {}) as { orientation?: string };
    const orient = orientation === 'portrait' ? 'portrait' as const : 'landscape' as const;
    const query = block.pexelsQuery || block.narration.split(/\s+/).slice(0, 5).join(' ');

    const { searchPexelsVideos } = await import('../services/pexels.service');
    const crypto = await import('crypto');
    const imageDir = resolveImageCacheDir();
    fs.mkdirSync(imageDir, { recursive: true });

    try {
      const videos = await searchPexelsVideos(query, { orientation: orient, perPage: 5 });
      if (!videos.length) {
        res.status(422).json({ error: 'No Pexels results for this query' });
        return;
      }

      // Pick best video
      const video = videos[0];
      const mp4Files = (video.video_files ?? []).filter((f: any) => f.file_type === 'video/mp4');
      if (!mp4Files.length) { res.status(500).json({ error: 'No mp4 files in result' }); return; }
      const sorted = [...mp4Files].sort((a: any, b: any) => {
        const q: Record<string, number> = { hd: 0, sd: 2 };
        return (q[a.quality] ?? 1) - (q[b.quality] ?? 1);
      });
      const best = sorted[0];
      const hash = crypto.createHash('sha256').update(best.link).digest('hex').slice(0, 16);
      const filename = `pexels_${hash}.mp4`;
      const destPath = path.join(imageDir, filename);

      if (!fs.existsSync(destPath)) {
        const response = await fetch(best.link);
        if (!response.ok) { res.status(500).json({ error: `Download failed: ${response.status}` }); return; }
        fs.writeFileSync(destPath, Buffer.from(await response.arrayBuffer()));
      }

      updateBlockClip(docId, blockIndex, filename, 'pexels');
      res.json({ ok: true, filename, pexelsId: video.id, duration: video.duration });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Apply a specific Pexels video (by ID) to a block
  router.post('/docs/:id/blocks/:blockIndex/apply-pexels-id', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const { pexelsId } = req.body as { pexelsId?: number };
    if (!pexelsId) { res.status(400).json({ error: 'pexelsId is required' }); return; }

    try {
      const result = await downloadPexelsVideoById(pexelsId);
      if (!result) { res.status(422).json({ error: 'Video not found or no downloadable files' }); return; }

      updateBlockClip(docId, blockIndex, result.filename, 'pexels');
      res.json({ ok: true, filename: result.filename, pexelsId, duration: result.duration });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Generate AI clip for a single block (NDJSON streaming)
  router.post('/docs/:id/blocks/:blockIndex/generate-ai', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const block = getBlock(docId, blockIndex);
    if (!block) { res.status(404).json({ error: 'Block not found' }); return; }

    const { aiPrompt: requestPrompt, orientation = 'landscape' } = req.body as { aiPrompt?: string; orientation?: string };
    const isPortrait = orientation === 'portrait';

    setupNDJSON(res);

    try {
      const prompt = (requestPrompt?.trim() && requestPrompt.trim() !== '__auto__')
        ? requestPrompt.trim()
        : (block.aiPrompt && block.aiPrompt !== '__auto__')
          ? block.aiPrompt
          : buildFlowPrompt(block, isPortrait);

      ndLine(res, { type: 'log', level: 'info', message: `Generating AI clip for block ${blockIndex + 1}...`, ts: new Date().toISOString() });
      ndLine(res, { type: 'log', level: 'info', message: `Prompt: ${prompt.slice(0, 140)}`, ts: new Date().toISOString() });

      const promptHash = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
      const aiFilename = `ai_${docId.slice(0, 8)}_${blockIndex}_${promptHash}.mp4`;
      const imageDir = resolveImageCacheDir();
      const aiDestPath = path.join(imageDir, aiFilename);

      if (fs.existsSync(aiDestPath)) {
        ndLine(res, { type: 'log', level: 'info', message: 'Using cached AI clip', ts: new Date().toISOString() });
      } else {
        const blockDurSec = Math.ceil((block.audioDurationMs ?? 6000) / 1000);
        const clipDur = Math.min(Math.max(blockDurSec, 5), 8);
        const ar = isPortrait ? '9:16' : '16:9';
        ndLine(res, { type: 'log', level: 'info', message: `Calling Veo (${clipDur}s, ${ar})...`, ts: new Date().toISOString() });
        await generateVideoClip(prompt, ar, aiDestPath, clipDur);
      }

      updateBlockAi(docId, blockIndex, prompt, aiFilename, { promptHash, generatedAt: new Date().toISOString() });
      updateBlockClip(docId, blockIndex, aiFilename, 'ai');

      ndLine(res, { type: 'log', level: 'success', message: `AI clip ready: ${aiFilename}`, ts: new Date().toISOString() });
      ndLine(res, { type: 'result', blockIndex, aiFilename, promptHash });
    } catch (err) {
      ndLine(res, { type: 'error', error: (err as Error).message, ts: new Date().toISOString() });
    }

    res.end();
  });

  // Stock video alternatives for picker — supports ?service=pexels|pixabay|mixkit
  router.get('/docs/:id/blocks/alternatives', async (req: Request, res: Response) => {
    const query = (req.query.query as string) ?? '';
    const orientation = ((req.query.orientation as string) ?? 'landscape') as 'landscape' | 'portrait';
    const perPage = Math.min(parseInt((req.query.perPage as string) ?? '12') || 12, 30);
    const service = (req.query.service as string) ?? 'pexels';
    if (!query) { res.status(400).json({ error: 'query is required' }); return; }

    try {
      if (service === 'pixabay') {
        const { searchPixabayCandidates } = await import('../services/pixabay.service');
        const candidates = await searchPixabayCandidates(query, orientation, perPage);
        res.json({ candidates, service: 'pixabay' });
      } else if (service === 'mixkit') {
        const { searchMixkitCandidates } = await import('../services/mixkit.service');
        const candidates = await searchMixkitCandidates(query, orientation, perPage);
        res.json({ candidates, service: 'mixkit' });
      } else {
        const candidates = await searchPexelsCandidates(query, orientation, perPage);
        res.json({ candidates, service: 'pexels' });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Apply a specific Pixabay video (by download URL) to a block
  router.post('/docs/:id/blocks/:blockIndex/apply-pixabay-url', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const { downloadUrl, duration, width, height } = req.body as {
      downloadUrl?: string; duration?: number; width?: number; height?: number;
    };
    if (!downloadUrl) { res.status(400).json({ error: 'downloadUrl is required' }); return; }

    try {
      const { downloadPixabayVideoFromUrl } = await import('../services/pixabay.service');
      const result = await downloadPixabayVideoFromUrl(downloadUrl, duration ?? 0, width ?? 0, height ?? 0);
      updateBlockClip(docId, blockIndex, result.filename, 'pexels');
      res.json({ ok: true, filename: result.filename, duration: result.duration });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Apply a specific Mixkit video (by download URL) to a block
  router.post('/docs/:id/blocks/:blockIndex/apply-mixkit-url', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const { downloadUrl, duration, width, height } = req.body as {
      downloadUrl?: string; duration?: number; width?: number; height?: number;
    };
    if (!downloadUrl) { res.status(400).json({ error: 'downloadUrl is required' }); return; }

    try {
      const { downloadMixkitVideo } = await import('../services/mixkit.service');
      const result = await downloadMixkitVideo(downloadUrl, duration ?? 0, width ?? 0, height ?? 0);
      updateBlockClip(docId, blockIndex, result.filename, 'pexels');
      res.json({ ok: true, filename: result.filename, duration: result.duration });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Regenerate stock video search query for a block using LLM
  router.post('/docs/:id/blocks/:blockIndex/regen-query', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const block = getBlock(docId, blockIndex);
    if (!block) { res.status(404).json({ error: 'Block not found' }); return; }

    const narration = block.narration?.trim();
    if (!narration) { res.status(400).json({ error: 'Block has no narration' }); return; }

    try {
      const { llmComplete } = await import('../services/llm.service');
      const query = await llmComplete({
        systemPrompt: 'You are a stock video search expert. Given a narration sentence, output a concise 2-4 word search query that finds the most visually relevant B-roll stock footage on Pexels/Pixabay. Focus on concrete visible subjects (people, places, objects, actions). Avoid abstract words. Output ONLY the search query, no punctuation, no explanation.',
        userMessage: narration,
        temperature: 0.4,
        maxTokens: 30,
      });
      const cleanQuery = query.replace(/["'.]/g, '').trim();
      // Persist the new query to the block
      updateBlockVisual(docId, blockIndex, { pexelsQuery: cleanQuery });
      res.json({ query: cleanQuery });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Per-block TTS: generate audio for a single block
  router.post('/docs/:id/blocks/:blockIndex/tts', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const block = getBlock(docId, blockIndex);
    if (!block) { res.status(404).json({ error: 'Block not found' }); return; }
    if (!block.narration?.trim()) { res.status(400).json({ error: 'Block has no narration' }); return; }

    const force = (req.body as any)?.force === true;
    const cacheDir = path.resolve(process.env.CACHE_DIR ?? './cache');
    const audioDir = path.resolve(cacheDir, 'block_audio');
    fs.mkdirSync(audioDir, { recursive: true });

    // Return cached audio unless force-regenerate is requested
    if (!force && block.audioPath && (block.audioDurationMs ?? 0) > 0 && fs.existsSync(path.join(audioDir, block.audioPath))) {
      res.json({ cached: true, audioDurationMs: block.audioDurationMs });
      return;
    }

    try {
      const s = getSettings();
      const voice = (req.body as any)?.voice ?? s.get('default_voice') ?? 'en-US-GuyNeural';
      const rate = (req.body as any)?.rate ?? s.get('default_tts_rate') ?? '0';
      const engineOverride = (req.body as any)?.engine as string | undefined; // 'omnivoice' | 'edge-tts'

      // Resolve per-block voice config (supports VOICE_GROUP references)
      const doc = getDoc(docId);
      const voiceGroups: VoiceGroup[] = doc?.parsed?.voiceGroups ?? [];
      const docVoiceConfig: string | null = doc?.parsed?.voiceConfig ?? null;
      const resolved = resolveBlockVoice(block.voiceConfig, docVoiceConfig, voiceGroups, { voice, rate });

      // Allow caller to override the engine
      const targetEngine = (engineOverride === 'omnivoice' || engineOverride === 'edge-tts') ? engineOverride : resolved.engine;

      const norm = normalizeTtsText(block.narration);
      const ttsText = norm.normalized;
      const cacheComponents = [ttsText, targetEngine, resolved.voiceId, resolved.emotion ?? '', resolved.rate ?? ''].join('|');
      const contentHash = createHash('sha256').update(cacheComponents).digest('hex').slice(0, 16);

      const audioFilename = `block_${docId.slice(0, 8)}_${blockIndex}_${targetEngine}_${contentHash}.mp3`;
      const audioPath = path.join(audioDir, audioFilename);
      const wordsPath = `${audioPath}.words.json`;

      let totalMs = 0;
      let wordCount = 0;
      let actualEngine = targetEngine;

      if (targetEngine === 'omnivoice') {
        const reachable = await omnivoiceReachable();
        if (reachable) {
          const result = await runOmnivoiceTts(ttsText, resolved, audioPath, wordsPath);
          totalMs = result.totalMs;
          wordCount = result.wordCount;
        } else {
          // Fall back to edge-tts with fallbackVoice
          actualEngine = 'edge-tts';
          const edgeVoice = resolved.fallbackVoice || voice;
          const edgeRate = resolved.rate ?? rate;
          const result = await runBlockTts(ttsText, edgeVoice, edgeRate, audioPath, wordsPath);
          totalMs = result.totalMs;
          wordCount = result.wordCount;
        }
      } else {
        // edge-tts
        const edgeVoice = resolved.voiceId || voice;
        const edgeRate = resolved.rate ?? rate;
        const result = await runBlockTts(ttsText, edgeVoice, edgeRate, audioPath, wordsPath);
        totalMs = result.totalMs;
        wordCount = result.wordCount;
      }

      const wordsJson = fs.existsSync(wordsPath) ? fs.readFileSync(wordsPath, 'utf-8') : '[]';

      updateBlockAudio(docId, blockIndex, {
        contentHash,
        audioPath: audioFilename,
        audioDurationMs: totalMs,
        wordsJson,
        audioEngine: actualEngine,
      });

      res.json({ cached: false, audioDurationMs: totalMs, wordCount, engine: actualEngine });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Set clip trim range (start/end seconds within the stock video)
  router.post('/docs/:id/blocks/:blockIndex/trim', (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const { startSec, endSec } = req.body as { startSec?: number | null; endSec?: number | null };

    updateBlockVisual(docId, blockIndex, {
      clipStartSec: startSec ?? null,
      clipEndSec: endSec ?? null,
    });
    res.json({ ok: true });
  });

  // Update block clips (multi-clip timeline)
  router.put('/docs/:id/blocks/:blockIndex/clips', (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const clips = (req.body as any)?.clips as BlockClip[] | undefined;
    if (!Array.isArray(clips)) { res.status(400).json({ error: 'clips must be an array' }); return; }

    updateBlockClips(docId, blockIndex, clips);
    res.json({ ok: true, clips });
  });

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

  // ── Produce ──

  router.post('/docs/:id/produce', (req: Request, res: Response) => {
    const doc = getDoc(req.params.id as string);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }

    const options = (req.body || {}) as ProduceOptions;
    setDocStatus(req.params.id as string, 'producing');

    const queue = getJobQueue();
    const job = queue.enqueue('script-studio-produce', {
      docId: req.params.id as string,
      options,
    });

    res.json({ jobId: job.id, status: 'queued' });
  });

  router.get('/docs/:id/produce/status', (req: Request, res: Response) => {
    const doc = getDoc(req.params.id as string);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }

    const row = dbGet<Record<string, unknown>>(
      `SELECT * FROM jobs WHERE type = 'script-studio-produce'
       AND json_extract(payload, '$.docId') = ?
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.id as string],
    );

    let job = null;
    if (row) {
      const queue = getJobQueue();
      job = queue.getJob(row.id as string) ?? null;
    }

    res.json({ job, docStatus: doc.status });
  });

  return router;
}
