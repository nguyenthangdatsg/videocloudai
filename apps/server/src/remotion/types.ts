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
