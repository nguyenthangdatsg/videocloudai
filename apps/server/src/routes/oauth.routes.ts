import { Router, Request, Response } from 'express';
import { PlatformUploadService } from '../services/platform-upload.service';
import { ChannelService } from '../services/channel.service';

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>Connected</title></head>
<body>
<script>window.opener && window.opener.postMessage('oauth-success', '*'); window.close();</script>
<p>Connected! You can close this window.</p>
</body>
</html>`;

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Connection Failed</title></head>
<body>
<h3 style="color:red">Connection failed</h3>
<p>${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
<p>You can close this window and try again.</p>
</body>
</html>`;
}

export function createOAuthRouter(
  uploadService: PlatformUploadService,
  channelService: ChannelService
): Router {
  const router = Router();

  // GET /api/oauth/:platform/start?channelId=xxx
  router.get('/:platform/start', async (req: Request, res: Response) => {
    const platform = req.params['platform'] as string;
    const { channelId } = req.query as { channelId?: string };

    if (!channelId) {
      res.status(400).json({ error: 'channelId query parameter is required' });
      return;
    }

    try {
      const url = await uploadService.getOAuthUrl(channelId);
      res.json({ url });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/oauth/:platform/callback?code=xxx&state=xxx
  router.get('/:platform/callback', async (req: Request, res: Response) => {
    const platform = req.params['platform'] as string;
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

    res.setHeader('Content-Type', 'text/html');

    if (error) {
      res.send(errorHtml(`OAuth error: ${error}`));
      return;
    }

    if (!code || !state) {
      res.send(errorHtml('Missing code or state parameter'));
      return;
    }

    const channelId = decodeURIComponent(state as string);

    try {
      await uploadService.handleOAuthCallback(platform, code as string, channelId);
      res.send(SUCCESS_HTML);
    } catch (err) {
      res.send(errorHtml((err as Error).message));
    }
  });

  // GET /api/oauth/channels/:channelId/test
  router.get('/channels/:channelId/test', async (req: Request, res: Response) => {
    const channelId = req.params['channelId'] as string;
    try {
      const result = await uploadService.testChannelConnection(channelId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // DELETE /api/oauth/channels/:channelId/disconnect
  router.delete('/channels/:channelId/disconnect', (req: Request, res: Response) => {
    const channelId = req.params['channelId'] as string;

    try {
      const updated = channelService.clearOAuthTokens(channelId);
      if (!updated) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }
      res.json({ channel: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
