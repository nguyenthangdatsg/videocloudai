import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import type { VideoFormat, VideoResolution } from '@videocloudai/shared';

export interface ExportPreset {
  format: VideoFormat;
  resolution: VideoResolution;
  bitrate: string;
  audioBitrate: string;
  fps: number;
  crf: number;
}

export const EXPORT_PRESETS: Record<VideoFormat, ExportPreset> = {
  tiktok: {
    format: 'tiktok',
    resolution: '1080x1920',
    bitrate: '4000k',
    audioBitrate: '128k',
    fps: 24,
    crf: 22,
  },
  'youtube-shorts': {
    format: 'youtube-shorts',
    resolution: '1080x1920',
    bitrate: '8000k',
    audioBitrate: '192k',
    fps: 30,
    crf: 20,
  },
  'instagram-reels': {
    format: 'instagram-reels',
    resolution: '1080x1920',
    bitrate: '3500k',
    audioBitrate: '128k',
    fps: 24,
    crf: 23,
  },
  youtube: {
    format: 'youtube',
    resolution: '1920x1080',
    bitrate: '12000k',
    audioBitrate: '256k',
    fps: 30,
    crf: 18,
  },
  custom: {
    format: 'custom',
    resolution: '1080x1920',
    bitrate: '4000k',
    audioBitrate: '128k',
    fps: 24,
    crf: 22,
  },
};

export async function exportForPlatform(
  inputPath: string,
  outputDir: string,
  formats: VideoFormat[]
): Promise<Record<VideoFormat, string>> {
  const results: Partial<Record<VideoFormat, string>> = {};

  for (const format of formats) {
    const preset = EXPORT_PRESETS[format];
    const [w, h] = preset.resolution.split('x').map(Number);
    const outputPath = path.join(outputDir, `export_${format}.mp4`);

    await encodeWithPreset(inputPath, outputPath, preset, w, h);
    results[format] = outputPath;
  }

  return results as Record<VideoFormat, string>;
}

function encodeWithPreset(
  input: string,
  output: string,
  preset: ExportPreset,
  w: number,
  h: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .videoFilters(`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`)
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', 'slow',
        `-crf`, String(preset.crf),
        `-b:v`, preset.bitrate,
        `-r`, String(preset.fps),
        `-c:a`, 'aac',
        `-b:a`, preset.audioBitrate,
        `-movflags`, '+faststart',
        `-pix_fmt`, 'yuv420p',
        `-profile:v`, 'high',
        `-level`, '4.1',
      ])
      .output(output)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`Export error [${preset.format}]: ${err.message}`)))
      .run();
  });
}
