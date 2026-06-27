import * as path from 'path';
import type { JobRecord } from '@videocloudai/shared';
import { getJobQueue } from './queue';
import { GenerationService } from '../services/generation.service';
import { VideoService } from '../services/video.service';
import { PlatformUploadService } from '../services/platform-upload.service';
import { importFromUrl } from '../services/import.service';
import type { TimelineClip } from '@videocloudai/shared';

export function registerHandlers(
  generationService: GenerationService,
  videoService: VideoService,
  platformUploadService: PlatformUploadService
): void {
  const queue = getJobQueue();

  queue.registerHandler('generate-scene', async (job: JobRecord, onProgress) => {
    const { generationId, sceneLine } = job.payload as {
      generationId: string;
      sceneLine: Record<string, unknown>;
    };

    onProgress(10, 'Submitting to AI provider');
    const assetId = await generationService.executeGeneration(generationId);
    onProgress(90, 'Asset downloaded');
    return { assetId };
  });

  queue.registerHandler('assemble-video', async (job: JobRecord, onProgress) => {
    const { videoId, clips, effects, frameTransform } = job.payload as {
      videoId: string;
      clips: TimelineClip[];
      effects?: { motionEffect?: string; transition?: string };
      frameTransform?: { rotation: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; crop: { x: number; y: number; width: number; height: number } | null };
    };

    const result = await videoService.assembleVideo(videoId, clips, ({ stage, percent }) => {
      onProgress(percent, stage);
    }, effects, frameTransform);

    return { outputPath: result.outputPath, effectsSkipped: result.effectsSkipped };
  });

  queue.registerHandler('import-url', async (job: JobRecord, onProgress) => {
    const { url } = job.payload as { url: string };
    const assetsDir = path.resolve(process.env.ASSETS_DIR ?? './assets');

    // Steps 1-5 (2% → 85%) live inside importFromUrl
    const result = await importFromUrl(url, assetsDir, (pct, msg) => onProgress(pct, msg));

    onProgress(88, 'Creating project');
    const project = videoService.createProjectFromFile({
      title: result.title,
      filePath: result.filePath,
      duration: result.duration,
      originalDescription: result.description,
      importedFromUrl: result.sourceUrl ?? url,
      originalAuthor: result.author,
      originalAuthorUrl: result.authorUrl,
    });

    // Step 6 — Groq description rewrite. Synchronous here so the user sees the caption
    // by the time the editor opens. Failures are non-fatal — the project still imports.
    if (result.description) {
      onProgress(94, 'Generating AI caption');
      try {
        await videoService.generateAiDescription(project.id);
      } catch (err) {
        console.warn(`[import-url] AI description generation failed for ${project.id}:`, (err as Error).message);
      }
    }

    onProgress(100, 'Done');
    return { projectId: project.id, project };
  });

  queue.registerHandler('upload-to-platform', async (job: JobRecord, onProgress) => {
    const { distributionId } = job.payload as { distributionId: string };
    const result = await platformUploadService.executeUpload(distributionId, onProgress);
    return result;
  });

  queue.registerHandler('batch-generate', async (job: JobRecord, onProgress) => {
    const { batchJobId, templateVideoId, count } = job.payload as {
      batchJobId: string;
      templateVideoId: string;
      count: number;
    };

    const template = videoService.getProject(templateVideoId);
    if (!template) throw new Error(`Template video ${templateVideoId} not found`);

    const outputIds: string[] = [];
    for (let i = 0; i < count; i++) {
      onProgress(Math.round((i / count) * 90), `Generating variation ${i + 1}/${count}`);

      const variation = videoService.createProject({
        title: `${template.title} — Variation ${i + 1}`,
        script: template.script,
        format: template.format,
        duration: template.duration,
      });

      outputIds.push(variation.id);
    }

    return { outputVideoIds: outputIds, count };
  });
}
