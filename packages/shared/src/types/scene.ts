export type SceneMood =
  | 'sad'
  | 'hopeful'
  | 'dramatic'
  | 'energetic'
  | 'calm'
  | 'mysterious'
  | 'romantic'
  | 'dark'
  | 'uplifting'
  | 'tense'
  | 'melancholic'
  | 'euphoric';

export type SceneStyle =
  | 'anime-cinematic'
  | 'documentary'
  | 'noir'
  | 'dark-fantasy'
  | 'sci-fi'
  | 'emotional-storytelling'
  | 'cyberpunk'
  | 'natural'
  | 'vintage'
  | 'modern';

export type CameraType =
  | 'handheld'
  | 'dolly'
  | 'aerial'
  | 'closeup'
  | 'wide-shot'
  | 'tracking'
  | 'static'
  | 'pov'
  | 'crane';

export type AtmosphereType =
  | 'rainy'
  | 'foggy'
  | 'sunny'
  | 'overcast'
  | 'night'
  | 'golden-hour'
  | 'blue-hour'
  | 'stormy'
  | 'clear'
  | 'smoky';

export type AssetType = 'video' | 'image' | 'audio';

export type SceneCategory =
  | 'rainy-city'
  | 'emotional-closeup'
  | 'cyberpunk-street'
  | 'aerial-skyline'
  | 'person-alone'
  | 'dramatic-sunset'
  | 'crowd-timelapse'
  | 'anime-city-night'
  | 'nature'
  | 'interior'
  | 'action'
  | 'transition'
  | 'custom';

export interface SceneMetadata {
  id: string;
  title: string;
  description: string;
  category: SceneCategory;
  tags: string[];
  mood: SceneMood;
  style: SceneStyle;
  cameraType: CameraType;
  atmosphere: AtmosphereType;
  duration: number;
  reuseKeywords: string[];
  usageCount: number;
  qualityScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface SceneLine {
  line: string;
  visual: string;
  mood: SceneMood;
  duration: number;
  style?: SceneStyle;
  cameraType?: CameraType;
  atmosphere?: AtmosphereType;
  tags?: string[];
}

import type { AssetRecord } from './asset';

export interface SceneMatch {
  sceneId: string;
  score: number;
  matchReason: string[];
  asset: AssetRecord;
}
