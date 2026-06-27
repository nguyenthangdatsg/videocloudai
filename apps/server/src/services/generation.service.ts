import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun, getDb } from '../db';
import { getProvider, getAvailableProviders } from '../providers';
import { PromptEnhancer } from '@videocloudai/core';
import { SceneLibraryService } from './scene-library.service';
import type {
  GenerationRequest,
  PromptRecord,
  SceneLine,
  ProviderName,
  SceneStyle,
} from '@videocloudai/shared';

interface DbGeneration {
  id: string;
  provider: string;
  prompt_id: string;
  prompt: string;
  enhanced_prompt: string;
  type: string;
  duration: number;
  aspect_ratio: string;
  style: string;
  retry_count: number;
  max_retries: number;
  status: string;
  result_asset_id: string;
  error_message: string;
  submitted_at: string;
  completed_at: string;
  created_at: string;
}

function mapGeneration(row: DbGeneration): GenerationRequest {
  return {
    id: row.id,
    providerId: row.provider as ProviderName,
    promptId: row.prompt_id,
    prompt: row.prompt,
    enhancedPrompt: row.enhanced_prompt,
    type: row.type as GenerationRequest['type'],
    duration: row.duration,
    aspectRatio: row.aspect_ratio,
    style: row.style,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    status: row.status as GenerationRequest['status'],
    resultAssetId: row.result_asset_id,
    errorMessage: row.error_message,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export class GenerationService {
  private enhancer: PromptEnhancer;
  private libraryService: SceneLibraryService;
  private cacheDir: string;
  private assetsDir: string;

  constructor(libraryService: SceneLibraryService) {
    this.enhancer = new PromptEnhancer();
    this.libraryService = libraryService;
    this.cacheDir = process.env.CACHE_DIR ?? './cache/generations';
    this.assetsDir = process.env.ASSETS_DIR ?? './assets';
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  async requestGeneration(
    sceneLine: SceneLine,
    options: {
      provider?: ProviderName;
      forceNew?: boolean;
      videoId?: string;
    } = {}
  ): Promise<GenerationRequest> {
    const enhancedPrompt = this.enhancer.enhance(sceneLine.visual, {
      style: sceneLine.style,
      mood: sceneLine.mood,
      cameraType: sceneLine.cameraType,
      atmosphere: sceneLine.atmosphere,
      duration: sceneLine.duration,
    });

    // Check prompt cache
    const checksum = crypto.createHash('md5').update(enhancedPrompt).digest('hex');
    const existingPrompt = dbGet<{ id: string }>(
      'SELECT id FROM prompts WHERE checksum = ?',
      [checksum]
    );

    let promptId: string;
    if (existingPrompt) {
      promptId = existingPrompt.id;
      dbRun(
        'UPDATE prompts SET times_used = times_used + 1, last_used_at = ? WHERE id = ?',
        [new Date().toISOString(), promptId]
      );
    } else {
      promptId = uuidv4();
      dbRun(
        `INSERT INTO prompts (id, original_prompt, enhanced_prompt, style, mood, checksum, times_used, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          promptId,
          sceneLine.visual,
          enhancedPrompt,
          sceneLine.style ?? null,
          sceneLine.mood,
          checksum,
          new Date().toISOString(),
        ]
      );
    }

    const provider = options.provider ?? this.selectProvider(sceneLine);
    const genId = uuidv4();
    const now = new Date().toISOString();

    dbRun(
      `INSERT INTO generations (id, provider, prompt_id, prompt, enhanced_prompt, type, duration,
       aspect_ratio, style, retry_count, max_retries, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '9:16', ?, 0, 3, 'queued', ?)`,
      [
        genId,
        provider,
        promptId,
        sceneLine.visual,
        enhancedPrompt,
        'video',
        sceneLine.duration,
        sceneLine.style ?? null,
        now,
      ]
    );

    return this.getGeneration(genId)!;
  }

  async executeGeneration(generationId: string): Promise<string> {
    const gen = this.getGeneration(generationId);
    if (!gen) throw new Error(`Generation ${generationId} not found`);

    const provider = getProvider(gen.providerId);

    dbRun(
      "UPDATE generations SET status = 'submitted', submitted_at = ? WHERE id = ?",
      [new Date().toISOString(), generationId]
    );

    const operationId = await provider.submit(gen);

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 3000));
      const status = await provider.poll(operationId);

      if (status === 'completed') {
        const ext = gen.type === 'image' ? 'webp' : 'mp4';
        const filename = `${generationId}.${ext}`;
        const destDir = gen.type === 'image'
          ? path.join(this.assetsDir, 'images')
          : path.join(this.assetsDir, 'videos');
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, filename);

        const result = await provider.download(operationId, destPath);
        const stat = fs.statSync(destPath);
        const checksum = crypto
          .createHash('md5')
          .update(fs.readFileSync(destPath))
          .digest('hex');

        const asset = this.libraryService.createAsset({
          generationId,
          type: gen.type === 'image' ? 'image' : 'video',
          filename,
          filepath: destPath,
          filesize: stat.size,
          mimeType: gen.type === 'image' ? 'image/webp' : 'video/mp4',
          checksum,
          metadata: {
            tags: [],
            mood: undefined,
            reuseKeywords: [],
          },
        });

        dbRun(
          "UPDATE generations SET status = 'completed', result_asset_id = ?, completed_at = ? WHERE id = ?",
          [asset.id, new Date().toISOString(), generationId]
        );

        return asset.id;
      }

      if (status === 'failed') {
        dbRun(
          "UPDATE generations SET status = 'failed', error_message = ? WHERE id = ?",
          ['Generation failed at provider', generationId]
        );
        throw new Error('Generation failed at provider');
      }

      attempts++;
    }

    dbRun(
      "UPDATE generations SET status = 'failed', error_message = ? WHERE id = ?",
      ['Generation timed out', generationId]
    );
    throw new Error('Generation timed out');
  }

  getGeneration(id: string): GenerationRequest | undefined {
    const row = dbGet<DbGeneration>('SELECT * FROM generations WHERE id = ?', [id]);
    return row ? mapGeneration(row) : undefined;
  }

  listGenerations(status?: string): GenerationRequest[] {
    const rows = status
      ? dbAll<DbGeneration>('SELECT * FROM generations WHERE status = ? ORDER BY created_at DESC LIMIT 100', [status])
      : dbAll<DbGeneration>('SELECT * FROM generations ORDER BY created_at DESC LIMIT 100');
    return rows.map(mapGeneration);
  }

  private selectProvider(sceneLine: SceneLine): ProviderName {
    const available = getAvailableProviders();
    if (!available.length) return 'google-imagefx';

    // Prefer video generation for Flow, image for ImageFX
    if (available.includes('google-flow')) return 'google-flow';
    return 'google-imagefx';
  }

  getOrCachePrompt(originalPrompt: string, style?: SceneStyle): PromptRecord | undefined {
    return dbGet<PromptRecord>('SELECT * FROM prompts WHERE original_prompt = ?', [originalPrompt]);
  }
}
