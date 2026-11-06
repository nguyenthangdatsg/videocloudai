# Audio TTS Studio — Script Structure & Progress View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show parsed story structure (voice groups, paragraphs) in a right-side panel with per-paragraph progress during TTS generation, and improve history file naming.

**Architecture:** Client-side story parser mirrors backend `parseStory()` logic. The existing right-panel conditionally renders a Structure Panel (when story format detected) or the History sidebar (quick TTS mode). Progress state is an array parallel to parsed paragraphs, updated by mapping NDJSON progress messages.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, react-i18next, Lucide icons

**Spec:** `docs/superpowers/specs/2026-11-06-audio-studio-script-structure-design.md`

---

### Task 1: Add i18n keys for structure panel and progress

**Files:**
- Modify: `apps/web/src/i18n/locales/en.json` (tts section, around line 230-357)
- Modify: `apps/web/src/i18n/locales/vi.json` (tts section, matching location)

- [ ] **Step 1: Add new English i18n keys**

Add these keys inside the `"tts"` object in `en.json`, after the last existing key (`"storyExampleRoles"`):

```json
"structurePanel": "Script Structure",
"voiceGroupsLabel": "Voice Groups",
"paragraphCount": "{{count}} paragraphs",
"wordCountTotal": "{{count}} words",
"estimatedDuration": "~{{time}} est.",
"showHistory": "History ({{count}})",
"statusPending": "Pending",
"statusGenerating": "Generating",
"statusDone": "Done",
"statusFailed": "Failed",
"progressGenerating": "Generating {{done}}/{{total}} paragraphs...",
"progressParsing": "Parsing {{groups}} voice groups, {{paragraphs}} paragraphs...",
"progressConcat": "Combining {{count}} audio clips...",
"elapsed": "{{time}} elapsed",
"noParagraphs": "No paragraphs found",
"previewLabel": "Preview"
```

- [ ] **Step 2: Add matching Vietnamese i18n keys**

Add corresponding keys in `vi.json`:

```json
"structurePanel": "Cau truc Script",
"voiceGroupsLabel": "Nhom giong noi",
"paragraphCount": "{{count}} doan",
"wordCountTotal": "{{count}} tu",
"estimatedDuration": "~{{time}} uoc tinh",
"showHistory": "Lich su ({{count}})",
"statusPending": "Cho",
"statusGenerating": "Dang tao",
"statusDone": "Xong",
"statusFailed": "Loi",
"progressGenerating": "Dang tao {{done}}/{{total}} doan...",
"progressParsing": "Phan tich {{groups}} nhom giong, {{paragraphs}} doan...",
"progressConcat": "Ghep {{count}} doan audio...",
"elapsed": "{{time}} da qua",
"noParagraphs": "Khong tim thay doan nao",
"previewLabel": "Xem truoc"
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/vi.json
git commit -m "feat(audio-studio): add i18n keys for script structure panel and progress"
```

---

### Task 2: Add client-side story parser function

**Files:**
- Modify: `apps/web/src/pages/AudioTtsStudio.tsx` (add parser function + types before the component, around line 16)

- [ ] **Step 1: Add types and parser function**

Add after the imports (around line 16), before the `AudioTtsStudio` component:

```tsx
// ═══ Story structure types ═══
interface VoiceGroupInfo {
  id: string;
  engine: string;
  voice: string;
  emotion: string;
  rate?: string;
  color: string;
}

interface ParagraphInfo {
  index: number;
  group: string;
  emotion: string;
  pace?: 'slow' | 'fast';
  text: string;
  wordCount: number;
  lineNumber: number; // line in textarea for click-to-scroll
}

interface ParsedStory {
  title: string;
  voiceGroups: VoiceGroupInfo[];
  paragraphs: ParagraphInfo[];
  totalWords: number;
  estimatedDuration: number;
}

const GROUP_COLORS = [
  '#a78bfa', '#34d399', '#f472b6', '#60a5fa',
  '#fbbf24', '#f87171', '#2dd4bf', '#fb923c',
];

function parseStoryStructure(text: string): ParsedStory | null {
  if (!/^\[VOICE_GROUP:/m.test(text)) return null;

  const voiceGroups: VoiceGroupInfo[] = [];
  const vgRegex = /^\[VOICE_GROUP:\s*(.+?)\]\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = vgRegex.exec(text)) !== null) {
    const parts = m[1].split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const id = parts[0];
    let engine = 'edge-tts', voice = '', emotion = 'default', rate: string | undefined;
    for (let i = 1; i < parts.length; i++) {
      const ci = parts[i].indexOf(':');
      if (ci > 0) {
        const k = parts[i].slice(0, ci).trim().toLowerCase();
        const v = parts[i].slice(ci + 1).trim();
        if (k === 'engine') engine = v;
        else if (k === 'voice') voice = v;
        else if (k === 'emotion') emotion = v;
        else if (k === 'rate') rate = v;
      }
    }
    voiceGroups.push({ id, engine, voice, emotion, rate, color: GROUP_COLORS[voiceGroups.length % GROUP_COLORS.length] });
  }

  let title = 'Untitled Story';
  const paragraphs: ParagraphInfo[] = [];
  const lines = text.split('\n');
  let curGroup = voiceGroups[0]?.id || 'narrator';
  let curEmotion = voiceGroups[0]?.emotion || 'default';
  let curPace: 'slow' | 'fast' | undefined;
  let narrationLines: string[] = [];
  let voiceLineNum = 0;

  const flushParagraph = () => {
    const narr = narrationLines.join(' ').trim();
    if (narr) {
      const wc = narr.split(/\s+/).filter(Boolean).length;
      paragraphs.push({ index: paragraphs.length, group: curGroup, emotion: curEmotion, pace: curPace, text: narr, wordCount: wc, lineNumber: voiceLineNum });
      curPace = undefined;
    }
    narrationLines = [];
  };

  for (let li = 0; li < lines.length; li++) {
    const trimmed = lines[li].trim();
    if (!trimmed) { flushParagraph(); continue; }
    const titleMatch = trimmed.match(/^#\s+(.+)$/);
    if (titleMatch) { title = titleMatch[1].trim(); continue; }
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) continue;
    if (/^\[VOICE_GROUP:/i.test(trimmed)) continue;
    if (/^\[CHARACTER:/i.test(trimmed)) continue;
    if (trimmed === '---') continue;
    const voiceMatch = trimmed.match(/^\[VOICE:\s*(.+?)\]\s*$/i);
    if (voiceMatch) {
      flushParagraph();
      voiceLineNum = li;
      const vParts = voiceMatch[1].split('|').map(s => s.trim());
      for (const p of vParts) {
        const ci = p.indexOf(':');
        if (ci > 0) {
          const k = p.slice(0, ci).trim().toLowerCase();
          const v = p.slice(ci + 1).trim();
          if (k === 'group') curGroup = v;
          else if (k === 'emotion') curEmotion = v;
        }
      }
      continue;
    }
    const paceMatch = trimmed.match(/^\[PACE:\s*(slow|fast)\]\s*$/i);
    if (paceMatch) { curPace = paceMatch[1].toLowerCase() as 'slow' | 'fast'; continue; }
    if (/^\[.+?:.*\]\s*$/.test(trimmed)) continue;
    narrationLines.push(trimmed);
  }
  flushParagraph();

  const totalWords = paragraphs.reduce((s, p) => s + p.wordCount, 0);
  const estimatedDuration = (totalWords / 150) * 60; // seconds at 150wpm

  return { title, voiceGroups, paragraphs, totalWords, estimatedDuration };
}
```

- [ ] **Step 2: Add parsed story state and debounced memo inside the component**

Inside `AudioTtsStudio`, after the existing `isStoryFormat` line (around line 381), add:

```tsx
// --- Parsed story structure (debounced) ---
const [parsedStory, setParsedStory] = useState<ParsedStory | null>(null);
const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
useEffect(() => {
  if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
  parseTimerRef.current = setTimeout(() => {
    setParsedStory(isStoryFormat ? parseStoryStructure(text) : null);
  }, 300);
  return () => { if (parseTimerRef.current) clearTimeout(parseTimerRef.current); };
}, [text, isStoryFormat]);
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/AudioTtsStudio.tsx
git commit -m "feat(audio-studio): add client-side story parser with debounced memo"
```

---

### Task 3: Add progress tracking state and NDJSON mapping

**Files:**
- Modify: `apps/web/src/pages/AudioTtsStudio.tsx`

- [ ] **Step 1: Add progress tracking state**

Inside `AudioTtsStudio`, after the `parsedStory` state block added in Task 2, add:

```tsx
// --- Per-paragraph progress tracking ---
type ParagraphStatus = 'pending' | 'generating' | 'done' | 'failed';
const [paraStatuses, setParaStatuses] = useState<ParagraphStatus[]>([]);
const [paraTimestamps, setParaTimestamps] = useState<number[]>([]); // start time per para
const [genStartTime, setGenStartTime] = useState<number | null>(null);
const [genElapsed, setGenElapsed] = useState(0);
const [genPhase, setGenPhase] = useState<string>(''); // 'parse' | 'tts' | 'concat' | ''
const paraListRef = useRef<HTMLDivElement>(null);

// Elapsed timer
useEffect(() => {
  if (!genStartTime) { setGenElapsed(0); return; }
  const iv = setInterval(() => setGenElapsed(Math.floor((Date.now() - genStartTime) / 1000)), 1000);
  return () => clearInterval(iv);
}, [genStartTime]);
```

- [ ] **Step 2: Update the generateMutation's onProgress to map NDJSON to paragraph statuses**

Replace the existing `onProgress` callback inside `generateMutation.mutationFn`. The current code at around line 386 is:

```tsx
const onProgress = (step: string, detail?: string) => setGenerateProgress((prev) => [...prev, `[${step}] ${detail ?? ''}`]);
```

Replace it with:

```tsx
const onProgress = (step: string, detail?: string) => {
  setGenerateProgress((prev) => [...prev, `[${step}] ${detail ?? ''}`]);
  setGenPhase(step);

  if (step === 'tts' && detail) {
    const idxMatch = detail.match(/^\[(\d+)\/(\d+)\]/);
    if (idxMatch) {
      const idx = parseInt(idxMatch[1], 10) - 1; // 0-based
      const isFailed = detail.includes('FAILED');
      setParaStatuses(prev => {
        const next = [...prev];
        // Mark previous generating ones as done
        for (let i = 0; i < next.length; i++) {
          if (i < idx && next[i] === 'generating') next[i] = 'done';
        }
        next[idx] = isFailed ? 'failed' : 'generating';
        return next;
      });
      if (!isFailed) {
        setParaTimestamps(prev => {
          const next = [...prev];
          next[idx] = Date.now();
          return next;
        });
      }
    }
  } else if (step === 'concat') {
    // Mark all remaining generating as done
    setParaStatuses(prev => prev.map(s => s === 'generating' ? 'done' : s));
  }
};
```

- [ ] **Step 3: Initialize progress state when generation starts, clear when done**

At the start of `generateMutation.mutationFn` (the line `setGenerateProgress([])` around line 385), add after it:

```tsx
if (parsedStory) {
  setParaStatuses(new Array(parsedStory.paragraphs.length).fill('pending'));
  setParaTimestamps(new Array(parsedStory.paragraphs.length).fill(0));
  setGenStartTime(Date.now());
  setGenPhase('');
}
```

In `generateMutation`'s `onSuccess` callback (around line 409), add:

```tsx
setGenStartTime(null);
setGenPhase('');
```

Also add an `onError` callback to the mutation if not present:

```tsx
onError: () => {
  setGenStartTime(null);
  setGenPhase('');
},
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/AudioTtsStudio.tsx
git commit -m "feat(audio-studio): add per-paragraph progress tracking with NDJSON mapping"
```

---

### Task 4: Build the Structure Panel component (inline)

**Files:**
- Modify: `apps/web/src/pages/AudioTtsStudio.tsx`

- [ ] **Step 1: Add the StoryStructurePanel as an inline function component**

Add before the `fmtTime` function (around line 1655), after the component's closing brace:

```tsx
// ═══════════════════════════════════════════════════════════════
// Story Structure Panel — right sidebar for story format scripts
// ═══════════════════════════════════════════════════════════════
function StoryStructurePanel({
  parsed,
  paraStatuses,
  paraTimestamps,
  genPhase,
  genElapsed,
  isGenerating,
  textareaRef,
  historyCount,
  onShowHistory,
}: {
  parsed: ParsedStory;
  paraStatuses: ParagraphStatus[];
  paraTimestamps: number[];
  genPhase: string;
  genElapsed: number;
  isGenerating: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  historyCount: number;
  onShowHistory: () => void;
}) {
  const { t } = useTranslation();
  const paraListRef = useRef<HTMLDivElement>(null);

  const doneCount = paraStatuses.filter(s => s === 'done').length;
  const failedCount = paraStatuses.filter(s => s === 'failed').length;

  // Auto-scroll to generating paragraph
  useEffect(() => {
    if (!paraListRef.current) return;
    const genIdx = paraStatuses.indexOf('generating');
    if (genIdx >= 0) {
      const row = paraListRef.current.children[genIdx] as HTMLElement;
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [paraStatuses]);

  const handleParaClick = (para: ParagraphInfo) => {
    if (!textareaRef.current) return;
    const lines = textareaRef.current.value.split('\n');
    let charIdx = 0;
    for (let i = 0; i < Math.min(para.lineNumber, lines.length); i++) {
      charIdx += lines[i].length + 1;
    }
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(charIdx, charIdx);
    textareaRef.current.scrollTop = textareaRef.current.scrollHeight * (para.lineNumber / lines.length);
  };

  const getGroupColor = (groupId: string) => {
    const vg = parsed.voiceGroups.find(g => g.id === groupId);
    return vg?.color || '#9ca3af';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-c-border shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-c-text">{t('tts.structurePanel')}</h2>
          <span className="text-[10px] text-c-dim bg-c-elevated px-2 py-0.5 rounded-full">
            {parsed.title}
          </span>
        </div>
      </div>

      {/* Progress bar (during generation) */}
      {isGenerating && (
        <div className="px-4 py-3 border-b border-c-border bg-emerald-900/10 shrink-0 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-emerald-300 font-medium">
              {genPhase === 'concat'
                ? t('tts.progressConcat', { count: doneCount })
                : genPhase === 'parse'
                  ? t('tts.progressParsing', { groups: parsed.voiceGroups.length, paragraphs: parsed.paragraphs.length })
                  : t('tts.progressGenerating', { done: doneCount, total: parsed.paragraphs.length })}
            </span>
            <span className="text-c-dim tabular-nums">{fmtTime(genElapsed)}</span>
          </div>
          <div className="h-1.5 bg-c-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${parsed.paragraphs.length > 0 ? ((doneCount + failedCount) / parsed.paragraphs.length) * 100 : 0}%` }}
            />
          </div>
          <div className="flex items-center gap-3 text-[10px] text-c-dim">
            <span className="text-emerald-400">{doneCount} {t('tts.statusDone').toLowerCase()}</span>
            {failedCount > 0 && <span className="text-red-400">{failedCount} {t('tts.statusFailed').toLowerCase()}</span>}
            <span>{parsed.paragraphs.length - doneCount - failedCount} {t('tts.statusPending').toLowerCase()}</span>
          </div>
        </div>
      )}

      {/* Voice Groups */}
      {!isGenerating && (
        <div className="px-4 py-3 border-b border-c-border shrink-0 space-y-1.5">
          <div className="text-[10px] text-c-dim uppercase tracking-wider font-medium">{t('tts.voiceGroupsLabel')}</div>
          {parsed.voiceGroups.map(vg => (
            <div key={vg.id} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: vg.color }} />
              <span className="font-medium text-c-text">{vg.id}</span>
              <span className="text-c-dim font-mono text-[10px]">{vg.voice}</span>
              <span className="text-[10px] text-c-dim px-1.5 py-0.5 bg-c-elevated rounded">{vg.engine}</span>
              <span className="text-[10px] text-c-dim ml-auto">{vg.emotion}</span>
            </div>
          ))}
        </div>
      )}

      {/* Paragraph list */}
      <div ref={paraListRef} className="flex-1 overflow-y-auto">
        {parsed.paragraphs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-c-dim">{t('tts.noParagraphs')}</div>
        ) : (
          parsed.paragraphs.map((para, i) => {
            const status = paraStatuses[i];
            const isActive = status === 'generating';
            const isDone = status === 'done';
            const isFailed = status === 'failed';
            const isPending = status === 'pending';
            const duration = isDone && paraTimestamps[i] && i < paraStatuses.length - 1
              ? ((paraTimestamps.find((t2, j) => j > i && t2 > 0) || Date.now()) - paraTimestamps[i]) / 1000
              : null;

            return (
              <button
                key={i}
                onClick={() => handleParaClick(para)}
                className={clsx(
                  'w-full flex items-center gap-2 px-4 py-2 text-left transition-all border-b border-c-border/30 cursor-pointer',
                  isActive && 'bg-emerald-900/20 animate-pulse',
                  isFailed && 'bg-red-900/10',
                  isPending && isGenerating && 'opacity-40',
                  !isGenerating && 'hover:bg-c-surface',
                )}
              >
                {/* Status / Index */}
                <span className="w-5 text-center shrink-0">
                  {isActive ? (
                    <span className="inline-block w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  ) : isDone ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : isFailed ? (
                    <X className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <span className="text-[10px] text-c-dim tabular-nums">{i + 1}</span>
                  )}
                </span>

                {/* Color dot */}
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getGroupColor(para.group) }} />

                {/* Group + emotion */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate" style={{ color: getGroupColor(para.group) }}>{para.group}</span>
                    <span className="text-[10px] text-c-dim">{para.emotion}</span>
                    {para.pace && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-amber-900/20 text-amber-400">{para.pace}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-c-dim truncate mt-0.5">{para.text.slice(0, 50)}{para.text.length > 50 ? '...' : ''}</div>
                </div>

                {/* Word count or duration */}
                <span className="text-[10px] text-c-dim tabular-nums shrink-0">
                  {isDone && duration != null ? `${duration.toFixed(1)}s` : `${para.wordCount}w`}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Summary bar */}
      <div className="px-4 py-2.5 border-t border-c-border shrink-0 flex items-center justify-between">
        <div className="text-[10px] text-c-dim space-x-2">
          <span>{t('tts.paragraphCount', { count: parsed.paragraphs.length })}</span>
          <span>|</span>
          <span>{t('tts.wordCountTotal', { count: parsed.totalWords })}</span>
          <span>|</span>
          <span>{t('tts.estimatedDuration', { time: fmtTime(parsed.estimatedDuration) })}</span>
        </div>
        <button
          onClick={onShowHistory}
          className="text-[10px] text-c-muted hover:text-c-text px-2 py-1 rounded border border-c-border hover:border-c-border-hi transition-colors cursor-pointer"
        >
          {t('tts.showHistory', { count: historyCount })}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/AudioTtsStudio.tsx
git commit -m "feat(audio-studio): add StoryStructurePanel component with progress mode"
```

---

### Task 5: Wire the structure panel into the editor layout

**Files:**
- Modify: `apps/web/src/pages/AudioTtsStudio.tsx`

- [ ] **Step 1: Add a ref for the textarea and state for history overlay**

Inside `AudioTtsStudio`, near the other refs (around line 60), add:

```tsx
const textareaRef = useRef<HTMLTextAreaElement>(null);
const [showHistoryOverlay, setShowHistoryOverlay] = useState(false);
```

- [ ] **Step 2: Attach ref to the textarea element**

Find the textarea in the editor view (around line 863):
```tsx
<textarea
  className="input h-40 resize-y font-mono text-sm leading-relaxed"
```

Add the ref:
```tsx
<textarea
  ref={textareaRef}
  className="input h-40 resize-y font-mono text-sm leading-relaxed"
```

- [ ] **Step 3: Replace the right sidebar section conditionally**

Find the right sidebar div in the editor view (around line 1512):
```tsx
{/* Right sidebar: History */}
<div className="flex flex-col border-l border-c-border overflow-hidden">
```

Wrap the entire history sidebar content (from line 1512 to 1641) in a conditional. Replace that entire block with:

```tsx
{/* Right sidebar: Structure Panel or History */}
<div className="flex flex-col border-l border-c-border overflow-hidden relative">
  {isStoryFormat && parsedStory ? (
    <>
      <StoryStructurePanel
        parsed={parsedStory}
        paraStatuses={paraStatuses}
        paraTimestamps={paraTimestamps}
        genPhase={genPhase}
        genElapsed={genElapsed}
        isGenerating={generateMutation.isPending}
        textareaRef={textareaRef}
        historyCount={history?.length ?? 0}
        onShowHistory={() => setShowHistoryOverlay(prev => !prev)}
      />

      {/* History overlay */}
      {showHistoryOverlay && (
        <div className="absolute bottom-10 left-0 right-0 mx-2 max-h-[300px] overflow-y-auto bg-c-surface border border-c-border rounded-xl shadow-xl z-10">
          <div className="px-3 py-2 border-b border-c-border flex items-center justify-between sticky top-0 bg-c-surface">
            <span className="text-xs font-medium text-c-text">{t('tts.history')}</span>
            <button onClick={() => setShowHistoryOverlay(false)} className="text-c-dim hover:text-c-text cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {!history || history.length === 0 ? (
            <div className="p-4 text-center text-xs text-c-dim">{t('tts.noHistory')}</div>
          ) : (
            <div className="p-2 space-y-1">
              {history.map((file) => (
                <div key={file.filename} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-c-elevated text-xs">
                  <button onClick={() => playAudio(file.url)} className="text-c-muted hover:text-c-text shrink-0 cursor-pointer">
                    {playingUrl === file.url ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-c-text truncate">{file.filename.replace(/\.(mp3|wav|ogg)$/, '').slice(-24)}</div>
                    <div className="text-[10px] text-c-dim">{file.duration > 0 ? fmtTime(file.duration) : '--:--'} | {file.sizeKB} KB</div>
                  </div>
                  <button onClick={() => handleDownload(file.url, file.filename)} className="text-c-dim hover:text-c-muted p-0.5 cursor-pointer">
                    <Download className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  ) : (
    <>
      {/* Original history sidebar — existing code below */}
      <div className="px-4 py-4 border-b border-c-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-c-text">{t('tts.history')}</h2>
            <p className="text-xs text-c-muted mt-0.5">{history?.length ?? 0} {t('tts.files')}</p>
          </div>
          {history && history.length > 0 && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={history.length > 0 && selected.size === history.length}
                onChange={toggleSelectAll}
                className="accent-cyan-500 w-3.5 h-3.5"
              />
              <span className="text-xs text-c-muted">{t('tts.selectAll')}</span>
            </label>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="px-3 py-2 border-b border-c-border bg-cyan-900/10 flex items-center gap-2">
          <span className="text-xs text-cyan-300">{selected.size} {t('tts.selected')}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={handleBulkDownload}
              className="text-xs text-c-muted hover:text-c-text flex items-center gap-1 px-2 py-1 rounded border border-c-border hover:border-c-border-hi transition-colors"
            >
              <Download className="w-3 h-3" />
              {t('tts.download')}
            </button>
            <button
              onClick={handleBulkDelete}
              className="text-xs text-red-400/80 hover:text-red-400 flex items-center gap-1 px-2 py-1 rounded border border-red-800/30 hover:border-red-600/50 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              {t('tts.deleteFile')}
            </button>
          </div>
        </div>
      )}

      {!history || history.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <FileAudio className="w-8 h-8 text-c-dim mb-3" />
          <div className="text-xs text-c-muted">{t('tts.noHistory')}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3 space-y-1.5">
          {history.map((file) => {
            const isPlaying = playingUrl === file.url;
            return (
              <div
                key={file.filename}
                className={clsx(
                  'bg-c-surface border rounded-lg p-2.5 transition-colors',
                  isPlaying ? 'border-cyan-600/40' : 'border-c-border'
                )}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(file.filename)}
                    onChange={() => toggleSelect(file.filename)}
                    className="accent-cyan-500 w-3.5 h-3.5 shrink-0"
                  />
                  <button
                    onClick={() => playAudio(file.url)}
                    className={clsx(
                      'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer',
                      isPlaying
                        ? 'bg-cyan-900/40 text-cyan-300'
                        : 'bg-c-bg text-c-muted hover:text-c-text'
                    )}
                  >
                    {isPlaying
                      ? <Pause className="w-3 h-3" />
                      : <Play className="w-3 h-3" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-c-dim truncate">
                      {file.duration > 0 ? fmtTime(file.duration) : '--:--'} · {file.sizeKB} KB
                    </div>
                    <div className="text-xs text-c-dim flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(file.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleDownload(file.url, file.filename)}
                      className="text-c-dim hover:text-c-muted p-0.5 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(file.filename, file.url)}
                      className="text-c-dim hover:text-red-400 p-0.5 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Player bar when this item is playing */}
                {isPlaying && audioDuration > 0 && (
                  <div className="mt-2 space-y-1">
                    <div
                      className="h-1.5 bg-c-bg rounded-full cursor-grab active:cursor-grabbing overflow-hidden select-none"
                      onMouseDown={handleSeekStart}
                    >
                      <div
                        className="h-full bg-cyan-500 rounded-full transition-all duration-100"
                        style={{ width: `${(audioProgress / audioDuration) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-c-dim">
                      <span>{fmtTime(audioProgress)}</span>
                      <span>{fmtTime(audioDuration)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  )}
</div>
```

- [ ] **Step 4: Hide the inline progress log when structure panel is showing**

Find the inline progress log section (around line 1444):
```tsx
{generateMutation.isPending && generateProgress.length > 0 && (
  <div className="border border-cyan-800/30 rounded-xl p-3 bg-cyan-900/10 space-y-1">
```

Change the condition to only show when not in story mode (the structure panel handles progress):
```tsx
{generateMutation.isPending && generateProgress.length > 0 && !parsedStory && (
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/AudioTtsStudio.tsx
git commit -m "feat(audio-studio): wire structure panel into editor layout with history overlay"
```

---

### Task 6: Improve history file naming display

**Files:**
- Modify: `apps/web/src/pages/AudioTtsStudio.tsx`

- [ ] **Step 1: Add a session cache for generation labels**

Inside `AudioTtsStudio`, near the other state declarations, add:

```tsx
// --- Session label cache for history items ---
const [historyLabels, setHistoryLabels] = useState<Record<string, string>>({});
```

- [ ] **Step 2: Update generateMutation.onSuccess to cache the label**

In the existing `onSuccess` handler for `generateMutation` (around line 409), after `playAudio(data.url)`, add:

```tsx
// Cache label for the generated file
const label = isStoryFormat
  ? (parsedStory?.title || parseStoryTitle(text))
  : text.slice(0, 40).replace(/\n/g, ' ');
setHistoryLabels(prev => ({ ...prev, [data.filename]: label }));
```

- [ ] **Step 3: Update history item display in the non-story sidebar**

In the history sidebar's file listing (the `<div className="flex-1 min-w-0">` block inside each history item), replace:

```tsx
<div className="text-xs text-c-dim truncate">
  {file.duration > 0 ? fmtTime(file.duration) : '--:--'} · {file.sizeKB} KB
</div>
<div className="text-xs text-c-dim flex items-center gap-1">
  <Clock className="w-2.5 h-2.5" />
  {new Date(file.createdAt).toLocaleDateString()}
</div>
```

With:

```tsx
{historyLabels[file.filename] && (
  <div className="text-xs text-c-text truncate">{historyLabels[file.filename]}</div>
)}
<div className="text-[10px] text-c-dim truncate">
  {file.duration > 0 ? fmtTime(file.duration) : '--:--'} · {file.sizeKB} KB · {new Date(file.createdAt).toLocaleDateString()}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/AudioTtsStudio.tsx
git commit -m "feat(audio-studio): improve history file naming with session label cache"
```

---

### Task 7: Manual verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test story format detection**

1. Open http://localhost:5174/audio-tts-studio
2. Click "Quick TTS" or open a story project
3. Paste the example story from the Story Prompt Guide (click the Story Prompt button, go to Example tab, copy)
4. Verify: Right panel switches from History to Structure Panel
5. Verify: Voice groups header shows 4 groups with colored dots, voice names, engines, emotions
6. Verify: Paragraph list shows all paragraphs with correct group names, emotions, pace tags, text previews, word counts
7. Verify: Summary bar shows correct paragraph count, word count, estimated duration
8. Verify: "History (N)" button appears in summary bar

- [ ] **Step 3: Test click-to-scroll**

Click a paragraph row in the structure panel. Verify the textarea scrolls to that paragraph's `[VOICE:]` tag.

- [ ] **Step 4: Test progress mode**

1. With a pasted story, click "Generate Story Audio"
2. Verify: Voice groups header is replaced by overall progress bar
3. Verify: Paragraphs show pending (dimmed) -> generating (pulsing) -> done (green check) or failed (red X)
4. Verify: Panel auto-scrolls to the currently generating paragraph
5. Verify: Elapsed timer updates
6. Verify: After completion, structure panel returns to normal

- [ ] **Step 5: Test history overlay**

Click "History (N)" in the summary bar. Verify floating overlay shows history items. Click outside or X to close.

- [ ] **Step 6: Test quick TTS mode**

Clear the text. Type plain text (no `[VOICE_GROUP:]`). Verify right panel shows the regular History sidebar.

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat(audio-studio): script structure panel with per-paragraph progress view"
```
