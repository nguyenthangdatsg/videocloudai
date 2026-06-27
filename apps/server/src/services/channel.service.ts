import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun } from '../db';
import type { Channel, Platform, OAuthTokens } from '@videocloudai/shared';

interface DbChannel {
  id: string;
  name: string;
  platform: string;
  handle: string | null;
  url: string | null;
  description: string | null;
  is_active: number;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: string | null;
  platform_user_id: string | null;
  platform_username: string | null;
  default_caption: string | null;
  default_hashtags: string | null;
  created_at: string;
  updated_at: string;
}

function toChannel(row: DbChannel): Channel {
  const hasToken = !!(row.oauth_access_token);
  const oauthTokens: OAuthTokens | undefined = hasToken
    ? {
        accessToken: row.oauth_access_token!,
        refreshToken: row.oauth_refresh_token ?? undefined,
        expiresAt: row.oauth_expires_at ?? undefined,
      }
    : undefined;

  return {
    id: row.id,
    name: row.name,
    platform: row.platform as Platform,
    handle: row.handle ?? undefined,
    url: row.url ?? undefined,
    description: row.description ?? undefined,
    isActive: row.is_active === 1,
    oauthTokens,
    platformUserId: row.platform_user_id ?? undefined,
    platformUsername: row.platform_username ?? undefined,
    connected: hasToken,
    defaultCaption: row.default_caption ?? undefined,
    defaultHashtags: row.default_hashtags ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ChannelService {
  list(platform?: Platform): Channel[] {
    const rows = platform
      ? dbAll<DbChannel>('SELECT * FROM channels WHERE platform = ? ORDER BY name ASC', [platform])
      : dbAll<DbChannel>('SELECT * FROM channels ORDER BY platform ASC, name ASC');
    return rows.map(toChannel);
  }

  get(id: string): Channel | undefined {
    const row = dbGet<DbChannel>('SELECT * FROM channels WHERE id = ?', [id]);
    return row ? toChannel(row) : undefined;
  }

  create(data: {
    name: string;
    platform: Platform;
    handle?: string;
    url?: string;
    description?: string;
    defaultCaption?: string;
    defaultHashtags?: string;
  }): Channel {
    const id = uuidv4();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO channels (id, name, platform, handle, url, description, is_active, default_caption, default_hashtags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [id, data.name, data.platform, data.handle ?? null, data.url ?? null, data.description ?? null, data.defaultCaption ?? null, data.defaultHashtags ?? null, now, now]
    );
    return this.get(id)!;
  }

  update(id: string, data: {
    name?: string;
    platform?: Platform;
    handle?: string | null;
    url?: string | null;
    description?: string | null;
    isActive?: boolean;
    defaultCaption?: string | null;
    defaultHashtags?: string | null;
  }): Channel | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    dbRun(
      `UPDATE channels SET
        name = ?, platform = ?, handle = ?, url = ?, description = ?, is_active = ?,
        default_caption = ?, default_hashtags = ?, updated_at = ?
       WHERE id = ?`,
      [
        data.name ?? existing.name,
        data.platform ?? existing.platform,
        data.handle !== undefined ? data.handle : (existing.handle ?? null),
        data.url !== undefined ? data.url : (existing.url ?? null),
        data.description !== undefined ? data.description : (existing.description ?? null),
        data.isActive !== undefined ? (data.isActive ? 1 : 0) : (existing.isActive ? 1 : 0),
        data.defaultCaption !== undefined ? data.defaultCaption : (existing.defaultCaption ?? null),
        data.defaultHashtags !== undefined ? data.defaultHashtags : (existing.defaultHashtags ?? null),
        now,
        id,
      ]
    );
    return this.get(id);
  }

  setOAuthTokens(
    id: string,
    tokens: OAuthTokens,
    userId?: string,
    username?: string
  ): Channel | undefined {
    const now = new Date().toISOString();
    dbRun(
      `UPDATE channels SET
         oauth_access_token = ?,
         oauth_refresh_token = ?,
         oauth_expires_at = ?,
         platform_user_id = ?,
         platform_username = ?,
         updated_at = ?
       WHERE id = ?`,
      [
        tokens.accessToken,
        tokens.refreshToken ?? null,
        tokens.expiresAt ?? null,
        userId ?? null,
        username ?? null,
        now,
        id,
      ]
    );
    return this.get(id);
  }

  clearOAuthTokens(id: string): Channel | undefined {
    const now = new Date().toISOString();
    dbRun(
      `UPDATE channels SET
         oauth_access_token = NULL,
         oauth_refresh_token = NULL,
         oauth_expires_at = NULL,
         platform_user_id = NULL,
         platform_username = NULL,
         updated_at = ?
       WHERE id = ?`,
      [now, id]
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    const { changes } = dbRun('DELETE FROM channels WHERE id = ?', [id]);
    return changes > 0;
  }
}
