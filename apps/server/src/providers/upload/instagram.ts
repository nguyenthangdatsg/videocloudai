import fs from 'fs';
import { BaseUploadProvider, OAuthCallbackResult, UploadResult } from './base';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

export class InstagramUploadProvider extends BaseUploadProvider {
  readonly platform = 'instagram-reels';
  readonly requiredScopes = [
    'instagram_basic',
    'instagram_content_publish',
    'pages_read_engagement',
  ];

  getOAuthUrl(params: { clientId: string; redirectUri: string; state: string }): string {
    const q = new URLSearchParams({
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: this.requiredScopes.join(','),
      state: params.state,
    });
    return `https://www.facebook.com/dialog/oauth?${q.toString()}`;
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<OAuthCallbackResult> {
    const q = new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      code: params.code,
    });

    const res = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?${q.toString()}`,
      { method: 'GET' }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Instagram token exchange failed: ${err}`);
    }

    const data = await res.json() as {
      access_token: string;
      token_type?: string;
      expires_in?: number;
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Instagram token exchange error: ${data.error.message}`);
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : undefined;

    // Fetch Instagram user ID
    let userId: string | undefined;
    let username: string | undefined;
    try {
      const meRes = await fetch(
        `https://graph.instagram.com/v19.0/me?fields=id,username&access_token=${data.access_token}`
      );
      if (meRes.ok) {
        const meData = await meRes.json() as { id?: string; username?: string };
        userId = meData.id;
        username = meData.username;
      }
    } catch {
      // Non-fatal
    }

    return {
      accessToken: data.access_token,
      expiresAt,
      userId,
      username,
    };
  }

  async refreshAccessToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ accessToken: string; expiresAt?: string }> {
    // Instagram uses long-lived tokens; refresh via token exchange
    const q = new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: params.refreshToken,
    });

    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?${q.toString()}`,
      { method: 'GET' }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Instagram token refresh failed: ${err}`);
    }

    const data = await res.json() as { access_token: string; expires_in?: number };
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : undefined;

    return { accessToken: data.access_token, expiresAt };
  }

  async uploadVideo(params: {
    accessToken: string;
    videoPath: string;
    title: string;
    description?: string;
    tags?: string[];
    privacyStatus: 'public' | 'private' | 'unlisted';
    onProgress?: (pct: number, msg: string) => void;
  }): Promise<UploadResult> {
    const { accessToken, videoPath, title, description, tags, onProgress } = params;

    onProgress?.(5, 'Fetching Instagram user ID');

    // Get Instagram user ID if not cached
    const meRes = await fetch(
      `https://graph.instagram.com/v19.0/me?fields=id,username&access_token=${accessToken}`
    );

    if (!meRes.ok) {
      const err = await meRes.text();
      throw new Error(`Failed to get Instagram user ID: ${err}`);
    }

    const meData = await meRes.json() as { id: string; username?: string };
    const igUserId = meData.id;

    const caption = [
      description ?? title,
      ...(tags ?? []).map((t) => `#${t.replace(/^#/, '')}`),
    ]
      .filter(Boolean)
      .join('\n\n');

    onProgress?.(10, 'Creating Instagram media container');

    // Step 1: Create media container (resumable)
    const containerRes = await fetch(
      `https://graph.instagram.com/v19.0/${igUserId}/media`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `OAuth ${accessToken}`,
        },
        body: JSON.stringify({
          media_type: 'REELS',
          upload_type: 'resumable',
          caption,
        }),
      }
    );

    if (!containerRes.ok) {
      const err = await containerRes.text();
      throw new Error(`Instagram media container creation failed: ${err}`);
    }

    const containerData = await containerRes.json() as {
      id?: string;
      video_upload_url?: string;
      uri?: string;
      error?: { message: string };
    };

    if (containerData.error) {
      throw new Error(`Instagram media container error: ${containerData.error.message}`);
    }

    const creationId = containerData.id;
    if (!creationId) {
      throw new Error('Instagram did not return a creation ID');
    }

    const videoUploadUrl = containerData.video_upload_url ?? containerData.uri;
    if (!videoUploadUrl) {
      throw new Error('Instagram did not return a video upload URL');
    }

    onProgress?.(15, 'Uploading video to Instagram');

    // Step 2: Chunked upload
    const stat = fs.statSync(videoPath);
    const videoSize = stat.size;
    const chunkCount = Math.ceil(videoSize / CHUNK_SIZE);

    const fileHandle = fs.openSync(videoPath, 'r');
    try {
      for (let i = 0; i < chunkCount; i++) {
        const offset = i * CHUNK_SIZE;
        const chunkSize = Math.min(CHUNK_SIZE, videoSize - offset);
        const buffer = Buffer.alloc(chunkSize);
        fs.readSync(fileHandle, buffer, 0, chunkSize, offset);

        const chunkRes = await fetch(videoUploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `OAuth ${accessToken}`,
            'Content-Type': 'video/mp4',
            'Content-Length': chunkSize.toString(),
            'Content-Range': `bytes ${offset}-${offset + chunkSize - 1}/${videoSize}`,
          },
          body: buffer,
        });

        // 206 = partial content accepted, 200 = final chunk accepted
        if (!chunkRes.ok && chunkRes.status !== 206) {
          const err = await chunkRes.text();
          throw new Error(`Instagram chunk ${i + 1}/${chunkCount} upload failed: ${err}`);
        }

        const pct = 15 + Math.round(((i + 1) / chunkCount) * 60);
        onProgress?.(pct, `Uploading chunk ${i + 1}/${chunkCount}`);
      }
    } finally {
      fs.closeSync(fileHandle);
    }

    onProgress?.(75, 'Waiting for Instagram to process video');

    // Step 3: Poll container status
    let attempts = 0;
    const maxAttempts = 24; // up to 2 minutes
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 5000));
      attempts++;

      const statusRes = await fetch(
        `https://graph.instagram.com/v19.0/${creationId}?fields=status_code,status&access_token=${accessToken}`
      );

      if (!statusRes.ok) continue;

      const statusData = await statusRes.json() as { status_code?: string; status?: string };
      const code = statusData.status_code ?? statusData.status;

      if (code === 'FINISHED' || code === 'READY') {
        break;
      }

      if (code === 'ERROR') {
        throw new Error('Instagram video processing failed');
      }

      const pct = 75 + Math.round((attempts / maxAttempts) * 15);
      onProgress?.(Math.min(pct, 90), `Processing… (${code ?? 'pending'})`);
    }

    onProgress?.(90, 'Publishing Reel');

    // Step 4: Publish
    const publishRes = await fetch(
      `https://graph.instagram.com/v19.0/${igUserId}/media_publish`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `OAuth ${accessToken}`,
        },
        body: JSON.stringify({ creation_id: creationId }),
      }
    );

    if (!publishRes.ok) {
      const err = await publishRes.text();
      throw new Error(`Instagram publish failed: ${err}`);
    }

    const publishData = await publishRes.json() as { id?: string; error?: { message: string } };

    if (publishData.error) {
      throw new Error(`Instagram publish error: ${publishData.error.message}`);
    }

    onProgress?.(100, 'Upload complete');

    return {
      postId: publishData.id ?? creationId,
      postUrl: publishData.id
        ? `https://www.instagram.com/reel/${publishData.id}/`
        : undefined,
    };
  }

  async testConnection(accessToken: string): Promise<{ ok: true; username?: string } | { ok: false; error: string }> {
    try {
      const res = await fetch(
        `https://graph.instagram.com/v19.0/me?fields=id,username&access_token=${accessToken}`
      );
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `Instagram API error ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = await res.json() as { id?: string; username?: string; error?: { message: string } };
      if (data.error) return { ok: false, error: data.error.message };
      return { ok: true, username: data.username };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
