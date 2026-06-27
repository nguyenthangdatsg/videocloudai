import { create } from 'zustand';
import { imageApi, storyboardApi } from '../lib/api';
import { useAppStore } from './index';

export type GenMediaType = 'image' | 'video';

export interface GenImage {
  timestamp: string;
  filename: string;
  url: string;
  status: 'pending' | 'generating' | 'done' | 'error';
  mediaType?: GenMediaType;
}

interface ImageGenTask {
  projectId: string;
  images: GenImage[];
  progress: string[];
  running: boolean;
  abortController: AbortController | null;
}

interface ImageGenStore {
  tasks: Map<string, ImageGenTask>;

  startGeneration: (
    projectId: string,
    prompts: Array<{ timestamp: string; prompt: string }>,
    aspectRatio: string,
    provider: string,
    model?: string,
  ) => void;

  startVideoGeneration: (
    projectId: string,
    prompts: Array<{ timestamp: string; prompt: string }>,
    aspectRatio: string,
    duration: number,
    model?: string,
  ) => void;

  startFlowGeneration: (
    projectId: string,
    prompts: Array<{ timestamp: string; prompt: string }>,
    mediaType?: 'image' | 'video',
    existingImages?: GenImage[],
    flowProvider?: 'google-flow' | 'grok' | 'chatgpt',
  ) => void;

  stopGeneration: (projectId: string) => void;

  getTask: (projectId: string) => ImageGenTask | undefined;

  /** Consume and clear a finished task's results */
  clearTask: (projectId: string) => void;
}

export const useImageGenStore = create<ImageGenStore>((set, get) => ({
  tasks: new Map(),

  startGeneration: (projectId, prompts, aspectRatio, provider, model) => {
    // Abort any existing task for this project
    const existing = get().tasks.get(projectId);
    if (existing?.abortController) existing.abortController.abort();

    const controller = new AbortController();
    const initialImages: GenImage[] = prompts.map((p) => ({
      timestamp: p.timestamp,
      filename: '',
      url: '',
      status: 'pending',
    }));

    const task: ImageGenTask = {
      projectId,
      images: initialImages,
      progress: [],
      running: true,
      abortController: controller,
    };

    set((s) => {
      const next = new Map(s.tasks);
      next.set(projectId, task);
      return { tasks: next };
    });

    // Run generation in background
    (async () => {
      try {
        await imageApi.generateBatch(
          { prompts, aspectRatio, provider, model },
          (step, detail, image) => {
            set((s) => {
              const t = s.tasks.get(projectId);
              if (!t) return s;
              const next = new Map(s.tasks);
              const updatedProgress = detail ? [...t.progress, detail] : t.progress;
              let updatedImages = [...t.images];

              if (image) {
                updatedImages = updatedImages.map((item) =>
                  item.timestamp === image.timestamp && item.status !== 'done'
                    ? { ...item, filename: image.filename, url: image.url, status: 'done' as const }
                    : item,
                );
              }

              if (step === 'generating' && detail) {
                const match = detail.match(/\((\d+)\/\d+\)/);
                if (match) {
                  const idx = parseInt(match[1]) - 1;
                  updatedImages = updatedImages.map((item, i) =>
                    i === idx && item.status === 'pending' ? { ...item, status: 'generating' as const } : item,
                  );
                }
              }

              next.set(projectId, { ...t, images: updatedImages, progress: updatedProgress });
              return { tasks: next };
            });
          },
          controller.signal,
        );

        // Done — save to project
        const finalTask = get().tasks.get(projectId);
        if (finalTask) {
          const doneImages = finalTask.images;
          storyboardApi.updateProject(projectId, {
            generatedImages: doneImages,
            currentStep: 'images',
          } as never).catch(() => {});

          set((s) => {
            const next = new Map(s.tasks);
            next.set(projectId, { ...finalTask, running: false, abortController: null });
            return { tasks: next };
          });

          const doneCount = doneImages.filter((i) => i.status === 'done').length;
          useAppStore.getState().pushNotification({
            id: `img-gen-${projectId}-${Date.now()}`,
            type: 'success',
            title: `Image generation complete`,
            message: `${doneCount}/${doneImages.length} images generated`,
          });
        }
      } catch (err) {
        const isAbort = (err as Error).name === 'AbortError';

        set((s) => {
          const t = s.tasks.get(projectId);
          if (!t) return s;
          const next = new Map(s.tasks);
          const updatedImages = t.images.map((item) =>
            item.status === 'pending' || item.status === 'generating'
              ? { ...item, status: 'error' as const }
              : item,
          );
          const updatedProgress = isAbort
            ? [...t.progress, 'Stopped by user.']
            : [...t.progress, (err as Error).message];
          next.set(projectId, {
            ...t,
            images: updatedImages,
            progress: updatedProgress,
            running: false,
            abortController: null,
          });
          return { tasks: next };
        });

        if (!isAbort) {
          useAppStore.getState().pushNotification({
            id: `img-gen-err-${projectId}-${Date.now()}`,
            type: 'error',
            title: 'Image generation failed',
            message: (err as Error).message,
          });
        }
      }
    })();
  },

  startVideoGeneration: (projectId, prompts, aspectRatio, duration, model) => {
    // Abort any existing task for this project
    const existing = get().tasks.get(projectId);
    if (existing?.abortController) existing.abortController.abort();

    const controller = new AbortController();
    const initialImages: GenImage[] = prompts.map((p) => ({
      timestamp: p.timestamp,
      filename: '',
      url: '',
      status: 'pending',
      mediaType: 'video' as GenMediaType,
    }));

    const task: ImageGenTask = {
      projectId,
      images: initialImages,
      progress: [],
      running: true,
      abortController: controller,
    };

    set((s) => {
      const next = new Map(s.tasks);
      next.set(projectId, task);
      return { tasks: next };
    });

    // Run video generation in background
    (async () => {
      try {
        await imageApi.generateVideoBatch(
          { prompts, aspectRatio, duration, model },
          (step, detail, video) => {
            set((s) => {
              const t = s.tasks.get(projectId);
              if (!t) return s;
              const next = new Map(s.tasks);
              const updatedProgress = detail ? [...t.progress, detail] : t.progress;
              let updatedImages = [...t.images];

              if (video) {
                updatedImages = updatedImages.map((item) =>
                  item.timestamp === video.timestamp && item.status !== 'done'
                    ? { ...item, filename: video.filename, url: video.url, status: 'done' as const, mediaType: 'video' as GenMediaType }
                    : item,
                );
              }

              if (step === 'generating' && detail) {
                const match = detail.match(/\((\d+)\/\d+\)/);
                if (match) {
                  const idx = parseInt(match[1]) - 1;
                  updatedImages = updatedImages.map((item, i) =>
                    i === idx && item.status === 'pending' ? { ...item, status: 'generating' as const } : item,
                  );
                }
              }

              next.set(projectId, { ...t, images: updatedImages, progress: updatedProgress });
              return { tasks: next };
            });
          },
          controller.signal,
        );

        // Done — save to project
        const finalTask = get().tasks.get(projectId);
        if (finalTask) {
          const doneVideos = finalTask.images;
          storyboardApi.updateProject(projectId, {
            generatedImages: doneVideos,
            currentStep: 'images',
          } as never).catch(() => {});

          set((s) => {
            const next = new Map(s.tasks);
            next.set(projectId, { ...finalTask, running: false, abortController: null });
            return { tasks: next };
          });

          const doneCount = doneVideos.filter((i) => i.status === 'done').length;
          useAppStore.getState().pushNotification({
            id: `vid-gen-${projectId}-${Date.now()}`,
            type: 'success',
            title: `Video generation complete`,
            message: `${doneCount}/${doneVideos.length} video clips generated`,
          });
        }
      } catch (err) {
        const isAbort = (err as Error).name === 'AbortError';

        set((s) => {
          const t = s.tasks.get(projectId);
          if (!t) return s;
          const next = new Map(s.tasks);
          const updatedImages = t.images.map((item) =>
            item.status === 'pending' || item.status === 'generating'
              ? { ...item, status: 'error' as const }
              : item,
          );
          const updatedProgress = isAbort
            ? [...t.progress, 'Stopped by user.']
            : [...t.progress, (err as Error).message];
          next.set(projectId, {
            ...t,
            images: updatedImages,
            progress: updatedProgress,
            running: false,
            abortController: null,
          });
          return { tasks: next };
        });

        if (!isAbort) {
          useAppStore.getState().pushNotification({
            id: `vid-gen-err-${projectId}-${Date.now()}`,
            type: 'error',
            title: 'Video generation failed',
            message: (err as Error).message,
          });
        }
      }
    })();
  },

  startFlowGeneration: (projectId, prompts, mediaType = 'image', existingImages, flowProvider = 'google-flow') => {
    // Abort any existing task
    const existing = get().tasks.get(projectId);
    if (existing?.abortController) existing.abortController.abort();

    // If existingImages provided (resume mode), keep done images and only reset failed/pending for the prompts being retried
    let initialImages: GenImage[];
    if (existingImages) {
      const retryTimestamps = new Set(prompts.map(p => p.timestamp));
      initialImages = existingImages.map((img) =>
        retryTimestamps.has(img.timestamp) ? { ...img, status: 'pending' as const, filename: '', url: '' } : img,
      );
    } else {
      initialImages = prompts.map((p) => ({
        timestamp: p.timestamp,
        filename: '',
        url: '',
        status: 'pending',
      }));
    }

    const task: ImageGenTask = {
      projectId,
      images: initialImages,
      progress: [existingImages ? `Resuming failed images via ${flowProvider} extension...` : `Starting ${flowProvider} generation via extension...`],
      running: true,
      abortController: null,
    };

    set((s) => {
      const next = new Map(s.tasks);
      next.set(projectId, task);
      return { tasks: next };
    });

    // Listen for events from bridge.js (Chrome extension)
    const onProgress = (e: Event) => {
      const d = (e as CustomEvent).detail;
      set((s) => {
        const t = s.tasks.get(projectId);
        if (!t) return s;
        const next = new Map(s.tasks);
        const updatedProgress = d.detail ? [...t.progress, d.detail] : t.progress;
        let updatedImages = [...t.images];
        if (d.status === 'generating' && typeof d.index === 'number') {
          updatedImages = updatedImages.map((item, i) =>
            i === d.index && item.status === 'pending' ? { ...item, status: 'generating' as const } : item,
          );
        }
        next.set(projectId, { ...t, images: updatedImages, progress: updatedProgress });
        return { tasks: next };
      });
    };

    const onImage = (e: Event) => {
      const d = (e as CustomEvent).detail;
      set((s) => {
        const t = s.tasks.get(projectId);
        if (!t) return s;
        const next = new Map(s.tasks);
        let updatedImages = [...t.images];
        if (d.status === 'done' && typeof d.index === 'number') {
          updatedImages = updatedImages.map((item, i) =>
            i === d.index ? { ...item, filename: d.filename, url: d.url, status: 'done' as const } : item,
          );
        } else if (d.status === 'error' && typeof d.index === 'number') {
          updatedImages = updatedImages.map((item, i) =>
            i === d.index ? { ...item, status: 'error' as const } : item,
          );
        }
        next.set(projectId, { ...t, images: updatedImages });
        return { tasks: next };
      });
    };

    const cleanup = () => {
      window.removeEventListener('h2dev_flow_progress', onProgress);
      window.removeEventListener('h2dev_flow_image', onImage);
      window.removeEventListener('h2dev_flow_done', onDone);
      window.removeEventListener('h2dev_flow_error', onError);
    };

    // Helper: finalize any images still stuck as generating/pending → error
    const finalizeImages = (images: GenImage[]): GenImage[] =>
      images.map((item) =>
        item.status === 'generating' || item.status === 'pending'
          ? { ...item, status: 'error' as const }
          : item,
      );

    const onDone = (e: Event) => {
      const d = (e as CustomEvent).detail;
      cleanup();
      const finalTask = get().tasks.get(projectId);
      if (finalTask) {
        const cleanImages = finalizeImages(finalTask.images);
        storyboardApi.updateProject(projectId, {
          generatedImages: cleanImages,
          currentStep: 'images',
        } as never).catch(() => {});

        set((s) => {
          const next = new Map(s.tasks);
          next.set(projectId, {
            ...finalTask,
            images: cleanImages,
            progress: [...finalTask.progress, `Done: ${d.done}/${d.total} images generated via ${flowProvider}`],
            running: false,
            abortController: null,
          });
          return { tasks: next };
        });

        const doneCount = cleanImages.filter((i) => i.status === 'done').length;
        useAppStore.getState().pushNotification({
          id: `flow-gen-${projectId}-${Date.now()}`,
          type: 'success',
          title: `${flowProvider} generation complete`,
          message: `${doneCount}/${cleanImages.length} images generated`,
        });
      }
    };

    const onError = (e: Event) => {
      const d = (e as CustomEvent).detail;
      cleanup();
      set((s) => {
        const t = s.tasks.get(projectId);
        if (!t) return s;
        const next = new Map(s.tasks);
        const cleanImages = finalizeImages(t.images);
        next.set(projectId, {
          ...t,
          images: cleanImages,
          progress: [...t.progress, `Error: ${d.error}`],
          running: false,
          abortController: null,
        });
        return { tasks: next };
      });
      useAppStore.getState().pushNotification({
        id: `flow-gen-err-${projectId}-${Date.now()}`,
        type: 'error',
        title: `${flowProvider} generation failed`,
        message: d.error,
      });
    };

    window.addEventListener('h2dev_flow_progress', onProgress);
    window.addEventListener('h2dev_flow_image', onImage);
    window.addEventListener('h2dev_flow_done', onDone);
    window.addEventListener('h2dev_flow_error', onError);

    // Dispatch start event to bridge.js
    window.dispatchEvent(new CustomEvent('h2dev_flow_start', {
      detail: { prompts, delayMin: 5, delayMax: 15, mediaType, provider: flowProvider },
    }));
  },

  stopGeneration: (projectId) => {
    const task = get().tasks.get(projectId);
    if (task?.abortController) {
      task.abortController.abort();
    }
    // Also stop Flow generation if running
    window.dispatchEvent(new CustomEvent('h2dev_flow_stop'));

    // Immediately mark task as stopped
    if (task) {
      set((s) => {
        const next = new Map(s.tasks);
        const updatedImages = task.images.map((item) =>
          item.status === 'pending' || item.status === 'generating'
            ? { ...item, status: 'error' as const }
            : item,
        );
        next.set(projectId, {
          ...task,
          images: updatedImages,
          progress: [...task.progress, 'Stopped by user.'],
          running: false,
          abortController: null,
        });
        return { tasks: next };
      });
    }
  },

  getTask: (projectId) => get().tasks.get(projectId),

  clearTask: (projectId) => {
    set((s) => {
      const next = new Map(s.tasks);
      next.delete(projectId);
      return { tasks: next };
    });
  },
}));
