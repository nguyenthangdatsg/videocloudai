import * as path from 'path';
import * as fs from 'fs';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { getSettings } from './settings.service';

const execFileAsync = promisify(execFile);

// Probe a binary to confirm it's runnable
async function isRunnable(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Walk up from this file to find node_modules/@remotion/compositor-*/ffmpeg(.exe)?
export function findBundledRemotionBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binName = `${name}${ext}`;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'node_modules', '@remotion');
    if (fs.existsSync(candidate)) {
      try {
        const subdirs = fs.readdirSync(candidate);
        for (const sub of subdirs) {
          if (sub.startsWith('compositor-')) {
            const found = path.join(candidate, sub, binName);
            if (fs.existsSync(found)) return found;
          }
        }
      } catch {
        // ignore
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let resolvedFfmpeg: string | null = null;
let resolvedFfprobe: string | null = null;

// Sync resolver — does NOT spawn the binary, only checks file existence. Use this when
// you need an ffmpeg path during synchronous initialization (e.g., constructing a
// VideoAssembler). Returns the user-configured path if it points to a real file,
// then falls back to the bundled Remotion binary, then to the literal name (which will
// rely on PATH if it's there).
export function resolveFfmpegPathSync(name: 'ffmpeg' | 'ffprobe'): string {
  const settingsValue =
    name === 'ffmpeg'
      ? getSettings().get('ffmpeg_path') || process.env.FFMPEG_PATH || ''
      : getSettings().get('ffprobe_path') || process.env.FFPROBE_PATH || '';

  // If user supplied an absolute (or relative) path that exists on disk, trust it
  if (settingsValue && settingsValue !== name && fs.existsSync(settingsValue)) {
    return settingsValue;
  }

  // Otherwise, prefer the bundled Remotion binary (always present in our node_modules)
  const bundled = findBundledRemotionBinary(name);
  if (bundled) {
    console.log(`[ffmpeg] Using bundled Remotion ${name}: ${bundled}`);
    return bundled;
  }

  // Last resort: hope it's on PATH. Runtime errors will surface cleanly via ENOENT.
  return settingsValue || name;
}

async function resolveBinary(name: 'ffmpeg' | 'ffprobe', settingsValue: string): Promise<string> {
  // Order: user-configured → env → PATH ('ffmpeg') → bundled Remotion
  const candidates = [
    settingsValue,
    name === 'ffmpeg' ? (process.env.FFMPEG_PATH || '') : (process.env.FFPROBE_PATH || ''),
    name,
  ].filter(Boolean);

  for (const c of candidates) {
    if (await isRunnable(c)) return c;
  }
  const bundled = findBundledRemotionBinary(name);
  if (bundled && await isRunnable(bundled)) {
    console.log(`[import] Using bundled Remotion ${name}: ${bundled}`);
    return bundled;
  }
  // Nothing works — return the user value so the eventual error is meaningful
  return settingsValue || name;
}

async function getFfmpegBinary(): Promise<string> {
  if (resolvedFfmpeg) return resolvedFfmpeg;
  const s = getSettings().get('ffmpeg_path') || '';
  resolvedFfmpeg = await resolveBinary('ffmpeg', s);
  return resolvedFfmpeg;
}

// Returns a full-featured FFmpeg that supports crop/overlay/blur filters.
// Tries: user-configured → FFMPEG_PATH env → PATH → ffmpeg-static bundled.
// Never falls back to the Remotion binary (built with --disable-filters).
let resolvedFullFfmpeg: string | null = null;
async function getFullFfmpegBinary(): Promise<string> {
  if (resolvedFullFfmpeg) return resolvedFullFfmpeg;
  const configured = getSettings().get('ffmpeg_path') || process.env.FFMPEG_PATH || '';
  const candidates = [configured, 'ffmpeg'].filter(Boolean);
  for (const c of candidates) {
    if (await isRunnable(c)) { resolvedFullFfmpeg = c; return c; }
  }
  // Fall back to ffmpeg-static which ships a full-featured build
  try {
    const staticBin: string = require('ffmpeg-static');
    if (staticBin && fs.existsSync(staticBin) && await isRunnable(staticBin)) {
      console.log(`[ffmpeg] Using ffmpeg-static for filter operations: ${staticBin}`);
      resolvedFullFfmpeg = staticBin;
      return staticBin;
    }
  } catch { /* ffmpeg-static not installed */ }
  throw new Error('No full-featured FFmpeg found. Install ffmpeg and set FFMPEG_PATH in .env, or run: npm install ffmpeg-static --workspace=apps/server');
}

async function getFfprobeBinary(): Promise<string> {
  if (resolvedFfprobe) return resolvedFfprobe;
  // Settings only has ffmpeg_path — derive ffprobe from same dir if possible
  const ff = await getFfmpegBinary();
  if (ff && ff !== 'ffmpeg' && fs.existsSync(ff)) {
    const dir = path.dirname(ff);
    const candidate = path.join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(candidate) && await isRunnable(candidate)) {
      resolvedFfprobe = candidate;
      return candidate;
    }
  }
  resolvedFfprobe = await resolveBinary('ffprobe', '');
  return resolvedFfprobe;
}

export interface ImportResult {
  filePath: string;
  title: string;
  duration: number;
  description?: string;
  sourceUrl?: string;
  author?: string;
  authorUrl?: string;
}

function getYtDlpPath(): string {
  return getSettings().get('yt_dlp_path') || 'yt-dlp';
}

export function isSupportedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');
    return (
      host === 'tiktok.com' ||
      host === 'instagram.com' ||
      host === 'youtube.com' ||
      host === 'youtu.be' ||
      host === 'twitter.com' ||
      host === 'x.com' ||
      host === 'facebook.com' ||
      host === 'fb.watch'
    );
  } catch {
    return false;
  }
}

export interface ProbeInfo {
  videoCodec?: string;
  audioCodec?: string;
  pixFmt?: string;
  hasAudio: boolean;
  hasVideo: boolean;
  duration: number;
  width?: number;
  height?: number;
}

export async function probeFile(filePath: string): Promise<ProbeInfo> {
  try {
    const bin = await getFfprobeBinary();
    const { stdout } = await execFileAsync(
      bin,
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        filePath,
      ],
      { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const data = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string; pix_fmt?: string; duration?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const v = data.streams?.find((s) => s.codec_type === 'video');
    const a = data.streams?.find((s) => s.codec_type === 'audio');
    const rawDur = v?.duration ?? a?.duration ?? data.format?.duration;
    return {
      videoCodec: v?.codec_name,
      audioCodec: a?.codec_name,
      pixFmt: v?.pix_fmt,
      hasAudio: !!a,
      hasVideo: !!v,
      duration: rawDur ? parseFloat(rawDur) : 0,
      width: v?.width,
      height: v?.height,
    };
  } catch (err) {
    console.warn('[import] ffprobe failed, assuming transcode needed:', err);
    return { hasAudio: false, hasVideo: true, duration: 0 };
  }
}

export async function transcodeToBrowserSafe(
  input: string,
  output: string,
  options: { hasAudio?: boolean } = {}
): Promise<void> {
  // Re-encode video to H.264 Main yuv420p with faststart for browser-friendly streaming.
  // If hasAudio not supplied, probe the input so we don't pass audio encode args to a
  // video-only file (which makes ffmpeg fail with "Output file does not contain any stream").
  let hasAudio = options.hasAudio;
  if (hasAudio === undefined) {
    const probed = await probeFile(input);
    hasAudio = probed.hasAudio;
  }

  const audioArgs = hasAudio
    ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100']
    : ['-an'];

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    '-map', '0:v:0',
    ...(hasAudio ? ['-map', '0:a:0?'] : []),
    '-c:v', 'libx264',
    '-profile:v', 'main',
    '-level', '4.0',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    ...audioArgs,
    output,
  ];

  const bin = await getFfmpegBinary();
  try {
    await execFileAsync(bin, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // execFile errors swallow ffmpeg's stderr into err.stderr — surface it for easier debugging
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const message = `ffmpeg transcode failed: ${(err as Error).message}${stderr ? ` | ${stderr.trim().slice(-500)}` : ''}`;
    throw new Error(message);
  }
}

export async function remuxFaststart(input: string, output: string): Promise<void> {
  // Pure stream copy — just moves moov atom to the front so the browser can start playback
  // before the entire file is downloaded.
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', input,
    '-c', 'copy',
    '-movflags', '+faststart',
    output,
  ];
  const bin = await getFfmpegBinary();
  try {
    await execFileAsync(bin, args, { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const message = `ffmpeg remux failed: ${(err as Error).message}${stderr ? ` | ${stderr.trim().slice(-500)}` : ''}`;
    throw new Error(message);
  }
}

// Frame transforms supported by the bundled Remotion FFmpeg (rotate, hflip, crop are available;
// zoompan / vflip are not, so vflip is simulated via hflip + 180° rotation).
export interface FrameTransformOptions {
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  crop: { x: number; y: number; width: number; height: number } | null;
}

export function isNonDefaultTransform(t: FrameTransformOptions): boolean {
  return t.rotation !== 0 || t.flipH || t.flipV || t.crop !== null;
}

function buildTransformFilter(t: FrameTransformOptions): string | null {
  const parts: string[] = [];

  if (t.crop) {
    const { x, y, width, height } = t.crop;
    parts.push(
      `crop=iw*${width.toFixed(6)}:ih*${height.toFixed(6)}:iw*${x.toFixed(6)}:ih*${y.toFixed(6)}`
    );
  }

  // Apply flips before rotation so rotation is relative to the final viewing orientation.
  if (t.flipH) parts.push('hflip');
  if (t.flipV) parts.push('vflip'); // vflip is available in the bundled Remotion FFmpeg

  if (t.rotation === 90) {
    parts.push('rotate=PI/2:ow=ih:oh=iw');
  } else if (t.rotation === 180) {
    parts.push('rotate=PI:ow=iw:oh=ih');
  } else if (t.rotation === 270) {
    parts.push('rotate=-PI/2:ow=ih:oh=iw');
  }

  return parts.length > 0 ? parts.join(',') : null;
}

export async function applyFrameTransforms(
  input: string,
  output: string,
  transform: FrameTransformOptions
): Promise<void> {
  const filterStr = buildTransformFilter(transform);
  if (!filterStr) return; // identity — nothing to do

  const bin = await getFfmpegBinary();
  const probed = await probeFile(input);
  const audioArgs = probed.hasAudio
    ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100']
    : ['-an'];

  const args = [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-i', input,
    '-vf', filterStr,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    ...audioArgs,
    output,
  ];

  console.log(`[applyFrameTransforms] filter="${filterStr}" → ${path.basename(output)}`);
  try {
    await execFileAsync(bin, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    console.log(`[applyFrameTransforms] done: ${path.basename(output)}`);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(`ffmpeg frame transform failed: ${(err as Error).message}${stderr ? ` | ${stderr.trim().slice(-400)}` : ''}`);
  }
}

export interface MusicMixOptions {
  musicPath?: string;      // absolute path to music file; undefined = no new music
  musicVolume?: number;    // 0–1, default 0.2
  muteOriginal?: boolean;  // strip original audio track
}

export async function applyMusicMix(
  input: string,
  output: string,
  opts: MusicMixOptions
): Promise<void> {
  const { musicPath, musicVolume = 0.2, muteOriginal = false } = opts;
  const hasMusic = !!(musicPath && fs.existsSync(musicPath));
  console.log(`[applyMusicMix] musicPath=${musicPath} exists=${musicPath ? fs.existsSync(musicPath) : false} hasMusic=${hasMusic} muteOriginal=${muteOriginal}`);

  // No-op: keep original audio, add nothing
  if (!muteOriginal && !hasMusic) {
    console.log('[applyMusicMix] no-op: nothing to do');
    return;
  }

  const bin = await getFfmpegBinary();
  const probed = await probeFile(input);
  const dur = probed.duration > 0 ? probed.duration : 30;

  // Probe music duration to decide loop vs trim
  let musicDur = 0;
  if (hasMusic) {
    const musicProbed = await probeFile(musicPath!);
    musicDur = musicProbed.duration > 0 ? musicProbed.duration : 0;
  }
  const needsLoop = hasMusic && musicDur > 0 && musicDur < dur;

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'warning', '-i', input];

  if (hasMusic) {
    // Only loop if music is shorter than video; otherwise just trim
    if (needsLoop) args.push('-stream_loop', '-1');
    args.push('-i', musicPath!);
  }

  const filterParts: string[] = [];
  let audioMapArg: string;

  if (hasMusic && (muteOriginal || !probed.hasAudio)) {
    // Replace audio entirely with music, trimmed to video duration
    filterParts.push(`[1:a]volume=${musicVolume},atrim=0:${dur},asetpts=PTS-STARTPTS[aout]`);
    audioMapArg = '[aout]';
  } else if (hasMusic && probed.hasAudio) {
    // Mix original audio + music, both capped to video duration
    filterParts.push(`[0:a]atrim=0:${dur},asetpts=PTS-STARTPTS,volume=1.0[orig]`);
    filterParts.push(`[1:a]volume=${musicVolume},atrim=0:${dur},asetpts=PTS-STARTPTS[mus]`);
    filterParts.push(`[orig][mus]amix=inputs=2:duration=first[aout]`);
    audioMapArg = '[aout]';
  } else {
    // muteOriginal=true, no music — strip audio
    audioMapArg = '';
  }

  if (filterParts.length > 0) {
    args.push('-filter_complex', filterParts.join(';'));
  }

  args.push('-map', '0:v');
  if (audioMapArg) {
    args.push('-map', audioMapArg);
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100');
  } else {
    args.push('-an');
  }
  // -t caps output to exact video duration — prevents music from extending the file
  args.push('-c:v', 'copy', '-movflags', '+faststart', '-t', String(dur), output);

  console.log(`[applyMusicMix] muteOrig=${muteOriginal} hasMusic=${hasMusic} dur=${dur.toFixed(1)}s → ${path.basename(output)}`);
  try {
    await execFileAsync(bin, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    console.log(`[applyMusicMix] done: ${path.basename(output)}`);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(`ffmpeg music mix failed: ${(err as Error).message}${stderr ? ` | ${stderr.trim().slice(-400)}` : ''}`);
  }
}

export interface BlurRegionInput {
  x: number; y: number; width: number; height: number; strength: number;
  type: 'blur' | 'pixelate';
}

export async function applyBlurRegions(
  input: string,
  output: string,
  regions: BlurRegionInput[],
  videoWidth: number,
  videoHeight: number
): Promise<void> {
  if (regions.length === 0) return;

  // Build a chained filter: for each region, split → crop+effect → overlay
  const parts: string[] = [];
  let prevOut = '0:v';
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const x = Math.max(0, Math.round((r.x / 100) * videoWidth));
    const y = Math.max(0, Math.round((r.y / 100) * videoHeight));
    const w = Math.max(4, Math.round((r.width / 100) * videoWidth));
    const h = Math.max(4, Math.round((r.height / 100) * videoHeight));
    const cx = Math.min(x, videoWidth - w);
    const cy = Math.min(y, videoHeight - h);
    const isLast = i === regions.length - 1;
    const outLabel = isLast ? 'blur_out' : `bc${i}`;

    let effectFilter: string;
    if (r.type === 'pixelate') {
      const block = Math.max(4, Math.min(60, r.strength ?? 15));
      const downW = Math.max(1, Math.round(w / block));
      const downH = Math.max(1, Math.round(h / block));
      effectFilter = `crop=${w}:${h}:${cx}:${cy},scale=${downW}:${downH}:flags=neighbor,scale=${w}:${h}:flags=neighbor`;
    } else {
      const sigma = Math.max(1, Math.min(50, r.strength ?? 15));
      const radius = Math.max(1, Math.round(sigma / 2));
      effectFilter = `crop=${w}:${h}:${cx}:${cy},boxblur=luma_radius=${radius}:luma_power=2:chroma_radius=${radius}:chroma_power=2,format=yuv420p`;
    }

    parts.push(`[${prevOut}]split=2[bz${i}][bt${i}]`);
    parts.push(`[bt${i}]${effectFilter}[bb${i}]`);
    parts.push(`[bz${i}][bb${i}]overlay=x=${cx}:y=${cy}[${outLabel}]`);
    prevOut = outLabel;
  }

  const bin = await getFullFfmpegBinary();
  const probed = await probeFile(input);

  const args = [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-i', input,
    '-filter_complex', parts.join(';'),
    '-map', '[blur_out]',
  ];
  if (probed.hasAudio) {
    args.push('-map', '0:a', '-c:a', 'copy');
  } else {
    args.push('-an');
  }
  args.push('-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-movflags', '+faststart', output);

  console.log(`[applyBlurRegions] ${regions.length} region(s) → ${path.basename(output)}`);
  try {
    await execFileAsync(bin, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(`ffmpeg blur failed: ${(err as Error).message}${stderr ? ` | ${stderr.trim().slice(-400)}` : ''}`);
  }
}

export async function cropVideo(
  input: string,
  output: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  const bin = await getFullFfmpegBinary();
  const probed = await probeFile(input);
  // Codec requires even dimensions
  const w = width % 2 === 0 ? width : width - 1;
  const h = height % 2 === 0 ? height : height - 1;
  const args = [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-i', input,
    '-vf', `crop=${w}:${h}:${x}:${y}`,
    '-c:v', 'libx264', '-crf', '22', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  ];
  if (probed.hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100');
  } else {
    args.push('-an');
  }
  args.push(output);
  console.log(`[cropVideo] ${w}x${h} at (${x},${y})`);
  try {
    await execFileAsync(bin, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(`ffmpeg crop failed: ${(err as Error).message}${stderr ? ` | ${stderr.trim().slice(-400)}` : ''}`);
  }
}

export async function trimVideo(
  input: string,
  output: string,
  startSec: number,
  endSec: number
): Promise<void> {
  const bin = await getFfmpegBinary();
  const probed = await probeFile(input);
  const audioArgs = probed.hasAudio
    ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100']
    : ['-an'];
  // Place -ss/-to AFTER -i for frame-accurate trim (re-encodes, but avoids black frames)
  const args = [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-i', input,
    '-ss', String(startSec),
    '-to', String(endSec),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    ...audioArgs,
    output,
  ];
  console.log(`[trimVideo] ${startSec}s → ${endSec}s`);
  try {
    await execFileAsync(bin, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(`ffmpeg trim failed: ${(err as Error).message}${stderr ? ` | ${stderr.trim().slice(-400)}` : ''}`);
  }
}

export type ImportProgress = (pct: number, message: string) => void;

export async function importFromUrl(
  url: string,
  outputDir: string,
  onProgress: ImportProgress = () => {}
): Promise<ImportResult> {
  const ytDlp = getYtDlpPath();
  const id = uuidv4();
  const outputTemplate = path.join(outputDir, `import_${id}.%(ext)s`);

  // STEP 1 — metadata probe (yt-dlp --print)
  onProgress(2, 'Fetching video metadata');
  let title = 'Imported Video';
  let duration = 30;
  let description: string | undefined;
  let sourceUrl: string | undefined;
  let author: string | undefined;
  let authorUrl: string | undefined;
  try {
    const { stdout } = await execFileAsync(
      ytDlp,
      // ASCII Unit Separator (\x1F) avoids collisions with description text containing tabs/newlines
      ['--print', '%(title)s\x1F%(duration)s\x1F%(description)s\x1F%(webpage_url)s\x1F%(uploader)s\x1F%(uploader_url)s\x1F%(channel)s', '--no-playlist', url],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }
    );
    const [rawTitle, rawDuration, rawDescription, rawWebpageUrl, rawUploader, rawUploaderUrl, rawChannel] = stdout.trim().split('\x1F');
    if (rawTitle) title = rawTitle.slice(0, 100);
    if (rawDuration) duration = Math.round(parseFloat(rawDuration)) || 30;
    if (rawDescription && rawDescription !== 'NA') description = rawDescription.trim().slice(0, 4000);
    if (rawWebpageUrl && rawWebpageUrl !== 'NA') sourceUrl = rawWebpageUrl.trim();
    // Prefer uploader; some extractors only fill channel (YouTube). Cap length so weird inputs don't blow up the UI.
    const rawAuthor = (rawUploader && rawUploader !== 'NA') ? rawUploader : (rawChannel && rawChannel !== 'NA') ? rawChannel : undefined;
    if (rawAuthor) author = rawAuthor.trim().slice(0, 80);
    if (rawUploaderUrl && rawUploaderUrl !== 'NA') authorUrl = rawUploaderUrl.trim();
  } catch {
    // non-fatal — proceed with defaults
  }

  // STEP 2 — yt-dlp download with real-time progress parsing
  // Tell yt-dlp where to find ffmpeg so it can merge DASH streams. Without this it leaves
  // separate video/audio files behind, which breaks downstream playback.
  const ffmpegBin = await getFfmpegBinary();
  const ffmpegLocationArgs =
    ffmpegBin && ffmpegBin !== 'ffmpeg' && fs.existsSync(ffmpegBin)
      ? ['--ffmpeg-location', path.dirname(ffmpegBin)]
      : [];

  onProgress(10, 'Starting download');
  await runYtDlpWithProgress(
    ytDlp,
    [
      '-f',
      'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/' +
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/' +
        'best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--newline',
      // Custom progress template — emits one line per update with parseable fields
      '--progress-template', 'download:[progress]%(progress._percent_str)s|%(progress._downloaded_bytes_str)s|%(progress._total_bytes_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      ...ffmpegLocationArgs,
      '-o', outputTemplate,
      url,
    ],
    (ytPct, info) => {
      // Map yt-dlp's 0..100 download progress into our 12..55 band
      const overall = Math.min(55, Math.round(12 + (ytPct / 100) * 43));
      onProgress(overall, info ? `Downloading ${info}` : 'Downloading video');
    }
  );

  // STEP 3 — probe downloaded files
  onProgress(58, 'Probing media streams');
  const candidates = fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith(`import_${id}`))
    .map((f) => path.join(outputDir, f));
  if (candidates.length === 0) throw new Error('yt-dlp did not produce any output file');

  const probed = await Promise.all(
    candidates.map(async (p) => ({ path: p, info: await probeFile(p), size: fs.statSync(p).size }))
  );
  const videoFiles = probed.filter((p) => p.info.hasVideo);
  const audioOnly = probed.filter((p) => !p.info.hasVideo && p.info.hasAudio);

  if (videoFiles.length === 0) {
    throw new Error('No video stream found in any downloaded file');
  }

  videoFiles.sort((a, b) => b.size - a.size);
  const videoEntry = videoFiles[0];
  const audioEntry = videoEntry.info.hasAudio
    ? null
    : audioOnly.sort((a, b) => b.size - a.size)[0] ?? null;

  const webPath = path.join(outputDir, `import_${id}_web.mp4`);

  // STEP 4 — transcode / remux to browser-safe MP4
  if (audioEntry) {
    onProgress(65, 'Muxing video + audio streams');
    console.log(
      `[import] Muxing separate streams: video=${videoEntry.info.videoCodec} + audio=${audioEntry.info.audioCodec}`
    );
    await muxVideoAndAudio(videoEntry.path, audioEntry.path, webPath, videoEntry.info);
  } else {
    const info = videoEntry.info;
    const browserSafeVideo =
      info.videoCodec === 'h264' && (info.pixFmt === 'yuv420p' || info.pixFmt === 'yuvj420p');
    const browserSafeAudio = !info.hasAudio || info.audioCodec === 'aac';

    if (browserSafeVideo && browserSafeAudio) {
      onProgress(70, 'Optimizing for streaming');
      console.log(`[import] H.264/AAC detected — remuxing with +faststart`);
      try {
        await remuxFaststart(videoEntry.path, webPath);
      } catch (err) {
        console.warn('[import] Remux failed, falling back to transcode:', err);
        onProgress(72, 'Transcoding to H.264');
        await transcodeToBrowserSafe(videoEntry.path, webPath, { hasAudio: info.hasAudio });
      }
    } else {
      onProgress(65, 'Transcoding to browser-safe H.264');
      console.log(
        `[import] Transcoding to browser-safe H.264 ` +
          `(video=${info.videoCodec ?? '?'}/${info.pixFmt ?? '?'}, audio=${info.audioCodec ?? 'none'})`
      );
      await transcodeToBrowserSafe(videoEntry.path, webPath, { hasAudio: info.hasAudio });
    }
  }

  // STEP 5 — cleanup
  onProgress(85, 'Cleaning up temp files');
  for (const p of candidates) {
    if (p === webPath) continue;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  }

  return { filePath: webPath, title, duration, description, sourceUrl, author, authorUrl };
}

// Spawn yt-dlp and parse its --progress-template output line-by-line so we can stream
// download progress back to the job. The custom template format is:
//   download:[progress]<pct>|<downloaded>|<total>|<speed>|<eta>
function runYtDlpWithProgress(
  bin: string,
  args: string[],
  onTick: (percent: number, info?: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true });
    let stderrBuf = '';
    let lastEmittedPct = -1;
    let buffer = '';

    const handleLine = (line: string) => {
      const m = line.match(/download:\[progress\]\s*([\d.]+)%\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)/);
      if (!m) return;
      const pct = Math.max(0, Math.min(100, parseFloat(m[1])));
      const downloaded = m[2]?.trim();
      const total = m[3]?.trim();
      const speed = m[4]?.trim();
      // Only emit on percent change (yt-dlp can fire many times per second)
      const rounded = Math.round(pct);
      if (rounded === lastEmittedPct) return;
      lastEmittedPct = rounded;
      const info = total ? `${downloaded}/${total} at ${speed}` : undefined;
      onTick(pct, info);
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      // yt-dlp sometimes writes the progress line to stderr depending on platform
      const lines = (stderrBuf.match(/.*\r?\n/g) ?? []);
      for (const l of lines) handleLine(l.replace(/\r?\n$/, ''));
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}: ${stderrBuf.trim().slice(-400)}`));
    });

    // Hard timeout — same envelope as execFile call used to have
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('yt-dlp download timed out after 240s'));
    }, 240_000);
    proc.on('close', () => clearTimeout(timer));
  });
}

async function muxVideoAndAudio(
  videoPath: string,
  audioPath: string,
  output: string,
  videoInfo: ProbeInfo
): Promise<void> {
  const browserSafeVideo =
    videoInfo.videoCodec === 'h264' &&
    (videoInfo.pixFmt === 'yuv420p' || videoInfo.pixFmt === 'yuvj420p');

  const videoCodecArgs = browserSafeVideo
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-profile:v', 'main', '-level', '4.0', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p'];

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    ...videoCodecArgs,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    '-movflags', '+faststart',
    '-shortest',
    output,
  ];

  const bin = await getFfmpegBinary();
  try {
    await execFileAsync(bin, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(
      `ffmpeg mux failed: ${(err as Error).message}${stderr ? ` | ${stderr.trim().slice(-500)}` : ''}`
    );
  }
}

export interface TextOverlayInput {
  text: string;
  x: number;           // center X as % (0–100)
  y: number;           // center Y as % (0–100)
  fontSize: number;    // as % of video height (1–20)
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  color: string;       // hex '#RRGGBB'
  bgColor: string;     // hex with alpha or empty
  opacity: number;     // 0–1
  rotation: number;
  startTime?: number;
  endTime?: number;
  animation: string;
}

// Escape text for FFmpeg drawtext filter: colons, backslashes, single quotes, etc.
function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "'\\\\\\''")
    .replace(/\n/g, '\\n');
}

// Convert hex '#RRGGBB' to FFmpeg-compatible '0xRRGGBB' format
function hexToFfmpegColor(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `0x${clean}${alpha}`;
}

// Map font family names to actual .ttf file paths on the system.
// FFmpeg's drawtext on Windows needs fontfile= because fontconfig is missing.
const FONT_FILE_MAP: Record<string, string> = {
  'Arial':          'arial.ttf',
  'Impact':         'impact.ttf',
  'Georgia':        'georgia.ttf',
  'Courier New':    'cour.ttf',
  'Verdana':        'verdana.ttf',
  'Comic Sans MS':  'comic.ttf',
  'Trebuchet MS':   'trebuc.ttf',
};
const FONT_BOLD_MAP: Record<string, string> = {
  'Arial':          'arialbd.ttf',
  'Impact':         'impact.ttf',
  'Georgia':        'georgiab.ttf',
  'Courier New':    'courbd.ttf',
  'Verdana':        'verdanab.ttf',
  'Comic Sans MS':  'comicbd.ttf',
  'Trebuchet MS':   'trebucbd.ttf',
};

function resolveFontFile(family: string, bold: boolean): string {
  const fontsDir = process.platform === 'win32'
    ? 'C:/Windows/Fonts'
    : '/usr/share/fonts/truetype';
  const map = bold ? FONT_BOLD_MAP : FONT_FILE_MAP;
  const filename = map[family] || map['Arial'] || 'arial.ttf';
  const fullPath = path.join(fontsDir, filename);
  // FFmpeg drawtext expects colons escaped as \: and forward slashes
  const escape = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
  if (fs.existsSync(fullPath)) return escape(fullPath);
  const fallback = path.join(fontsDir, bold ? 'arialbd.ttf' : 'arial.ttf');
  return escape(fallback);
}

export async function applyTextOverlays(
  input: string,
  output: string,
  overlays: TextOverlayInput[],
  videoWidth: number,
  videoHeight: number,
  videoDuration: number
): Promise<void> {
  if (overlays.length === 0) return;

  // Build a drawtext filter chain for each overlay
  const filters: string[] = [];

  for (const ov of overlays) {
    const fontSizePx = Math.max(12, Math.round((ov.fontSize / 100) * videoHeight));
    const posX = Math.round((ov.x / 100) * videoWidth);
    const posY = Math.round((ov.y / 100) * videoHeight);
    // drawtext x/y is top-left; offset by half the text dimensions to center
    const xExpr = `${posX}-tw/2`;
    const yExpr = `${posY}-th/2`;
    const color = hexToFfmpegColor(ov.color || '#FFFFFF', ov.opacity ?? 1);
    const escapedText = escapeDrawtext(ov.text);

    const fontFile = resolveFontFile(ov.fontFamily || 'Arial', ov.fontWeight === 'bold');
    const parts = [
      `text='${escapedText}'`,
      `fontfile='${fontFile}'`,
      `fontsize=${fontSizePx}`,
      `fontcolor=${color}`,
      `x=${xExpr}`,
      `y=${yExpr}`,
    ];

    // Background box
    if (ov.bgColor && ov.bgColor.length >= 7) {
      const bgAlpha = ov.bgColor.length > 7 ? parseInt(ov.bgColor.slice(7, 9), 16) / 255 : 0.5;
      const bgHex = ov.bgColor.slice(0, 7);
      parts.push(`box=1`);
      parts.push(`boxcolor=${hexToFfmpegColor(bgHex, bgAlpha)}`);
      parts.push(`boxborderw=8`);
    }

    // Time range (enable/disable)
    const enableParts: string[] = [];
    if (ov.startTime !== undefined && ov.startTime > 0) {
      enableParts.push(`gte(t\\,${ov.startTime})`);
    }
    if (ov.endTime !== undefined && ov.endTime > 0 && ov.endTime < videoDuration) {
      enableParts.push(`lte(t\\,${ov.endTime})`);
    }
    if (enableParts.length > 0) {
      parts.push(`enable='${enableParts.join('*')}'`);
    }

    // Fade-in animation (alpha ramp over 0.5s)
    if (ov.animation === 'fade-in' && ov.startTime !== undefined) {
      const start = ov.startTime || 0;
      parts.push(`alpha='if(lt(t\\,${start})\\,0\\,if(lt(t\\,${start + 0.5})\\,(t-${start})/0.5\\,1))'`);
    }

    filters.push(`drawtext=${parts.join(':')}`);
  }

  const filterStr = filters.join(',');
  const bin = await getFullFfmpegBinary();
  const probed = await probeFile(input);
  const audioArgs = probed.hasAudio
    ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100']
    : ['-an'];

  const args = [
    '-y', '-hide_banner', '-loglevel', 'warning',
    '-i', input,
    '-vf', filterStr,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    ...audioArgs,
    output,
  ];

  console.log(`[applyTextOverlays] ${overlays.length} overlay(s) → ${path.basename(output)}`);
  try {
    await execFileAsync(bin, args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    console.log(`[applyTextOverlays] done: ${path.basename(output)}`);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(`ffmpeg text overlay failed: ${(err as Error).message}${stderr ? ` | ${stderr.trim().slice(-400)}` : ''}`);
  }
}

export async function checkYtDlp(): Promise<boolean> {
  try {
    await execFileAsync(getYtDlpPath(), ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
