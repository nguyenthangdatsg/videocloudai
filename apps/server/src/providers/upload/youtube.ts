import fs from 'fs';
import https from 'https';
import path from 'path';
import { BaseUploadProvider, OAuthCallbackResult, UploadResult } from './base';

export class YoutubeUploadProvider extends BaseUploadProvider {
  readonly platform = 'youtube-shorts';
  readonly requiredScopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
  ];

  getOAuthUrl(params: { clientId: string; redirectUri: string; state: string }): string {
    const q = new URLSearchParams({
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: this.requiredScopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: params.state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
  }

  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<OAuthCallbackResult> {
    const body = new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`YouTube token exchange failed: ${err}`);
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : undefined;

    // Fetch channel info for username
    let username: string | undefined;
    let userId: string | undefined;
    try {
      const channelRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: { Authorization: `Bearer ${data.access_token}` } }
      );
      if (channelRes.ok) {
        const channelData = await channelRes.json() as {
          items?: Array<{ id: string; snippet: { title: string } }>;
        };
        if (channelData.items?.[0]) {
          userId = channelData.items[0].id;
          username = channelData.items[0].snippet.title;
        }
      }
    } catch {
      // Non-fatal — we still have the tokens
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
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
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'refresh_token',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`YouTube token refresh failed: ${err}`);
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
    const { accessToken, videoPath, title, description, tags, privacyStatus, onProgress } = params;

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;

    onProgress?.(5, 'Initiating YouTube upload session');

    // Step 1: Initiate resumable upload
    const metadata = {
      snippet: {
        title,
        description: description ?? '',
        tags: tags ?? [],
        categoryId: '22',
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    };

    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': fileSize.toString(),
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error(`YouTube upload initiation failed: ${err}`);
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      throw new Error('YouTube did not return an upload URL');
    }

    onProgress?.(10, 'Uploading video to YouTube');

    // Step 2: Stream file to upload URL
    const videoId = await new Promise<string>((resolve, reject) => {
      const urlObj = new URL(uploadUrl);
      const options: https.RequestOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': fileSize,
          Authorization: `Bearer ${accessToken}`,
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(body) as { id?: string };
              if (parsed.id) {
                resolve(parsed.id);
              } else {
                reject(new Error(`YouTube upload succeeded but no video id returned: ${body}`));
              }
            } catch {
              reject(new Error(`Failed to parse YouTube upload response: ${body}`));
            }
          } else {
            reject(new Error(`YouTube upload failed with status ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', reject);

      const readStream = fs.createReadStream(videoPath);
      let bytesUploaded = 0;

      readStream.on('data', (chunk: unknown) => {
        const len = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk as string);
        bytesUploaded += len;
        const pct = 10 + Math.round((bytesUploaded / fileSize) * 85);
        onProgress?.(Math.min(pct, 95), `Uploading… ${Math.round((bytesUploaded / fileSize) * 100)}%`);
      });

      readStream.pipe(req);
    });

    onProgress?.(100, 'Upload complete');

    return {
      postId: videoId,
      postUrl: `https://youtube.com/shorts/${videoId}`,
    };
  }

  async testConnection(accessToken: string): Promise<{ ok: true; username?: string } | { ok: false; error: string }> {
    try {
      const res = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `YouTube API error ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = await res.json() as { items?: Array<{ snippet: { title: string } }> };
      const username = data.items?.[0]?.snippet?.title;
      return { ok: true, username };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
