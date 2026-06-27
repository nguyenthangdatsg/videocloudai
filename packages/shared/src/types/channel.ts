export type Platform =
  | 'tiktok'
  | 'youtube-shorts'
  | 'instagram-reels'
  | 'facebook-reels'
  | 'twitter'
  | 'custom';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface Channel {
  id: string;
  name: string;
  platform: Platform;
  handle?: string;
  url?: string;
  description?: string;
  isActive: boolean;
  oauthTokens?: OAuthTokens;
  platformUserId?: string;
  platformUsername?: string;
  connected: boolean;
  defaultCaption?: string;
  defaultHashtags?: string;
  createdAt: string;
  updatedAt: string;
}

// Manual workflow: pending → exported (file ready to download) → uploaded (user posted manually)
export type DistributionStatus = 'pending' | 'exported' | 'uploaded' | 'failed';

export interface Distribution {
  id: string;
  videoId: string;
  channelId: string;
  channel?: Channel;
  status: DistributionStatus;
  exportPath?: string;     // local path to the platform-encoded file
  publishedAt?: string;    // when user marked as uploaded
  platformUrl?: string;    // link to the actual post (user-entered)
  note?: string;
  performanceNote?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
