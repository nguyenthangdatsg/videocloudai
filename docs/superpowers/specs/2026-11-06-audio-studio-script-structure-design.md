# Audio TTS Studio — Script Structure & Progress View

**Date:** 2026-11-06
**Status:** Draft
**Scope:** `apps/web/src/pages/AudioTtsStudio.tsx`, i18n files

## Problem

After pasting a multi-voice story script into the Audio TTS Studio editor, users see only raw markdown in a textarea and a minimal log during generation. There is no visual breakdown of the parsed script structure, no per-paragraph progress tracking, and history files lack meaningful names.

## Goals

1. Show parsed script structure (voice groups, paragraphs with role/voice/emotion) in a right-side panel when a story-format script is detected.
2. Show structured per-paragraph progress during TTS generation, overlaid on the same structure panel.
3. Improve history file display with meaningful naming (voice, text preview, story title).
4. Keep quick TTS mode (non-story) unchanged — history sidebar stays as-is.

## Non-Goals

- Backend changes — all parsing is client-side, progress mapping uses existing NDJSON data.
- Changing the story format syntax.
- Replacing the textarea editor with a rich editor.

---

## 1. Client-Side Story Parser

A pure function `parseStoryStructure(text: string)` that extracts structure from the pasted script. Runs on text changes, debounced at 300ms.

### Types

```ts
interface VoiceGroupInfo {
  id: string;          // e.g., "narrator"
  engine: string;      // e.g., "kokoro"
  voice: string;       // e.g., "am_adam"
  emotion: string;     // default emotion, e.g., "calm"
  rate?: string;       // e.g., "-5%"
  color: string;       // auto-assigned from palette
}

interface ParagraphInfo {
  index: number;       // 0-based
  group: string;       // references VoiceGroupInfo.id
  emotion: string;     // per-paragraph override or group default
  pace?: 'slow' | 'fast';
  text: string;        // narration text
  wordCount: number;
}

interface ParsedStory {
  title: string;       // from "# ..." heading
  voiceGroups: VoiceGroupInfo[];
  paragraphs: ParagraphInfo[];
  totalWords: number;
  estimatedDuration: number; // seconds, ~150 wpm
}
```

### Parsing Logic

1. Extract title from first `# HEADING` line.
2. Extract `[VOICE_GROUP: id | engine:X | voice:Y | emotion:Z | rate:R]` declarations. Assign colors from a fixed palette (8 distinct colors, cycling if more groups).
3. Split remaining text by `[VOICE: group:X | emotion:Y]` markers. Each marker starts a new paragraph.
4. For each paragraph, capture: group id, emotion override, optional `[PACE: slow|fast]` on its own line, and the narration text (remaining non-tag lines joined).
5. Calculate `wordCount` per paragraph, `totalWords`, and `estimatedDuration` at 150 wpm.

### Color Palette

```ts
const GROUP_COLORS = [
  '#a78bfa', // violet
  '#34d399', // emerald
  '#f472b6', // pink
  '#60a5fa', // blue
  '#fbbf24', // amber
  '#f87171', // red
  '#2dd4bf', // teal
  '#fb923c', // orange
];
```

Colors assigned in declaration order. Same group always gets same color within a session.

---

## 2. Right Panel — Structure View

### Layout Switch Condition

When `isStoryFormat === true && text.trim().length > 0`:
- Right panel (320px) renders the **Structure Panel** instead of the History sidebar.
- A small "History (N)" button at the bottom provides access to history as a floating overlay.

When `isStoryFormat === false` or text is empty:
- Right panel renders the existing History sidebar unchanged.

### Structure Panel Sections

#### 2a. Voice Groups Header

A compact section at the top showing all declared voice groups.

Each voice group rendered as a row:
- Colored dot (matching assigned color)
- Group id in bold (e.g., "narrator")
- Voice name in monospace dim text (e.g., `am_adam`)
- Engine badge, small (e.g., "kokoro")
- Default emotion tag (e.g., "calm")

Compact layout: ~28px per row. Separated from paragraph list by a thin border.

#### 2b. Paragraph List (scrollable)

The main scrollable area. Each paragraph is a row:

```
[1]  * narrator  calm           The signal repeats every fort...   42w
[2]  * elena     excited        Elena, slow down. We've had f...   38w
[3]  * cole      anxious  slow  This is different, Cole. I've...   51w
```

Row contents:
- **Index** — 1-based number, small monospace
- **Color dot** — matches voice group color
- **Group name** — bold, colored text
- **Emotion** — dim tag
- **Pace** — if present, small `[slow]` or `[fast]` badge
- **Text preview** — first ~50 chars, truncated with ellipsis, dim
- **Word count** — right-aligned, small monospace

Row height: ~36px. Compact enough to show ~10-12 paragraphs without scrolling on typical screens.

**Click behavior:** Clicking a paragraph row scrolls the textarea to the corresponding `[VOICE: ...]` line. Optional highlight flash in textarea.

#### 2c. Summary Bar (bottom, fixed)

A fixed bar at the bottom of the structure panel:

- Left: `"24 paragraphs | 1,847 words | ~12:18 est."`
- Right: A "History (N)" button

The "History (N)" button opens a floating overlay panel (positioned above the button, max-height 300px, scrollable) showing the existing history list. Clicking outside or pressing the button again closes it.

---

## 3. Progress Mode

### Activation

When `generateMutation.isPending` is true and `isStoryFormat` is true, the structure panel enters progress mode. The same panel is used — no separate component.

### Overall Progress Bar (top of panel)

Replaces or overlays the voice groups header area during generation:

```
Generating...  [=========>          ]  5 / 12 paragraphs    0:23 elapsed
```

- Progress bar: filled portion colored green
- Fraction: `done / total` paragraphs
- Elapsed timer: updates every second
- Parse step shown briefly at start ("Parsing 4 voice groups, 12 paragraphs...")
- Concat step shown at end ("Combining 12 audio clips...")

### Per-Paragraph Status

Each paragraph row gains a status indicator on the left (replacing or next to the index number):

| Status | Visual | Row Style |
|--------|--------|-----------|
| Pending | Dim circle | Row is dimmed (opacity 0.4) |
| Generating | Pulsing spinner | Row highlighted with subtle bg color, auto-scrolled into view |
| Done | Green checkmark | Normal opacity, shows duration (e.g., "2.3s") on the right |
| Failed | Red X | Red-tinted row, truncated error message replaces text preview |

### Progress Tracking Logic

Map incoming NDJSON progress messages to paragraph indices:

1. `step: 'parse'` — Show as initial status in the progress bar header.
2. `step: 'tts'`, `detail: '[3/12] narrator (calm)'` — Extract index from `[N/total]` pattern. Mark paragraph N-1 as "generating". Mark N-2 as "done" (if it was generating).
3. `step: 'tts'`, detail containing `'FAILED'` — Mark that paragraph as "failed".
4. `step: 'concat'` — All remaining "generating" paragraphs marked "done". Progress bar shows concat status.

State tracked as:

```ts
type ParagraphStatus = 'pending' | 'generating' | 'done' | 'failed';

// Array parallel to parsedStory.paragraphs
const [paraStatuses, setParaStatuses] = useState<ParagraphStatus[]>([]);
const [paraDurations, setParaDurations] = useState<(number | null)[]>([]);
const [genStartTime, setGenStartTime] = useState<number | null>(null);
const [genElapsed, setGenElapsed] = useState(0);
```

Reset `paraStatuses` to all `'pending'` when generation starts. Timer interval updates `genElapsed` every second.

### After Generation Completes

Progress mode exits. The structure panel returns to normal view. The voice groups header reappears. Paragraph statuses reset. The generated audio result panel (existing) appears in the left area as it does today.

---

## 4. History File Naming

### Current State

History items show: duration, file size in KB, and creation date. No description of content.

### Enhanced Display

Each history item gains a descriptive label:

- **For story generations:** Show story title (parsed from `# HEADING` in the text that generated it). Since we don't persist this metadata with the file, use the filename pattern — story files are named with the story id. If the file was generated from an active story project, show the story project title.
- **For quick TTS:** Show first ~30 characters of the input text, truncated with ellipsis.
- **For voice previews:** Show "Preview" + voice name.

Implementation: The existing `history` API returns `{ filename, duration, sizeKB, createdAt, url }`. The filename itself often contains the voice name. Extract what we can from the filename. For the active session, we can also cache the text that was used for the most recent generation.

Layout per history item:

```
  [Play]  narrator (calm)              [Download] [Delete]
          "The signal repeats every..."
          0:23 | 42 KB | Nov 6
```

Top line: voice/group info (extracted from filename or session cache).
Second line: text preview (dim, truncated).
Third line: duration, size, date (existing info, compacted).

---

## 5. Quick TTS Mode — No Changes

When `isStoryFormat` is false:
- Right panel remains the history sidebar exactly as today.
- No structure parsing, no progress overlay.
- History naming improvements still apply (text preview from session cache).

---

## 6. i18n Keys

All new user-visible strings added to both `en.json` and `vi.json`:

```
tts.structurePanel         — "Script Structure"
tts.voiceGroups            — "Voice Groups"
tts.paragraphCount         — "{{count}} paragraphs"
tts.wordCountTotal         — "{{count}} words"
tts.estimatedDuration      — "~{{time}} est."
tts.showHistory            — "History ({{count}})"
tts.statusPending          — "Pending"
tts.statusGenerating       — "Generating"
tts.statusDone             — "Done"
tts.statusFailed           — "Failed"
tts.progressGenerating     — "Generating {{done}}/{{total}} paragraphs..."
tts.progressParsing        — "Parsing {{groups}} voice groups, {{paragraphs}} paragraphs"
tts.progressConcat         — "Combining {{count}} audio clips..."
tts.elapsed                — "{{time}} elapsed"
tts.preview                — "Preview"
```

---

## 7. Implementation Scope

All changes are in:
- `apps/web/src/pages/AudioTtsStudio.tsx` — parser function, structure panel, progress tracking, history naming
- `apps/web/src/i18n/locales/en.json` — new keys
- `apps/web/src/i18n/locales/vi.json` — new keys

No backend changes. No new files needed (all fits within the existing component, though the parser function could be extracted to a util if the file gets too large).

---

## 8. Edge Cases

- **Empty voice groups:** If text has `[VOICE_GROUP:]` but no paragraphs, show voice groups header with "No paragraphs found" message.
- **Malformed tags:** Skip unparseable `[VOICE:]` lines. Show paragraphs that could be parsed.
- **Mid-edit:** During typing, the debounced parser may produce partial results. This is fine — the panel updates live.
- **Generation with failures:** Failed paragraphs show red but don't block the rest. The concat step still runs with successful clips (matches backend behavior).
- **Very long scripts (100+ paragraphs):** The paragraph list is virtualized-friendly at 36px rows, but for v1 a simple scrollable div is sufficient. Revisit if performance issues arise.
