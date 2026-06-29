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
                // Incrementally save to DB so images survive page reload
                storyboardApi.updateProject(projectId, {
                  generatedImages: updatedImages,
                } as never).catch(() => {});
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

        const currentTask = get().tasks.get(projectId);
        const updatedImages = (currentTask?.images ?? []).map((item) =>
          item.status === 'pending' || item.status === 'generating'
            ? { ...item, status: 'error' as const }
            : item,
        );

        // Save partially-completed images to DB so they survive restarts
        const doneCount = updatedImages.filter((i) => i.status === 'done').length;
        if (doneCount > 0) {
          storyboardApi.updateProject(projectId, {
            generatedImages: updatedImages,
          } as never).catch(() => {});
        }

        set((s) => {
          const t = s.tasks.get(projectId);
          if (!t) return s;
          const next = new Map(s.tasks);
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
                // Incrementally save to DB so videos survive page reload
                storyboardApi.updateProject(projectId, {
                  generatedImages: updatedImages,
                } as never).catch(() => {});
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

        const currentTask = get().tasks.get(projectId);
        const updatedImages = (currentTask?.images ?? []).map((item) =>
          item.status === 'pending' || item.status === 'generating'
            ? { ...item, status: 'error' as const }
            : item,
        );

        // Save partially-completed videos to DB so they survive restarts
        const doneCount = updatedImages.filter((i) => i.status === 'done').length;
        if (doneCount > 0) {
          storyboardApi.updateProject(projectId, {
            generatedImages: updatedImages,
          } as never).catch(() => {});
        }

        set((s) => {
          const t = s.tasks.get(projectId);
          if (!t) return s;
          const next = new Map(s.tasks);
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
    // Maps extension subset index → full images array index (for resume mode)
    // Use mutable ref object so async callbacks see the latest value
    const indexMapRef: { current: number[] | null } = { current: null };
    if (existingImages) {
      const retryTimestamps = new Set(prompts.map(p => p.timestamp));
      initialImages = existingImages.map((img) =>
        retryTimestamps.has(img.timestamp) ? { ...img, status: 'pending' as const, filename: '', url: '' } : img,
      );
      // Build mapping: extension sends index 0,1,2... for the subset; map to actual positions
      indexMapRef.current = [];
      for (let i = 0; i < initialImages.length; i++) {
        if (retryTimestamps.has(initialImages[i].timestamp)) {
          indexMapRef.current.push(i);
        }
      }
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

    // Check prompt cache first — use existing images for matching prompts
    imageApi.checkPromptCache(prompts).then(({ cached }) => {
      if (cached.length > 0) {
        set((s) => {
          const t = s.tasks.get(projectId);
          if (!t) return s;
          const next = new Map(s.tasks);
          let updatedImages = [...t.images];
          const cachedTimestamps = new Set<string>();
          for (const c of cached) {
            cachedTimestamps.add(c.timestamp);
            updatedImages = updatedImages.map((item) =>
              item.timestamp === c.timestamp && item.status !== 'done'
                ? { ...item, filename: c.filename, url: c.url, status: 'done' as const }
                : item,
            );
          }
          // Update indexMap: remove cached items from the subset sent to extension
          if (indexMapRef.current) {
            indexMapRef.current = indexMapRef.current.filter((realIdx) => !cachedTimestamps.has(updatedImages[realIdx]?.timestamp));
          }
          next.set(projectId, {
            ...t,
            images: updatedImages,
            progress: [...t.progress, `Found ${cached.length} cached images, skipping regeneration.`],
          });

          // Save to DB immediately
          storyboardApi.updateProject(projectId, { generatedImages: updatedImages } as never).catch(() => {});

          return { tasks: next };
        });

        // Filter out cached prompts from what we send to the extension
        const cachedTimestamps = new Set(cached.map(c => c.timestamp));
        const uncachedPrompts = prompts.filter(p => !cachedTimestamps.has(p.timestamp));

        if (uncachedPrompts.length === 0) {
          // All cached — finish immediately
          const finalTask = get().tasks.get(projectId);
          if (finalTask) {
            set((s) => {
              const next = new Map(s.tasks);
              next.set(projectId, { ...finalTask, running: false, abortController: null,
                progress: [...finalTask.progress, `All ${cached.length} images loaded from cache.`] });
              return { tasks: next };
            });
            useAppStore.getState().pushNotification({
              id: `flow-cache-${projectId}-${Date.now()}`,
              type: 'success',
              title: `All images from cache`,
              message: `${cached.length} images loaded from prompt cache`,
            });
          }
          return;
        }

        // Rebuild indexMap for uncached subset
        const currentTask = get().tasks.get(projectId);
        if (currentTask) {
          indexMapRef.current = [];
          for (let i = 0; i < currentTask.images.length; i++) {
            if (uncachedPrompts.some(p => p.timestamp === currentTask.images[i].timestamp)) {
              indexMapRef.current.push(i);
            }
          }
        }

        // Dispatch only uncached prompts to extension
        window.dispatchEvent(new CustomEvent('Han2YT_flow_start', {
          detail: { prompts: uncachedPrompts, delayMin: 5, delayMax: 15, mediaType, provider: flowProvider },
        }));
      } else {
        // No cache hits — send all prompts to extension
        window.dispatchEvent(new CustomEvent('Han2YT_flow_start', {
          detail: { prompts, delayMin: 5, delayMax: 15, mediaType, provider: flowProvider },
        }));
      }
    }).catch(() => {
      // Cache check failed — send all prompts to extension
      window.dispatchEvent(new CustomEvent('Han2YT_flow_start', {
        detail: { prompts, delayMin: 5, delayMax: 15, mediaType, provider: flowProvider },
      }));
    });

    // Resolve extension subset index to full images array index
    const resolveIndex = (extIndex: number): number =>
      indexMapRef.current ? (indexMapRef.current[extIndex] ?? extIndex) : extIndex;

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
          const realIdx = resolveIndex(d.index);
          updatedImages = updatedImages.map((item, i) =>
            i === realIdx && item.status === 'pending' ? { ...item, status: 'generating' as const } : item,
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
        if (typeof d.index === 'number') {
          const realIdx = resolveIndex(d.index);
          if (d.status === 'done') {
            updatedImages = updatedImages.map((item, i) =>
              i === realIdx ? { ...item, filename: d.filename, url: d.url, status: 'done' as const } : item,
            );
            // Save to prompt cache so future runs reuse this image
            const matchedPrompt = prompts.find(p => p.timestamp === updatedImages[realIdx]?.timestamp);
            if (matchedPrompt) {
              imageApi.savePromptCache([{ prompt: matchedPrompt.prompt, filename: d.filename, url: d.url }]).catch(() => {});
            }
          } else if (d.status === 'error') {
            updatedImages = updatedImages.map((item, i) =>
              i === realIdx ? { ...item, status: 'error' as const } : item,
            );
          }
        }
        next.set(projectId, { ...t, images: updatedImages });

        // Incrementally save to DB so images survive page reload
        storyboardApi.updateProject(projectId, {
          generatedImages: updatedImages,
        } as never).catch(() => {});

        return { tasks: next };
      });
    };

    const cleanup = () => {
      window.removeEventListener('Han2YT_flow_progress', onProgress);
      window.removeEventListener('Han2YT_flow_image', onImage);
      window.removeEventListener('Han2YT_flow_done', onDone);
      window.removeEventListener('Han2YT_flow_error', onError);
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
      const currentTask = get().tasks.get(projectId);
      const cleanImages = finalizeImages(currentTask?.images ?? []);

      // Save partially-completed images to DB so they survive restarts
      const doneCount = cleanImages.filter((i) => i.status === 'done').length;
      if (doneCount > 0) {
        storyboardApi.updateProject(projectId, {
          generatedImages: cleanImages,
        } as never).catch(() => {});
      }

      set((s) => {
        const t = s.tasks.get(projectId);
        if (!t) return s;
        const next = new Map(s.tasks);
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

    window.addEventListener('Han2YT_flow_progress', onProgress);
    window.addEventListener('Han2YT_flow_image', onImage);
    window.addEventListener('Han2YT_flow_done', onDone);
    window.addEventListener('Han2YT_flow_error', onError);
  },

  stopGeneration: (projectId) => {
    const task = get().tasks.get(projectId);
    if (task?.abortController) {
      task.abortController.abort();
    }
    // Also stop Flow generation if running
    window.dispatchEvent(new CustomEvent('Han2YT_flow_stop'));

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
