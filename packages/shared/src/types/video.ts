import type { SceneLine } from './scene';

export type VideoStatus =
  | 'draft'
  | 'script-ready'
  | 'generating'
  | 'assembling'
  | 'completed'
  | 'failed'
  | 'exported';

export type VideoFormat = 'tiktok' | 'youtube-shorts' | 'instagram-reels' | 'youtube' | 'custom';
export type VideoDuration = 15 | 30 | 45 | 60 | 120 | 180 | 300 | 600;
export type VideoResolution = '1080x1920' | '720x1280' | '1080x1080' | '1920x1080';
export type VideoFPS = 24 | 30;

export interface BlurRegion {
  id: string;
  x: number;        // left edge as % of video width (0–100)
  y: number;        // top edge as % of video height (0–100)
  width: number;    // width as % of video width (0–100)
  height: number;   // height as % of video height (0–100)
  strength: number; // blur: avgblur sigma (1–30); pixelate: block size in px (4–30)
  type: 'blur' | 'pixelate';
}

export interface TextOverlay {
  id: string;
  text: string;
  x: number;           // center X as % of video width (0–100)
  y: number;           // center Y as % of video height (0–100)
  width: number;       // box width as % of video width (5–100)
  height: number;      // box height as % of video height (2–100)
  fontSize: number;    // as % of video height (1–20)
  fontFamily: string;  // e.g. 'Arial', 'Impact', 'Montserrat'
  fontWeight: 'normal' | 'bold';
  color: string;       // hex e.g. '#FFFFFF'
  bgColor: string;     // hex with alpha e.g. '#00000080', empty = no bg
  opacity: number;     // 0–1
  rotation: number;    // degrees
  startTime?: number;  // seconds; undefined = full duration
  endTime?: number;    // seconds; undefined = full duration
  animation: 'none' | 'fade-in' | 'slide-up' | 'pop' | 'typewriter';
}

export interface VideoProject {
  id: string;
  title: string;
  description?: string;
  script: string;
  scenes: SceneLine[];
  status: VideoStatus;
  format: VideoFormat;
  duration: VideoDuration;
  resolution: VideoResolution;
  fps: VideoFPS;
  narrationEnabled: boolean;
  narrationVoice?: string;
  narrationRate?: string;
  subtitlesEnabled: boolean;
  musicEnabled: boolean;
  muteOriginalAudio: boolean;
  musicMood?: string;
  musicTrackPath?: string;
  blurRegions?: BlurRegion[];
  textOverlays?: TextOverlay[];
  outputPath?: string;
  thumbnailPath?: string;
  // Library / repo taxonomy
  category?: string;
  contentTags?: string[];
  sourceVideoId?: string;
  // Social-media import metadata + Groq-rewritten caption
  originalDescription?: string;
  importedFromUrl?: string;
  originalAuthor?: string;
  originalAuthorUrl?: string;
  aiDescription?: string;
  // Upload tracking — set by the user via the editor after assembly finishes.
  // pending     = haven't touched it yet
  // in_progress = started working / editing, not done
  // uploaded    = finished and posted
  uploadStatus?: 'pending' | 'in_progress' | 'uploaded';
  uploadedAt?: string;
  uploadNote?: string;
  metadata: VideoMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface VideoMetadata {
  totalDuration?: number;
  sceneCount?: number;
  generatedSceneCount?: number;
  reusedSceneCount?: number;
  renderTimeMs?: number;
  filesize?: number;
  exportedAt?: string;
  exportPlatforms?: VideoFormat[];
  narrationVoice?: string;
  musicTrack?: string;
}

export interface VideoTimeline {
  videoId: string;
  clips: TimelineClip[];
  totalDuration: number;
  narrationPath?: string;
  musicPath?: string;
  musicVolume?: number;
  subtitlesPath?: string;
  introPath?: string;
  outroPath?: string;
}

export interface TimelineClip {
  id: string;
  assetPath: string;
  startTime: number;
  duration: number;
  transition?: TransitionType;
  motionEffect?: MotionEffectType;
  subtitleText?: string;
  volume?: number;
}

export type TransitionType = 'cut' | 'fade' | 'dissolve' | 'wipe';
export type MotionEffectType =
  | 'ken-burns-in'
  | 'ken-burns-out'
  | 'pan-left'
  | 'pan-right'
  | 'slow-zoom'
  | 'drift'
  | 'handheld'
  | 'static';

export interface BatchJob {
  id: string;
  templateVideoId: string;
  variationCount: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  completedCount: number;
  failedCount: number;
  outputVideoIds: string[];
  createdAt: string;
  completedAt?: string;
}
