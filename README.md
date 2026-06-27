# VideoCloudAI — AI Cinematic Content Factory

A production-grade, CPU-only AI-powered short-form video production system.
Orchestrates cloud AI generation, reuses assets intelligently, and assembles cinematic
TikTok/Shorts/Reels automatically using FFmpeg + Remotion.

## Architecture

```
User Topic
  → LLM Script Generation (Groq / Cerebras / Google)
  → Edge-TTS Narration + Whisper Transcription
  → LLM Image Prompt Generation
  → Cloud AI Image/Video Generation (Google Flow / ImageFX)
  → Timeline Auto-Match (transcript ↔ images)
  → Remotion Motion Effects (zoom-in, pan, etc.)
  → FFmpeg Assembly (concat + audio mix + music)
  → Final Export (TikTok / YouTube Shorts / Reels)
```

## Key Features

- **Storyboard Workflow** — Topic → Script → Audio → Prompts → Images → Timeline → Assemble
- **Multi-Template System** — Per-niche templates with custom LLM prompts per stage
- **Remotion Effects** — Smooth CSS-based zoom/pan motion on image clips
- **Scene Reuse Engine** — Never regenerate what you already have
- **Prompt Enhancement** — Transforms simple prompts into cinematic AI prompts
- **AI Provider System** — Google Flow (video) + ImageFX (images)
- **Job Queue** — PQueue-based with retries, priorities, SSE live updates
- **Batch Generator** — Multiple variations from one template
- **Narration** — edge-tts with voice selection and audio caching
- **Subtitles** — Whisper CPU mode with SRT/VTT output
- **Background Music** — Epidemic Sound integration + local tracks
- **i18n** — Full English + Vietnamese UI translation

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind, Zustand, TanStack Query
- **Backend**: Node.js, Express 4, TypeScript, SQLite (better-sqlite3)
- **Rendering**: FFmpeg (bundled via Remotion) + Remotion for motion effects
- **AI**: Google Veo/Flow (video), Google Imagen/ImageFX (images)
- **LLM**: Groq, Cerebras, Google Gemini (configurable)
- **Narration**: edge-tts (Python)
- **Subtitles**: OpenAI Whisper CPU mode

## Prerequisites

1. **Node.js 20+** — https://nodejs.org
2. **Python 3.8+** — https://python.org
3. **Git** — https://git-scm.com

Install Python packages:
```bash
pip install edge-tts openai-whisper
```

> FFmpeg is **bundled** via `@remotion/compositor` — no separate install needed.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/nguyenthangdatsg/videocloudai.git
cd videocloudai

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — set your API keys (see Environment Variables below)

# 4. Run setup (creates output directories)
node scripts/setup.js

# 5. Start development (backend + frontend in parallel)
npm run dev
```

**Frontend**: http://localhost:5174
**Backend API**: http://localhost:3002/api
**SSE Events**: http://localhost:3002/api/events

## Commands

```bash
npm run dev                          # Start all workspaces (Turbo parallel)
npm run build                        # Build all workspaces
npm run clean                        # Remove all dist/ directories
npm run dev --workspace=apps/server  # Start backend only
npm run dev --workspace=apps/web     # Start frontend only
node scripts/setup.js                # Validate environment, create directories
npx ts-node scripts/seed-library.ts  # Seed scene library with sample data
```

## Monorepo Structure

```
videocloudai/
├── apps/
│   ├── web/              React frontend (Vite + Tailwind)
│   └── server/           Express API (TypeScript + SQLite)
├── packages/
│   ├── shared/           Shared TypeScript types
│   ├── core/             Script processor, prompt enhancer, scene reuse
│   └── ffmpeg/           FFmpeg assembler, motion effects, encoder
├── cache/                Cached generations, narration, transcriptions
├── database/             SQLite database (auto-created)
├── renders/              Final assembled videos
└── scripts/              Setup and utility scripts
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# Server
PORT=3002
NODE_ENV=development

# Database
DATABASE_PATH=./database/videocloudai.db

# Asset directories
ASSETS_DIR=./assets
CACHE_DIR=./cache
RENDERS_DIR=./renders

# AI Providers (required for image/video generation)
GOOGLE_FLOW_API_KEY=your_key_here
GOOGLE_IMAGEFX_API_KEY=your_key_here
GOOGLE_PROJECT_ID=your_project_id

# Narration
EDGE_TTS_VOICE=en-US-GuyNeural

# Subtitles
WHISPER_MODEL=tiny
WHISPER_LANGUAGE=en

# Queue
MAX_CONCURRENT_JOBS=3
JOB_TIMEOUT_MS=300000

# Rate Limits
GOOGLE_FLOW_RPM=10
GOOGLE_IMAGEFX_RPM=20
```

## Storyboard Workflow

The main production pipeline:

1. **Topics** — LLM generates viral topic ideas based on niche template
2. **Script** — LLM writes a narration script from the chosen topic
3. **Audio** — edge-tts generates narration, Whisper transcribes for timing
4. **Prompts** — LLM generates image prompts matched to transcript segments
5. **Images** — Google ImageFX/Flow generates images per prompt
6. **Timeline** — Auto-matches images to transcript segments, set motion effects
7. **Metadata** — LLM generates title, description, tags for upload
8. **Assemble** — FFmpeg + Remotion assembles final video with audio + music

## Motion Effects (Remotion)

Smooth CSS-based transforms rendered via headless Chrome:

- `zoom-in` / `zoom-out` — Ken Burns style
- `pan-left` / `pan-right` — Horizontal pan
- `pan-up` / `pan-down` — Vertical pan
- `static` — No motion (rendered via FFmpeg, faster)

## Database

SQLite at `database/videocloudai.db`. Auto-created on server start.

Delete the `.db` file to reset. Cached files in `assets/`, `cache/`, `renders/` are unaffected.

## Performance Notes

Optimized for CPU-only machines:
- Scene-by-scene rendering (not one giant composition)
- Asset caching at every layer
- 24fps by default (lower CPU load)
- Whisper `tiny` model by default
- FFmpeg `fast` preset for intermediate, `medium` for final
- Bundled FFmpeg — no system install needed

## License

Private project.
