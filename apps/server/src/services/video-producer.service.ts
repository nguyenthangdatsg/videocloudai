import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  getDoc,
  setDocStatus,
  addLog,
  listBlocks,
  updateBlockAudio,
  updateBlockClip,
  updateBlockRendered,
  updateBlockError,
  updateBlockAi,
  buildFlowPrompt,
  resolveBlockVoice,
  parseVoiceConfig,
  syncBlocksFromParsed,
  getJobStatus,
  type LogLevel,
  type ScriptBlockRecord,
  type VoiceGroup,
  type ResolvedVoiceConfig,
} from './script-studio.service';
import { isReachable as omnivoiceReachable, synthesize as omnivoiceSynthesize, getBaseUrl as getOmnivoiceBaseUrl } from '../providers/omnivoice.provider';
import { generateVideoClip } from './image-providers';
import {
  searchPexelsVideos,
  resolveImageCacheDir,
} from './pexels.service';
import { renderChart } from './chart-renderer.service';
import { getSettings } from './settings.service';
import { resolveFfmpegPathSync } from './import.service';

const execFileAsync = promisify(execFile);

// ── Types ──

export interface ProduceOptions {
  voice?: string;
  rate?: string;
  orientation?: 'landscape' | 'portrait';
  music?: { enabled: boolean; trackId?: string; volumeDb?: number };
  subtitles?: boolean;
  subtitleStyle?: {
    enabled: boolean;
    fontFamily: string;
    fontSize: number;
    fontColor: string;
    fontWeight: 'normal' | 'bold';
    strokeColor: string;
    strokeWidth: number;
    bgColor: string;
    bgOpacity: number;
    position: 'top' | 'center' | 'bottom';
    alignment: 'left' | 'center' | 'right';
    marginX: number;
    marginBottom: number;
    uppercase: boolean;
    animation: 'none' | 'fade' | 'word-highlight' | 'karaoke';
  };
  accentColor?: string;
  /** When true: if Pexels returns zero usable candidates, auto-generate via AI instead of inheriting previous clip */
  aiFallback?: boolean;
  /** How to handle AI (FLOW) scenes whose narration exceeds the provider's native clip length.
   *  'freeze_hold' (default): generate ONE clip, play it once, hold last frame for the remainder.
   *  'multi_generate': generate one clip PER sub-shot with character-locked prompts. */
  aiLongSceneMode?: 'freeze_hold' | 'multi_generate';
  /** Playback speed multiplier for the final video (1 = normal, 2.5/5/7.5/10 = faster). */
  speedRate?: number;
  /** Chart rectangle overlay opacity (0 = fully transparent, 1 = fully opaque). Default 0.5 */
  chartOpacity?: number;
  preset?: string;
}

export type EmitFn = (level: LogLevel, message: string, progressPct: number) => void;

// ── Pacing ──

export interface PacingConfig {
  targetShotSec: number;   // default 3.5
  minShotSec: number;      // default 2.5
  maxShotSec: number;      // default 6.0
  holdOnOverlay: boolean;  // min 4.5s for shots with overlays
  sentenceSnap: boolean;   // snap cuts to sentence boundaries
}

const DEFAULT_PACING: PacingConfig = {
  targetShotSec: 3.5,
  minShotSec: 2.5,
  maxShotSec: 6.0,
  holdOnOverlay: true,
  sentenceSnap: true,
};

export interface ShotSpan {
  startMs: number;
  endMs: number;
  durationMs: number;
  hasOverlay: boolean;
  motion: string;
}

const MOTION_CYCLE = ['slow-zoom', 'ken-burns-in', 'ken-burns-out', 'pan-left', 'pan-right'];

/**
 * planShots — pure function. Computes a list of shot spans for a block.
 * Sentence boundaries are detected from words_json punctuation.
 * Chart blocks always produce exactly one shot.
 * [PACE: slow/fast] overrides the target duration.
 */
export function planShots(
  block: Pick<ScriptBlockRecord, 'audioDurationMs' | 'words' | 'overlays' | 'chartSpec' | 'paceHint' | 'blockIndex' | 'visualType'>,
  config: PacingConfig = DEFAULT_PACING,
): ShotSpan[] {
  const durMs = block.audioDurationMs ?? 0;
  if (durMs <= 0) return [];

  // Chart/graphic blocks are always a single shot (never subdivide)
  if (block.chartSpec) {
    return [{ startMs: 0, endMs: durMs, durationMs: durMs, hasOverlay: false, motion: 'static' }];
  }

  // AI blocks: single shot if short enough; otherwise allow sub-shot splitting
  // Provider native clip length is ~8s; split threshold = max(target * 1.5, 8s)
  const AI_NATIVE_CLIP_SEC = 8;
  if (block.visualType === 'ai') {
    const splitThresholdMs = Math.max(config.targetShotSec * 1.5, AI_NATIVE_CLIP_SEC) * 1000;
    if (durMs <= splitThresholdMs) {
      return [{ startMs: 0, endMs: durMs, durationMs: durMs, hasOverlay: false, motion: 'static' }];
    }
    // Fall through to sentence-based splitting below
  }
  if (block.overlays.length > 0 && config.holdOnOverlay) {
    return [{ startMs: 0, endMs: durMs, durationMs: durMs, hasOverlay: true, motion: 'static' }];
  }

  const targetMs = (
    block.paceHint === 'slow' ? 5.5 :
    block.paceHint === 'fast' ? 2.8 :
    config.targetShotSec
  ) * 1000;
  const minMs = config.minShotSec * 1000;
  const maxMs = config.maxShotSec * 1000;

  // If audio too short for even one min-shot, return single shot
  if (durMs < minMs * 1.5 || !block.words || block.words.length === 0) {
    const hasOverlay = block.overlays.length > 0;
    const shotDur = hasOverlay && config.holdOnOverlay ? Math.max(durMs, 4500) : durMs;
    return [{ startMs: 0, endMs: shotDur, durationMs: shotDur, hasOverlay, motion: 'static' }];
  }

  // Build sentence boundary timestamps from words + punctuation
  // A sentence ends at a word whose text ends with . ! ? (or is the last word)
  const words = block.words;
  const sentenceEndMs: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wordEndMs = w.offset_ms + w.duration_ms;
    const isSentenceEnd = /[.!?]$/.test(w.word) || i === words.length - 1;
    if (isSentenceEnd) sentenceEndMs.push(wordEndMs);
  }

  if (sentenceEndMs.length === 0) {
    return [{ startMs: 0, endMs: durMs, durationMs: durMs, hasOverlay: false, motion: MOTION_CYCLE[block.blockIndex % MOTION_CYCLE.length] }];
  }

  // Build sentence spans
  interface SentenceSpan { startMs: number; endMs: number }
  const sentences: SentenceSpan[] = [];
  let prevEnd = 0;
  for (const end of sentenceEndMs) {
    sentences.push({ startMs: prevEnd, endMs: end });
    prevEnd = end;
  }

  // Greedy grouping: accumulate sentences until we hit target or max
  const rawShots: { startMs: number; endMs: number }[] = [];
  let groupStart = sentences[0].startMs;
  let groupEnd = sentences[0].endMs;

  for (let i = 1; i < sentences.length; i++) {
    const tentativeEnd = sentences[i].endMs;
    const tentativeDur = tentativeEnd - groupStart;

    if (tentativeDur > maxMs) {
      // Flush current group (it's already at or near target/max)
      rawShots.push({ startMs: groupStart, endMs: groupEnd });
      groupStart = sentences[i].startMs;
      groupEnd = sentences[i].endMs;
    } else {
      groupEnd = tentativeEnd;
      if (tentativeDur >= targetMs) {
        rawShots.push({ startMs: groupStart, endMs: groupEnd });
        if (i + 1 < sentences.length) {
          groupStart = sentences[i + 1].startMs;
          groupEnd = sentences[i + 1].endMs;
          i++; // skip sentence we just assigned as start of next group
        } else {
          groupStart = groupEnd; // signal nothing left
        }
      }
    }
  }

  // Flush remainder, extending to full audio duration for the last shot
  if (groupStart < durMs) {
    rawShots.push({ startMs: groupStart, endMs: durMs });
  }

  if (rawShots.length === 0) {
    return [{ startMs: 0, endMs: durMs, durationMs: durMs, hasOverlay: false, motion: MOTION_CYCLE[block.blockIndex % MOTION_CYCLE.length] }];
  }

  // Assign motions (no overlays here — handled at the top)
  return rawShots.map((s, i) => {
    const shotDur = s.endMs - s.startMs;
    const motion = MOTION_CYCLE[(block.blockIndex + i) % MOTION_CYCLE.length];
    return { startMs: s.startMs, endMs: s.endMs, durationMs: shotDur, hasOverlay: false, motion };
  });
}

// ── TTS text normalization ──

interface WordMapping {
  originalToken: string;
  spokenWords: string[];
}

export interface NormalizationResult {
  normalized: string;
  mappings: WordMapping[];   // original token → spoken word(s) for subtitle alignment
  changes: string[];         // human-readable change log
}

function numToWords(n: number): string {
  if (!isFinite(n) || isNaN(n)) return String(n);
  if (n < 0) return 'negative ' + numToWords(-n);
  if (n === 0) return 'zero';

  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  function below1000(x: number): string {
    if (x < 20) return ones[x];
    if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? '-' + ones[x % 10] : '');
    return ones[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' ' + below1000(x % 100) : '');
  }

  const parts: string[] = [];
  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const remainder = Math.floor(n % 1_000);

  if (billions) parts.push(below1000(billions) + ' billion');
  if (millions) parts.push(below1000(millions) + ' million');
  if (thousands) parts.push(below1000(thousands) + ' thousand');
  if (remainder) parts.push(below1000(remainder));
  return parts.join(' ');
}

function yearToWords(y: number): string {
  if (y >= 1100 && y <= 1999) {
    const hi = Math.floor(y / 100);
    const lo = y % 100;
    return numToWords(hi) + ' hundred' + (lo === 0 ? '' : (lo < 10 ? ' oh-' + numToWords(lo) : ' ' + numToWords(lo)));
  }
  if (y >= 2000 && y <= 2099) {
    const lo = y % 100;
    return lo === 0 ? 'two thousand' : 'two thousand ' + numToWords(lo);
  }
  return numToWords(y);
}

function decimalToWords(intPart: number, fracStr: string): string {
  const fracDigits = fracStr.split('').map((d) => numToWords(parseInt(d)));
  return numToWords(intPart) + ' point ' + fracDigits.join(' ');
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'dollars',
  '€': 'euros',
  '£': 'pounds',
  '¥': 'yen',
  '₩': 'won',
  '₹': 'rupees',
};

export function normalizeTtsText(text: string): NormalizationResult {
  const changes: string[] = [];
  const mappings: WordMapping[] = [];

  // Strip emoji (Unicode ranges for emoji)
  const noEmoji = text.replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ' ');

  // Tokenize on whitespace, preserving each token
  const tokens = noEmoji.split(/(\s+)/);
  const resultTokens: string[] = [];

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      resultTokens.push(token);
      continue;
    }

    let t = token;
    let changed = false;
    let spoken = '';

    // & → and
    if (t === '&') { spoken = 'and'; changed = true; }
    // ~ → (drop)
    else if (t === '~') { spoken = ''; changed = true; }
    // Currency: $2,070 or $2.5M
    else if (/^[€£$¥₩₹]/.test(t)) {
      const sym = t[0];
      const unit = CURRENCY_SYMBOLS[sym] ?? 'currency';
      const rest = t.slice(1).replace(/,/g, '');
      const mM = rest.match(/^([\d]+(?:\.\d+)?)([MmBbKk]?)$/);
      if (mM) {
        const num = parseFloat(mM[1]);
        const mult = { m: 1e6, b: 1e9, k: 1e3, '': 1 }[mM[2].toLowerCase()] ?? 1;
        const total = num * mult;
        const fracMatch = mM[1].match(/\.(\d+)$/);
        spoken = fracMatch
          ? decimalToWords(Math.floor(num), fracMatch[1]) + (mult !== 1 ? ' ' + ({ 1e6: 'million', 1e9: 'billion', 1e3: 'thousand' }[mult] ?? '') : '') + ' ' + unit
          : numToWords(total) + ' ' + unit;
        changed = true;
      }
    }
    // Percent: 25.7% or 25%
    else if (/^-?[\d,]+(?:\.\d+)?%$/.test(t)) {
      const numStr = t.replace(/%$/, '').replace(/,/g, '');
      const fracMatch = numStr.match(/\.(\d+)$/);
      const intPart = parseInt(numStr);
      spoken = fracMatch
        ? decimalToWords(intPart, fracMatch[1]) + ' percent'
        : numToWords(intPart) + ' percent';
      changed = true;
    }
    // Range: 70–74 or 70-74 (en-dash or hyphen between numbers)
    else if (/^\d+[–—\-]\d+$/.test(t)) {
      const [a, b] = t.split(/[–—\-]/);
      spoken = numToWords(parseInt(a)) + ' to ' + numToWords(parseInt(b));
      changed = true;
    }
    // Standalone 4-digit year (1800–2099)
    else if (/^\d{4}[.,;:!?]?$/.test(t)) {
      const trailingPunct = t.match(/([.,;:!?]+)$/)?.[1] ?? '';
      const y = parseInt(t);
      if (y >= 1800 && y <= 2099) {
        spoken = yearToWords(y) + trailingPunct;
        changed = true;
      }
    }

    if (changed) {
      if (spoken) {
        changes.push(`"${token}" → "${spoken}"`);
        mappings.push({ originalToken: token, spokenWords: spoken.split(/\s+/).filter(Boolean) });
        resultTokens.push(spoken);
      } else {
        changes.push(`"${token}" → (removed)`);
        // no push = token dropped
      }
    } else {
      mappings.push({ originalToken: token, spokenWords: [token] });
      resultTokens.push(t);
    }
  }

  return {
    normalized: resultTokens.join(''),
    mappings,
    changes,
  };
}

// ── Zoompan motion filter (Script Studio scope — corrected parameters) ──

/**
 * Build a corrected zoompan vf string for the given motion type.
 * - Pre-scales input to 1.2x target (subpixel headroom)
 * - Zoom increments ≤ 0.0008/frame → max 8% over 6s @ 24fps
 * - Bicubic scaling
 * - Runs at output fps
 */
function buildMotionFilter(motion: string, w: number, h: number, fps: number): string {
  const sw = Math.round(w * 1.2);
  const sh = Math.round(h * 1.2);
  const scale = `scale=${sw}:${sh}:flags=bicubic`;

  const zp = (zExpr: string, xExpr: string, yExpr: string) =>
    `${scale},zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${w}x${h}:fps=${fps},setsar=1`;

  switch (motion) {
    case 'ken-burns-in':
      return zp(
        'min(zoom+0.0008,1.08)',
        'iw/2-(iw/zoom/2)',
        'ih/2-(ih/zoom/2)',
      );
    case 'ken-burns-out':
      return zp(
        'if(eq(on,1),1.08,max(zoom-0.0008,1.0))',
        'iw/2-(iw/zoom/2)',
        'ih/2-(ih/zoom/2)',
      );
    case 'pan-left':
      return zp(
        'min(zoom+0.0004,1.04)',
        'if(eq(on,1),0,x+0.4)',
        'ih/2-(ih/zoom/2)',
      );
    case 'pan-right':
      return zp(
        'min(zoom+0.0004,1.04)',
        'if(eq(on,1),iw-(iw/zoom),x-0.4)',
        'ih/2-(ih/zoom/2)',
      );
    case 'pan-up':
      return zp(
        'min(zoom+0.0004,1.04)',
        'iw/2-(iw/zoom/2)',
        'if(eq(on,1),0,y+0.4)',
      );
    case 'pan-down':
      return zp(
        'min(zoom+0.0004,1.04)',
        'iw/2-(iw/zoom/2)',
        'if(eq(on,1),ih-(ih/zoom),y-0.4)',
      );
    case 'drift':
      return zp(
        'min(zoom+0.0003,1.03)',
        'iw/2-(iw/zoom/2)+sin(on/60)*4',
        'ih/2-(ih/zoom/2)',
      );
    case 'static':
      // No movement — simple scale+crop only
      return `scale=w=${w}:h=${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h},format=yuv420p`;
    case 'slow-zoom':
    default:
      return zp(
        'min(zoom+0.0005,1.05)',
        'iw/2-(iw/zoom/2)',
        'ih/2-(ih/zoom/2)',
      );
  }
}

// ── Pexels candidate search (alternatives endpoint + multi-shot sourcing) ──

export interface PexelsCandidate {
  pexelsId: number;
  thumbnail: string;
  previewUrl: string | null;
  duration: number;
  width: number;
  height: number;
  pexelsUrl: string;
}

export async function searchPexelsCandidates(
  query: string,
  orientation: 'landscape' | 'portrait',
  perPage = 5,
): Promise<PexelsCandidate[]> {
  try {
    const videos = await searchPexelsVideos(query, { orientation, perPage });
    return videos.map((v) => {
      const mp4Files = (v.video_files ?? []).filter((f) => f.file_type === 'video/mp4');
      const best = mp4Files.find((f) => f.quality === 'hd') ?? mp4Files[0];
      const preview = mp4Files.find((f) => f.quality === 'sd') ?? mp4Files[mp4Files.length - 1];
      return {
        pexelsId: v.id,
        thumbnail: (v as unknown as { image?: string }).image ?? '',
        previewUrl: preview?.link ?? null,
        downloadUrl: best?.link ?? preview?.link ?? null,
        duration: v.duration,
        width: best?.width ?? v.width,
        height: best?.height ?? v.height,
        pexelsUrl: v.url,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Fetch up to `count` distinct Pexels video files for a block query.
 * First tries the full query, then first-3-words fallback.
 * Returns downloaded local filenames and their pexels IDs.
 */
async function fetchBlockCandidates(
  query: string,
  orientation: 'landscape' | 'portrait',
  count: number,
  cacheDir: string,
): Promise<Array<{ filename: string; pexelsId: number; duration: number }>> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];

  const orient = orientation === 'portrait' ? 'portrait' as const : 'landscape' as const;
  const perPage = Math.max(count, 5);

  // Prefer short clips (3–15s) that match shot pacing; fall back to any duration
  const searchWithFallback = async (q: string) => {
    let vids = await searchPexelsVideos(q, { orientation: orient, perPage, minDuration: 3, maxDuration: 15 });
    if (vids.length < count) {
      // Fallback: no duration filter
      const all = await searchPexelsVideos(q, { orientation: orient, perPage });
      const seen = new Set(vids.map(v => v.id));
      for (const v of all) {
        if (!seen.has(v.id)) { vids.push(v); seen.add(v.id); }
      }
    }
    return vids;
  };

  // Try full query first; if fewer results than needed, also try short query
  let videos = await searchWithFallback(query);
  if (videos.length < count) {
    const shortQuery = query.split(/\s+/).slice(0, 3).join(' ');
    if (shortQuery !== query) {
      const more = await searchWithFallback(shortQuery);
      // Merge, dedup by id
      const seen = new Set(videos.map((v) => v.id));
      for (const v of more) {
        if (!seen.has(v.id)) { videos.push(v); seen.add(v.id); }
      }
    }
  }

  // Sort by duration: prefer clips closest to 5s (ideal shot length)
  videos.sort((a, b) => Math.abs(a.duration - 5) - Math.abs(b.duration - 5));

  const results: Array<{ filename: string; pexelsId: number; duration: number }> = [];

  for (const video of videos.slice(0, count)) {
    const mp4Files = video.video_files?.filter((f) => f.file_type === 'video/mp4') ?? [];
    if (!mp4Files.length) continue;
    const sorted = [...mp4Files].sort((a, b) => {
      const q: Record<string, number> = { hd: 0, uhd: 1, sd: 2 };
      return (q[a.quality] ?? 3) - (q[b.quality] ?? 3) || Math.abs(a.width - 1920) - Math.abs(b.width - 1920);
    });
    const best = sorted[0];

    const hash = crypto.createHash('sha256').update(best.link).digest('hex').slice(0, 16);
    const filename = `pexels_${hash}.mp4`;
    const destPath = path.join(cacheDir, filename);

    if (!fs.existsSync(destPath)) {
      try {
        const res = await fetch(best.link);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(destPath, buf);
      } catch {
        continue;
      }
    }

    results.push({ filename, pexelsId: video.id, duration: video.duration });
  }

  return results;
}

// ── TTS per block ──

export async function runBlockTts(
  narration: string,
  voice: string,
  rate: string,
  audioOutPath: string,
  wordsOutPath: string,
): Promise<{ totalMs: number; wordCount: number }> {
  const scriptsDir = path.resolve(__dirname, '../../scripts');
  const ttsScript = path.join(scriptsDir, 'script_studio_block_tts.py');

  // Write narration to temp file
  const tmpText = `${audioOutPath}.tmp.txt`;
  fs.writeFileSync(tmpText, narration, 'utf-8');

  try {
    const { stdout } = await execFileAsync('python', [ttsScript, tmpText, voice, rate, audioOutPath, wordsOutPath], {
      timeout: 120_000,
    });
    const result = JSON.parse(stdout.trim());
    if (result.error) throw new Error(result.error);

    let totalMs = result.total_ms as number;

    // edge-tts sometimes emits no WordBoundary events (voice/version-dependent).
    // Fall back to ffprobe to get the actual audio duration.
    if (totalMs === 0 && fs.existsSync(audioOutPath)) {
      try {
        const ffprobe = resolveFfmpegPathSync('ffprobe');
        const { stdout: probeOut } = await execFileAsync(
          ffprobe,
          ['-v', 'quiet', '-print_format', 'json', '-show_streams', audioOutPath],
          { timeout: 10_000 },
        );
        const info = JSON.parse(probeOut);
        const durSec = parseFloat(info.streams?.[0]?.duration ?? '0');
        if (durSec > 0) totalMs = Math.round(durSec * 1000);
      } catch { /* ignore probe error; totalMs stays 0 */ }
    }

    return { totalMs, wordCount: result.words as number };
  } finally {
    try { fs.unlinkSync(tmpText); } catch { /* ignore */ }
  }
}

// ── OmniVoice TTS per block ──

export async function runOmnivoiceTts(
  narration: string,
  voiceConfig: ResolvedVoiceConfig,
  audioOutPath: string,
  wordsOutPath: string,
): Promise<{ totalMs: number; wordCount: number; timingMethod: string }> {
  // Convert rate string like "+10%" or "-5%" to speed multiplier (0.5–2.0)
  let speed = 1.0;
  if (voiceConfig.rate) {
    const match = voiceConfig.rate.match(/^([+-]?\d+)%?$/);
    if (match) speed = Math.max(0.5, Math.min(2.0, 1.0 + parseInt(match[1]) / 100));
  }

  const result = await omnivoiceSynthesize({
    text: narration,
    voiceId: voiceConfig.voiceId,
    rate: speed,
  }, audioOutPath);

  let totalMs = result.durationMs;
  let timingMethod = 'none';
  const wordCount = narration.split(/\s+/).filter(Boolean).length;

  // Get duration via ffprobe (OmniVoice returns binary stream, no duration metadata)
  if (totalMs === 0 && fs.existsSync(audioOutPath)) {
    try {
      const ffprobe = resolveFfmpegPathSync('ffprobe');
      const { stdout: probeOut } = await execFileAsync(
        ffprobe,
        ['-v', 'quiet', '-print_format', 'json', '-show_streams', audioOutPath],
        { timeout: 10_000 },
      );
      const info = JSON.parse(probeOut);
      const durSec = parseFloat(info.streams?.[0]?.duration ?? '0');
      if (durSec > 0) totalMs = Math.round(durSec * 1000);
    } catch { /* ignore */ }
  }

  // Try forced alignment for word-level timing
  if (fs.existsSync(audioOutPath) && totalMs > 0) {
    try {
      const scriptsDir = path.resolve(__dirname, '../../scripts');
      const alignScript = path.join(scriptsDir, 'forced_align.py');
      const tmpText = `${audioOutPath}.align.txt`;
      fs.writeFileSync(tmpText, narration, 'utf-8');
      try {
        const { stdout } = await execFileAsync('python', [alignScript, audioOutPath, tmpText, wordsOutPath], {
          timeout: 120_000,
        });
        const alignResult = JSON.parse(stdout.trim());
        if (!alignResult.error && alignResult.words > 0) {
          timingMethod = 'forced-align-stable-ts';
        }
      } finally {
        try { fs.unlinkSync(tmpText); } catch { /* ignore */ }
      }
    } catch {
      timingMethod = 'duration-estimated';
    }
  }

  return { totalMs, wordCount, timingMethod };
}

// ── ASS subtitle builder from per-block words ──
// Subtitles display ORIGINAL text tokens (numerals as-is), not the normalized TTS form.
// We load per-block normalization mappings and merge spoken word timings back to original tokens.

function buildAssSubtitles(
  blocks: Array<{
    words: Array<{ word: string; offset_ms: number; duration_ms: number }> | null;
    audioDurationMs: number | null;
    narration: string;
    audioPath: string | null;
  }>,
  w: number,
  h: number,
  isPortrait: boolean,
  audioDir: string,
  style?: ProduceOptions['subtitleStyle'],
): string {
  const hexToAssBgr = (hex: string) => {
    const c = hex.replace('#', '');
    return `${c.substring(4, 6)}${c.substring(2, 4)}${c.substring(0, 2)}`.toUpperCase();
  };
  const msToAssTime = (ms: number) => {
    const totalSec = ms / 1000;
    const hh = Math.floor(totalSec / 3600);
    const mm = Math.floor((totalSec % 3600) / 60);
    const ss = totalSec % 60;
    return `${hh}:${String(mm).padStart(2, '0')}:${ss.toFixed(2).padStart(5, '0')}`;
  };

  // Use custom style if provided, otherwise defaults
  const fontFamily = style?.fontFamily ?? 'Arial';
  const fontSize = style?.fontSize ?? (isPortrait ? 48 : 52);
  const bold = style?.fontWeight === 'bold' ? -1 : (style ? 0 : -1); // default bold
  const fontColor = `&H00${hexToAssBgr(style?.fontColor ?? '#FFFFFF')}`;
  const strokeColor = `&H00${hexToAssBgr(style?.strokeColor ?? '#000000')}`;
  const bgAlpha = Math.round((1 - (style?.bgOpacity ?? 0.5)) * 255).toString(16).toUpperCase().padStart(2, '0');
  const backColor = `&H${bgAlpha}${hexToAssBgr(style?.bgColor ?? '#000000')}`;
  const borderStyle = (style?.bgOpacity ?? 0.5) > 0 ? 3 : 1;
  const outline = style?.strokeWidth ?? 2;
  const marginL = style?.marginX ?? 40;
  const marginR = style?.marginX ?? 40;
  const marginV = style?.marginBottom ?? (isPortrait ? 100 : 60);

  // ASS alignment: bottom-left=1, bottom-center=2, bottom-right=3, mid-*=4-6, top-*=7-9
  const assAlignMap: Record<string, number> = { left: 1, center: 2, right: 3 };
  const posVertical = style?.position === 'top' ? 8 : style?.position === 'center' ? 5 : 2;
  const assAlign = (assAlignMap[style?.alignment ?? 'center'] ?? 2) + (posVertical - 2);

  const useUppercase = style?.uppercase ?? false;
  const animation = style?.animation ?? 'none';

  const header = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${w}`, `PlayResY: ${h}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontFamily},${fontSize},${fontColor},${fontColor},${strokeColor},${backColor},${bold},0,0,0,100,100,0,0,${borderStyle},${outline},0,${assAlign},${marginL},${marginR},${marginV},1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const events: string[] = [];
  let globalOffsetMs = 0;

  const applyCase = (t: string) => useUppercase ? t.toUpperCase() : t;
  const karaokeTag = animation === 'word-highlight' ? '\\kf' : '\\k';

  for (const block of blocks) {
    const dur = block.audioDurationMs ?? 0;

    if (block.words && block.words.length > 0) {
      // Try to load normalization mappings for this block
      let mappings: Array<{ originalToken: string; spokenWords: string[] }> | null = null;
      if (block.audioPath) {
        const mappingsPath = path.join(audioDir, block.audioPath + '.mappings.json');
        if (fs.existsSync(mappingsPath)) {
          try { mappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf-8')); } catch { /* ignore */ }
        }
      }

      // Build display tokens from original narration using mappings
      // Each display token gets the merged timing of its spoken words
      interface DisplayToken { text: string; startMs: number; durationMs: number }
      const displayTokens: DisplayToken[] = [];

      if (mappings && mappings.length > 0) {
        // Walk spoken words and group them back to original tokens
        let wordIdx = 0;
        for (const mapping of mappings) {
          if (!mapping.originalToken.trim()) continue;
          const spokenCount = mapping.spokenWords.length;
          const tokenWords = block.words.slice(wordIdx, wordIdx + spokenCount);
          if (tokenWords.length > 0) {
            const startMs = tokenWords[0].offset_ms;
            const endMs = tokenWords[tokenWords.length - 1].offset_ms + tokenWords[tokenWords.length - 1].duration_ms;
            displayTokens.push({ text: mapping.originalToken, startMs, durationMs: endMs - startMs });
          }
          wordIdx += spokenCount;
        }
      }

      // Build timed tokens: either from displayTokens (with mappings) or raw words
      const timedTokens: DisplayToken[] = displayTokens.length > 0
        ? displayTokens
        : block.words.map(w => ({ text: w.word, startMs: w.offset_ms, durationMs: w.duration_ms }));

      // Chunk into groups of ~7 words for single-row display
      const WORDS_PER_LINE = 7;
      for (let ci = 0; ci < timedTokens.length; ci += WORDS_PER_LINE) {
        const chunk = timedTokens.slice(ci, ci + WORDS_PER_LINE);
        const chunkStart = globalOffsetMs + chunk[0].startMs;
        const lastToken = chunk[chunk.length - 1];
        const chunkEnd = globalOffsetMs + lastToken.startMs + lastToken.durationMs;

        let text: string;
        if (animation === 'fade') {
          text = `{\\fad(150,100)}${applyCase(chunk.map(t => t.text).join(' '))}`;
        } else if (animation === 'karaoke' || animation === 'word-highlight') {
          text = chunk
            .map((t) => `{${karaokeTag}${Math.max(1, Math.round(t.durationMs / 10))}}${applyCase(t.text)}`)
            .join(' ');
        } else {
          text = applyCase(chunk.map(t => t.text).join(' '));
        }
        events.push(`Dialogue: 0,${msToAssTime(chunkStart)},${msToAssTime(chunkEnd)},Default,,0,0,0,,${text}`);
      }
    } else if (block.narration?.trim()) {
      // Fallback: whole narration chunked into single-row groups
      const words = block.narration.trim().split(/\s+/);
      const WORDS_PER_LINE = 7;
      const totalWords = words.length;
      const perWordMs = dur > 0 ? dur / totalWords : 100;

      for (let ci = 0; ci < totalWords; ci += WORDS_PER_LINE) {
        const chunk = words.slice(ci, ci + WORDS_PER_LINE);
        const chunkStartMs = globalOffsetMs + ci * perWordMs;
        const chunkEndMs = globalOffsetMs + Math.min((ci + chunk.length) * perWordMs, dur);

        let text: string;
        const perWord = Math.max(1, Math.floor(perWordMs / 10));
        if (animation === 'fade') {
          text = `{\\fad(150,100)}${applyCase(chunk.join(' '))}`;
        } else if (animation === 'karaoke' || animation === 'word-highlight') {
          text = chunk.map((w) => `{${karaokeTag}${perWord}}${applyCase(w)}`).join(' ');
        } else {
          text = applyCase(chunk.join(' '));
        }
        events.push(`Dialogue: 0,${msToAssTime(chunkStartMs)},${msToAssTime(chunkEndMs)},Default,,0,0,0,,${text}`);
      }
    }
    globalOffsetMs += dur;
  }

  return header + '\n' + events.join('\n') + '\n';
}

// ── Single-block reproduce ──

export async function reproduceSingleBlock(
  docId: string,
  blockIndex: number,
  orientation: 'landscape' | 'portrait' = 'landscape',
  chartOpacity = 0.5,
  animationDurationSec?: number,
  onLog?: (msg: string) => void,
): Promise<{ clipPath: string; filename: string; durationSec: number }> {
  const doc = getDoc(docId);
  if (!doc) throw new Error('Script doc not found');
  const blocks = listBlocks(docId);
  const block = blocks.find((b) => b.blockIndex === blockIndex);
  if (!block) throw new Error(`Block ${blockIndex} not found`);

  const log = onLog ?? ((m: string) => console.log(`[reproduce] ${m}`));
  const ffmpeg = resolveFfmpegPathSync('ffmpeg');
  const s = getSettings();
  const accentColor = '#7c6af5';
  const isPortrait = orientation === 'portrait';
  const w = isPortrait ? 1080 : 1920;
  const h = isPortrait ? 1920 : 1080;
  const pexelsOrientation = isPortrait ? 'portrait' as const : 'landscape' as const;

  const cacheDir = path.resolve(process.env.CACHE_DIR ?? './cache');
  const chartDir = path.resolve(cacheDir, 'charts');
  const outDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
  const imageDir = path.join(outDir, `doc_${docId}`);
  fs.mkdirSync(chartDir, { recursive: true });
  fs.mkdirSync(imageDir, { recursive: true });

  const audioDurSec = (block.audioDurationMs ?? 6000) / 1000;

  // ── Chart block ──
  if (block.chartSpec) {
    const chartDur = Math.max(audioDurSec, 4);
    const animDur = animationDurationSec ?? audioDurSec / 2;
    log(`Rendering chart... (animation: ${animDur.toFixed(1)}s / ${chartDur.toFixed(1)}s total)`);

    // Render dark-bg chart
    const darkResult = await renderChart(block.chartSpec, orientation, accentColor, '#0d0e12', chartDur, log, animDur);
    const darkChartPath = path.join(chartDir, darkResult.filename);

    // Fetch Pexels background — try multiple queries
    const bgQueries: string[] = [];
    if (block.pexelsQuery) bgQueries.push(block.pexelsQuery);
    if (block.chartSpec.title) bgQueries.push(block.chartSpec.title);
    if (block.segmentName) bgQueries.push(block.segmentName);
    if (block.narration) bgQueries.push(block.narration.split(/\s+/).slice(0, 5).join(' '));
    if (bgQueries.length === 0) bgQueries.push('abstract background');

    for (const bgQuery of bgQueries) {
      log(`Fetching bg video: "${bgQuery}"`);
      try {
        const bgCandidates = await fetchBlockCandidates(bgQuery, pexelsOrientation, 1, imageDir);
        if (bgCandidates.length > 0) {
          const bgClipPath = path.join(imageDir, bgCandidates[0].filename);
          log('Compositing chart rectangle over video...');

          const opacityStr = chartOpacity.toFixed(2);
          const bgHash = crypto.createHash('sha256').update(path.basename(bgClipPath)).digest('hex').slice(0, 8);
          const compositeFilename = `chart_comp_o${opacityStr}_bg${bgHash}_${darkResult.filename}`;
          const compositePath = path.join(chartDir, compositeFilename);
          const bgScaleVf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}`;
          const chartMargin = Math.round(Math.min(w, h) * 0.06);
          const chartW = w - chartMargin * 2;
          const chartH = h - chartMargin * 2;
          log(`Chart opacity: ${opacityStr}`);

          await execFileAsync(ffmpeg, [
            '-stream_loop', '-1', '-i', bgClipPath,
            '-i', darkChartPath,
            '-filter_complex', [
              `[0:v]${bgScaleVf},eq=brightness=-0.15:saturation=0.4[bg]`,
              `[1:v]crop=${chartW}:${chartH}:(in_w-${chartW})/2:(in_h-${chartH})/2,format=rgba,colorchannelmixer=aa=${opacityStr}[chart]`,
              `[bg][chart]overlay=${chartMargin}:${chartMargin}:shortest=1:format=auto[out]`,
            ].join(';'),
            '-map', '[out]',
            '-t', String(chartDur),
            '-r', '24',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-an', '-y', compositePath,
          ], { timeout: 300_000 });

          updateBlockClip(docId, blockIndex, compositeFilename, 'chart');
          updateBlockRendered(docId, blockIndex, compositePath);
          log(`Done: chart composited → ${compositeFilename}`);
          return { clipPath: compositePath, filename: compositeFilename, durationSec: chartDur };
        }
      } catch (err) {
        log(`Bg fetch/composite failed for "${bgQuery}": ${(err as Error).message?.slice(0, 100)}`);
      }
    }

    // Fallback: dark-bg chart only
    updateBlockClip(docId, blockIndex, darkResult.filename, 'chart');
    log(`Done: chart (solid bg) → ${darkResult.filename}`);
    return { clipPath: darkChartPath, filename: darkResult.filename, durationSec: chartDur };
  }

  // ── Pexels / AI / other block — re-encode clip ──
  if (!block.clipAssetPath) throw new Error('Block has no clip');

  const resolveClip = (filename: string, vtype: string): string | null => {
    const dirs = vtype === 'chart' ? [chartDir, imageDir] : [imageDir, chartDir];
    for (const d of dirs) {
      const p = path.join(d, filename);
      if (fs.existsSync(p)) return p;
    }
    return null;
  };

  const srcPath = resolveClip(block.clipAssetPath, block.visualType);
  if (!srcPath) throw new Error(`Source clip not found: ${block.clipAssetPath}`);

  fs.mkdirSync(outDir, { recursive: true });
  const segOut = path.join(outDir, `reproduced_block_${blockIndex}_${Date.now()}.mp4`);
  const scaleVf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h},format=yuv420p`;
  const trimStart = block.clipStartSec ?? 0;

  log(`Re-encoding clip: ${block.clipAssetPath} (${audioDurSec.toFixed(1)}s)...`);
  await execFileAsync(ffmpeg, [
    '-ss', String(trimStart),
    '-stream_loop', '-1',
    '-i', srcPath,
    '-vf', scaleVf,
    '-t', audioDurSec.toFixed(3),
    '-r', '24',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000',
    '-an', '-y', segOut,
  ], { timeout: 180_000 });

  updateBlockRendered(docId, blockIndex, segOut);
  log(`Done: ${path.basename(segOut)}`);
  return { clipPath: segOut, filename: path.basename(segOut), durationSec: audioDurSec };
}

// ── Main orchestrator ──

export async function produceBlocks(
  docId: string,
  jobId: string,
  options: ProduceOptions,
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<{ resultFilename: string; resultUrl: string; resultSizeKB: number; duration: number; aiShotCount: number }> {
  const doc = getDoc(docId);
  if (!doc) throw new Error('Script doc not found');

  const checkCancelled = (jId: string, dId: string) => {
    if (signal?.aborted) {
      setDocStatus(dId, 'parsed');
      throw new Error('JOB_CANCELLED');
    }
    const status = getJobStatus(jId);
    if (status === 'cancelled') {
      setDocStatus(dId, 'parsed');
      throw new Error('JOB_CANCELLED');
    }
  };

  const orientation = options.orientation ?? 'landscape';
  const isPortrait = orientation === 'portrait';
  const w = isPortrait ? 1080 : 1920;
  const h = isPortrait ? 1920 : 1080;
  const pexelsOrientation = isPortrait ? 'portrait' as const : 'landscape' as const;
  const enableSubtitles = options.subtitles === true || options.subtitleStyle?.enabled === true;
  const accentColor = options.accentColor ?? '#7c6af5';
  const preset = options.preset || process.env.FFMPEG_PRESET || 'superfast';

  const s = getSettings();
  const voice = options.voice ?? s.get('default_voice') ?? 'en-US-GuyNeural';
  const rate = options.rate ?? s.get('default_tts_rate') ?? '0';

  const cacheDir = path.resolve(process.env.CACHE_DIR ?? './cache');
  const audioDir = path.resolve(cacheDir, 'block_audio');
  const chartDir = path.resolve(cacheDir, 'charts');
  const outputDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
  const imageDir = path.join(outputDir, `doc_${docId}`);
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(chartDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(imageDir, { recursive: true });

  // Resolve ffmpeg: configured path → ffmpeg-static (full filters) → Remotion compositor → PATH
  const ffmpeg = resolveFfmpegPathSync('ffmpeg');
  const ffprobe = resolveFfmpegPathSync('ffprobe');
  addLog(docId, 'info', 'produce', `FFmpeg resolved: ${ffmpeg}`);
  addLog(docId, 'info', 'produce', `FFprobe resolved: ${ffprobe}`);

  const execFileWithCancel = async (
    file: string,
    args: string[],
    options?: any
  ) => {
    if (signal?.aborted) {
      throw new Error('JOB_CANCELLED');
    }
    let finalArgs = args;
    const isFfmpeg = file.endsWith('ffmpeg') || file.endsWith('ffmpeg.exe') || file === 'ffmpeg';
    if (isFfmpeg && !args.includes('-nostdin')) {
      finalArgs = ['-nostdin', ...args];
    }
    try {
      return await execFileAsync(file, finalArgs, { ...options, signal });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('abort') || signal?.aborted) {
        throw new Error('JOB_CANCELLED');
      }
      throw err;
    }
  };

  const blocks = listBlocks(docId);
  if (!blocks.length) throw new Error('No blocks found — parse the script first');

  /** Human-readable block label for logs: "Segment 2, Scene 3" */
  const ref = (b: ScriptBlockRecord): string =>
    `Segment ${b.segmentIndex}, Scene ${b.sceneNumber ?? b.blockIndex + 1}`;

  // ── Voice groups & OmniVoice reachability ──
  const voiceGroups: VoiceGroup[] = doc.parsed?.voiceGroups ?? [];
  const docVoiceConfig: string | null = doc.parsed?.voiceConfig ?? null;

  let omnivoiceAvailable = false;
  if (voiceGroups.some(g => g.engine === 'omnivoice')) {
    omnivoiceAvailable = await omnivoiceReachable();
    if (!omnivoiceAvailable) {
      const url = getOmnivoiceBaseUrl();
      emit('warn', `OmniVoice not reachable at ${url} — affected blocks will fall back to edge-tts`, 0);
      addLog(docId, 'warn', 'produce', `OmniVoice not reachable at ${url}`);
    }
  }

  // ══════════════════════════════════════════
  // STAGE 1: Per-block TTS Audio (0–30%)
  // ══════════════════════════════════════════
  emit('info', `Stage 1/4: Generating audio for ${blocks.length} blocks...`, 0);

  for (let i = 0; i < blocks.length; i++) {
    checkCancelled(jobId, docId);
    const block = blocks[i];
    const pct = Math.round((i / blocks.length) * 30);

    if (!block.narration?.trim()) {
      emit('info', `${ref(block)}: skipped (no narration)`, pct);
      continue;
    }

    // Normalize text for TTS (currency, percent, years, symbols)
    const norm = normalizeTtsText(block.narration);
    if (norm.changes.length > 0) {
      const shown = norm.changes.slice(0, 3).join(', ');
      const extra = norm.changes.length > 3 ? ` +${norm.changes.length - 3} more` : '';
      addLog(docId, 'info', 'produce', `${ref(block)} TTS normalization: ${shown}${extra}`);
    }
    const ttsText = norm.normalized;

    // Resolve per-block voice config (block overrides > group > doc > app defaults)
    const resolved = resolveBlockVoice(block.voiceConfig, docVoiceConfig, voiceGroups, { voice, rate });

    // Content hash includes engine + voice + emotion + rate + text so cache collisions are avoided
    const cacheComponents = [ttsText, resolved.engine, resolved.voiceId, resolved.emotion ?? '', resolved.rate ?? ''].join('|');
    const contentHash = crypto.createHash('sha256')
      .update(cacheComponents)
      .digest('hex')
      .slice(0, 16);

    if (block.contentHash === contentHash && block.audioPath && (block.audioDurationMs ?? 0) > 0 && fs.existsSync(path.join(audioDir, block.audioPath))) {
      emit('info', `${ref(block)}: audio loaded (${(block.audioDurationMs! / 1000).toFixed(1)}s)`, pct);
      continue;
    }

    emit('info', `${ref(block)}: generating audio (${resolved.engine})...`, pct);
    const audioFilename = `block_${docId.slice(0, 8)}_${i}_${resolved.engine}_${contentHash}.mp3`;
    const audioPath = path.join(audioDir, audioFilename);
    const wordsPath = `${audioPath}.words.json`;

    // Store mappings alongside words for subtitle alignment
    const mappingsPath = `${audioPath}.mappings.json`;

    try {
      let totalMs = 0;
      let wordCount = 0;
      let wordsJson = '[]';
      let actualEngine = resolved.engine;

      if (resolved.engine === 'omnivoice' && omnivoiceAvailable) {
        // ── OmniVoice TTS ──
        const result = await runOmnivoiceTts(ttsText, resolved, audioPath, wordsPath);
        totalMs = result.totalMs || 0;
        wordCount = result.wordCount;
        wordsJson = fs.existsSync(wordsPath) ? fs.readFileSync(wordsPath, 'utf-8') : '[]';

        addLog(docId, 'info', 'produce', `${ref(block)}: OmniVoice audio ${(totalMs / 1000).toFixed(1)}s, timing: ${result.timingMethod}`);
      } else {
        // ── edge-tts (default or fallback) ──
        if (resolved.engine === 'omnivoice' && !omnivoiceAvailable) {
          actualEngine = 'edge-tts';
          addLog(docId, 'warn', 'produce', `${ref(block)}: OmniVoice unavailable, falling back to edge-tts (voice: ${resolved.fallbackVoice || voice})`);
          emit('warn', `${ref(block)}: OmniVoice fallback → edge-tts`, pct);
        }
        if (resolved.emotion && resolved.engine === 'edge-tts') {
          addLog(docId, 'warn', 'produce', `${ref(block)}: emotion "${resolved.emotion}" ignored — edge-tts has no emotion parameter`);
        }
        const edgeVoice = resolved.engine === 'edge-tts'
          ? (resolved.voiceId || voice)
          : (resolved.fallbackVoice || voice);
        const edgeRate = resolved.rate ?? rate;
        const result = await runBlockTts(ttsText, edgeVoice, edgeRate, audioPath, wordsPath);
        totalMs = result.totalMs || 0;
        wordCount = result.wordCount;
        wordsJson = fs.existsSync(wordsPath) ? fs.readFileSync(wordsPath, 'utf-8') : '[]';

        addLog(docId, 'info', 'produce', `${ref(block)}: audio ${(totalMs / 1000).toFixed(1)}s, ${wordCount} words`);
      }

      // Persist normalization mappings for subtitle builder
      if (norm.mappings.length > 0) {
        fs.writeFileSync(mappingsPath, JSON.stringify(norm.mappings), 'utf-8');
      }

      updateBlockAudio(docId, i, {
        contentHash,
        audioPath: audioFilename,
        audioDurationMs: totalMs,
        wordsJson,
        audioEngine: actualEngine,
      });
      blocks[i] = { ...blocks[i], contentHash, audioPath: audioFilename, audioDurationMs: totalMs,
        audioEngine: actualEngine, words: JSON.parse(wordsJson), status: 'audio_ready' };

      emit('info', `${ref(blocks[i])}: audio ready (${(totalMs / 1000).toFixed(1)}s)`, pct);
    } catch (err) {
      const msg = (err as Error).message;
      updateBlockError(docId, i, msg);
      emit('warn', `${ref(block)}: TTS failed — ${msg}`, pct);
      addLog(docId, 'warn', 'produce', `${ref(block)} TTS error: ${msg}`);
    }
  }

  // Re-fetch blocks with updated audio state
  const blocksAfterAudio = listBlocks(docId);

  // ══════════════════════════════════════════
  // STAGE 2: Per-block Visuals (30–60%)
  // ══════════════════════════════════════════
  emit('info', 'Stage 2/4: Fetching visuals for each block...', 30);

  // Video-wide Pexels dedup: each clip ID may appear at most once
  const usedPexelsIds = new Set<number>();

  // Per-block candidate strips: blockIndex → array of {filename, pexelsId, duration}
  const blockCandidates = new Map<number, Array<{ filename: string; pexelsId: number; duration: number }>>();

  let lastGoodClip: string | null = null;
  let lastGoodVisualType = 'pexels';
  let aiShotCount = 0;

  const aiLongSceneMode = options.aiLongSceneMode ?? 'freeze_hold';

  // Per-block AI sub-shot clips: blockIndex → array of filenames (for multi_generate mode)
  const blockAiSubShots = new Map<number, string[]>();

  /** Generate a single AI clip (shared by FLOW blocks + auto-fallback).
   *  Returns the filename on success, null on failure. */
  async function generateSingleAiClip(
    block: ScriptBlockRecord,
    i: number,
    prompt: string,
    clipDurSec: number,
    suffix: string,
    pct: number,
  ): Promise<string | null> {
    const promptHash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
    const aiFilename = `ai_${docId.slice(0, 8)}_${i}${suffix}_${promptHash}.mp4`;
    const aiDestPath = path.join(imageDir, aiFilename);

    addLog(docId, 'info', 'produce', `${ref(block)}: FLOW prompt="${prompt.slice(0, 100)}" cacheKey=${promptHash}`);

    if (fs.existsSync(aiDestPath)) {
      emit('info', `${ref(block)}: AI clip cached (${aiFilename})`, pct);
    } else {
      emit('info', `${ref(block)}: generating AI clip (${clipDurSec}s)...`, pct);
      try {
        const ar = isPortrait ? '9:16' : '16:9';
        await generateVideoClip(prompt, ar, aiDestPath, clipDurSec);
        addLog(docId, 'info', 'produce', `${ref(block)}: AI clip generated → ${aiFilename}`);
      } catch (genErr) {
        const msg = (genErr as Error).message;
        addLog(docId, 'warn', 'produce', `${ref(block)}: FLOW generation failed — ${msg}`);
        emit('warn', `${ref(block)}: FLOW failed — ${msg}`, pct);
        return null;
      }
    }
    return aiFilename;
  }

  /** Shared AI clip generation logic (FLOW blocks + auto-fallback) */
  async function generateAiClipForBlock(
    block: ScriptBlockRecord,
    i: number,
    explicitPrompt: string | null,
    pct: number,
  ): Promise<boolean> {
    const basePrompt = (explicitPrompt && explicitPrompt !== '__auto__')
      ? explicitPrompt
      : buildFlowPrompt(block, isPortrait);

    const shots = planShots(block);
    const needsSplit = shots.length > 1 && block.visualType === 'ai';

    if (needsSplit && aiLongSceneMode === 'multi_generate') {
      // Multi-generate: one AI clip per sub-shot
      const audioDurSec = (block.audioDurationMs ?? 0) / 1000;
      addLog(docId, 'info', 'produce',
        `${ref(block)}: ${audioDurSec.toFixed(1)}s narration → needs_split (mode=multi_generate) → ${shots.length} sub-shots`);

      const subFiles: string[] = [];
      for (let si = 0; si < shots.length; si++) {
        const shotDurSec = shots[si].durationMs / 1000;
        // Build per-shot prompt: extract the narration words for this sub-shot's time range
        let shotNarration = block.narration;
        if (block.words && block.words.length > 0) {
          const shotWords = block.words.filter(w =>
            w.offset_ms >= shots[si].startMs && w.offset_ms < shots[si].endMs
          );
          if (shotWords.length > 0) shotNarration = shotWords.map(w => w.word).join(' ');
        }
        const shotPrompt = `${shotNarration} — ${basePrompt.split(' — ').slice(1).join(' — ')}`;
        const clipDur = Math.min(Math.max(Math.ceil(shotDurSec), 5), 8);
        const filename = await generateSingleAiClip(block, i, shotPrompt, clipDur, `_s${si}`, pct);
        if (filename) {
          subFiles.push(filename);
          aiShotCount++;
        } else {
          // Fallback: reuse previous sub-shot or primary
          subFiles.push(subFiles.length > 0 ? subFiles[subFiles.length - 1] : '');
        }
      }
      blockAiSubShots.set(i, subFiles);
      // Primary clip = first sub-shot
      const primary = subFiles.find(f => f) ?? null;
      if (primary) {
        updateBlockAi(docId, i, basePrompt, primary, { generatedAt: new Date().toISOString() });
        updateBlockClip(docId, i, primary, 'ai');
        blocksAfterAudio[i] = { ...block, clipAssetPath: primary, visualType: 'ai', status: 'clip_ready' };
        lastGoodClip = primary;
        lastGoodVisualType = 'ai';
      }
      return !!primary;
    }

    // Single generation (short scene or freeze_hold mode)
    const blockDurSec = Math.ceil((block.audioDurationMs ?? 6000) / 1000);
    const clipDur = Math.min(Math.max(blockDurSec, 5), 8);

    if (needsSplit) {
      const audioDurSec = (block.audioDurationMs ?? 0) / 1000;
      addLog(docId, 'info', 'produce',
        `${ref(block)}: ${audioDurSec.toFixed(1)}s narration → needs_split (mode=freeze_hold) → 1 generation + held frame`);
    }

    const filename = await generateSingleAiClip(block, i, basePrompt, clipDur, '', pct);
    if (!filename) return false;

    updateBlockAi(docId, i, basePrompt, filename, { generatedAt: new Date().toISOString() });
    updateBlockClip(docId, i, filename, 'ai');
    blocksAfterAudio[i] = { ...block, clipAssetPath: filename, visualType: 'ai', status: 'clip_ready' };
    lastGoodClip = filename;
    lastGoodVisualType = 'ai';
    aiShotCount++;
    return true;
  }

  for (let i = 0; i < blocksAfterAudio.length; i++) {
    checkCancelled(jobId, docId);
    const block = blocksAfterAudio[i];
    const pct = 30 + Math.round((i / blocksAfterAudio.length) * 30);

    // ── AI block ([FLOW:] tag) ──
    if (block.visualType === 'ai') {
      // Check if already cached (aiAssetPath file still exists)
      const cachedAiPath = block.aiAssetPath ? path.join(imageDir, block.aiAssetPath) : null;
      if (block.aiAssetPath && cachedAiPath && fs.existsSync(cachedAiPath) && block.clipAssetPath === block.aiAssetPath) {
        emit('info', `${ref(block)}: AI clip loaded`, pct);
        lastGoodClip = block.clipAssetPath!;
        lastGoodVisualType = 'ai';
        aiShotCount++;
        continue;
      }
      
      // Instead of generating AI clip, fall back to stock (Pexels) video!
      const fallbackQuery = block.pexelsQuery || block.narration.split(/\s+/).slice(0, 5).join(' ') || 'abstract';
      addLog(docId, 'info', 'produce', `${ref(block)}: AI generation skipped — falling back to stock (Pexels) video for query: "${fallbackQuery}"`);
      emit('info', `${ref(block)}: AI skipped, downloading stock fallback...`, pct);
      
      try {
        const shots = planShots(block);
        const nShots = Math.max(shots.length, 1);
        const candidates = await fetchBlockCandidates(fallbackQuery, pexelsOrientation, nShots, imageDir);
        
        if (candidates.length > 0) {
          blockCandidates.set(i, candidates);
          const primary = candidates[0];
          usedPexelsIds.add(primary.pexelsId);
          updateBlockClip(docId, i, primary.filename, 'pexels');
          blocksAfterAudio[i] = { ...block, clipAssetPath: primary.filename, visualType: 'pexels', status: 'clip_ready' };
          lastGoodClip = primary.filename;
          lastGoodVisualType = 'pexels';
          emit('info', `${ref(block)}: stock fallback downloaded`, pct);
        } else {
          emit('warn', `${ref(block)}: no stock fallback found, inheriting previous clip`, pct);
          if (lastGoodClip) {
            updateBlockClip(docId, i, lastGoodClip, lastGoodVisualType);
            blocksAfterAudio[i] = { ...block, clipAssetPath: lastGoodClip, visualType: lastGoodVisualType, status: 'clip_ready' };
          }
        }
      } catch (err) {
        emit('warn', `${ref(block)}: stock fallback failed — ${(err as Error).message}`, pct);
        if (lastGoodClip) {
          updateBlockClip(docId, i, lastGoodClip, lastGoodVisualType);
          blocksAfterAudio[i] = { ...block, clipAssetPath: lastGoodClip, visualType: lastGoodVisualType, status: 'clip_ready' };
        }
      }
      continue;
    }

    // Chart block — render chart as floating rectangle over Pexels background video
    if (block.chartSpec) {
      const audioDurSec = (block.audioDurationMs ?? 6000) / 1000;
      const chartDur = Math.max(audioDurSec, 4);
      emit('info', `${ref(block)}: rendering chart (${block.chartSpec.type})...`, pct);
      try {
        // Render chart with dark background (animation = half of audio duration)
        const animDur = audioDurSec / 2;
        const darkResult = await renderChart(block.chartSpec, orientation, accentColor, '#0d0e12', chartDur,
          (msg) => emit('info', msg, pct), animDur);
        const darkChartPath = path.join(chartDir, darkResult.filename);
        emit('info', `${ref(block)}: chart rendered → ${darkResult.filename}`, pct);

        let composited = false;

        // Try direct clipAssetPath background first
        if (block.clipAssetPath) {
          const directBgPath = path.join(imageDir, block.clipAssetPath);
          if (fs.existsSync(directBgPath)) {
            try {
              emit('info', `${ref(block)}: compositing chart rectangle over direct bg video ${block.clipAssetPath}...`, pct);
              const chartOp = (options.chartOpacity ?? 0.5).toFixed(2);
              const bgHash = crypto.createHash('sha256').update(block.clipAssetPath).digest('hex').slice(0, 8);
              const compositeFilename = `chart_comp_o${chartOp}_bg${bgHash}_${darkResult.filename}`;
              const compositePath = path.join(chartDir, compositeFilename);
              const bgScaleVf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}`;
              const chartW = Math.round(w * 0.82);
              const chartH = Math.round(h * 0.82);
              const chartX = Math.round((w - chartW) / 2);
              const chartY = Math.round((h - chartH) / 2);
              await execFileWithCancel(ffmpeg, [
                '-stream_loop', '-1', '-i', directBgPath,
                '-i', darkChartPath,
                '-filter_complex', [
                  `[0:v]${bgScaleVf},eq=brightness=-0.15:saturation=0.4[bg]`,
                  `[1:v]scale=${chartW}:${chartH}:flags=bicubic,format=rgba,colorchannelmixer=aa=${chartOp}[chart]`,
                  `[bg][chart]overlay=${chartX}:${chartY}:shortest=1:format=auto[out]`,
                ].join(';'),
                '-map', '[out]',
                '-t', String(chartDur),
                '-r', '24',
                '-c:v', 'libx264', '-preset', preset, '-crf', '23',
                '-pix_fmt', 'yuv420p',
                '-an', '-y', compositePath,
              ], { timeout: 300_000 });

              updateBlockClip(docId, i, compositeFilename, 'chart');
              blocksAfterAudio[i] = { ...block, clipAssetPath: compositeFilename, visualType: 'chart', status: 'clip_ready' };
              lastGoodClip = compositeFilename;
              lastGoodVisualType = 'chart';
              composited = true;
              emit('info', `${ref(block)}: chart composited on direct video background`, pct);
            } catch (bgErr) {
              addLog(docId, 'warn', 'produce', `${ref(block)}: chart direct bg composite failed: ${(bgErr as Error).message?.slice(0, 120)}`);
            }
          }
        }

        if (!composited) {
          // Fetch Pexels background clip — try chart title, segment name, then narration excerpt
          const bgQueries: string[] = [];
          if (block.pexelsQuery) bgQueries.push(block.pexelsQuery);
          if (block.chartSpec.title) bgQueries.push(block.chartSpec.title);
          if (block.segmentName) bgQueries.push(block.segmentName);
          if (block.narration) bgQueries.push(block.narration.split(/\s+/).slice(0, 5).join(' '));
          if (bgQueries.length === 0) bgQueries.push('abstract background');
          addLog(docId, 'info', 'produce', `${ref(block)}: chart bg queries=[${bgQueries.map(q => `"${q}"`).join(', ')}]`);
          for (const bgQuery of bgQueries) {
            if (composited) break;
            try {
              const bgCandidates = await fetchBlockCandidates(bgQuery, pexelsOrientation, 1, imageDir);
              if (bgCandidates.length > 0) {
                blockCandidates.set(i, bgCandidates);
                const bgClipPath = path.join(imageDir, bgCandidates[0].filename);
                emit('info', `${ref(block)}: compositing chart rectangle over bg video...`, pct);

                // Overlay dark-bg chart as a centered rectangle (82% size, 50% opacity) on dimmed bg video
                const chartOp = (options.chartOpacity ?? 0.5).toFixed(2);
                const bgHash = crypto.createHash('sha256').update(bgCandidates[0].filename).digest('hex').slice(0, 8);
                const compositeFilename = `chart_comp_o${chartOp}_bg${bgHash}_${darkResult.filename}`;
                const compositePath = path.join(chartDir, compositeFilename);
                const bgScaleVf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}`;
                const chartW = Math.round(w * 0.82);
                const chartH = Math.round(h * 0.82);
                const chartX = Math.round((w - chartW) / 2);
                const chartY = Math.round((h - chartH) / 2);
                await execFileWithCancel(ffmpeg, [
                  '-stream_loop', '-1', '-i', bgClipPath,
                  '-i', darkChartPath,
                  '-filter_complex', [
                    `[0:v]${bgScaleVf},eq=brightness=-0.15:saturation=0.4[bg]`,
                    `[1:v]scale=${chartW}:${chartH}:flags=bicubic,format=rgba,colorchannelmixer=aa=${chartOp}[chart]`,
                    `[bg][chart]overlay=${chartX}:${chartY}:shortest=1:format=auto[out]`,
                  ].join(';'),
                  '-map', '[out]',
                  '-t', String(chartDur),
                  '-r', '24',
                  '-c:v', 'libx264', '-preset', preset, '-crf', '23',
                  '-pix_fmt', 'yuv420p',
                  '-an', '-y', compositePath,
                ], { timeout: 300_000 });

                updateBlockClip(docId, i, compositeFilename, 'chart');
                blocksAfterAudio[i] = { ...block, clipAssetPath: compositeFilename, visualType: 'chart', status: 'clip_ready' };
                lastGoodClip = compositeFilename;
                lastGoodVisualType = 'chart';
                composited = true;
                emit('info', `${ref(block)}: chart composited on video background`, pct);
              }
            } catch (bgErr) {
              addLog(docId, 'warn', 'produce', `${ref(block)}: chart composite/bg fetch failed: ${(bgErr as Error).message?.slice(0, 120)}`);
            }
          }
        }

        // Fallback: no bg clip or composite failed → use dark-bg chart as-is
        if (!composited) {
          updateBlockClip(docId, i, darkResult.filename, 'chart');
          blocksAfterAudio[i] = { ...block, clipAssetPath: darkResult.filename, visualType: 'chart', status: 'clip_ready' };
          lastGoodClip = darkResult.filename;
          lastGoodVisualType = 'chart';
          emit('info', `${ref(block)}: chart (solid bg) → ${darkResult.filename}`, pct);
        }
      } catch (err) {
        const msg = (err as Error).message;
        updateBlockError(docId, i, `Chart render failed: ${msg}`);
        emit('warn', `${ref(block)}: chart render failed, inheriting previous clip`, pct);
        if (lastGoodClip) {
          updateBlockClip(docId, i, lastGoodClip, lastGoodVisualType);
          blocksAfterAudio[i] = { ...block, clipAssetPath: lastGoodClip, visualType: lastGoodVisualType, status: 'clip_ready' };
        }
      }
      continue;
    }

    // Skip if clip already assigned and file exists (pexels/upload — NOT chart, handled above)
    if (block.clipAssetPath && block.visualType !== 'ai' && block.visualType !== 'chart') {
      const fullPath = path.join(imageDir, block.clipAssetPath);
      if (fs.existsSync(fullPath)) {
        emit('info', `${ref(block)}: stock video loaded`, pct);
        lastGoodClip = block.clipAssetPath;
        lastGoodVisualType = block.visualType;
        continue;
      }
    }

    // Pexels block — fetch N candidates for N planned shots
    if (block.visualType === 'pexels') {
      const query = block.pexelsQuery || block.narration?.split(/\s+/).slice(0, 5).join(' ') || 'abstract';
      const shots = planShots(block);
      const nShots = Math.max(shots.length, 1);
      emit('info', `${ref(block)}: fetching ${nShots} candidate(s) for "${query}"...`, pct);
      try {
        const candidates = await fetchBlockCandidates(query, pexelsOrientation, nShots, imageDir);

        if (candidates.length > 0) {
          // Store all candidates for shot-level use in Stage 3
          blockCandidates.set(i, candidates);
          // Primary clip = first candidate; register it for dedup
          const primary = candidates[0];
          usedPexelsIds.add(primary.pexelsId);
          updateBlockClip(docId, i, primary.filename, 'pexels');
          blocksAfterAudio[i] = { ...block, clipAssetPath: primary.filename, visualType: 'pexels', status: 'clip_ready' };
          lastGoodClip = primary.filename;
          lastGoodVisualType = 'pexels';
          emit('info', `${ref(block)}: ${candidates.length} clip(s) fetched`, pct);
        } else if (options.aiFallback) {
          // AI fallback disabled when producing, default is stock / inherit
          emit('warn', `${ref(block)}: Pexels empty, inheriting previous clip`, pct);
          if (lastGoodClip) {
            updateBlockClip(docId, i, lastGoodClip, lastGoodVisualType);
            blocksAfterAudio[i] = { ...block, clipAssetPath: lastGoodClip, visualType: lastGoodVisualType, status: 'clip_ready' };
          }
        } else {
          emit('warn', `${ref(block)}: no Pexels results, inheriting previous clip`, pct);
          if (lastGoodClip) {
            updateBlockClip(docId, i, lastGoodClip, lastGoodVisualType);
            blocksAfterAudio[i] = { ...block, clipAssetPath: lastGoodClip, visualType: lastGoodVisualType, status: 'clip_ready' };
          }
        }
      } catch (err) {
        emit('warn', `${ref(block)}: Pexels error — ${(err as Error).message}`, pct);
        if (lastGoodClip) {
          updateBlockClip(docId, i, lastGoodClip, lastGoodVisualType);
          blocksAfterAudio[i] = { ...block, clipAssetPath: lastGoodClip, visualType: lastGoodVisualType, status: 'clip_ready' };
        }
      }
      continue;
    }

    // No visual tag — inherit previous
    if (lastGoodClip) {
      updateBlockClip(docId, i, lastGoodClip, lastGoodVisualType);
      blocksAfterAudio[i] = { ...block, clipAssetPath: lastGoodClip, visualType: lastGoodVisualType, status: 'clip_ready' };
      emit('info', `${ref(block)}: inheriting previous clip`, pct);
    } else {
      emit('warn', `${ref(block)}: no visual and no previous clip to inherit`, pct);
    }
  }

  const blocksAfterVisuals = listBlocks(docId);

  // AI shots summary
  if (aiShotCount > 0) {
    const totalShotBlocks = blocksAfterVisuals.filter((b) => (b.audioDurationMs ?? 0) > 0).length;
    const aiPct = totalShotBlocks > 0 ? Math.round((aiShotCount / totalShotBlocks) * 100) : 0;
    const summaryMsg = `AI shots: ${aiShotCount}/${totalShotBlocks} (${aiPct}%)`;
    const level = aiPct > 25 ? 'warn' : 'info';
    emit(level, summaryMsg + (aiPct > 25 ? ' — above 25% threshold, enable synthetic-content disclosure on upload' : ''), 60);
    addLog(docId, level, 'produce', summaryMsg);
  }

  // ══════════════════════════════════════════
  // STAGE 3: Per-block video clip encoding (60–85%)
  // ══════════════════════════════════════════
  emit('info', 'Stage 3/4: Encoding per-block clips...', 60);

  const docDir = path.join(outputDir, `doc_${docId}`);
  fs.mkdirSync(docDir, { recursive: true });

  const concatId = crypto.randomUUID().slice(0, 8);
  const concatDir = path.join(docDir, `tmp_concat_${concatId}`);
  fs.mkdirSync(concatDir, { recursive: true });

  const fps = 24;
  // Fallback vf (chart / static / no-motion)
  const staticVf = `scale=w=${w}:h=${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h},format=yuv420p`;

  // Video-wide shot-to-clip dedup state (persists across blocks)
  const usedClipIdsForShots = new Set<number>(usedPexelsIds);

  let encodedCount = 0;
  for (let i = 0; i < blocksAfterVisuals.length; i++) {
    checkCancelled(jobId, docId);
    const block = blocksAfterVisuals[i];
    const pct = 60 + Math.round((i / blocksAfterVisuals.length) * 25);

    if (!block.audioPath || !(block.audioDurationMs! > 0)) {
      emit('warn', `${ref(block)}: no audio — skipping clip`, pct);
      continue;
    }

    const visualHash = crypto.createHash('sha256')
      .update([
        block.clipAssetPath ?? '',
        block.clipStartSec ?? 0,
        block.clipEndSec ?? 0,
        block.motion ?? '',
        block.visualType ?? '',
        block.narration ?? '',
        orientation,
        block.clipsJson ?? '',
        options.chartOpacity ?? 0.5,
        accentColor
      ].join('|'))
      .digest('hex')
      .slice(0, 16);

    const contentHash = block.contentHash ?? 'static';
    const persistentPath = path.join(docDir, `block_${i}_${contentHash}_${visualHash}.mp4`);

    // Check if already rendered and file exists (skip cache for chart blocks — always re-composite)
    if (block.visualType !== 'chart' && fs.existsSync(persistentPath)) {
      emit('info', `${ref(block)}: block video loaded`, pct);
      if (block.renderedClipPath !== persistentPath) {
        updateBlockRendered(docId, i, persistentPath);
      }
      blocksAfterVisuals[i] = { ...block, renderedClipPath: persistentPath, status: 'rendered' };
      encodedCount++;
      continue;
    }

    // Handle block with no clip (explicitly removed) or inherit fallback with no clip
    if (!block.clipAssetPath) {
      emit('info', `${ref(block)}: no clip assigned — rendering blank screen...`, pct);
      const audioDurSec = (block.audioDurationMs ?? 6000) / 1000;
      try {
        await execFileWithCancel(ffmpeg, [
          '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=24`,
          '-t', audioDurSec.toFixed(3),
          '-pix_fmt', 'yuv420p',
          '-y', persistentPath
        ], { timeout: 60_000 });

        updateBlockRendered(docId, i, persistentPath);
        blocksAfterVisuals[i] = { ...block, renderedClipPath: persistentPath, status: 'rendered' };
        encodedCount++;
      } catch (err) {
        const msg = (err as Error).message.slice(0, 200);
        emit('warn', `${ref(block)}: blank screen render failed — ${msg}`, pct);
      }
      continue;
    }

    // Resolve source clip path
    const resolveClipPath = (filename: string, vtype: string): string | null => {
      const dirs = vtype === 'chart' ? [chartDir, imageDir] : [imageDir, chartDir];
      for (const d of dirs) {
        const p = path.join(d, filename);
        if (fs.existsSync(p)) return p;
      }
      return null;
    };

    // Plan shots for this block
    const shots = planShots(block);
    const shotLog = shots.map((s) => `${(s.durationMs / 1000).toFixed(1)}s${s.hasOverlay ? '(overlay)' : ''}`).join(', ');
    emit('info', `${ref(block)}: ${shots.length} shot(s) [${shotLog}]`, pct);
    addLog(docId, 'info', 'produce', `${ref(block)}: ${((block.audioDurationMs ?? 0) / 1000).toFixed(1)}s audio → ${shots.length} shots [${shotLog}]`);

    // Gather candidate clips for this block (multi-shot sourcing)
    const candidates = blockCandidates.get(i) ?? [];
    const primaryClipPath = resolveClipPath(block.clipAssetPath, block.visualType);

    // Chart blocks: already composited in Stage 2 — just re-encode to segment format
    if (block.visualType === 'chart' && primaryClipPath) {
      try {
        const shotDurSec = (block.audioDurationMs ?? 6000) / 1000;
        const scaleVf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}`;
        addLog(docId, 'info', 'produce', `${ref(block)}: encoding chart clip ${path.basename(primaryClipPath)}`);
        await execFileWithCancel(ffmpeg, [
          '-i', primaryClipPath,
          '-vf', `${scaleVf},format=yuv420p`,
          '-t', shotDurSec.toFixed(3),
          '-r', String(fps),
          '-c:v', 'libx264', '-preset', preset, '-crf', '23',
          '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000',
          '-an', '-y', persistentPath,
        ], { timeout: 180_000 });
        updateBlockRendered(docId, i, persistentPath);
        blocksAfterVisuals[i] = { ...block, renderedClipPath: persistentPath, status: 'rendered' };
        encodedCount++;
        emit('info', `${ref(block)}: chart clip encoded`, pct);
      } catch (err) {
        const msg = (err as Error).message.slice(0, 200);
        emit('warn', `${ref(block)}: chart encode failed — ${msg}`, pct);
        updateBlockError(docId, i, `Chart encode failed: ${msg}`);
      }
      continue;
    }

    const shotPaths: string[] = [];
    let shotsFailed = 0;

    // AI sub-shot clips (multi_generate mode)
    const aiSubShots = blockAiSubShots.get(i);
    const isAiBlock = block.visualType === 'ai';

    for (let si = 0; si < shots.length; si++) {
      const shot = shots[si];
      const shotDurSec = shot.durationMs / 1000;
      const shotOut = path.join(concatDir, `block_${String(i).padStart(4, '0')}_shot_${si}.mp4`);

      // Pick a clip for this shot
      let chosenClipPath: string | null = null;
      let chosenPexelsId: number | null = null;
      let trimOffsetSec = 0;
      let freezeHold = false; // true = hold last frame for this sub-shot (AI freeze_hold mode)

      if (block.visualType === 'chart') {
        chosenClipPath = primaryClipPath;
      } else if (isAiBlock && shots.length > 1) {
        // AI block with sub-shots
        if (aiSubShots && aiSubShots[si]) {
          // multi_generate: each sub-shot has its own AI clip
          chosenClipPath = resolveClipPath(aiSubShots[si], 'ai');
          addLog(docId, 'info', 'produce', `${ref(block)} shot ${si + 1}: AI multi-gen clip (${aiSubShots[si]})`);
        } else if (si === 0) {
          // First shot always uses the primary AI clip
          chosenClipPath = primaryClipPath;
        } else {
          // freeze_hold: subsequent sub-shots hold last frame of primary
          chosenClipPath = primaryClipPath;
          freezeHold = true;
          addLog(docId, 'info', 'produce', `${ref(block)} shot ${si + 1}: held frame (${shotDurSec.toFixed(1)}s)`);
        }
      } else if (isAiBlock) {
        // AI block, single shot — use primary clip directly
        chosenClipPath = primaryClipPath;
      } else {
        // Pexels / stock: pick from candidates with dedup
        if (candidates.length > 0) {
          for (let ci = si; ci < candidates.length + si; ci++) {
            const cand = candidates[ci % candidates.length];
            if (!usedClipIdsForShots.has(cand.pexelsId) || ci === si) {
              const p = resolveClipPath(cand.filename, 'pexels');
              if (p) {
                chosenClipPath = p;
                chosenPexelsId = cand.pexelsId;

                // If user set a specific clip start time AND this is the primary clip, use it;
                // otherwise auto-vary by hash. For multi-shot on same clip, advance offset per shot.
                if (block.clipStartSec != null && cand.filename === block.clipAssetPath) {
                  trimOffsetSec = block.clipStartSec + (si > 0 ? shots.slice(0, si).reduce((s, sh) => s + sh.durationMs / 1000, 0) : 0);
                } else {
                  const offsetHash = crypto.createHash('sha256')
                    .update(`${i}-${si}-${cand.pexelsId}`)
                    .digest('hex');
                  const maxOffset = Math.max(0, (cand.duration - shotDurSec - 1));
                  trimOffsetSec = maxOffset > 0
                    ? (parseInt(offsetHash.slice(0, 4), 16) / 0xffff) * maxOffset
                    : 0;
                  trimOffsetSec = Math.floor(trimOffsetSec * 10) / 10;
                }

                if (usedClipIdsForShots.has(cand.pexelsId) && ci > si) {
                  addLog(docId, 'info', 'produce', `${ref(block)} shot ${si + 1}: reuse with distinct trim (id=${cand.pexelsId}, offset=${trimOffsetSec.toFixed(1)}s)`);
                }
                break;
              }
            }
          }
        }
        // Fallback: no candidates (cached clip from Stage 2) — use primary clip with user trim
        if (!chosenClipPath && primaryClipPath) {
          chosenClipPath = primaryClipPath;
          if (block.clipStartSec != null) {
            trimOffsetSec = block.clipStartSec + (si > 0 ? shots.slice(0, si).reduce((s, sh) => s + sh.durationMs / 1000, 0) : 0);
          }
        }
      }

      if (!chosenClipPath) {
        emit('warn', `${ref(block)} shot ${si + 1}: no clip found, skipping`, pct);
        shotsFailed++;
        continue;
      }

      if (chosenPexelsId !== null) usedClipIdsForShots.add(chosenPexelsId);

      // Build vf with motion effect
      const motionVf = shot.motion === 'static' || block.visualType === 'chart'
        ? staticVf
        : buildMotionFilter(shot.motion, w, h, fps) + ',format=yuv420p';

      try {
        if (freezeHold) {
          // Extract the last frame of the source clip, hold it as a static shot
          // Step 1: extract last frame
          const lastFramePath = path.join(concatDir, `block_${String(i).padStart(4, '0')}_lastframe.png`);
          if (!fs.existsSync(lastFramePath)) {
            await execFileAsync(ffmpeg, [
              '-sseof', '-0.1', '-i', chosenClipPath,
              '-vframes', '1', '-y', lastFramePath,
            ], { timeout: 30_000 });
          }
          // Step 2: generate static video from the last frame
          await execFileWithCancel(ffmpeg, [
            '-loop', '1', '-i', lastFramePath,
            '-vf', staticVf,
            '-t', shotDurSec.toFixed(3),
            '-r', String(fps),
            '-c:v', 'libx264', '-preset', preset, '-crf', '23',
            '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000',
            '-an', '-y', shotOut,
          ], { timeout: 120_000 });
          shotPaths.push(shotOut);
        } else {
          // Normal encode: trim source clip with motion filter
          // Only apply clipEndSec limit for single-shot blocks or first shot with user trim
          const clipReadDurSec = (block.clipEndSec != null && si === 0 && shots.length === 1)
            ? Math.max(0.1, block.clipEndSec - trimOffsetSec)
            : undefined;

          const ffArgs = [
            '-ss', trimOffsetSec.toFixed(3),
            ...(clipReadDurSec != null ? ['-t', clipReadDurSec.toFixed(3)] : []),
            '-i', chosenClipPath,
            '-vf', motionVf,
            '-t', shotDurSec.toFixed(3),
            '-r', String(fps),
            '-c:v', 'libx264',
            '-preset', preset,
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-video_track_timescale', '90000',
            '-an',
            '-y',
            shotOut,
          ];
          await execFileWithCancel(ffmpeg, ffArgs, { timeout: 180_000 });

          // Verify output duration; if source was too short, pad with last frame
          try {
            const probeRes = await execFileWithCancel(ffprobe, [
              '-v', 'error', '-show_entries', 'format=duration',
              '-of', 'json', shotOut,
            ], { timeout: 15_000 });
            const probeDur = parseFloat(JSON.parse(probeRes.stdout.toString()).format?.duration ?? '0');
            if (probeDur > 0 && probeDur < shotDurSec - 0.15) {
              const paddedOut = shotOut.replace(/\.mp4$/, '_pad.mp4');
              const gap = shotDurSec - probeDur;
              // Extract last frame, generate filler, concat
              const lastFr = shotOut.replace(/\.mp4$/, '_lf.png');
              await execFileWithCancel(ffmpeg, ['-sseof', '-0.1', '-i', shotOut, '-vframes', '1', '-y', lastFr], { timeout: 15_000 });
              const fillerPath = shotOut.replace(/\.mp4$/, '_fill.mp4');
              await execFileWithCancel(ffmpeg, [
                '-loop', '1', '-i', lastFr, '-vf', staticVf,
                '-t', gap.toFixed(3), '-r', String(fps),
                '-c:v', 'libx264', '-preset', preset, '-crf', '23',
                '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000',
                '-an', '-y', fillerPath,
              ], { timeout: 30_000 });
              const padList = shotOut.replace(/\.mp4$/, '_padlist.txt');
              fs.writeFileSync(padList, `file '${shotOut.replace(/\\/g, '/')}'\nfile '${fillerPath.replace(/\\/g, '/')}'`);
              await execFileWithCancel(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', padList, '-c', 'copy', '-y', paddedOut], { timeout: 30_000 });
              fs.renameSync(paddedOut, shotOut);
              try { fs.unlinkSync(lastFr); fs.unlinkSync(fillerPath); fs.unlinkSync(padList); } catch { /* cleanup */ }
              addLog(docId, 'info', 'produce', `${ref(block)} shot ${si + 1}: padded ${probeDur.toFixed(1)}s → ${shotDurSec.toFixed(1)}s`);
            }
          } catch { /* probe/pad failed — use clip as-is */ }

          shotPaths.push(shotOut);
        }
      } catch (err) {
        const msg = (err as Error).message.slice(0, 200);
        emit('warn', `${ref(block)} shot ${si + 1}: encode failed — ${msg}`, pct);
        shotsFailed++;
      }
    }

    if (shotPaths.length === 0) {
      emit('warn', `${ref(block)}: all shots failed`, pct);
      updateBlockError(docId, i, 'All shots failed to encode');
      continue;
    }

    // Concat shot clips into a single block clip (straight cuts, no transitions)
    if (shotPaths.length === 1) {
      fs.renameSync(shotPaths[0], persistentPath);
    } else {
      const shotList = path.join(concatDir, `block_${String(i).padStart(4, '0')}_shots.txt`);
      fs.writeFileSync(shotList, shotPaths.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
      await execFileWithCancel(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', shotList, '-c', 'copy', '-y', persistentPath], { timeout: 120_000 });
      // Clean up individual shot files
      for (const sp of shotPaths) { try { fs.unlinkSync(sp); } catch { /* ignore */ } }
    }

    updateBlockRendered(docId, i, persistentPath);
    blocksAfterVisuals[i] = { ...block, renderedClipPath: persistentPath, status: 'rendered' };
    encodedCount++;
    if (shotsFailed > 0) {
      emit('info', `${ref(block)}: encoded (${shots.length - shotsFailed}/${shots.length} shots)`, pct);
    } else {
      emit('info', `${ref(block)}: encoded (${shots.length} shot${shots.length > 1 ? 's' : ''})`, pct);
    }
  }

  if (!encodedCount) throw new Error('No blocks were encoded successfully');

  // ══════════════════════════════════════════
  // STAGE 4: Final assembly (85–100%)
  // ══════════════════════════════════════════
  emit('info', 'Stage 4/4: Assembling final video...', 85);

  const finalBlocks = listBlocks(docId);

  // Gather rendered clips in order
  const renderedClips = finalBlocks
    .map((b) => b.renderedClipPath)
    .filter((p): p is string => !!p && fs.existsSync(p));

  if (!renderedClips.length) throw new Error('No rendered clips found');

  // Concat video clips
  const concatList = path.join(concatDir, 'list.txt');
  fs.writeFileSync(concatList, renderedClips.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  const videoOnly = path.join(concatDir, 'video_only.mp4');
  await execFileWithCancel(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-y', videoOnly], { timeout: 300_000 });
  emit('info', `Concatenated ${renderedClips.length} clips`, 88);

  // Burn subtitles
  let videoInput = videoOnly;
  if (enableSubtitles) {
    emit('info', 'Burning subtitles...', 90);
    const subtitleData = finalBlocks.map((b) => ({
      words: b.words,
      audioDurationMs: b.audioDurationMs,
      narration: b.narration,
      audioPath: b.audioPath,
    }));
    const assContent = buildAssSubtitles(subtitleData, w, h, isPortrait, audioDir, options.subtitleStyle);
    const assPath = path.join(concatDir, 'subtitles.ass');
    fs.writeFileSync(assPath, assContent, 'utf-8');

    const subtitledVideo = path.join(concatDir, 'video_subtitled.mp4');
    const relAssPath = path.relative(process.cwd(), assPath);
    const escapedAssPath = relAssPath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "'\\''");
    try {
      await execFileWithCancel(ffmpeg, [
        '-i', videoOnly, '-vf', `ass='${escapedAssPath}'`,
        '-c:v', 'libx264', '-preset', preset, '-crf', '23', '-pix_fmt', 'yuv420p', '-an', '-y', subtitledVideo,
      ], { timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });
      videoInput = subtitledVideo;
      emit('info', 'Subtitles burned', 93);
    } catch (subErr) {
      emit('warn', `Subtitle burn-in skipped: ${(subErr as Error).message?.slice(0, 100)}`, 93);
    }
  }

  // Build master audio from per-block audio files
  emit('info', 'Building master audio track...', 94);
  const audioBlocks = finalBlocks.filter((b) => b.audioPath && b.audioDurationMs);
  if (!audioBlocks.length) throw new Error('No audio blocks found');

  const audioList = path.join(concatDir, 'audio_list.txt');
  const audioFiles = audioBlocks.map((b) => path.join(audioDir, b.audioPath!));
  fs.writeFileSync(audioList, audioFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  const masterAudio = path.join(concatDir, 'master_audio.mp3');
  await execFileWithCancel(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', audioList, '-c', 'copy', '-y', masterAudio], { timeout: 300_000 });

  const totalAudioMs = audioBlocks.reduce((s, b) => s + (b.audioDurationMs ?? 0), 0);
  const totalDurationSec = totalAudioMs / 1000;

  // Mux final video + audio (+ optional background music)
  emit('info', 'Muxing final video...', 96);
  const safeName = doc.title.replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_').substring(0, 100);
  const outputFile = path.join(outputDir, `${safeName}_${concatId}.mp4`);

  const musicEnabled = options.music?.enabled && options.music?.trackId;
  let musicPath: string | null = null;
  if (musicEnabled) {
    const musicCacheDir = path.resolve(cacheDir, 'music');
    const candidatePath = path.join(musicCacheDir, path.basename(options.music!.trackId!));
    if (fs.existsSync(candidatePath)) musicPath = candidatePath;
  }

  if (musicPath) {
    const musicVolDb = options.music?.volumeDb ?? -21;
    const musicVol = Math.pow(10, musicVolDb / 20);
    const mixParts = [
      `[1:a]volume=1.0[voice]`,
      `[2:a]atrim=0:${totalDurationSec},volume=${musicVol.toFixed(3)}[music]`,
      `[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
    ];
    await execFileWithCancel(ffmpeg, [
      '-i', videoInput, '-i', masterAudio, '-stream_loop', '-1', '-i', musicPath,
      '-filter_complex', mixParts.join(';'),
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart', '-y', outputFile,
    ], { timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });
  } else {
    await execFileWithCancel(ffmpeg, [
      '-i', videoInput, '-i', masterAudio,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart', '-y', outputFile,
    ], { timeout: 300_000 });
  }

  // Speed rate: re-encode with faster playback if speedRate > 1
  const speedRate = options.speedRate ?? 1;
  let finalOutput = outputFile;
  let finalDurationSec = totalDurationSec;

  if (speedRate > 1) {
    emit('info', `Applying ${speedRate}x speed...`, 98);
    const spedUpFile = outputFile.replace(/\.mp4$/, `_${speedRate}x.mp4`);

    // Video: setpts=PTS/N makes it N times faster
    // Audio: chain atempo filters (each max 2.0x) to reach target speed
    const atempoFilters: string[] = [];
    let remaining = speedRate;
    while (remaining > 2.0) {
      atempoFilters.push('atempo=2.0');
      remaining /= 2.0;
    }
    atempoFilters.push(`atempo=${remaining.toFixed(4)}`);

    await execFileWithCancel(ffmpeg, [
      '-i', outputFile,
      '-vf', `setpts=PTS/${speedRate}`,
      '-af', atempoFilters.join(','),
      '-c:v', 'libx264', '-preset', preset, '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-y', spedUpFile,
    ], { timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

    // Replace original with sped-up version
    try { fs.unlinkSync(outputFile); } catch { /* ignore */ }
    finalOutput = spedUpFile;
    finalDurationSec = totalDurationSec / speedRate;
    emit('info', `Speed ${speedRate}x applied → ${finalDurationSec.toFixed(1)}s`, 99);
  }

  // Clean up temp dir
  try { fs.rmSync(concatDir, { recursive: true, force: true }); } catch { /* ignore */ }

  const stat = fs.statSync(finalOutput);
  const resultFilename = path.basename(finalOutput);
  const resultSizeKB = Math.round(stat.size / 1024);

  setDocStatus(docId, 'ready');
  addLog(docId, 'success', 'status_change', `Video produced: ${resultFilename} (${(resultSizeKB / 1024).toFixed(1)} MB, ${finalDurationSec.toFixed(1)}s)`);
  emit('success', `Video complete: ${resultFilename} — ${(resultSizeKB / 1024).toFixed(1)} MB, ${finalDurationSec.toFixed(1)}s`, 100);

  return {
    resultFilename,
    resultUrl: `/api/storyboard/video/${resultFilename}`,
    resultSizeKB,
    duration: finalDurationSec,
    aiShotCount,
  };
}
