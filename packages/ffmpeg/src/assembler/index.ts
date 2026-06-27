import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import { buildMotionFilter, buildSubtitleFilter } from '../effects/motion';
import type { VideoTimeline, TimelineClip, MotionEffectType } from '@videocloudai/shared';

export interface AssemblerConfig {
  ffmpegPath?: string;
  ffprobePath?: string;
  width?: number;
  height?: number;
  fps?: number;
  outputDir?: string;
}

export interface AssemblyProgress {
  stage: string;
  percent: number;
  currentFile?: string;
}

export class VideoAssembler {
  private config: Required<AssemblerConfig>;

  constructor(config: AssemblerConfig = {}) {
    this.config = {
      ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
      ffprobePath: config.ffprobePath ?? 'ffprobe',
      width: config.width ?? 1080,
      height: config.height ?? 1920,
      fps: config.fps ?? 24,
      outputDir: config.outputDir ?? './renders',
    };

    ffmpeg.setFfmpegPath(this.config.ffmpegPath);
    ffmpeg.setFfprobePath(this.config.ffprobePath);
  }

  async assembleVideo(
    timeline: VideoTimeline,
    outputPath: string,
    onProgress?: (p: AssemblyProgress) => void,
    overrides?: { width?: number; height?: number; fps?: number }
  ): Promise<string> {
    // Apply per-call overrides (e.g. landscape for YouTube long-form)
    const prevWidth = this.config.width;
    const prevHeight = this.config.height;
    const prevFps = this.config.fps;
    if (overrides?.width) this.config.width = overrides.width;
    if (overrides?.height) this.config.height = overrides.height;
    if (overrides?.fps) this.config.fps = overrides.fps;

    const tempDir = path.join(this.config.outputDir, `.tmp_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      onProgress?.({ stage: 'Processing clips', percent: 5 });

      const processedClips = await this.processClips(timeline.clips, tempDir, onProgress);

      onProgress?.({ stage: 'Concatenating clips', percent: 60 });

      // Build ordered segment list: intro → main clips → outro
      const segments: string[] = [];
      if (timeline.introPath && fs.existsSync(timeline.introPath)) {
        const stripped = path.join(tempDir, 'intro_v.mp4');
        await this.stripAudio(timeline.introPath, stripped);
        segments.push(stripped);
      }
      segments.push(...processedClips);
      if (timeline.outroPath && fs.existsSync(timeline.outroPath)) {
        const stripped = path.join(tempDir, 'outro_v.mp4');
        await this.stripAudio(timeline.outroPath, stripped);
        segments.push(stripped);
      }

      const concatenated = await this.concatenateClips(segments, tempDir);

      onProgress?.({ stage: 'Adding audio', percent: 75 });
      const withAudio = await this.mergeAudio(
        concatenated,
        timeline.narrationPath,
        timeline.musicPath,
        tempDir,
        timeline.musicVolume
      );

      onProgress?.({ stage: 'Final encode', percent: 90 });
      await this.finalEncode(withAudio, outputPath);

      onProgress?.({ stage: 'Complete', percent: 100 });
      return outputPath;
    } finally {
      this.cleanTemp(tempDir);
      // Restore original config
      this.config.width = prevWidth;
      this.config.height = prevHeight;
      this.config.fps = prevFps;
    }
  }

  private async processClips(
    clips: TimelineClip[],
    tempDir: string,
    onProgress?: (p: AssemblyProgress) => void
  ): Promise<string[]> {
    const processed: string[] = [];

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const outPath = path.join(tempDir, `clip_${i.toString().padStart(3, '0')}.mp4`);

      onProgress?.({
        stage: `Processing clip ${i + 1}/${clips.length}`,
        percent: Math.round(5 + (i / clips.length) * 50),
        currentFile: clip.assetPath,
      });

      await this.processClip(clip, outPath);
      processed.push(outPath);
    }

    return processed;
  }

  private processClip(clip: TimelineClip, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isImage = /\.(jpe?g|png|webp)$/i.test(clip.assetPath);
      const effect = clip.motionEffect ?? 'slow-zoom';
      const motionFilter = buildMotionFilter(effect as MotionEffectType, clip.duration, this.config.fps);

      const cmd = ffmpeg();

      if (isImage) {
        cmd
          .input(clip.assetPath)
          .inputOptions(['-loop', '1', '-framerate', String(this.config.fps)])
          .inputOptions(['-t', String(clip.duration)]);
      } else {
        cmd.input(clip.assetPath).inputOptions(['-t', String(clip.duration)]);
      }

      const filters = [motionFilter.videoFilter];

      if (clip.subtitleText) {
        const subFilter = buildSubtitleFilter(clip.subtitleText, 0, clip.duration);
        filters.push(subFilter);
      }

      // Add fade in/out
      if (clip.transition === 'fade') {
        filters.push(`fade=t=in:st=0:d=0.3`);
        filters.push(`fade=t=out:st=${clip.duration - 0.3}:d=0.3`);
      }

      cmd
        .videoFilters(filters.join(','))
        .outputOptions([
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '23',
          '-r', String(this.config.fps),
          '-pix_fmt', 'yuv420p',
          '-an',
        ])
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`FFmpeg clip error: ${err.message}`)))
        .run();
    });
  }

  private concatenateClips(clips: string[], tempDir: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const listFile = path.join(tempDir, 'concat.txt');
      const content = clips.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n');
      fs.writeFileSync(listFile, content);

      const outPath = path.join(tempDir, 'concatenated.mp4');

      ffmpeg()
        .input(listFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(outPath)
        .on('end', () => resolve(outPath))
        .on('error', (err) => reject(new Error(`Concat error: ${err.message}`)))
        .run();
    });
  }

  private async mergeAudio(
    videoPath: string,
    narrationPath?: string,
    musicPath?: string,
    tempDir?: string,
    musicVolume?: number
  ): Promise<string> {
    if (!narrationPath && !musicPath) return videoPath;

    const outPath = path.join(tempDir ?? path.dirname(videoPath), 'with_audio.mp4');

    // Get video duration to cap output and decide whether to loop music
    const videoInfo = await this.getVideoInfo(videoPath);
    const videoDur = videoInfo.duration > 0 ? videoInfo.duration : 30;

    return new Promise((resolve, reject) => {
      const cmd = ffmpeg().input(videoPath);
      const filterParts: string[] = [];
      let audioInputIndex = 1;

      if (narrationPath && fs.existsSync(narrationPath)) {
        cmd.input(narrationPath);
        filterParts.push(`[${audioInputIndex}:a]volume=1.0[narr]`);
        audioInputIndex++;
      }

      if (musicPath && fs.existsSync(musicPath)) {
        const vol = musicVolume ?? 0.20;
        // Only loop if music is shorter than video
        cmd.input(musicPath).inputOptions(['-stream_loop', '-1']);
        filterParts.push(`[${audioInputIndex}:a]volume=${vol},atrim=0:${videoDur},asetpts=PTS-STARTPTS[music]`);
        audioInputIndex++;
      }

      if (filterParts.length === 0) {
        resolve(videoPath);
        return;
      }

      let mixInputs = '';
      let mixCount = 0;

      if (narrationPath && fs.existsSync(narrationPath)) {
        mixInputs += '[narr]';
        mixCount++;
      }
      if (musicPath && fs.existsSync(musicPath)) {
        mixInputs += '[music]';
        mixCount++;
      }

      const filterComplex = [
        ...filterParts,
        `${mixInputs}amix=inputs=${mixCount}:duration=first[aout]`,
      ].join('; ');

      cmd
        .complexFilter(filterComplex)
        .outputOptions([
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-t', String(videoDur),
        ])
        .output(outPath)
        .on('end', () => resolve(outPath))
        .on('error', (err) => reject(new Error(`Audio merge error: ${err.message}`)))
        .run();
    });
  }

  private finalEncode(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '22',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-r', String(this.config.fps),
          '-pix_fmt', 'yuv420p',
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Final encode error: ${err.message}`)))
        .run();
    });
  }

  async generateThumbnail(videoPath: string, outputPath: string, timeOffset = 1): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [timeOffset],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: `${this.config.width}x${this.config.height}`,
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(new Error(`Thumbnail error: ${err.message}`)));
    });
  }

  async getVideoInfo(filePath: string): Promise<{ duration: number; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        const video = metadata.streams.find((s) => s.codec_type === 'video');
        resolve({
          duration: metadata.format.duration ?? 0,
          width: video?.width ?? 0,
          height: video?.height ?? 0,
        });
      });
    });
  }

  private stripAudio(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-c:v', 'copy', '-an'])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Strip audio error: ${err.message}`)))
        .run();
    });
  }

  private cleanTemp(tempDir: string): void {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}
