export type MotionEffect = 'static' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';

export interface SceneClipConfig {
  imageSrc: string;
  motion: MotionEffect;
  durationInFrames: number;
  bgColor?: string;
}

export interface IntroConfig {
  creatorName: string;
  tagline?: string;
  accentColor: string;
  style: 'minimal' | 'cinematic' | 'bold';
  durationInFrames: number;
}

export interface OutroConfig {
  creatorName: string;
  socialHandle?: string;
  ctaText: string;
  accentColor: string;
  durationInFrames: number;
}

export interface ComparisonSceneConfig {
  durationInFrames: number;
  leftMediaSrc: string;
  leftMediaType: 'image' | 'video';
  leftName: string;
  leftScore: number;
  rightMediaSrc: string;
  rightMediaType: 'image' | 'video';
  rightName: string;
  rightScore: number;
  mascotSrc: string;
  layout: {
    left: { x: number; y: number; w: number; h: number };
    mascot: { x: number; y: number; w: number; h: number };
    right: { x: number; y: number; w: number; h: number };
  };
  activeSide: 'left' | 'right' | 'both' | 'win-left' | 'win-right';
  roundLabel?: string;
  roundPanels: boolean;
  bgType: 'color' | 'image' | 'video';
  bgSrc: string;
  stickerSrc?: string;
}

