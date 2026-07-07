import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import * as path from 'path';
import * as fs from 'fs';

import { createVideosRouter } from './routes/videos.routes';
import { createLibraryRouter } from './routes/library.routes';
import { createGenerationRouter } from './routes/generation.routes';
import { createQueueRouter } from './routes/queue.routes';
import { createExportRouter } from './routes/export.routes';
import { createBatchRouter } from './routes/batch.routes';
import { createSettingsRouter } from './routes/settings.routes';
import { createMusicRouter } from './routes/music.routes';
import { createScriptRouter } from './routes/script.routes';
import { createImportRouter } from './routes/import.routes';
import { createChannelsRouter } from './routes/channels.routes';
import { createDistributionsRouter } from './routes/distributions.routes';
import { createOAuthRouter } from './routes/oauth.routes';
import { createUploadRouter } from './routes/upload.routes';
import { createTtsRouter } from './routes/tts.routes';
import { createImageRouter } from './routes/image.routes';
import { createStoryboardRouter } from './routes/storyboard.routes';
import { createDramaRouter } from './routes/drama.routes';
import { DramaService } from './services/drama.service';
import { ChannelService } from './services/channel.service';
import { DistributionService } from './services/distribution.service';
import { PlatformUploadService } from './services/platform-upload.service';
import { SceneLibraryService } from './services/scene-library.service';
import { GenerationService } from './services/generation.service';
import { VideoService } from './services/video.service';
import { NarrationService } from './services/narration.service';
import { SubtitleService } from './services/subtitle.service';
import { getJobQueue } from './queue/queue';
import { registerHandlers } from './queue/handlers';

export function createApp() {
  const app = express();

  const allowedOrigins = process.env.CORS_ORIGIN
    ? [process.env.CORS_ORIGIN]
    : ['http://localhost:5174', 'http://localhost:5173', 'http://localhost:3000'];
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '50mb' }));
  app.use(morgan('dev'));

  // Static file serving for assets and renders
  const assetsDir = path.resolve(process.env.ASSETS_DIR ?? './assets');
  const rendersDir = path.resolve(process.env.RENDERS_DIR ?? './renders');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(rendersDir, { recursive: true });

  app.use('/assets', express.static(assetsDir));
  app.use('/renders', express.static(rendersDir));

  // Initialize services
  const dramaService = new DramaService();
  const channelService = new ChannelService();
  const distributionService = new DistributionService(channelService);
  const platformUploadService = new PlatformUploadService(channelService, distributionService);
  const libraryService = new SceneLibraryService();
  const generationService = new GenerationService(libraryService);
  const narrationService = new NarrationService();
  const subtitleService = new SubtitleService();
  const videoService = new VideoService(libraryService, narrationService, subtitleService);

  // Register job handlers, THEN resume any pending jobs from the database. The order
  // matters — resuming first runs jobs with no handlers attached and fails them as
  // "No handler registered for job type: ...".
  registerHandlers(generationService, videoService, platformUploadService);
  getJobQueue().resumePendingJobs();

  // Routes
  app.use('/api/videos', createVideosRouter(videoService, generationService, libraryService));
  app.use('/api/library', createLibraryRouter(libraryService));
  app.use('/api/generations', createGenerationRouter(generationService));
  app.use('/api/queue', createQueueRouter());
  app.use('/api/export', createExportRouter(videoService));
  app.use('/api/batch', createBatchRouter(videoService));
  app.use('/api/settings', createSettingsRouter());
  app.use('/api/music', createMusicRouter());
  app.use('/api/script', createScriptRouter());
  app.use('/api/import', createImportRouter(videoService));
  app.use('/api/channels', createChannelsRouter(channelService));
  app.use('/api/distributions', createDistributionsRouter(distributionService));
  app.use('/api/oauth', createOAuthRouter(platformUploadService, channelService));
  app.use('/api/upload', createUploadRouter(platformUploadService, distributionService));
  app.use('/api/tts', createTtsRouter(narrationService, subtitleService));
  app.use('/api/image', createImageRouter());
  app.use('/api/storyboard', createStoryboardRouter(narrationService, subtitleService));
  app.use('/api/drama', createDramaRouter(dramaService, narrationService, subtitleService));

  // Queue WebSocket events endpoint (SSE)
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const queue = getJobQueue();

    const onEvent = (event: string) => (data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const handlers: Array<[string, (d: unknown) => void]> = [
      ['job:queued', onEvent('job:queued')],
      ['job:started', onEvent('job:started')],
      ['job:progress', onEvent('job:progress')],
      ['job:completed', onEvent('job:completed')],
      ['job:failed', onEvent('job:failed')],
    ];

    handlers.forEach(([event, handler]) => queue.on(event, handler));

    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 30_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      handlers.forEach(([event, handler]) => queue.off(event, handler));
    });
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve compiled web app (SPA)
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/assets') || req.path.startsWith('/renders')) {
        return next();
      }
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  });

  return app;
}
