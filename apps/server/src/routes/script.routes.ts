import { Router } from 'express';
import { generateScript, getDefaultSystemPrompt, generateHooks } from '../services/script-gen.service';
import { getSettings } from '../services/settings.service';

export function createScriptRouter(): Router {
  const router = Router();

  router.get('/default-prompt', (req, res) => {
    const s = getSettings();
    const stored = s.get('groq_system_prompt');
    const lang = req.query.lang as string | undefined;
    res.json({ prompt: stored || getDefaultSystemPrompt(lang) });
  });

  router.post('/hooks', async (req, res) => {
    const { script, count } = req.body as { script?: string; count?: number };
    if (!script?.trim()) {
      return res.status(400).json({ error: 'script is required' });
    }
    try {
      const hooks = await generateHooks(script.trim(), count ?? 5);
      return res.json({ hooks });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  });

  router.post('/generate', async (req, res) => {
    const { topic, duration, systemPrompt } = req.body as {
      topic: string;
      duration?: number;
      systemPrompt?: string;
    };

    if (!topic?.trim()) {
      return res.status(400).json({ error: 'topic is required' });
    }

    try {
      const script = await generateScript(topic.trim(), duration ?? 30, systemPrompt);
      return res.json({ script });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  });

  return router;
}
