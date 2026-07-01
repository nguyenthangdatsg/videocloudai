import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NarrationService } from '../services/narration.service';
import { SubtitleService } from '../services/subtitle.service';
import { getSettings } from '../services/settings.service';
import { llmComplete } from '../services/llm.service';
import { dbGet, dbAll, dbRun } from '../db';
import { renderSceneClip } from '../services/remotion-renderer.service';
import type { SceneClipConfig } from '../remotion/types';

const execFileAsync = promisify(execFile);

/** Resolve a full-featured FFmpeg binary (not Remotion's limited build). */
async function resolveFullFfmpeg(): Promise<string> {
  // 1. User-configured path
  const configured = getSettings().get('ffmpeg_path') || process.env.FFMPEG_PATH || '';
  if (configured && fs.existsSync(configured)) return configured;

  // 2. System PATH
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5_000 });
    return 'ffmpeg';
  } catch { /* not on PATH */ }

  // 3. ffmpeg-static npm package (full build with all filters)
  try {
    const staticBin: string = require('ffmpeg-static');
    if (staticBin && fs.existsSync(staticBin)) return staticBin;
  } catch { /* not installed */ }

  throw new Error('No full-featured FFmpeg found. Set FFMPEG_PATH in .env or install ffmpeg-static.');
}

/** Default stage prompt structures — used as starting point for new niches */
const DEFAULT_STAGE_PROMPTS: Record<string, { parts: { label: string; content: string }[] }> = {
  topics: {
    parts: [
      { label: 'ROLE & PERSONA (Preamble)', content: 'You are a world-class YouTube scriptwriter and content strategist specializing in [NICHE]. Your channel creates cinematic, narration-style videos about [NICHE DESCRIPTION].' },
      { label: 'CHANNEL KNOWLEDGE: Proven Viral Topic Angles', content: `### PROVEN VIRAL TOPIC ANGLES
- [10-15 specific viral topic patterns for this niche]
- Use numbers, power words, curiosity gaps
- Topics should feel like forbidden/exclusive knowledge being revealed` },
      { label: 'STAGE 1: Topic Generation Rules', content: `- Generate topics that trigger curiosity and fear of missing out
- Use numbers: "7 Signs", "5 Tricks", "3 Laws"
- Include power words in titles
- Topics should feel like forbidden knowledge being revealed
- Each topic must be specific enough to script immediately` },
      { label: 'OPERATOR RULES (Always Active)', content: `- Content must be educational and ethical
- Maintain quality boundaries while being engaging
- Always include an empowering/protective angle` },
    ],
  },
  script: {
    parts: [
      { label: 'ROLE & PERSONA (Preamble)', content: 'You are a world-class YouTube scriptwriter and content strategist specializing in [NICHE]. Your channel creates cinematic, narration-style videos about [NICHE DESCRIPTION].' },
      { label: 'CHANNEL KNOWLEDGE: Content & Script DNA', content: `### CONTENT & SCRIPT DNA
- Hook: Start with a shocking fact or provocative question in the first 5 seconds
- Tone: Authoritative, engaging, educational but never boring
- Structure: Hook → Context → 5-7 key points with examples → Call to action
- Language: Use power words like "secretly", "hidden", "dangerous", "never", "always"
- Pacing: Short punchy sentences. Vary rhythm. Build tension then release.
- Length: Scripts should be 250-400 words for 2-4 minute videos
- Always end with an empowering message` },
      { label: 'STAGE 2: Script Generation Rules', content: `- Write in second person ("you") to create personal connection
- Each paragraph = one visual scene (3-4 sentences max)
- No headers, no bullet points, no markdown — pure narration text
- Include specific examples and scenarios people can relate to
- Build tension throughout
- Never use filler phrases like "in this video" or "let's dive in"
- Write for voice narration — conversational but authoritative` },
      { label: 'OPERATOR RULES (Always Active)', content: `- Content must be educational and ethical
- Maintain quality boundaries while being engaging
- Always include an empowering/protective angle` },
    ],
  },
  prompts: {
    parts: [
      { label: 'ROLE & PERSONA (Preamble)', content: 'You are a world-class YouTube scriptwriter and content strategist specializing in [NICHE]. Your channel creates cinematic, narration-style videos about [NICHE DESCRIPTION].' },
      { label: 'CHANNEL KNOWLEDGE: Visual Style DNA', content: `### VISUAL STYLE DNA
- Cinematic, atmospheric imagery matching the niche aesthetic
- Symbolic visual elements relevant to the niche
- Color palette: [define niche-specific colors]
- Style: photorealistic, cinematic lighting, 8K quality, dramatic composition` },
      { label: 'STAGE 3: Image Prompt Generation Rules', content: `- Every image must feel cinematic and emotionally evocative
- Use consistent color palettes matching niche aesthetic
- Include symbolic elements relevant to the content
- Describe lighting explicitly: "dramatic side lighting", "rim light"
- Specify "photorealistic, cinematic, 8K, shallow depth of field"
- Avoid text, watermarks, or UI elements in prompts
- Each prompt should create a visually distinct scene` },
      { label: 'OPERATOR RULES (Always Active)', content: `- Content must be educational and ethical
- Maintain quality boundaries while being engaging
- Always include an empowering/protective angle` },
    ],
  },
  metadata: {
    parts: [
      { label: 'ROLE & PERSONA (Preamble)', content: 'You are a world-class YouTube scriptwriter and content strategist specializing in [NICHE]. Your channel creates cinematic, narration-style videos about [NICHE DESCRIPTION].' },
      { label: 'CHANNEL KNOWLEDGE (Full)', content: '[Full channel knowledge base including topic angles, script DNA, and visual style]' },
      { label: 'STAGE 4: Metadata Generation Rules', content: `- Title: Max 60 chars, include power words and numbers
- Description: 2-3 sentences summarizing value, include keywords
- Tags: 10-15 relevant tags mixing broad and specific
- Thumbnail text suggestion: 3-5 words max, high contrast
- Optimize for YouTube search and suggested videos` },
      { label: 'OPERATOR RULES (Always Active)', content: `- Content must be educational and ethical
- Maintain quality boundaries while being engaging
- Always include an empowering/protective angle` },
    ],
  },
};

/** Compose a stage prompt from its parts */
function composeDefaultPrompt(parts: { label: string; content: string }[]): string {
  return parts.filter(p => p.content.trim()).map(p => `--- ${p.label} ---\n${p.content}`).join('\n\n');
}

/** Parse a mega-prompt template into named sections */
type StagePart = { label: string; content: string };
interface ParsedTemplate {
  sections: Record<string, string>;
  stageParts: Record<string, StagePart[]>;
}

function parseTemplate(raw: string): ParsedTemplate {
  const sections: Record<string, string> = {};
  if (!raw.trim()) return { sections, stageParts: {} };

  // Split by ## headers that contain stage/section markers
  const markers = [
    { key: 'knowledge', pattern: /##.*CHANNEL KNOWLEDGE BASE/i },
    { key: 'topics', pattern: /##.*STAGE 1.*TOPIC/i },
    { key: 'script', pattern: /##.*STAGE 2.*SCRIPT/i },
    { key: 'prompts', pattern: /##.*STAGE 3.*IMAGE PROMPT/i },
    { key: 'metadata', pattern: /##.*STAGE 4.*METADATA/i },
    { key: 'rules', pattern: /##.*OPERATOR RULES/i },
  ];

  const lines = raw.split('\n');
  let currentKey = 'preamble';
  let currentLines: string[] = [];

  for (const line of lines) {
    let matched = false;
    for (const m of markers) {
      if (m.pattern.test(line)) {
        if (currentLines.length) sections[currentKey] = currentLines.join('\n').trim();
        currentKey = m.key;
        currentLines = [];
        matched = true;
        break;
      }
    }
    if (!matched) currentLines.push(line);
  }
  if (currentLines.length) sections[currentKey] = currentLines.join('\n').trim();

  // Split CHANNEL KNOWLEDGE BASE into ### subsections
  // ### CONTENT & SCRIPT DNA → scriptDna (for Stage 2: Script)
  // ### PROVEN VIRAL TOPIC ANGLES → topicAngles (for Stage 1: Topics)
  // ### VISUAL STYLE DNA → visualDna (for Stage 3: Image Prompts)
  const knowledgeRaw = sections.knowledge || '';
  const subSections: Record<string, string> = {};
  {
    const subMarkers = [
      { key: 'scriptDna', pattern: /###.*CONTENT.*SCRIPT.*DNA/i },
      { key: 'topicAngles', pattern: /###.*PROVEN.*VIRAL.*TOPIC/i },
      { key: 'visualDna', pattern: /###.*VISUAL.*STYLE.*DNA/i },
    ];
    let curKey = 'knowledgeIntro';
    let curLines: string[] = [];
    for (const line of knowledgeRaw.split('\n')) {
      let hit = false;
      for (const m of subMarkers) {
        if (m.pattern.test(line)) {
          if (curLines.length) subSections[curKey] = curLines.join('\n').trim();
          curKey = m.key;
          curLines = [line]; // keep the ### header
          hit = true;
          break;
        }
      }
      if (!hit) curLines.push(line);
    }
    if (curLines.length) subSections[curKey] = curLines.join('\n').trim();
  }

  // Store subsections for frontend display
  sections.scriptDna = subSections.scriptDna || '';
  sections.topicAngles = subSections.topicAngles || '';
  sections.visualDna = subSections.visualDna || '';

  const preamble = sections.preamble || '';
  const operatorRules = sections.rules || '';

  // Build per-stage parts (labeled blocks for frontend display) and composed system prompts
  const stageParts: Record<string, StagePart[]> = {};

  // Helper: compose system prompt from parts
  const composeParts = (parts: StagePart[]) =>
    parts.filter(p => p.content.trim()).map(p => `--- ${p.label} ---\n${p.content}`).join('\n\n');

  // Stage 1: Topics
  if (sections.topics) {
    const parts: StagePart[] = [
      { label: 'ROLE & PERSONA (Preamble)', content: preamble },
      { label: 'CHANNEL KNOWLEDGE: Proven Viral Topic Angles', content: subSections.topicAngles || '' },
      { label: 'STAGE 1: Topic Generation Rules', content: sections.topics },
      { label: 'OPERATOR RULES (Always Active)', content: operatorRules },
    ];
    stageParts.topics = parts;
    sections.topicsSystemPrompt = composeParts(parts);
  }

  // Stage 2: Script
  if (sections.script) {
    const parts: StagePart[] = [
      { label: 'ROLE & PERSONA (Preamble)', content: preamble },
      { label: 'CHANNEL KNOWLEDGE: Content & Script DNA', content: subSections.scriptDna || '' },
      { label: 'STAGE 2: Script Generation Rules', content: sections.script },
      { label: 'OPERATOR RULES (Always Active)', content: operatorRules },
    ];
    stageParts.script = parts;
    sections.scriptSystemPrompt = composeParts(parts);
  }

  // Stage 3: Image prompts
  if (sections.prompts) {
    const parts: StagePart[] = [
      { label: 'ROLE & PERSONA (Preamble)', content: preamble },
      { label: 'CHANNEL KNOWLEDGE: Visual Style DNA', content: subSections.visualDna || '' },
      { label: 'STAGE 3: Image Prompt Generation Rules', content: sections.prompts },
      { label: 'OPERATOR RULES (Always Active)', content: operatorRules },
    ];
    stageParts.prompts = parts;
    sections.imagePromptSystemPrompt = composeParts(parts);
  }

  // Stage 4: Metadata
  if (sections.metadata) {
    const parts: StagePart[] = [
      { label: 'ROLE & PERSONA (Preamble)', content: preamble },
      { label: 'CHANNEL KNOWLEDGE (Full)', content: knowledgeRaw },
      { label: 'STAGE 4: Metadata Generation Rules', content: sections.metadata },
      { label: 'OPERATOR RULES (Always Active)', content: operatorRules },
    ];
    stageParts.metadata = parts;
    sections.metadataSystemPrompt = composeParts(parts);
  }

  return { sections, stageParts };
}

/** Recompute and persist stage_prompts + stage_parts on a template row.
 *  Call after any change to template_text or custom_prompts. */
function recomputeTemplatePrompts(templateId: string): void {
  const row = dbGet<Record<string, unknown>>(
    'SELECT template_text, custom_prompts FROM storyboard_templates WHERE id = ?', [templateId],
  );
  if (!row) return;

  const parsed = parseTemplate((row.template_text as string) || '');
  let customPrompts: Record<string, string> = {};
  try { customPrompts = JSON.parse((row.custom_prompts as string) || '{}'); } catch { /* ignore */ }

  // Custom overrides take priority
  const stagePrompts: Record<string, string> = {};
  if (customPrompts.topics || parsed.sections.topicsSystemPrompt)
    stagePrompts.topics = customPrompts.topics || parsed.sections.topicsSystemPrompt;
  if (customPrompts.script || parsed.sections.scriptSystemPrompt)
    stagePrompts.script = customPrompts.script || parsed.sections.scriptSystemPrompt;
  if (customPrompts.prompts || parsed.sections.imagePromptSystemPrompt)
    stagePrompts.prompts = customPrompts.prompts || parsed.sections.imagePromptSystemPrompt;
  if (customPrompts.metadata || parsed.sections.metadataSystemPrompt)
    stagePrompts.metadata = customPrompts.metadata || parsed.sections.metadataSystemPrompt;

  dbRun(
    'UPDATE storyboard_templates SET stage_prompts = ?, stage_parts = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(stagePrompts), JSON.stringify(parsed.stageParts), new Date().toISOString(), templateId],
  );
}

export type MotionEffect = 'static' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';

export type MediaType = 'image' | 'video';

export interface StoryboardSegment {
  imageUrl: string;       // /api/image/file/xxx.jpg
  imageFilename: string;  // xxx.jpg
  videoUrl?: string;      // /api/image/video/file/xxx.mp4
  videoFilename?: string; // xxx.mp4
  startTime: number;      // seconds
  endTime: number;        // seconds
  text?: string;          // subtitle text for this segment
  motion?: MotionEffect;  // video motion effect for this clip
  mediaType?: MediaType;  // 'image' or 'video'
}

export function createStoryboardRouter(narrationService: NarrationService, subtitleService: SubtitleService): Router {
  const router = Router();

  const cacheDir = path.resolve(process.env.CACHE_DIR ?? './cache');
  const imageDir = path.resolve(cacheDir, 'images');
  const outputDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
  fs.mkdirSync(outputDir, { recursive: true });

  // ── Template (single file with all prompts) ──
  router.post('/template', (req: Request, res: Response) => {
    const { template } = req.body as { template: string };
    if (!template?.trim()) {
      res.status(400).json({ error: 'template is required' });
      return;
    }

    const s = getSettings();
    s.set('storyboard_template', template.trim());

    // Parse sections from the template
    const parsed = parseTemplate(template);
    res.json({ ok: true, sections: Object.keys(parsed.sections) });
  });

  router.get('/template', (_req: Request, res: Response) => {
    const s = getSettings();
    const raw = s.get('storyboard_template') || '';
    const parsed = parseTemplate(raw);

    // Load per-stage custom prompts (overrides from user edits)
    const customPrompts: Record<string, string> = {};
    const customRaw = s.get('storyboard_custom_prompts') || '{}';
    try { Object.assign(customPrompts, JSON.parse(customRaw)); } catch { /* ignore */ }

    // Override system prompts with saved custom versions
    if (customPrompts.topics) parsed.sections.topicsSystemPrompt = customPrompts.topics;
    if (customPrompts.script) parsed.sections.scriptSystemPrompt = customPrompts.script;
    if (customPrompts.prompts) parsed.sections.imagePromptSystemPrompt = customPrompts.prompts;
    if (customPrompts.metadata) parsed.sections.metadataSystemPrompt = customPrompts.metadata;

    res.json({ template: raw, sections: parsed.sections, stageParts: parsed.stageParts, customPrompts });
  });

  // Save a per-stage custom prompt
  router.post('/save-prompt', (req: Request, res: Response) => {
    const { stage, prompt } = req.body as { stage: string; prompt: string };
    if (!stage || !prompt?.trim()) {
      res.status(400).json({ error: 'stage and prompt are required' });
      return;
    }

    const s = getSettings();
    const customRaw = s.get('storyboard_custom_prompts') || '{}';
    let customPrompts: Record<string, string> = {};
    try { customPrompts = JSON.parse(customRaw); } catch { /* ignore */ }
    customPrompts[stage] = prompt.trim();
    s.set('storyboard_custom_prompts', JSON.stringify(customPrompts));
    res.json({ ok: true, stage });
  });

  // ── Default stage prompts (example structure) ──
  router.get('/templates/defaults', (_req: Request, res: Response) => {
    const s = getSettings();
    const saved: Record<string, string> = (() => {
      try { return JSON.parse(s.get('global_stage_prompts') || '{}'); } catch { return {}; }
    })();
    const defaults: Record<string, string> = {};
    const defaultParts: Record<string, { label: string; content: string }[]> = {};
    for (const [stage, def] of Object.entries(DEFAULT_STAGE_PROMPTS)) {
      defaults[stage] = saved[stage] || composeDefaultPrompt(def.parts);
      defaultParts[stage] = def.parts;
    }
    res.json({ stagePrompts: defaults, stageParts: defaultParts });
  });

  // Save global default prompts
  router.post('/templates/defaults', (req: Request, res: Response) => {
    const { stage, prompt } = req.body as { stage?: string; prompt?: string };
    if (!stage || !prompt?.trim()) { res.status(400).json({ error: 'stage and prompt required' }); return; }
    const s = getSettings();
    const saved: Record<string, string> = (() => {
      try { return JSON.parse(s.get('global_stage_prompts') || '{}'); } catch { return {}; }
    })();
    saved[stage] = prompt.trim();
    s.set('global_stage_prompts', JSON.stringify(saved));
    res.json({ ok: true });
  });

  // Reset a global default prompt to hardcoded default
  router.delete('/templates/defaults/:stage', (req: Request, res: Response) => {
    const stage = req.params.stage as string;
    const s = getSettings();
    const saved: Record<string, string> = (() => {
      try { return JSON.parse(s.get('global_stage_prompts') || '{}'); } catch { return {}; }
    })();
    delete saved[stage];
    s.set('global_stage_prompts', JSON.stringify(saved));
    res.json({ ok: true });
  });

  // ── Multi-Template CRUD ──
  router.post('/templates', (req: Request, res: Response) => {
    const { name, niche, description, templateText, color, youtubeUrl, memo, nicheStatus, visualStyle } = req.body as {
      name?: string; niche?: string; description?: string; templateText?: string; color?: string; youtubeUrl?: string; memo?: string; nicheStatus?: string; visualStyle?: string;
    };
    if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    dbRun(
      `INSERT INTO storyboard_templates (id, name, niche, description, template_text, color, youtube_url, memo, niche_status, visual_style, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), niche?.trim() || '', description?.trim() || '', templateText?.trim() || '', color || '#7c6af5', youtubeUrl?.trim() || '', memo?.trim() || '', nicheStatus || 'active', visualStyle?.trim() || '', now, now],
    );
    // Pre-compute stage prompts from template text
    if (templateText?.trim()) recomputeTemplatePrompts(id);
    res.status(201).json({ id, name: name.trim(), niche: niche?.trim() || '', description: description?.trim() || '', templateText: templateText?.trim() || '', customPrompts: {}, color: color || '#7c6af5', youtubeUrl: youtubeUrl?.trim() || '', memo: memo?.trim() || '', nicheStatus: nicheStatus || 'active', visualStyle: visualStyle?.trim() || '', createdAt: now, updatedAt: now });
  });

  router.get('/templates', (_req: Request, res: Response) => {
    const rows = dbAll<Record<string, unknown>>(
      `SELECT id, name, niche, description, color, youtube_url, memo, niche_status, visual_style, created_at, updated_at FROM storyboard_templates ORDER BY updated_at DESC`,
    );
    res.json(rows.map(r => ({
      id: r.id, name: r.name, niche: r.niche, description: r.description, color: r.color,
      youtubeUrl: r.youtube_url || '', memo: r.memo || '', nicheStatus: r.niche_status || 'active',
      visualStyle: r.visual_style || '',
      createdAt: r.created_at, updatedAt: r.updated_at,
    })));
  });

  router.get('/templates/:id', (req: Request, res: Response) => {
    const row = dbGet<Record<string, unknown>>(
      'SELECT * FROM storyboard_templates WHERE id = ?', [req.params.id],
    );
    if (!row) { res.status(404).json({ error: 'Template not found' }); return; }
    const parsed = parseTemplate((row.template_text as string) || '');
    let customPrompts: Record<string, string> = {};
    try { customPrompts = JSON.parse((row.custom_prompts as string) || '{}'); } catch { /* ignore */ }

    // Apply custom prompt overrides
    if (customPrompts.topics) parsed.sections.topicsSystemPrompt = customPrompts.topics;
    if (customPrompts.script) parsed.sections.scriptSystemPrompt = customPrompts.script;
    if (customPrompts.prompts) parsed.sections.imagePromptSystemPrompt = customPrompts.prompts;
    if (customPrompts.metadata) parsed.sections.metadataSystemPrompt = customPrompts.metadata;

    // Pre-computed stage prompts (single source of truth for generation)
    let stagePrompts: Record<string, string> = {};
    try { stagePrompts = JSON.parse((row.stage_prompts as string) || '{}'); } catch { /* ignore */ }
    let storedStageParts: Record<string, unknown> = {};
    try { storedStageParts = JSON.parse((row.stage_parts as string) || '{}'); } catch { /* ignore */ }

    // Lazy backfill: if template has content but stagePrompts is empty, recompute now
    if (!Object.keys(stagePrompts).length && (row.template_text as string)?.trim()) {
      recomputeTemplatePrompts(req.params.id as string);
      // Re-read the freshly computed values
      const updated = dbGet<Record<string, unknown>>(
        'SELECT stage_prompts, stage_parts FROM storyboard_templates WHERE id = ?', [req.params.id],
      );
      if (updated) {
        try { stagePrompts = JSON.parse((updated.stage_prompts as string) || '{}'); } catch { /* ignore */ }
        try { storedStageParts = JSON.parse((updated.stage_parts as string) || '{}'); } catch { /* ignore */ }
      }
    }

    // Backfill: if template still has no stage_prompts AND no template_text,
    // try to recover prompts from a sibling project that has them stored
    if (!Object.keys(stagePrompts).length && !(row.template_text as string)?.trim()) {
      const sibling = dbGet<Record<string, unknown>>(
        `SELECT topics_prompt, script_prompt, image_prompt_prompt, metadata_prompt
         FROM storyboards WHERE template_id = ?
         AND (topics_prompt IS NOT NULL AND topics_prompt != '')
         ORDER BY updated_at DESC LIMIT 1`,
        [req.params.id],
      );
      if (sibling) {
        if (sibling.topics_prompt) stagePrompts.topics = sibling.topics_prompt as string;
        if (sibling.script_prompt) stagePrompts.script = sibling.script_prompt as string;
        if (sibling.image_prompt_prompt) stagePrompts.prompts = sibling.image_prompt_prompt as string;
        if (sibling.metadata_prompt) stagePrompts.metadata = sibling.metadata_prompt as string;
        // Persist the recovered prompts to the template
        if (Object.keys(stagePrompts).length) {
          dbRun('UPDATE storyboard_templates SET stage_prompts = ?, updated_at = ? WHERE id = ?',
            [JSON.stringify(stagePrompts), new Date().toISOString(), req.params.id]);
        }
      }
    }

    // Final fallback: if still no prompts, generate basic ones from niche/name
    if (!Object.keys(stagePrompts).length) {
      const niche = (row.niche as string) || (row.name as string) || '';
      const vs = (row.visual_style as string) || '';
      const simpleStyleList = ['stick figure', 'doodle', 'sketch', 'line art', 'minimalist', 'simple', 'cartoon', 'chibi'];
      const isSimple = vs && simpleStyleList.some(s => vs.toLowerCase().includes(s));

      if (niche) {
        stagePrompts.topics = `You are a world-class YouTube content strategist specializing in "${niche}" content. Generate viral, curiosity-driven video topic ideas for this niche. Each topic should be specific, attention-grabbing, and use power words, numbers, or curiosity gaps to maximize click-through rate.`;
        stagePrompts.script = `You are a world-class YouTube scriptwriter specializing in "${niche}" content. Write engaging, conversational narration scripts. Rules:\n- Pure narration only — no headers, no bullet points, no stage directions\n- Write in short, powerful sentences (10-20 words each)\n- Hook the viewer in the first 3 seconds\n- Use storytelling techniques: tension, reveals, cliffhangers\n- End with a strong call-to-action`;

        if (isSimple) {
          stagePrompts.prompts = `You are an image prompt generator for "${niche}" YouTube videos.\nVisual style: "${vs}"\n\nRules:\n- Describe the scene in detail: characters, actions, expressions, setting, objects\n- Every prompt MUST end with: "${vs} style, plain white background, minimal detail, no shading, black lines only."\n- The style suffix is mandatory — it tells the image generator HOW to render the scene\n- Translate abstract narration into concrete, visual descriptions`;
        } else if (vs) {
          stagePrompts.prompts = `You are an expert visual director for "${niche}" YouTube videos.\nVisual style: "${vs}"\n\nRules:\n- Each prompt should specify: subject, setting, lighting, camera angle, mood\n- Every prompt MUST use "${vs}" as the art style\n- The image should be a standalone scene — NOT a drawing on paper\n- Make prompts vivid and specific for AI image generation`;
        } else {
          stagePrompts.prompts = `You are an expert visual director for "${niche}" YouTube videos. For each script segment, generate a detailed, cinematic image prompt. Each prompt should specify: subject, setting, lighting, camera angle, mood, and art style. Make prompts vivid and specific for AI image generation.`;
        }

        stagePrompts.metadata = `You are a YouTube SEO expert for "${niche}" content. Generate optimized metadata (title, description, tags) that maximizes discoverability. Use relevant keywords, compelling hooks, and trending search terms for this niche.`;
        // Persist so they're available next time
        dbRun('UPDATE storyboard_templates SET stage_prompts = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(stagePrompts), new Date().toISOString(), req.params.id]);
      }
    }

    res.json({
      id: row.id, name: row.name, niche: row.niche, description: row.description,
      templateText: row.template_text, color: row.color,
      youtubeUrl: row.youtube_url || '', memo: row.memo || '', nicheStatus: row.niche_status || 'active',
      visualStyle: row.visual_style || '',
      sections: parsed.sections,
      stageParts: Object.keys(storedStageParts).length ? storedStageParts : parsed.stageParts,
      stagePrompts,
      customPrompts,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
  });

  router.put('/templates/:id', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const fields: Record<string, string> = {
      name: 'name', niche: 'niche', description: 'description',
      templateText: 'template_text', customPrompts: 'custom_prompts', color: 'color',
      youtubeUrl: 'youtube_url', memo: 'memo', nicheStatus: 'niche_status', visualStyle: 'visual_style',
    };
    for (const [k, col] of Object.entries(fields)) {
      if (body[k] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]);
      }
    }
    if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id);
    dbRun(`UPDATE storyboard_templates SET ${sets.join(', ')} WHERE id = ?`, params);
    // Recompute stage prompts if template text or custom prompts changed
    if (body.templateText !== undefined || body.customPrompts !== undefined) {
      recomputeTemplatePrompts(req.params.id as string);
    }
    res.json({ ok: true });
  });

  router.delete('/templates/:id', (req: Request, res: Response) => {
    dbRun('DELETE FROM storyboard_templates WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  // Save per-stage prompt for a specific template
  router.post('/templates/:id/save-prompt', (req: Request, res: Response) => {
    const { stage, prompt } = req.body as { stage: string; prompt: string };
    if (!stage || !prompt?.trim()) {
      res.status(400).json({ error: 'stage and prompt are required' });
      return;
    }
    const row = dbGet<Record<string, unknown>>(
      'SELECT custom_prompts FROM storyboard_templates WHERE id = ?', [req.params.id],
    );
    if (!row) { res.status(404).json({ error: 'Template not found' }); return; }
    let customPrompts: Record<string, string> = {};
    try { customPrompts = JSON.parse((row.custom_prompts as string) || '{}'); } catch { /* ignore */ }
    customPrompts[stage] = prompt.trim();
    dbRun('UPDATE storyboard_templates SET custom_prompts = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(customPrompts), new Date().toISOString(), req.params.id]);
    recomputeTemplatePrompts(req.params.id as string);
    res.json({ ok: true, stage });
  });

  // Sync template prompts to all projects using this template
  router.post('/templates/:id/sync-prompts', (req: Request, res: Response) => {
    const row = dbGet<Record<string, unknown>>(
      'SELECT * FROM storyboard_templates WHERE id = ?', [req.params.id],
    );
    if (!row) { res.status(404).json({ error: 'Template not found' }); return; }

    // Recompute the template's own stage_prompts from template_text
    recomputeTemplatePrompts(req.params.id as string);

    // Now read the fresh stage_prompts and sync down to projects
    const parsed = parseTemplate((row.template_text as string) || '');
    let customPrompts: Record<string, string> = {};
    try { customPrompts = JSON.parse((row.custom_prompts as string) || '{}'); } catch { /* ignore */ }

    // Apply custom prompt overrides
    if (customPrompts.topics) parsed.sections.topicsSystemPrompt = customPrompts.topics;
    if (customPrompts.script) parsed.sections.scriptSystemPrompt = customPrompts.script;
    if (customPrompts.prompts) parsed.sections.imagePromptSystemPrompt = customPrompts.prompts;
    if (customPrompts.metadata) parsed.sections.metadataSystemPrompt = customPrompts.metadata;

    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: unknown[] = [];

    if (parsed.sections.topicsSystemPrompt) {
      sets.push('topics_prompt = ?');
      params.push(parsed.sections.topicsSystemPrompt);
    }
    if (parsed.sections.scriptSystemPrompt) {
      sets.push('script_prompt = ?');
      params.push(parsed.sections.scriptSystemPrompt);
    }
    if (parsed.sections.imagePromptSystemPrompt) {
      sets.push('image_prompt_prompt = ?');
      params.push(parsed.sections.imagePromptSystemPrompt);
    }
    if (parsed.sections.metadataSystemPrompt) {
      sets.push('metadata_prompt = ?');
      params.push(parsed.sections.metadataSystemPrompt);
    }

    if (parsed.stageParts && Object.keys(parsed.stageParts).length) {
      sets.push('stage_parts = ?');
      params.push(JSON.stringify(parsed.stageParts));
    }

    if (!sets.length) { res.json({ ok: true, updated: 0 }); return; }

    sets.push('updated_at = ?');
    params.push(now);
    params.push(req.params.id);

    const result = dbRun(`UPDATE storyboards SET ${sets.join(', ')} WHERE template_id = ?`, params);
    res.json({ ok: true, updated: result.changes });
  });

  // ── Auto-generate template from niche name (optionally based on a reference template) ──
  router.post('/templates/generate', async (req: Request, res: Response) => {
    const { niche, referenceTemplateId } = req.body as { niche?: string; referenceTemplateId?: string };
    if (!niche?.trim()) { res.status(400).json({ error: 'niche is required' }); return; }

    // Load reference template if provided
    let referenceText = '';
    let referenceNiche = '';
    if (referenceTemplateId) {
      const ref = dbGet<Record<string, unknown>>(
        'SELECT template_text, niche FROM storyboard_templates WHERE id = ?', [referenceTemplateId],
      );
      if (ref?.template_text) {
        referenceText = ref.template_text as string;
        referenceNiche = (ref.niche as string) || '';
      }
    }

    let systemPrompt: string;
    let userMessage: string;

    if (referenceText) {
      // Adaptation mode: keep structure, replace niche
      systemPrompt = `You are an expert YouTube content strategist. You adapt existing video production templates to new niches.

You will receive a complete mega-prompt template originally written for the "${referenceNiche}" niche. Your job is to ADAPT it for the "${niche.trim()}" niche.

RULES:
- Keep the EXACT SAME structure, headers (## and ###), and formatting
- Keep the same number of rules, topic angles, and level of detail
- Replace ALL niche-specific content: topic angles, examples, terminology, visual style, tone, etc.
- Make every section genuinely specific to "${niche.trim()}" — not generic rewording
- Include real viral topic patterns and examples for the new niche
- Adapt visual style DNA to match what works for "${niche.trim()}" content
- Output ONLY the adapted template text, no explanations or markdown code blocks`;

      userMessage = `Here is the reference template for "${referenceNiche}":\n\n${referenceText}\n\nAdapt this template for the "${niche.trim()}" niche. Keep the exact same structure but make all content specific to "${niche.trim()}".`;
    } else {
      // From-scratch mode (original behavior)
      systemPrompt = `You are an expert YouTube content strategist. Given a niche/topic, you create a comprehensive mega-prompt template for an AI video production pipeline.

The template MUST follow this EXACT structure with these EXACT headers (## and ###). Do not change the headers:

---

You are a world-class YouTube scriptwriter and content strategist specializing in [NICHE]. Your channel creates cinematic, narration-style videos about [NICHE DESCRIPTION].

## CHANNEL KNOWLEDGE BASE

### PROVEN VIRAL TOPIC ANGLES
[List 10-15 specific viral topic patterns for this niche, using numbers, power words, curiosity gaps]

### CONTENT & SCRIPT DNA
[Define: hook style, tone, structure, language patterns, pacing, word count 250-400, ending style]

### VISUAL STYLE DNA
[Define: visual aesthetic, imagery types, color palette, cinematography style, quality tags]

## STAGE 1: TOPIC GENERATION RULES
[5-7 specific rules for generating viral topics in this niche]

## STAGE 2: SCRIPT GENERATION RULES
[7-10 specific rules for writing narration scripts in this niche]

## STAGE 3: IMAGE PROMPT GENERATION RULES
[7-10 specific rules for creating image generation prompts matching the visual style]

## STAGE 4: METADATA GENERATION RULES
[5-7 specific rules for YouTube title, description, and tags optimization]

## OPERATOR RULES
[3-5 ethical/quality guardrails specific to this niche]

---

IMPORTANT:
- Output ONLY the template text, no explanation or markdown code blocks
- Make it specific and actionable for the "${niche.trim()}" niche
- Include real examples of viral angles, not generic placeholders
- Visual style should be consistent and distinctive for this niche
- All rules should be concrete, not vague`;

      userMessage = `Create a complete YouTube video production mega-prompt template for the "${niche.trim()}" niche. Make it highly specific, viral-optimized, and production-ready.`;
    }

    try {
      const raw = await llmComplete({
        systemPrompt,
        userMessage,
        temperature: referenceText ? 0.5 : 0.8,
        maxTokens: 4000,
      });

      // Clean up: remove markdown code block wrappers if present
      let templateText = raw.trim();
      if (templateText.startsWith('```')) {
        templateText = templateText.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      }

      // Parse to verify structure
      const parsed = parseTemplate(templateText);
      const sectionCount = Object.keys(parsed.sections).length;

      // Auto-generate name and description
      const name = niche.trim();
      const description = referenceText
        ? `Adapted from ${referenceNiche} template for ${niche.trim()}`
        : `Auto-generated template for ${niche.trim()} YouTube content`;

      res.json({ templateText, name, niche: niche.trim(), description, sectionCount, sections: Object.keys(parsed.sections) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── AI-assisted stage prompt editing ──
  router.post('/templates/:id/ai-prompt', async (req: Request, res: Response) => {
    const { stage, instruction } = req.body as { stage?: string; instruction?: string };
    if (!instruction?.trim()) { res.status(400).json({ error: 'instruction is required' }); return; }

    const row = dbGet<Record<string, unknown>>(
      'SELECT * FROM storyboard_templates WHERE id = ?', [req.params.id],
    );
    if (!row) { res.status(404).json({ error: 'Template not found' }); return; }

    const niche = (row.niche as string) || 'General';
    const templateText = (row.template_text as string) || '';

    // Get current stage prompts for context
    let stagePrompts: Record<string, string> = {};
    try { stagePrompts = JSON.parse((row.stage_prompts as string) || '{}'); } catch { /* ignore */ }

    const stageLabel: Record<string, string> = {
      topics: 'Stage 1: Topic Generation',
      script: 'Stage 2: Script Generation',
      prompts: 'Stage 3: Image Prompt Generation',
      metadata: 'Stage 4: Metadata Generation',
    };

    // If targeting a specific stage, give the AI the current prompt for that stage
    const currentPrompt = stage && stagePrompts[stage] ? `\n\nCurrent ${stageLabel[stage] || stage} prompt:\n${stagePrompts[stage]}` : '';

    const allStages = stage
      ? `Focus ONLY on ${stageLabel[stage] || stage}.`
      : 'Generate/update ALL 4 stages: topics, script, prompts (image prompt), metadata.';

    const systemPrompt = `You are an expert YouTube content strategist specializing in the "${niche}" niche.

You help refine and create stage prompts for an AI video production pipeline. Each stage prompt is a system instruction that guides an LLM to generate content.

The 4 stages are:
- Stage 1 (topics): Rules for generating viral topic ideas
- Stage 2 (script): Rules for writing narration scripts (250-400 words, cinematic)
- Stage 3 (prompts): Rules for creating image generation prompts matching visual style
- Stage 4 (metadata): Rules for YouTube title, description, tags optimization

${allStages}
${currentPrompt}

IMPORTANT:
- Output the prompt text directly, no markdown code blocks, no explanations
- ${stage ? `Output ONLY the prompt for ${stageLabel[stage] || stage}` : 'Separate each stage with a line: === STAGE: topics ===, === STAGE: script ===, === STAGE: prompts ===, === STAGE: metadata ==='}
- Make prompts specific and actionable for the "${niche}" niche
- Include concrete examples, not generic placeholders
- Each prompt should define: role, rules, output format, quality standards`;

    try {
      const raw = await llmComplete({
        systemPrompt,
        userMessage: instruction.trim(),
        temperature: 0.7,
        maxTokens: stage ? 2000 : 6000,
      });

      let result = raw.trim();
      if (result.startsWith('```')) {
        result = result.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      }

      if (stage) {
        // Single stage — save directly
        let customPrompts: Record<string, string> = {};
        try { customPrompts = JSON.parse((row.custom_prompts as string) || '{}'); } catch { /* ignore */ }
        customPrompts[stage] = result;
        dbRun('UPDATE storyboard_templates SET custom_prompts = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(customPrompts), new Date().toISOString(), req.params.id]);
        recomputeTemplatePrompts(req.params.id as string);
        res.json({ ok: true, stage, prompt: result });
      } else {
        // Multi-stage — parse by separators
        const stageResults: Record<string, string> = {};
        const parts = result.split(/===\s*STAGE:\s*(topics|script|prompts|metadata)\s*===/i);
        // parts[0] = before first separator (ignore), then alternating key/value
        for (let i = 1; i < parts.length; i += 2) {
          const key = parts[i].toLowerCase().trim();
          const val = (parts[i + 1] || '').trim();
          if (val) stageResults[key] = val;
        }

        if (Object.keys(stageResults).length === 0) {
          // Fallback: AI didn't use separators, save as topics prompt
          stageResults.topics = result;
        }

        let customPrompts: Record<string, string> = {};
        try { customPrompts = JSON.parse((row.custom_prompts as string) || '{}'); } catch { /* ignore */ }
        for (const [k, v] of Object.entries(stageResults)) {
          customPrompts[k] = v;
        }
        dbRun('UPDATE storyboard_templates SET custom_prompts = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(customPrompts), new Date().toISOString(), req.params.id]);
        recomputeTemplatePrompts(req.params.id as string);
        res.json({ ok: true, stages: stageResults });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Generate topic ideas from template ──
  router.post('/generate-topics', async (req: Request, res: Response) => {
    const { count, systemPrompt: customPrompt, templateId, existingTopics } = req.body as {
      count?: number; systemPrompt?: string; templateId?: string; existingTopics?: string[];
    };
    const s = getSettings();

    // Collect previously used topics for this template to avoid duplicates
    const usedTopics: string[] = [...(existingTopics || [])];
    if (templateId) {
      const rows = dbAll<{ topic: string }>(
        `SELECT topic FROM storyboards WHERE template_id = ? AND topic IS NOT NULL AND topic != ''`,
        [templateId],
      );
      for (const r of rows) {
        if (!usedTopics.includes(r.topic)) usedTopics.push(r.topic);
      }
    }

    // Use custom prompt from frontend (user may have edited it), else fall back to template
    let systemPrompt = customPrompt;

    // If no custom prompt, try the linked template's stage_prompts
    if (!systemPrompt && templateId) {
      const tmpl = dbGet<Record<string, unknown>>(
        'SELECT stage_prompts, template_text, custom_prompts, niche, name FROM storyboard_templates WHERE id = ?', [templateId],
      );
      if (tmpl) {
        let sp: Record<string, string> = {};
        try { sp = JSON.parse((tmpl.stage_prompts as string) || '{}'); } catch { /* */ }
        if (sp.topics) {
          systemPrompt = sp.topics;
        } else if ((tmpl.template_text as string)?.trim()) {
          const { sections: parsed } = parseTemplate(tmpl.template_text as string);
          let cp: Record<string, string> = {};
          try { cp = JSON.parse((tmpl.custom_prompts as string) || '{}'); } catch { /* */ }
          if (cp.topics) parsed.topicsSystemPrompt = cp.topics;
          if (parsed.topicsSystemPrompt) systemPrompt = parsed.topicsSystemPrompt;
        }
        // Fallback: use niche/name to build a basic prompt
        if (!systemPrompt) {
          const niche = (tmpl.niche as string) || (tmpl.name as string) || '';
          if (niche) {
            systemPrompt = `You are a world-class YouTube content strategist specializing in "${niche}" content. Generate viral, curiosity-driven video topic ideas for this niche. Each topic should be specific, attention-grabbing, and use power words, numbers, or curiosity gaps to maximize click-through rate.`;
          }
        }
      }
    }

    // Fall back to global template
    if (!systemPrompt) {
      const templateRaw = s.get('storyboard_template') || '';
      const { sections: parsed } = parseTemplate(templateRaw);

      if (!parsed.topicsSystemPrompt && !parsed.knowledge) {
        res.status(400).json({ error: 'No template loaded. Save a prompt template first.' });
        return;
      }

      systemPrompt = parsed.topicsSystemPrompt || [
        parsed.knowledge || '',
        `\n\nGenerate ${count || 5} viral video topic ideas as a JSON array of title strings.`,
      ].join('\n');
    }

    // Build exclusion list to prevent duplicates
    const exclusion = usedTopics.length > 0
      ? `\n\nDo NOT generate any of these topics (already used or shown):\n${usedTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nGenerate completely NEW and DIFFERENT topics.`
      : '';

    // Always append JSON output instruction
    const finalPrompt = systemPrompt + exclusion + `\n\nIMPORTANT: Output ONLY a JSON array of ${count || 5} video title strings. Example: ["Title 1", "Title 2", "Title 3"]. No markdown, no table, no explanation.`;

    try {
      const raw = await llmComplete({
        systemPrompt: finalPrompt,
        userMessage: `Generate ${count || 5} viral video topic ideas based on the channel knowledge above.${usedTopics.length > 0 ? ' Make sure they are completely different from the excluded topics.' : ''}`,
        temperature: 0.9,
        maxTokens: 800,
      });

      // Parse JSON array from response
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Could not parse topics');
      const topics = JSON.parse(match[0]) as string[];
      res.json({ topics });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Generate narration script via LLM (chunked for long videos) ──
  router.post('/generate-script', async (req: Request, res: Response) => {
    const { topic, duration, systemPrompt } = req.body as {
      topic: string;
      duration?: number;
      systemPrompt?: string;
    };

    if (!topic?.trim()) {
      res.status(400).json({ error: 'topic is required' });
      return;
    }

    const totalDuration = duration || 60;
    const s = getSettings();

    // Use custom prompt from frontend (user may have edited it), else fall back to template
    let prompt = systemPrompt;
    if (!prompt) {
      const templateRaw = s.get('storyboard_template') || '';
      const { sections: parsed } = parseTemplate(templateRaw);
      prompt = parsed.scriptSystemPrompt || `You are a scriptwriter. Write a narration script for a video about: ${topic}\n\nRules:\n- Pure narration only — no headers, no bullet points, no stage directions\n- Write in short, powerful sentences\n- Each sentence should be 10-20 words\n- Output ONLY the script text`;
    }

    const FORMAT_RULE = `\n\nIMPORTANT: Output ONLY the narration script as plain text. No markdown, no headers (#), no bullet points, no stage directions, no file formatting instructions, no download instructions, no "next steps", no blockquotes. Do NOT include any instructions to the user about what to do with the script. Just output the pure narration text, nothing else.`;

    // For short videos (≤ 200s), single call is fine
    const CHUNK_THRESHOLD = 200;
    if (totalDuration <= CHUNK_THRESHOLD) {
      try {
        const script = await llmComplete({
          systemPrompt: prompt + FORMAT_RULE,
          userMessage: `The user selected this topic: "${topic}"\n\nGenerate the full narration script for a ${totalDuration}-second video about this topic. Follow the script rules in the system prompt exactly.`,
          temperature: 0.8,
          maxTokens: 4000,
        });
        res.json({ script });
      } catch (err) {
        console.error('[generate-script] error:', (err as Error).message);
        console.error('[generate-script] prompt length:', prompt.length, 'topic:', topic, 'duration:', totalDuration);
        res.status(500).json({ error: (err as Error).message });
      }
      return;
    }

    // For long videos, generate in chunks with continuity
    // Larger chunks = fewer LLM calls = less likely to hit rate limits
    const CHUNK_SECONDS = 150; // ~150s per chunk ≈ 375 words — fits comfortably in one LLM call
    const numChunks = Math.ceil(totalDuration / CHUNK_SECONDS);
    const wordsPerChunk = Math.round((totalDuration / numChunks) * 2.5); // ~2.5 words/sec narration pace
    const CHUNK_DELAY_MS = 2000; // delay between LLM calls to avoid rate limits

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      // Step 1: Generate an outline first
      const outline = await llmComplete({
        systemPrompt: prompt + `\n\nYou are planning a ${totalDuration}-second narration video (${numChunks} parts, ~${CHUNK_SECONDS}s each). Create a brief outline with ${numChunks} parts. For each part, write ONE line describing what that section covers. This outline guides the full script generation.`,
        userMessage: `Topic: "${topic}"\n\nCreate a ${numChunks}-part outline for a ${totalDuration}-second narration video. Output ONLY the outline as numbered lines (1. ... 2. ... etc). Be specific about what each part covers.`,
        temperature: 0.7,
        maxTokens: 1000,
      });

      console.log(`[generate-script] Chunked: ${numChunks} parts × ~${wordsPerChunk} words, ${CHUNK_DELAY_MS}ms delay between calls`);

      // Step 2: Generate each chunk with context
      const chunks: string[] = [];
      for (let i = 0; i < numChunks; i++) {
        // Rate-limit protection: wait between calls (skip before first)
        if (i > 0) await sleep(CHUNK_DELAY_MS);

        const isFirst = i === 0;
        const isLast = i === numChunks - 1;
        const prevContext = chunks.length > 0
          ? `\n\nPrevious section ended with:\n"${chunks[chunks.length - 1].split(/[.!?]\s/).slice(-3).join('. ')}"`
          : '';

        const chunkPrompt = `${prompt}${FORMAT_RULE}

VIDEO STRUCTURE: This is part ${i + 1} of ${numChunks} for a ${totalDuration}-second video (~${wordsPerChunk} words this section).

OUTLINE:\n${outline}

${isFirst ? 'This is the OPENING — start with a powerful hook that grabs attention immediately.' : ''}
${isLast ? 'This is the CLOSING — end with a strong conclusion and call to action.' : ''}
${!isFirst && !isLast ? 'This is a MIDDLE section — maintain momentum and build on previous content.' : ''}
${prevContext}

Write ONLY part ${i + 1} content. ~${wordsPerChunk} words. Continue naturally from previous content.`;

        // Retry once on failure (rate limit recovery)
        let chunk: string;
        try {
          chunk = await llmComplete({
            systemPrompt: chunkPrompt,
            userMessage: `Topic: "${topic}"\nGenerate part ${i + 1} of ${numChunks} (~${wordsPerChunk} words). Follow the outline for this section.`,
            temperature: 0.8,
            maxTokens: 3000,
          });
        } catch (retryErr) {
          console.warn(`[generate-script] Chunk ${i + 1} failed, retrying after 5s...`, (retryErr as Error).message);
          await sleep(5000);
          chunk = await llmComplete({
            systemPrompt: chunkPrompt,
            userMessage: `Topic: "${topic}"\nGenerate part ${i + 1} of ${numChunks} (~${wordsPerChunk} words). Follow the outline for this section.`,
            temperature: 0.8,
            maxTokens: 3000,
          });
        }
        chunks.push(chunk.trim());
        console.log(`[generate-script] Chunk ${i + 1}/${numChunks} done (${chunk.trim().split(/\s+/).length} words)`);
      }

      const script = chunks.join('\n\n');
      res.json({ script, chunks: chunks.length, outline });
    } catch (err) {
      console.error('[generate-script] chunked error:', (err as Error).message);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Generate TTS from script text ──
  router.post('/generate-tts', async (req: Request, res: Response) => {
    const { text, voice, rate, pitch, volume, style } = req.body as {
      text?: string; voice?: string; rate?: string; pitch?: string; volume?: string; style?: string;
    };
    if (!text?.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
      res.write(JSON.stringify({ progress: true, step: 'tts', detail: 'Generating speech...' }) + '\n');
      const result = await narrationService.generateNarration(text, {
        voice: voice || undefined,
        rate,
        pitch,
        volume,
        style: style || undefined,
        onProgress: (step, detail) => {
          res.write(JSON.stringify({ progress: true, step, detail }) + '\n');
        },
      });

      const filename = path.basename(result.totalPath);
      const duration = result.duration;
      const url = `/api/tts/audio/${filename}`;

      res.write(JSON.stringify({ progress: true, step: 'transcribe', detail: 'Transcribing audio for timestamps...' }) + '\n');

      // Auto-transcribe
      const transcribeDir = path.resolve(cacheDir, 'transcribe');
      fs.mkdirSync(transcribeDir, { recursive: true });
      const outBase = path.resolve(transcribeDir, `transcript_${Date.now()}`);
      await subtitleService.runWhisper(path.resolve(result.totalPath), outBase, {});

      const srtPath = `${outBase}.srt`;
      let entries: Array<{ index: number; startTime: string; endTime: string; text: string; startMs: number; endMs: number }> = [];
      if (fs.existsSync(srtPath)) {
        const parsed = subtitleService.parseSRTFile(srtPath);
        entries = parsed.entries;
      }

      res.write(JSON.stringify({
        done: true,
        audio: { filename, url, duration },
        entries,
      }) + '\n');
      res.end();
    } catch (err) {
      res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
      res.end();
    }
  });

  // ── Generate image prompts from timestamped segments via Groq ──
  router.post('/generate-prompts', async (req: Request, res: Response) => {
    const { segments, styleTemplate, visualStyle, aspectRatio } = req.body as {
      segments: Array<{ timestamp: string; text: string }>;
      styleTemplate?: string;
      visualStyle?: string;
      aspectRatio?: string;
    };

    if (!segments?.length) {
      res.status(400).json({ error: 'segments array is required' });
      return;
    }

    // If segments are too coarse (e.g. Whisper tiny produced few big blocks),
    // split multi-sentence segments into one-sentence-per-segment with interpolated timestamps
    const expandedSegments: Array<{ timestamp: string; text: string }> = [];
    for (const seg of segments) {
      const sentences = seg.text.split(/(?<=[.!?])\s+/).filter(x => x.trim());
      if (sentences.length <= 1) {
        expandedSegments.push(seg);
      } else {
        // Parse base timestamp to seconds
        const tsParts = seg.timestamp.split(':').map(Number);
        const baseSec = tsParts.length === 3
          ? tsParts[0] * 3600 + tsParts[1] * 60 + tsParts[2]
          : tsParts[0] * 60 + tsParts[1];
        // Find next segment's timestamp to calculate duration, default 5s per sentence
        const segIdx = segments.indexOf(seg);
        let nextSec = baseSec + sentences.length * 5;
        if (segIdx + 1 < segments.length) {
          const nParts = segments[segIdx + 1].timestamp.split(':').map(Number);
          nextSec = nParts.length === 3
            ? nParts[0] * 3600 + nParts[1] * 60 + nParts[2]
            : nParts[0] * 60 + nParts[1];
        }
        const stepDur = (nextSec - baseSec) / sentences.length;
        for (let j = 0; j < sentences.length; j++) {
          const sec = Math.round(baseSec + j * stepDur);
          const mm = Math.floor(sec / 60);
          const ss = sec % 60;
          expandedSegments.push({
            timestamp: `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`,
            text: sentences[j].trim(),
          });
        }
      }
    }
    console.log(`[storyboard] Segments: ${segments.length} input → ${expandedSegments.length} expanded`);

    const s = getSettings();

    // Stream progress for batches
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Use custom prompt from frontend (user edited it in the stage prompt editor), else fall back to template
    let systemPrompt = styleTemplate;
    console.log(`[generate-prompts] styleTemplate provided: ${!!styleTemplate}, length: ${styleTemplate?.length || 0}, visualStyle: ${visualStyle || 'none'}`);
    if (styleTemplate) console.log(`[generate-prompts] prompt starts with: ${styleTemplate.substring(0, 80)}`);
    if (!systemPrompt) {
      const templateRaw = s.get('storyboard_template') || '';
      const { sections: parsed } = parseTemplate(templateRaw);
      systemPrompt = parsed.imagePromptSystemPrompt || '';
    }
    if (!systemPrompt) {
      systemPrompt = `You are an image prompt generator. For each timestamped narration line, generate ONE detailed text-to-image prompt.

Rules:
- Every prompt must begin with its timestamp: [HH:MM:SS] or [MM:SS]
- Describe: which characters, expressions, objects, background color, on-screen text/labels
- Translate abstract narration into concrete visuals
- Hold scenes across consecutive timestamps when they describe the same moment
- Output ONLY the prompts, one per line, separated by a blank line. No commentary.`;
    }

    // Inject visual style directive if set on the template
    const simpleStyles = ['stick figure', 'doodle', 'sketch', 'line art', 'minimalist', 'simple', 'cartoon', 'chibi'];
    const isSimpleStyle = visualStyle && simpleStyles.some(s => visualStyle.toLowerCase().includes(s));

    if (visualStyle?.trim()) {
      if (isSimpleStyle) {
        systemPrompt = `VISUAL STYLE: "${visualStyle}". Every prompt MUST end with: "${visualStyle} style, plain white background, minimal detail, no shading, black lines only." You can describe the scene in detail, but the style suffix is mandatory.\n\n${systemPrompt}`;
      } else {
        systemPrompt = `MANDATORY VISUAL STYLE: "${visualStyle}". Every image prompt you generate MUST use "${visualStyle}" as the art style. The image should be a standalone scene — NOT a drawing on paper, NOT a sketch on a surface.\n\n${systemPrompt}`;
      }
    }

    // Inject aspect ratio guidance
    const ar = aspectRatio || '16:9';
    const arSuffix = ar === '9:16' ? 'vertical portrait layout, 9:16' : ar === '1:1' ? 'square layout, 1:1' : 'landscape layout, 16:9';

    // Append output format instruction
    systemPrompt += `\n\nIMPORTANT: Output ONLY the image prompts. Each prompt starts with its timestamp [MM:SS]. One prompt per timestamp. Separate prompts with a blank line. No commentary, no numbering, no markdown.${visualStyle ? ` Every prompt MUST include "${visualStyle}" as the art style.` : ''}${isSimpleStyle ? ' Every prompt MUST include "white background".' : ''} MANDATORY: Every prompt MUST end with ", ${arSuffix}". This suffix is required on every single prompt — do not omit it.`;

    // Extract format template from styleTemplate (e.g. "Simple stick figure doodle of [subject doing action] in ancient style, ...")
    // so we can build proper fallback prompts and remind the LLM of the format per batch
    let formatTemplate = '';
    if (styleTemplate?.trim()) {
      const fmtMatch = styleTemplate.match(/[Ff]ormat:\s*"([^"]+)"/);
      if (fmtMatch) {
        formatTemplate = fmtMatch[1];
        console.log(`[generate-prompts] extracted format template: "${formatTemplate.substring(0, 80)}..."`);
      }
    }

    res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `${expandedSegments.length} segments to process (expanded from ${segments.length} transcript blocks)` }) + '\n');

    // Process expanded segments in batches of 20
    const batchSize = 20;
    const allPrompts: Array<{ timestamp: string; prompt: string }> = [];

    for (let i = 0; i < expandedSegments.length; i += batchSize) {
      const batch = expandedSegments.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(expandedSegments.length / batchSize);

      res.write(JSON.stringify({ progress: true, step: 'generating', detail: `Generating prompts batch ${batchNum}/${totalBatches}...` }) + '\n');

      const segmentText = batch.map((s) => `[${s.timestamp}] ${s.text}`).join('\n');

      const parseBatch = (raw: string) => {
        const lines = raw.split('\n');
        let currentTs = '';
        let currentPrompt = '';
        for (const line of lines) {
          const cleaned = line.replace(/^[\s`*#\-]*\d*[.)]\s*/, '').replace(/^[\s`*#\-]+/, '').replace(/`/g, '');
          const match = cleaned.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/);
          if (match) {
            if (currentPrompt.trim()) allPrompts.push({ timestamp: currentTs, prompt: currentPrompt.trim() });
            currentTs = match[1];
            currentPrompt = match[2];
          } else if (line.trim() && !line.match(/^---+$/) && !line.match(/^#{1,3}\s/)) {
            currentPrompt += ' ' + line.trim();
          }
        }
        if (currentPrompt.trim()) allPrompts.push({ timestamp: currentTs, prompt: currentPrompt.trim() });
        return lines.length;
      };

      try {
        let raw: string;
        try {
          const fmtReminder = formatTemplate ? `\n\nREMINDER: Every prompt MUST follow the format: "${formatTemplate.substring(0, 120)}".` : '';
          raw = await llmComplete({
            systemPrompt,
            userMessage: `Generate one image prompt per timestamp line:\n\n${segmentText}${fmtReminder}`,
            temperature: 0.7,
            maxTokens: 8000,
          });
        } catch (retryErr) {
          // Retry once after longer delay (rate limit recovery)
          console.warn(`[storyboard] Batch ${batchNum} failed, retrying after 5s...`, (retryErr as Error).message);
          res.write(JSON.stringify({ progress: true, step: 'retrying', detail: `Batch ${batchNum} rate limited, retrying in 5s...` }) + '\n');
          await new Promise((r) => setTimeout(r, 5000));
          const fmtReminder = formatTemplate ? `\n\nREMINDER: Every prompt MUST follow the format: "${formatTemplate.substring(0, 120)}".` : '';
          raw = await llmComplete({
            systemPrompt,
            userMessage: `Generate one image prompt per timestamp line:\n\n${segmentText}${fmtReminder}`,
            temperature: 0.7,
            maxTokens: 8000,
          });
        }

        const lineCount = parseBatch(raw);
        console.log(`[storyboard] Batch ${batchNum}: parsed ${allPrompts.length} prompts from ${lineCount} lines`);
        res.write(JSON.stringify({ progress: true, step: 'batch-done', detail: `Batch ${batchNum} done (${allPrompts.length} prompts so far)` }) + '\n');

        // Delay between batches to avoid rate limiting
        if (i + batchSize < expandedSegments.length) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err) {
        res.write(JSON.stringify({ progress: true, step: 'error', detail: `Batch ${batchNum} error: ${(err as Error).message}` }) + '\n');
      }
    }

    // Programmatically append aspect ratio to every prompt (LLM often ignores instructions)
    const arTag = `, ${arSuffix}`;

    for (let j = 0; j < allPrompts.length; j++) {
      // Enforce aspect ratio
      if (!allPrompts[j].prompt.includes(arSuffix)) {
        allPrompts[j].prompt = allPrompts[j].prompt.replace(/\.?\s*$/, '') + arTag;
      }
    }

    // Build prompt map with fuzzy timestamp matching:
    // Convert timestamps to seconds so "01:05" matches "1:05" or "00:01:05"
    const tsToSec = (ts: string) => {
      const parts = ts.split(':').map(Number);
      return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    };
    const promptBySec = new Map<number, string>();
    for (const p of allPrompts) {
      promptBySec.set(tsToSec(p.timestamp), p.prompt);
    }

    // If any segments didn't get prompts, fill with defaults using format template
    const buildFallback = (text: string) => {
      // If user provided a format template like "Simple stick figure doodle of [subject] ...",
      // replace the placeholder with the segment text
      if (formatTemplate) {
        const filled = formatTemplate
          .replace(/\[.*?\]/g, text)  // replace [placeholder] with actual text
          .replace(/\.?\s*$/, '') + arTag;
        return filled;
      }
      if (isSimpleStyle) {
        return `${text}. ${visualStyle} style, plain white background, minimal detail, no shading, black lines only${arTag}`;
      }
      if (visualStyle?.trim()) return `${visualStyle} style scene of ${text}, high quality, detailed${arTag}`;
      return `Cinematic scene depicting: ${text}, high quality, detailed${arTag}`;
    };

    // Match segments to prompts: exact timestamp first, then fuzzy (±2 seconds)
    const usedSecs = new Set<number>();
    const finalPrompts = expandedSegments.map((seg) => {
      const segSec = tsToSec(seg.timestamp);
      // Exact match first
      let prompt = promptBySec.get(segSec);
      if (prompt && !usedSecs.has(segSec)) {
        usedSecs.add(segSec);
      } else if (!prompt) {
        // Fuzzy match: find closest prompt within ±2 seconds
        for (let delta = 1; delta <= 2; delta++) {
          for (const tryDelta of [delta, -delta]) {
            const trySec = segSec + tryDelta;
            if (promptBySec.has(trySec) && !usedSecs.has(trySec)) {
              prompt = promptBySec.get(trySec);
              usedSecs.add(trySec);
              break;
            }
          }
          if (prompt) break;
        }
      }
      return {
        timestamp: seg.timestamp,
        text: seg.text,
        prompt: prompt || buildFallback(seg.text),
      };
    });
    const fallbackCount = finalPrompts.filter(p => !promptBySec.has(tsToSec(p.timestamp))).length;
    if (fallbackCount > 0) {
      console.log(`[generate-prompts] ${fallbackCount}/${finalPrompts.length} segments used fallback prompts`);
    }

    res.write(JSON.stringify({ done: true, prompts: finalPrompts }) + '\n');
    res.end();
  });

  // Normalize metadata — tags may come as string or array
  function normalizeMetadata(raw: Record<string, unknown>): { title: string; description: string; tags: string[]; thumbnailPrompt: string } {
    let tags: string[] = [];
    if (Array.isArray(raw.tags)) {
      tags = raw.tags.map(String);
    } else if (typeof raw.tags === 'string') {
      tags = (raw.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean);
    }
    const thumbnailPrompt = String(
      raw.thumbnailPrompt ||
      raw.thumbnail_prompt ||
      raw.thumbnail ||
      raw.thumbnail_image_prompt ||
      raw.thumbnailprompt ||
      ''
    );
    return {
      title: String(raw.title || ''),
      description: String(raw.description || ''),
      tags,
      thumbnailPrompt,
    };
  }

  // ── Generate metadata (title, description, tags) via Groq ──
  router.post('/generate-metadata', async (req: Request, res: Response) => {
    const { projectId, script, topic, systemPrompt: customPrompt } = req.body as {
      projectId?: string;
      script: string;
      topic?: string;
      systemPrompt?: string;
    };

    if (!script?.trim()) {
      res.status(400).json({ error: 'script is required' });
      return;
    }

    // Build context info based on niche, project name, and visual style
    let contextInfo = '';
    let projectTemplateRaw = '';
    if (projectId) {
      const proj = dbGet<{ name: string; topic: string; template_id: string }>(
        'SELECT name, topic, template_id FROM storyboards WHERE id = ?', [projectId]
      );
      if (proj) {
        contextInfo += `Project Name: ${proj.name}\n`;
        if (proj.topic || topic) contextInfo += `Topic: ${proj.topic || topic}\n`;
        if (proj.template_id) {
          const tpl = dbGet<{ name: string; niche: string; visual_style: string; template_text: string }>(
            'SELECT name, niche, visual_style, template_text FROM storyboard_templates WHERE id = ?', [proj.template_id]
          );
          if (tpl) {
            if (tpl.niche) contextInfo += `Niche/Category: ${tpl.niche}\n`;
            if (tpl.name) contextInfo += `Style Template: ${tpl.name}\n`;
            if (tpl.visual_style) contextInfo += `Visual Style DNA: ${tpl.visual_style}\n`;
            if (tpl.template_text) projectTemplateRaw = tpl.template_text;
          }
        }
      }
    }

    const s = getSettings();

    let systemPrompt = customPrompt;
    if (!systemPrompt) {
      const templateRaw = projectTemplateRaw || s.get('storyboard_template') || '';
      const { sections: parsed } = parseTemplate(templateRaw);
      systemPrompt = parsed.metadataSystemPrompt || `You are a YouTube metadata optimizer. Generate a viral title, SEO-optimized description, relevant tags, and a highly engaging, high Click-Through Rate (CTR) YouTube thumbnail image prompt for a video.

Rules:
- Title: catchy, under 100 characters, includes power words
- Description: 2-3 paragraphs, SEO-friendly, includes relevant keywords
- Tags: 10-15 relevant tags as a JSON array
- Thumbnail Prompt: A highly descriptive, detailed prompt for generating a high-CTR, click-enticing YouTube thumbnail. The prompt should specify visual composition, dramatic lighting, and focal subject. It MUST NOT contain generic filler meta-words like "image of", "photo of", "picture of", "graphic of", "generate...", etc. Describe the visual elements directly (e.g. "A weathered archaeologist holding a glowing artifact" instead of "An image of a weathered archaeologist..."). It MUST match the video's Niche, Visual Style DNA, and Topic if provided.

Output ONLY valid JSON with keys: "title", "description", "tags" (array of strings), "thumbnailPrompt" (string). No markdown, no commentary.`;
    }

    // Force inclusion of the thumbnail prompt generation instruction
    if (!systemPrompt.includes('thumbnailPrompt') && !systemPrompt.includes('thumbnail_prompt')) {
      systemPrompt += `\n\nADDITIONAL RULE:
You MUST also generate a highly engaging, high Click-Through Rate (CTR) YouTube thumbnail image prompt.
- The prompt MUST be detailed and describe a visually dramatic scene related to the video topic, specifying visual composition, dramatic lighting, and focal subject.
- The prompt MUST NOT contain generic filler meta-words like "image of", "photo of", "picture of", "graphic of", etc. Describe the scene's visual content directly.
- Ensure the prompt matches the video's Niche and Visual Style DNA if provided.
- Return this in the "thumbnailPrompt" key of your JSON response.`;
    }

    try {
      const jsonInstruction = `

CRITICAL: You MUST respond with ONLY a single JSON object. No other text, no markdown, no explanation.
The JSON must have exactly these keys:
{"title": "...", "description": "...", "tags": ["...", "..."], "thumbnailPrompt": "..."}

In addition to title, description, and tags, you MUST generate a high-CTR, engaging YouTube thumbnail image prompt in the "thumbnailPrompt" key. Describe a visually dramatic scene related to the video topic.

Example response:
{"title": "Sunset Over Mountains", "description": "Watch a breathtaking sunset...", "tags": ["sunset", "nature", "mountains"], "thumbnailPrompt": "A dramatic wide-angle shot of a glowing orange sunset reflecting on jagged snow-capped mountain peaks, epic cinematic lighting, highly detailed, photorealistic 8k"}`;

      const raw = await llmComplete({
        systemPrompt: systemPrompt + jsonInstruction,
        userMessage: `Generate metadata and a high-CTR thumbnail prompt for this video. Respond with ONLY a JSON object.

${contextInfo}
Script:
${script}`,
        temperature: 0.5,
        maxTokens: 2000,
      });

      // Parse JSON from response — strip markdown fences if present
      console.log('[metadata] raw LLM response:', raw.slice(0, 500));
      const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // Retry once with a very strict prompt
        console.log('[metadata] JSON not found, retrying with strict prompt...');
        const retry = await llmComplete({
          systemPrompt: 'You are a JSON generator. Output ONLY valid JSON. No text before or after.',
          userMessage: `Convert this into a JSON object with keys "title" (string), "description" (string), "tags" (array of strings), "thumbnailPrompt" (string):\n\n${raw}`,
          temperature: 0.2,
          maxTokens: 2000,
        });
        const retryClean = retry.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
        const retryMatch = retryClean.match(/\{[\s\S]*\}/);
        if (!retryMatch) throw new Error('Could not parse metadata JSON after retry');
        const metadata = normalizeMetadata(JSON.parse(retryMatch[0]));
        res.json({ metadata });
        return;
      }
      const metadata = normalizeMetadata(JSON.parse(jsonMatch[0]));
      res.json({ metadata });
    } catch (err) {
      console.error('[metadata] error:', (err as Error).message, (err as Error).stack?.split('\n')[1]);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Dedicated route to generate a single high-CTR YouTube thumbnail prompt
  router.post('/generate-thumbnail-prompt', async (req: Request, res: Response) => {
    const { projectId, title, script, topic } = req.body as {
      projectId?: string;
      title?: string;
      script?: string;
      topic?: string;
    };

    let contextInfo = '';
    let visualStyle = '';
    let niche = '';
    if (projectId) {
      const proj = dbGet<{ name: string; topic: string; template_id: string }>(
        'SELECT name, topic, template_id FROM storyboards WHERE id = ?', [projectId]
      );
      if (proj) {
        contextInfo += `Project Name: ${proj.name}\n`;
        if (proj.topic || topic) contextInfo += `Topic: ${proj.topic || topic}\n`;
        if (proj.template_id) {
          const tpl = dbGet<{ name: string; niche: string; visual_style: string }>(
            'SELECT name, niche, visual_style FROM storyboard_templates WHERE id = ?', [proj.template_id]
          );
          if (tpl) {
            if (tpl.niche) { contextInfo += `Niche/Category: ${tpl.niche}\n`; niche = tpl.niche; }
            if (tpl.visual_style) { contextInfo += `Visual Style DNA: ${tpl.visual_style}\n`; visualStyle = tpl.visual_style; }
          }
        }
      }
    }

    try {
      const systemPrompt = `You are a professional YouTube thumbnail designer. Your job is to write a highly detailed, dramatic, and click-enticing image generation prompt for a YouTube thumbnail.
      
Rules:
- The output prompt must specify visual composition, dramatic lighting, epic background, and focal subjects.
- The prompt MUST NOT contain generic filler meta-words like "image of", "photo of", "picture of", "graphic of", "generate...", etc. Describe the visual elements directly.
- It MUST be optimized for high CTR (Click-Through Rate).
- It MUST match the video's Niche and Visual Style DNA if provided.
- Do NOT include any intro, commentary, or markdown fences. Output ONLY the raw image generation prompt string.`;

      const userMessage = `Generate a high-CTR thumbnail prompt for this video.
Topic: ${topic || 'N/A'}
Title: ${title || 'N/A'}
Niche: ${niche || 'N/A'}
Visual Style DNA: ${visualStyle || 'N/A'}
${script ? `Script snippet:\n${script.substring(0, 1000)}` : ''}`;

      const raw = await llmComplete({
        systemPrompt,
        userMessage,
        temperature: 0.7,
        maxTokens: 500,
      });

      res.json({ thumbnailPrompt: raw.trim() });
    } catch (err) {
      console.error('[thumbnail-prompt] error:', (err as Error).message);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Auto-match: given TTS transcription segments + image list, pair them by timestamp
  router.post('/match', async (req: Request, res: Response) => {
    const { segments, images } = req.body as {
      segments: Array<{ startMs: number; endMs: number; text: string }>;
      images: Array<{ filename: string; url: string; timestamp?: string; mediaType?: MediaType; videoFilename?: string; videoUrl?: string }>;
    };

    if (!segments?.length || !images?.length) {
      res.status(400).json({ error: 'segments and images are required' });
      return;
    }

    console.log(`[match] ${segments.length} segments, ${images.length} images`);
    console.log(`[match] images:`, images.map((img, i) => `${i}: ts=${img.timestamp} file=${img.filename?.slice(0, 30)} type=${img.mediaType || 'image'}`));

    // Detect video by mediaType or file extension
    const isVideoFile = (img: typeof images[0]) =>
      img.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(img.filename || '');

    const buildSegment = (seg: typeof segments[0], img: typeof images[0]): StoryboardSegment => {
      const isVid = isVideoFile(img);
      return {
        imageUrl: img.url, imageFilename: img.filename,
        videoUrl: isVid ? (img.videoUrl || img.url) : img.videoUrl,
        videoFilename: isVid ? (img.videoFilename || img.filename) : img.videoFilename,
        startTime: seg.startMs / 1000, endTime: seg.endMs / 1000, text: seg.text,
        mediaType: isVid ? 'video' : img.mediaType,
      };
    };

    // Match 1:1 in order — segment i gets image/video i.
    const matched: StoryboardSegment[] = [];

    if (images.length >= segments.length) {
      for (let s = 0; s < segments.length; s++) {
        matched.push(buildSegment(segments[s], images[s]));
      }
    } else {
      const segsPerImage = segments.length / images.length;
      for (let s = 0; s < segments.length; s++) {
        const imgIdx = Math.min(Math.floor(s / segsPerImage), images.length - 1);
        matched.push(buildSegment(segments[s], images[imgIdx]));
      }
    }

    console.log(`[match] assigned ${matched.length} segments to ${new Set(matched.map(m => m.imageFilename || m.videoFilename)).size} unique media`);

    res.json({ segments: matched });
  });

  // Assemble: combine images + audio into a video
  router.post('/assemble', async (req: Request, res: Response) => {
    const { segments, audioFilename, aspectRatio, bgMusicFilename, voiceVolume, musicVolume, outputName, speed } = req.body as {
      segments: StoryboardSegment[];
      audioFilename: string;
      aspectRatio?: string;
      bgMusicFilename?: string;
      voiceVolume?: number;
      musicVolume?: number;
      outputName?: string;
      speed?: number;
    };

    if (!segments?.length || !audioFilename) {
      res.status(400).json({ error: 'segments and audioFilename are required' });
      return;
    }

    // Stream progress
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
      const ffmpeg = await resolveFullFfmpeg();

      // Resolve audio path
      const narrationDir = path.resolve(cacheDir, 'narration');
      let audioPath = path.join(narrationDir, path.basename(audioFilename));
      if (!fs.existsSync(audioPath)) {
        audioPath = path.join(path.resolve(process.env.ASSETS_DIR ?? './assets', 'audio'), path.basename(audioFilename));
      }
      if (!fs.existsSync(audioPath)) {
        res.write(JSON.stringify({ error: 'Audio file not found' }) + '\n');
        res.end();
        return;
      }

      // Build FFmpeg concat demuxer input
      const concatId = crypto.randomUUID().slice(0, 8);
      const concatDir = path.join(outputDir, `tmp_${concatId}`);
      fs.mkdirSync(concatDir, { recursive: true });

      const speedFactor = typeof speed === 'number' && speed > 0 ? speed : 1.0;
      if (speedFactor !== 1.0) {
        res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `Adjusting narration speed to ${speedFactor}x...` }) + '\n');
        const speededAudioPath = path.join(concatDir, 'speeded_audio.wav');
        await execFileAsync(ffmpeg, [
          '-i', audioPath,
          '-filter:a', `atempo=${speedFactor}`,
          '-y',
          speededAudioPath,
        ]);
        audioPath = speededAudioPath;
      }

      // Get audio duration
      const audioDuration = await narrationService.getAudioDuration(audioPath);

      // Determine output resolution from aspect ratio
      const resolutions: Record<string, { w: number; h: number }> = {
        '16:9': { w: 1920, h: 1080 },
        '9:16': { w: 1080, h: 1920 },
        '1:1': { w: 1080, h: 1080 },
        '4:3': { w: 1440, h: 1080 },
        '3:4': { w: 1080, h: 1440 },
      };
      const { w, h } = resolutions[aspectRatio || '16:9'] || resolutions['16:9'];

      // Merge consecutive segments that use the same image + same motion to avoid zoom resets
      // Video clips are never merged (each is a unique clip)
      interface MergedSegment { imageFilename: string; videoFilename?: string; mediaType?: MediaType; startTime: number; endTime: number; texts: string[]; motion: MotionEffect }
      const merged: MergedSegment[] = [];
      for (const seg of segments) {
        const motion = seg.motion || 'static';
        const isVideo = (seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '')) && (seg.videoFilename || seg.imageFilename);
        const last = merged[merged.length - 1];
        if (!isVideo && last && !last.videoFilename && last.imageFilename === seg.imageFilename && last.motion === motion) {
          last.endTime = seg.endTime;
          last.texts.push(seg.text || '');
        } else {
          merged.push({
            imageFilename: seg.imageFilename,
            videoFilename: isVideo ? (seg.videoFilename || seg.imageFilename) : undefined,
            mediaType: isVideo ? 'video' : seg.mediaType,
            startTime: seg.startTime, endTime: seg.endTime, texts: [seg.text || ''], motion,
          });
        }
      }

      res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `${segments.length} segments → ${merged.length} clips` }) + '\n');

      const videoDir = path.resolve(cacheDir, 'videos');

      // Helper: build static filter for FFmpeg (no motion)
      function buildStaticFilter(outW: number, outH: number, fps: number): string {
        return [
          `[0:v]scale=w=${outW}:h=${outH}:force_original_aspect_ratio=decrease[scaled]`,
          `[scaled]pad=w=${outW}:h=${outH}:x=(ow-iw)/2:y=(oh-ih)/2:color=black[padded]`,
          `[padded]fps=${fps},setsar=1/1,format=yuv420p[out]`,
        ].join(';');
      }

      // Step 1: Create individual clip videos from images or use video clips directly
      const fps = 24;
      for (let i = 0; i < merged.length; i++) {
        const seg = merged[i];
        const duration = Math.max((seg.endTime - seg.startTime) / speedFactor, 0.5);
        const segOut = path.join(concatDir, `seg_${String(i).padStart(3, '0')}.mp4`);

        // ── Video clip: scale/trim to target duration and resolution ──
        if (seg.videoFilename) {
          // Check both cache/videos and cache/images (Flow-generated videos land in images dir)
          const baseName = path.basename(seg.videoFilename);
          let vidPath = path.join(videoDir, baseName);
          if (!fs.existsSync(vidPath)) vidPath = path.join(imageDir, baseName);
          if (!fs.existsSync(vidPath)) {
            res.write(JSON.stringify({ progress: true, step: 'error', detail: `Video not found: ${seg.videoFilename}` }) + '\n');
            continue;
          }

          res.write(JSON.stringify({ progress: true, step: 'encoding', detail: `Encoding video clip ${i + 1}/${merged.length} (${duration.toFixed(1)}s)...` }) + '\n');

          // Scale, pad, trim to target duration, strip audio
          const filterComplex = [
            `[0:v]scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease[scaled]`,
            `[scaled]pad=w=${w}:h=${h}:x=(ow-iw)/2:y=(oh-ih)/2:color=black[padded]`,
            speedFactor !== 1.0 ? `[padded]setpts=PTS/${speedFactor}[sped]` : `[padded]null[sped]`,
            `[sped]fps=${fps},setsar=1/1,format=yuv420p[out]`,
          ].join(';');

          await execFileAsync(ffmpeg, [
            '-i', vidPath,
            '-filter_complex', filterComplex,
            '-map', '[out]',
            '-t', duration.toFixed(3),
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-video_track_timescale', '90000',
            '-an',
            '-y',
            segOut,
          ], { timeout: 120_000 });
          continue;
        }

        // ── Image clip: create video from still image ──
        const imgPath = path.join(imageDir, path.basename(seg.imageFilename));
        if (!fs.existsSync(imgPath)) {
          res.write(JSON.stringify({ progress: true, step: 'error', detail: `Image not found: ${seg.imageFilename}` }) + '\n');
          continue;
        }

        const motionLabel = seg.motion === 'static' ? '' : ` [${seg.motion}]`;
        const renderer = seg.motion !== 'static' ? 'Remotion' : 'FFmpeg';
        res.write(JSON.stringify({ progress: true, step: 'encoding', detail: `Encoding clip ${i + 1}/${merged.length} (${duration.toFixed(1)}s)${motionLabel} via ${renderer}...` }) + '\n');

        if (seg.motion !== 'static') {
          // Use Remotion for animated clips — smooth CSS-based transforms
          const totalFrames = Math.ceil(duration * fps);
          // Chrome blocks file:// URLs — encode image as data URI
          const imgBuf = fs.readFileSync(imgPath);
          const ext = path.extname(imgPath).slice(1) || 'jpg';
          const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
          const dataUri = `data:${mime};base64,${imgBuf.toString('base64')}`;
          const sceneConfig: SceneClipConfig = {
            imageSrc: dataUri,
            motion: seg.motion,
            durationInFrames: totalFrames,
          };
          await renderSceneClip(segOut, sceneConfig, w, h);

          // Conform Remotion output to ensure identical properties (pixel format, timescale, SAR)
          const tmpOut = segOut + '.conform.mp4';
          await execFileAsync(ffmpeg, [
            '-i', segOut,
            '-c:v', 'libx264',
            '-preset', 'superfast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-video_track_timescale', '90000',
            '-vf', 'setsar=1/1',
            '-an',
            '-y',
            tmpOut,
          ], { timeout: 30_000 });
          fs.renameSync(tmpOut, segOut);
        } else {
          // Use FFmpeg for static clips — simple scale+pad, much faster
          const filterComplex = buildStaticFilter(w, h, fps);
          await execFileAsync(ffmpeg, [
            '-loop', '1',
            '-i', imgPath,
            '-filter_complex', filterComplex,
            '-map', '[out]',
            '-t', duration.toFixed(3),
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-video_track_timescale', '90000',
            '-an',
            '-y',
            segOut,
          ], { timeout: 120_000 });
        }
      }

      // Step 2: Create concat list
      const segFiles = fs.readdirSync(concatDir).filter((f) => f.startsWith('seg_') && f.endsWith('.mp4')).sort();
      if (!segFiles.length) {
        res.write(JSON.stringify({ error: 'No segments were encoded' }) + '\n');
        res.end();
        return;
      }

      const concatList = path.join(concatDir, 'list.txt');
      fs.writeFileSync(concatList, segFiles.map((f) => `file '${f}'`).join('\n'));

      res.write(JSON.stringify({ progress: true, step: 'concat', detail: 'Concatenating segments...' }) + '\n');

      // Step 3: Concat video segments
      const videoOnly = path.join(concatDir, 'video_only.mp4');
      await execFileAsync(ffmpeg, [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatList,
        '-c', 'copy',
        '-y',
        videoOnly,
      ], { timeout: 120_000 });

      // Step 4: Mux audio (with optional background music mixing)
      const vVol = typeof voiceVolume === 'number' ? Math.max(0, Math.min(2, voiceVolume)) : 1.0;
      const mVol = typeof musicVolume === 'number' ? Math.max(0, Math.min(2, musicVolume)) : 0.3;

      // Resolve background music path
      let musicPath: string | null = null;
      if (bgMusicFilename) {
        const musicCacheDir = path.resolve(cacheDir, 'music');
        musicPath = path.join(musicCacheDir, path.basename(bgMusicFilename));
        if (!fs.existsSync(musicPath)) musicPath = null;
      }

      // Build output filename from topic/project name or fallback to ID
      const safeName = outputName
        ? outputName.replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_').substring(0, 100)
        : '';
      const outputFile = path.join(outputDir, safeName ? `${safeName}_${concatId}.mp4` : `storyboard_${concatId}.mp4`);

      if (musicPath) {
        res.write(JSON.stringify({ progress: true, step: 'muxing', detail: `Mixing voice (${Math.round(vVol * 100)}%) + music (${Math.round(mVol * 100)}%)...` }) + '\n');

        // Mix voice narration + background music with volume control
        // Music loops to fill the video duration and fades out at the end
        const filterComplex = [
          `[1:a]volume=${vVol}[voice]`,
          `[2:a]aloop=loop=-1:size=2e+09,atrim=0:${audioDuration},afade=t=out:st=${Math.max(0, audioDuration - 3)}:d=3,volume=${mVol}[music]`,
          `[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
        ].join(';');

        await execFileAsync(ffmpeg, [
          '-i', videoOnly,
          '-i', audioPath,
          '-i', musicPath,
          '-filter_complex', filterComplex,
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
          '-movflags', '+faststart',
          '-y',
          outputFile,
        ], { timeout: 300_000 });
      } else {
        res.write(JSON.stringify({ progress: true, step: 'muxing', detail: 'Adding audio track...' }) + '\n');

        // Voice only (with optional volume adjustment)
        const ffArgs = ['-i', videoOnly, '-i', audioPath];
        if (vVol !== 1.0) {
          ffArgs.push('-filter:a', `volume=${vVol}`);
        }
        ffArgs.push(
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
          '-movflags', '+faststart',
          '-y',
          outputFile,
        );
        await execFileAsync(ffmpeg, ffArgs, { timeout: 120_000 });
      }

      // Clean up temp
      try {
        fs.rmSync(concatDir, { recursive: true, force: true });
      } catch { /* ignore */ }

      const stat = fs.statSync(outputFile);
      const filename = path.basename(outputFile);

      res.write(JSON.stringify({
        done: true,
        filename,
        url: `/api/storyboard/video/${filename}`,
        sizeKB: Math.round(stat.size / 1024),
        duration: audioDuration,
      }) + '\n');
      res.end();
    } catch (err) {
      res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
      res.end();
    }
  });

  // Serve assembled videos
  router.get('/video/:filename', (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename as string);
    const filePath = path.join(outputDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // List assembled storyboard videos
  router.get('/history', (_req: Request, res: Response) => {
    if (!fs.existsSync(outputDir)) { res.json({ videos: [] }); return; }
    const files = fs.readdirSync(outputDir)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => {
        const stat = fs.statSync(path.join(outputDir, f));
        return {
          filename: f,
          url: `/api/storyboard/video/${f}`,
          sizeKB: Math.round(stat.size / 1024),
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ videos: files });
  });

  // Delete a storyboard video
  router.delete('/video/:filename', (req: Request, res: Response) => {
    const filename = path.basename(req.params.filename as string);
    const filePath = path.join(outputDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  });

  // ══════════════════════════════════════════
  // STORYBOARD SAVE / LOAD / LIST / DELETE
  // ══════════════════════════════════════════

  router.post('/projects', (req: Request, res: Response) => {
    const { name, templateId } = req.body as { name?: string; templateId?: string };
    if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let finalTemplateId = templateId || null;
    if (!finalTemplateId) {
      const defaultTpl = dbGet<{ id: string }>(
        "SELECT id FROM storyboard_templates WHERE name = 'Ancient History' OR niche = 'History' LIMIT 1"
      );
      if (defaultTpl) {
        finalTemplateId = defaultTpl.id;
      }
    }

    dbRun(
      `INSERT INTO storyboards (id, name, template_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, name.trim(), finalTemplateId, now, now],
    );
    res.status(201).json({ id, name: name.trim(), templateId: finalTemplateId, currentStep: 'topics', status: 'draft', speed: 1.0, createdAt: now, updatedAt: now });
  });

  router.get('/projects', (_req: Request, res: Response) => {
    const rows = dbAll<Record<string, unknown>>(
      `SELECT s.id, s.name, s.template_id, s.current_step, s.topic, s.status, s.audio_duration, s.result_filename, s.segments, s.metadata_desc, s.metadata_tags, s.created_at, s.updated_at, s.thumbnail_url, s.thumbnail_prompt, s.speed,
              t.name as template_name, t.niche as template_niche, t.color as template_color,
              t.youtube_url as template_youtube_url, t.memo as template_memo
       FROM storyboards s LEFT JOIN storyboard_templates t ON s.template_id = t.id
       ORDER BY s.updated_at DESC`,
    );
    res.json(rows.map(r => {
      // Extract first segment's imageUrl as thumbnail
      let thumbnailUrl = '';
      try {
        const segs = JSON.parse((r.segments as string) || '[]');
        if (segs.length > 0 && segs[0].imageUrl) thumbnailUrl = segs[0].imageUrl;
      } catch { /* ignore */ }
      return {
        id: r.id, name: r.name, templateId: r.template_id, currentStep: r.current_step, topic: r.topic,
        status: r.status, audioDuration: r.audio_duration, resultFilename: r.result_filename,
        thumbnailUrl: (r.thumbnail_url as string) || thumbnailUrl,
        thumbnailPrompt: (r.thumbnail_prompt as string) || '',
        speed: typeof r.speed === 'number' ? r.speed : 1.0,
        templateName: r.template_name, templateNiche: r.template_niche, templateColor: r.template_color,
        templateYoutubeUrl: r.template_youtube_url || '', templateMemo: r.template_memo || '',
        metadataDesc: r.metadata_desc || '', metadataTags: (() => { try { return JSON.parse((r.metadata_tags as string) || '[]'); } catch { return []; } })(),
        createdAt: r.created_at, updatedAt: r.updated_at,
      };
    }));
  });

  router.get('/projects/:id', (req: Request, res: Response) => {
    const row = dbGet<Record<string, unknown>>(
      'SELECT * FROM storyboards WHERE id = ?', [req.params.id],
    );
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({
      id: row.id, name: row.name, templateId: row.template_id, currentStep: row.current_step,
      topic: row.topic, script: row.script, scriptDuration: row.script_duration,
      voice: row.voice, audioFilename: row.audio_filename, audioDuration: row.audio_duration,
      transcriptEntries: JSON.parse((row.transcript_entries as string) || '[]'),
      prompts: JSON.parse((row.prompts as string) || '[]'),
      generatedImages: JSON.parse((row.generated_images as string) || '[]'),
      segments: JSON.parse((row.segments as string) || '[]'),
      metadataTitle: row.metadata_title, metadataDesc: row.metadata_desc,
      metadataTags: JSON.parse((row.metadata_tags as string) || '[]'),
      resultFilename: row.result_filename, resultUrl: row.result_url, resultSizeKB: row.result_size_kb || 0,
      bgMusicFilename: row.bg_music_filename || '', voiceVolume: row.voice_volume ?? 1.0, musicVolume: row.music_volume ?? 0.3,
      topicsPrompt: row.topics_prompt, scriptPrompt: row.script_prompt,
      imagePromptPrompt: row.image_prompt_prompt, metadataPrompt: row.metadata_prompt,
      stageParts: JSON.parse((row.stage_parts as string) || '{}'),
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
      thumbnailUrl: row.thumbnail_url || '',
      thumbnailPrompt: row.thumbnail_prompt || '',
      speed: typeof row.speed === 'number' ? row.speed : 1.0,
    });
  });

  router.put('/projects/:id', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const colMap: Record<string, string> = {
      name: 'name', templateId: 'template_id', currentStep: 'current_step', topic: 'topic', script: 'script',
      scriptDuration: 'script_duration', voice: 'voice', audioFilename: 'audio_filename',
      audioDuration: 'audio_duration', metadataTitle: 'metadata_title',
      metadataDesc: 'metadata_desc', resultFilename: 'result_filename',
      resultUrl: 'result_url', resultSizeKB: 'result_size_kb', topicsPrompt: 'topics_prompt', scriptPrompt: 'script_prompt',
      imagePromptPrompt: 'image_prompt_prompt', metadataPrompt: 'metadata_prompt', status: 'status',
      bgMusicFilename: 'bg_music_filename', voiceVolume: 'voice_volume', musicVolume: 'music_volume',
      thumbnailUrl: 'thumbnail_url', thumbnailPrompt: 'thumbnail_prompt',
      speed: 'speed',
    };
    const jsonCols: Record<string, string> = {
      transcriptEntries: 'transcript_entries', prompts: 'prompts',
      generatedImages: 'generated_images', segments: 'segments',
      metadataTags: 'metadata_tags', stageParts: 'stage_parts',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(colMap)) {
      if (body[k] !== undefined) { sets.push(`${col} = ?`); params.push(body[k]); }
    }
    for (const [k, col] of Object.entries(jsonCols)) {
      if (body[k] !== undefined) { sets.push(`${col} = ?`); params.push(JSON.stringify(body[k])); }
    }
    if (!sets.length) { res.status(400).json({ error: 'Nothing to update' }); return; }
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(req.params.id);
    dbRun(`UPDATE storyboards SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  });

  router.delete('/projects/:id', (req: Request, res: Response) => {
    dbRun('DELETE FROM storyboards WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  });

  return router;
}
