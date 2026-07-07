import axios from 'axios';
import type {
  VideoProject,
  SceneLine,
  SceneMetadata,
  AssetRecord,
  GenerationRequest,
  JobRecord,
  QueueStats,
  VideoFormat,
  VideoDuration,
  SceneMood,
  SceneStyle,
  SceneCategory,
  Channel,
  Distribution,
  DistributionStatus,
  Platform,
} from '@videocloudai/shared';

export type { Channel, Distribution, DistributionStatus, Platform };

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Extract server error messages instead of generic "Request failed with status code 500"
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (axios.isAxiosError(err) && err.response?.data) {
      const msg = err.response.data.error || err.response.data.message;
      if (typeof msg === 'string' && msg.length > 0) {
        err.message = msg;
      }
    }
    return Promise.reject(err);
  },
);

/** Read NDJSON stream, calling handler for each parsed line. Handles buffering across chunks. */
async function readNDJSON(
  response: Response,
  handler: (parsed: Record<string, unknown>) => void,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      handler(JSON.parse(line));
    }
  }
  if (buffer.trim()) {
    handler(JSON.parse(buffer));
  }
}

// Videos
export const videosApi = {
  list: () => api.get<{ projects: VideoProject[] }>('/videos').then((r) => r.data.projects),
  get: (id: string) => api.get<{ project: VideoProject }>(`/videos/${id}`).then((r) => r.data.project),
  create: (data: {
    title: string;
    script: string;
    format?: VideoFormat;
    duration?: VideoDuration;
    narrationEnabled?: boolean;
    narrationVoice?: string;
    narrationRate?: string;
    subtitlesEnabled?: boolean;
    musicEnabled?: boolean;
    musicMood?: string;
    musicTrackPath?: string;
  }) => api.post<{ project: VideoProject }>('/videos', data).then((r) => r.data.project),
  updateScenes: (id: string, scenes: SceneLine[]) =>
    api.put<{ project: VideoProject }>(`/videos/${id}/scenes`, { scenes }).then((r) => r.data.project),
  updateMusicMood: (id: string, mood: string) =>
    api.patch<{ project: VideoProject }>(`/videos/${id}/music-mood`, { mood }).then((r) => r.data.project),
  updateMusicTrack: (id: string, trackPath: string | null) =>
    api.patch<{ project: VideoProject }>(`/videos/${id}/music-track`, { trackPath }).then((r) => r.data.project),
  updateMusicSettings: (id: string, settings: { musicEnabled?: boolean; muteOriginalAudio?: boolean }) =>
    api.patch<{ project: VideoProject }>(`/videos/${id}/music-settings`, settings).then((r) => r.data.project),
  updateBlurRegions: (id: string, regions: import('@videocloudai/shared').BlurRegion[]) =>
    api.patch<{ project: VideoProject }>(`/videos/${id}/blur-regions`, { regions }).then((r) => r.data.project),
  updateTextOverlays: (id: string, overlays: import('@videocloudai/shared').TextOverlay[]) =>
    api.patch<{ project: VideoProject }>(`/videos/${id}/text-overlays`, { overlays }).then((r) => r.data.project),
  updateTitle: (id: string, title: string) =>
    api.patch<{ project: VideoProject }>(`/videos/${id}/title`, { title }).then((r) => r.data.project),
  trim: (id: string, start: number, end: number) =>
    api.post<{ project: VideoProject }>(`/videos/${id}/trim`, { start, end }).then((r) => r.data.project),
  crop: (id: string, x: number, y: number, width: number, height: number) =>
    api.post<{ project: VideoProject }>(`/videos/${id}/crop`, { x, y, width, height }).then((r) => r.data.project),
  generateDescription: (id: string) =>
    api.post<{ project: VideoProject }>(`/videos/${id}/generate-description`).then((r) => r.data.project),
  setUploadStatus: (id: string, status: 'pending' | 'in_progress' | 'uploaded', note?: string) =>
    api.patch<{ project: VideoProject }>(`/videos/${id}/upload-status`, { status, note: note ?? null }).then((r) => r.data.project),
  generateScenes: (id: string) =>
    api.post<{ jobIds: string[]; totalScenes: number }>(`/videos/${id}/generate-scenes`).then((r) => r.data),
  assemble: (
    id: string,
    clips: unknown[],
    effects?: { motionEffect?: string; transition?: string },
    frameTransform?: { rotation: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; crop: { x: number; y: number; width: number; height: number } | null }
  ) =>
    api.post<{ jobId: string }>(`/videos/${id}/assemble`, { clips, effects, frameTransform }).then((r) => r.data.jobId),
  optimizePreview: (id: string) =>
    api.post<{ project: VideoProject; codec?: string; pixFmt?: string }>(`/videos/${id}/optimize-preview`).then((r) => r.data),
  split: (id: string, segmentDuration: number) =>
    api.post<{ segments: Array<{ index: number; filename: string; startTime: number; duration: number }> }>(
      `/videos/${id}/split`, { segmentDuration }
    ).then((r) => r.data.segments),
  splitDownloadUrl: (id: string, filename: string) => `/api/videos/${id}/splits/${filename}`,
  delete: (id: string) => api.delete(`/videos/${id}`),
  stats: () => api.get('/videos/meta/stats').then((r) => r.data),
};

// Library
export const libraryApi = {
  listScenes: (params?: { mood?: SceneMood; style?: SceneStyle; category?: SceneCategory; limit?: number }) =>
    api.get<{ scenes: SceneMetadata[] }>('/library/scenes', { params }).then((r) => r.data.scenes),
  getScene: (id: string) =>
    api.get<{ scene: SceneMetadata }>(`/library/scenes/${id}`).then((r) => r.data.scene),
  createScene: (data: Partial<SceneMetadata> & { title: string; mood: SceneMood; style: SceneStyle }) =>
    api.post<{ scene: SceneMetadata }>('/library/scenes', data).then((r) => r.data.scene),
  searchScenes: (query: string, limit?: number) =>
    api.get<{ results: Array<SceneMetadata & { asset?: AssetRecord }> }>(
      `/library/scenes/search/${encodeURIComponent(query)}`,
      { params: { limit } }
    ).then((r) => r.data.results),
  findReuseMatches: (sceneLine: SceneLine, limit?: number) =>
    api.post('/library/scenes/reuse-matches', { sceneLine, limit }).then((r) => r.data.matches),
  listAssets: (sceneId?: string) =>
    api.get<{ assets: AssetRecord[] }>('/library/assets', { params: { sceneId } }).then((r) => r.data.assets),
  stats: () => api.get('/library/stats').then((r) => r.data),
};

// Generations
export const generationsApi = {
  list: (status?: string) =>
    api.get<{ generations: GenerationRequest[] }>('/generations', { params: { status } }).then((r) => r.data.generations),
  get: (id: string) =>
    api.get<{ generation: GenerationRequest }>(`/generations/${id}`).then((r) => r.data.generation),
  create: (sceneLine: SceneLine, provider?: string) =>
    api.post<{ generation: GenerationRequest; jobId: string }>('/generations', { sceneLine, provider }).then((r) => r.data),
  providers: () =>
    api.get<{ providers: string[] }>('/generations/meta/providers').then((r) => r.data.providers),
};

// Queue
export const queueApi = {
  list: (status?: string) =>
    api.get<{ jobs: JobRecord[] }>('/queue', { params: { status } }).then((r) => r.data.jobs),
  get: (id: string) =>
    api.get<{ job: JobRecord }>(`/queue/${id}`).then((r) => r.data.job),
  stats: () =>
    api.get<QueueStats>('/queue/stats').then((r) => r.data),
  cancel: (id: string) => api.delete(`/queue/${id}`),
  remove: (id: string) => api.delete(`/queue/${id}?force=1`),
};

// Export
export const exportApi = {
  export: (videoId: string, formats: VideoFormat[]) =>
    api.post(`/export/${videoId}`, { formats }).then((r) => r.data),
  downloadUrl: (videoId: string) => `/api/export/${videoId}/download`,
  // The URL is keyed on a version token (typically project.updatedAt) so the browser
  // doesn't serve a cached response of the previous outputPath after Assemble.
  previewUrl: (videoId: string, version?: string) =>
    `/api/export/${videoId}/preview${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  thumbnailUrl: (videoId: string, version?: string) =>
    `/api/export/${videoId}/thumbnail${version ? `?v=${encodeURIComponent(version)}` : ''}`,
};

// Batch
export const batchApi = {
  list: () => api.get('/batch').then((r) => r.data.batchJobs),
  create: (templateVideoId: string, count: number) =>
    api.post('/batch', { templateVideoId, count }).then((r) => r.data),
  get: (id: string) => api.get(`/batch/${id}`).then((r) => r.data.batchJob),
};

// Music
export interface EpidemicTrack {
  id: number;
  title: string;
  artist: string;
  duration: number;
  previewUrl: string;
  genres: string[];
  moods: string[];
}

export const musicApi = {
  // Epidemic Sound (no API key needed)
  epidemicSearch: (mood: string, term?: string, limit?: number) =>
    api.get<{ tracks: EpidemicTrack[] }>(
      '/music/epidemic/search', { params: { mood, term, limit } }
    ).then((r) => r.data.tracks),
  epidemicDownload: (track: EpidemicTrack) =>
    api.post<{ filename: string; localPath: string; duration: number }>('/music/epidemic/download', { track }).then((r) => r.data),
  // Jamendo (requires API key)
  search: (mood: string, limit?: number) =>
    api.get<{ tracks: Array<{ id: string; name: string; artist_name: string; duration: number; audio: string; audiodownload: string; image: string; shareurl: string }>; mood: string }>(
      '/music/search', { params: { mood, limit } }
    ).then((r) => r.data),
  download: (track: object) =>
    api.post<{ localPath: string; trackId: string }>('/music/download', { track }).then((r) => r.data),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ filename: string; duration: number; sizeKB: number }>('/music/upload', form).then((r) => r.data);
  },
  cached: () =>
    api.get<{ tracks: Array<{ id: string; filename: string; sizeKB: number; duration: number }> }>('/music/cached').then((r) => r.data.tracks),
  deleteTrack: (filename: string) => api.delete(`/music/cached/${encodeURIComponent(filename)}`).then((r) => r.data),
  clearCache: () => api.delete('/music/cached').then((r) => r.data),
  moods: () => api.get<{ moods: Record<string, string> }>('/music/moods').then((r) => r.data.moods),
  streamUrl: (filename: string) => `${api.defaults.baseURL}/music/stream/${encodeURIComponent(filename)}`,
};

// Script generation
export const scriptApi = {
  generate: (topic: string, duration: number, systemPrompt?: string) =>
    api.post<{ script: string }>('/script/generate', { topic, duration, systemPrompt }).then((r) => r.data.script),
  defaultPrompt: (lang?: string) =>
    api.get<{ prompt: string }>('/script/default-prompt', { params: { lang } }).then((r) => r.data.prompt),
  generateHooks: (script: string, count?: number) =>
    api.post<{ hooks: string[] }>('/script/hooks', { script, count }).then((r) => r.data.hooks),
};


// URL Import
export const importApi = {
  checkYtDlp: () => api.get<{ available: boolean }>('/import/check').then((r) => r.data),
  // Enqueues an import job and returns the jobId. Subscribe to /api/events for progress.
  fromUrl: (url: string) =>
    api.post<{ jobId: string }>('/import/url', { url }).then((r) => r.data.jobId),
};

// Channels
export const channelsApi = {
  list: (platform?: Platform) =>
    api.get<{ channels: Channel[] }>('/channels', { params: platform ? { platform } : undefined }).then((r) => r.data.channels),
  get: (id: string) =>
    api.get<{ channel: Channel }>(`/channels/${id}`).then((r) => r.data.channel),
  create: (data: { name: string; platform: Platform; handle?: string; url?: string; description?: string; defaultCaption?: string; defaultHashtags?: string }) =>
    api.post<{ channel: Channel }>('/channels', data).then((r) => r.data.channel),
  update: (id: string, data: { name?: string; platform?: Platform; handle?: string | null; url?: string | null; description?: string | null; isActive?: boolean; defaultCaption?: string | null; defaultHashtags?: string | null }) =>
    api.put<{ channel: Channel }>(`/channels/${id}`, data).then((r) => r.data.channel),
  delete: (id: string) => api.delete(`/channels/${id}`),
};

// Distributions
export const distributionsApi = {
  list: (filters?: { videoId?: string; channelId?: string; status?: DistributionStatus }) =>
    api.get<{ distributions: Distribution[] }>('/distributions', { params: filters }).then((r) => r.data.distributions),
  create: (data: { videoId: string; channelId: string; status?: DistributionStatus; exportPath?: string; note?: string }) =>
    api.post<{ distribution: Distribution }>('/distributions', data).then((r) => r.data.distribution),
  update: (id: string, data: { status?: DistributionStatus; exportPath?: string | null; publishedAt?: string | null; platformUrl?: string | null; note?: string | null; performanceNote?: string | null; errorMessage?: string | null }) =>
    api.patch<{ distribution: Distribution }>(`/distributions/${id}`, data).then((r) => r.data.distribution),
  delete: (id: string) => api.delete(`/distributions/${id}`),
  platformDownloadUrl: (videoId: string, format: string) => `/api/export/${videoId}/platform/${format}/download`,
};

// OAuth
export const oauthApi = {
  startUrl: (platform: string, channelId: string): string =>
    `/api/oauth/${platform}/start?channelId=${channelId}`,
  disconnect: (channelId: string) =>
    api.delete<{ channel: Channel }>(`/oauth/channels/${channelId}/disconnect`).then((r) => r.data.channel),
  test: (channelId: string) =>
    api.get<{ ok: boolean; username?: string; error?: string }>(`/oauth/channels/${channelId}/test`).then((r) => r.data),
};

// Upload
export const uploadApi = {
  upload: (
    distributionId: string,
    opts?: {
      title?: string;
      description?: string;
      tags?: string[];
      privacyStatus?: 'public' | 'private' | 'unlisted';
    }
  ) =>
    api.post<{ jobId: string }>(`/upload/${distributionId}`, opts ?? {}).then((r) => r.data.jobId),
};

// Settings
export const settingsApi = {
  get: () => api.get<{ settings: Record<string, string> }>('/settings').then((r) => r.data.settings),
  save: (settings: Record<string, string>) => api.put('/settings', settings).then((r) => r.data),
  test: () => api.post<Record<string, boolean>>('/settings/test').then((r) => r.data),
  testService: (service: string) =>
    api.post<Record<string, boolean>>(`/settings/test/${service}`).then((r) => r.data),
  voices: () => api.get<{ voices: Record<string, { lang: string; label: string; flag: string }> }>('/settings/voices').then((r) => r.data.voices),
  previewVoice: (voice: string, rate?: string, text?: string) =>
    api.post('/settings/voices/preview', { voice, rate, text }, { responseType: 'blob' }).then((r) => r.data as Blob),
};

// TTS
export interface VoiceInfo {
  lang: string;
  label: string;
  flag: string;
  gender: 'male' | 'female';
  styles?: string[];
}

export const ttsApi = {
  voices: () =>
    api.get<{ voices: Record<string, VoiceInfo>; languages: Record<string, string> }>('/tts/voices').then((r) => r.data),
  generate: (data: { text: string; voice: string; rate?: string; pitch?: string; volume?: string; style?: string }) =>
    api.post<{ filename: string; duration: number; url: string }>('/tts/generate', data).then((r) => r.data),
  generateStream: async (
    data: { text: string; voice: string; rate?: string; pitch?: string; volume?: string; style?: string },
    onProgress: (step: string, detail?: string) => void,
  ): Promise<{ filename: string; duration: number; url: string }> => {
    const res = await fetch('/api/tts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, stream: true }),
    });
    let result: { filename: string; duration: number; url: string } | null = null;
    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string);
      else if (parsed.filename) result = parsed as any;
    });
    if (!result) throw new Error('No result from TTS generation');
    return result;
  },
  preview: (data: { voice: string; rate?: string; pitch?: string; volume?: string; style?: string; text?: string }) =>
    api.post('/tts/preview', data, { responseType: 'blob' }).then((r) => r.data as Blob),
  history: () =>
    api.get<{ files: Array<{ filename: string; url: string; sizeKB: number; duration: number; createdAt: string }> }>('/tts/history').then((r) => r.data.files),
  delete: (filename: string) =>
    api.delete(`/tts/audio/${encodeURIComponent(filename)}`).then((r) => r.data),
  transcribe: async (
    data: { file?: File; filename?: string; model?: string; language?: string },
    onProgress: (step: string, detail?: string) => void,
  ): Promise<{ text: string; entries: Array<{ index: number; startTime: string; endTime: string; text: string; startMs: number; endMs: number }>; duration: number; srtPath: string }> => {
    const form = new FormData();
    if (data.file) form.append('audio', data.file);
    if (data.filename) form.append('filename', data.filename);
    if (data.model) form.append('model', data.model);
    if (data.language) form.append('language', data.language);

    const res = await fetch('/api/tts/transcribe', { method: 'POST', body: form });
    let result: any = null;
    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string);
      else if (parsed.text !== undefined) result = parsed;
    });
    if (!result) throw new Error('No result from transcription');
    return result;
  },
};

// ─── Image Generation API ─────────────────────────────────────────────

export const imageApi = {
  generate: async (
    data: { prompt: string; aspectRatio?: string; count?: number; provider?: string },
    onProgress: (step: string, detail?: string) => void,
  ): Promise<Array<{ filename: string; url: string }>> => {
    const res = await fetch('/api/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    let result: Array<{ filename: string; url: string }> = [];
    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string);
      if (parsed.images) result = parsed.images as any;
    });
    if (!result.length) throw new Error('No images generated');
    return result;
  },
  generateBatch: async (
    data: { prompts: Array<{ timestamp: string; prompt: string }>; aspectRatio?: string; provider?: string; model?: string },
    onProgress: (step: string, detail?: string, image?: { timestamp: string; filename: string; url: string }) => void,
    signal?: AbortSignal,
  ): Promise<Array<{ timestamp: string; filename: string; url: string; prompt: string }>> => {
    const res = await fetch('/api/image/generate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal,
    });
    let result: Array<{ timestamp: string; filename: string; url: string; prompt: string }> = [];
    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string, parsed.image as any);
      if (parsed.images) result = parsed.images as any;
    });
    return result;
  },
  providers: () =>
    api.get<{ providers: Array<{ id: string; name: string; free: boolean; quality: number; needsKey: boolean; available: boolean; models: string[] }> }>('/image/providers').then((r) => r.data.providers),
  history: () =>
    api.get<Array<{ filename: string; url: string; sizeKB: number; createdAt: string }>>('/image/history').then((r) => r.data),
  delete: (filename: string) =>
    api.delete(`/image/file/${encodeURIComponent(filename)}`).then((r) => r.data),
  // Library
  libraryList: (params?: { category?: string; tag?: string; q?: string; limit?: number }) =>
    api.get<{ items: ImageLibraryItem[] }>('/image/library', { params }).then((r) => r.data.items),
  libraryCategories: () =>
    api.get<{ categories: Array<{ category: string; count: number }> }>('/image/library/categories').then((r) => r.data.categories),
  libraryTags: () =>
    api.get<{ tags: Array<{ name: string; count: number }> }>('/image/library/tags').then((r) => r.data.tags),
  librarySave: (data: { filename: string; name: string; description?: string; category?: string; tags?: string[]; prompt?: string; provider?: string; aspectRatio?: string }) =>
    api.post<{ item: ImageLibraryItem }>('/image/library', data).then((r) => r.data.item),
  libraryBatchSave: (images: Array<{ filename: string; name: string; description?: string; category?: string; tags?: string[]; prompt?: string; provider?: string; aspectRatio?: string }>) =>
    api.post<{ items: ImageLibraryItem[]; count: number }>('/image/library/batch', { images }).then((r) => r.data),
  libraryUpdate: (id: string, data: { name?: string; description?: string; category?: string; tags?: string[] }) =>
    api.put<{ item: ImageLibraryItem }>(`/image/library/${id}`, data).then((r) => r.data.item),
  libraryDelete: (id: string) =>
    api.delete(`/image/library/${id}`).then((r) => r.data),
  uploadZip: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ images: Array<{ index: number; filename: string; url: string; originalName: string }>; count: number }>(
      '/image/upload-zip', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 },
    ).then((r) => r.data);
  },
  uploadSingle: (dataUrl: string, filename?: string) =>
    api.post<{ filename: string; url: string }>('/image/upload', { dataUrl, filename }).then((r) => r.data),
  checkPromptCache: (prompts: Array<{ timestamp: string; prompt: string }>) =>
    api.post<{ cached: Array<{ timestamp: string; filename: string; url: string }> }>('/image/prompt-cache/check', { prompts }).then((r) => r.data),
  savePromptCache: (entries: Array<{ prompt: string; filename: string; url: string }>) =>
    api.post<{ saved: number }>('/image/prompt-cache/save', { entries }).then((r) => r.data),
  clearPromptCache: (prompts?: string[]) =>
    api.post<{ cleared: number }>('/image/prompt-cache/clear', { prompts }).then((r) => r.data),
  // Video generation
  videoProviders: () =>
    api.get<{ available: boolean; models: string[] }>('/image/video/providers').then((r) => r.data),
  generateVideoBatch: async (
    data: { prompts: Array<{ timestamp: string; prompt: string }>; aspectRatio?: string; duration?: number; model?: string },
    onProgress: (step: string, detail?: string, video?: { timestamp: string; filename: string; url: string }) => void,
    signal?: AbortSignal,
  ): Promise<Array<{ timestamp: string; filename: string; url: string; prompt: string }>> => {
    const res = await fetch('/api/image/video/generate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal,
    });
    let result: Array<{ timestamp: string; filename: string; url: string; prompt: string }> = [];
    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string, parsed.video as any);
      if (parsed.videos) result = parsed.videos as any;
    });
    return result;
  },
};

// ─── Storyboard API ──────────────────────────────────────────────────

export type MotionEffect = 'static' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';

export type MediaType = 'image' | 'video';

export interface StoryboardSegment {
  imageUrl: string;
  imageFilename: string;
  videoUrl?: string;
  videoFilename?: string;
  startTime: number;
  endTime: number;
  text?: string;
  motion?: MotionEffect;
  mediaType?: MediaType;
}

export interface StoryboardPromptItem {
  timestamp: string;
  text: string;
  prompt: string;
  model?: string;
}

export const storyboardApi = {
  saveTemplate: (template: string) =>
    api.post<{ ok: boolean; sections: string[] }>('/storyboard/template', { template }).then((r) => r.data),
  getTemplate: () =>
    api.get<{ template: string; sections: Record<string, string>; stageParts: Record<string, Array<{ label: string; content: string }>>; customPrompts?: Record<string, string> }>('/storyboard/template').then((r) => r.data),

  savePrompt: (stage: string, prompt: string) =>
    api.post<{ ok: boolean }>('/storyboard/save-prompt', { stage, prompt }).then((r) => r.data),

  generateTopics: (count?: number, systemPrompt?: string, templateId?: string | null, existingTopics?: string[]) =>
    api.post<{ topics: string[] }>('/storyboard/generate-topics', { count, systemPrompt, templateId: templateId || undefined, existingTopics }).then((r) => r.data.topics),

  generateScript: (data: { topic: string; duration?: number; systemPrompt?: string }) =>
    api.post<{ script: string }>('/storyboard/generate-script', data).then((r) => r.data.script),

  generateTts: async (
    data: { text: string; voice?: string; rate?: string; pitch?: string; volume?: string; style?: string },
    onProgress: (step: string, detail?: string) => void,
  ): Promise<{
    audio: { filename: string; url: string; duration: number };
    entries: Array<{ index: number; startTime: string; endTime: string; text: string; startMs: number; endMs: number }>;
  }> => {
    const res = await fetch('/api/storyboard/generate-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    let result: any = null;
    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string);
      if (parsed.done) result = parsed;
    });
    if (!result) throw new Error('No result from TTS generation');
    return { audio: result.audio, entries: result.entries };
  },

  generatePrompts: async (
    data: { segments: Array<{ timestamp: string; text: string }>; styleTemplate?: string; visualStyle?: string; aspectRatio?: string },
    onProgress: (step: string, detail?: string) => void,
  ): Promise<StoryboardPromptItem[]> => {
    const res = await fetch('/api/storyboard/generate-prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    let result: StoryboardPromptItem[] = [];
    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string);
      if (parsed.done) result = parsed.prompts as StoryboardPromptItem[];
    });
    return result;
  },

  match: (data: {
    segments: Array<{ startMs: number; endMs: number; text: string }>;
    images: Array<{ filename: string; url: string; timestamp?: string }>;
  }) =>
    api.post<{ segments: StoryboardSegment[] }>('/storyboard/match', data).then((r) => r.data.segments),

  assemble: async (
    data: { segments: StoryboardSegment[]; audioFilename: string; aspectRatio?: string; bgMusicFilename?: string; voiceVolume?: number; musicVolume?: number; outputName?: string; speed?: number; bgColor?: string },
    onProgress: (step: string, detail?: string) => void,
    signal?: AbortSignal,
  ): Promise<{ filename: string; url: string; sizeKB: number; duration: number }> => {
    const res = await fetch('/api/storyboard/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal,
    });
    let result: { filename: string; url: string; sizeKB: number; duration: number } | null = null;

    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string);
      if (parsed.done) result = parsed as typeof result;
    });
    if (!result) throw new Error('No result from assembly');
    return result;
  },

  history: () =>
    api.get<{ videos: Array<{ filename: string; url: string; sizeKB: number; createdAt: string }> }>('/storyboard/history').then((r) => r.data.videos),

  delete: (filename: string) =>
    api.delete(`/storyboard/video/${encodeURIComponent(filename)}`).then((r) => r.data),

  generateMetadata: (data: { projectId?: string; script: string; topic?: string; systemPrompt?: string }) =>
    api.post<{ metadata: { title: string; description: string; tags: string[]; thumbnailPrompt: string } }>('/storyboard/generate-metadata', data).then((r) => r.data.metadata),
  generateThumbnailPrompt: (data: { projectId?: string; title?: string; script?: string; topic?: string }) =>
    api.post<{ thumbnailPrompt: string }>('/storyboard/generate-thumbnail-prompt', data).then((r) => r.data),

  // Project CRUD
  createProject: (name: string, templateId?: string) =>
    api.post<StoryboardProject>('/storyboard/projects', { name, templateId }).then((r) => r.data),
  listProjects: () =>
    api.get<StoryboardProjectSummary[]>('/storyboard/projects').then((r) => r.data),
  getProject: (id: string) =>
    api.get<StoryboardProject>(`/storyboard/projects/${id}`).then((r) => r.data),
  updateProject: (id: string, data: Partial<StoryboardProject>) =>
    api.put(`/storyboard/projects/${id}`, data).then((r) => r.data),
  deleteProject: (id: string) =>
    api.delete(`/storyboard/projects/${id}`).then((r) => r.data),

  // Template CRUD
  createTemplate: (data: { name: string; niche?: string; description?: string; templateText?: string; color?: string; youtubeUrl?: string; memo?: string; visualStyle?: string; customPrompts?: Record<string, string> }) =>
    api.post<StoryboardTemplate>('/storyboard/templates', data).then((r) => r.data),
  listTemplates: () =>
    api.get<StoryboardTemplateSummary[]>('/storyboard/templates').then((r) => r.data),
  getTemplateById: (id: string) =>
    api.get<StoryboardTemplateDetail>(`/storyboard/templates/${id}`).then((r) => r.data),
  syncTemplatePrompts: (id: string) =>
    api.post<{ ok: boolean; updated: number }>(`/storyboard/templates/${id}/sync-prompts`).then((r) => r.data),
  updateTemplate: (id: string, data: Partial<StoryboardTemplate>) =>
    api.put(`/storyboard/templates/${id}`, data).then((r) => r.data),
  deleteTemplate: (id: string) =>
    api.delete(`/storyboard/templates/${id}`).then((r) => r.data),
  saveTemplatePrompt: (templateId: string, stage: string, prompt: string) =>
    api.post<{ ok: boolean }>(`/storyboard/templates/${templateId}/save-prompt`, { stage, prompt }).then((r) => r.data),
  generateTemplate: (niche: string, referenceTemplateId?: string) =>
    api.post<{ templateText: string; name: string; niche: string; description: string; sectionCount: number; sections: string[] }>('/storyboard/templates/generate', { niche, referenceTemplateId }).then((r) => r.data),
  aiPrompt: (templateId: string, instruction: string, stage?: string) =>
    api.post<{ ok: boolean; stage?: string; prompt?: string; stages?: Record<string, string> }>(`/storyboard/templates/${templateId}/ai-prompt`, { instruction, stage }).then((r) => r.data),
  getDefaults: () =>
    api.get<{ stagePrompts: Record<string, string>; stageParts: Record<string, Array<{ label: string; content: string }>> }>('/storyboard/templates/defaults').then((r) => r.data),
  saveDefaultPrompt: (stage: string, prompt: string) =>
    api.post<{ ok: boolean }>('/storyboard/templates/defaults', { stage, prompt }).then((r) => r.data),
  resetDefaultPrompt: (stage: string) =>
    api.delete<{ ok: boolean }>(`/storyboard/templates/defaults/${stage}`).then((r) => r.data),
};

export interface StoryboardProjectSummary {
  id: string; name: string; templateId?: string; currentStep: string; topic?: string;
  status: string; audioDuration?: number; resultFilename?: string; thumbnailUrl?: string;
  thumbnailPrompt?: string;
  speed?: number;
  templateName?: string; templateNiche?: string; templateColor?: string;
  templateYoutubeUrl?: string; templateMemo?: string;
  metadataDesc?: string; metadataTags?: string[] | string;
  createdAt: string; updatedAt: string;
}

export interface StoryboardProject extends StoryboardProjectSummary {
  script?: string; scriptDuration: number; voice?: string;
  audioFilename?: string; transcriptEntries: Array<{ index: number; startTime: string; endTime: string; text: string; startMs: number; endMs: number }>;
  prompts: StoryboardPromptItem[];
  generatedImages: Array<{ timestamp: string; filename: string; url: string; status: string }>;
  segments: StoryboardSegment[];
  metadataTitle?: string; metadataDesc?: string; metadataTags: string[];
  resultUrl?: string; resultSizeKB?: number;
  bgMusicFilename?: string; voiceVolume?: number; musicVolume?: number;
  topicsPrompt?: string; scriptPrompt?: string; imagePromptPrompt?: string; metadataPrompt?: string;
  thumbnailBgColor?: string;
  bgColor?: string;
  stageParts: Record<string, Array<{ label: string; content: string }>>;
}

export interface StoryboardTemplateSummary {
  id: string; name: string; niche: string; description: string; color: string;
  youtubeUrl: string; memo: string; nicheStatus: string; visualStyle: string;
  createdAt: string; updatedAt: string;
}

export interface StoryboardTemplate extends StoryboardTemplateSummary {
  templateText: string; customPrompts: Record<string, string>;
}

export interface StoryboardTemplateDetail extends StoryboardTemplate {
  sections: Record<string, string>;
  stageParts: Record<string, Array<{ label: string; content: string }>>;
  stagePrompts: Record<string, string>;
}

// ── Drama Studio API ──

import type {
  DramaProject,
  DramaEpisode,
  DramaCharacter,
  DramaLocation,
  DramaScene,
  DramaShot,
  CreateDramaProjectInput,
} from '@videocloudai/shared';

export type { DramaProject, DramaEpisode, DramaCharacter, DramaLocation, DramaScene, DramaShot };

export const dramaApi = {
  // Projects
  listProjects: (mode?: 'video' | 'image') => api.get<DramaProject[]>('/drama/projects', { params: { mode } }).then(r => r.data),
  getProject: (id: string) => api.get<DramaProject>(`/drama/projects/${id}`).then(r => r.data),
  createProject: (data: CreateDramaProjectInput) => api.post<DramaProject>('/drama/projects', data).then(r => r.data),
  updateProject: (id: string, data: Partial<DramaProject>) => api.patch<DramaProject>(`/drama/projects/${id}`, data).then(r => r.data),
  deleteProject: (id: string) => api.delete(`/drama/projects/${id}`),

  // Episodes
  listEpisodes: (projectId: string) => api.get<DramaEpisode[]>(`/drama/projects/${projectId}/episodes`).then(r => r.data),
  getEpisode: (id: string) => api.get<DramaEpisode>(`/drama/episodes/${id}`).then(r => r.data),
  updateEpisode: (id: string, data: Partial<DramaEpisode>) => api.patch<DramaEpisode>(`/drama/episodes/${id}`, data).then(r => r.data),

  // Characters
  listCharacters: (projectId: string) => api.get<DramaCharacter[]>(`/drama/projects/${projectId}/characters`).then(r => r.data),
  createCharacter: (projectId: string, data: { name: string; role?: string }) => api.post<DramaCharacter>(`/drama/projects/${projectId}/characters`, data).then(r => r.data),
  updateCharacter: (id: string, data: Partial<DramaCharacter>) => api.patch<DramaCharacter>(`/drama/characters/${id}`, data).then(r => r.data),
  deleteCharacter: (id: string) => api.delete(`/drama/characters/${id}`),

  // Locations
  listLocations: (projectId: string) => api.get<DramaLocation[]>(`/drama/projects/${projectId}/locations`).then(r => r.data),
  createLocation: (projectId: string, data: { name: string; type?: string }) => api.post<DramaLocation>(`/drama/projects/${projectId}/locations`, data).then(r => r.data),
  updateLocation: (id: string, data: Partial<DramaLocation>) => api.patch<DramaLocation>(`/drama/locations/${id}`, data).then(r => r.data),
  deleteLocation: (id: string) => api.delete(`/drama/locations/${id}`),

  // Scenes
  listScenes: (episodeId: string) => api.get<DramaScene[]>(`/drama/episodes/${episodeId}/scenes`).then(r => r.data),
  getScene: (id: string) => api.get<DramaScene>(`/drama/scenes/${id}`).then(r => r.data),
  createScene: (episodeId: string, data: { sceneNumber: number; heading: string; locationId?: string; description?: string; mood?: string }) =>
    api.post<DramaScene>(`/drama/episodes/${episodeId}/scenes`, data).then(r => r.data),
  updateScene: (id: string, data: Partial<DramaScene>) => api.patch<DramaScene>(`/drama/scenes/${id}`, data).then(r => r.data),
  deleteScene: (id: string) => api.delete(`/drama/scenes/${id}`),

  // Shots
  listShots: (sceneId: string) => api.get<DramaShot[]>(`/drama/scenes/${sceneId}/shots`).then(r => r.data),
  getShot: (id: string) => api.get<DramaShot>(`/drama/shots/${id}`).then(r => r.data),
  createShot: (sceneId: string, data: { shotNumber: number; description: string; cameraAngle?: string; duration?: number }) =>
    api.post<DramaShot>(`/drama/scenes/${sceneId}/shots`, data).then(r => r.data),
  updateShot: (id: string, data: Partial<DramaShot>) => api.patch<DramaShot>(`/drama/shots/${id}`, data).then(r => r.data),
  deleteShot: (id: string) => api.delete(`/drama/shots/${id}`),

  // AI Generation
  generateOutline: (projectId: string, episodeId: string) => api.post<DramaEpisode>(`/drama/projects/${projectId}/episodes/${episodeId}/generate-outline`).then(r => r.data),
  generateScript: (projectId: string, episodeId: string) => api.post<DramaEpisode>(`/drama/projects/${projectId}/episodes/${episodeId}/generate-script`).then(r => r.data),
  extractCharacters: (projectId: string, episodeId: string) => api.post<DramaCharacter[]>(`/drama/projects/${projectId}/episodes/${episodeId}/extract-characters`).then(r => r.data),
  extractLocations: (projectId: string, episodeId: string) => api.post<DramaLocation[]>(`/drama/projects/${projectId}/episodes/${episodeId}/extract-locations`).then(r => r.data),
  generateStoryboard: (projectId: string, episodeId: string) => api.post<DramaScene[]>(`/drama/projects/${projectId}/episodes/${episodeId}/generate-storyboard`).then(r => r.data),
  generateShotPrompt: (projectId: string, shotId: string) => api.post<DramaShot>(`/drama/projects/${projectId}/shots/${shotId}/generate-prompt`).then(r => r.data),
  generateShotVideo: (projectId: string, shotId: string, mode?: 'ai' | 'motion') => api.post<DramaShot>(`/drama/projects/${projectId}/shots/${shotId}/generate-video`, { mode }).then(r => r.data),
  generateAllPrompts: (projectId: string, episodeId: string) => api.post<{ generated: number; shots: Array<{ id: string; prompt: string }> }>(`/drama/projects/${projectId}/episodes/${episodeId}/generate-all-prompts`).then(r => r.data),
  reviewEpisode: (projectId: string, episodeId: string) => api.post<{ score: number; feedback: string; issues: Array<{ area: string; severity: string; detail: string; fix?: string }> }>(`/drama/projects/${projectId}/episodes/${episodeId}/review`).then(r => r.data),
  applyReviewFixes: (projectId: string, episodeId: string, issues: Array<{ area: string; severity: string; detail: string; fix?: string }>) => api.post<DramaEpisode>(`/drama/projects/${projectId}/episodes/${episodeId}/apply-fixes`, { issues }).then(r => r.data),
  clearEpisodeImages: (projectId: string, episodeId: string) => api.delete<{ cleared: number }>(`/drama/projects/${projectId}/episodes/${episodeId}/images`).then(r => r.data),
  generateAudio: async (
    projectId: string,
    episodeId: string,
    data: { voiceVolume?: number; musicVolume?: number; bgMusicTrack?: string },
    onProgress: (step: string, detail?: string) => void,
  ): Promise<{ audioFilename: string; audioDuration: number; url: string }> => {
    const res = await fetch(`/api/drama/projects/${projectId}/episodes/${episodeId}/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    let result: any = null;
    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string);
      if (parsed.success) result = parsed;
    });
    if (!result) throw new Error('No result from Audio generation');
    return result;
  },
  generateSubtitles: (projectId: string, episodeId: string) =>
    api.post<{ success: boolean; srtFilename: string; srtContent: string }>(`/drama/projects/${projectId}/episodes/${episodeId}/generate-subtitles`).then(r => r.data),
  exportEpisode: async (
    projectId: string,
    episodeId: string,
    data: { preset?: string; ratio?: string },
    onProgress: (step: string, detail?: string) => void,
  ): Promise<{ videoFilename: string; url: string }> => {
    const res = await fetch(`/api/drama/projects/${projectId}/episodes/${episodeId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    let result: any = null;
    await readNDJSON(res, (parsed) => {
      if (parsed.error) throw new Error(parsed.error as string);
      if (parsed.progress) onProgress(parsed.step as string, parsed.detail as string);
      if (parsed.success) result = parsed;
    });
    if (!result) throw new Error('No result from video export');
    return result;
  },

  // Stats
  stats: (mode?: 'video' | 'image') => api.get<{ totalProjects: number; inProgress: number; completed: number; totalEpisodes: number; totalCharacters: number }>('/drama/stats', { params: { mode } }).then(r => r.data),
};

export interface ImageLibraryItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string;
  filename: string;
  filepath: string;
  url: string;
  width: number | null;
  height: number | null;
  filesize: number;
  mime_type: string;
  prompt: string | null;
  provider: string | null;
  aspect_ratio: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string;
}
