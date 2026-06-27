export interface OAuthCallbackResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  userId?: string;
  username?: string;
}

export interface UploadResult {
  postId: string;
  postUrl?: string;
}

export abstract class BaseUploadProvider {
  abstract readonly platform: string;
  abstract readonly requiredScopes: string[];

  abstract getOAuthUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string;

  abstract exchangeCode(params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<OAuthCallbackResult>;

  abstract refreshAccessToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ accessToken: string; expiresAt?: string }>;

  abstract uploadVideo(params: {
    accessToken: string;
    videoPath: string;
    title: string;
    description?: string;
    tags?: string[];
    privacyStatus: 'public' | 'private' | 'unlisted';
    onProgress?: (pct: number, msg: string) => void;
  }): Promise<UploadResult>;

  // Verify the token is valid with a lightweight API call.
  abstract testConnection(accessToken: string): Promise<{ ok: true; username?: string } | { ok: false; error: string }>;
}
