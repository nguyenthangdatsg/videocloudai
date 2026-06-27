# VideoCloudAI — AI Cinematic Content Factory

A production-grade, CPU-only AI-powered short-form video production system.
Orchestrates cloud AI generation, reuses assets intelligently, and assembles cinematic
TikTok/Shorts/Reels automatically using FFmpeg.

## Architecture

```
Script → Scene Extraction → Prompt Enhancement → Cloud AI Generation
     ↓
Asset Caching → Scene Library Reuse Check → FFmpeg Assembly
     ↓
Narration (edge-tts) + Subtitles (Whisper CPU) + Music Mix
     ↓
Final Short-Form Export (TikTok / YouTube Shorts / Reels)
```

## Key Features

- **Scene Reuse Engine** — Never regenerate what you already have
- **Prompt Enhancement** — Transforms simple prompts into cinematic prompts
- **Script Processor** — Auto-extracts scenes with mood/visual/duration
- **FFmpeg Pipeline** — Ken Burns, pan, zoom, transitions — no GPU
- **AI Provider System** — Google Flow (video) + ImageFX (images)
- **Job Queue** — PQueue-based with retries, priorities, SSE live updates
- **Batch Generator** — 20 variations from 1 template
- **Narration** — edge-tts with voice selection and audio caching
- **Subtitles** — Whisper CPU mode with SRT/VTT output

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind, Zustand, TanStack Query
- **Backend**: Node.js, Express, TypeScript
- **Rendering**: FFmpeg (primary), fluent-ffmpeg
- **Database**: SQLite (better-sqlite3)
- **AI**: Google Veo/Flow, Google Imagen/ImageFX
- **Narration**: edge-tts (Python)
- **Subtitles**: OpenAI Whisper CPU mode

## Prerequisites

1. **Node.js 20+** — https://nodejs.org
2. **FFmpeg** — https://ffmpeg.org/download.html (add to PATH)
3. **Python 3.8+** — for edge-tts and whisper
4. **edge-tts** — `pip install edge-tts`
5. **Whisper** — `pip install openai-whisper`

## Quick Start

```bash
# 1. Clone / enter directory
cd D:\AI\videocloudai

# 2. Run setup script
node scripts/setup.js

# 3. Configure API keys
# Edit .env:
#   GOOGLE_FLOW_API_KEY=...
#   GOOGLE_IMAGEFX_API_KEY=...
#   GOOGLE_PROJECT_ID=...

# 4. Install dependencies
npm install

# 5. Seed scene library (optional but recommended)
npx ts-node scripts/seed-library.ts

# 6. Start development
npm run dev
```

**Frontend**: http://localhost:5173  
**Backend API**: http://localhost:3001/api  
**SSE Events**: http://localhost:3001/api/events  

## Folder Structure

```
videocloudai/
├── apps/
│   ├── web/              React frontend (Vite + TypeScript + Tailwind)
│   └── server/           Express API (TypeScript + SQLite)
├── packages/
│   ├── shared/           Shared TypeScript types
│   ├── core/             Script processor, prompt enhancer, scene reuse engine
│   └── ffmpeg/           FFmpeg assembler, motion effects, encoder
├── assets/
│   ├── videos/           Generated video clips
│   ├── images/           Generated images
│   ├── audio/            Narration audio files
│   └── subtitles/        SRT/VTT subtitle files
├── cache/                Cached generations and prompts
├── database/             SQLite database
├── renders/              Final assembled videos
└── scripts/              Setup and utility scripts
```

## API Endpoints

### Videos
- `GET  /api/videos` — List all projects
- `POST /api/videos` — Create project from script
- `GET  /api/videos/:id` — Get project
- `PUT  /api/videos/:id/scenes` — Update scene list
- `POST /api/videos/:id/generate-scenes` — Queue scene generation
- `POST /api/videos/:id/assemble` — Assemble final video

### Scene Library
- `GET  /api/library/scenes` — Browse scenes (filter by mood/style)
- `POST /api/library/scenes/reuse-matches` — Find reuse matches for a scene
- `GET  /api/library/scenes/search/:query` — Search scenes
- `GET  /api/library/stats` — Library statistics

### Generation
- `POST /api/generations` — Request AI generation
- `GET  /api/generations` — List generations
- `GET  /api/generations/meta/providers` — Active providers

### Queue
- `GET  /api/queue` — List jobs
- `GET  /api/queue/stats` — Queue statistics
- `DELETE /api/queue/:id` — Cancel job

### Export
- `POST /api/export/:videoId` — Export to platforms
- `GET  /api/export/:videoId/download` — Download video
- `GET  /api/export/:videoId/thumbnail` — Get thumbnail

### Batch
- `POST /api/batch` — Create batch job
- `GET  /api/batch` — List batch jobs

### SSE Events
- `GET  /api/events` — Server-Sent Events for live job updates

## Database Schema

```sql
scenes           -- Reusable scene metadata
prompts          -- Prompt cache with checksums
assets           -- Generated files (video/image/audio)
reusable_clips   -- Tagged reusable clips
videos           -- Video projects
video_clips      -- Timeline entries per video
generations      -- AI generation requests
jobs             -- Queue job records
batch_jobs       -- Batch generation tracking
tags             -- Tag index
```

## Scene Reuse System

The SceneReuseEngine scores candidate scenes against a target:

| Factor          | Weight |
|-----------------|--------|
| Mood match      | 35%    |
| Style match     | 20%    |
| Atmosphere      | 15%    |
| Tag overlap     | 20%    |
| Keyword match   | 10%    |

Minimum score threshold: 0.25 (configurable)

## FFmpeg Motion Effects

All motion applied via `zoompan` filter — no GPU required:

- `ken-burns-in` — Slow zoom in (documentary style)
- `ken-burns-out` — Slow zoom out (reveal style)
- `pan-left` / `pan-right` — Horizontal pan
- `slow-zoom` — Very subtle zoom (ambient)
- `drift` — Gentle sinusoidal drift
- `handheld` — Simulated handheld shake
- `static` — No motion (locked off)

## Performance Notes

Optimized for CPU-only machines:
- Scene-by-scene rendering (not one giant composition)
- Asset caching at every layer
- 24fps by default (lower CPU load)
- WebP/JPEG for images
- FFmpeg `fast` preset for intermediate renders, `medium` for final
- Whisper `tiny` model by default

## Environment Variables

See `.env.example` for full list. Key variables:

```env
PORT=3001
DATABASE_PATH=./database/videocloudai.db
GOOGLE_FLOW_API_KEY=
GOOGLE_IMAGEFX_API_KEY=
GOOGLE_PROJECT_ID=
EDGE_TTS_VOICE=en-US-GuyNeural
WHISPER_MODEL=tiny
MAX_CONCURRENT_JOBS=3
```
