import fs from 'fs';
import { BaseUploadProvider, OAuthCallbackResult, UploadResult } from './base';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

export class TikTokUploadProvider extends BaseUploadProvider {
  readonly platform = 'tiktok';
  readonly requiredScopes = ['user.info.basic', 'video.publish', 'video.upload'];

  getOAuthUrl(params: { clientId: string; redirectUri: string; state: string }): string {
    const q = new URLSearchParams({
      client_key: params.clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: this.requiredScopes.join(','),
      state: params.state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${q.toString()}`;
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<OAuthCallbackResult> {
    const body = new URLSearchParams({
      client_key: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
    });

    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`TikTok token exchange failed: ${err}`);
    }

    const data = await res.json() as {
      data?: {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        open_id?: string;
      };
      error?: string;
      error_description?: string;
    };

    if (data.error) {
      throw new Error(`TikTok token exchange error: ${data.error_description ?? data.error}`);
    }

    const tokenData = data.data!;
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : undefined;

    // Fetch user info
    let username: string | undefined;
    const userId = tokenData.open_id;
    try {
      const userRes = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=display_name,username',
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      if (userRes.ok) {
        const userData = await userRes.json() as {
          data?: { user?: { display_name?: string; username?: string } };
        };
        username = userData.data?.user?.display_name ?? userData.data?.user?.username;
      }
    } catch {
      // Non-fatal
    }

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
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
    const body = new URLSearchParams({
      client_key: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
    });

    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`TikTok token refresh failed: ${err}`);
    }

    const data = await res.json() as {
      data?: { access_token: string; expires_in?: number };
      error?: string;
    };

    if (data.error) throw new Error(`TikTok refresh error: ${data.error}`);

    const tokenData = data.data!;
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : undefined;

    return { accessToken: tokenData.access_token, expiresAt };
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
    const { accessToken, videoPath, title, privacyStatus, onProgress } = params;

    const stat = fs.statSync(videoPath);
    const videoSize = stat.size;
    const chunkCount = Math.ceil(videoSize / CHUNK_SIZE);

    const privacyMap: Record<string, string> = {
      public: 'PUBLIC_TO_EVERYONE',
      private: 'SELF_ONLY',
      unlisted: 'MUTUAL_FOLLOW_FRIENDS',
    };

    onProgress?.(5, 'Initializing TikTok upload');

    // Step 1: Initialize upload
    const initRes = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: title.slice(0, 2200),
            privacy_level: privacyMap[privacyStatus] ?? 'SELF_ONLY',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: videoSize,
            chunk_size: CHUNK_SIZE,
            total_chunk_count: chunkCount,
          },
        }),
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`TikTok upload init failed: ${err}`);
    }

    const initData = await initRes.json() as {
      data?: { publish_id: string; upload_url: string };
      error?: { code?: string; message?: string };
    };

    if (initData.error?.code && initData.error.code !== 'ok') {
      throw new Error(`TikTok upload init error: ${initData.error.message ?? initData.error.code}`);
    }

    const { publish_id: publishId, upload_url: uploadUrl } = initData.data!;

    onProgress?.(10, 'Uploading video chunks to TikTok');

    // Step 2: Upload chunks
    const fileHandle = fs.openSync(videoPath, 'r');
    try {
      for (let i = 0; i < chunkCount; i++) {
        const offset = i * CHUNK_SIZE;
        const chunkSize = Math.min(CHUNK_SIZE, videoSize - offset);
        const buffer = Buffer.alloc(chunkSize);
        fs.readSync(fileHandle, buffer, 0, chunkSize, offset);

        const chunkRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes ${offset}-${offset + chunkSize - 1}/${videoSize}`,
            'Content-Length': chunkSize.toString(),
          },
          body: buffer,
        });

        if (!chunkRes.ok && chunkRes.status !== 206) {
          const err = await chunkRes.text();
          throw new Error(`TikTok chunk ${i + 1}/${chunkCount} upload failed: ${err}`);
        }

        const pct = 10 + Math.round(((i + 1) / chunkCount) * 70);
        onProgress?.(pct, `Uploading chunk ${i + 1}/${chunkCount}`);
      }
    } finally {
      fs.closeSync(fileHandle);
    }

    onProgress?.(80, 'Waiting for TikTok to process video');

    // Step 3: Poll publish status
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 5000));
      attempts++;

      const statusRes = await fetch(
        'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({ publish_id: publishId }),
        }
      );

      if (!statusRes.ok) continue;

      const statusData = await statusRes.json() as {
        data?: { status: string; fail_reason?: string; publicaly_available_post_id?: string[] };
        error?: { code?: string };
      };

      const status = statusData.data?.status;
      if (status === 'PUBLISH_COMPLETE') {
        onProgress?.(100, 'Upload complete');
        const postId = statusData.data?.publicaly_available_post_id?.[0] ?? publishId;
        return { postId, postUrl: undefined };
      }

      if (status === 'FAILED') {
        throw new Error(
          `TikTok processing failed: ${statusData.data?.fail_reason ?? 'unknown reason'}`
        );
      }

      const pct = 80 + Math.round((attempts / maxAttempts) * 15);
      onProgress?.(Math.min(pct, 95), `Processing… (${status ?? 'unknown'})`);
    }

    // Timeout — return publishId as best effort
    onProgress?.(100, 'Upload submitted (processing may still be in progress)');
    return { postId: publishId };
  }

  async testConnection(accessToken: string): Promise<{ ok: true; username?: string } | { ok: false; error: string }> {
    try {
      const res = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `TikTok API error ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = await res.json() as {
        data?: { user?: { display_name?: string; username?: string } };
        error?: { code?: string; message?: string };
      };
      if (data.error?.code && data.error.code !== 'ok') {
        return { ok: false, error: data.error.message ?? data.error.code ?? 'Unknown error' };
      }
      const username = data.data?.user?.display_name ?? data.data?.user?.username;
      return { ok: true, username };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
