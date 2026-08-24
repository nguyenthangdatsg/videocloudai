import { create } from 'zustand';

export interface TransformSegmentStatus {
  segmentId: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  progress: string[];
  resultUrl: string | null;
  error: string | null;
}

interface QuickJobState {
  projectId: string;
  status: 'idle' | 'generating' | 'done' | 'failed';
  progress: string[];
  resultUrl: string | null;
  error: string | null;
}

// Track cleanup functions and session IDs outside the store (same pattern as ImageGenStore)
const transformCleanups = new Map<string, () => void>();
const transformSessionIds = new Map<string, string>();

function generateSessionId(): string {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

interface TransformStore {
  // Quick mode
  quickJob: QuickJobState | null;
  setQuickJob: (job: QuickJobState | null) => void;

  // Advanced mode segment statuses
  segmentStatuses: Map<string, TransformSegmentStatus>;
  updateSegmentStatus: (segmentId: string, update: Partial<TransformSegmentStatus>) => void;
  clearSegmentStatuses: () => void;

  // Extension bridge — start generation for a single prompt
  startGeneration: (
    key: string,
    prompt: string,
    mediaType: 'image' | 'video',
    provider: 'google-flow' | 'grok' | 'chatgpt',
    onDone: (result: { filename: string; url: string }) => void,
    onError: (error: string) => void,
  ) => void;

  stopGeneration: (key: string) => void;
}

export const useTransformStore = create<TransformStore>((set, get) => ({
  quickJob: null,
  setQuickJob: (job) => set({ quickJob: job }),

  segmentStatuses: new Map(),
  updateSegmentStatus: (segmentId, update) =>
    set((s) => {
      const next = new Map(s.segmentStatuses);
      const existing = next.get(segmentId) || {
        segmentId,
        status: 'pending' as const,
        progress: [],
        resultUrl: null,
        error: null,
      };
      next.set(segmentId, { ...existing, ...update });
      return { segmentStatuses: next };
    }),
  clearSegmentStatuses: () => set({ segmentStatuses: new Map() }),

  startGeneration: (key, prompt, mediaType, provider, onDone, onError) => {
    // Clean up any existing listeners for this key
    const oldCleanup = transformCleanups.get(key);
    if (oldCleanup) oldCleanup();

    const sessionId = generateSessionId();
    transformSessionIds.set(key, sessionId);

    const onProgress = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      if (d.detail) {
        const quickJob = get().quickJob;
        if (quickJob && key === quickJob.projectId) {
          set({ quickJob: { ...quickJob, progress: [...quickJob.progress, d.detail] } });
        } else {
          get().updateSegmentStatus(key, {
            progress: [...(get().segmentStatuses.get(key)?.progress || []), d.detail],
          });
        }
      }
    };

    const onImage = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      if (d.status === 'done') {
        onDone({ filename: d.filename, url: d.url });
      } else if (d.status === 'error') {
        onError(d.error || 'Generation failed');
      }
    };

    const onVideo = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      if (d.status === 'done') {
        onDone({ filename: d.filename, url: d.url });
      } else if (d.status === 'error') {
        onError(d.error || 'Generation failed');
      }
    };

    const onDoneEvent = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      cleanup();
    };

    const onErrorEvent = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || (d.sessionId && d.sessionId !== transformSessionIds.get(key))) return;
      onError(d.error || 'Extension error');
      cleanup();
    };

    window.addEventListener('Han2YT_transform_progress', onProgress);
    window.addEventListener('Han2YT_transform_image', onImage);
    window.addEventListener('Han2YT_transform_video', onVideo);
    window.addEventListener('Han2YT_transform_done', onDoneEvent);
    window.addEventListener('Han2YT_transform_error', onErrorEvent);

    const cleanup = () => {
      window.removeEventListener('Han2YT_transform_progress', onProgress);
      window.removeEventListener('Han2YT_transform_image', onImage);
      window.removeEventListener('Han2YT_transform_video', onVideo);
      window.removeEventListener('Han2YT_transform_done', onDoneEvent);
      window.removeEventListener('Han2YT_transform_error', onErrorEvent);
      transformCleanups.delete(key);
      transformSessionIds.delete(key);
    };
    transformCleanups.set(key, cleanup);

    // Dispatch start event to Chrome extension
    window.dispatchEvent(
      new CustomEvent('Han2YT_transform_start', {
        detail: {
          prompts: [{ prompt, timestamp: Date.now().toString() }],
          delayMin: 5,
          delayMax: 15,
          mediaType,
          provider,
          sessionId,
        },
      }),
    );
  },

  stopGeneration: (key) => {
    const cleanup = transformCleanups.get(key);
    if (cleanup) cleanup();
    window.dispatchEvent(new CustomEvent('Han2YT_transform_stop'));
  },
}));
