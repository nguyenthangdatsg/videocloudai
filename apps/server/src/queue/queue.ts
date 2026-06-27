import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

// Simple priority-queue with concurrency control (replaces ESM-only p-queue package)
class PQueue {
  private concurrency: number;
  private running = 0;
  private pending: Array<{ fn: () => Promise<unknown>; priority: number; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

  constructor(opts: { concurrency: number }) {
    this.concurrency = opts.concurrency;
  }

  add(fn: () => Promise<unknown>, opts: { priority?: number } = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.push({ fn, priority: opts.priority ?? 0, resolve, reject });
      this.pending.sort((a, b) => b.priority - a.priority);
      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift()!;
      this.running++;
      item.fn().then(
        (v) => { this.running--; item.resolve(v); this.drain(); },
        (e) => { this.running--; item.reject(e); this.drain(); }
      );
    }
  }
}
import { dbGet, dbAll, dbRun } from '../db';
import type { JobRecord, JobType, JobPriority, JobStatus, QueueStats } from '@videocloudai/shared';

interface DbJob {
  id: string;
  type: string;
  status: string;
  priority: string;
  payload: string;
  result: string;
  error_message: string;
  error_stack: string;
  retry_count: number;
  max_retries: number;
  progress: number;
  progress_message: string;
  scheduled_at: string;
  started_at: string;
  completed_at: string;
  created_at: string;
}

function mapDbJob(row: DbJob): JobRecord {
  return {
    id: row.id,
    type: row.type as JobType,
    status: row.status as JobStatus,
    priority: row.priority as JobPriority,
    payload: JSON.parse(row.payload ?? '{}'),
    result: row.result ? JSON.parse(row.result) : undefined,
    errorMessage: row.error_message,
    errorStack: row.error_stack,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    progress: row.progress,
    progressMessage: row.progress_message,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

type JobHandler = (job: JobRecord, onProgress: (pct: number, msg?: string) => void) => Promise<unknown>;

export class JobQueue extends EventEmitter {
  private queue: PQueue;
  private handlers = new Map<JobType, JobHandler>();
  private running = new Set<string>();

  constructor(concurrency = 3) {
    super();
    this.queue = new PQueue({ concurrency });
    // Do NOT auto-resume pending jobs here — handlers haven't been registered yet.
    // Call resumePendingJobs() after registerHandlers() finishes.
  }

  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  resumePendingJobs(): void {
    // Re-queue any jobs that were running when the server stopped, then schedule queued ones.
    dbRun(
      "UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'"
    );

    const pendingJobs = dbAll<DbJob>(
      "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 20"
    );

    for (const row of pendingJobs) {
      const job = mapDbJob(row);
      this.scheduleJob(job);
    }
  }

  enqueue(
    type: JobType,
    payload: Record<string, unknown>,
    options: {
      priority?: JobPriority;
      maxRetries?: number;
      scheduledAt?: Date;
    } = {}
  ): JobRecord {
    const id = uuidv4();
    const now = new Date().toISOString();

    const priorityValue = options.priority ?? 'normal';

    dbRun(
      `INSERT INTO jobs (id, type, status, priority, payload, retry_count, max_retries,
       progress, scheduled_at, created_at)
       VALUES (?, ?, 'queued', ?, ?, 0, ?, 0, ?, ?)`,
      [
        id,
        type,
        priorityValue,
        JSON.stringify(payload),
        options.maxRetries ?? 3,
        options.scheduledAt?.toISOString() ?? null,
        now,
      ]
    );

    const job = this.getJob(id)!;
    this.scheduleJob(job);
    this.emit('job:queued', job);
    return job;
  }

  private scheduleJob(job: JobRecord): void {
    const priorityMap: Record<JobPriority, number> = {
      urgent: 10,
      high: 7,
      normal: 5,
      low: 1,
    };

    // PQueue.add returns a promise. If executeJob throws synchronously (e.g., a SQL error
    // before its own try/catch), that rejection is unhandled and — under Node's strict
    // unhandledRejection policy — crashes the process. Attach a catch so the queue can
    // keep running other jobs.
    this.queue
      .add(() => this.executeJob(job.id), { priority: priorityMap[job.priority] })
      .catch((err) => {
        console.error(`[JobQueue] scheduleJob caught for ${job.id}:`, err);
        try {
          this.failJob(job.id, (err as Error).message ?? String(err), (err as Error).stack);
        } catch {
          /* don't recurse if failJob itself blows up */
        }
      });
  }

  private async executeJob(jobId: string): Promise<void> {
    const job = this.getJob(jobId);
    if (!job || job.status === 'cancelled') return;

    const handler = this.handlers.get(job.type);
    if (!handler) {
      this.failJob(jobId, `No handler registered for job type: ${job.type}`);
      return;
    }

    this.running.add(jobId);

    dbRun(
      "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?",
      [new Date().toISOString(), jobId]
    );

    const updatedJob = this.getJob(jobId)!;
    this.emit('job:started', updatedJob);

    const onProgress = (pct: number, msg?: string) => {
      dbRun(
        'UPDATE jobs SET progress = ?, progress_message = ? WHERE id = ?',
        [pct, msg ?? null, jobId]
      );
      this.emit('job:progress', { jobId, progress: pct, message: msg });
    };

    try {
      const result = await handler(updatedJob, onProgress);

      dbRun(
        "UPDATE jobs SET status = 'completed', progress = 100, result = ?, completed_at = ? WHERE id = ?",
        [JSON.stringify(result ?? {}), new Date().toISOString(), jobId]
      );

      this.running.delete(jobId);
      this.emit('job:completed', { jobId, result });
    } catch (err) {
      const error = err as Error;
      this.running.delete(jobId);

      const currentJob = this.getJob(jobId)!;
      if (currentJob.retryCount < currentJob.maxRetries) {
        dbRun(
          "UPDATE jobs SET status = 'retrying', retry_count = retry_count + 1, error_message = ? WHERE id = ?",
          [error.message, jobId]
        );

        const delay = Math.min(1000 * Math.pow(2, currentJob.retryCount), 30_000);
        setTimeout(() => {
          const retryJob = this.getJob(jobId);
          if (retryJob) this.scheduleJob(retryJob);
        }, delay);

        this.emit('job:retrying', { jobId, error: error.message });
      } else {
        this.failJob(jobId, error.message, error.stack);
      }
    }
  }

  private failJob(jobId: string, message: string, stack?: string): void {
    dbRun(
      "UPDATE jobs SET status = 'failed', error_message = ?, error_stack = ?, completed_at = ? WHERE id = ?",
      [message, stack ?? null, new Date().toISOString(), jobId]
    );
    this.emit('job:failed', { jobId, error: message });
  }

  cancelJob(jobId: string): void {
    dbRun("UPDATE jobs SET status = 'cancelled' WHERE id = ? AND status = 'queued'", [jobId]);
    this.emit('job:cancelled', { jobId });
  }

  deleteJob(jobId: string): boolean {
    const row = dbGet<{ status: string }>('SELECT status FROM jobs WHERE id = ?', [jobId]);
    if (!row) return false;
    if (row.status === 'running') return false; // don't delete running jobs
    dbRun('DELETE FROM jobs WHERE id = ?', [jobId]);
    return true;
  }

  getJob(id: string): JobRecord | undefined {
    const row = dbGet<DbJob>('SELECT * FROM jobs WHERE id = ?', [id]);
    return row ? mapDbJob(row) : undefined;
  }

  listJobs(status?: JobStatus, limit = 50): JobRecord[] {
    const rows = status
      ? dbAll<DbJob>('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, limit])
      : dbAll<DbJob>('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map(mapDbJob);
  }

  getStats(): QueueStats {
    const result: QueueStats = { queued: 0, running: 0, completed: 0, failed: 0, totalToday: 0 };

    const today = new Date().toISOString().slice(0, 10);

    for (const status of ['queued', 'running', 'completed', 'failed'] as const) {
      const row = dbGet<{ count: number }>(
        'SELECT COUNT(*) as count FROM jobs WHERE status = ?',
        [status]
      );
      result[status] = row?.count ?? 0;
    }

    const todayRow = dbGet<{ count: number }>(
      "SELECT COUNT(*) as count FROM jobs WHERE created_at >= ?",
      [`${today}T00:00:00.000Z`]
    );
    result.totalToday = todayRow?.count ?? 0;

    return result;
  }

}

// Singleton
let jobQueue: JobQueue | null = null;

export function getJobQueue(): JobQueue {
  if (!jobQueue) {
    jobQueue = new JobQueue(Number(process.env.MAX_CONCURRENT_JOBS ?? 3));
  }
  return jobQueue;
}
