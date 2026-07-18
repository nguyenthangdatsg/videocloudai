import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NarrationService } from '../services/narration.service';
import { SubtitleService } from '../services/subtitle.service';
import { getSettings } from '../services/settings.service';
import { llmComplete, getLastUsedModel } from '../services/llm.service';
import { dbGet, dbAll, dbRun } from '../db';
import { renderSceneClip, renderComparisonScene } from '../services/remotion-renderer.service';
import type { SceneClipConfig, ComparisonSceneConfig } from '../remotion/types';
import { searchAndDownloadBatch as pexelsBatch } from '../services/pexels.service';

const execFileAsync = promisify(execFile);

/** Safely parse JSON from LLM output, handling control characters that break JSON.parse. */
function safeJsonParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* fallback below */ }
  // Replace control chars inside string values: newlines→\n, tabs→\t, others→removed
  const fixed = raw.replace(/"(?:[^"\\]|\\.)*"/gs, (m) =>
    m.replace(/[\x00-\x1F]/g, (c) =>
      c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : ''
    )
  );
  try { return JSON.parse(fixed); } catch { /* fallback below */ }
  // Last resort: strip ALL control chars (loses newlines in values but parses)
  try {
    return JSON.parse(raw.replace(/[\x00-\x1F]/g, ' '));
  } catch {
    /* ignore and fallback to empty object */
  }
  return {};
}

/** Strip visual direction cues from narration script (comparison mode).
 *  These cues ("point left", "head right", etc.) belong in image prompts, not TTS audio. */
function stripVisualDirections(script: string): string {
  // Remove bracket stage directions: [points left], [head right], [gesture toward X]
  let cleaned = script.replace(/\s*\[[^\]]*(?:points?|head|look|gesture|turn|facing)[^\]]*(?:left|right|toward)[^\]]*\]\s*/gi, ' ');
  // Remove [Winner left/right], [Win left/right]
  cleaned = cleaned.replace(/\s*\[win(?:ner)?\s+(?:left|right)\]\s*/gi, ' ');
  // Remove [Round N: Topic]
  cleaned = cleaned.replace(/\s*\[round\s+\d+[:\s][^\]]*\]\s*/gi, ' ');
  // Remove parenthetical stage directions: (point left), (gesture right), (look toward X)
  cleaned = cleaned.replace(/\s*\([^)]*(?:points?|head|look|gesture|turn|facing)\s+(?:left|right|toward)[^)]*\)\s*/gi, ' ');
  // Remove standalone/inline directions: "Points left," or "point right" (with optional surrounding commas/periods)
  cleaned = cleaned.replace(/[,.]?\s*(?:points?|head|look|gesture|turn|facing)\s+(?:to\s+the\s+)?(?:left|right|toward(?:\s+\w+)?)\s*[,.]?\s*/gi, ' ');
  // Clean up double spaces / leading commas / orphaned punctuation
  cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/^\s*,\s*/gm, '').trim();
  return cleaned;
}

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
  side?: 'left' | 'right' | 'both'; // comparison mode: which side this segment belongs to
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
    const { name, niche, description, templateText, color, youtubeUrl, memo, nicheStatus, visualStyle, customPrompts } = req.body as {
      name?: string; niche?: string; description?: string; templateText?: string; color?: string; youtubeUrl?: string; memo?: string; nicheStatus?: string; visualStyle?: string; customPrompts?: Record<string, string>;
    };
    if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const customPromptsJson = customPrompts && Object.keys(customPrompts).length ? JSON.stringify(customPrompts) : null;
    dbRun(
      `INSERT INTO storyboard_templates (id, name, niche, description, template_text, color, youtube_url, memo, niche_status, visual_style, custom_prompts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), niche?.trim() || '', description?.trim() || '', templateText?.trim() || '', color || '#7c6af5', youtubeUrl?.trim() || '', memo?.trim() || '', nicheStatus || 'active', visualStyle?.trim() || '', customPromptsJson, now, now],
    );
    // Pre-compute stage prompts from template text (includes custom_prompts overrides)
    if (templateText?.trim() || customPromptsJson) recomputeTemplatePrompts(id);
    res.status(201).json({ id, name: name.trim(), niche: niche?.trim() || '', description: description?.trim() || '', templateText: templateText?.trim() || '', customPrompts: customPrompts || {}, color: color || '#7c6af5', youtubeUrl: youtubeUrl?.trim() || '', memo: memo?.trim() || '', nicheStatus: nicheStatus || 'active', visualStyle: visualStyle?.trim() || '', createdAt: now, updatedAt: now });
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
      mascotPrompt: (row as any).mascot_prompt || '',
      mascotImage: (row as any).mascot_image || '',
      mascotImageLeft: (row as any).mascot_image_left || '',
      mascotImageRight: (row as any).mascot_image_right || '',
      mascotImageBoth: (row as any).mascot_image_both || '',
      mascotImageWin: (row as any).mascot_image_win || '',
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
      mascotPrompt: 'mascot_prompt', mascotImage: 'mascot_image',
      mascotImageLeft: 'mascot_image_left', mascotImageRight: 'mascot_image_right',
      mascotImageBoth: 'mascot_image_both', mascotImageWin: 'mascot_image_win',
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

    // Resolve template niche for placeholder substitution
    let templateNiche = '';
    if (templateId) {
      const tmplRow = dbGet<Record<string, unknown>>(
        'SELECT niche, name FROM storyboard_templates WHERE id = ?', [templateId],
      );
      if (tmplRow) templateNiche = (tmplRow.niche as string) || (tmplRow.name as string) || '';
    }

    // Substitute [NICHE] and similar placeholders in custom prompt
    if (systemPrompt && templateNiche) {
      systemPrompt = systemPrompt
        .replace(/\[NICHE\]/gi, templateNiche)
        .replace(/\[TEMPLATE\]/gi, templateNiche)
        .replace(/\[CHANNEL\]/gi, templateNiche);
    }

    // If no custom prompt, try the linked template's stage_prompts
    if (!systemPrompt && templateId) {
      const tmpl = dbGet<Record<string, unknown>>(
        'SELECT stage_prompts, template_text, custom_prompts, niche, name FROM storyboard_templates WHERE id = ?', [templateId],
      );
      if (tmpl) {
        const resolveNiche = (s: string) => templateNiche
          ? s.replace(/\[NICHE\]/gi, templateNiche).replace(/\[TEMPLATE\]/gi, templateNiche).replace(/\[CHANNEL\]/gi, templateNiche)
          : s;
        let sp: Record<string, string> = {};
        try { sp = JSON.parse((tmpl.stage_prompts as string) || '{}'); } catch { /* */ }
        if (sp.topics) {
          systemPrompt = resolveNiche(sp.topics);
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

    // Final pass: substitute any remaining [NICHE] placeholders
    if (systemPrompt && templateNiche) {
      systemPrompt = systemPrompt
        .replace(/\[NICHE\]/gi, templateNiche)
        .replace(/\[NICHE DESCRIPTION\]/gi, templateNiche)
        .replace(/\[TEMPLATE\]/gi, templateNiche)
        .replace(/\[CHANNEL\]/gi, templateNiche);
    } else if (systemPrompt) {
      // Strip unresolved placeholders so the LLM doesn't echo them
      systemPrompt = systemPrompt
        .replace(/\[NICHE(?:\s+DESCRIPTION)?\]/gi, 'this niche')
        .replace(/\[TEMPLATE\]/gi, 'this channel')
        .replace(/\[CHANNEL\]/gi, 'this channel');
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
      // Try to extract a valid JSON array by finding [ and ] then validating
      let parsed: string[] | null = null;
      const arrStart = raw.indexOf('[');
      const arrEnd = raw.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd > arrStart) {
        const candidate = raw.substring(arrStart, arrEnd + 1);
        try { parsed = JSON.parse(candidate); } catch { parsed = null; }
      }
      if (!parsed || !Array.isArray(parsed)) {
        // Fallback: try to extract numbered/bulleted list lines as topics
        const lines = raw.split('\n')
          .map(l => l.replace(/^\s*[\d]+[.)]\s*/, '').replace(/^[-*]\s*/, '').replace(/^[""]|[""]$/g, '').trim())
          .filter(l => l.length > 5 && l.length < 200);
        if (lines.length > 0) {
          res.json({ topics: lines.slice(0, count || 5) });
          return;
        }
        console.error('[generate-topics] Could not parse topics from LLM response:', raw.substring(0, 500));
        throw new Error('Could not parse topics — LLM returned unexpected format');
      }
      res.json({ topics: parsed.map(t => String(t)).slice(0, count || 5) });
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

    const FORMAT_RULE = `\n\nIMPORTANT: Output ONLY the narration script as plain text. No markdown, no headers (#), no bullet points, no file formatting instructions, no download instructions, no "next steps", no blockquotes. Do NOT include any instructions to the user about what to do with the script. Do NOT echo back the prompt, part numbers, word counts, or meta-commentary like "We need to write..." or "Here is part...". NEVER count words, NEVER include word counts like "word(1) word(2)", NEVER plan paragraph structure, NEVER write "We need X more words" or "Let's add". NEVER use bracket placeholders like [CATCHPHRASE] or [CHARACTER NAME]. Just output the pure narration text, nothing else.`;

    // For short videos (≤ 200s), single call is fine
    const CHUNK_THRESHOLD = 200;
    if (totalDuration <= CHUNK_THRESHOLD) {
      try {
        let script = await llmComplete({
          systemPrompt: prompt + FORMAT_RULE,
          userMessage: `The user selected this topic: "${topic}"\n\nGenerate the full narration script for a ${totalDuration}-second video about this topic. Follow the script rules in the system prompt exactly.`,
          temperature: 0.8,
          maxTokens: 4000,
        });
        // Strip meta-commentary the AI may leak (only at start — no global/multiline)
        script = script.replace(/^(we need to|let me|here is|here are|here's|okay|sure|certainly|of course|alright)[^\n]*\n+/i, '').trim();
        // Truncate from the first line that looks like AI internal reasoning
        const sLines = script.split('\n');
        const sCut = sLines.findIndex(line => {
          const l = line.trim().toLowerCase();
          if (/\w+\(\d+\)\s+\w+\(\d+\)/.test(line)) return true;
          if (/^(we need|let'?s (add|craft|incorporate|restructure|aim)|total words|that (totals|would|brings)|so we need|paragraph \d+)/i.test(l)) return true;
          if (/\[([A-Z\s]{3,})\]/.test(line) && !/\[\d{2}:\d{2}/.test(line)) return true;
          if (/^\d+\s*words\.?\s*$/i.test(l)) return true;
          return false;
        });
        if (sCut > 0) {
          console.log(`[generate-script] Truncated AI reasoning from line ${sCut + 1}`);
          script = sLines.slice(0, sCut).join('\n').trim();
        }
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
        // Strip meta-commentary the AI may leak (word counting, planning, placeholders, etc.)
        let cleaned = chunk.trim();
        // Remove leading meta lines (only at start — no global/multiline flags)
        cleaned = cleaned.replace(/^(we need to|let me|here is|here are|here's|okay|sure|certainly|of course|alright|now,?\s*(let's|we)|part\s+\d+\s*(of\s+\d+)?[\s:—\-]*(\(~?\d+\s*words?\))?[\s:—\-]*)/i, '').trim();
        // Truncate from the first line that looks like AI internal reasoning/planning
        const lines = cleaned.split('\n');
        const cutIdx = lines.findIndex(line => {
          const l = line.trim().toLowerCase();
          // Word-counting patterns: "word(1) word(2)" or "Count: word(1)"
          if (/\w+\(\d+\)\s+\w+\(\d+\)/.test(line)) return true;
          // Planning: "We need X more words", "Let's add", "Total words:", "That totals"
          if (/^(we need|let'?s (add|craft|incorporate|restructure|aim)|total words|that (totals|would|brings)|so we need|paragraph \d+)/i.test(l)) return true;
          // Bracket placeholders: [CATCHPHRASE], [MASCOT NAME], [CHARACTER]
          if (/\[([A-Z\s]{3,})\]/.test(line) && !/\[\d{2}:\d{2}/.test(line)) return true;
          // Explicit word counts in reasoning: "18 words.", "~375 words"
          if (/^\d+\s*words\.?\s*$/i.test(l)) return true;
          return false;
        });
        if (cutIdx > 0) {
          console.log(`[generate-script] Chunk ${i + 1}: truncated AI reasoning from line ${cutIdx + 1} (${lines.length - cutIdx} lines removed)`);
          cleaned = lines.slice(0, cutIdx).join('\n').trim();
        }
        // Strip leading blank lines after cleanup
        cleaned = cleaned.replace(/^\s*\n+/, '');
        chunks.push(cleaned);
        console.log(`[generate-script] Chunk ${i + 1}/${numChunks} done (${cleaned.split(/\s+/).length} words)`);
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

    // Strip any visual direction cues before TTS (e.g. "[points left]", "(head right)")
    // These belong in image prompts, not spoken audio
    const cleanText = stripVisualDirections(text);

    try {
      res.write(JSON.stringify({ progress: true, step: 'tts', detail: 'Generating speech...' }) + '\n');
      const result = await narrationService.generateNarration(cleanText, {
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
    const { segments, styleTemplate, visualStyle, aspectRatio, videoMode, comparisonItems, bgColor: promptBgColor, compMediaSource } = req.body as {
      segments: Array<{ timestamp: string; text: string; side?: 'left' | 'right' | 'both' | 'win-left' | 'win-right' }>;
      styleTemplate?: string;
      visualStyle?: string;
      aspectRatio?: string;
      videoMode?: 'standard' | 'comparison';
      comparisonItems?: { type?: 'difference' | 'winner'; layout?: { left: { x: number; y: number; w: number; h: number }; mascot: { x: number; y: number; w: number; h: number }; right: { x: number; y: number; w: number; h: number } }; left: { name: string; description?: string }; right: { name: string; description?: string } };
      bgColor?: string;
      compMediaSource?: 'flow' | 'pexels';
    };

    if (!segments?.length) {
      res.status(400).json({ error: 'segments array is required' });
      return;
    }

    // Only expand multi-sentence segments when input is very coarse (< 30 segments).
    // If user already has fine-grained segments, use them as-is (1 prompt per segment).
    let expandedSegments: Array<{ timestamp: string; text: string; side?: 'left' | 'right' | 'both' | 'win-left' | 'win-right' }>;
    if (segments.length < 30) {
      expandedSegments = [];
      for (const seg of segments) {
        const sentences = seg.text.split(/(?<=[.!?])\s+/).filter(x => x.trim());
        if (sentences.length <= 1) {
          expandedSegments.push(seg);
        } else {
          const tsParts = seg.timestamp.split(':').map(Number);
          const baseSec = tsParts.length === 3
            ? tsParts[0] * 3600 + tsParts[1] * 60 + tsParts[2]
            : tsParts[0] * 60 + tsParts[1];
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
              ...(seg.side ? { side: seg.side } : {}),
            });
          }
        }
      }
      console.log(`[storyboard] Segments: ${segments.length} input → ${expandedSegments.length} expanded (coarse mode)`);
    } else {
      expandedSegments = segments;
      console.log(`[storyboard] Segments: ${segments.length} (fine-grained, no expansion)`);
    }

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

    // Comparison mode: instruct LLM to generate focused single-subject images
    // The final video layout is [left_image | mascot | right_image] — each generated image
    // fills ONE panel, so it must show only that side's subject (no split-screen, no mascot)
    if (videoMode === 'comparison' && comparisonItems?.left?.name && comparisonItems?.right?.name) {
      const compType = comparisonItems.type || 'difference';
      const isWhiteBg = !promptBgColor || promptBgColor === 'white' || promptBgColor === '#ffffff' || promptBgColor === '#FFFFFF';
      const bgRule = isWhiteBg
        ? '\n- MANDATORY: Every image MUST have a plain white background. No gradients, no colored backgrounds, no dark backgrounds — pure white only for visual consistency'
        : '';
      const baseRules = `\n\nCOMPARISON MODE: This video compares "${comparisonItems.left.name}" (left) vs "${comparisonItems.right.name}" (right) in a 3-panel layout. Each image fills ONE panel only. CRITICAL RULES:
- Generate a SINGLE-SUBJECT image for each segment — show ONLY the topic being discussed
- Do NOT create split-screen, side-by-side, or comparison images — that layout is handled separately
- Do NOT include any mascot, presenter, host character, or pointing figure in the image
- Focus on vivid, concrete visuals of the subject: objects, scenes, environments, infographics
- For "left" segments about "${comparisonItems.left.name}": show only ${comparisonItems.left.name} content
- For "right" segments about "${comparisonItems.right.name}": show only ${comparisonItems.right.name} content${bgRule}`;

      if (compType === 'winner') {
        systemPrompt += baseRules + `
- For "win-left" or "win-right" segments: show a triumphant, victorious version of the winning side — bold, bright, celebratory
- For neutral/both segments: show a general scene relevant to both sides`;
      } else {
        systemPrompt += baseRules + `
- For neutral/both segments: show a general scene relevant to both sides`;
      }
    }

    // When media source is Pexels, override system prompt to generate search queries
    if (compMediaSource === 'pexels') {
      const compCtx = (videoMode === 'comparison' && comparisonItems?.left?.name && comparisonItems?.right?.name)
        ? `\nThis video compares "${comparisonItems.left.name}" (LEFT) vs "${comparisonItems.right.name}" (RIGHT).
CRITICAL — every search query MUST be directly about the specific subject being discussed:
- For "left" segments about "${comparisonItems.left.name}": query MUST include "${comparisonItems.left.name}" or a closely related real-world term. Example: if left is "Earth", use "earth planet surface", "earth from space", "earth ocean continent"
- For "right" segments about "${comparisonItems.right.name}": query MUST include "${comparisonItems.right.name}" or a closely related real-world term. Example: if right is "Jupiter", use "jupiter planet", "jupiter great red spot", "jupiter gas giant"
- For neutral/both segments: use a term directly relevant to the comparison topic (e.g. "solar system planets", "space universe")
- NEVER use generic/abstract queries like "comparison", "versus", "battle", "winner" — always describe the ACTUAL visual subject`
        : '';
      systemPrompt = `You are a Pexels stock video search query generator. For each timestamped narration line, generate ONE short search query (2-5 words) that finds a RELEVANT stock video on Pexels.
${compCtx}
Rules:
- Each line: [MM:SS] followed by the search query
- Queries must be 2-5 concrete English keywords that describe a REAL, FILMABLE subject
- The query must be DIRECTLY related to what the narration is talking about — NOT abstract or metaphorical
- Think: "What would I actually see in a stock video for this topic?"
- Good examples: "cat playing yarn", "deep ocean coral reef", "rocket launch pad", "ancient rome colosseum"
- BAD examples: "amazing comparison", "incredible facts", "mind blowing", "ultimate showdown" — these return IRRELEVANT stock footage
- If narration mentions a specific animal, place, object, phenomenon — USE THAT as the search term
- Prefer specific nouns over adjectives: "volcano erupting lava" is better than "powerful dangerous mountain"
- Output ONLY search queries. No commentary, no numbering, no markdown. Separate with blank lines.`;
    }

    // Inject aspect ratio guidance
    const ar = aspectRatio || '16:9';
    const arSuffix = ar === '9:16' ? 'vertical portrait layout, 9:16' : ar === '1:1' ? 'square layout, 1:1' : 'landscape layout, 16:9';

    // Append output format instruction (only for non-pexels mode)
    if (compMediaSource !== 'pexels') {
      systemPrompt += `\n\nIMPORTANT: Output ONLY the image prompts. Each prompt starts with its timestamp [MM:SS]. One prompt per timestamp. Separate prompts with a blank line. No commentary, no numbering, no markdown. Do NOT write "we need to generate" or any meta-commentary — just output the image description directly.${visualStyle ? ` Every prompt MUST include "${visualStyle}" as the art style.` : ''}${isSimpleStyle ? ' Every prompt MUST include "white background".' : ''} MANDATORY: Every prompt MUST end with ", ${arSuffix}". This suffix is required on every single prompt — do not omit it.`;
    }

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

    // Build a validator: reject prompts that are just raw narration text or missing required elements
    const isPexelsMode = compMediaSource === 'pexels';
    const validatePrompt = (prompt: string, narrationText: string): boolean => {
      if (!prompt) return false;
      // Pexels mode: short search queries are valid (just reject empty or meta-commentary)
      if (isPexelsMode) {
        if (prompt.length < 3) return false;
        if (/^(we need to|let me|i will|i'll|here is|here are|sure|okay|of course|certainly)/i.test(prompt.trim())) return false;
        return true;
      }
      if (prompt.length < 15) return false;
      // Reject meta-commentary / AI self-talk instead of actual image prompts
      const lower = prompt.toLowerCase();
      if (/^(we need to|let me|i will|i'll|here is|here are|sure|okay|of course|certainly|for this|the prompt|this prompt)/i.test(prompt.trim())) return false;
      if (/generate\s+(a|an|the)\s+(image|prompt|visual)/i.test(lower) && lower.length < 100) return false;
      // Reject if the prompt is basically the raw narration text (±minor suffix)
      const cleanPrompt = prompt.replace(/,\s*(high quality|detailed|landscape layout|vertical portrait layout|square layout|16:9|9:16|1:1)\s*/gi, '').trim();
      const cleanNarration = narrationText.trim();
      if (cleanPrompt === cleanNarration || cleanPrompt === cleanNarration + '.') return false;
      // If format template is set, check that prompt doesn't start with raw narration
      if (formatTemplate) {
        // Extract a key phrase from the format template (first few words before any placeholder)
        const prefixMatch = formatTemplate.match(/^([^[{]+)/);
        if (prefixMatch) {
          const prefix = prefixMatch[1].trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase();
          if (prefix.length > 3 && !prompt.toLowerCase().includes(prefix)) return false;
        }
      }
      // If visual style is set, prompt should mention it
      if (visualStyle?.trim() && !prompt.toLowerCase().includes(visualStyle.toLowerCase().split(/\s+/)[0])) return false;
      return true;
    };

    res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `${expandedSegments.length} segments to process (expanded from ${segments.length} transcript blocks)` }) + '\n');

    // Convert timestamps to seconds so "01:05" matches "1:05" or "00:01:05"
    const tsToSec = (ts: string) => {
      const parts = ts.split(':').map(Number);
      return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    };

    // Process expanded segments in batches of 40
    const batchSize = 40;
    const allPrompts: Array<{ timestamp: string; prompt: string }> = [];
    const modelBySec = new Map<number, string>();

    for (let i = 0; i < expandedSegments.length; i += batchSize) {
      const batch = expandedSegments.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(expandedSegments.length / batchSize);

      res.write(JSON.stringify({ progress: true, step: 'generating', detail: `Generating prompts batch ${batchNum}/${totalBatches}...` }) + '\n');

      const segmentText = batch.map((s) => `[${s.timestamp}] ${s.text}`).join('\n');

      const parseBatch = (raw: string, usedModel: string) => {
        const lines = raw.split('\n');
        // For single-segment batches, default to the segment's timestamp
        let currentTs = batch.length === 1 ? batch[0].timestamp : '';
        let currentPrompt = '';
        let foundTimestamp = false;
        const pushIfValid = () => {
          if (!currentTs || !currentPrompt.trim()) return;
          const sec = tsToSec(currentTs);
          const seg = batch.find(s => tsToSec(s.timestamp) === sec) ||
            batch.find(s => Math.abs(tsToSec(s.timestamp) - sec) <= 5);
          const narration = seg?.text || '';
          if (validatePrompt(currentPrompt.trim(), narration)) {
            allPrompts.push({ timestamp: currentTs, prompt: currentPrompt.trim() });
            modelBySec.set(sec, usedModel);
          } else {
            console.log(`[generate-prompts] Rejected invalid prompt for [${currentTs}]: "${currentPrompt.trim().substring(0, 60)}..."`);
          }
        };
        for (const line of lines) {
          const cleaned = line.replace(/^[\s`*#\-]*\d*[.)]\s*/, '').replace(/^[\s`*#\-]+/, '').replace(/`/g, '');
          const match = cleaned.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/);
          if (match) {
            pushIfValid();
            currentTs = match[1];
            currentPrompt = match[2];
            foundTimestamp = true;
          } else if (line.trim() && !line.match(/^---+$/) && !line.match(/^#{1,3}\s/)) {
            // Skip meta-commentary lines before the first timestamp
            if (!foundTimestamp && batch.length > 1) continue;
            currentPrompt += (currentPrompt ? ' ' : '') + line.trim();
          }
        }
        pushIfValid();
        return lines.length;
      };

      try {
        let raw: string;
        try {
          const fmtReminder = (!isPexelsMode && formatTemplate) ? `\n\nREMINDER: Every prompt MUST follow the format: "${formatTemplate.substring(0, 120)}".` : '';
          const userMsg = isPexelsMode
            ? `Generate one Pexels search query per timestamp. Each query must name the SPECIFIC subject from the narration (animal, place, object, event). No abstract words.\n\n${segmentText}`
            : `Generate one image prompt per timestamp line:\n\n${segmentText}${fmtReminder}`;
          raw = await llmComplete({
            systemPrompt,
            userMessage: userMsg,
            temperature: 0.7,
            maxTokens: 16000,
          });
        } catch (retryErr) {
          // Retry once after short delay (rate limit recovery)
          console.warn(`[storyboard] Batch ${batchNum} failed, retrying after 3s...`, (retryErr as Error).message);
          res.write(JSON.stringify({ progress: true, step: 'retrying', detail: `Batch ${batchNum} rate limited, retrying in 3s...` }) + '\n');
          await new Promise((r) => setTimeout(r, 3000));
          const fmtReminder2 = (!isPexelsMode && formatTemplate) ? `\n\nREMINDER: Every prompt MUST follow the format: "${formatTemplate.substring(0, 120)}".` : '';
          const userMsg2 = isPexelsMode
            ? `Generate one Pexels search query per timestamp. Each query must name the SPECIFIC subject from the narration (animal, place, object, event). No abstract words.\n\n${segmentText}`
            : `Generate one image prompt per timestamp line:\n\n${segmentText}${fmtReminder2}`;
          raw = await llmComplete({
            systemPrompt,
            userMessage: userMsg2,
            temperature: 0.7,
            maxTokens: 16000,
          });
        }

        const lineCount = parseBatch(raw, getLastUsedModel());
        console.log(`[storyboard] Batch ${batchNum}: parsed ${allPrompts.length} prompts from ${lineCount} lines`);
        // Send partial prompts so frontend can show them immediately
        const partialBySec = new Map<number, string>();
        for (const p of allPrompts) partialBySec.set(tsToSec(p.timestamp), p.prompt);
        const partialPrompts = expandedSegments
          .map((seg) => {
            const segSec = tsToSec(seg.timestamp);
            const prompt = partialBySec.get(segSec) || '';
            return { timestamp: seg.timestamp, text: seg.text, prompt, model: modelBySec.get(segSec) || '' };
          })
          .filter(p => p.prompt);
        res.write(JSON.stringify({ progress: true, step: 'batch-done', detail: `Batch ${batchNum} done (${allPrompts.length} prompts so far)`, partialPrompts }) + '\n');

        // Short delay between batches to avoid rate limiting
        if (i + batchSize < expandedSegments.length) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        res.write(JSON.stringify({ progress: true, step: 'error', detail: `Batch ${batchNum} error: ${(err as Error).message}` }) + '\n');
      }
    }

    // Programmatically append aspect ratio to every prompt (LLM often ignores instructions)
    // Skip for Pexels mode — search queries don't need aspect ratio
    if (!isPexelsMode) {
      const arTag = `, ${arSuffix}`;
      for (let j = 0; j < allPrompts.length; j++) {
        if (!allPrompts[j].prompt.includes(arSuffix)) {
          allPrompts[j].prompt = allPrompts[j].prompt.replace(/\.?\s*$/, '') + arTag;
        }
      }
    }

    // Build prompt map with fuzzy timestamp matching
    const promptBySec = new Map<number, string>();
    for (const p of allPrompts) {
      promptBySec.set(tsToSec(p.timestamp), p.prompt);
    }

    // Match segments to prompts: exact timestamp first, then fuzzy (±5 seconds)
    const matchPrompts = () => {
      const usedSecs = new Set<number>();
      return expandedSegments.map((seg) => {
        const segSec = tsToSec(seg.timestamp);
        let prompt = promptBySec.get(segSec);
        let matchedSec = segSec;
        if (prompt && !usedSecs.has(segSec)) {
          usedSecs.add(segSec);
        } else if (!prompt) {
          for (let delta = 1; delta <= 5; delta++) {
            for (const tryDelta of [delta, -delta]) {
              const trySec = segSec + tryDelta;
              if (promptBySec.has(trySec) && !usedSecs.has(trySec)) {
                prompt = promptBySec.get(trySec);
                matchedSec = trySec;
                usedSecs.add(trySec);
                break;
              }
            }
            if (prompt) break;
          }
        }
        return { timestamp: seg.timestamp, text: seg.text, prompt: prompt || '', model: modelBySec.get(matchedSec) || '', ...(seg.side ? { side: seg.side } : {}) };
      });
    };

    let finalPrompts = matchPrompts();
    let missingSegments = finalPrompts.filter(p => !p.prompt);

    // Retry missing segments up to 3 times with short delay
    const MAX_RETRIES = 3;
    for (let retry = 1; retry <= MAX_RETRIES && missingSegments.length > 0; retry++) {
      const delay = 2000; // 2s
      res.write(JSON.stringify({ progress: true, step: 'retrying', detail: `${missingSegments.length} segments missing prompts, retry ${retry}/${MAX_RETRIES}...` }) + '\n');
      await new Promise((r) => setTimeout(r, delay));

      const retryText = missingSegments.map(s => `[${s.timestamp}] ${s.text}`).join('\n');
      const fmtReminderRetry = (!isPexelsMode && formatTemplate) ? `\n\nREMINDER: Every prompt MUST follow the format: "${formatTemplate.substring(0, 120)}".` : '';
      const retryUserMsg = isPexelsMode
        ? `Generate one Pexels search query per timestamp. Each query must name the SPECIFIC subject from the narration (animal, place, object, event). No abstract words.\n\n${retryText}`
        : `Generate one image prompt per timestamp line:\n\n${retryText}${fmtReminderRetry}`;

      try {
        const raw = await llmComplete({
          systemPrompt,
          userMessage: retryUserMsg,
          temperature: 0.7,
          maxTokens: 8000,
        });

        // Parse retry results into promptBySec (with validation)
        const retryModel = getLastUsedModel();
        const lines = raw.split('\n');
        let currentTs = '';
        let currentPrompt = '';
        const pushRetryIfValid = () => {
          if (!currentTs || !currentPrompt.trim()) return;
          const sec = tsToSec(currentTs);
          const seg = expandedSegments.find(s => tsToSec(s.timestamp) === sec) ||
            expandedSegments.find(s => Math.abs(tsToSec(s.timestamp) - sec) <= 5);
          const narration = seg?.text || '';
          if (validatePrompt(currentPrompt.trim(), narration)) {
            promptBySec.set(sec, currentPrompt.trim());
            modelBySec.set(sec, retryModel);
          } else {
            console.log(`[generate-prompts] Retry rejected invalid prompt for [${currentTs}]: "${currentPrompt.trim().substring(0, 60)}..."`);
          }
        };
        for (const line of lines) {
          const cleaned = line.replace(/^[\s`*#\-]*\d*[.)]\s*/, '').replace(/^[\s`*#\-]+/, '').replace(/`/g, '');
          const match = cleaned.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/);
          if (match) {
            pushRetryIfValid();
            currentTs = match[1];
            currentPrompt = match[2];
          } else if (line.trim() && !line.match(/^---+$/) && !line.match(/^#{1,3}\s/)) {
            currentPrompt += ' ' + line.trim();
          }
        }
        pushRetryIfValid();

        // Enforce aspect ratio on new prompts
        for (const [sec, prompt] of promptBySec) {
          if (!prompt.includes(arSuffix)) {
            promptBySec.set(sec, prompt.replace(/\.?\s*$/, '') + arTag);
          }
        }

        // Re-match all segments
        finalPrompts = matchPrompts();
        missingSegments = finalPrompts.filter(p => !p.prompt);

        res.write(JSON.stringify({ progress: true, step: 'retry-done', detail: `Retry ${retry} done, ${missingSegments.length} still missing` }) + '\n');
        console.log(`[generate-prompts] Retry ${retry}: ${missingSegments.length} segments still missing`);
      } catch (err) {
        res.write(JSON.stringify({ progress: true, step: 'retry-error', detail: `Retry ${retry} failed: ${(err as Error).message}` }) + '\n');
        console.warn(`[generate-prompts] Retry ${retry} failed:`, (err as Error).message);
      }
    }

    // Final: if still missing after batch retries, generate individually per segment — retry forever until all done
    if (missingSegments.length > 0) {
      res.write(JSON.stringify({ progress: true, step: 'individual', detail: `Generating ${missingSegments.length} remaining prompts individually...` }) + '\n');

      for (const seg of missingSegments) {
        let attempt = 0;
        const MAX_INDIVIDUAL_ATTEMPTS = 20;
        while (!promptBySec.has(tsToSec(seg.timestamp)) && attempt < MAX_INDIVIDUAL_ATTEMPTS) {
          attempt++;
          const delay = Math.floor(Math.random() * 11 + 10) * 1000;
          if (attempt > 1) {
            res.write(JSON.stringify({ progress: true, step: 'individual-retry', detail: `[${seg.timestamp}] retry #${attempt}/${MAX_INDIVIDUAL_ATTEMPTS} in ${Math.round(delay / 1000)}s...` }) + '\n');
          }
          await new Promise((r) => setTimeout(r, delay));
          try {
            const fmtReminder = formatTemplate ? `\nYou MUST follow this format: "${formatTemplate.substring(0, 200)}"` : '';
            const raw = await llmComplete({
              systemPrompt,
              userMessage: `Generate exactly ONE image prompt for this narration:\n\n[${seg.timestamp}] ${seg.text}${fmtReminder}\n\nOutput ONLY the prompt text, no timestamp, no brackets, no commentary, no quotes.`,
              temperature: Math.min(0.7 + (attempt - 1) * 0.05, 1.0),
              maxTokens: 1000,
            });
            const prompt = raw.replace(/^\[[\d:]+\]\s*/, '').replace(/^["']|["']$/g, '').trim();
            if (prompt && prompt.length > 10 && validatePrompt(prompt, seg.text)) {
              const withAr = prompt.includes(arSuffix) ? prompt : prompt.replace(/\.?\s*$/, '') + arTag;
              const segSec = tsToSec(seg.timestamp);
              promptBySec.set(segSec, withAr);
              modelBySec.set(segSec, getLastUsedModel());
              res.write(JSON.stringify({ progress: true, step: 'individual-done', detail: `[${seg.timestamp}] prompt generated (attempt #${attempt})` }) + '\n');
            } else if (prompt) {
              console.log(`[generate-prompts] Individual rejected invalid prompt for [${seg.timestamp}]: "${prompt.substring(0, 60)}..."`);
              res.write(JSON.stringify({ progress: true, step: 'individual-rejected', detail: `[${seg.timestamp}] prompt rejected (not formatted), will retry...` }) + '\n');
            }
          } catch (err) {
            console.warn(`[generate-prompts] Individual [${seg.timestamp}] attempt #${attempt} failed:`, (err as Error).message);
            res.write(JSON.stringify({ progress: true, step: 'individual-error', detail: `[${seg.timestamp}] attempt #${attempt} failed: ${(err as Error).message}, will retry...` }) + '\n');
          }
        }
      }
      // Final re-match — all segments guaranteed to have prompts
      finalPrompts = matchPrompts();
    }

    // ── Comparison mode: resolve side for each prompt ──
    if (videoMode === 'comparison' && comparisonItems?.left?.name && comparisonItems?.right?.name) {
      // Use pre-tagged sides from frontend (parsed from script direction markers)
      // Fall back to name-matching for un-tagged segments
      const leftName = comparisonItems.left.name.toLowerCase();
      const rightName = comparisonItems.right.name.toLowerCase();
      const leftWords = leftName.split(/\s+/).filter(w => w.length > 2);
      const rightWords = rightName.split(/\s+/).filter(w => w.length > 2);

      for (const p of finalPrompts) {
        if (p.side) continue; // already tagged from script direction markers
        const lower = (p.text + ' ' + p.prompt).toLowerCase();
        const hasLeft = leftWords.some(w => lower.includes(w)) || lower.includes(leftName);
        const hasRight = rightWords.some(w => lower.includes(w)) || lower.includes(rightName);
        if (hasLeft && hasRight) p.side = 'both';
        else if (hasLeft) p.side = 'left';
        else if (hasRight) p.side = 'right';
        else p.side = 'both';
      }
      res.write(JSON.stringify({ progress: true, step: 'side-detect', detail: `Auto-tagged ${finalPrompts.filter(p => p.side === 'left').length} left, ${finalPrompts.filter(p => p.side === 'right').length} right, ${finalPrompts.filter(p => p.side === 'both').length} both` }) + '\n');
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

      // Parse JSON from response — strip markdown fences and control chars
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
        const metadata = normalizeMetadata(safeJsonParse(retryMatch[0]) as Record<string, unknown>);
        res.json({ metadata });
        return;
      }
      const metadata = normalizeMetadata(safeJsonParse(jsonMatch[0]) as Record<string, unknown>);
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
    const { segments, audioFilename, aspectRatio, bgMusicFilename, voiceVolume, musicVolume, outputName, speed, bgColor, subtitleStyle, videoMode, mascotImage, mascotImageLeft, mascotImageRight, mascotImageBoth, mascotImageWin, comparisonLayout, comparisonItems, compRoundPanels, compBgSource, compBgQuery, frameTemplateId } = req.body as {
      segments: StoryboardSegment[];
      audioFilename: string;
      aspectRatio?: string;
      bgMusicFilename?: string;
      voiceVolume?: number;
      musicVolume?: number;
      outputName?: string;
      speed?: number;
      bgColor?: string;
      videoMode?: 'standard' | 'comparison';
      mascotImage?: string;
      mascotImageLeft?: string;
      mascotImageRight?: string;
      mascotImageBoth?: string;
      mascotImageWin?: string;
      comparisonItems?: { type?: 'difference' | 'winner'; left: { name: string }; right: { name: string } };
      compBgSource?: 'color' | 'pexels';
      compBgQuery?: string; // Pexels search query for background video
      subtitleStyle?: {
        enabled: boolean;
        fontFamily: string;
        fontSize: number;
        fontColor: string;
        fontWeight: 'normal' | 'bold';
        strokeColor: string;
        strokeWidth: number;
        bgColor: string;
        bgOpacity: number;
        position: 'top' | 'center' | 'bottom';
        alignment: 'left' | 'center' | 'right';
        marginX: number;
        marginBottom: number;
        uppercase: boolean;
        animation: 'none' | 'fade' | 'word-highlight' | 'karaoke';
      };
      comparisonLayout?: { left: { x: number; y: number; w: number; h: number }; mascot: { x: number; y: number; w: number; h: number }; right: { x: number; y: number; w: number; h: number } };
      compRoundPanels?: boolean;
      frameTemplateId?: string;
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

      const protocol = req.protocol;
      const host = req.headers.host || 'localhost:3002';
      const baseUrl = `${protocol}://${host}`;

      const toHttpUrl = (filePath: string): string => {
        if (!filePath) return '';
        const resolved = path.resolve(filePath);
        const resolvedAssets = path.resolve(process.env.ASSETS_DIR ?? './assets');
        const resolvedCache = path.resolve(cacheDir);

        if (resolved.startsWith(resolvedAssets)) {
          const rel = path.relative(resolvedAssets, resolved).replace(/\\/g, '/');
          return `${baseUrl}/assets/${rel}`;
        }
        if (resolved.startsWith(resolvedCache)) {
          const rel = path.relative(resolvedCache, resolved).replace(/\\/g, '/');
          return `${baseUrl}/cache/${rel}`;
        }

        const base = path.basename(resolved);
        return `${baseUrl}/api/media-library/file/${base}`;
      };

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
        // FFmpeg atempo only supports 0.5–2.0 per instance; chain multiple filters for values outside that range
        const atempoFilters: string[] = [];
        let remaining = speedFactor;
        while (remaining > 2.0) { atempoFilters.push('atempo=2.0'); remaining /= 2.0; }
        while (remaining < 0.5) { atempoFilters.push('atempo=0.5'); remaining /= 0.5; }
        atempoFilters.push(`atempo=${remaining}`);
        await execFileAsync(ffmpeg, [
          '-i', audioPath,
          '-filter:a', atempoFilters.join(','),
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
      interface MergedSegment { imageFilename: string; videoFilename?: string; mediaType?: MediaType; startTime: number; endTime: number; texts: string[]; motion: MotionEffect; side?: 'left' | 'right' | 'both' }
      const merged: MergedSegment[] = [];
      for (const seg of segments) {
        const motion = seg.motion || 'static';
        const isVideo = (seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '')) && (seg.videoFilename || seg.imageFilename);
        const last = merged[merged.length - 1];
        if (!isVideo && last && !last.videoFilename && last.imageFilename === seg.imageFilename && last.motion === motion && last.side === seg.side) {
          last.endTime = seg.endTime;
          last.texts.push(seg.text || '');
        } else {
          merged.push({
            imageFilename: seg.imageFilename,
            videoFilename: isVideo ? (seg.videoFilename || seg.imageFilename) : undefined,
            mediaType: isVideo ? 'video' : seg.mediaType,
            startTime: seg.startTime, endTime: seg.endTime, texts: [seg.text || ''], motion,
            side: seg.side,
          });
        }
      }

      res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `${segments.length} segments → ${merged.length} clips` }) + '\n');

      const videoDir = path.resolve(cacheDir, 'videos');

      let padColor = 'white';
      if (bgColor) {
        if (/^#[0-9a-fA-F]{6}$/.test(bgColor)) {
          padColor = '0x' + bgColor.substring(1);
        } else if (/^[0-9a-fA-F]{6}$/.test(bgColor)) {
          padColor = '0x' + bgColor;
        } else if (/^[a-zA-Z]+$/.test(bgColor)) {
          padColor = bgColor;
        }
      }

      // Helper: build static filter for FFmpeg (no motion)
      function buildStaticFilter(outW: number, outH: number, fps: number): string {
        return [
          `[0:v]scale=w=${outW}:h=${outH}:force_original_aspect_ratio=decrease[scaled]`,
          `[scaled]pad=w=${outW}:h=${outH}:x=(ow-iw)/2:y=(oh-ih)/2:color=${padColor}[padded]`,
          `[padded]fps=${fps},setsar=1/1,format=yuv420p[out]`,
        ].join(';');
      }

      // ── Comparison mode: resolve mascot image path ──
      const isComparison = videoMode === 'comparison';
      let mascotPath = '';
      if (isComparison && mascotImage) {
        mascotPath = path.join(imageDir, path.basename(mascotImage));
        if (!fs.existsSync(mascotPath)) {
          res.write(JSON.stringify({ error: 'Mascot image not found: ' + mascotImage }) + '\n');
          res.end();
          return;
        }
        res.write(JSON.stringify({ progress: true, step: 'preparing', detail: 'Comparison mode: 3-panel layout with mascot' }) + '\n');
      }
      let mascotLeftPath = '';
      let mascotRightPath = '';
      let mascotBothPath = '';
      let mascotWinPath = '';
      if (isComparison && mascotImageLeft) {
        mascotLeftPath = path.join(imageDir, path.basename(mascotImageLeft));
      }
      if (isComparison && mascotImageRight) {
        mascotRightPath = path.join(imageDir, path.basename(mascotImageRight));
      }
      if (isComparison && mascotImageBoth) {
        mascotBothPath = path.join(imageDir, path.basename(mascotImageBoth));
      }
      if (isComparison && mascotImageWin) {
        mascotWinPath = path.join(imageDir, path.basename(mascotImageWin));
      }

      // ── Comparison mode: fetch Pexels background video if requested ──
      let compBgVideoPath = '';
      if (isComparison && compBgSource === 'pexels') {
        const bgQuery = compBgQuery || 'abstract dark background';
        res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `Searching Pexels for background: "${bgQuery}"` }) + '\n');
        try {
          const { searchAndDownloadPexelsVideo } = await import('../services/pexels.service');
          const orientation = (aspectRatio === '9:16' || aspectRatio === '3:4') ? 'portrait' : 'landscape';
          const bgResult = await searchAndDownloadPexelsVideo(bgQuery, {
            orientation,
            minDuration: 10,
          });
          if (bgResult) {
            compBgVideoPath = path.join(imageDir, bgResult.filename);
            res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `Background video downloaded: ${bgResult.filename} (${bgResult.duration}s)` }) + '\n');
          } else {
            res.write(JSON.stringify({ progress: true, step: 'warning', detail: 'No Pexels background found, using solid color' }) + '\n');
          }
        } catch (err: any) {
          res.write(JSON.stringify({ progress: true, step: 'warning', detail: `Pexels background fetch failed: ${err.message}` }) + '\n');
        }
      }

      // ── Resolve frame template overlay → render HTML to transparent PNG ──
      let frameOverlayPng = '';
      if (isComparison && frameTemplateId) {
        const frameRow = dbGet<{ id: string; filename: string; filepath: string; mime_type: string }>('SELECT id, filename, filepath, mime_type FROM frame_video_library WHERE id = ?', [frameTemplateId]);
        if (frameRow && (frameRow.mime_type === 'text/html' || frameRow.filename.endsWith('.html'))) {
          res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `Rendering frame template: ${frameRow.filename}` }) + '\n');
          try {
            const frameDir = path.resolve(process.env.ASSETS_DIR || './assets', 'frame-video-library');
            const htmlPath = path.join(frameDir, frameRow.filename);
            if (fs.existsSync(htmlPath)) {
              // Read HTML and inject transparent background + hide placeholder text
              let html = fs.readFileSync(htmlPath, 'utf-8');
              const transparencyCSS = `<style>
                body { background: transparent !important; }
                .panel { background: transparent !important; backdrop-filter: none !important; }
                .preview-media-placeholder { display: none !important; }
              </style>`;
              html = html.replace('</head>', transparencyCSS + '\n</head>');

              const tmpHtml = path.join(concatDir, 'frame_overlay.html');
              fs.writeFileSync(tmpHtml, html);
              frameOverlayPng = path.join(concatDir, 'frame_overlay.png');

              // Render HTML to transparent PNG via inline Node ESM script (puppeteer-core is ESM-only)
              const renderScript = `
                import puppeteer from 'puppeteer-core';
                const browser = await puppeteer.launch({
                  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
                  headless: true,
                  args: ['--no-sandbox', '--disable-setuid-sandbox'],
                });
                const page = await browser.newPage();
                await page.setViewport({ width: ${w}, height: ${h} });
                await page.goto('file:///${tmpHtml.replace(/\\/g, '/')}', { waitUntil: 'networkidle0' });
                await page.screenshot({ path: '${frameOverlayPng.replace(/\\/g, '/')}', omitBackground: true });
                await browser.close();
              `;
              const renderScriptPath = path.join(concatDir, 'render_frame.mjs');
              fs.writeFileSync(renderScriptPath, renderScript);
              await execFileAsync('node', [renderScriptPath], { timeout: 30_000 });
              res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `Frame overlay rendered: ${w}x${h} PNG` }) + '\n');
            }
          } catch (err: any) {
            res.write(JSON.stringify({ progress: true, step: 'warning', detail: `Frame template render failed: ${err.message}` }) + '\n');
            frameOverlayPng = '';
          }
        }
      }

      // Helper: build comparison 3-panel filter for FFmpeg
      // Layout: [left_image | mascot | right_image] on a 1920x1080 canvas
      // Input 0 = left image, Input 1 = mascot, Input 2 = right image
      // Active side is bright with a colored border; inactive side is dimmed to 30%
      // 'both' = verdict/winner moment — both sides bright with highlight borders
      interface CompFilterOpts {
        activeSide: 'left' | 'right' | 'both' | 'win-left' | 'win-right';
        layout?: { left: { x: number; y: number; w: number; h: number }; mascot: { x: number; y: number; w: number; h: number }; right: { x: number; y: number; w: number; h: number } };
        scoreLeft?: number;
        scoreRight?: number;
        leftName?: string;
        rightName?: string;
        roundLabel?: string; // e.g. "ROUND 1: INDEPENDENCE"
        isFinalReveal?: boolean;
        roundPanels?: boolean; // apply rounded corners to left/right panels
        stickerInputIdx?: number; // FFmpeg input index for sticker overlay
        stickerSize?: number; // target sticker size in pixels
        bgInputIdx?: number; // FFmpeg input index for Pexels background video
      }
      function buildComparisonFilter(outW: number, outH: number, fps: number, opts: CompFilterOpts): string {
        const { activeSide, layout, scoreLeft = 0, scoreRight = 0, leftName = '', rightName = '', roundLabel, isFinalReveal, roundPanels } = opts;
        // Panel rects from layout (percentages 0-100) or defaults — edge-to-edge, no gaps
        const L = layout?.left  || { x: 0, y: 0, w: 50, h: 58 };
        const M = layout?.mascot || { x: 20, y: 58, w: 60, h: 42 };
        const R = layout?.right || { x: 50, y: 0, w: 50, h: 58 };

        // Convert percentages to pixel rects (ensure even dimensions for yuv420p)
        const px = (r: { x: number; y: number; w: number; h: number }) => ({
          x: Math.round(outW * r.x / 100),
          y: Math.round(outH * r.y / 100),
          w: Math.max(Math.round(outW * r.w / 100) & ~1, 2),
          h: Math.max(Math.round(outH * r.h / 100) & ~1, 2),
        });
        const lp = px(L), mp = px(M), rp = px(R);

        // Winner sides: highlight winner with gold, dim loser
        const isWin = activeSide === 'win-left' || activeSide === 'win-right';
        const winnerSide = activeSide === 'win-left' ? 'left' : activeSide === 'win-right' ? 'right' : null;

        // Dim inactive/loser panels
        const dimLeft = (activeSide === 'right' || activeSide === 'win-right') ? ',colorlevels=rimax=0.3:gimax=0.3:bimax=0.3' : '';
        const dimRight = (activeSide === 'left' || activeSide === 'win-left') ? ',colorlevels=rimax=0.3:gimax=0.3:bimax=0.3' : '';

        // Rounded corner radius (proportional to panel width)
        const cornerR = roundPanels ? Math.round(Math.min(lp.w, lp.h) * 0.06) : 0;

        // Build rounded-corner geq alpha expression: alpha=255 inside rounded rect, 0 outside
        // Uses distance from nearest corner to create rounded rectangle mask
        const roundGeq = (pw: number, ph: number) => {
          const r = Math.min(cornerR, Math.floor(pw / 2), Math.floor(ph / 2));
          // geq expression: for each pixel (X,Y), compute if inside rounded rect
          // Corner circles at (r,r), (W-r-1,r), (r,H-r-1), (W-r-1,H-r-1)
          return `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,${r})*lt(Y,${r})*gt(hypot(X-${r},Y-${r}),${r}),0,if(gt(X,${pw-r-1})*lt(Y,${r})*gt(hypot(X-${pw-r-1},Y-${r}),${r}),0,if(lt(X,${r})*gt(Y,${ph-r-1})*gt(hypot(X-${r},Y-${ph-r-1}),${r}),0,if(gt(X,${pw-r-1})*gt(Y,${ph-r-1})*gt(hypot(X-${pw-r-1},Y-${ph-r-1}),${r}),0,255))))'`;
        };

        const filters: string[] = [];

        // Left panel
        if (cornerR > 0) {
          filters.push(`color=c=white:s=${lp.w}x${lp.h}:d=0.04,format=yuva420p,${roundGeq(lp.w, lp.h)},loop=loop=-1:size=1[left_mask]`);
          filters.push(`[0:v]scale=${lp.w}:${lp.h}${dimLeft}[left_scaled]`);
          filters.push(`[left_scaled][left_mask]alphamerge[left]`);
        } else {
          filters.push(`[0:v]scale=${lp.w}:${lp.h}${dimLeft}[left]`);
        }

        // Mascot panel (never rounded)
        filters.push(`[1:v]scale=${mp.w}:${mp.h}[mascot]`);

        // Right panel
        if (cornerR > 0) {
          filters.push(`color=c=white:s=${rp.w}x${rp.h}:d=0.04,format=yuva420p,${roundGeq(rp.w, rp.h)},loop=loop=-1:size=1[right_mask]`);
          filters.push(`[2:v]scale=${rp.w}:${rp.h}${dimRight}[right_scaled]`);
          filters.push(`[right_scaled][right_mask]alphamerge[right]`);
        } else {
          filters.push(`[2:v]scale=${rp.w}:${rp.h}${dimRight}[right]`);
        }

        // Canvas: Pexels background video or solid color
        if (opts.bgInputIdx != null) {
          filters.push(`[${opts.bgInputIdx}:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},fps=${fps},setsar=1/1[canvas]`);
        } else {
          filters.push(`color=c=${padColor}:s=${outW}x${outH}:d=1:r=${fps}[canvas]`);
        }
        filters.push(
          `[canvas][left]overlay=x=${lp.x}:y=${lp.y}:format=auto[c1]`,
          `[c1][mascot]overlay=x=${mp.x}:y=${mp.y}[c2]`,
          `[c2][right]overlay=x=${rp.x}:y=${rp.y}:format=auto[c3]`,
        );

        // ── Score counter overlay (top center) ──
        const escDt = (s: string) => s.replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/%/g, '%%');
        const hasScore = leftName && rightName && (scoreLeft > 0 || scoreRight > 0);
        if (hasScore) {
          const scoreText = `${escDt(leftName)}  ${scoreLeft} \\: ${scoreRight}  ${escDt(rightName)}`;
          const scoreFontSize = Math.round(outW * 0.025);
          const scoreY = Math.round(outH * 0.01);
          // Score pill background + text
          filters.push(
            `[c3]drawtext=text='${scoreText}':fontsize=${scoreFontSize}:fontcolor=white:fontfile=/Windows/Fonts/arialbd.ttf:x=(w-text_w)/2:y=${scoreY}:box=1:boxcolor=black@0.6:boxborderw=12[c4]`
          );
        } else {
          filters.push(`[c3]null[c4]`);
        }

        // ── Round label overlay (brief banner) ──
        if (roundLabel) {
          const rlText = escDt(roundLabel.toUpperCase());
          const rlFontSize = Math.round(outW * 0.028);
          const rlY = hasScore ? Math.round(outH * 0.06) : Math.round(outH * 0.01);
          filters.push(
            `[c4]drawtext=text='${rlText}':fontsize=${rlFontSize}:fontcolor=#FFD700:fontfile=/Windows/Fonts/arialbd.ttf:x=(w-text_w)/2:y=${rlY}:box=1:boxcolor=black@0.5:boxborderw=8[c5]`
          );
        } else {
          filters.push(`[c4]null[c5]`);
        }

        // ── Sticker overlay (from media library) ──
        if (opts.stickerInputIdx != null) {
          const stSz = opts.stickerSize || Math.round(outW * 0.12);
          // Position sticker in bottom-right of active panel area (above mascot)
          const stX = Math.round(outW * 0.78);
          const stY = Math.round(outH * 0.40);
          filters.push(
            `[${opts.stickerInputIdx}:v]scale=${stSz}:${stSz}:force_original_aspect_ratio=decrease,format=rgba[stk]`,
            `[c5][stk]overlay=x=${stX}:y=${stY}:format=auto:enable='between(t,0.2,999)'[c6]`
          );
        } else {
          filters.push(`[c5]null[c6]`);
        }

        filters.push(`[c6]fps=${fps},setsar=1/1,format=yuv420p[out]`);
        return filters.join(';');
      }

      // ── Generate a round title card clip (e.g. "ROUND 1: INDEPENDENCE") ──
      async function generateRoundCard(text: string, duration: number, outPath: string): Promise<void> {
        const escDt = (s: string) => s.replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/%/g, '%%');
        const titleSize = Math.round(w * 0.04);
        const inputArgs: string[] = [];
        let bgFilter: string;
        if (compBgVideoPath) {
          inputArgs.push('-stream_loop', '-1', '-i', compBgVideoPath);
          bgFilter = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},setsar=1/1[bg]`;
        } else {
          inputArgs.push('-f', 'lavfi', '-i', `color=c=${padColor}:s=${w}x${h}:d=${duration}:r=${fps}`);
          bgFilter = `[0:v]null[bg]`;
        }
        const filter = [
          bgFilter,
          `[bg]drawtext=text='${escDt(text.toUpperCase())}':fontsize=${titleSize}:fontcolor=#FFD700:fontfile=/Windows/Fonts/arialbd.ttf:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=20[out]`,
        ].join(';');
        await execFileAsync(ffmpeg, [
          ...inputArgs,
          '-filter_complex', filter,
          '-map', '[out]',
          '-t', duration.toFixed(3),
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000',
          '-an', '-y', outPath,
        ], { timeout: 30_000 });
      }

      // Step 1: Create individual clip videos from images or use video clips directly
      const fps = 24;
      // Track last known left/right images for comparison mode carry-forward
      let lastLeftImage = '';
      let lastRightImage = '';

      // ── Comparison mode: pre-compute scores and round labels per segment ──
      const compLeftName = comparisonItems?.left?.name || '';
      const compRightName = comparisonItems?.right?.name || '';
      const compIsWinnerMode = comparisonItems?.type === 'winner';
      let runningScoreLeft = 0;
      let runningScoreRight = 0;
      // Pre-scan to build score-at-each-segment and detect round transitions
      const segScores: Array<{ left: number; right: number }> = [];
      const segRoundLabels: Array<string> = [];
      let currentRound = 0;
      let prevSideGroup = ''; // track left/right group transitions for round detection
      for (const seg of merged) {
        const side = (seg.side || 'both') as string;
        // Detect round labels from segment text: [Round N: Topic] was stripped from TTS but still in original text markers
        // We check the texts array for round markers that may have survived in prompts
        const roundMatch = seg.texts.join(' ').match(/round\s+(\d+)/i);
        let roundLabel = '';

        // Auto-detect round transitions: a new round starts when we enter 'left' from 'both' or from a winner
        const sideGroup = (side === 'left' || side === 'win-left') ? 'left' : (side === 'right' || side === 'win-right') ? 'right' : 'both';
        if (sideGroup === 'left' && prevSideGroup !== 'left') {
          // Entering left side = start of a new round
          currentRound++;
          const topicWords = seg.texts[0]?.replace(/\[.*?\]/g, '').trim().split(/\s+/).slice(0, 3).join(' ') || '';
          roundLabel = `Round ${currentRound}`;
          if (topicWords) roundLabel += `: ${topicWords}`;
        }
        if (roundMatch) roundLabel = `Round ${roundMatch[1]}`;
        prevSideGroup = sideGroup;

        if (side === 'win-left') runningScoreLeft++;
        if (side === 'win-right') runningScoreRight++;
        segScores.push({ left: runningScoreLeft, right: runningScoreRight });
        segRoundLabels.push(roundLabel);
      }

      // ── Media library: pre-load stickers and SFX for comparison overlays ──
      interface MediaLibRow { id: string; name: string; type: string; filename: string; filepath: string; url: string; trigger_tags: string; mime_type: string; }
      const mediaLibDir = path.resolve(process.env.ASSETS_DIR || './assets', 'media-library');
      // Map side → context tags for media library matching
      const sideContextMap: Record<string, string[]> = {
        'left': ['left', 'point'],
        'right': ['right', 'point'],
        'both': ['both', 'versus', 'intro'],
        'win-left': ['winner', 'win-left', 'victory'],
        'win-right': ['winner', 'win-right', 'victory'],
      };
      // Pre-query all media items and build side-based lookup
      const allMedia = isComparison ? dbAll<MediaLibRow>('SELECT * FROM media_library') : [];
      const stickerForSide: Record<string, string | null> = {};
      const sfxForSide: Record<string, string | null> = {};
      for (const side of Object.keys(sideContextMap)) {
        const tags = sideContextMap[side];
        // Find best sticker (highest trigger_tags overlap)
        let bestSticker: { path: string; overlap: number } | null = null;
        let bestSfx: { path: string; overlap: number } | null = null;
        for (const m of allMedia) {
          let trigTags: string[] = [];
          try { trigTags = (JSON.parse(m.trigger_tags) as string[]).map(t => t.toLowerCase()); } catch {}
          const overlap = tags.filter(t => trigTags.includes(t)).length;
          if (overlap === 0) continue;
          const fpath = path.join(mediaLibDir, m.filename);
          if (!fs.existsSync(fpath)) continue;
          if ((m.type === 'sticker' || m.type === 'icon') && (!bestSticker || overlap > bestSticker.overlap)) {
            bestSticker = { path: fpath, overlap };
          }
          if (m.type === 'sfx' && (!bestSfx || overlap > bestSfx.overlap)) {
            bestSfx = { path: fpath, overlap };
          }
        }
        stickerForSide[side] = bestSticker?.path || null;
        sfxForSide[side] = bestSfx?.path || null;
      }
      // Also find "final/champion" sticker and SFX
      let championSticker: string | null = null;
      let championSfx: string | null = null;
      for (const m of allMedia) {
        let trigTags: string[] = [];
        try { trigTags = (JSON.parse(m.trigger_tags) as string[]).map(t => t.toLowerCase()); } catch {}
        if (!trigTags.includes('champion') && !trigTags.includes('final')) continue;
        const fpath = path.join(mediaLibDir, m.filename);
        if (!fs.existsSync(fpath)) continue;
        if ((m.type === 'sticker' || m.type === 'icon') && !championSticker) championSticker = fpath;
        if (m.type === 'sfx' && !championSfx) championSfx = fpath;
      }
      // Track SFX events: { time, sfxPath } to mix into final audio
      const sfxEvents: Array<{ time: number; sfxPath: string }> = [];
      if (isComparison && allMedia.length > 0) {
        res.write(JSON.stringify({ progress: true, step: 'preparing', detail: `Media library: ${allMedia.length} items loaded for overlays & SFX` }) + '\n');
      }

      // Track segment output index (may differ from i due to inserted round cards)
      let segFileIdx = 0;

      for (let i = 0; i < merged.length; i++) {
        const seg = merged[i];
        const duration = Math.max((seg.endTime - seg.startTime) / speedFactor, 0.5);
        const segOut = path.join(concatDir, `seg_${String(segFileIdx).padStart(3, '0')}.mp4`);
        segFileIdx++;

        // ── Video clip: scale/trim to target duration and resolution (standard mode only) ──
        if (seg.videoFilename && !(isComparison && mascotPath)) {
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
            `[scaled]pad=w=${w}:h=${h}:x=(ow-iw)/2:y=(oh-ih)/2:color=${padColor}[padded]`,
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

        // ── Comparison mode: 3-panel composition with score + round cards ──
        if (isComparison && mascotPath) {
          // Resolve panel media: could be image or video (Pexels clips)
          const panelFile = seg.videoFilename || seg.imageFilename;
          let imgPath = path.join(imageDir, path.basename(panelFile));
          if (!fs.existsSync(imgPath)) imgPath = path.join(videoDir, path.basename(panelFile));
          if (!fs.existsSync(imgPath)) {
            res.write(JSON.stringify({ progress: true, step: 'error', detail: `Media not found: ${panelFile}` }) + '\n');
            continue;
          }

          // Insert round title card before this segment if it starts a new round
          const roundLabel = segRoundLabels[i];
          if (roundLabel && compIsWinnerMode) {
            const cardOut = path.join(concatDir, `seg_${String(segFileIdx).padStart(3, '0')}.mp4`);
            segFileIdx++;
            res.write(JSON.stringify({ progress: true, step: 'encoding', detail: `Round card: ${roundLabel}` }) + '\n');
            try {
              await generateRoundCard(roundLabel, 0.8, cardOut);
            } catch (err) {
              console.warn('[assemble] Round card generation failed:', (err as Error).message);
            }
          }

          // Update tracked left/right images
          const side = (seg.side || 'both') as 'left' | 'right' | 'both' | 'win-left' | 'win-right';
          if (side === 'left' || side === 'both' || side === 'win-left') lastLeftImage = imgPath;
          if (side === 'right' || side === 'both' || side === 'win-right') lastRightImage = imgPath;

          const leftImg = (side === 'right' || side === 'win-right') ? lastLeftImage : imgPath;
          const rightImg = (side === 'left' || side === 'win-left') ? lastRightImage : imgPath;

          const blankPath = path.join(concatDir, 'blank.png');
          if (!fs.existsSync(blankPath)) {
            await execFileAsync(ffmpeg, [
              '-f', 'lavfi', '-i', `color=c=${padColor}:s=640x1080:d=0.04`,
              '-frames:v', '1', '-y', blankPath,
            ], { timeout: 10_000 });
          }

          const finalLeft = leftImg && fs.existsSync(leftImg) ? leftImg : blankPath;
          const finalRight = rightImg && fs.existsSync(rightImg) ? rightImg : blankPath;

          // Determine if this is the final reveal segment (last segment with win side)
          const isFinalReveal = (side === 'win-left' || side === 'win-right') && i === merged.length - 1;

          const score = segScores[i] || { left: 0, right: 0 };
          res.write(JSON.stringify({ progress: true, step: 'encoding', detail: `Comparison clip ${i + 1}/${merged.length} (${duration.toFixed(1)}s) [${side}] Score: ${compLeftName} ${score.left}-${score.right} ${compRightName} via Remotion...` }) + '\n');

          // Pick mascot variant based on which side is active
          const pickMascot = (p: string) => p && fs.existsSync(p) ? p : mascotPath;
          let activeMascot = mascotPath;
          if (side === 'left') {
            activeMascot = pickMascot(mascotLeftPath);
          } else if (side === 'right') {
            activeMascot = pickMascot(mascotRightPath);
          } else if (side === 'both') {
            activeMascot = pickMascot(mascotBothPath);
          } else if (side === 'win-left' || side === 'win-right') {
            activeMascot = pickMascot(mascotWinPath);
          }

          // Show round label on the first segment of each new round (persists for that clip)
          const showRoundLabel = roundLabel || '';

          const segOut = path.join(concatDir, `seg_${String(segFileIdx).padStart(3, '0')}.mp4`);
          segFileIdx++;

          // ── Media library: resolve sticker overlay and SFX for this segment ──
          const showSticker = side === 'win-left' || side === 'win-right' || isFinalReveal;
          const stickerPath = showSticker ? (isFinalReveal && championSticker ? championSticker : stickerForSide[side] || null) : null;
          const sfxPath = (side === 'win-left' || side === 'win-right') ? (isFinalReveal && championSfx ? championSfx : sfxForSide[side] || null) : null;
          if (sfxPath) {
            sfxEvents.push({ time: seg.startTime / speedFactor, sfxPath });
          }

          // Media Types
          const isVidExt = (f: string) => /\.(mp4|webm|mov)$/i.test(f);
          const leftMediaType = isVidExt(finalLeft) ? 'video' : 'image';
          const rightMediaType = isVidExt(finalRight) ? 'video' : 'image';

          // Background setup
          let bgType: 'color' | 'image' | 'video' = 'color';
          let bgSrc = padColor;
          if (compBgVideoPath && fs.existsSync(compBgVideoPath)) {
            bgType = 'video';
            bgSrc = toHttpUrl(compBgVideoPath);
          }

          const totalFrames = Math.ceil(duration * fps);
          const sceneConfig: ComparisonSceneConfig = {
            durationInFrames: totalFrames,
            leftMediaSrc: toHttpUrl(finalLeft),
            leftMediaType,
            leftName: compLeftName || 'Left',
            leftScore: score.left,
            rightMediaSrc: toHttpUrl(finalRight),
            rightMediaType,
            rightName: compRightName || 'Right',
            rightScore: score.right,
            mascotSrc: toHttpUrl(activeMascot),
            layout: comparisonLayout || {
              left: { x: 0, y: 0, w: 50, h: 58 },
              mascot: { x: 20, y: 58, w: 60, h: 42 },
              right: { x: 50, y: 0, w: 50, h: 58 },
            },
            activeSide: side,
            roundLabel: showRoundLabel || undefined,
            roundPanels: !!compRoundPanels,
            bgType,
            bgSrc,
            stickerSrc: stickerPath ? toHttpUrl(stickerPath) : undefined,
          };

          await renderComparisonScene(segOut, sceneConfig, w, h);

          // Conform Remotion output to ensure identical properties (pixel format, timescale, SAR)
          const tmpOut = segOut + '.conform.mp4';
          const conformTimeout = Math.max(30_000, Math.ceil(duration) * 10_000);

          // If frame template overlay PNG is available, composite it on top
          if (frameOverlayPng && fs.existsSync(frameOverlayPng)) {
            await execFileAsync(ffmpeg, [
              '-i', segOut,
              '-i', frameOverlayPng,
              '-filter_complex', `[1:v]scale=${w}:${h}[frame];[0:v][frame]overlay=0:0:format=auto,setsar=1/1[out]`,
              '-map', '[out]',
              '-c:v', 'libx264',
              '-preset', 'superfast',
              '-crf', '23',
              '-pix_fmt', 'yuv420p',
              '-video_track_timescale', '90000',
              '-an',
              '-y',
              tmpOut,
            ], { timeout: conformTimeout });
          } else {
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
            ], { timeout: conformTimeout });
          }

          fs.renameSync(tmpOut, segOut);
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
            bgColor: bgColor || 'white',
          };
          await renderSceneClip(segOut, sceneConfig, w, h);

          // Conform Remotion output to ensure identical properties (pixel format, timescale, SAR)
          const tmpOut = segOut + '.conform.mp4';
          // Timeout scales with duration: 30s base + 10s per second of video
          const conformTimeout = Math.max(30_000, Math.ceil(duration) * 10_000);
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
          ], { timeout: conformTimeout });
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

      // ── Comparison mode: append subscribe CTA card at the end ──
      if (isComparison && compIsWinnerMode) {
        const ctaOut = path.join(concatDir, `seg_${String(segFileIdx).padStart(3, '0')}.mp4`);
        segFileIdx++;
        res.write(JSON.stringify({ progress: true, step: 'encoding', detail: 'Adding subscribe card...' }) + '\n');
        try {
          const escDt = (s: string) => s.replace(/'/g, "\u2019").replace(/:/g, '\\:').replace(/%/g, '%%');
          const ctaDuration = 2.0;
          const titleSize = Math.round(w * 0.035);
          const subSize = Math.round(w * 0.022);
          const ctaInputArgs: string[] = [];
          let ctaBgFilter: string;
          if (compBgVideoPath) {
            ctaInputArgs.push('-stream_loop', '-1', '-i', compBgVideoPath);
            ctaBgFilter = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},setsar=1/1[bg]`;
          } else {
            ctaInputArgs.push('-f', 'lavfi', '-i', `color=c=${padColor}:s=${w}x${h}:d=${ctaDuration}:r=${fps}`);
            ctaBgFilter = `[0:v]null[bg]`;
          }
          const ctaFilter = [
            ctaBgFilter,
            `[bg]drawtext=text='${escDt('What do YOU think?')}':fontsize=${titleSize}:fontcolor=white:fontfile=/Windows/Fonts/arialbd.ttf:x=(w-text_w)/2:y=(h/2)-${titleSize + 20}:box=1:boxcolor=black@0.4:boxborderw=12[t1]`,
            `[t1]drawtext=text='${escDt('Subscribe for more comparisons!')}':fontsize=${subSize}:fontcolor=#FF0000:fontfile=/Windows/Fonts/arialbd.ttf:x=(w-text_w)/2:y=(h/2)+20:box=1:boxcolor=black@0.3:boxborderw=10[out]`,
          ].join(';');
          await execFileAsync(ffmpeg, [
            ...ctaInputArgs,
            '-filter_complex', ctaFilter,
            '-map', '[out]',
            '-t', ctaDuration.toFixed(3),
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000',
            '-an', '-y', ctaOut,
          ], { timeout: 30_000 });
        } catch (err) {
          console.warn('[assemble] CTA card generation failed:', (err as Error).message);
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

      // Step 3.5: Burn subtitles (if enabled)
      let videoInput = videoOnly;
      if (subtitleStyle?.enabled && segments.some(s => s.text?.trim())) {
        res.write(JSON.stringify({ progress: true, step: 'subtitles', detail: 'Burning subtitles...' }) + '\n');

        // Build ASS subtitle file with custom styling
        const assAlignMap: Record<string, number> = { 'left': 1, 'center': 2, 'right': 3 };
        const posVertical = subtitleStyle.position === 'top' ? 8 : subtitleStyle.position === 'center' ? 5 : 2;
        const assAlign = (assAlignMap[subtitleStyle.alignment] || 2) + (posVertical - 2);
        // AN values: bottom-left=1, bottom-center=2, bottom-right=3, mid-left=4, mid-center=5, mid-right=6, top-left=7, top-center=8, top-right=9

        // Convert hex color to ASS BGR format: #RRGGBB -> &H00BBGGRR
        const hexToAssBgr = (hex: string) => {
          const c = hex.replace('#', '');
          const r = c.substring(0, 2);
          const g = c.substring(2, 4);
          const b = c.substring(4, 6);
          return `${b}${g}${r}`.toUpperCase();
        };

        const fontColor = `&H00${hexToAssBgr(subtitleStyle.fontColor)}`;
        const strokeColor = `&H00${hexToAssBgr(subtitleStyle.strokeColor)}`;
        const bgAlpha = Math.round((1 - subtitleStyle.bgOpacity) * 255).toString(16).toUpperCase().padStart(2, '0');
        const backColor = `&H${bgAlpha}${hexToAssBgr(subtitleStyle.bgColor)}`;
        const borderStyle = subtitleStyle.bgOpacity > 0 ? 3 : 1; // 3 = opaque box, 1 = outline+shadow
        const bold = subtitleStyle.fontWeight === 'bold' ? -1 : 0;
        const outline = subtitleStyle.strokeWidth;
        const marginV = subtitleStyle.position === 'top' ? subtitleStyle.marginBottom : subtitleStyle.marginBottom;
        const marginL = subtitleStyle.marginX;
        const marginR = subtitleStyle.marginX;

        const assHeader = [
          '[Script Info]',
          'ScriptType: v4.00+',
          `PlayResX: ${w}`,
          `PlayResY: ${h}`,
          'WrapStyle: 0',
          '',
          '[V4+ Styles]',
          'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
          `Style: Default,${subtitleStyle.fontFamily},${subtitleStyle.fontSize},${fontColor},${fontColor},${strokeColor},${backColor},${bold},0,0,0,100,100,0,0,${borderStyle},${outline},0,${posVertical + (assAlignMap[subtitleStyle.alignment] || 2) - 2},${marginL},${marginR},${marginV},1`,
          '',
          '[Events]',
          'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ].join('\n');

        // Convert seconds to ASS time format: H:MM:SS.cc
        const secToAssTime = (sec: number) => {
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          const s = sec % 60;
          return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
        };

        const events: string[] = [];
        for (const seg of segments) {
          if (!seg.text?.trim()) continue;
          const start = secToAssTime(seg.startTime / speedFactor);
          const end = secToAssTime(seg.endTime / speedFactor);
          let text = seg.text.replace(/\n/g, '\\N');
          if (subtitleStyle.uppercase) text = text.toUpperCase();

          // Animation effects via ASS override tags
          let effect = '';
          if (subtitleStyle.animation === 'fade') {
            effect = '{\\fad(300,200)}';
          } else if (subtitleStyle.animation === 'karaoke' || subtitleStyle.animation === 'word-highlight') {
            // Per-word karaoke timing: split text, distribute duration evenly
            const words = text.split(/\s+/);
            const segDur = (seg.endTime - seg.startTime) / speedFactor;
            const perWord = Math.floor((segDur * 100) / words.length); // centiseconds
            text = words.map(word => `{\\k${perWord}}${word}`).join(' ');
            if (subtitleStyle.animation === 'word-highlight') {
              // Use \kf for smooth fill
              text = text.replace(/\\k/g, '\\kf');
            }
            effect = '';
          }

          events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${effect}${text}`);
        }

        const assContent = assHeader + '\n' + events.join('\n') + '\n';
        const assPath = path.join(concatDir, 'subtitles.ass');
        fs.writeFileSync(assPath, assContent, 'utf-8');

        // Burn subtitles into video using the ass filter
        const subtitledVideo = path.join(concatDir, 'video_subtitled.mp4');
        // FFmpeg filter uses ':' as option separator — Windows drive letters break it.
        // Use relative path to avoid the colon entirely.
        const relAssPath = path.relative(process.cwd(), assPath).replace(/\\/g, '/');
        await execFileAsync(ffmpeg, [
          '-i', videoOnly,
          '-vf', `ass=${relAssPath}`,
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-an',
          '-y',
          subtitledVideo,
        ], { timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });

        videoInput = subtitledVideo;
        res.write(JSON.stringify({ progress: true, step: 'subtitles', detail: 'Subtitles burned successfully' }) + '\n');
      }

      // Step 3b: Generate SFX mix track if any SFX events exist
      let sfxMixPath: string | null = null;
      if (sfxEvents.length > 0) {
        res.write(JSON.stringify({ progress: true, step: 'sfx', detail: `Mixing ${sfxEvents.length} sound effects...` }) + '\n');
        sfxMixPath = path.join(concatDir, 'sfx_mix.mp3');
        // Build an FFmpeg command that overlays all SFX at their timestamps onto a silent track
        const sfxInputArgs: string[] = [];
        // Input 0: silent base track matching video duration
        sfxInputArgs.push('-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo,atrim=0:${audioDuration}`);
        // Add each SFX as an input
        for (const evt of sfxEvents) {
          sfxInputArgs.push('-i', evt.sfxPath);
        }
        // Build filter: delay each SFX to its timestamp and mix all together
        const sfxFilters: string[] = [];
        const mixInputs: string[] = ['[0:a]'];
        for (let si = 0; si < sfxEvents.length; si++) {
          const delayMs = Math.round(sfxEvents[si].time * 1000);
          sfxFilters.push(`[${si + 1}:a]adelay=${delayMs}|${delayMs},volume=0.7[sfx${si}]`);
          mixInputs.push(`[sfx${si}]`);
        }
        sfxFilters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0[sfxout]`);

        try {
          await execFileAsync(ffmpeg, [
            ...sfxInputArgs,
            '-filter_complex', sfxFilters.join(';'),
            '-map', '[sfxout]',
            '-c:a', 'libmp3lame', '-b:a', '128k',
            '-t', audioDuration.toFixed(3),
            '-y', sfxMixPath,
          ], { timeout: 60_000 });
          res.write(JSON.stringify({ progress: true, step: 'sfx', detail: `SFX mix created (${sfxEvents.length} effects)` }) + '\n');
        } catch (err) {
          console.warn('[assemble] SFX mix failed:', (err as Error).message);
          sfxMixPath = null;
        }
      }

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

      if (musicPath || sfxMixPath) {
        const mixParts: string[] = [];
        const mixInputs: string[] = ['-i', videoInput, '-i', audioPath];
        let inputIdx = 2;

        // Voice
        mixParts.push(`[1:a]volume=${vVol}[voice]`);
        const amixInputLabels = ['[voice]'];

        // Background music
        if (musicPath) {
          mixInputs.push('-i', musicPath);
          mixParts.push(`[${inputIdx}:a]aloop=loop=-1:size=2e+09,atrim=0:${audioDuration},afade=t=out:st=${Math.max(0, audioDuration - 3)}:d=3,volume=${mVol}[music]`);
          amixInputLabels.push('[music]');
          inputIdx++;
        }

        // SFX mix
        if (sfxMixPath) {
          mixInputs.push('-i', sfxMixPath);
          mixParts.push(`[${inputIdx}:a]volume=0.8[sfxtrack]`);
          amixInputLabels.push('[sfxtrack]');
          inputIdx++;
        }

        mixParts.push(`${amixInputLabels.join('')}amix=inputs=${amixInputLabels.length}:duration=first:dropout_transition=2[aout]`);

        const detailParts = [`voice (${Math.round(vVol * 100)}%)`];
        if (musicPath) detailParts.push(`music (${Math.round(mVol * 100)}%)`);
        if (sfxMixPath) detailParts.push(`SFX (${sfxEvents.length} effects)`);
        res.write(JSON.stringify({ progress: true, step: 'muxing', detail: `Mixing ${detailParts.join(' + ')}...` }) + '\n');

        await execFileAsync(ffmpeg, [
          ...mixInputs,
          '-filter_complex', mixParts.join(';'),
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-shortest',
          '-movflags', '+faststart',
          '-y',
          outputFile,
        ], { timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024 });
      } else {
        res.write(JSON.stringify({ progress: true, step: 'muxing', detail: 'Adding audio track...' }) + '\n');

        // Voice only (with optional volume adjustment)
        const ffArgs = ['-i', videoInput, '-i', audioPath];
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
    res.status(201).json({ id, name: name.trim(), templateId: finalTemplateId, currentStep: 'topics', status: 'draft', speed: 1.0, bgColor: 'white', createdAt: now, updatedAt: now });
  });

  // ── Pexels batch video search ──
  router.post('/pexels-batch', async (req: Request, res: Response) => {
    const { queries } = req.body as { queries: Array<{ timestamp: string; query: string; side?: string }> };
    if (!queries?.length) { res.status(400).json({ error: 'queries required' }); return; }
    if (!process.env.PEXELS_API_KEY) { res.status(400).json({ error: 'PEXELS_API_KEY not configured' }); return; }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    try {
      const videos = await pexelsBatch(queries, (msg) => {
        res.write(JSON.stringify(msg) + '\n');
      });
      res.write(JSON.stringify({ done: true, videos }) + '\n');
    } catch (err) {
      res.write(JSON.stringify({ error: (err as Error).message }) + '\n');
    }
    res.end();
  });

  router.get('/projects', (_req: Request, res: Response) => {
    const rows = dbAll<Record<string, unknown>>(
      `SELECT s.id, s.name, s.template_id, s.current_step, s.topic, s.status, s.audio_duration, s.result_filename, s.segments, s.metadata_desc, s.metadata_tags, s.created_at, s.updated_at, s.thumbnail_url, s.thumbnail_prompt, s.speed, s.bg_color,
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
        bgColor: (r.bg_color as string) || 'white',
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
      thumbnailBgColor: row.thumbnail_bg_color || '',
      bgColor: row.bg_color || 'black',
      speed: typeof row.speed === 'number' ? row.speed : 1.0,
      subtitleStyle: row.subtitle_style ? JSON.parse(row.subtitle_style as string) : null,
      videoMode: (row as any).video_mode || 'standard',
      mascotPrompt: (row as any).mascot_prompt || '',
      mascotImage: (row as any).mascot_image || '',
      mascotImageLeft: (row as any).mascot_image_left || '',
      mascotImageRight: (row as any).mascot_image_right || '',
      mascotImageBoth: (row as any).mascot_image_both || '',
      mascotImageWin: (row as any).mascot_image_win || '',
      comparisonItems: (() => { try { return JSON.parse(((row as any).comparison_items as string) || '{}'); } catch { return {}; } })(),
      compMediaSource: (row as any).comp_media_source || 'flow',
      compRoundPanels: !!(row as any).comp_round_panels,
      compBgSource: (row as any).comp_bg_source || 'color',
      compBgQuery: (row as any).comp_bg_query || '',
      frameTemplateId: (row as any).frame_template_id || '',
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
      thumbnailUrl: 'thumbnail_url', thumbnailPrompt: 'thumbnail_prompt', thumbnailBgColor: 'thumbnail_bg_color',
      bgColor: 'bg_color',
      speed: 'speed',
      videoMode: 'video_mode',
      mascotPrompt: 'mascot_prompt',
      mascotImage: 'mascot_image',
      mascotImageLeft: 'mascot_image_left',
      mascotImageRight: 'mascot_image_right',
      mascotImageBoth: 'mascot_image_both',
      mascotImageWin: 'mascot_image_win',
      compMediaSource: 'comp_media_source',
      compRoundPanels: 'comp_round_panels',
      compBgSource: 'comp_bg_source',
      compBgQuery: 'comp_bg_query',
      frameTemplateId: 'frame_template_id',
    };
    const jsonCols: Record<string, string> = {
      transcriptEntries: 'transcript_entries', prompts: 'prompts',
      generatedImages: 'generated_images', segments: 'segments',
      metadataTags: 'metadata_tags', stageParts: 'stage_parts',
      subtitleStyle: 'subtitle_style',
      comparisonItems: 'comparison_items',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(colMap)) {
      if (body[k] !== undefined) { sets.push(`${col} = ?`); params.push(body[k]); }
    }
    for (const [k, col] of Object.entries(jsonCols)) {
      if (body[k] !== undefined) {
        sets.push(`${col} = ?`);
        // If the value is already a string (pre-serialized JSON), store as-is to avoid double-encoding
        params.push(typeof body[k] === 'string' ? body[k] : JSON.stringify(body[k]));
      }
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
