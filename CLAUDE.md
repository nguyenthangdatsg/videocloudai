# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start all workspaces (Turbo parallel: server + web)
npm run build        # Build all workspaces
npm run clean        # Remove all dist/ directories

# Setup
node scripts/setup.js          # Validate environment, create output directories
npx ts-node scripts/seed-library.ts  # Seed scene library with sample data

# Individual workspaces
npm run dev --workspace=apps/server
npm run dev --workspace=apps/web
```

No test suite is configured. Validation is manual via UI or API calls.

**Dev URLs:**
- Frontend: http://localhost:5174
- Backend API: http://localhost:3002/api
- SSE stream: http://localhost:3002/api/events

## Architecture

### High-Level Pipeline

```
Topic Selection (AI-generated or manual)
  -> Script Generation (LLM, chunked for long videos)
  -> TTS Audio (edge-tts) + Whisper Transcription -> Timestamped Segments
  -> Image Prompt Generation (LLM, per-segment, with validation & retry)
  -> Image/Video Generation (AI providers / Pexels stock / upload)
  -> Timeline Assembly (motion effects, audio mix, subtitle styling)
  -> Metadata Generation (title, description, tags, thumbnail)
  -> Final Video Assembly (Remotion + FFmpeg, H.264/AAC MP4)
```

### Monorepo Layout

- `apps/server` — Express 5 + TypeScript REST API, SQLite, job queue, Remotion renderer
- `apps/web` — React 18 + Vite + Tailwind frontend
- `packages/shared` — TypeScript types only (no runtime deps)
- `packages/core` — ScriptProcessor, PromptEnhancer, SceneReuseEngine
- `packages/ffmpeg` — VideoAssembler, platform encoder, motion/subtitle filter builders

## Storyboard Pipeline (Primary Feature)

The storyboard is an 8-step wizard for creating AI-generated videos:

### Steps

| Step | Name | Purpose |
|------|------|---------|
| 0 | **Topics** | Generate or select a video topic via LLM |
| 1 | **Script** | Generate narration script (chunked for >200s videos) |
| 2 | **Audio** | TTS generation (edge-tts) + Whisper transcription -> timestamped segments |
| 3 | **Prompts** | Generate image prompts per segment (LLM with validation & retry) |
| 4 | **Images** | Generate images (AI providers), videos (Flow), or fetch Pexels stock |
| 5 | **Timeline** | Map media to segments, configure motion effects, audio mix, subtitles |
| 6 | **Metadata** | Generate title, description, tags, thumbnail prompt |
| 7 | **Assemble** | Render final MP4 via Remotion + FFmpeg |

### Video Modes

- **Standard** — Single video track with motion effects and subtitles
- **Comparison** — Side-by-side layout (left item vs right item) with central mascot character. Supports `difference` and `winner` comparison types. Uses ComparisonScene Remotion component with 3-panel layout.

### Template & Prompt System

Templates drive generation at all stages. A template contains:
- `template_text` — Raw markdown with channel knowledge and per-stage system prompts
- `stage_prompts` — Extracted system prompts per stage: `{ topics, script, prompts, metadata }`
- `visual_style` — e.g., "stick figure", "photorealistic", "anime"
- `mascot_*` — Mascot images for comparison mode

**Prompt resolution order** (per stage):
1. User-edited Stage Prompt (StagePromptEditor's Full Prompt) — highest priority
2. Linked template's `stage_prompts[stage]`
3. Parsed `template_text` section (e.g., `imagePromptSystemPrompt`)
4. Hardcoded default prompt

**StagePromptEditor** has two views (Parts / Full Prompt) — both derive from the same `value` string (single source of truth). Parts are decomposed via `--- SECTION NAME ---` headers.

### Prompt Generation Details

- Segments are batched (40 per LLM call)
- Each prompt is validated: min length, no meta-commentary, format match, visual style inclusion
- Failed prompts retry in batch (2x), then individually (up to 20x with exponential backoff)
- Pexels mode: generates search queries instead of image prompts
- Comparison mode: prompts tagged with `side: 'left' | 'right' | 'both' | 'win-left' | 'win-right'`
- Aspect ratio suffix appended to all prompts

### Assembly Pipeline

1. Render per-segment clips via Remotion (SceneClip or ComparisonScene)
2. Concat clips via FFmpeg
3. Burn subtitles (ASS format with custom styling)
4. Mix audio: voice + background music (looped, 3s fade-out) + SFX
5. Mux final MP4 (H.264, AAC 192k, movflags +faststart)

## Backend (apps/server)

### Key Patterns

- **Route handlers** only parse requests and call services; all logic lives in `src/services/`
- **Job queue** (`src/queue/`) uses p-queue + EventEmitter; jobs persisted to SQLite, resumed on restart
- **SQLite** runs in WAL mode with foreign keys on; use `better-sqlite3` synchronous API
- **AI providers** (`src/providers/`) share `key-pool.ts` for multi-key rotation with rate-limit/quota detection
- **SSE events** emitted by queue, streamed at `GET /api/events`
- **NDJSON streaming** for long operations (prompt gen, TTS, assembly) — frontend reads with `readNDJSON()`

### Routes (20 route files)

| Route File | Endpoints | Purpose |
|------------|-----------|---------|
| `storyboard.routes.ts` | `/api/storyboard/*` | Storyboard projects, templates, generation (topics/script/TTS/prompts/metadata/assembly) |
| `videos.routes.ts` | `/api/videos/*` | Video project CRUD, scene generation, assembly |
| `library.routes.ts` | `/api/library/*` | Scene library browse/search/reuse matching |
| `generation.routes.ts` | `/api/generations/*` | AI generation requests, provider list |
| `queue.routes.ts` | `/api/queue/*` | Job queue status, cancel, delete |
| `script.routes.ts` | `/api/script/*` | Script generation, hook generation |
| `tts.routes.ts` | `/api/tts/*` | Text-to-speech, subtitle sync, voice list |
| `image.routes.ts` | `/api/image/*` | Image generation, library, prompt cache |
| `music.routes.ts` | `/api/music/*` | Jamendo/Epidemic Sound search, download, upload |
| `export.routes.ts` | `/api/export/*` | Platform export (TikTok, YouTube, Instagram) |
| `import.routes.ts` | `/api/import/*` | Import videos via yt-dlp |
| `batch.routes.ts` | `/api/batch/*` | Batch video variations |
| `drama.routes.ts` | `/api/drama/*` | Drama studio (characters, episodes, locations, scenes, shots) |
| `channels.routes.ts` | `/api/channels/*` | Social media channel management with OAuth |
| `distributions.routes.ts` | `/api/distributions/*` | Schedule video distributions |
| `oauth.routes.ts` | `/api/oauth/*` | OAuth flow for platform auth |
| `upload.routes.ts` | `/api/upload/*` | Queue platform uploads |
| `settings.routes.ts` | `/api/settings/*` | Configuration, API key management, service testing |
| `media-library.routes.ts` | `/api/media-library/*` | Stickers, icons, animations, SFX |
| `frame-video-library.routes.ts` | `/api/frame-video-library/*` | Frame video templates (comparison layouts) |

### Services (17 core services)

| Service | Purpose |
|---------|---------|
| `llm.service.ts` | Multi-provider LLM dispatcher with fallback chain (Gemini -> Groq -> Anthropic -> OpenRouter -> Cerebras -> Grok -> OpenAI) |
| `narration.service.ts` | edge-tts (50+ voices, 18 languages), rate/pitch control, MD5 caching |
| `subtitle.service.ts` | Whisper speech-to-text, SRT/VTT, subtitle styling, FFmpeg burn-in |
| `video.service.ts` | Project assembly, editing, splitting, trimming, cropping |
| `generation.service.ts` | Prompt enhancement, MD5 checksum caching, provider selection |
| `script-gen.service.ts` | Script generation, hook generation, description rewriting |
| `image-providers.ts` | Google Gemini Image, HuggingFace, Pollinations, Replicate |
| `pexels.service.ts` | Stock video search, quality selection, SHA256 caching |
| `music.service.ts` | Jamendo & Epidemic Sound search, download, local upload |
| `remotion-renderer.service.ts` | Render Intro/Outro, SceneClip, ComparisonScene via Remotion |
| `scene-library.service.ts` | Scene reuse with weighted scoring |
| `import.service.ts` | yt-dlp video import, transcoding |
| `settings.service.ts` | Key-value config, masked API key display |
| `channel.service.ts` | Platform channel management |
| `distribution.service.ts` | Video distribution scheduling |
| `platform-upload.service.ts` | YouTube/TikTok/Instagram uploads |
| `drama.service.ts` | Drama series with characters, episodes, locations |

### Remotion Compositions

| Composition | Resolution | Purpose |
|-------------|-----------|---------|
| Intro | 1080x1920 | Creator name, tagline (3s) |
| Outro | 1080x1920 | CTA, creator name (3s) |
| SceneClip | Flexible | Image + motion effect + narration |
| ComparisonScene | 1080x1920 | Left/right media + mascot + highlights |

### LLM Provider Fallback Chain

Gemini (gemini-2.5-flash) -> Groq (llama-3.3-70b) -> Anthropic (claude-sonnet) -> OpenRouter (llama-3.3-70b:free) -> Cerebras (llama-3.3-70b) -> Grok (grok-3-mini) -> OpenAI (gpt-4o-mini)

Key pool rotates keys per provider with status tracking: active, rate-limited (60s), quota-exceeded (3600s), error (30s).

## Frontend (apps/web)

### Key Patterns

- **All user-visible strings must use translation keys** via `react-i18next` — add to both `src/i18n/locales/en.json` and `vi.json`, then use `const { t } = useTranslation()`
- **Zustand** (`src/store/index.ts`): active video, live job map from SSE, notifications, sidebar state
- **ImageGenStore** (`src/store/image-generation.ts`): manages image/video generation tasks, prompt caching, Chrome extension integration (Han2YT_flow_* events)
- **TanStack Query** for server state; API client at `src/lib/api.ts` (993 lines, all REST endpoints)
- **5 themes** via CSS custom properties in `index.css`: midnight (default), ocean, emerald, sunset, daylight. Persisted to localStorage `vcai-theme`
- Language (en/vi) saved to localStorage key `lang`
- **NDJSON streaming** helper `readNDJSON()` for long-running operations
- **SSE** via `useSSE` hook for real-time job updates (job:completed, job:failed, job:progress)

### Pages & Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Dashboard | Video stats, import UI, active jobs |
| `/storyboard` | StoryboardList | List/create storyboard projects + template management |
| `/storyboard/:id` | Storyboard | 8-step storyboard editor |
| `/drama` | DramaList | Drama studio projects (video mode) |
| `/drama/:id` | DramaProject | Drama editor with episodes, characters, scenes |
| `/image-drama` | DramaList | Drama studio (image mode) |
| `/script` | ScriptEditor | Write/generate scripts |
| `/library` | SceneLibrary | Browse reusable scenes |
| `/media-library` | MediaLibrary | Stickers, icons, animations, SFX |
| `/frame-video-library` | FrameVideoLibrary | Frame video templates (comparison layouts) |
| `/editor` | VideoEditor | Video timeline editor |
| `/batch` | BatchGenerator | Batch video variations |
| `/queue` | QueueManager | Job queue monitoring |
| `/tts` | TextToSpeech | TTS narration generation |
| `/transcribe` | Transcribe | Audio/video transcription |
| `/channels` | Channels | Social media channel management |
| `/distributions` | Distributions | Video upload scheduling |
| `/settings` | Settings | API keys, voices, models, theme, menu order |

### Storyboard Component Structure

```
pages/storyboard/
  Storyboard.tsx          — Main editor (all state, handlers, context provider)
  StoryboardContext.tsx    — Context type definition
  utils.ts                — Time parsing, transcript merging, side detection
  types.ts                — WorkflowStep, TranscriptEntry, StagePart
  components/
    TopicsStep.tsx         — Topic generation + selection
    ScriptStep.tsx         — Script generation + editing
    AudioStep.tsx          — TTS + Whisper transcription + segment editing
    PromptsStep.tsx        — Image prompt generation + editing
    ImagesStep.tsx         — Image/video generation or Pexels fetch
    TimelineStep.tsx       — Timeline editor with motion effects + audio
    MetadataStep.tsx       — Title, description, tags, thumbnail
    AssembleStep.tsx       — Final video rendering
    StagePromptEditor.tsx  — Per-stage system prompt editor (Parts/Full tabs)
    PromptPartBlock.tsx    — Individual prompt part block
    ComparisonSetup.tsx    — Comparison mode config (items, mascot, frame template)
    ComparisonLayoutPanel.tsx — Panel layout customization
    StepAccordion.tsx      — Collapsible step wrapper
    AdvancedToggle.tsx     — Show/hide advanced options
    CompletedStepsSummary.tsx — Summary of completed steps
  flows/comparison/
    ComparisonPromptsStep.tsx — Comparison-specific prompt generation
    ComparisonScriptStep.tsx  — Comparison-specific script generation
```

### Key UI Components

- **Sidebar** — Navigation with reorderable menu items, active job indicator
- **TopBar** — Title, theme toggle, language switcher, notification bell
- **ThemeToggle** — 5 theme previews (midnight, ocean, emerald, sunset, daylight)
- **ToastContainer** — Auto-dismissing notifications (max 4 visible)
- **ErrorBoundary** — Catches React errors with reload/navigate options

### Chrome Extension Integration

The `Han2YT` Chrome extension enables browser-based AI generation:
- Communicates via custom DOM events: `Han2YT_flow_progress`, `Han2YT_flow_image`, `Han2YT_flow_done`, `Han2YT_flow_error`
- Supports Google Flow, Grok, ChatGPT as generation providers
- `ImageGenStore` manages extension communication and prompt caching

## Scene Reuse Scoring (packages/core)

Weighted match against library: mood 35%, tags 20%, style 20%, atmosphere 15%, keywords 10%. Minimum threshold: 0.3.

## FFmpeg Effects (packages/ffmpeg)

All motion via `zoompan` filter (no GPU): `ken-burns-in`, `ken-burns-out`, `pan-left`, `pan-right`, `pan-up`, `pan-down`, `slow-zoom`, `drift`, `handheld`, `static`. Subtitle burn-in via ASS filter with animation support (fade, karaoke, word-highlight).

## Database

SQLite at `database/videocloudai.db`. Schema in `apps/server/src/db/schema.ts`, auto-created on server start.

### Key Tables

| Table | Purpose |
|-------|---------|
| `videos` | Video projects (script, scenes, format, resolution, narration, music) |
| `scenes` | Library scenes (mood, style, camera, atmosphere, reuse keywords) |
| `assets` | Generated assets (type, dimensions, duration, usage count) |
| `prompts` | Prompt cache (original, enhanced, MD5 checksum for dedup) |
| `generations` | AI generation requests (provider, status, retries) |
| `video_clips` | Timeline clips linking video -> asset with transitions/motion |
| `jobs` | Job queue (type, status, priority, payload, retries, progress) |
| `storyboard_templates` | Per-niche templates with stage prompts, visual style, mascot assets |
| `storyboards` | Storyboard projects linked to templates |
| `media_library` | Stickers, icons, animations, SFX with trigger tags |
| `frame_video_library` | Frame video templates (comparison layouts, HTML support) |
| `image_library` | Cached generated images |
| `image_prompt_cache` | Prompt hash -> cached filename dedup |
| `channels` | Social media accounts with OAuth tokens |
| `distributions` | Scheduled uploads |
| `batch_jobs` | Batch variation metadata |
| `tags` | Global tag registry |
| `settings` | Key-value config store |

Delete the `.db` file to reset; cached files in `assets/`, `cache/`, `renders/` are unaffected.

## Environment

Key `.env` variables (see `.env.example` for full list):

```env
PORT=3002
CORS_ORIGIN=http://localhost:5174
DATABASE_PATH=./database/videocloudai.db
GOOGLE_FLOW_API_KEY=...
GOOGLE_IMAGEFX_API_KEY=...
GOOGLE_PROJECT_ID=...
GROQ_API_KEY=...
ANTHROPIC_API_KEY=...
OPENROUTER_API_KEY=...
PEXELS_API_KEY=...
MAX_CONCURRENT_JOBS=3
FFMPEG_PATH=ffmpeg
WHISPER_MODEL=tiny
EDGE_TTS_VOICE=en-US-GuyNeural
```

**External runtime dependencies** (must be on PATH):
- `ffmpeg` / `ffprobe`
- Python 3.8+ with `edge-tts` and `openai-whisper` packages
- `yt-dlp` (for video import feature)
