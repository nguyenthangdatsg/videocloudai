import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import { getSettings } from './settings.service';

const ASPECT_SIZES: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1440, height: 1080 },
  '3:4': { width: 1080, height: 1440 },
};

/** Enhance prompt: add aspect ratio framing + strengthen white background if present */
function enhancePrompt(prompt: string, aspectRatio: string): string {
  let enhanced = prompt;

  // Add aspect ratio composition hint
  const arHint = aspectRatio === '9:16' ? ', vertical portrait composition, 9:16 aspect ratio'
    : aspectRatio === '1:1' ? ', centered square composition, 1:1 aspect ratio'
    : ', wide cinematic composition, 16:9 aspect ratio';
  enhanced += arHint;

  // Strengthen white background if mentioned in prompt
  if (/white\s*background/i.test(enhanced)) {
    enhanced = enhanced.replace(/plain\s+white\s+background/gi, 'solid pure white background (#FFFFFF), no gradient, no texture, no scenery behind subject');
    enhanced = enhanced.replace(/white\s+background/gi, 'solid pure white background (#FFFFFF), no gradient, no texture');
  }

  return enhanced;
}

export interface ImageProvider {
  id: string;
  name: string;
  free: boolean;
  quality: number; // 1-10
  needsKey: boolean;
  models?: readonly string[];
  generate: (prompt: string, aspectRatio: string, destPath: string, model?: string) => Promise<void>;
  isAvailable: () => boolean;
}

// Track rate-limited providers: provider id -> timestamp when limit expires
const rateLimited = new Map<string, number>();

function markRateLimited(id: string, retryAfterSec = 60) {
  rateLimited.set(id, Date.now() + retryAfterSec * 1000);
}

function isRateLimited(id: string): boolean {
  const until = rateLimited.get(id);
  if (!until) return false;
  if (Date.now() > until) { rateLimited.delete(id); return false; }
  return true;
}

function writeBuffer(destPath: string, buffer: Buffer) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
}

// ── 1. Google Gemini Native Image Generation (@google/genai SDK) ─────
//
// Uses the new Native Multimodal models (Nano Banana) via generateContent().
// Works on Free Tier — no Billing / Cloud Project required.
// Legacy imagen-3.0-* models via :predict require Billing and are NOT used.

const GOOGLE_GEMINI_IMAGE_MODELS = [
  'gemini-2.5-flash-image',       // Nano Banana — fast, free tier
  'gemini-3-pro-image-preview',   // Nano Banana Pro — higher quality, search grounding
] as const;

export type GoogleGeminiImageModel = typeof GOOGLE_GEMINI_IMAGE_MODELS[number];
export { GOOGLE_GEMINI_IMAGE_MODELS };

let _genaiClient: GoogleGenAI | null = null;
function getGenAIClient(): GoogleGenAI {
  const key = getSettings().get('gemini_api_key');
  if (!key) throw new Error('Gemini API key not configured');
  // Re-create if key changed
  if (!_genaiClient) {
    _genaiClient = new GoogleGenAI({ apiKey: key });
  }
  return _genaiClient;
}

// Reset client when key changes (called from settings save)
export function resetGenAIClient() { _genaiClient = null; }

const googleGeminiImage: ImageProvider = {
  id: 'google-imagen',
  name: 'Google Gemini Image',
  free: true,
  quality: 10,
  needsKey: true,
  models: GOOGLE_GEMINI_IMAGE_MODELS,
  isAvailable: () => !!getSettings().get('gemini_api_key'),
  generate: async (prompt, aspectRatio, destPath, modelOverride) => {
    const ai = getGenAIClient();
    const model = modelOverride || getSettings().get('google_imagen_model') || 'gemini-2.5-flash-image';

    const ar = aspectRatio || '16:9';

    // MUST use camelCase — snake_case is silently ignored by the SDK
    const config: Record<string, unknown> = {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: ar,
        numberOfImages: 1,
      },
    };

    console.log(`[google-imagen] model=${model} ar=${ar} config=${JSON.stringify(config)}`);

    const response = await ai.models.generateContent({
      model,
      contents: enhancePrompt(prompt, ar),
      config,
    });

    // Extract image from response parts
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) {
      console.error(`[google-imagen] no parts in response:`, JSON.stringify(response).slice(0, 500));
      throw new Error('Google Gemini Image: no parts in response');
    }

    console.log(`[google-imagen] got ${parts.length} part(s): ${parts.map((p: any) => p.inlineData ? `image(${(p.inlineData.data?.length || 0)} bytes)` : p.text ? `text(${p.text.length})` : 'unknown').join(', ')}`);

    for (const part of parts) {
      if ((part as any).inlineData) {
        const b64: string = (part as any).inlineData.data;
        if (!b64) continue;
        const buf = Buffer.from(b64, 'base64');
        console.log(`[google-imagen] saving ${(buf.length / 1024).toFixed(0)}KB → ${path.basename(destPath)}`);
        writeBuffer(destPath, buf);
        return;
      }
    }

    throw new Error('Google Gemini Image: no image data in response');
  },
};

// ── 2. HuggingFace Inference (Free tier, no key needed for some models) ─

const huggingface: ImageProvider = {
  id: 'huggingface',
  name: 'HuggingFace',
  free: true,
  quality: 6,
  needsKey: false,
  isAvailable: () => true,
  generate: async (prompt, aspectRatio, destPath) => {
    const size = ASPECT_SIZES[aspectRatio] || ASPECT_SIZES['16:9'];
    const key = getSettings().get('huggingface_api_key') || '';
    const model = 'stabilityai/stable-diffusion-xl-base-1.0';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        inputs: enhancePrompt(prompt, aspectRatio),
        parameters: { width: Math.min(size.width, 1024), height: Math.min(size.height, 1024) },
      }),
    });

    if (res.status === 429 || res.status === 503) {
      markRateLimited('huggingface', 60);
      throw new Error(`HuggingFace rate limited (${res.status})`);
    }
    if (!res.ok) throw new Error(`HuggingFace error: ${res.status} ${await res.text()}`);
    writeBuffer(destPath, Buffer.from(await res.arrayBuffer()));
  },
};

// ── 3. Pollinations (Free, no key) ──────────────────────────────────

const POLLINATIONS_MODELS = [
  'flux',           // Default Flux model
  'turbo',          // Faster generation
  'gptimage',       // GPT Image (premium quality)
  'seedream',       // Seedream base
  'seedream-pro',   // Seedream Pro (higher quality)
  'kontext',        // Kontext model
  'nanobanana',     // NanoBanana base
  'nanobanana-pro', // NanoBanana Pro
  'zimage',         // ZImage model
] as const;

export type PollinationsModel = typeof POLLINATIONS_MODELS[number];
export { POLLINATIONS_MODELS };

const pollinations: ImageProvider = {
  id: 'pollinations',
  name: 'Pollinations',
  free: true,
  quality: 4,
  needsKey: false,
  models: POLLINATIONS_MODELS,
  isAvailable: () => true,
  generate: async (prompt, aspectRatio, destPath, modelOverride) => {
    const model = modelOverride || getSettings().get('pollinations_model') || 'flux';
    const size = ASPECT_SIZES[aspectRatio] || ASPECT_SIZES['16:9'];
    const seed = Math.floor(Math.random() * 2147483647);
    const encoded = encodeURIComponent(enhancePrompt(prompt, aspectRatio));
    const url = `https://image.pollinations.ai/prompt/${encoded}?model=${model}&width=${size.width}&height=${size.height}&seed=${seed}&nologo=true&enhance=true`;

    const res = await fetch(url, { redirect: 'follow' });
    if (res.status === 429 || res.status === 402) {
      markRateLimited('pollinations', 30);
      throw new Error(`Pollinations rate limited (${res.status})`);
    }
    if (!res.ok) throw new Error(`Pollinations error: ${res.status}`);
    writeBuffer(destPath, Buffer.from(await res.arrayBuffer()));
  },
};

// ── 4. Grok (xAI) Image Generation ───────────────────────────────────

const GROK_IMAGE_MODELS = [
  'grok-2-image',
] as const;

const grokImage: ImageProvider = {
  id: 'grok',
  name: 'Grok (xAI)',
  free: false,
  quality: 8,
  needsKey: true,
  models: GROK_IMAGE_MODELS,
  isAvailable: () => !!getSettings().get('grok_api_key'),
  generate: async (prompt, aspectRatio, destPath, modelOverride) => {
    const apiKey = getSettings().get('grok_api_key');
    if (!apiKey) throw new Error('Grok API key not configured');
    const model = modelOverride || 'grok-2-image';

    const res = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: enhancePrompt(prompt, aspectRatio),
        n: 1,
        size: aspectRatio === '9:16' ? '768x1344' : aspectRatio === '1:1' ? '1024x1024' : '1344x768',
        response_format: 'b64_json',
      }),
    });

    if (res.status === 429) {
      markRateLimited('grok', 60);
      throw new Error('Grok rate limited (429)');
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Grok error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { data: Array<{ b64_json?: string; url?: string }> };
    const imgData = data.data?.[0];
    if (imgData?.b64_json) {
      writeBuffer(destPath, Buffer.from(imgData.b64_json, 'base64'));
    } else if (imgData?.url) {
      const imgRes = await fetch(imgData.url);
      if (!imgRes.ok) throw new Error('Failed to download Grok image');
      writeBuffer(destPath, Buffer.from(await imgRes.arrayBuffer()));
    } else {
      throw new Error('Grok: no image data in response');
    }
  },
};

// ── 5. ChatGPT (OpenAI) Image Generation ─────────────────────────────

const CHATGPT_IMAGE_MODELS = [
  'gpt-image-1',
  'dall-e-3',
  'dall-e-2',
] as const;

const chatgptImage: ImageProvider = {
  id: 'chatgpt',
  name: 'ChatGPT (OpenAI)',
  free: false,
  quality: 9,
  needsKey: true,
  models: CHATGPT_IMAGE_MODELS,
  isAvailable: () => !!getSettings().get('openai_api_key'),
  generate: async (prompt, aspectRatio, destPath, modelOverride) => {
    const apiKey = getSettings().get('openai_api_key');
    if (!apiKey) throw new Error('OpenAI API key not configured');
    const model = modelOverride || 'gpt-image-1';

    const sizeMap: Record<string, Record<string, string>> = {
      'gpt-image-1': { '16:9': '1536x1024', '9:16': '1024x1536', '1:1': '1024x1024' },
      'dall-e-3': { '16:9': '1792x1024', '9:16': '1024x1792', '1:1': '1024x1024' },
      'dall-e-2': { '16:9': '1024x1024', '9:16': '1024x1024', '1:1': '1024x1024' },
    };
    const size = sizeMap[model]?.[aspectRatio] || sizeMap[model]?.['16:9'] || '1024x1024';

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: enhancePrompt(prompt, aspectRatio),
        n: 1,
        size,
        response_format: 'b64_json',
      }),
    });

    if (res.status === 429) {
      markRateLimited('chatgpt', 60);
      throw new Error('OpenAI rate limited (429)');
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { data: Array<{ b64_json?: string; url?: string }> };
    const imgData = data.data?.[0];
    if (imgData?.b64_json) {
      writeBuffer(destPath, Buffer.from(imgData.b64_json, 'base64'));
    } else if (imgData?.url) {
      const imgRes = await fetch(imgData.url);
      if (!imgRes.ok) throw new Error('Failed to download OpenAI image');
      writeBuffer(destPath, Buffer.from(await imgRes.arrayBuffer()));
    } else {
      throw new Error('OpenAI: no image data in response');
    }
  },
};

// ── Provider registry ────────────────────────────────────────────────

const ALL_PROVIDERS: ImageProvider[] = [
  huggingface,  // free, quality 6, SDXL
  pollinations, // free, quality 4, multiple models
];

export function getImageProviders(): ImageProvider[] {
  return ALL_PROVIDERS;
}

export function getImageProvider(id: string): ImageProvider | undefined {
  return ALL_PROVIDERS.find(p => p.id === id);
}

export function getAvailableImageProviders(): ImageProvider[] {
  return ALL_PROVIDERS.filter(p => p.isAvailable());
}

/**
 * Generate an image.
 * - If preferredProviderId is set (user picked a specific provider): only use that one, no fallback.
 * - If preferredProviderId is empty/undefined ("auto"): try all available providers in priority order.
 */
export async function generateImageWithFallback(
  prompt: string,
  aspectRatio: string,
  destPath: string,
  preferredProviderId?: string,
  onFallback?: (fromId: string, toId: string, reason: string) => void,
  model?: string,
): Promise<{ providerId: string }> {
  const isAuto = !preferredProviderId || preferredProviderId === 'auto';

  // ── Specific provider selected (no fallback) ──
  if (!isAuto) {
    const provider = getImageProvider(preferredProviderId!);
    if (!provider) throw new Error(`Unknown image provider: ${preferredProviderId}`);
    if (!provider.isAvailable()) throw new Error(`Provider [${provider.name}] is not available — check API key in Settings`);

    console.log(`[image-gen] provider=${provider.id} model=${model || 'default'} ar=${aspectRatio} prompt="${prompt.slice(0, 80)}..."`);
    const t0 = Date.now();
    try {
      await provider.generate(prompt, aspectRatio, destPath, model);
      console.log(`[image-gen] ✓ ${provider.id} done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${path.basename(destPath)}`);
      return { providerId: provider.id };
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[image-gen] ✗ ${provider.id} failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${msg}`);
      throw new Error(`[${provider.name}] ${msg}`);
    }
  }

  // ── Auto fallback chain ──
  const available = getAvailableImageProviders().filter(p => !isRateLimited(p.id));
  if (!available.length) {
    const all = getAvailableImageProviders();
    if (all.length) available.push(all[0]);
    else throw new Error('No image providers available. Configure at least one API key in Settings.');
  }

  console.log(`[image-gen] AUTO chain: ${available.map(p => p.id).join(' → ')} | ar=${aspectRatio} prompt="${prompt.slice(0, 80)}..."`);

  let lastError = '';
  for (let i = 0; i < available.length; i++) {
    const provider = available[i];
    const t0 = Date.now();
    console.log(`[image-gen] trying ${provider.id}...`);
    try {
      await provider.generate(prompt, aspectRatio, destPath);
      console.log(`[image-gen] ✓ ${provider.id} done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${path.basename(destPath)}`);
      return { providerId: provider.id };
    } catch (err) {
      lastError = (err as Error).message;
      console.warn(`[image-gen] ✗ ${provider.id} failed: ${lastError}`);
      const nextProvider = available[i + 1];
      if (nextProvider && onFallback) {
        onFallback(provider.id, nextProvider.id, lastError);
      }
    }
  }

  throw new Error(`All image providers failed. Last error: ${lastError}`);
}

// ── Video Generation (Google Gemini Veo) ──────────────────────────────
//
// Uses Google GenAI SDK to generate short video clips from text prompts.
// Requires a Gemini API key with access to video generation models.

const GEMINI_VIDEO_MODELS = [
  'veo-2.0-generate-001',
] as const;

export function isVideoGenerationAvailable(): boolean {
  return !!getSettings().get('gemini_api_key');
}

export function getVideoModels(): readonly string[] {
  return GEMINI_VIDEO_MODELS;
}

/**
 * Generate a short video clip from a text prompt using Google Gemini Veo.
 * Returns the path to the saved .mp4 file.
 */
export async function generateVideoClip(
  prompt: string,
  aspectRatio: string,
  destPath: string,
  durationSeconds: number = 5,
  model?: string,
): Promise<{ providerId: string }> {
  const ai = getGenAIClient();
  const videoModel = model || 'veo-2.0-generate-001';

  // Map aspect ratio format
  const arMap: Record<string, string> = {
    '16:9': '16:9',
    '9:16': '9:16',
    '1:1': '1:1',
  };
  const ar = arMap[aspectRatio] || '16:9';

  console.log(`[video-gen] model=${videoModel} ar=${ar} duration=${durationSeconds}s prompt="${prompt.slice(0, 80)}..."`);

  const t0 = Date.now();

  try {
    // Use generateVideos API
    let operation = await ai.models.generateVideos({
      model: videoModel,
      prompt,
      config: {
        aspectRatio: ar,
        numberOfVideos: 1,
        durationSeconds,
      },
    });

    // Poll until done
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    // Extract video from result
    const generatedVideos = operation.response?.generatedVideos;
    if (!generatedVideos?.length) {
      throw new Error('No videos generated in response');
    }

    const video = generatedVideos[0].video;
    if (!video?.uri) {
      throw new Error('No video URI in response');
    }

    // Download the video
    const videoResponse = await fetch(video.uri);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status}`);
    }
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    writeBuffer(destPath, videoBuffer);

    console.log(`[video-gen] ✓ ${videoModel} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${(videoBuffer.length / 1024).toFixed(0)}KB) → ${path.basename(destPath)}`);
    return { providerId: videoModel };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[video-gen] ✗ ${videoModel} failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${msg}`);
    throw new Error(`[Video Gen] ${msg}`);
  }
}
