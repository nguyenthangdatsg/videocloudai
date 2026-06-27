import type { AssetType, SceneMood, SceneStyle, CameraType, AtmosphereType } from './scene';

export type GenerationStatus = 'pending' | 'generating' | 'completed' | 'failed' | 'cached';
export type AssetStatus = 'active' | 'archived' | 'deleted';

export interface AssetRecord {
  id: string;
  sceneId?: string;
  generationId?: string;
  type: AssetType;
  filename: string;
  filepath: string;
  url?: string;
  width?: number;
  height?: number;
  duration?: number;
  filesize: number;
  mimeType: string;
  checksum: string;
  status: AssetStatus;
  metadata: AssetMetadata;
  createdAt: string;
}

export interface AssetMetadata {
  provider?: string;
  promptId?: string;
  tags: string[];
  mood?: SceneMood;
  style?: SceneStyle;
  cameraType?: CameraType;
  atmosphere?: AtmosphereType;
  reuseKeywords: string[];
  usageCount: number;
  qualityScore?: number;
}

export interface ReusableClip {
  id: string;
  assetId: string;
  title: string;
  description: string;
  tags: string[];
  mood: SceneMood[];
  style: SceneStyle[];
  reuseContexts: string[];
  usageCount: number;
  lastUsedAt?: string;
  asset?: AssetRecord;
}
