import { YoutubeUploadProvider } from './youtube';
import { TikTokUploadProvider } from './tiktok';
import { InstagramUploadProvider } from './instagram';
import type { Platform } from '@videocloudai/shared';
import type { BaseUploadProvider } from './base';

const PROVIDERS: Partial<Record<Platform, BaseUploadProvider>> = {
  'youtube-shorts': new YoutubeUploadProvider(),
  'tiktok': new TikTokUploadProvider(),
  'instagram-reels': new InstagramUploadProvider(),
  'facebook-reels': new InstagramUploadProvider(), // same Meta API
};

export function getUploadProvider(platform: Platform): BaseUploadProvider | undefined {
  return PROVIDERS[platform];
}

export { BaseUploadProvider };
export type { OAuthCallbackResult, UploadResult } from './base';
