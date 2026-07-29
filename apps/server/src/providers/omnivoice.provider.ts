/**
 * OmniVoice TTS Provider
 *
 * Integrates with OmniVoice Studio — a local desktop app that exposes an
 * OpenAI-compatible TTS API on port 3900.
 *
 * API reference: https://github.com/debpalash/OmniVoice-Studio
 *
 * Environment variables:
 *   OMNIVOICE_BASE_URL       — Base URL of the OmniVoice API (default http://localhost:3900)
 *   OMNIVOICE_TIMEOUT_MS     — Request timeout in milliseconds  (default 60000)
 *   OMNIVOICE_MAX_CONCURRENCY — Max parallel synthesis calls     (default 2)
 */

import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters accepted by the `synthesize` function. */
export interface SynthesizeParams {
  /** The text to speak. */
  text: string;
  /** Voice identifier — cloned profile ID, "default", or OpenAI-compatible name ("alloy"). */
  voiceId: string;
  /** Speech rate multiplier (0.5–2.0, default 1.0). */
  rate?: number;
  /**
   * TTS engine/model to use. Maps to the `model` field in the request.
   * Examples: "tts-1", "tts-1-hd", "voxcpm2", "cosyvoice", "kittentts".
   * Default: "tts-1"
   */
  model?: string;
}

/** Result returned by `synthesize`. */
export interface SynthesizeResult {
  /** Duration of the generated audio in milliseconds. 0 if unknown (caller should use ffprobe). */
  durationMs: number;
}

/** Voice entry returned by the voices endpoint. */
export interface OmniVoiceEntry {
  voice_id: string;
  name: string;
  type: 'profile' | 'preset';
  engine?: string;
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/** Returns the configured OmniVoice base URL. */
export function getBaseUrl(): string {
  return (process.env.OMNIVOICE_BASE_URL || 'http://localhost:3900').replace(/\/+$/, '');
}

function getTimeoutMs(): number {
  const val = parseInt(process.env.OMNIVOICE_TIMEOUT_MS || '', 10);
  return Number.isFinite(val) && val > 0 ? val : 60_000;
}

function getMaxConcurrency(): number {
  const val = parseInt(process.env.OMNIVOICE_MAX_CONCURRENCY || '', 10);
  return Number.isFinite(val) && val > 0 ? val : 2;
}

// ---------------------------------------------------------------------------
// Promise-based semaphore (no external dependency)
// ---------------------------------------------------------------------------

class Semaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }
}

const semaphore = new Semaphore(getMaxConcurrency());

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synthesize speech via OmniVoice Studio.
 *
 * Sends an OpenAI-compatible `/v1/audio/speech` request and writes the
 * resulting audio bytes to `outputPath`.
 */
export async function synthesize(
  params: SynthesizeParams,
  outputPath: string,
): Promise<SynthesizeResult> {
  const { text, voiceId, rate = 1.0, model = 'tts-1' } = params;

  const body: Record<string, unknown> = {
    model,
    voice: voiceId || 'default',
    input: text,
    speed: Math.max(0.5, Math.min(2.0, rate)),
    response_format: 'mp3',
  };

  await semaphore.acquire();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTimeoutMs());

    const response = await fetch(`${getBaseUrl()}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OmniVoice synthesis failed (${response.status}): ${errText}`);
    }

    // Write audio bytes to disk
    const arrayBuf = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(arrayBuf));

    // Duration is unknown from the binary stream — caller should use ffprobe
    return { durationMs: 0 };
  } finally {
    semaphore.release();
  }
}

/**
 * List available voices from OmniVoice Studio.
 */
export async function listVoices(): Promise<OmniVoiceEntry[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${getBaseUrl()}/v1/audio/voices`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json() as { voices?: OmniVoiceEntry[] };
    return data.voices ?? [];
  } catch {
    return [];
  }
}

/**
 * Check whether the OmniVoice server is reachable.
 * Uses the voices endpoint as a health check.
 * Never throws — returns `false` on any error.
 */
export async function isReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${getBaseUrl()}/v1/audio/voices`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
