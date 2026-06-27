import type { SceneMood } from '@videocloudai/shared';

export type RecommendationType =
  | 'zoom-punch'
  | 'transition'
  | 'cut'
  | 'subtitle-emphasis'
  | 'commentary-overlay'
  | 'pacing-slow'
  | 'pacing-fast'
  | 'emotional-highlight'
  | 'mood-shift'
  | 'add-effect'
  | 'split-screen'
  | 'scene-restructure';

export type CinematicEffect =
  | 'film-grain'
  | 'light-leak'
  | 'handheld-shake'
  | 'speed-ramp'
  | 'zoom-punch'
  | 'glow'
  | 'anime-flash'
  | 'manga-lines'
  | 'vignette'
  | 'color-grade';

export type TransitionType =
  | 'cut'
  | 'fade'
  | 'dissolve'
  | 'zoom-in'
  | 'zoom-out'
  | 'whip-pan'
  | 'glitch'
  | 'flash';

export type SubtitleStyle =
  | 'default'
  | 'tiktok'
  | 'anime'
  | 'documentary'
  | 'keyword-emphasis'
  | 'animated';

export type PresetId =
  | 'cinematic'
  | 'documentary'
  | 'anime-edit'
  | 'tiktok-viral'
  | 'hyper-edit'
  | 'emotional'
  | 'storytelling'
  | 'commentary'
  | 'podcast-clip'
  | 'motivational';

export type PacingType = 'slow' | 'medium' | 'fast' | 'variable';

export type PresetColor =
  | 'amber' | 'blue' | 'pink' | 'red' | 'purple'
  | 'violet' | 'green' | 'cyan' | 'orange' | 'yellow';

export interface Recommendation {
  id: string;
  type: RecommendationType;
  sceneIndex?: number;
  message: string;
  detail?: string;
  confidence: number;
  actionLabel: string;
  effect?: CinematicEffect;
  transition?: TransitionType;
  subtitleStyle?: SubtitleStyle;
}

export interface EditPreset {
  id: PresetId;
  label: string;
  description: string;
  emoji: string;
  pacing: PacingType;
  subtitleStyle: SubtitleStyle;
  effects: CinematicEffect[];
  transitions: TransitionType[];
  durationMultiplier: number;
  color: PresetColor;
}

export interface AppliedEdit {
  sceneIndex: number;
  effects: CinematicEffect[];
  transition?: TransitionType;
  subtitleStyle?: SubtitleStyle;
  durationMultiplier: number;
}

export const EFFECT_LABELS: Record<CinematicEffect, string> = {
  'film-grain': 'Film Grain',
  'light-leak': 'Light Leak',
  'handheld-shake': 'Handheld',
  'speed-ramp': 'Speed Ramp',
  'zoom-punch': 'Zoom Punch',
  'glow': 'Glow',
  'anime-flash': 'Anime Flash',
  'manga-lines': 'Manga Lines',
  'vignette': 'Vignette',
  'color-grade': 'Color Grade',
};

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  'cut': 'Hard Cut',
  'fade': 'Fade',
  'dissolve': 'Dissolve',
  'zoom-in': 'Zoom In',
  'zoom-out': 'Zoom Out',
  'whip-pan': 'Whip Pan',
  'glitch': 'Glitch',
  'flash': 'Flash',
};

export const SUBTITLE_STYLE_LABELS: Record<SubtitleStyle, string> = {
  'default': 'Default',
  'tiktok': 'TikTok Bold',
  'anime': 'Anime',
  'documentary': 'Documentary',
  'keyword-emphasis': 'Keyword Highlight',
  'animated': 'Animated',
};
