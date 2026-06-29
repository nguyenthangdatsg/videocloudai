# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Han2YT_flow** is a Chrome Extension (Manifest V3) that bulk-generates **images and videos** on Google Flow (`labs.google/fx/tools/flow`). It reads a list of prompts, types each one into the Flow UI, waits for the generated image/video, and auto-downloads it. The UI is entirely in Vietnamese.

Key constraint: Flow uses a Slate.js rich-text editor that only accepts "real" input events. The extension uses `chrome.debugger` (Chrome DevTools Protocol) to send genuine keystrokes, which is why DevTools (F12) must be closed on the Flow tab during operation.

## Architecture

Three layers communicate via `chrome.runtime.onMessage`:

1. **`sidepanel.js`** (side panel UI) — Orchestrator. Reads prompts from the textarea, iterates through them, coordinates content script and background, triggers downloads via `chrome.downloads`. Persists settings to `chrome.storage.local`.

2. **`background.js`** (service worker) — Debugger bridge. Attaches `chrome.debugger` to the Flow tab, sends CDP commands (`Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent`) to type text and press Enter. This is necessary because Slate.js ignores synthetic DOM events.

3. **`content.js`** (injected into `labs.google/fx/*`) — Page bot. Finds the prompt input (auto-detects Slate editor via fallback selector chain), finds the generate button, monitors for new images by comparing against a baseline snapshot, and converts blob URLs to data URLs for download.

### Message flow for one prompt

```
sidepanel -> content.js: GET_BOX (get prompt input coordinates + snapshot baseline images)
sidepanel -> background:  DEBUG_SUBMIT (type prompt + Enter via CDP)
sidepanel -> content.js: WAIT_IMAGE (poll until a new image appears)
sidepanel -> chrome.downloads: download the image
```

## Key Configuration

All tunable parameters are in the `CONFIG` object at the top of `content.js`:

- `promptSelector` / `generateSelector` — CSS selectors (empty = auto-detect)
- `submitWithEnter` — whether to submit via Enter key (default: true)
- `minImageSize` — pixel threshold to distinguish result images from icons (default: 256)
- `pollMs` / `maxWaitMs` / `settleMs` — image polling timing

## Development

No build step, no dependencies, no tests. Pure vanilla JS.

**To develop:**
1. Edit files directly
2. Go to `chrome://extensions`, click reload on the extension card
3. Reopen the side panel to pick up changes

**Permissions used:** `sidePanel`, `downloads`, `storage`, `tabs`, `scripting`, `debugger`

## When Google Changes the Flow UI

The most common breakage is selector detection in `content.js`. The auto-detect chain in `findPromptInput()` tries multiple selectors (Slate attributes, contenteditable, role=textbox, textarea). If auto-detect fails, users manually set `CONFIG.promptSelector` and `CONFIG.generateSelector` via DevTools element inspection. The `findGenerateButton()` function similarly falls back through label matching and proximity-based detection.

## VideoCloudAI Bridge Integration

The extension also integrates with the **VideoCloudAI** storyboard app (`localhost:5174`) to generate images for video storyboards:

4. **`bridge.js`** (injected into `localhost:5174/*`) — Listens for `CustomEvent` messages from the web app page, connects to `background.js` via `chrome.runtime.Port` (`flow-bridge`), and uploads generated images back to the VideoCloudAI backend via `/api/image/upload`.

### Bridge message flow

```
Web App (CustomEvent) -> bridge.js -> background.js (Port) -> content.js on Flow tab
                                                             <- image dataURL
                      <- bridge.js uploads to /api/image/upload
Web App (CustomEvent) <- bridge.js reports result
```

Custom events used:
- `Han2YT_flow_ping` / `Han2YT_flow_pong` — Extension availability check
- `Han2YT_flow_start` — Start batch (detail: `{ prompts: [{timestamp, prompt}], delayMin, delayMax }`)
- `Han2YT_flow_stop` — Stop batch
- `Han2YT_flow_progress` / `Han2YT_flow_image` / `Han2YT_flow_done` / `Han2YT_flow_error` — Status updates back to page

The web app side lives in `D:\AI\videocloudai\apps\web\`:
- `src/store/image-generation.ts` — `startHan2YTeration()` method listens for bridge events
- `src/pages/Storyboard.tsx` — "Google Flow" tab in the Images step
- `src/lib/api.ts` — `imageApi.uploadSingle()` for single base64 image upload
- Server: `apps/server/src/routes/image.routes.ts` — `POST /api/image/upload` endpoint

## Rebranding

To rebrand: change `name`/`description` in `manifest.json`, replace icons in `icons/`, update title in `sidepanel.html`, and adjust `--accent` CSS variable in `sidepanel.css`.
