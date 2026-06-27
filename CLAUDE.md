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
- Backend API: http://localhost:3001/api
- SSE stream: http://localhost:3001/api/events

## Architecture

```
User Script
  → ScriptProcessor (packages/core) — parses scenes, detects mood/style/camera from keywords
  → PromptEnhancer (packages/core) — transforms descriptions into cinematic AI prompts
  → Cloud AI Generation — Google Flow (video) / ImageFX (images), rate-limited via key-pool
  → Asset Cache — prompt-level checksums prevent duplicate AI calls
  → SceneReuseEngine (packages/core) — scores library scenes by mood/style/atmosphere/tags
  → VideoAssembler (packages/ffmpeg) — scene-by-scene FFmpeg assembly (CPU-only)
  → Narration (edge-tts Python) + Subtitles (Whisper CPU) + Music mix
  → Platform export (TikTok / YouTube Shorts / Reels)
```

**Monorepo layout:**
- `apps/server` — Express 5 + TypeScript REST API, SQLite, job queue
- `apps/web` — React 18 + Vite + Tailwind frontend
- `packages/shared` — TypeScript types only (no runtime deps)
- `packages/core` — ScriptProcessor, PromptEnhancer, SceneReuseEngine
- `packages/ffmpeg` — VideoAssembler, platform encoder, motion/subtitle filter builders

## Key Patterns

### Backend (apps/server)
- **Route handlers** only parse requests and call services; all logic lives in `src/services/`
- **Job queue** (`src/queue/`) uses p-queue + EventEmitter; jobs are persisted to SQLite and resumed on server restart — handlers must be registered before `resumePendingJobs()` is called
- **SQLite** runs in WAL mode with foreign keys on; use `better-sqlite3` synchronous API
- **AI providers** (`src/providers/`) share a `key-pool.ts` for rate-limit enforcement (RPM configured via env); add new providers by extending `base.provider.ts`
- SSE events are emitted by the queue and streamed at `GET /api/events`

### Frontend (apps/web)
- **All user-visible strings must use translation keys** via `react-i18next` — add to both `src/i18n/locales/en.json` and `vi.json`, then use `const { t } = useTranslation()`
- Global state in Zustand (`src/store/index.ts`): active video, live job map from SSE, notifications
- Server state via TanStack Query; API client at `src/lib/api.ts`
- Theme (dark/light) via CSS custom properties in `index.css`; language saved to `localStorage` key `lang`

### Scene Reuse Scoring (packages/core)
Weighted match against library: mood 35%, tags 20%, style 20%, atmosphere 15%, keywords 10%. Minimum threshold: 0.3.

### FFmpeg Effects (packages/ffmpeg)
All motion via `zoompan` filter (no GPU): `ken-burns-in`, `ken-burns-out`, `pan-left`, `pan-right`, `slow-zoom`, `drift`, `handheld`, `static`. Subtitle burn-in via SRT/VTT filter.

## Environment

Key `.env` variables (see `.env.example` for full list):

```env
PORT=3001
CORS_ORIGIN=http://localhost:5174
DATABASE_PATH=./database/videocloudai.db
GOOGLE_FLOW_API_KEY=...
GOOGLE_IMAGEFX_API_KEY=...
GOOGLE_PROJECT_ID=...
MAX_CONCURRENT_JOBS=3
FFMPEG_PATH=ffmpeg
WHISPER_MODEL=tiny
EDGE_TTS_VOICE=en-US-GuyNeural
```

**External runtime dependencies** (must be on PATH):
- `ffmpeg` / `ffprobe`
- Python 3.8+ with `edge-tts` and `openai-whisper` packages

## Database

SQLite at `database/videocloudai.db`. Schema defined in `apps/server/src/db/schema.ts` and auto-created on server start. Key tables: `scenes`, `assets`, `videos`, `video_clips`, `generations`, `jobs`, `batch_jobs`, `prompts`, `tags`.

Delete the `.db` file to reset; cached files in `assets/`, `cache/`, `renders/` are unaffected.
