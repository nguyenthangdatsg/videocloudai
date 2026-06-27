import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);
import { dbGet, dbAll, dbRun } from '../db';
import { ScriptProcessor } from '@videocloudai/core';
import { VideoAssembler } from '@videocloudai/ffmpeg';
import { SceneLibraryService } from './scene-library.service';
import { NarrationService } from './narration.service';
import { SubtitleService } from './subtitle.service';
import { getMusicService } from './music.service';
import { getSettings } from './settings.service';
import { renderIntroClip, renderOutroClip } from './remotion-renderer.service';
import { remuxFaststart, transcodeToBrowserSafe, resolveFfmpegPathSync, applyFrameTransforms, isNonDefaultTransform, applyMusicMix, probeFile, applyBlurRegions, applyTextOverlays, trimVideo, cropVideo } from './import.service';
import type { FrameTransformOptions, BlurRegionInput } from './import.service';
import { rewriteDescription } from './script-gen.service';
import type {
  VideoProject,
  SceneLine,
  VideoFormat,
  VideoDuration,
  VideoResolution,
  VideoFPS,
  TimelineClip,
  VideoTimeline,
  TextOverlay,
} from '@videocloudai/shared';

interface DbVideo {
  id: string;
  title: string;
  description: string;
  script: string;
  scenes: string;
  status: string;
  format: string;
  duration: number;
  resolution: string;
  fps: number;
  narration_enabled: number;
  subtitles_enabled: number;
  music_enabled: number;
  mute_original_audio: number;
  output_path: string;
  thumbnail_path: string;
  total_duration: number;
  scene_count: number;
  generated_scene_count: number;
  reused_scene_count: number;
  render_time_ms: number;
  filesize: number;
  narration_voice: string;
  narration_rate: string;
  music_track: string;
  music_mood: string;
  music_track_path: string;
  category: string | null;
  content_tags: string;
  source_video_id: string | null;
  blur_regions: string;
  text_overlays: string;
  original_description: string | null;
  imported_from_url: string | null;
  ai_description: string | null;
  original_author: string | null;
  original_author_url: string | null;
  upload_status: string;
  uploaded_at: string | null;
  upload_note: string | null;
  created_at: string;
  updated_at: string;
}

function mapDbVideo(row: DbVideo): VideoProject {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    script: row.script,
    scenes: JSON.parse(row.scenes ?? '[]'),
    status: row.status as VideoProject['status'],
    format: row.format as VideoFormat,
    duration: row.duration as VideoDuration,
    resolution: row.resolution as VideoResolution,
    fps: row.fps as VideoFPS,
    narrationEnabled: Boolean(row.narration_enabled),
    narrationVoice: row.narration_voice || undefined,
    narrationRate: row.narration_rate || undefined,
    subtitlesEnabled: Boolean(row.subtitles_enabled),
    musicEnabled: Boolean(row.music_enabled),
    muteOriginalAudio: Boolean(row.mute_original_audio),
    musicMood: row.music_mood ?? 'dramatic',
    musicTrackPath: row.music_track_path || undefined,
    outputPath: row.output_path,
    thumbnailPath: row.thumbnail_path,
    category: row.category ?? undefined,
    contentTags: row.content_tags ? JSON.parse(row.content_tags) : [],
    sourceVideoId: row.source_video_id ?? undefined,
    blurRegions: row.blur_regions ? JSON.parse(row.blur_regions) : [],
    textOverlays: row.text_overlays ? JSON.parse(row.text_overlays) : [],
    originalDescription: row.original_description ?? undefined,
    importedFromUrl: row.imported_from_url ?? undefined,
    aiDescription: row.ai_description ?? undefined,
    originalAuthor: row.original_author ?? undefined,
    originalAuthorUrl: row.original_author_url ?? undefined,
    uploadStatus: (row.upload_status as 'pending' | 'in_progress' | 'uploaded') || 'pending',
    uploadedAt: row.uploaded_at ?? undefined,
    uploadNote: row.upload_note ?? undefined,
    metadata: {
      totalDuration: row.total_duration,
      sceneCount: row.scene_count,
      generatedSceneCount: row.generated_scene_count,
      reusedSceneCount: row.reused_scene_count,
      renderTimeMs: row.render_time_ms,
      filesize: row.filesize,
      narrationVoice: row.narration_voice,
      musicTrack: row.music_track,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class VideoService {
  private scriptProcessor: ScriptProcessor;
  private assembler: VideoAssembler;
  private libraryService: SceneLibraryService;
  private narrationService: NarrationService;
  private subtitleService: SubtitleService;
  private rendersDir: string;

  constructor(
    libraryService: SceneLibraryService,
    narrationService: NarrationService,
    subtitleService: SubtitleService
  ) {
    this.scriptProcessor = new ScriptProcessor();
    this.assembler = new VideoAssembler({
      // Auto-resolves to the bundled Remotion ffmpeg when nothing else is configured —
      // otherwise the literal 'ffmpeg' string causes spawn ENOENT on machines without
      // ffmpeg on PATH.
      ffmpegPath: resolveFfmpegPathSync('ffmpeg'),
      ffprobePath: resolveFfmpegPathSync('ffprobe'),
      outputDir: process.env.RENDERS_DIR ?? './renders',
    });
    this.libraryService = libraryService;
    this.narrationService = narrationService;
    this.subtitleService = subtitleService;
    this.rendersDir = process.env.RENDERS_DIR ?? './renders';
    fs.mkdirSync(this.rendersDir, { recursive: true });
  }

  createProject(data: {
    title: string;
    script: string;
    format?: VideoFormat;
    duration?: VideoDuration;
    narrationEnabled?: boolean;
    narrationVoice?: string;
    narrationRate?: string;
    subtitlesEnabled?: boolean;
    musicEnabled?: boolean;
    musicMood?: string;
    musicTrackPath?: string;
  }): VideoProject {
    const id = uuidv4();
    const now = new Date().toISOString();
    const targetDuration = data.duration ?? 30;
    // Auto-suffix the title if another project already has it (titles are unique)
    const uniqueTitle = this.findFreeTitle(data.title);

    const scenes = this.scriptProcessor.process(data.script, targetDuration);
    const fmt = data.format ?? 'tiktok';
    const resolution = fmt === 'youtube' ? '1920x1080' : '1080x1920';
    const fps = fmt === 'youtube' || fmt === 'youtube-shorts' ? 30 : 24;

    dbRun(
      `INSERT INTO videos (id, title, script, scenes, status, format, duration, resolution, fps,
       narration_enabled, narration_voice, narration_rate, subtitles_enabled, music_enabled, music_mood, music_track_path, generated_scene_count, reused_scene_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'script-ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        id,
        uniqueTitle,
        data.script,
        JSON.stringify(scenes),
        fmt,
        targetDuration,
        resolution,
        fps,
        data.narrationEnabled !== false ? 1 : 0,
        data.narrationVoice ?? null,
        data.narrationRate ?? '+0%',
        data.subtitlesEnabled !== false ? 1 : 0,
        data.musicEnabled ? 1 : 0,
        data.musicMood ?? 'dramatic',
        data.musicTrackPath ?? null,
        now,
        now,
      ]
    );

    return this.getProject(id)!;
  }

  getProject(id: string): VideoProject | undefined {
    const row = dbGet<DbVideo>('SELECT * FROM videos WHERE id = ?', [id]);
    return row ? mapDbVideo(row) : undefined;
  }

  listProjects(status?: string): VideoProject[] {
    const rows = status
      ? dbAll<DbVideo>('SELECT * FROM videos WHERE status = ? ORDER BY created_at DESC', [status])
      : dbAll<DbVideo>('SELECT * FROM videos ORDER BY created_at DESC LIMIT 50');
    return rows.map(mapDbVideo);
  }

  // Returns true if any OTHER project already has this exact title.
  private isTitleTaken(title: string, exceptId?: string): boolean {
    const row = dbGet<{ id: string }>(
      'SELECT id FROM videos WHERE title = ? AND id != ? LIMIT 1',
      [title, exceptId ?? '']
    );
    return !!row;
  }

  // Resolves to the first non-conflicting title — `base`, `base (2)`, `base (3)`, … —
  // so URL imports never fail just because someone already imported the same video.
  private findFreeTitle(base: string, exceptId?: string): string {
    const trimmed = (base || 'Untitled').trim();
    if (!this.isTitleTaken(trimmed, exceptId)) return trimmed;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${trimmed} (${i})`;
      if (!this.isTitleTaken(candidate, exceptId)) return candidate;
    }
    // Worst-case fallback if 1000 duplicates exist — append a short random suffix
    return `${trimmed} (${Math.random().toString(36).slice(2, 6)})`;
  }

  updateTitle(videoId: string, title: string): VideoProject {
    if (this.isTitleTaken(title, videoId)) {
      const err = new Error(`Another video already has the title "${title}"`);
      (err as Error & { status?: number }).status = 409;
      throw err;
    }
    dbRun('UPDATE videos SET title = ?, updated_at = ? WHERE id = ?', [title, new Date().toISOString(), videoId]);
    const project = this.getProject(videoId);
    if (!project) throw new Error('Project not found');
    return project;
  }

  updateMusicMood(videoId: string, mood: string): VideoProject {
    dbRun('UPDATE videos SET music_mood = ?, updated_at = ? WHERE id = ?', [mood, new Date().toISOString(), videoId]);
    return this.getProject(videoId)!;
  }

  updateMusicTrack(videoId: string, trackFilename: string | null): VideoProject {
    const trackPath = trackFilename
      ? getMusicService().getTrackPath(trackFilename)
      : null;
    dbRun('UPDATE videos SET music_track_path = ?, updated_at = ? WHERE id = ?', [trackPath, new Date().toISOString(), videoId]);
    return this.getProject(videoId)!;
  }

  updateMusicSettings(videoId: string, settings: { musicEnabled?: boolean; muteOriginalAudio?: boolean }): VideoProject {
    const now = new Date().toISOString();
    if (settings.musicEnabled !== undefined) {
      dbRun('UPDATE videos SET music_enabled = ?, updated_at = ? WHERE id = ?', [settings.musicEnabled ? 1 : 0, now, videoId]);
    }
    if (settings.muteOriginalAudio !== undefined) {
      dbRun('UPDATE videos SET mute_original_audio = ?, updated_at = ? WHERE id = ?', [settings.muteOriginalAudio ? 1 : 0, now, videoId]);
    }
    return this.getProject(videoId)!;
  }

  updateBlurRegions(videoId: string, regions: BlurRegionInput[]): VideoProject {
    dbRun('UPDATE videos SET blur_regions = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(regions),
      new Date().toISOString(),
      videoId,
    ]);
    return this.getProject(videoId)!;
  }

  updateTextOverlays(videoId: string, overlays: unknown[]): VideoProject {
    dbRun('UPDATE videos SET text_overlays = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(overlays),
      new Date().toISOString(),
      videoId,
    ]);
    return this.getProject(videoId)!;
  }

  createProjectFromFile(data: {
    title: string;
    filePath: string;
    duration: number;
    originalDescription?: string;
    importedFromUrl?: string;
    originalAuthor?: string;
    originalAuthorUrl?: string;
  }): VideoProject {
    const id = uuidv4();
    const now = new Date().toISOString();
    // Titles must be unique across all videos — auto-suffix if the imported title clashes.
    const uniqueTitle = this.findFreeTitle(data.title);

    dbRun(
      `INSERT INTO videos (id, title, script, scenes, status, format, duration, resolution, fps,
       narration_enabled, subtitles_enabled, music_enabled, music_mood, output_path, generated_scene_count, reused_scene_count,
       original_description, imported_from_url, original_author, original_author_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'completed', 'tiktok', ?, '1080x1920', 24, 0, 0, 0, 'dramatic', ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
      [id, uniqueTitle, '', '[]', data.duration, data.filePath,
       data.originalDescription ?? null, data.importedFromUrl ?? null,
       data.originalAuthor ?? null, data.originalAuthorUrl ?? null,
       now, now]
    );

    return this.getProject(id)!;
  }

  updateScenes(videoId: string, scenes: SceneLine[]): VideoProject {
    const now = new Date().toISOString();
    dbRun(
      'UPDATE videos SET scenes = ?, scene_count = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(scenes), scenes.length, now, videoId]
    );
    return this.getProject(videoId)!;
  }

  async assembleVideo(
    videoId: string,
    clips: TimelineClip[],
    onProgress?: (p: { stage: string; percent: number }) => void,
    effectOptions?: { motionEffect?: string; transition?: string },
    frameTransform?: FrameTransformOptions
  ): Promise<{ outputPath: string; effectsSkipped?: boolean }> {
    const project = this.getProject(videoId);
    if (!project) throw new Error(`Video ${videoId} not found`);

    const startTime = Date.now();
    const settings = getSettings();

    dbRun("UPDATE videos SET status = 'assembling', updated_at = ? WHERE id = ?", [
      new Date().toISOString(),
      videoId,
    ]);

    // Imported-video / re-assembly path: clips arrive empty (client always sends []).
    // When effects (motion, transition) have been applied in the editor, run the source
    // through the full FFmpeg pipeline so they are burned into the output file.
    // Without effects, fall back to a fast lossless remux (no quality loss, much faster).
    let wasEffectsPath = false;
    let effectsTmpSrc: string | undefined;
    if (clips.length === 0 && project.outputPath && fs.existsSync(project.outputPath)) {
      const hasEffects = !!(effectOptions?.motionEffect || effectOptions?.transition);
      if (!hasEffects) {
        try {
          let currentPath = await this.snapshotImportedVideo(project, startTime, onProgress);

          if (frameTransform && isNonDefaultTransform(frameTransform)) {
            console.log(`[assemble] Applying frame transform: rotation=${frameTransform.rotation} flipH=${frameTransform.flipH} flipV=${frameTransform.flipV} crop=${JSON.stringify(frameTransform.crop)}`);
            currentPath = await this.postTransform(videoId, currentPath, frameTransform, onProgress);
          }

          if (project.muteOriginalAudio || project.musicEnabled) {
            currentPath = await this.postMusicMix(videoId, currentPath, project, onProgress);
          }

          if (project.blurRegions && project.blurRegions.length > 0) {
            currentPath = await this.postBlurRegions(videoId, currentPath, project.blurRegions as BlurRegionInput[], onProgress);
          }

          if (project.textOverlays && project.textOverlays.length > 0) {
            currentPath = await this.postTextOverlays(videoId, currentPath, project.textOverlays, onProgress);
          }

          return { outputPath: currentPath };
        } catch (err) {
          dbRun("UPDATE videos SET status = 'failed', updated_at = ? WHERE id = ?", [
            new Date().toISOString(),
            videoId,
          ]);
          throw err;
        }
      }
      // Probe the actual duration so the motion filter frame-count is correct.
      onProgress?.({ stage: 'Preparing source clip', percent: 5 });
      let clipDuration: number = project.duration ?? 30;
      let srcPath = project.outputPath;
      try {
        const info = await this.assembler.getVideoInfo(srcPath);
        if (info.duration > 0) clipDuration = info.duration;
      } catch { /* use project.duration as fallback */ }

      // Guard: if the source occupies the same path FFmpeg would write to (renders/videoId.mp4),
      // copy it to a temp name first — FFmpeg cannot read and write the same file simultaneously.
      const intendedOutput = path.join(this.rendersDir, `${videoId}.mp4`);
      if (path.resolve(srcPath) === path.resolve(intendedOutput)) {
        effectsTmpSrc = path.join(this.rendersDir, `${videoId}_src.mp4`);
        fs.copyFileSync(srcPath, effectsTmpSrc);
        srcPath = effectsTmpSrc;
      }

      wasEffectsPath = true;
      clips = [{
        assetPath: srcPath,
        duration: clipDuration,
        motionEffect: effectOptions!.motionEffect,
        transition: effectOptions!.transition,
      } as TimelineClip];
    }

    try {
      // Render intro clip if enabled
      let introPath: string | undefined;
      if (settings.get('intro_enabled') === '1' && settings.get('intro_creator_name')) {
        onProgress?.({ stage: 'Rendering intro', percent: 3 });
        introPath = path.join(this.rendersDir, `${videoId}_intro.mp4`);
        try {
          const dur = Math.max(1, parseInt(settings.get('intro_duration') || '3'));
          await renderIntroClip(introPath, {
            creatorName: settings.get('intro_creator_name'),
            tagline: settings.get('intro_tagline') || undefined,
            accentColor: settings.get('intro_accent_color') || '#7c6af5',
            style: (settings.get('intro_style') as 'minimal' | 'cinematic' | 'bold') || 'minimal',
            durationInFrames: dur * 24,
          });
        } catch (err) {
          console.error('[VideoService] Intro render failed (skipping):', err);
          introPath = undefined;
        }
      }

      // Render outro clip if enabled
      let outroPath: string | undefined;
      if (settings.get('outro_enabled') === '1' && settings.get('outro_creator_name')) {
        onProgress?.({ stage: 'Rendering outro', percent: 6 });
        outroPath = path.join(this.rendersDir, `${videoId}_outro.mp4`);
        try {
          const dur = Math.max(1, parseInt(settings.get('outro_duration') || '3'));
          await renderOutroClip(outroPath, {
            creatorName: settings.get('outro_creator_name'),
            socialHandle: settings.get('outro_social_handle') || undefined,
            ctaText: settings.get('outro_cta_text') || 'Follow for more!',
            accentColor: settings.get('outro_accent_color') || '#7c6af5',
            durationInFrames: dur * 24,
          });
        } catch (err) {
          console.error('[VideoService] Outro render failed (skipping):', err);
          outroPath = undefined;
        }
      }

      // Generate narration if enabled
      let narrationPath: string | undefined;
      if (project.narrationEnabled && project.script) {
        onProgress?.({ stage: 'Generating narration', percent: 10 });
        const narration = await this.narrationService.generateNarration(project.script, {
          videoId,
          voice: project.narrationVoice as any,
          rate: project.narrationRate,
        });
        narrationPath = narration.totalPath;
      }

      // Generate subtitles if enabled
      let subtitleEntries: Array<{ text: string; startMs: number; endMs: number }> = [];
      if (project.subtitlesEnabled && project.scenes.length > 0) {
        onProgress?.({ stage: 'Generating subtitles', percent: 20 });
        const lines = project.scenes.map((s) => s.line);
        const durations = project.scenes.map((s) => s.duration);
        const subs = this.subtitleService.generateFromScript(lines, durations, videoId);
        subtitleEntries = subs.entries;

        // Inject subtitles into clips
        clips = clips.map((clip, i) => ({
          ...clip,
          subtitleText: project.scenes[i]?.line,
        }));
      }

      // Get background music if enabled
      let musicPath: string | undefined;
      let musicTrackName: string | undefined;
      if (project.musicEnabled) {
        onProgress?.({ stage: 'Fetching background music', percent: 25 });
        const resolvedTrack = project.musicTrackPath ? path.resolve(project.musicTrackPath) : undefined;
        if (resolvedTrack && fs.existsSync(resolvedTrack)) {
          musicPath = resolvedTrack;
          musicTrackName = path.basename(resolvedTrack);
        } else {
          const dominantMood = project.musicMood ?? project.scenes[0]?.mood ?? 'dramatic';
          const music = await getMusicService().getTrackForMood(dominantMood);
          if (music) {
            musicPath = music.localPath;
            musicTrackName = music.trackName ?? (music.track ? `${music.track.name} — ${music.track.artist_name}` : path.basename(music.localPath));
          }
        }
      }

      const timeline: VideoTimeline = {
        videoId,
        clips,
        totalDuration: clips.reduce((s, c) => s + c.duration, 0),
        narrationPath,
        musicPath,
        musicVolume: getMusicService().getMusicVolume(),
        introPath,
        outroPath,
      };

      const outputPath = path.join(this.rendersDir, `${videoId}.mp4`);

      onProgress?.({ stage: 'Assembling video', percent: 30 });
      const [aw, ah] = (project.resolution ?? '1080x1920').split('x').map(Number);
      await this.assembler.assembleVideo(timeline, outputPath, (p) => {
        onProgress?.({
          stage: p.stage,
          percent: Math.round(30 + p.percent * 0.6),
        });
      }, { width: aw, height: ah, fps: project.fps });

      // Generate thumbnail
      const thumbnailPath = path.join(this.rendersDir, `${videoId}_thumb.jpg`);
      try {
        await this.assembler.generateThumbnail(outputPath, thumbnailPath);
      } catch {
        // non-fatal
      }

      const stat = fs.statSync(outputPath);
      const renderTimeMs = Date.now() - startTime;

      dbRun(
        `UPDATE videos SET status = 'completed', output_path = ?, thumbnail_path = ?,
         filesize = ?, render_time_ms = ?, music_track = ?, updated_at = ? WHERE id = ?`,
        [
          outputPath,
          thumbnailPath,
          stat.size,
          renderTimeMs,
          musicTrackName ?? null,
          new Date().toISOString(),
          videoId,
        ]
      );

      onProgress?.({ stage: 'Complete', percent: 100 });

      // Clean up temp intro/outro clips and effects source copy
      for (const p of [introPath, outroPath, effectsTmpSrc]) {
        if (p) try { fs.unlinkSync(p); } catch { /* best effort */ }
      }

      let finalPath = outputPath;
      if (frameTransform && isNonDefaultTransform(frameTransform)) {
        finalPath = await this.postTransform(videoId, finalPath, frameTransform, onProgress);
      }
      // Apply mute / background music for imported clips (VideoAssembler doesn't handle these)
      if (project.muteOriginalAudio || project.musicEnabled) {
        finalPath = await this.postMusicMix(videoId, finalPath, project, onProgress);
      }
      if (project.blurRegions && project.blurRegions.length > 0) {
        finalPath = await this.postBlurRegions(videoId, finalPath, project.blurRegions as BlurRegionInput[], onProgress);
      }
      if (project.textOverlays && project.textOverlays.length > 0) {
        finalPath = await this.postTextOverlays(videoId, finalPath, project.textOverlays, onProgress);
      }
      return { outputPath: finalPath };
    } catch (err) {
      if (wasEffectsPath) {
        // Effects pipeline failed (e.g. the bundled FFmpeg build lacks zoompan support).
        // Clean up any temp source copy and fall back to a plain snapshot so the user
        // always gets a working download link rather than a 'failed' status.
        console.warn('[VideoService] Effects pipeline failed, falling back to snapshot:', (err as Error).message);
        if (effectsTmpSrc) { try { fs.unlinkSync(effectsTmpSrc); } catch { /* cleanup */ } }
        try {
          const snapPath = await this.snapshotImportedVideo(project, startTime, onProgress);
          let finalFallback = snapPath;
          if (frameTransform && isNonDefaultTransform(frameTransform)) {
            finalFallback = await this.postTransform(videoId, finalFallback, frameTransform, onProgress);
          }
          if (project.muteOriginalAudio || project.musicEnabled) {
            finalFallback = await this.postMusicMix(videoId, finalFallback, project, onProgress);
          }
          if (project.blurRegions && (project.blurRegions as BlurRegionInput[]).length > 0) {
            finalFallback = await this.postBlurRegions(videoId, finalFallback, project.blurRegions as BlurRegionInput[], onProgress);
          }
          if (project.textOverlays && project.textOverlays.length > 0) {
            finalFallback = await this.postTextOverlays(videoId, finalFallback, project.textOverlays, onProgress);
          }
          return { outputPath: finalFallback, effectsSkipped: true };
        } catch (fallbackErr) {
          dbRun("UPDATE videos SET status = 'failed', updated_at = ? WHERE id = ?", [
            new Date().toISOString(),
            videoId,
          ]);
          throw fallbackErr;
        }
      }
      dbRun("UPDATE videos SET status = 'failed', updated_at = ? WHERE id = ?", [
        new Date().toISOString(),
        videoId,
      ]);
      throw err;
    }
  }

  // Apply frame transforms (rotate / flip / crop) to an already-assembled file.
  // Uses only filters present in the bundled Remotion FFmpeg (rotate, hflip, crop).
  private async postTransform(
    videoId: string,
    inputPath: string,
    transform: FrameTransformOptions,
    onProgress?: (p: { stage: string; percent: number }) => void
  ): Promise<string> {
    onProgress?.({ stage: 'Applying frame transforms', percent: 92 });
    const outPath = path.join(this.rendersDir, `${videoId}_out_${Date.now()}.mp4`);
    await applyFrameTransforms(inputPath, outPath, transform);
    try { fs.unlinkSync(inputPath); } catch { /* best effort */ }
    const stat = fs.statSync(outPath);
    dbRun(
      'UPDATE videos SET output_path = ?, filesize = ?, updated_at = ? WHERE id = ?',
      [outPath, stat.size, new Date().toISOString(), videoId]
    );
    return outPath;
  }

  private async postMusicMix(
    videoId: string,
    inputPath: string,
    project: VideoProject,
    onProgress?: (p: { stage: string; percent: number }) => void
  ): Promise<string> {
    onProgress?.({ stage: 'Mixing audio', percent: 95 });

    let musicPath: string | undefined;
    if (project.musicEnabled) {
      // Resolve relative paths (e.g. cache\music\es_123.mp3) against CWD
      const resolvedTrackPath = project.musicTrackPath ? path.resolve(project.musicTrackPath) : undefined;
      console.log(`[postMusicMix] musicEnabled=${project.musicEnabled} trackPath=${project.musicTrackPath} resolved=${resolvedTrackPath} exists=${resolvedTrackPath ? fs.existsSync(resolvedTrackPath) : false}`);
      if (resolvedTrackPath && fs.existsSync(resolvedTrackPath)) {
        musicPath = resolvedTrackPath;
      } else {
        const track = await getMusicService().getTrackForMood(project.musicMood ?? 'dramatic');
        musicPath = track?.localPath;
      }
    }

    const outPath = path.join(this.rendersDir, `${videoId}_mix_${Date.now()}.mp4`);
    await applyMusicMix(inputPath, outPath, {
      musicPath,
      musicVolume: getMusicService().getMusicVolume(),
      muteOriginal: project.muteOriginalAudio,
    });

    // applyMusicMix is a no-op (returns early) when nothing changes — outPath won't exist
    if (!fs.existsSync(outPath)) return inputPath;

    try { fs.unlinkSync(inputPath); } catch { /* best effort */ }
    const stat = fs.statSync(outPath);
    dbRun(
      'UPDATE videos SET output_path = ?, filesize = ?, updated_at = ? WHERE id = ?',
      [outPath, stat.size, new Date().toISOString(), videoId]
    );
    return outPath;
  }

  private async postBlurRegions(
    videoId: string,
    inputPath: string,
    regions: BlurRegionInput[],
    onProgress?: (p: { stage: string; percent: number }) => void
  ): Promise<string> {
    if (!regions || regions.length === 0) return inputPath;
    onProgress?.({ stage: 'Applying blur regions', percent: 97 });

    const info = await probeFile(inputPath);
    const vW = info.width ?? 1080;
    const vH = info.height ?? 1920;

    const outPath = path.join(this.rendersDir, `${videoId}_blur_${Date.now()}.mp4`);
    await applyBlurRegions(inputPath, outPath, regions, vW, vH);

    try { fs.unlinkSync(inputPath); } catch { /* best effort */ }
    const stat = fs.statSync(outPath);
    dbRun(
      'UPDATE videos SET output_path = ?, filesize = ?, updated_at = ? WHERE id = ?',
      [outPath, stat.size, new Date().toISOString(), videoId]
    );
    return outPath;
  }

  private async postTextOverlays(
    videoId: string,
    inputPath: string,
    overlays: TextOverlay[],
    onProgress?: (p: { stage: string; percent: number }) => void
  ): Promise<string> {
    if (!overlays || overlays.length === 0) return inputPath;
    onProgress?.({ stage: 'Burning text overlays', percent: 96 });

    const info = await probeFile(inputPath);
    const vW = info.width ?? 1080;
    const vH = info.height ?? 1920;

    const outPath = path.join(this.rendersDir, `${videoId}_text_${Date.now()}.mp4`);
    await applyTextOverlays(inputPath, outPath, overlays, vW, vH, info.duration);

    try { fs.unlinkSync(inputPath); } catch { /* best effort */ }
    const stat = fs.statSync(outPath);
    dbRun(
      'UPDATE videos SET output_path = ?, filesize = ?, updated_at = ? WHERE id = ?',
      [outPath, stat.size, new Date().toISOString(), videoId]
    );
    return outPath;
  }

  // Render an imported (sceneless) video into the renders directory as a stable artifact.
  // Currently a fast lossless remux + faststart — cinematic effects are preview-only because
  // the bundled ffmpeg has a stripped filter set. If a full ffmpeg is wired up later, this
  // is the place to burn effects into pixels.
  private async snapshotImportedVideo(
    project: VideoProject,
    startTime: number,
    onProgress?: (p: { stage: string; percent: number }) => void
  ): Promise<string> {
    if (!project.outputPath) throw new Error('Project has no source file');

    onProgress?.({ stage: 'Preparing render', percent: 10 });

    // _base.mp4 is a lossless remux of the original import — always use it as the transform
    // source so repeated assemblies don't chain re-encodes and degrade quality.
    const basePath = path.join(this.rendersDir, `${project.id}_base.mp4`);
    // Use a unique timestamped name to avoid "Permission denied" when the previous
    // _snap/_mix file is still locked by the preview player or another process.
    const snapPath = path.join(this.rendersDir, `${project.id}_snap_${Date.now()}.mp4`);

    // Build the base from the original source if it doesn't exist yet (or if the current
    // outputPath is not a render artifact — i.e., this is the very first assembly).
    const sourceIsRender = project.outputPath.startsWith(this.rendersDir);
    if (!fs.existsSync(basePath) || !sourceIsRender) {
      const rawSource = sourceIsRender ? null : project.outputPath;
      const actualSource = rawSource ?? project.outputPath;
      onProgress?.({ stage: 'Preparing source', percent: 15 });
      try {
        await remuxFaststart(actualSource, basePath);
      } catch {
        await transcodeToBrowserSafe(actualSource, basePath);
      }
    }

    // Clean up stale render artifacts — not the base, current output, or new snap target.
    try {
      for (const f of fs.readdirSync(this.rendersDir)) {
        const full = path.join(this.rendersDir, f);
        if (
          f.startsWith(project.id) &&
          full !== basePath &&
          full !== snapPath &&
          full !== project.outputPath &&
          (f.includes('_snap') || f.includes('_out') || f.includes('_mix') || f.includes('_blur') || f.includes('_t.') || f.includes('_v'))
        ) {
          try { fs.unlinkSync(full); } catch { /* locked — will be cleaned next time */ }
        }
      }
    } catch { /* best effort */ }

    // Snapshot from the stable base (never read-and-write the same file).
    const finalOutputPath = snapPath;
    onProgress?.({ stage: 'Rendering', percent: 35 });
    try {
      await remuxFaststart(basePath, finalOutputPath);
    } catch (err) {
      console.warn('[assemble] remux failed, transcoding:', err);
      await transcodeToBrowserSafe(basePath, finalOutputPath);
    }

    onProgress?.({ stage: 'Generating thumbnail', percent: 80 });
    const thumbnailPath = path.join(this.rendersDir, `${project.id}_thumb.jpg`);
    try {
      await this.assembler.generateThumbnail(finalOutputPath, thumbnailPath);
    } catch {
      /* non-fatal */
    }

    const stat = fs.statSync(finalOutputPath);
    const renderTimeMs = Date.now() - startTime;

    dbRun(
      `UPDATE videos SET status = 'completed', output_path = ?, thumbnail_path = ?,
       filesize = ?, render_time_ms = ?, updated_at = ? WHERE id = ?`,
      [
        finalOutputPath,
        thumbnailPath,
        stat.size,
        renderTimeMs,
        new Date().toISOString(),
        project.id,
      ]
    );

    onProgress?.({ stage: 'Complete', percent: 100 });
    return finalOutputPath;
  }

  deleteProject(id: string): void {
    dbRun('DELETE FROM videos WHERE id = ?', [id]);
  }

  updateOutputPath(id: string, outputPath: string): VideoProject | undefined {
    const now = new Date().toISOString();
    dbRun('UPDATE videos SET output_path = ?, updated_at = ? WHERE id = ?', [outputPath, now, id]);
    return this.getProject(id);
  }

  async trimVideoOutput(id: string, startSec: number, endSec: number): Promise<VideoProject> {
    const project = this.getProject(id);
    if (!project?.outputPath) throw new Error('No assembled video to trim');
    if (endSec <= startSec) throw new Error('End time must be after start time');

    const outputName = `trim_${id}_${Date.now()}.mp4`;
    const outputPath = path.join(path.dirname(project.outputPath), outputName);
    await trimVideo(project.outputPath, outputPath, startSec, endSec);

    return this.updateOutputPath(id, outputPath)!;
  }

  setUploadStatus(id: string, status: 'pending' | 'in_progress' | 'uploaded', note?: string | null): VideoProject {
    const project = this.getProject(id);
    if (!project) throw new Error('Project not found');
    const now = new Date().toISOString();
    // Stamp uploaded_at only when transitioning to uploaded; pending/in_progress clear it.
    const uploadedAt = status === 'uploaded' ? now : null;
    dbRun(
      'UPDATE videos SET upload_status = ?, uploaded_at = ?, upload_note = ?, updated_at = ? WHERE id = ?',
      [status, uploadedAt, note ?? null, now, id]
    );
    return this.getProject(id)!;
  }

  async generateAiDescription(id: string): Promise<VideoProject> {
    const project = this.getProject(id);
    if (!project) throw new Error('Project not found');
    if (!project.originalDescription) throw new Error('No original description to rewrite');

    const rewritten = await rewriteDescription(project.originalDescription, project.importedFromUrl);

    // Append a credit line referencing the original author. The template lives in settings
    // so users can change "Created by {author}" to any format they prefer.
    let final = rewritten;
    if (project.originalAuthor) {
      const template = getSettings().get('groq_description_credit_template') || 'Created by {author}';
      const credit = template.replace('{author}', project.originalAuthor).replace('{url}', project.originalAuthorUrl ?? project.importedFromUrl ?? '');
      // Two newlines so the credit reads as a separate line under the caption
      final = `${rewritten}\n\n${credit}`;
    }

    const now = new Date().toISOString();
    dbRun('UPDATE videos SET ai_description = ?, updated_at = ? WHERE id = ?', [final, now, id]);
    return this.getProject(id)!;
  }

  async cropVideoOutput(id: string, x: number, y: number, width: number, height: number): Promise<VideoProject> {
    const project = this.getProject(id);
    if (!project?.outputPath) throw new Error('No assembled video to crop');

    const info = await probeFile(project.outputPath);
    const vW = info.width ?? 1920;
    const vH = info.height ?? 1080;

    const px = Math.max(0, Math.round((x / 100) * vW));
    const py = Math.max(0, Math.round((y / 100) * vH));
    const pw = Math.max(4, Math.round((width / 100) * vW));
    const ph = Math.max(4, Math.round((height / 100) * vH));
    const cx = Math.min(px, vW - pw);
    const cy = Math.min(py, vH - ph);
    const cw = Math.min(pw, vW - cx);
    const ch = Math.min(ph, vH - cy);

    const outputName = `crop_${id}_${Date.now()}.mp4`;
    const outputPath = path.join(path.dirname(project.outputPath), outputName);
    await cropVideo(project.outputPath, outputPath, cx, cy, cw, ch);

    return this.updateOutputPath(id, outputPath)!;
  }

  // Repo / library taxonomy updates — pass `null` to clear category, omit a field to keep it.
  updateTaxonomy(
    id: string,
    changes: { category?: string | null; contentTags?: string[]; sourceVideoId?: string | null }
  ): VideoProject | undefined {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (changes.category !== undefined) {
      fields.push('category = ?');
      params.push(changes.category);
    }
    if (changes.contentTags !== undefined) {
      fields.push('content_tags = ?');
      params.push(JSON.stringify(changes.contentTags));
    }
    if (changes.sourceVideoId !== undefined) {
      fields.push('source_video_id = ?');
      params.push(changes.sourceVideoId);
    }
    if (fields.length === 0) return this.getProject(id);
    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);
    dbRun(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.getProject(id);
  }

  // List + filter completed videos for the Video Repo page. Filters compose: status defaults
  // to 'completed', `category` matches exactly, `tag` matches any tag in content_tags,
  // `q` does a case-insensitive title search.
  listRepoVideos(filter: {
    category?: string;
    tag?: string;
    q?: string;
    sourceVideoId?: string;
  } = {}): VideoProject[] {
    const where: string[] = ["status = 'completed'"];
    const params: unknown[] = [];

    if (filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }
    if (filter.sourceVideoId) {
      where.push('source_video_id = ?');
      params.push(filter.sourceVideoId);
    }
    if (filter.q) {
      where.push('LOWER(title) LIKE ?');
      params.push(`%${filter.q.toLowerCase()}%`);
    }
    if (filter.tag) {
      // content_tags is a JSON array stored as TEXT — LIKE on a quoted token is good enough
      // for short tag lists and avoids dragging in a JSON1 dependency.
      where.push('content_tags LIKE ?');
      params.push(`%"${filter.tag}"%`);
    }

    const rows = dbAll<DbVideo>(
      `SELECT * FROM videos WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 200`,
      params
    );
    return rows.map(mapDbVideo);
  }

  // Returns the set of distinct category and content-tag values in use, for filter chips.
  getRepoFacets(): { categories: string[]; tags: string[] } {
    const catRows = dbAll<{ category: string }>(
      "SELECT DISTINCT category FROM videos WHERE status = 'completed' AND category IS NOT NULL AND category != '' ORDER BY category"
    );
    const tagRows = dbAll<{ content_tags: string }>(
      "SELECT content_tags FROM videos WHERE status = 'completed' AND content_tags IS NOT NULL AND content_tags != '[]'"
    );
    const tagSet = new Set<string>();
    for (const r of tagRows) {
      try {
        for (const t of JSON.parse(r.content_tags) as string[]) tagSet.add(t);
      } catch {
        /* skip malformed */
      }
    }
    return {
      categories: catRows.map((r) => r.category),
      tags: Array.from(tagSet).sort(),
    };
  }

  getProjectStats(): {
    total: number;
    completed: number;
    generating: number;
    draft: number;
  } {
    const total = (dbGet<{ n: number }>('SELECT COUNT(*) as n FROM videos') ?? { n: 0 }).n;
    const completed = (dbGet<{ n: number }>("SELECT COUNT(*) as n FROM videos WHERE status='completed'") ?? { n: 0 }).n;
    const generating = (dbGet<{ n: number }>("SELECT COUNT(*) as n FROM videos WHERE status IN ('generating','assembling')") ?? { n: 0 }).n;
    const draft = (dbGet<{ n: number }>("SELECT COUNT(*) as n FROM videos WHERE status='draft' OR status='script-ready'") ?? { n: 0 }).n;
    return { total, completed, generating, draft };
  }

  async splitVideo(
    videoId: string,
    segmentDuration: number
  ): Promise<{ index: number; filename: string; startTime: number; duration: number }[]> {
    const project = this.getProject(videoId);
    const outputPath = project?.outputPath;
    if (!outputPath || !fs.existsSync(outputPath)) {
      throw new Error('No assembled video file found. Please assemble the video first.');
    }

    const info = await probeFile(outputPath);
    const totalDuration = info.duration;
    if (!totalDuration || totalDuration <= 0) throw new Error('Could not determine video duration.');

    const splitsDir = path.join(path.dirname(outputPath), `${videoId}_splits`);
    fs.mkdirSync(splitsDir, { recursive: true });

    // Remove stale splits from prior runs
    for (const f of fs.readdirSync(splitsDir)) {
      fs.rmSync(path.join(splitsDir, f));
    }

    const ffmpegPath = resolveFfmpegPathSync('ffmpeg');
    const outputPattern = path.join(splitsDir, 'segment_%03d.mp4');

    try {
      await execFileAsync(ffmpegPath, [
        '-i', outputPath,
        '-f', 'segment',
        '-segment_time', String(segmentDuration),
        '-reset_timestamps', '1',
        '-avoid_negative_ts', 'make_zero',
        '-c', 'copy',
        '-loglevel', 'warning',
        outputPattern,
      ], { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
    } catch (err: unknown) {
      // execFile puts stderr in err.stderr — surface it
      const msg = (err as { stderr?: string })?.stderr ?? String(err);
      throw new Error(`FFmpeg split failed: ${msg.slice(0, 300)}`);
    }

    const files = fs.readdirSync(splitsDir)
      .filter((f) => /^segment_\d+\.mp4$/.test(f))
      .sort();

    return files.map((filename, i) => ({
      index: i,
      filename,
      startTime: Math.round(i * segmentDuration * 10) / 10,
      duration: Math.min(segmentDuration, Math.max(0, Math.round((totalDuration - i * segmentDuration) * 10) / 10)),
    }));
  }

  getSplitsDir(videoId: string): string | null {
    const outputPath = this.getProject(videoId)?.outputPath;
    if (!outputPath) return null;
    return path.join(path.dirname(outputPath), `${videoId}_splits`);
  }
}
