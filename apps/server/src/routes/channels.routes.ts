import { Router, Request, Response } from 'express';
import { ChannelService } from '../services/channel.service';
import type { Platform } from '@videocloudai/shared';

export function createChannelsRouter(channelService: ChannelService): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const { platform } = req.query as { platform?: Platform };
    res.json({ channels: channelService.list(platform) });
  });

  router.get('/:id', (req: Request, res: Response) => {
    const channel = channelService.get(req.params['id'] as string);
    if (!channel) { res.status(404).json({ error: 'Channel not found' }); return; }
    res.json({ channel });
  });

  router.post('/', (req: Request, res: Response) => {
    const { name, platform, handle, url, description, defaultCaption, defaultHashtags } = req.body as {
      name?: string;
      platform?: Platform;
      handle?: string;
      url?: string;
      description?: string;
      defaultCaption?: string;
      defaultHashtags?: string;
    };
    if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
    if (!platform) { res.status(400).json({ error: 'platform is required' }); return; }

    const channel = channelService.create({ name: name.trim(), platform, handle, url, description, defaultCaption, defaultHashtags });
    res.status(201).json({ channel });
  });

  router.put('/:id', (req: Request, res: Response) => {
    const { name, platform, handle, url, description, isActive, defaultCaption, defaultHashtags } = req.body as {
      name?: string;
      platform?: Platform;
      handle?: string | null;
      url?: string | null;
      description?: string | null;
      isActive?: boolean;
      defaultCaption?: string | null;
      defaultHashtags?: string | null;
    };
    const channel = channelService.update(req.params['id'] as string, { name, platform, handle, url, description, isActive, defaultCaption, defaultHashtags });
    if (!channel) { res.status(404).json({ error: 'Channel not found' }); return; }
    res.json({ channel });
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const deleted = channelService.delete(req.params['id'] as string);
    if (!deleted) { res.status(404).json({ error: 'Channel not found' }); return; }
    res.json({ success: true });
  });

  return router;
}
