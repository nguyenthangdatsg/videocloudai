export type JobType =
  | 'generate-scene'
  | 'assemble-video'
  | 'generate-narration'
  | 'generate-subtitles'
  | 'batch-generate'
  | 'export-video'
  | 'analyze-scene'
  | 'import-url'
  | 'upload-to-platform';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying';
export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: JobPriority;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  errorMessage?: string;
  errorStack?: string;
  retryCount: number;
  maxRetries: number;
  progress: number;
  progressMessage?: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface JobProgress {
  jobId: string;
  progress: number;
  message: string;
  step?: string;
}

export interface QueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  totalToday: number;
}
