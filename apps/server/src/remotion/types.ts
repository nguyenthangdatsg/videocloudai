export type MotionEffect = 'static' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';

export interface ChartBigNumberConfig {
  durationInFrames: number;
  /** Animation duration in frames. If omitted, defaults to 0.95 * durationInFrames */
  animationFrames?: number;
  value: number;
  prefix?: string;
  suffix?: string;
  label?: string;
  sourceLabel?: string;
  accentColor?: string;
  bgColor?: string;
}

export interface ChartLineConfig {
  durationInFrames: number;
  animationFrames?: number;
  dataPoints: { label: string; value: number }[];
  title?: string;
  sourceLabel?: string;
  accentColor?: string;
  bgColor?: string;
}

export interface ChartBarsConfig {
  durationInFrames: number;
  animationFrames?: number;
  bars: { name: string; value: number }[];
  title?: string;
  sourceLabel?: string;
  accentColor?: string;
  bgColor?: string;
  sortOrder?: 'asc' | 'desc' | 'scripted';
}

export interface ChartVsConfig {
  durationInFrames: number;
  animationFrames?: number;
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
  title?: string;
  accentColor?: string;
  bgColor?: string;
}

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

export interface SplitScreenConfig {
  durationInFrames: number;
  leftSrc: string;
  leftType: 'image' | 'video';
  rightSrc: string;
  rightType: 'image' | 'video';
  middleText?: string;
  middleStyle?: 'vs' | 'line' | 'glow' | 'badge' | 'none';
  accentColor?: string;
  bgColor?: string;
  leftLabel?: string;
  rightLabel?: string;
  gap?: number;
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

