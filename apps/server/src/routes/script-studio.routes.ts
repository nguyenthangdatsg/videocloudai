import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import multer from 'multer';
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
  updateBlockClips,
  updateBlockAudio,
  splitBlock,
  type BlockClip,
  buildFlowPrompt,
  syncBlocksFromParsed,
  DocStatus,
  type ParsedScript,
  updateDocSubtitleStyle,
  updateDocProduceOptions,
  deleteDocProduceJob,
  resolveBlockVoice,
  type VoiceGroup,
} from '../services/script-studio.service';
import { getJobQueue } from '../queue/queue';
import type { ProduceOptions } from '../services/video-producer.service';
import { searchPexelsCandidates, runBlockTts, runOmnivoiceTts, normalizeTtsText, reproduceSingleBlock } from '../services/video-producer.service';
import { getSettings } from '../services/settings.service';
import { generateVideoClip } from '../services/image-providers';
import { resolveImageCacheDir, downloadPexelsVideoById } from '../services/pexels.service';
import { dbGet, dbRun } from '../db';
import { isReachable as omnivoiceReachable, getBaseUrl as omnivoiceBaseUrl, listVoices as omnivoiceListVoices } from '../providers/omnivoice.provider';

function setupNDJSON(res: Response) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');
}

function ndLine(res: Response, data: Record<string, unknown>) {
  res.write(JSON.stringify(data) + '\n');
}

/**
 * Composite a chart overlay on a background video clip.
 * Returns the composited filename (in chartDir) or null on failure.
 */
async function compositeChartOnBg(
  block: { chartSpec: any; audioDurationMs: number | null },
  bgClipPath: string,
  docId: string,
  orientation: 'landscape' | 'portrait',
  chartOpacity = 0.5,
  animationDurationSec?: number,
): Promise<string | null> {
  try {
    const { renderChart } = await import('../services/chart-renderer.service');
    const { promisify } = await import('util');
    const { execFile } = await import('child_process');
    const execFileAsync = promisify(execFile);
    const { resolveFfmpegPathSync } = await import('../services/import.service');
    const ffmpeg = resolveFfmpegPathSync('ffmpeg');

    const audioDurSec = (block.audioDurationMs ?? 6000) / 1000;
    const chartDur = Math.max(audioDurSec, 4);
    const animDur = animationDurationSec ?? audioDurSec / 2;
    const accentColor = '#7c6af5';
    const chartCacheDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'charts');
    fs.mkdirSync(chartCacheDir, { recursive: true });

    const darkResult = await renderChart(block.chartSpec, orientation, accentColor, '#0d0e12', chartDur, undefined, animDur);
    const darkChartPath = path.join(chartCacheDir, darkResult.filename);

    const isPortrait = orientation === 'portrait';
    const w = isPortrait ? 1080 : 1920;
    const h = isPortrait ? 1920 : 1080;
    const chartOp = chartOpacity.toFixed(2);
    const bgHash = createHash('sha256').update(path.basename(bgClipPath)).digest('hex').slice(0, 8);
    const ts = Date.now().toString(36);
    const compositeFilename = `chart_comp_o${chartOp}_bg${bgHash}_${ts}_${darkResult.filename}`;
    // Store composite in the doc folder, not cache
    const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
    const docDir = path.join(rendersDir, `doc_${docId}`);
    fs.mkdirSync(docDir, { recursive: true });
    const compositePath = path.join(docDir, compositeFilename);
    const bgScaleVf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}`;
    const chartMargin = Math.round(Math.min(w, h) * 0.06);
    const chartW = w - chartMargin * 2;
    const chartH = h - chartMargin * 2;

    await execFileAsync(ffmpeg, [
      '-stream_loop', '-1', '-i', bgClipPath,
      '-i', darkChartPath,
      '-filter_complex', [
        `[0:v]${bgScaleVf},eq=brightness=-0.15:saturation=0.4[bg]`,
        `[1:v]crop=${chartW}:${chartH}:(in_w-${chartW})/2:(in_h-${chartH})/2,format=rgba,colorchannelmixer=aa=${chartOp}[chart]`,
        `[bg][chart]overlay=${chartMargin}:${chartMargin}:shortest=1:format=auto[out]`,
      ].join(';'),
      '-map', '[out]',
      '-t', String(chartDur),
      '-r', '24',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-an', '-y', compositePath,
    ], { timeout: 300_000 });

    return compositeFilename;
  } catch (err) {
    console.error('[compositeChartOnBg] Failed:', (err as Error).message);
    return null;
  }
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

  router.put('/docs/:id/subtitle-style', (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const doc = getDoc(docId);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }

    const { subtitleStyle } = req.body;
    if (!subtitleStyle) { res.status(400).json({ error: 'subtitleStyle is required' }); return; }

    updateDocSubtitleStyle(docId, subtitleStyle);
    res.json({ ok: true });
  });

  router.put('/docs/:id/produce-options', (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const doc = getDoc(docId);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }
    updateDocProduceOptions(docId, req.body);
    res.json({ ok: true });
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
      
      // Self-heal: reset blocks whose rendered video files are missing on disk
      let changed = false;
      for (const block of blocks) {
        if (block.status === 'rendered' && block.renderedClipPath && !fs.existsSync(block.renderedClipPath)) {
          dbRun(
            `UPDATE script_blocks SET rendered_clip_path = NULL, status = 'clip_ready', updated_at = ? WHERE id = ?`,
            [new Date().toISOString(), block.id]
          );
          block.renderedClipPath = null;
          block.status = 'clip_ready';
          changed = true;
        }
      }
      if (changed) {
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

      if (block.chartSpec) {
        const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
        const imageDir = path.join(rendersDir, `doc_${docId}`);
        const bgPath = path.join(imageDir, result.filename);
        const composited = await compositeChartOnBg(block, bgPath, docId, orient);
        if (composited) {
          res.json({ ok: true, filename: composited, duration: result.duration });
          return;
        }
      }

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
    const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
    const imageDir = path.join(rendersDir, `doc_${docId}`);
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

      // Chart block: composite chart overlay on the new bg video
      if (block.chartSpec) {
        const composited = await compositeChartOnBg(block, destPath, docId, orient);
        if (composited) {
          res.json({ ok: true, filename: composited, pexelsId: video.id, duration: video.duration });
          return;
        }
      }

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
      const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
      const docDir = path.join(rendersDir, `doc_${docId}`);
      fs.mkdirSync(docDir, { recursive: true });

      const result = await downloadPexelsVideoById(pexelsId, docDir);
      if (!result) { res.status(422).json({ error: 'Video not found or no downloadable files' }); return; }

      const block = getBlock(docId, blockIndex);
      if (block?.chartSpec) {
        const bgPath = path.join(docDir, result.filename);
        const orient = 'landscape' as const; // TODO: pass from request
        const composited = await compositeChartOnBg(block, bgPath, docId, orient);
        if (composited) {
          res.json({ ok: true, filename: composited, pexelsId, duration: result.duration });
          return;
        }
      }

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
      const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
      const imageDir = path.join(rendersDir, `doc_${docId}`);
      fs.mkdirSync(imageDir, { recursive: true });
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

      ndLine(res, { type: 'log', level: 'success', message: `AI clip ready: ${aiFilename}`, ts: new Date().toISOString() });
      ndLine(res, { type: 'result', blockIndex, aiFilename, promptHash });
    } catch (err) {
      ndLine(res, { type: 'error', error: (err as Error).message, ts: new Date().toISOString() });
    }

    res.end();
  });

  // Stock video alternatives for picker — supports ?service=pexels|pixabay|mixkit|images
  router.get('/docs/:id/blocks/alternatives', async (req: Request, res: Response) => {
    const query = (req.query.query as string) ?? '';
    const orientation = ((req.query.orientation as string) ?? 'landscape') as 'landscape' | 'portrait';
    const perPage = Math.min(parseInt((req.query.perPage as string) ?? '12') || 12, 30);
    const service = (req.query.service as string) ?? 'pexels';
    if (!query) { res.status(400).json({ error: 'query is required' }); return; }

    try {
      if (service === 'images') {
        // Fetch stock images from both Pexels and Pixabay in parallel
        const { searchPexelsPhotos } = await import('../services/pexels.service');
        const { searchPixabayImages } = await import('../services/pixabay.service');
        const halfPage = Math.max(3, Math.ceil(perPage / 2));

        const [pexelsPhotos, pixabayImages] = await Promise.allSettled([
          searchPexelsPhotos(query, orientation, halfPage),
          searchPixabayImages(query, orientation, halfPage),
        ]);

        const candidates: Array<Record<string, unknown>> = [];
        if (pexelsPhotos.status === 'fulfilled') {
          for (const p of pexelsPhotos.value) {
            candidates.push({
              imageId: p.pexelsId,
              source: 'pexels',
              thumbnail: p.thumbnail,
              downloadUrl: p.downloadUrl,
              width: p.width,
              height: p.height,
              pageUrl: p.pexelsUrl,
              title: p.alt || p.photographer,
            });
          }
        }
        if (pixabayImages.status === 'fulfilled') {
          for (const p of pixabayImages.value) {
            candidates.push({
              imageId: p.pixabayId,
              source: 'pixabay',
              thumbnail: p.thumbnail,
              downloadUrl: p.downloadUrl,
              width: p.width,
              height: p.height,
              pageUrl: p.pageURL,
              title: p.tags,
            });
          }
        }

        // Interleave results from both sources
        const interleaved: typeof candidates = [];
        const pxl = candidates.filter(c => c.source === 'pexels');
        const pxb = candidates.filter(c => c.source === 'pixabay');
        const maxLen = Math.max(pxl.length, pxb.length);
        for (let i = 0; i < maxLen; i++) {
          if (i < pxl.length) interleaved.push(pxl[i]);
          if (i < pxb.length) interleaved.push(pxb[i]);
        }

        res.json({ candidates: interleaved.slice(0, perPage), service: 'images' });
      } else if (service === 'pixabay') {
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
      const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
      const docDir = path.join(rendersDir, `doc_${docId}`);
      fs.mkdirSync(docDir, { recursive: true });

      const { downloadPixabayVideoFromUrl } = await import('../services/pixabay.service');
      const result = await downloadPixabayVideoFromUrl(downloadUrl, duration ?? 0, width ?? 0, height ?? 0, docDir);

      const block = getBlock(docId, blockIndex);
      if (block?.chartSpec) {
        const bgPath = path.join(docDir, result.filename);
        const composited = await compositeChartOnBg(block, bgPath, docId, 'landscape');
        if (composited) {
          res.json({ ok: true, filename: composited, duration: result.duration });
          return;
        }
      }

      res.json({ ok: true, filename: result.filename, duration: result.duration });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Apply a stock image (Pexels photo or Pixabay image) to a block — downloads image, converts to video clip via FFmpeg
  router.post('/docs/:id/blocks/:blockIndex/apply-stock-image', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const { downloadUrl, source, width, height, zoomEffect } = req.body as {
      downloadUrl?: string; source?: string; width?: number; height?: number; zoomEffect?: 'zoom-in' | 'zoom-out';
    };
    if (!downloadUrl) { res.status(400).json({ error: 'downloadUrl is required' }); return; }

    try {
      const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
      const docDir = path.join(rendersDir, `doc_${docId}`);
      fs.mkdirSync(docDir, { recursive: true });

      // Download image
      let imgResult: { filename: string; url: string };
      if (source === 'pixabay') {
        const { downloadPixabayImage } = await import('../services/pixabay.service');
        imgResult = await downloadPixabayImage(downloadUrl, docDir);
      } else {
        const { downloadPexelsPhoto } = await import('../services/pexels.service');
        imgResult = await downloadPexelsPhoto(downloadUrl, docDir);
      }

      // Get block audio duration for clip length
      const block = getBlock(docId, blockIndex);
      const durationSec = block?.audioDurationMs ? Math.ceil(block.audioDurationMs / 1000) : 5;

      // Convert image to video with slow-zoom via FFmpeg
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const { resolveFfmpegPathSync } = await import('../services/import.service');
      const ffmpegPath = resolveFfmpegPathSync('ffmpeg');

      const imgPath = path.join(docDir, imgResult.filename);
      const effectSuffix = (zoomEffect ?? 'zoom-in') === 'zoom-out' ? '_zout' : '_zin';
      const videoFilename = imgResult.filename.replace(/\.(jpg|jpeg|png|webp)$/i, `${effectSuffix}_clip.mp4`);
      const videoPath = path.join(docDir, videoFilename);

      if (!fs.existsSync(videoPath)) {
        const fps = 30;
        const totalFrames = durationSec * fps;
        const step = (0.05 / totalFrames).toFixed(8);
        const zoomExpr = (zoomEffect ?? 'zoom-in') === 'zoom-out'
          ? `'if(eq(on\\,1)\\,1.05\\,max(zoom-${step}\\,1.0))'`
          : `'min(zoom+${step}\\,1.05)'`;
        await execFileAsync(ffmpegPath, [
          '-nostdin',
          '-loop', '1',
          '-i', imgPath,
          '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z=${zoomExpr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1920x1080:fps=${fps}`,
          '-c:v', 'libx264',
          '-preset', process.env.FFMPEG_PRESET || 'superfast',
          '-pix_fmt', 'yuv420p',
          '-t', String(durationSec),
          '-y', videoPath,
        ], { timeout: 60000 });
      }

      // Apply to block
      if (block?.chartSpec) {
        const composited = await compositeChartOnBg(block, videoPath, docId, 'landscape');
        if (composited) {
          res.json({ ok: true, filename: composited, duration: durationSec });
          return;
        }
      }

      res.json({ ok: true, filename: videoFilename, duration: durationSec });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Download a stock video to doc dir without applying to block (for split-screen etc.)
  router.post('/docs/:id/download-stock', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const { service, downloadUrl, pexelsId, duration, width, height } = req.body as {
      service: string; downloadUrl?: string; pexelsId?: number;
      duration?: number; width?: number; height?: number;
    };

    try {
      const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
      const docDir = path.join(rendersDir, `doc_${docId}`);
      fs.mkdirSync(docDir, { recursive: true });

      let filename: string;
      let dur = duration ?? 0;

      if (service === 'pexels' && pexelsId) {
        const result = await downloadPexelsVideoById(pexelsId, docDir);
        if (!result) { res.status(422).json({ error: 'Pexels video not found' }); return; }
        filename = result.filename;
        dur = result.duration;
      } else if (service === 'pixabay' && downloadUrl) {
        const { downloadPixabayVideoFromUrl } = await import('../services/pixabay.service');
        const result = await downloadPixabayVideoFromUrl(downloadUrl, dur, width ?? 0, height ?? 0, docDir);
        filename = result.filename;
      } else if (service === 'mixkit' && downloadUrl) {
        const { downloadMixkitVideo } = await import('../services/mixkit.service');
        const result = await downloadMixkitVideo(downloadUrl, dur, width ?? 0, height ?? 0, docDir);
        filename = result.filename;
        dur = result.duration;
      } else {
        res.status(400).json({ error: 'Invalid service or missing params' }); return;
      }

      res.json({ ok: true, filename, duration: dur });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Split screen: combine two clips side-by-side with optional middle text ──
  router.post('/docs/:id/blocks/:blockIndex/split-screen', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }

    const { leftClip, rightClip, middleText, middleStyle, accentColor, leftLabel, rightLabel, labelPosition, labelStyle } = req.body as {
      leftClip: string; rightClip: string;
      middleText?: string; middleStyle?: string;
      accentColor?: string; leftLabel?: string; rightLabel?: string;
      labelPosition?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
      labelStyle?: 'badge' | 'outline' | 'shadow' | 'banner';
    };
    if (!leftClip || !rightClip) { res.status(400).json({ error: 'leftClip and rightClip are required' }); return; }
    try {
      const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
      const docDir = path.join(rendersDir, `doc_${docId}`);
      fs.mkdirSync(docDir, { recursive: true });

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const { resolveFfmpegPathSync } = await import('../services/import.service');
      const ffmpeg = resolveFfmpegPathSync('ffmpeg');

      // Resolve clip paths
      const leftPath = path.isAbsolute(leftClip) ? leftClip : path.join(docDir, leftClip);
      const rightPath = path.isAbsolute(rightClip) ? rightClip : path.join(docDir, rightClip);
      if (!fs.existsSync(leftPath)) { res.status(400).json({ error: `Left clip not found: ${leftClip}` }); return; }
      if (!fs.existsSync(rightPath)) { res.status(400).json({ error: `Right clip not found: ${rightClip}` }); return; }

      // Get block audio duration for target length
      const block = getBlock(docId, blockIndex);
      const durationSec = block?.audioDurationMs ? Math.ceil(block.audioDurationMs / 1000) : 5;

      const outW = 1920;
      const outH = 1080;
      const mStyle = middleStyle || 'vs';
      const accentHex = (accentColor || '#7c6af5').replace('#', '');
      const accent = `0x${accentHex}`;

      // Gap width and divider color per style
      let gap: number;
      let dividerColor: string;
      switch (mStyle) {
        case 'fire':   gap = 14; dividerColor = '0xFF4500'; break;
        case 'neon':   gap = 10; dividerColor = accent; break;
        case 'slash':  gap = 28; dividerColor = '0x000000'; break;
        case 'clean':  gap = 3;  dividerColor = '0xCCCCCC'; break;
        case 'none':   gap = 2;  dividerColor = accent; break;
        case 'line':   gap = 3;  dividerColor = accent; break;
        case 'glow':   gap = 20; dividerColor = accent; break;
        case 'badge':  gap = 6;  dividerColor = accent; break;
        default:       gap = 6;  dividerColor = accent; break; // vs
      }
      const panelW = Math.floor((outW - gap) / 2);

      const filterParts: string[] = [];
      filterParts.push(`[0:v]scale=${panelW}:${outH}:force_original_aspect_ratio=increase,crop=${panelW}:${outH},setsar=1[left]`);
      filterParts.push(`[1:v]scale=${panelW}:${outH}:force_original_aspect_ratio=increase,crop=${panelW}:${outH},setsar=1[right]`);
      filterParts.push(`color=c=${dividerColor}:s=${outW}x${outH}:d=${durationSec},format=yuv420p[bg]`);
      filterParts.push(`[bg][left]overlay=0:0:shortest=1[tmp1]`);
      filterParts.push(`[tmp1][right]overlay=${panelW + gap}:0:shortest=1[tmp2]`);
      if (mStyle === 'glow') {
        // Smooth glow: generate RGBA glow strip, blur it, overlay onto composed video
        const cx = panelW + Math.floor(gap / 2);
        const glowW = 160;
        // Create glow source: transparent RGBA canvas with accent strip at center, gaussian-blurred
        filterParts.push(`color=c=black@0:s=${glowW}x${outH}:d=${durationSec},format=rgba,drawbox=x=${glowW / 2 - 3}:y=0:w=6:h=ih:color=${accent}@0.9:t=fill,gblur=sigma=14[glow]`);
        filterParts.push(`[tmp2][glow]overlay=x=${cx - glowW / 2}:y=0:shortest=1[base]`);
      } else {
        filterParts.push(`[tmp2]null[base]`);
      }

      // Draw text overlays
      const drawTextParts: string[] = [];

      // Label position coordinates
      const lPos = labelPosition || 'top-center';
      const labelY = lPos.startsWith('top') ? '30' : 'h-50';
      const hAlign = lPos.split('-')[1]; // left, center, right
      const leftLabelX = hAlign === 'center' ? `(${panelW}-tw)/2` : hAlign === 'right' ? `${panelW}-tw-20` : '20';
      const rightLabelX = hAlign === 'center' ? `${panelW + gap}+(${panelW}-tw)/2` : hAlign === 'right' ? 'w-tw-20' : `${panelW + gap}+20`;

      // Banner: draw semi-transparent bar behind labels
      const lStyle = labelStyle || 'badge';
      if (lStyle === 'banner' && (leftLabel || rightLabel)) {
        const barY = lPos.startsWith('top') ? '0' : `h-60`;
        drawTextParts.push(`drawbox=x=0:y=${barY}:w=iw:h=60:color=black@0.6:t=fill`);
      }
      const labelDrawOpts = (text: string, x: string) => {
        const escaped = text.replace(/'/g, "\\'");
        const base = `drawtext=text='${escaped}':fontsize=28:fontcolor=white:x=${x}:y=${labelY}`;
        switch (lStyle) {
          case 'badge':
            return `${base}:box=1:boxcolor=black@0.7:boxborderw=8:borderw=0`;
          case 'outline':
            return `${base}:borderw=3:bordercolor=black@0.9`;
          case 'shadow':
            return `${base}:borderw=0:shadowcolor=black@0.8:shadowx=2:shadowy=2`;
          case 'banner':
            return `${base}:borderw=1:bordercolor=black@0.4`;
          default:
            return `${base}:borderw=2:bordercolor=black@0.6`;
        }
      };

      // Left label
      if (leftLabel) {
        drawTextParts.push(labelDrawOpts(leftLabel, leftLabelX));
      }
      // Right label
      if (rightLabel) {
        drawTextParts.push(labelDrawOpts(rightLabel, rightLabelX));
      }
      // Middle text — some styles show text, others don't
      const showsMiddleText = !['line', 'none'].includes(mStyle);
      const mText = middleText || (showsMiddleText ? 'VS' : '');
      if (mText) {
        const escaped = mText.replace(/'/g, "\\'");
        const mFontSize = mText.length <= 3 ? 48 : mText.length <= 8 ? 36 : 28;
        const cx = '(w-tw)/2';
        const cy = '(h-th)/2';
        const dt = (opts: string) => `drawtext=text='${escaped}':fontsize=${opts}:x=${cx}:y=${cy}`;

        switch (mStyle) {
          case 'vs':
            // White text on accent box with accent border
            drawTextParts.push(dt(`${mFontSize}:fontcolor=white:borderw=3:bordercolor=${accent}:box=1:boxcolor=${accent}@0.85:boxborderw=12`));
            break;
          case 'badge':
            // White text on solid accent rounded box
            drawTextParts.push(dt(`${mFontSize}:fontcolor=white:borderw=0:box=1:boxcolor=${accent}:boxborderw=14`));
            break;
          case 'glow':
            // Simulated glow: large accent-colored blurred border behind, then crisp white text on top
            drawTextParts.push(dt(`${mFontSize + 12}:fontcolor=${accent}@0.4:borderw=12:bordercolor=${accent}@0.3:box=1:boxcolor=0x000000@0.0:boxborderw=0`));
            drawTextParts.push(dt(`${mFontSize + 8}:fontcolor=${accent}@0.7:borderw=6:bordercolor=${accent}@0.5:box=1:boxcolor=0x000000@0.0:boxborderw=0`));
            drawTextParts.push(dt(`${mFontSize + 4}:fontcolor=white:borderw=3:bordercolor=${accent}:box=1:boxcolor=0x000000@0.6:boxborderw=14`));
            break;
          case 'fire':
            // Gold text on red/orange box
            drawTextParts.push(dt(`${mFontSize + 4}:fontcolor=0xFFD700:borderw=3:bordercolor=0xFF0000:box=1:boxcolor=0xFF4500:boxborderw=14`));
            break;
          case 'neon':
            // Accent text with white border on dark box
            drawTextParts.push(dt(`${mFontSize}:fontcolor=${accent}:borderw=3:bordercolor=white:box=1:boxcolor=0x000000@0.6:boxborderw=10`));
            break;
          case 'slash':
            // White text on accent box, over black diagonal gap
            drawTextParts.push(dt(`${mFontSize - 4}:fontcolor=white:borderw=2:bordercolor=0x000000:box=1:boxcolor=${accent}:boxborderw=10`));
            break;
          case 'clean':
            // Small white text on subtle dark box
            drawTextParts.push(dt(`${Math.max(22, mFontSize - 8)}:fontcolor=white:borderw=1:bordercolor=0x444444:box=1:boxcolor=0x222222:boxborderw=6`));
            break;
        }
      }

      if (drawTextParts.length > 0) {
        filterParts.push(`[base]${drawTextParts.join(',')}[out]`);
      } else {
        filterParts.push(`[base]null[out]`);
      }

      const splitFilename = `split_${Date.now()}.mp4`;
      const splitPath = path.join(docDir, splitFilename);

      const filterStr = filterParts.join(';');
      console.log('[split-screen] style=%s labelStyle=%s filter=%s', mStyle, lStyle, filterStr);
      await execFileAsync(ffmpeg, [
        '-nostdin',
        '-stream_loop', '-1', '-i', leftPath,
        '-stream_loop', '-1', '-i', rightPath,
        '-filter_complex', filterStr,
        '-map', '[out]',
        '-c:v', 'libx264',
        '-preset', process.env.FFMPEG_PRESET || 'superfast',
        '-pix_fmt', 'yuv420p',
        '-t', String(durationSec),
        '-y', splitPath,
      ], { timeout: 120000 });

      // Mark block as 'split' visual type and sync clip_asset_path so the producer uses it as-is
      updateBlockVisual(docId, blockIndex, { visualType: 'split', clipAssetPath: splitFilename });

      res.json({ ok: true, filename: splitFilename, duration: durationSec });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Upload a pasted/dropped image and convert to video clip with zoom effect
  const pasteUpload = multer({ dest: path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard', '_uploads'), limits: { fileSize: 10 * 1024 * 1024 } });
  router.post('/docs/:id/blocks/:blockIndex/paste-image', pasteUpload.single('image'), async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex) || !req.file) { res.status(400).json({ error: 'Invalid blockIndex or no file' }); return; }

    const zoomEffect = (req.body?.zoomEffect as string) || 'zoom-in';

    try {
      const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
      const docDir = path.join(rendersDir, `doc_${docId}`);
      fs.mkdirSync(docDir, { recursive: true });

      // Move uploaded file to doc dir with proper extension
      const ext = path.extname(req.file.originalname || '.png') || '.png';
      const imgFilename = `paste_${Date.now()}${ext}`;
      const imgPath = path.join(docDir, imgFilename);
      fs.renameSync(req.file.path, imgPath);

      // Get block audio duration for clip length
      const block = getBlock(docId, blockIndex);
      const durationSec = block?.audioDurationMs ? Math.ceil(block.audioDurationMs / 1000) : 5;

      // Convert image to video with zoom effect via FFmpeg
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const { resolveFfmpegPathSync } = await import('../services/import.service');
      const ffmpegPath = resolveFfmpegPathSync('ffmpeg');

      const effectSuffix = zoomEffect === 'zoom-out' ? '_zout' : '_zin';
      const videoFilename = imgFilename.replace(/\.[^.]+$/, `${effectSuffix}_clip.mp4`);
      const videoPath = path.join(docDir, videoFilename);

      const fps = 30;
      const totalFrames = durationSec * fps;
      const step = (0.15 / totalFrames).toFixed(8);
      const zoomExpr = zoomEffect === 'zoom-out'
        ? `'if(eq(on\\,1)\\,1.15\\,max(zoom-${step}\\,1.0))'`
        : `'min(zoom+${step}\\,1.15)'`;
      await execFileAsync(ffmpegPath, [
        '-nostdin',
        '-loop', '1',
        '-i', imgPath,
        '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z=${zoomExpr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1920x1080:fps=${fps}`,
        '-c:v', 'libx264',
        '-preset', process.env.FFMPEG_PRESET || 'superfast',
        '-pix_fmt', 'yuv420p',
        '-t', String(durationSec),
        '-y', videoPath,
      ], { timeout: 60000 });

      if (block?.chartSpec) {
        const composited = await compositeChartOnBg(block, videoPath, docId, 'landscape');
        if (composited) {
          res.json({ ok: true, filename: composited, duration: durationSec });
          return;
        }
      }

      res.json({ ok: true, filename: videoFilename, duration: durationSec });
    } catch (err) {
      // Clean up uploaded file on error
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
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
      const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
      const docDir = path.join(rendersDir, `doc_${docId}`);
      fs.mkdirSync(docDir, { recursive: true });

      const { downloadMixkitVideo } = await import('../services/mixkit.service');
      const result = await downloadMixkitVideo(downloadUrl, duration ?? 0, width ?? 0, height ?? 0, docDir);

      const block = getBlock(docId, blockIndex);
      if (block?.chartSpec) {
        const bgPath = path.join(docDir, result.filename);
        const composited = await compositeChartOnBg(block, bgPath, docId, 'landscape');
        if (composited) {
          res.json({ ok: true, filename: composited, duration: result.duration });
          return;
        }
      }

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

  // Regenerate TTS for all blocks (batch)
  router.post('/docs/:id/tts-all', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const doc = getDoc(docId);
    if (!doc) { res.status(404).json({ error: 'Doc not found' }); return; }

    const engine = (req.body as any)?.engine as string | undefined;
    const force = true; // Always force re-gen when applying to all
    const blocks = listBlocks(docId);
    const narrationBlocks = blocks.filter(b => b.narration?.trim());

    setupNDJSON(res);
    ndLine(res, { type: 'start', total: narrationBlocks.length });

    const s = getSettings();
    const voice = s.get('default_voice') ?? 'en-US-GuyNeural';
    const rate = s.get('default_tts_rate') ?? '0';
    const voiceGroups: VoiceGroup[] = doc.parsed?.voiceGroups ?? [];
    const docVoiceConfig: string | null = doc.parsed?.voiceConfig ?? null;
    const cacheDir = path.resolve(process.env.CACHE_DIR ?? './cache');
    const audioDir = path.resolve(cacheDir, 'block_audio');
    fs.mkdirSync(audioDir, { recursive: true });

    let done = 0;
    let errors = 0;
    for (const block of narrationBlocks) {
      try {
        const resolved = resolveBlockVoice(block.voiceConfig, docVoiceConfig, voiceGroups, { voice, rate });
        const targetEngine = (engine === 'omnivoice' || engine === 'edge-tts') ? engine : resolved.engine;

        const norm = normalizeTtsText(block.narration);
        const ttsText = norm.normalized;
        const cacheComponents = [ttsText, targetEngine, resolved.voiceId, resolved.emotion ?? '', resolved.rate ?? ''].join('|');
        const contentHash = createHash('sha256').update(cacheComponents).digest('hex').slice(0, 16);
        const audioFilename = `block_${docId.slice(0, 8)}_${block.blockIndex}_${targetEngine}_${contentHash}.mp3`;
        const audioPath = path.join(audioDir, audioFilename);
        const wordsPath = `${audioPath}.words.json`;

        // Skip if already exists with same hash
        if (fs.existsSync(audioPath) && block.contentHash === contentHash) {
          done++;
          ndLine(res, { type: 'progress', done, total: narrationBlocks.length, blockIndex: block.blockIndex, cached: true });
          continue;
        }

        let totalMs = 0;
        let wordCount = 0;
        let actualEngine = targetEngine;

        if (targetEngine === 'omnivoice') {
          const reachable = await omnivoiceReachable();
          if (reachable) {
            const result = await runOmnivoiceTts(ttsText, resolved, audioPath, wordsPath);
            totalMs = result.totalMs; wordCount = result.wordCount;
          } else {
            actualEngine = 'edge-tts';
            const edgeVoice = resolved.fallbackVoice || voice;
            const edgeRate = resolved.rate ?? rate;
            const result = await runBlockTts(ttsText, edgeVoice, edgeRate, audioPath, wordsPath);
            totalMs = result.totalMs; wordCount = result.wordCount;
          }
        } else {
          const edgeVoice = resolved.voiceId || voice;
          const edgeRate = resolved.rate ?? rate;
          const result = await runBlockTts(ttsText, edgeVoice, edgeRate, audioPath, wordsPath);
          totalMs = result.totalMs; wordCount = result.wordCount;
        }

        const wordsJson = fs.existsSync(wordsPath) ? fs.readFileSync(wordsPath, 'utf-8') : '[]';
        updateBlockAudio(docId, block.blockIndex, {
          contentHash, audioPath: audioFilename, audioDurationMs: totalMs, wordsJson, audioEngine: actualEngine,
        });

        done++;
        ndLine(res, { type: 'progress', done, total: narrationBlocks.length, blockIndex: block.blockIndex, audioDurationMs: totalMs, engine: actualEngine });
      } catch (err) {
        errors++;
        done++;
        ndLine(res, { type: 'error', done, total: narrationBlocks.length, blockIndex: block.blockIndex, error: (err as Error).message });
      }
    }

    ndLine(res, { type: 'done', total: narrationBlocks.length, errors });
    res.end();
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

  // Split a block into two at sentence boundary (displays as 3a, 3b)
  router.post('/docs/:id/blocks/:blockIndex/split-block', (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string);
    if (isNaN(blockIndex)) { res.status(400).json({ error: 'Invalid blockIndex' }); return; }
    try {
      const result = splitBlock(docId, blockIndex);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
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

  // ── Reproduce single block (NDJSON streaming) ──
  router.post('/docs/:id/blocks/:blockIndex/reproduce', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string, 10);
    const doc = getDoc(docId);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }
    const orientation = (req.body?.orientation as 'landscape' | 'portrait') || 'landscape';
    const chartOpacity = Math.min(1, Math.max(0, parseFloat(req.body?.chartOpacity) || 0.5));
    const animationDurationSec = req.body?.animationDurationSec != null
      ? Math.max(0.5, parseFloat(req.body.animationDurationSec))
      : undefined;
    const accentColor = typeof req.body?.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.accentColor)
      ? req.body.accentColor
      : '#7c6af5';

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    const send = (obj: Record<string, unknown>) => { try { res.write(JSON.stringify(obj) + '\n'); } catch {} };

    try {
      const result = await reproduceSingleBlock(docId, blockIndex, orientation, chartOpacity, animationDurationSec, (msg) => {
        send({ type: 'log', message: msg });
      }, accentColor);
      send({ type: 'result', ...result });
    } catch (err) {
      send({ type: 'error', error: (err as Error).message });
    }
    res.end();
  });

  // ── Render a Remotion composition and add as clip ──
  router.post('/docs/:id/blocks/:blockIndex/render-remotion', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const blockIndex = parseInt(req.params.blockIndex as string, 10);
    const doc = getDoc(docId);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }

    const {
      compositionId,
      durationSec = 4,
      orientation = 'landscape',
      props: userProps = {},
    } = req.body as {
      compositionId: string;
      durationSec?: number;
      orientation?: string;
      props?: Record<string, unknown>;
    };

    if (!compositionId) { res.status(400).json({ error: 'compositionId is required' }); return; }

    const allowed = ['Intro', 'Outro', 'ChartBigNumber', 'ChartLine', 'ChartBars', 'ChartVs'];
    if (!allowed.includes(compositionId)) {
      res.status(400).json({ error: `Unsupported composition: ${compositionId}. Allowed: ${allowed.join(', ')}` });
      return;
    }

    const isPortrait = orientation === 'portrait';
    const w = isPortrait ? 1080 : 1920;
    const h = isPortrait ? 1920 : 1080;
    const durationInFrames = Math.max(Math.round(durationSec * 24), 24);

    const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
    const docDir = path.join(rendersDir, `doc_${docId}`);
    fs.mkdirSync(docDir, { recursive: true });

    const hash = createHash('sha256').update(JSON.stringify({ compositionId, userProps, durationSec, orientation, t: Date.now() })).digest('hex').slice(0, 12);
    const filename = `remotion_${compositionId.toLowerCase()}_${hash}.mp4`;
    const outputPath = path.join(docDir, filename);

    try {
      const { renderChart } = await import('../services/chart-renderer.service');

      if (compositionId.startsWith('Chart')) {
        // Chart compositions — use chart-renderer
        const chartType = compositionId === 'ChartBigNumber' ? 'big-number'
          : compositionId === 'ChartLine' ? 'line'
          : compositionId === 'ChartBars' ? 'bars'
          : 'vs';

        const chartSpec = {
          type: chartType as any,
          title: (userProps.title as string) ?? undefined,
          sourceLabel: (userProps.sourceLabel as string) ?? undefined,
          data: '',
          parsedData: userProps.parsedData as any ?? userProps,
        };

        const accentColor = (userProps.accentColor as string) ?? '#7c6af5';
        const bgColor = (userProps.bgColor as string) ?? '#0d0e12';
        const result = await renderChart(chartSpec, isPortrait ? 'portrait' : 'landscape', accentColor, bgColor, durationSec);

        // Copy to doc dir
        const cacheDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'charts');
        const srcPath = path.join(cacheDir, result.filename);
        if (srcPath !== outputPath) fs.copyFileSync(srcPath, outputPath);

        res.json({ ok: true, filename, durationSec: result.durationSec });
      } else {
        // Intro / Outro — use remotion-renderer
        const { renderIntroClip, renderOutroClip } = await import('../services/remotion-renderer.service');
        const finalProps = { ...userProps, durationInFrames };

        if (compositionId === 'Intro') {
          await renderIntroClip(outputPath, {
            creatorName: (userProps.creatorName as string) ?? 'Creator',
            tagline: (userProps.tagline as string) ?? undefined,
            accentColor: (userProps.accentColor as string) ?? '#7c6af5',
            style: (userProps.style as any) ?? 'minimal',
            durationInFrames,
          });
        } else {
          await renderOutroClip(outputPath, {
            creatorName: (userProps.creatorName as string) ?? 'Creator',
            socialHandle: (userProps.socialHandle as string) ?? undefined,
            ctaText: (userProps.ctaText as string) ?? 'Subscribe!',
            accentColor: (userProps.accentColor as string) ?? '#7c6af5',
            durationInFrames,
          });
        }

        res.json({ ok: true, filename, durationSec });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
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

  // Generate YouTube description + tags on demand
  router.post('/docs/:id/youtube-metadata', async (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const doc = getDoc(docId);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }

    try {
      const blocks = listBlocks(docId);
      const totalDurationSec = blocks.reduce((s, b) => s + (b.audioDurationMs ?? 0) / 1000, 0);
      const { generateYouTubeMetadata } = await import('../services/video-producer.service');
      const result = await generateYouTubeMetadata(doc.title, blocks, totalDurationSec);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/docs/:id/produce', (req: Request, res: Response) => {
    const docId = req.params.id as string;
    const doc = getDoc(docId);
    if (!doc) { res.status(404).json({ error: 'Script doc not found' }); return; }

    deleteDocProduceJob(docId);
    res.json({ ok: true });
  });

  // ── Watermark logo upload / status ──
  const wmDir = path.resolve('assets', 'watermark');
  fs.mkdirSync(wmDir, { recursive: true });
  const wmUpload = multer({ dest: wmDir, limits: { fileSize: 5 * 1024 * 1024 } });

  router.get('/watermark', (_req: Request, res: Response) => {
    const logoPath = path.join(wmDir, 'logo.png');
    if (fs.existsSync(logoPath)) {
      const stat = fs.statSync(logoPath);
      res.json({ exists: true, size: stat.size, url: '/api/script-studio/watermark/image' });
    } else {
      res.json({ exists: false });
    }
  });

  router.get('/watermark/image', (_req: Request, res: Response) => {
    const logoPath = path.join(wmDir, 'logo.png');
    if (!fs.existsSync(logoPath)) { res.status(404).json({ error: 'No watermark logo' }); return; }
    res.sendFile(logoPath);
  });

  router.post('/watermark', wmUpload.single('file'), (req: Request, res: Response) => {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const dest = path.join(wmDir, 'logo.png');
    fs.renameSync(req.file.path, dest);
    res.json({ ok: true, url: '/api/script-studio/watermark/image' });
  });

  router.delete('/watermark', (_req: Request, res: Response) => {
    const logoPath = path.join(wmDir, 'logo.png');
    if (fs.existsSync(logoPath)) fs.unlinkSync(logoPath);
    res.json({ ok: true });
  });

  return router;
}
