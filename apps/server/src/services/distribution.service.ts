import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbAll, dbRun } from '../db';
import { ChannelService } from './channel.service';
import type { Distribution, DistributionStatus } from '@videocloudai/shared';

interface DbDistribution {
  id: string;
  video_id: string;
  channel_id: string;
  status: string;
  export_path: string | null;
  published_at: string | null;
  platform_url: string | null;
  note: string | null;
  performance_note: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export class DistributionService {
  private channelService: ChannelService;

  constructor(channelService: ChannelService) {
    this.channelService = channelService;
  }

  private toDistribution(row: DbDistribution): Distribution {
    return {
      id: row.id,
      videoId: row.video_id,
      channelId: row.channel_id,
      channel: this.channelService.get(row.channel_id),
      status: row.status as DistributionStatus,
      exportPath: row.export_path ?? undefined,
      publishedAt: row.published_at ?? undefined,
      platformUrl: row.platform_url ?? undefined,
      note: row.note ?? undefined,
      performanceNote: row.performance_note ?? undefined,
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(filters: { videoId?: string; channelId?: string; status?: DistributionStatus } = {}): Distribution[] {
    let sql = 'SELECT * FROM distributions WHERE 1=1';
    const params: unknown[] = [];
    if (filters.videoId) { sql += ' AND video_id = ?'; params.push(filters.videoId); }
    if (filters.channelId) { sql += ' AND channel_id = ?'; params.push(filters.channelId); }
    if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
    sql += ' ORDER BY created_at DESC';
    return dbAll<DbDistribution>(sql, params).map((r) => this.toDistribution(r));
  }

  get(id: string): Distribution | undefined {
    const row = dbGet<DbDistribution>('SELECT * FROM distributions WHERE id = ?', [id]);
    return row ? this.toDistribution(row) : undefined;
  }

  create(data: {
    videoId: string;
    channelId: string;
    status?: DistributionStatus;
    exportPath?: string;
    note?: string;
  }): Distribution {
    const id = uuidv4();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO distributions
         (id, video_id, channel_id, status, export_path, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.videoId, data.channelId, data.status ?? 'pending', data.exportPath ?? null, data.note ?? null, now, now]
    );
    return this.get(id)!;
  }

  update(id: string, data: {
    status?: DistributionStatus;
    exportPath?: string | null;
    publishedAt?: string | null;
    platformUrl?: string | null;
    note?: string | null;
    performanceNote?: string | null;
    errorMessage?: string | null;
  }): Distribution | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const publishedAt =
      data.publishedAt !== undefined
        ? data.publishedAt
        : data.status === 'uploaded' && existing.status !== 'uploaded'
        ? now
        : (existing.publishedAt ?? null);

    dbRun(
      `UPDATE distributions SET
         status = ?, export_path = ?, published_at = ?,
         platform_url = ?, note = ?, performance_note = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
      [
        data.status ?? existing.status,
        data.exportPath !== undefined ? data.exportPath : (existing.exportPath ?? null),
        publishedAt,
        data.platformUrl !== undefined ? data.platformUrl : (existing.platformUrl ?? null),
        data.note !== undefined ? data.note : (existing.note ?? null),
        data.performanceNote !== undefined ? data.performanceNote : (existing.performanceNote ?? null),
        data.errorMessage !== undefined ? data.errorMessage : (existing.errorMessage ?? null),
        now,
        id,
      ]
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    const { changes } = dbRun('DELETE FROM distributions WHERE id = ?', [id]);
    return changes > 0;
  }
}
