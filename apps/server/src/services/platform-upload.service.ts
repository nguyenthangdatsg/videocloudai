import path from 'path';
import { getSettings } from './settings.service';
import { ChannelService } from './channel.service';
import { DistributionService } from './distribution.service';
import { getUploadProvider } from '../providers/upload';
import { getJobQueue } from '../queue/queue';
import type { Channel, Platform } from '@videocloudai/shared';
import type { UploadResult } from '../providers/upload';

const REDIRECT_BASE = process.env.OAUTH_REDIRECT_BASE ?? `http://localhost:${process.env.PORT || '3002'}`;

function getRedirectUri(platform: string): string {
  return `${REDIRECT_BASE}/api/oauth/${platform}/callback`;
}

function getPlatformCredentials(platform: Platform): {
  clientId: string;
  clientSecret: string;
} {
  const settings = getSettings();
  switch (platform) {
    case 'youtube-shorts':
      return {
        clientId: settings.get('youtube_client_id'),
        clientSecret: settings.get('youtube_client_secret'),
      };
    case 'tiktok':
      return {
        clientId: settings.get('tiktok_client_key'),
        clientSecret: settings.get('tiktok_client_secret'),
      };
    case 'instagram-reels':
    case 'facebook-reels':
      return {
        clientId: settings.get('instagram_app_id'),
        clientSecret: settings.get('instagram_app_secret'),
      };
    default:
      return { clientId: '', clientSecret: '' };
  }
}

export class PlatformUploadService {
  constructor(
    private readonly channelService: ChannelService,
    private readonly distributionService: DistributionService
  ) {}

  async getOAuthUrl(channelId: string): Promise<string> {
    const channel = this.channelService.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    const provider = getUploadProvider(channel.platform);
    if (!provider) {
      throw new Error(`No upload provider for platform: ${channel.platform}`);
    }

    const creds = getPlatformCredentials(channel.platform);
    if (!creds.clientId) {
      throw new Error(
        `No OAuth credentials configured for ${channel.platform}. Add them in Settings.`
      );
    }

    return provider.getOAuthUrl({
      clientId: creds.clientId,
      redirectUri: getRedirectUri(channel.platform),
      state: encodeURIComponent(channelId),
    });
  }

  async handleOAuthCallback(
    platform: string,
    code: string,
    channelId: string
  ): Promise<void> {
    const channel = this.channelService.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    const provider = getUploadProvider(channel.platform);
    if (!provider) throw new Error(`No upload provider for platform: ${platform}`);

    const creds = getPlatformCredentials(channel.platform);

    const result = await provider.exchangeCode({
      code,
      redirectUri: getRedirectUri(platform),
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });

    this.channelService.setOAuthTokens(
      channelId,
      {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
      },
      result.userId,
      result.username
    );
  }

  isTokenExpired(channel: Channel): boolean {
    if (!channel.oauthTokens?.expiresAt) return false;
    return new Date(channel.oauthTokens.expiresAt) < new Date(Date.now() + 5 * 60 * 1000);
  }

  async ensureFreshToken(channelId: string): Promise<string> {
    const channel = this.channelService.get(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);
    if (!channel.oauthTokens?.accessToken) {
      throw new Error(`Channel ${channelId} is not connected. Please connect it first.`);
    }

    if (this.isTokenExpired(channel) && channel.oauthTokens.refreshToken) {
      const provider = getUploadProvider(channel.platform);
      if (!provider) throw new Error(`No upload provider for platform: ${channel.platform}`);

      const creds = getPlatformCredentials(channel.platform);
      const refreshed = await provider.refreshAccessToken({
        refreshToken: channel.oauthTokens.refreshToken,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      });

      this.channelService.setOAuthTokens(
        channelId,
        {
          accessToken: refreshed.accessToken,
          refreshToken: channel.oauthTokens.refreshToken,
          expiresAt: refreshed.expiresAt,
        },
        channel.platformUserId,
        channel.platformUsername
      );

      return refreshed.accessToken;
    }

    return channel.oauthTokens.accessToken;
  }

  async testChannelConnection(channelId: string): Promise<{
    ok: boolean;
    username?: string;
    error?: string;
  }> {
    const channel = this.channelService.get(channelId);
    if (!channel) return { ok: false, error: 'Channel not found' };
    if (!channel.connected) return { ok: false, error: 'Channel not connected — complete OAuth first' };

    const provider = getUploadProvider(channel.platform);
    if (!provider) return { ok: false, error: `No upload support for ${channel.platform}` };

    let accessToken: string;
    try {
      accessToken = await this.ensureFreshToken(channelId);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    const result = await provider.testConnection(accessToken);

    if (result.ok && result.username && result.username !== channel.platformUsername) {
      // Refresh cached username on the channel record
      this.channelService.setOAuthTokens(
        channelId,
        channel.oauthTokens!,
        channel.platformUserId,
        result.username
      );
    }

    return result;
  }

  queueUpload(
    distributionId: string,
    opts: {
      title: string;
      description?: string;
      tags?: string[];
      privacyStatus?: 'public' | 'private' | 'unlisted';
    }
  ) {
    const queue = getJobQueue();
    return queue.enqueue('upload-to-platform', {
      distributionId,
      title: opts.title,
      description: opts.description ?? null,
      tags: opts.tags ?? [],
      privacyStatus: opts.privacyStatus ?? 'public',
    });
  }

  async executeUpload(
    distributionId: string,
    onProgress: (pct: number, msg: string) => void
  ): Promise<UploadResult> {
    const distribution = this.distributionService.get(distributionId);
    if (!distribution) throw new Error(`Distribution ${distributionId} not found`);

    const channel = this.channelService.get(distribution.channelId);
    if (!channel) throw new Error(`Channel ${distribution.channelId} not found`);
    if (!channel.connected) {
      throw new Error(`Channel "${channel.name}" is not connected. Please connect it in the Channels page.`);
    }

    if (!distribution.exportPath) {
      throw new Error(`Distribution ${distributionId} has no exported file. Export the video first.`);
    }

    const provider = getUploadProvider(channel.platform);
    if (!provider) {
      throw new Error(`No upload provider for platform: ${channel.platform}`);
    }

    const accessToken = await this.ensureFreshToken(channel.id);

    // Resolve absolute path
    const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders');
    const videoPath = path.isAbsolute(distribution.exportPath)
      ? distribution.exportPath
      : path.join(rendersDir, distribution.exportPath);

    onProgress(2, `Starting upload to ${channel.name}`);

    const result = await provider.uploadVideo({
      accessToken,
      videoPath,
      title: (distribution.note ?? channel.name).slice(0, 200),
      description: distribution.note,
      privacyStatus: 'public',
      onProgress,
    });

    // Update distribution with result
    this.distributionService.update(distributionId, {
      status: 'uploaded',
      platformUrl: result.postUrl ?? null,
      publishedAt: new Date().toISOString(),
    });

    return result;
  }
}
