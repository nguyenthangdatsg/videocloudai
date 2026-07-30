import { randomUUID, createHash } from 'crypto';
import { dbGet, dbAll, dbRun } from '../db';
import * as path from 'path';
import * as fs from 'fs';

// ── Types ──

export interface ChartParsedData {
  value?: number;
  prefix?: string;
  suffix?: string;
  points?: { label: string; value: number }[];
  bars?: { name: string; value: number }[];
  leftLabel?: string;
  leftValue?: string;
  rightLabel?: string;
  rightValue?: string;
}

export interface ChartSpec {
  type: 'big-number' | 'line' | 'bars' | 'vs';
  title?: string;
  sourceLabel?: string;
  data: string;
  parsedData?: ChartParsedData;
}

export interface ScriptBlock {
  narration: string;
  pexelsQuery?: string;
  chartSpec?: ChartSpec;
  overlays: string[];
  notes?: string;
  paceHint?: 'slow' | 'fast';
  /** '__auto__' = build from narration at produce time; any other string = explicit cinematic prompt */
  flowPrompt?: string;
  /** 1-based position within parent segment; always set post-parse */
  sceneNumber?: number;
  /** Per-block TTS config raw string, e.g. "pause-before:400ms | rate:-10%" */
  voiceConfig?: string;
}

export interface ScriptSegment {
  index: number;
  name: string;
  timeRange?: string;
  blocks: ScriptBlock[];
}

export interface ProductionNotes {
  sourcesText?: string;
  chaptersText?: string;
  thumbnailText?: string;
}

export interface ParseWarning {
  level: 'warn' | 'info';
  message: string;
  location?: string;
}

export interface VoiceGroup {
  id: string;          // e.g. "japan", "usa"
  engine: string;      // "omnivoice" or "edge-tts"
  voiceId: string;     // voice persona ID or edge-tts voice name
  emotion?: string;    // default emotion for this group
  rate?: string;       // default rate
  pitch?: string;      // default pitch
  fallbackVoice?: string; // edge-tts voice to use when OmniVoice is unavailable
}

export interface ResolvedVoiceConfig {
  engine: 'edge-tts' | 'omnivoice';
  voiceId: string;
  fallbackVoice?: string; // edge-tts voice to use when OmniVoice is unavailable
  emotion?: string;
  rate?: string;
  pitch?: string;
  pauseBefore?: number;  // ms
  pauseAfter?: number;   // ms
  group?: string;        // which voice group was resolved
}

export interface ParsedScript {
  title: string;
  segments: ScriptSegment[];
  productionNotes: ProductionNotes;
  warnings: ParseWarning[];
  /** Character definitions: @id → description; used for @id expansion in [FLOW: ...] prompts */
  characters?: Record<string, string>;
  /** Doc-level voice config raw string from [VOICE: voice-name | rate:X%] */
  voiceConfig?: string;
  voiceGroups?: VoiceGroup[];
}

export interface AlignedSegment {
  segmentIndex: number;
  segmentText: string;
  matchedBlock: {
    pexelsQuery?: string;
    overlays: string[];
    segmentName: string;
  } | null;
  confidence: number;
}

export interface AlignmentResult {
  alignments: AlignedSegment[];
  chapterMarkers: string[];
}

export type DocStatus = 'draft' | 'parsed' | 'narration_copied' | 'aligned' | 'producing' | 'ready' | 'published';
export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export type LogOperation = 'parse' | 'align' | 'copy' | 'produce' | 'status_change';
export type CheckpointName = 'alignment' | 'clips' | 'timeline';
export type BlockStatus = 'pending' | 'audio_ready' | 'clip_ready' | 'rendered' | 'error';

/** A single clip within a block's multi-clip timeline. */
export interface BlockClip {
  assetPath: string;
  startSec: number;
  endSec: number | null;
  sourceDurationSec?: number; // full source video duration for timeline display
  label?: string;             // e.g. "pexels:12345" for provenance
}

export interface ScriptBlockRow {
  id: string;
  doc_id: string;
  block_index: number;
  segment_index: number;
  segment_name: string;
  scene_number: number;
  narration: string;
  pexels_query: string | null;
  chart_spec_json: string | null;
  overlays_json: string;
  pace_hint: 'slow' | 'fast' | null;
  content_hash: string | null;
  audio_path: string | null;
  audio_duration_ms: number | null;
  audio_engine: string | null;
  words_json: string | null;
  visual_type: string;
  clip_asset_path: string | null;
  clips_json: string | null;
  motion: string;
  rendered_clip_path: string | null;
  status: BlockStatus;
  error_msg: string | null;
  ai_prompt: string | null;
  ai_asset_path: string | null;
  ai_meta_json: string | null;
  voice_config: string | null;
  clip_start_sec: number | null;
  clip_end_sec: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScriptBlockRecord {
  id: string;
  docId: string;
  blockIndex: number;
  segmentIndex: number;
  segmentName: string;
  sceneNumber: number;
  narration: string;
  pexelsQuery: string | null;
  chartSpec: ChartSpec | null;
  overlays: string[];
  paceHint: 'slow' | 'fast' | null;
  contentHash: string | null;
  audioPath: string | null;
  audioDurationMs: number | null;
  audioEngine: string | null;
  words: Array<{ word: string; offset_ms: number; duration_ms: number }> | null;
  visualType: string;
  clipAssetPath: string | null;
  clips: BlockClip[];
  clipsJson: string | null;
  motion: string;
  renderedClipPath: string | null;
  status: BlockStatus;
  errorMsg: string | null;
  aiPrompt: string | null;
  aiAssetPath: string | null;
  aiMeta: Record<string, unknown> | null;
  voiceConfig: string | null;
  clipStartSec: number | null;
  clipEndSec: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionCheckpointRow {
  id: string;
  job_id: string;
  doc_id: string;
  checkpoint: CheckpointName;
  state_json: string;
  edits_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProductionCheckpoint {
  id: string;
  jobId: string;
  docId: string;
  checkpoint: CheckpointName;
  state: Record<string, unknown>;
  edits: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ScriptDocRow {
  id: string;
  title: string;
  raw_markdown: string;
  parsed_json: string;
  source_ref: string | null;
  status: DocStatus;
  linked_storyboard_id: string | null;
  warnings_count: number;
  segments_count: number;
  blocks_count: number;
  words_count: number;
  est_duration_seconds: number;
  subtitle_style?: string | null;
  created_at: string;
  updated_at: string;
}

interface LogRow {
  id: string;
  doc_id: string;
  ts: string;
  level: LogLevel;
  operation: LogOperation;
  message: string;
}

// ── Schema ──

export function ensureScriptStudioTables(): void {
  try {
    dbRun(`CREATE TABLE IF NOT EXISTS script_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      raw_markdown TEXT NOT NULL,
      parsed_json TEXT NOT NULL DEFAULT '{}',
      source_ref TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      linked_storyboard_id TEXT,
      warnings_count INTEGER NOT NULL DEFAULT 0,
      segments_count INTEGER NOT NULL DEFAULT 0,
      blocks_count INTEGER NOT NULL DEFAULT 0,
      words_count INTEGER NOT NULL DEFAULT 0,
      est_duration_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    try {
      dbRun(`ALTER TABLE script_docs ADD COLUMN subtitle_style TEXT`);
    } catch { /* ignore if column exists */ }
    dbRun(`CREATE INDEX IF NOT EXISTS idx_script_docs_status ON script_docs(status)`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_script_docs_updated ON script_docs(updated_at)`);

    dbRun(`CREATE TABLE IF NOT EXISTS script_doc_logs (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES script_docs(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      level TEXT NOT NULL DEFAULT 'info',
      operation TEXT NOT NULL,
      message TEXT NOT NULL
    )`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_script_doc_logs_doc ON script_doc_logs(doc_id)`);

    dbRun(`CREATE TABLE IF NOT EXISTS production_checkpoints (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      doc_id TEXT NOT NULL REFERENCES script_docs(id) ON DELETE CASCADE,
      checkpoint TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      edits_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_prod_checkpoints_job ON production_checkpoints(job_id)`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_prod_checkpoints_doc ON production_checkpoints(doc_id, checkpoint, created_at)`);

    dbRun(`CREATE TABLE IF NOT EXISTS script_blocks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES script_docs(id) ON DELETE CASCADE,
      block_index INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      segment_name TEXT NOT NULL,
      narration TEXT NOT NULL DEFAULT '',
      pexels_query TEXT,
      chart_spec_json TEXT,
      overlays_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT,
      audio_path TEXT,
      audio_duration_ms INTEGER,
      audio_engine TEXT,
      words_json TEXT,
      visual_type TEXT NOT NULL DEFAULT 'pexels',
      clip_asset_path TEXT,
      motion TEXT NOT NULL DEFAULT 'slow-zoom',
      pace_hint TEXT,
      rendered_clip_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_msg TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(doc_id, block_index)
    )`);
    dbRun(`CREATE INDEX IF NOT EXISTS idx_script_blocks_doc ON script_blocks(doc_id, block_index)`);
  } catch {
    // tables already exist
  }

  // Migration: add pace_hint column if missing
  try {
    dbRun(`ALTER TABLE script_blocks ADD COLUMN pace_hint TEXT`);
  } catch { /* already exists */ }

  // Migration: scene_number (1-based position within segment)
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN scene_number INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }

  // Migration: voice_config (per-block TTS params, e.g. "pause-before:400ms | rate:-10%")
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN voice_config TEXT`); } catch { /* already exists */ }

  // Migration: motion column (NOT NULL DEFAULT 'slow-zoom')
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN motion TEXT NOT NULL DEFAULT 'slow-zoom'`); } catch { /* already exists */ }
  // Backfill any rows where motion is NULL (schema existed without NOT NULL)
  try { dbRun(`UPDATE script_blocks SET motion = 'slow-zoom' WHERE motion IS NULL`); } catch { /* ignore */ }

  // Migration: AI generation columns
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN ai_prompt TEXT`); } catch { /* already exists */ }
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN ai_asset_path TEXT`); } catch { /* already exists */ }
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN ai_meta_json TEXT`); } catch { /* already exists */ }

  // Migration: clip trim range (user-specified start/end offset within stock video)
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN clip_start_sec REAL`); } catch { /* already exists */ }
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN clip_end_sec REAL`); } catch { /* already exists */ }

  // Migration: audio_engine (tracks which TTS engine produced the audio: 'edge-tts' | 'omnivoice')
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN audio_engine TEXT`); } catch { /* already exists */ }

  // Migration: clips_json (multi-clip timeline per block)
  try { dbRun(`ALTER TABLE script_blocks ADD COLUMN clips_json TEXT`); } catch { /* already exists */ }

  // Migrate: sync blocks for any existing docs that have no blocks yet
  try {
    const docsWithoutBlocks = dbAll<{ id: string; parsed_json: string }>(
      `SELECT id, parsed_json FROM script_docs
       WHERE id NOT IN (SELECT DISTINCT doc_id FROM script_blocks)
       AND parsed_json != '{}'
       AND parsed_json != 'null'
       AND parsed_json IS NOT NULL`,
    );
    for (const row of docsWithoutBlocks) {
      try {
        const parsed = JSON.parse(row.parsed_json) as ParsedScript;
        if (parsed?.segments?.length) {
          syncBlocksFromParsed(row.id, parsed);
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* ignore migration errors */ }
}

// ── Checkpoint helpers ──

export function saveCheckpoint(jobId: string, docId: string, checkpoint: CheckpointName, state: Record<string, unknown>): void {
  const existing = dbGet<{ id: string }>(
    `SELECT id FROM production_checkpoints WHERE job_id = ?`,
    [jobId],
  );
  const now = new Date().toISOString();
  if (existing) {
    dbRun(
      `UPDATE production_checkpoints SET checkpoint = ?, state_json = ?, updated_at = ? WHERE job_id = ?`,
      [checkpoint, JSON.stringify(state), now, jobId],
    );
  } else {
    dbRun(
      `INSERT INTO production_checkpoints (id, job_id, doc_id, checkpoint, state_json, edits_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`,
      [randomUUID(), jobId, docId, checkpoint, JSON.stringify(state), now, now],
    );
  }
}

export function loadCheckpoint(jobId: string): ProductionCheckpoint | null {
  const row = dbGet<ProductionCheckpointRow>(
    `SELECT * FROM production_checkpoints WHERE job_id = ?`,
    [jobId],
  );
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    docId: row.doc_id,
    checkpoint: row.checkpoint as CheckpointName,
    state: JSON.parse(row.state_json || '{}'),
    edits: JSON.parse(row.edits_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadLatestCheckpoint(docId: string, atOrBefore: CheckpointName): ProductionCheckpoint | null {
  const order: CheckpointName[] = ['alignment', 'clips', 'timeline'];
  const maxIdx = order.indexOf(atOrBefore);
  if (maxIdx < 0) return null;
  const allowed = order.slice(0, maxIdx + 1);
  const placeholders = allowed.map(() => '?').join(', ');
  const row = dbGet<ProductionCheckpointRow>(
    `SELECT * FROM production_checkpoints WHERE doc_id = ? AND checkpoint IN (${placeholders})
     ORDER BY created_at DESC LIMIT 1`,
    [docId, ...allowed],
  );
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    docId: row.doc_id,
    checkpoint: row.checkpoint as CheckpointName,
    state: JSON.parse(row.state_json || '{}'),
    edits: JSON.parse(row.edits_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function applyCheckpointEdits(jobId: string, edits: Record<string, unknown>): void {
  dbRun(
    `UPDATE production_checkpoints SET edits_json = ?, updated_at = ? WHERE job_id = ?`,
    [JSON.stringify(edits), new Date().toISOString(), jobId],
  );
}

// ── Helpers ──

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function addLog(docId: string, level: LogLevel, operation: LogOperation, message: string): void {
  dbRun(
    `INSERT INTO script_doc_logs (id, doc_id, ts, level, operation, message) VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), docId, new Date().toISOString(), level, operation, message],
  );
}

function updateDocMeta(id: string, parsed: ParsedScript): void {
  const blocksCount = parsed.segments.reduce((s, seg) => s + seg.blocks.length, 0);
  const allNarration = parsed.segments
    .flatMap((seg) => seg.blocks.map((b) => b.narration))
    .filter(Boolean)
    .join(' ');
  const wc = countWords(allNarration);
  const estDuration = Math.round((wc / 140) * 60);

  dbRun(
    `UPDATE script_docs SET parsed_json = ?, warnings_count = ?, segments_count = ?,
     blocks_count = ?, words_count = ?, est_duration_seconds = ?, updated_at = ? WHERE id = ?`,
    [
      JSON.stringify(parsed),
      parsed.warnings.length,
      parsed.segments.length,
      blocksCount,
      wc,
      estDuration,
      new Date().toISOString(),
      id,
    ],
  );
}

// ── Chart tag helpers ──

function resolveStatTags(data: string): string {
  // [STAT: description | fallback | type] → fallback value
  return data.replace(/\[STAT:\s*[^|]+?\|\s*([^|]+?)\s*\|[^\]]*\]/gi, (_, fallback) => fallback.trim());
}

function parseChartTag(rawTagValue: string): ChartSpec {
  // Format: type | data | "title" | source label
  // Pipe-split — minimum 2 parts required
  const parts = rawTagValue.split(/\s*\|\s*/);
  if (parts.length < 2) throw new Error('CHART tag requires at least: type | data');

  const chartType = parts[0].trim().toLowerCase();
  if (!['big-number', 'line', 'bars', 'vs'].includes(chartType)) {
    throw new Error(`Unknown chart type "${chartType}". Use: big-number | line | bars | vs`);
  }

  const rawData = parts[1]?.trim() ?? '';
  const title = (parts[2]?.trim() ?? '').replace(/^["']|["']$/g, '');
  const sourceLabel = parts[3]?.trim() ?? '';

  const data = resolveStatTags(rawData);
  const spec: ChartSpec = { type: chartType as ChartSpec['type'], title: title || undefined, sourceLabel: sourceLabel || undefined, data: rawData };

  if (chartType === 'big-number') {
    const m = data.trim().match(/^([^\d\-]*)?([\d,\.]+)(.*)$/);
    if (m) {
      spec.parsedData = {
        prefix: m[1].trim() || undefined,
        value: parseFloat(m[2].replace(/,/g, '')),
        suffix: m[3].trim() || undefined,
      };
    }
  } else if (chartType === 'line') {
    // Split on ", " (comma + space) to avoid breaking values like $2,070
    const points = data.split(/,\s+(?=[^,]+:)/).map((s) => {
      const colonIdx = s.lastIndexOf(':');
      const label = s.slice(0, colonIdx).trim();
      const value = parseFloat(s.slice(colonIdx + 1).trim().replace(/[^\d\.\-]/g, ''));
      return { label, value };
    }).filter((p) => !isNaN(p.value) && p.label);
    spec.parsedData = { points };
  } else if (chartType === 'bars') {
    // Split on ", " (comma + space) to avoid breaking values like $2,070
    const bars = data.split(/,\s+(?=[^,]+:)/).map((s) => {
      const colonIdx = s.lastIndexOf(':');
      const name = s.slice(0, colonIdx).trim();
      const value = parseFloat(s.slice(colonIdx + 1).trim().replace(/[^\d\.\-]/g, ''));
      return { name, value };
    }).filter((b) => !isNaN(b.value) && b.name);
    spec.parsedData = { bars };
  } else if (chartType === 'vs') {
    // Split on ", " (comma + space) to avoid breaking values like $2,070
    const items = data.split(/,\s+(?=[^,]+:)/);
    if (items.length >= 2) {
      const [leftPart, rightPart] = items;
      const li = leftPart.lastIndexOf(':');
      const ri = rightPart.lastIndexOf(':');
      spec.parsedData = {
        leftLabel: leftPart.slice(0, li).trim(),
        leftValue: leftPart.slice(li + 1).trim(),
        rightLabel: rightPart.slice(0, ri).trim(),
        rightValue: rightPart.slice(ri + 1).trim(),
      };
    }
  }

  return spec;
}

// ── Parser ──

type LogCallback = (level: LogLevel, message: string) => void;

export function parseScript(rawMarkdown: string, onLog?: LogCallback): ParsedScript {
  const lines = rawMarkdown.split(/\r?\n/);
  const log = onLog || (() => {});
  log('info', `Reading markdown (${lines.length} lines)`);

  let title = '';
  const segments: ScriptSegment[] = [];
  const warnings: ParseWarning[] = [];
  const productionNotes: ProductionNotes = {};

  let inProductionNotes = false;
  let currentNoteSection: 'sources' | 'chapters' | 'thumbnail' | null = null;
  const noteLines: Record<string, string[]> = { sources: [], chapters: [], thumbnail: [] };

  let currentSegment: ScriptSegment | null = null;
  let segmentIndex = 0;

  // Scene tracking (reset per segment)
  let scenePositionInSegment = 0;
  let segmentHasExplicitSceneMarkers = false;

  // Character definitions: @id → description (for @id expansion in FLOW prompts)
  const characters: Record<string, string> = {};
  const voiceGroups: VoiceGroup[] = [];
  let docVoiceConfig: string | undefined;

  let pendingTags: Array<{ type: 'pexels' | 'overlay' | 'chart' | 'pace' | 'flow' | 'voice' | 'unknown'; value: string }> = [];
  let currentNarrationLines: string[] = [];

  function flushNarration() {
    // Resolve inline [STAT: label | fallback | type] → substitute fallback value
    // Collapse multiple consecutive empty lines, then trim edges
    const rawNarration = currentNarrationLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const narrationText = rawNarration.replace(/\[STAT:\s*[^|[\]]+\|\s*([^|[\]]+)\|[^\]]*\]/gi, (_, fb) => fb.trim());
    if (!narrationText && pendingTags.length === 0) return;

    if (currentSegment) {
      scenePositionInSegment++;
      const block: ScriptBlock = { narration: narrationText, overlays: [], sceneNumber: scenePositionInSegment };
      const notesParts: string[] = [];

      for (const tag of pendingTags) {
        if (tag.type === 'pexels') block.pexelsQuery = tag.value;
        else if (tag.type === 'chart') block.chartSpec = JSON.parse(tag.value) as ChartSpec;
        else if (tag.type === 'overlay') block.overlays.push(tag.value);
        else if (tag.type === 'pace') block.paceHint = tag.value as 'slow' | 'fast';
        else if (tag.type === 'flow') block.flowPrompt = tag.value;
        else if (tag.type === 'voice') block.voiceConfig = tag.value;
        else notesParts.push(tag.value);
      }
      if (notesParts.length > 0) block.notes = notesParts.join('\n');

      if (block.narration || block.pexelsQuery || block.chartSpec || block.overlays.length > 0) {
        currentSegment.blocks.push(block);
      }
    }
    pendingTags = [];
    currentNarrationLines = [];
  }

  function flushSegment() {
    flushNarration();
    scenePositionInSegment = 0;
    segmentHasExplicitSceneMarkers = false;
    if (currentSegment) {
      const queryCount = currentSegment.blocks.filter((b) => b.pexelsQuery).length;
      const overlayCount = currentSegment.blocks.reduce((s, b) => s + b.overlays.length, 0);
      log(
        'info',
        `Segment ${currentSegment.index}: ${currentSegment.blocks.length} blocks, ${queryCount} queries, ${overlayCount} overlays`,
      );

      // Warn about blocks with no query or chart
      currentSegment.blocks.forEach((b, bi) => {
        if (!b.pexelsQuery && !b.chartSpec && b.narration) {
          const w: ParseWarning = {
            level: 'warn',
            message: `No PEXELS query or CHART — will inherit previous block's clip`,
            location: `Segment ${currentSegment!.index} "${currentSegment!.name}", scene ${b.sceneNumber ?? bi + 1}`,
          };
          warnings.push(w);
          log('warn', `${w.location}: ${w.message}`);
        }
      });

      segments.push(currentSegment);
    }
    currentSegment = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip horizontal rules
    if (/^[-*_]{3,}$/.test(trimmed)) continue;

    // Production notes heading
    if (/^#{1,2}\s+.*production\s+notes/i.test(trimmed)) {
      flushSegment();
      inProductionNotes = true;
      currentNoteSection = null;
      log('info', 'Entering PRODUCTION NOTES section');
      continue;
    }

    if (inProductionNotes) {
      if (/^#{1,3}\s+/.test(trimmed)) {
        const headingText = trimmed.replace(/^#{1,3}\s+/, '').toLowerCase();
        if (/source|stat|reference/i.test(headingText)) currentNoteSection = 'sources';
        else if (/chapter|marker|timestamp/i.test(headingText)) currentNoteSection = 'chapters';
        else if (/thumbnail|thumb/i.test(headingText)) currentNoteSection = 'thumbnail';
        else currentNoteSection = 'sources';
      } else if (currentNoteSection) {
        noteLines[currentNoteSection].push(line);
      } else {
        noteLines.sources.push(line);
      }
      continue;
    }

    // Title
    if (/^#\s+/.test(trimmed) && !title) {
      title = trimmed.replace(/^#\s+/, '').replace(/^VIDEO\s*#?\d+\s*[—–\-]\s*/i, '').trim();
      log('info', `Title: "${title}"`);
      continue;
    }

    // Skip comment lines after title (lines starting with "# text" that aren't headings or production notes)
    if (/^#\s/.test(trimmed) && title && !inProductionNotes) continue;

    // ### SCENE N — explicit block boundary marker within a segment
    const sceneMarkerMatch = trimmed.match(/^###\s+SCENE\s+(\d+)/i);
    if (sceneMarkerMatch) {
      if (currentSegment) {
        const explicitNum = parseInt(sceneMarkerMatch[1], 10);
        const expectedNext = scenePositionInSegment + 1;
        // Flush any pending narration/tags as the previous block
        if (currentNarrationLines.some((l) => l.trim()) || pendingTags.length > 0) {
          flushNarration();
        }
        // Sanity-check explicit number vs sequential position
        if (segmentHasExplicitSceneMarkers && explicitNum !== expectedNext) {
          const w: ParseWarning = {
            level: 'warn',
            message: explicitNum < expectedNext
              ? `### SCENE ${explicitNum} goes backwards (expected ${expectedNext}); sequential position used`
              : `### SCENE ${explicitNum} skips scene(s) (expected ${expectedNext}); sequential position used`,
            location: `Segment ${currentSegment.index} "${currentSegment.name}"`,
          };
          warnings.push(w);
          log('warn', `${w.location}: ${w.message}`);
        }
        if (!segmentHasExplicitSceneMarkers) {
          log('info', `Segment ${currentSegment.index}: explicit ### SCENE markers detected`);
        }
        segmentHasExplicitSceneMarkers = true;
      }
      continue;
    }

    // Segment header: ## SEGMENT N — NAME (time)
    const segMatch = trimmed.match(
      /^#{1,3}\s+(?:SEGMENT\s+)?(\d+)\s*[—–:\-]\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/i,
    );
    if (segMatch) {
      flushSegment();
      segmentIndex++;
      currentSegment = { index: segmentIndex, name: segMatch[2].trim(), timeRange: segMatch[3]?.trim(), blocks: [] };
      log('info', `Found segment ${segmentIndex}: ${currentSegment.name}${currentSegment.timeRange ? ` (${currentSegment.timeRange})` : ''}`);
      continue;
    }

    // Alt segment header: ## COLD OPEN (0:00–0:25)
    const segAlt = trimmed.match(/^#{2,3}\s+([A-Z][A-Z\s&]+?)(?:\s*\(([^)]+)\))?\s*$/);
    if (segAlt && (!currentSegment || !currentSegment.blocks.length)) {
      flushSegment();
      segmentIndex++;
      currentSegment = { index: segmentIndex, name: segAlt[1].trim(), timeRange: segAlt[2]?.trim(), blocks: [] };
      log('info', `Found segment ${segmentIndex}: ${currentSegment.name}${currentSegment.timeRange ? ` (${currentSegment.timeRange})` : ''}`);
      continue;
    }

    // Bracket tags — use a relaxed regex that handles nested brackets (e.g., [STAT:] inside [CHART:])
    const tagMatch = trimmed.match(/^\[([A-Z][A-Z_\s]*?):\s*([\s\S]+)\]$/i);

    // Handle doc-level tags (VOICE, VOICE_GROUP, CHARACTER) BEFORE auto-segment creation
    // so they don't accidentally trigger a segment when placed at the top of the script
    if (tagMatch && !currentSegment && !inProductionNotes) {
      const preTagType = tagMatch[1].trim().toUpperCase();
      if (preTagType === 'VOICE' || preTagType === 'VOICE_GROUP' || preTagType === 'CHARACTER') {
        // Will be handled below in the main tag switch — skip auto-segment
      } else {
        // Non-doc-level tag before any segment — auto-create
        segmentIndex++;
        currentSegment = { index: segmentIndex, name: `Segment ${segmentIndex}`, blocks: [] };
        log('info', `Auto-created segment ${segmentIndex} (no heading found)`);
      }
    } else if (!currentSegment && trimmed && !inProductionNotes && !tagMatch) {
      // Auto-create segment for plain text lines
      segmentIndex++;
      currentSegment = { index: segmentIndex, name: `Segment ${segmentIndex}`, blocks: [] };
      log('info', `Auto-created segment ${segmentIndex} (no heading found)`);
    }
    if (tagMatch) {
      const tagType = tagMatch[1].trim().toUpperCase();
      let tagValue = tagMatch[2].trim();

      if (tagType === 'PACE') {
        const hint = tagValue.toLowerCase().trim();
        if (hint === 'slow' || hint === 'fast') {
          pendingTags.push({ type: 'pace', value: hint });
        } else {
          const w: ParseWarning = {
            level: 'warn',
            message: `[PACE:] value must be "slow" or "fast", got "${tagValue}"`,
            location: currentSegment ? `Segment ${currentSegment.index} "${currentSegment.name}"` : 'Before first segment',
          };
          warnings.push(w);
          log('warn', `${w.location}: ${w.message}`);
        }
      } else if (tagType === 'PEXELS') {
        // Only flush on PEXELS-after-narration when there are NO explicit ### SCENE markers.
        // With explicit scene markers the ### SCENE boundary controls blocks, not the tag position.
        if (!segmentHasExplicitSceneMarkers && currentNarrationLines.length > 0 && currentNarrationLines.some((l) => l.trim())) {
          flushNarration();
        }
        pendingTags.push({ type: 'pexels', value: tagValue });
      } else if (tagType === 'TEXT ON SCREEN') {
        tagValue = tagValue.replace(/^["']|["']$/g, '');
        if (!segmentHasExplicitSceneMarkers && currentNarrationLines.length > 0 && currentNarrationLines.some((l) => l.trim())) {
          flushNarration();
        }
        pendingTags.push({ type: 'overlay', value: tagValue });
      } else if (tagType === 'CHART') {
        if (!segmentHasExplicitSceneMarkers && currentNarrationLines.length > 0 && currentNarrationLines.some((l) => l.trim())) {
          flushNarration();
        }
        try {
          const spec = parseChartTag(tagValue);
          pendingTags.push({ type: 'chart', value: JSON.stringify(spec) });
          log('info', `Chart tag: type=${spec.type} title="${spec.title || ''}" source="${spec.sourceLabel || ''}"`);
        } catch (chartErr) {
          const w: ParseWarning = {
            level: 'warn',
            message: `Invalid [CHART:] tag: ${(chartErr as Error).message}`,
            location: currentSegment ? `Segment ${currentSegment.index} "${currentSegment.name}"` : 'Before first segment',
          };
          warnings.push(w);
          log('warn', `${w.location}: ${w.message}`);
        }
      } else if (tagType === 'CHARACTER') {
        // [CHARACTER: id | description] — defines @id for expansion in FLOW prompts
        const parts = tagValue.split('|').map((s) => s.trim());
        if (parts.length >= 2) {
          characters[parts[0]] = parts.slice(1).join(' | ');
          log('info', `Character defined: @${parts[0]}`);
        } else {
          const w: ParseWarning = {
            level: 'warn',
            message: `[CHARACTER:] requires "id | description", got "${tagValue}"`,
            location: currentSegment ? `Segment ${currentSegment.index} "${currentSegment.name}"` : 'Before first segment',
          };
          warnings.push(w);
          log('warn', `${w.location}: ${w.message}`);
        }
      } else if (tagType === 'VOICE_GROUP') {
        // [VOICE_GROUP: id | engine:omnivoice | voice:persona-id | emotion:warm | rate:+5%]
        // Only valid before first segment (doc-level)
        if (currentSegment) {
          const w: ParseWarning = {
            level: 'warn',
            message: '[VOICE_GROUP:] must appear before the first segment',
            location: `Segment ${currentSegment.index} "${currentSegment.name}"`,
          };
          warnings.push(w);
          log('warn', `${w.location}: ${w.message}`);
        } else {
          const parts = tagValue.split('|').map((s) => s.trim()).filter(Boolean);
          if (parts.length < 2) {
            const w: ParseWarning = {
              level: 'warn',
              message: `[VOICE_GROUP:] requires at least "id | engine:..." or "id | voice:...", got "${tagValue}"`,
              location: 'Before first segment',
            };
            warnings.push(w);
            log('warn', `${w.location}: ${w.message}`);
          } else {
            const id = parts[0];
            let engine = 'edge-tts';
            let voiceId = '';
            let emotion: string | undefined;
            let rate: string | undefined;
            let pitch: string | undefined;
            let fallbackVoice: string | undefined;
            for (let pi = 1; pi < parts.length; pi++) {
              const colonIdx = parts[pi].indexOf(':');
              if (colonIdx > 0) {
                const k = parts[pi].slice(0, colonIdx).trim().toLowerCase();
                const v = parts[pi].slice(colonIdx + 1).trim();
                if (k === 'engine') engine = v;
                else if (k === 'voice') voiceId = v;
                else if (k === 'emotion') emotion = v;
                else if (k === 'rate') rate = v;
                else if (k === 'pitch') pitch = v;
                else if (k === 'fallback-voice' || k === 'fallback') fallbackVoice = v;
              }
            }
            const group: VoiceGroup = { id, engine, voiceId, emotion, rate, pitch, fallbackVoice };
            voiceGroups.push(group);
            log('info', `Voice group defined: ${id} (engine: ${engine})`);
          }
        }
      } else if (tagType === 'VOICE') {
        // Doc-level [VOICE: voice-name | rate:X%] before first segment sets default TTS config
        // Per-block [VOICE: pause-before:Nms | rate:X%] stored on the block
        if (!currentSegment) {
          docVoiceConfig = tagValue;
          log('info', `Document voice config: ${tagValue}`);
        } else {
          pendingTags.push({ type: 'voice', value: tagValue });
        }
      } else if (tagType === 'FLOW') {
        // [FLOW: auto] = build prompt from block at produce time
        // [FLOW: cinematic prompt text] = explicit AI generation prompt
        if (!segmentHasExplicitSceneMarkers && currentNarrationLines.length > 0 && currentNarrationLines.some((l) => l.trim())) {
          flushNarration();
        }
        // Expand @character references in the prompt
        let flowValue = tagValue.trim().toLowerCase() === 'auto' ? '__auto__' : tagValue.trim();
        if (flowValue !== '__auto__' && Object.keys(characters).length > 0) {
          for (const [charId, charDesc] of Object.entries(characters)) {
            flowValue = flowValue.replace(
              new RegExp(`@${charId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
              charDesc,
            );
          }
        }
        // Conflict with pending chart tag: chart wins
        const hasPendingChart = pendingTags.some((t) => t.type === 'chart');
        if (hasPendingChart) {
          const w: ParseWarning = {
            level: 'warn',
            message: '[CHART:] and [FLOW:] both present — chart takes priority',
            location: currentSegment ? `Segment ${currentSegment.index} "${currentSegment.name}"` : 'Before first segment',
          };
          warnings.push(w);
          log('warn', `${w.location}: ${w.message}`);
        } else {
          pendingTags.push({ type: 'flow', value: flowValue });
          log('info', `Flow tag: ${flowValue === '__auto__' ? 'auto-build prompt' : `prompt="${flowValue.slice(0, 60)}..."`}`);
        }
      } else {
        const w: ParseWarning = {
          level: 'warn',
          message: `Unknown tag [${tagType}: ${tagValue}] stored as note`,
          location: currentSegment ? `Segment ${currentSegment.index} "${currentSegment.name}"` : 'Before first segment',
        };
        warnings.push(w);
        log('warn', `${w.location}: ${w.message}`);
        pendingTags.push({ type: 'unknown', value: `[${tagType}: ${tagValue}]` });
      }
      continue;
    }

    // Empty line = paragraph break
    if (!trimmed) {
      if (segmentHasExplicitSceneMarkers) {
        // Inside a segment with explicit ### SCENE markers: preserve empty lines as paragraph
        // breaks inside the current scene block rather than creating a new block.
        if (currentNarrationLines.length > 0) currentNarrationLines.push('');
      } else if (currentNarrationLines.length > 0 && currentNarrationLines.some((l) => l.trim())) {
        flushNarration();
      }
      continue;
    }

    // Narration text
    currentNarrationLines.push(trimmed);
  }

  // Flush remaining
  if (!inProductionNotes) flushSegment();

  // Production notes
  const sourcesText = noteLines.sources.join('\n').trim();
  const chaptersText = noteLines.chapters.join('\n').trim();
  const thumbnailText = noteLines.thumbnail.join('\n').trim();
  if (sourcesText) productionNotes.sourcesText = sourcesText;
  if (chaptersText) productionNotes.chaptersText = chaptersText;
  if (thumbnailText) productionNotes.thumbnailText = thumbnailText;

  const hasNotes = sourcesText || chaptersText || thumbnailText;
  if (hasNotes) {
    const parts = [sourcesText ? 'sources' : '', chaptersText ? 'chapters' : '', thumbnailText ? 'thumbnail' : '']
      .filter(Boolean)
      .map((p) => `${p} ✓`)
      .join(' ');
    log('info', `Captured production notes: ${parts}`);
  } else {
    const w: ParseWarning = { level: 'info', message: 'No PRODUCTION NOTES section found' };
    warnings.push(w);
    log('info', w.message);
  }

  const totalBlocks = segments.reduce((s, seg) => s + seg.blocks.length, 0);
  const allNarration = segments.flatMap((seg) => seg.blocks.map((b) => b.narration)).filter(Boolean).join(' ');
  const wc = countWords(allNarration);
  const estSec = Math.round((wc / 140) * 60);
  const estMin = Math.floor(estSec / 60);
  const estRemSec = estSec % 60;

  log(
    'success',
    `Parse complete: ${segments.length} segments, ${totalBlocks} blocks, ${wc.toLocaleString()} words, ~${estMin}m ${estRemSec.toString().padStart(2, '0')}s at 140 wpm`,
  );
  if (warnings.length > 0) {
    log('warn', `${warnings.length} warning(s) found`);
  }

  return { title: title || 'Untitled Script', segments, productionNotes, warnings, characters, voiceConfig: docVoiceConfig, voiceGroups };
}

// ── Clean narration ──

export function getCleanNarration(parsed: ParsedScript): string {
  return parsed.segments
    .map((seg) =>
      seg.blocks
        .map((b) => b.narration)
        .filter(Boolean)
        .join('\n\n'),
    )
    .filter(Boolean)
    .join('\n\n');
}

// ── Voice config utilities ──

export function parseVoiceConfig(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};
  const parts = raw.split('|').map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      result[part.slice(0, colonIdx).trim()] = part.slice(colonIdx + 1).trim();
    } else {
      // bare value = voice name (legacy format)
      result['voice'] = part.trim();
    }
  }
  return result;
}

export function resolveBlockVoice(
  blockVoiceConfig: string | null | undefined,
  docVoiceConfig: string | null | undefined,
  voiceGroups: VoiceGroup[],
  appDefaults: { voice: string; rate: string },
): ResolvedVoiceConfig {
  const blockParsed = parseVoiceConfig(blockVoiceConfig);
  const docParsed = parseVoiceConfig(docVoiceConfig);

  // Find referenced group
  const groupId = blockParsed.group || docParsed.group;
  const group = groupId ? voiceGroups.find(g => g.id === groupId) : undefined;

  // Resolution order: block > group > doc > app defaults
  const engine = (blockParsed.engine || group?.engine || docParsed.engine || 'edge-tts') as 'edge-tts' | 'omnivoice';
  const voiceId = blockParsed.voice || group?.voiceId || docParsed.voice || appDefaults.voice;
  const fallbackVoice = group?.fallbackVoice || blockParsed['fallback-voice'] || blockParsed['fallback'];
  const emotion = blockParsed.emotion || group?.emotion || docParsed.emotion;
  const rate = blockParsed.rate || group?.rate || docParsed.rate || appDefaults.rate;
  const pitch = blockParsed.pitch || group?.pitch || docParsed.pitch;

  const pauseBefore = blockParsed['pause-before'] ? parseInt(blockParsed['pause-before']) : undefined;
  const pauseAfter = blockParsed['pause-after'] ? parseInt(blockParsed['pause-after']) : undefined;

  return { engine, voiceId, fallbackVoice, emotion, rate, pitch, pauseBefore, pauseAfter, group: groupId };
}

// ── Alignment (positional word-offset) ──

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenizeArray(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean);
}

interface FlatBlock {
  blockIndex: number;
  segmentIndex: number;
  segmentName: string;
  sceneNumber: number;
  block: ScriptBlock;
  startWord: number; // inclusive
  endWord: number;   // exclusive
}

export function alignToSegments(
  parsed: ParsedScript,
  transcriptEntries: Array<{ index: number; text: string; startMs: number; endMs: number }>,
  onLog?: LogCallback,
): AlignmentResult {
  const log = onLog || (() => {});

  // 1. Build reference word sequence from all blocks in order
  const flatBlocks: FlatBlock[] = [];
  let wordCursor = 0;
  let blockIdx = 0;
  let sceneInSeg = 0;
  let prevSegIdx = -1;
  for (const seg of parsed.segments) {
    for (const block of seg.blocks) {
      if (seg.index !== prevSegIdx) { sceneInSeg = 0; prevSegIdx = seg.index; }
      sceneInSeg++;
      const words = tokenizeArray(block.narration);
      flatBlocks.push({
        blockIndex: blockIdx++,
        segmentIndex: seg.index,
        segmentName: seg.name,
        sceneNumber: block.sceneNumber ?? sceneInSeg,
        block,
        startWord: wordCursor,
        endWord: wordCursor + words.length,
      });
      wordCursor += words.length;
    }
  }
  const refWordCount = wordCursor;

  if (flatBlocks.length === 0 || transcriptEntries.length === 0) {
    log('warn', 'No blocks or transcript entries to align');
    return {
      alignments: transcriptEntries.map((te) => ({
        segmentIndex: te.index,
        segmentText: te.text,
        matchedBlock: null,
        confidence: 0,
      })),
      chapterMarkers: [],
    };
  }

  // 2. Count total transcript words
  const segWordCounts = transcriptEntries.map((e) => tokenizeArray(e.text).length);
  const transcriptWordCount = segWordCounts.reduce((a, b) => a + b, 0);

  log('info', `Positional alignment: ${transcriptEntries.length} transcript segments (${transcriptWordCount} words) → ${flatBlocks.length} script blocks (${refWordCount} words)`);

  // Safety guard: word count divergence
  if (refWordCount > 0) {
    const divergence = Math.abs(transcriptWordCount - refWordCount) / refWordCount;
    if (divergence > 0.15) {
      log('warn', `Transcript/script word counts diverge: ${transcriptWordCount} vs ${refWordCount} (${(divergence * 100).toFixed(0)}%) — was the narration edited after TTS?`);
    }
  }

  // 3. Walk transcript segments positionally
  let cursor = 0;
  const alignments: AlignedSegment[] = [];
  const blockSegmentCounts = new Map<number, number>();
  let driftWarnings = 0;

  for (let i = 0; i < transcriptEntries.length; i++) {
    const entry = transcriptEntries[i];
    const segWords = segWordCounts[i];
    const segStart = cursor;
    const segEnd = cursor + segWords;
    cursor = segEnd;

    // Find the block with maximum word overlap
    let bestBlock: FlatBlock | null = null;
    let bestOverlap = 0;

    for (const fb of flatBlocks) {
      const overlapStart = Math.max(segStart, fb.startWord);
      const overlapEnd = Math.min(segEnd, fb.endWord);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > bestOverlap || (overlap === bestOverlap && overlap > 0 && bestBlock && fb.blockIndex < bestBlock.blockIndex)) {
        bestOverlap = overlap;
        bestBlock = fb;
      }
    }

    const confidence = segWords > 0 ? bestOverlap / segWords : 0;

    if (bestBlock) {
      blockSegmentCounts.set(bestBlock.blockIndex, (blockSegmentCounts.get(bestBlock.blockIndex) || 0) + 1);

      // Drift correction: verify token overlap
      const segTokens = new Set(tokenizeArray(entry.text));
      const blockTokens = new Set(tokenizeArray(bestBlock.block.narration));
      let tokenOverlap = 0;
      for (const t of segTokens) {
        if (blockTokens.has(t)) tokenOverlap++;
      }
      const tokenOverlapFrac = segTokens.size > 0 ? tokenOverlap / segTokens.size : 0;

      if (tokenOverlapFrac < 0.2 && segTokens.size > 0) {
        driftWarnings++;
        log('warn', `Segment ${i + 1}/${transcriptEntries.length}: low token overlap (${(tokenOverlapFrac * 100).toFixed(0)}%) with "${bestBlock.segmentName}" Segment ${bestBlock.segmentIndex}, Scene ${bestBlock.sceneNumber} — "${entry.text.slice(0, 60)}…" vs "${bestBlock.block.narration.slice(0, 60)}…"`);
      }

      log('info', `Segment ${i + 1}/${transcriptEntries.length} → ${bestBlock.segmentName}, Scene ${bestBlock.sceneNumber} (words ${segStart}–${segEnd}, overlap ${confidence.toFixed(2)})`);

      alignments.push({
        segmentIndex: entry.index,
        segmentText: entry.text,
        matchedBlock: {
          pexelsQuery: bestBlock.block.pexelsQuery,
          overlays: bestBlock.block.overlays,
          segmentName: bestBlock.segmentName,
        },
        confidence,
      });
    } else {
      alignments.push({
        segmentIndex: entry.index,
        segmentText: entry.text,
        matchedBlock: null,
        confidence: 0,
      });
    }
  }

  // Safety guard: check if any single block got >40% of all segments
  for (const [bIdx, count] of blockSegmentCounts) {
    const pct = count / transcriptEntries.length;
    if (pct > 0.4) {
      const fb = flatBlocks[bIdx];
      log('warn', `Segment ${fb.segmentIndex}, Scene ${fb.sceneNumber} ("${fb.segmentName}") received ${count}/${transcriptEntries.length} segments (${(pct * 100).toFixed(0)}%) — possible alignment issue`);
    }
  }

  // Build chapter markers (first aligned segment per script segment)
  const chapterMarkers: string[] = [];
  const segmentFirstTimestamp = new Map<string, number>();
  for (const a of alignments) {
    if (a.matchedBlock && !segmentFirstTimestamp.has(a.matchedBlock.segmentName)) {
      const entry = transcriptEntries.find((e) => e.index === a.segmentIndex);
      if (entry) segmentFirstTimestamp.set(a.matchedBlock.segmentName, entry.startMs);
    }
  }
  for (const seg of parsed.segments) {
    const ms = segmentFirstTimestamp.get(seg.name);
    if (ms !== undefined) {
      const totalSec = Math.floor(ms / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      chapterMarkers.push(`${min}:${sec.toString().padStart(2, '0')} ${seg.name}`);
    }
  }

  // Summary stats
  const counts = Array.from(blockSegmentCounts.values());
  const minPerBlock = counts.length > 0 ? Math.min(...counts) : 0;
  const maxPerBlock = counts.length > 0 ? Math.max(...counts) : 0;
  const meanConf = alignments.length > 0
    ? alignments.reduce((s, a) => s + a.confidence, 0) / alignments.length
    : 0;

  log(
    'success',
    `${alignments.length} segments → ${blockSegmentCounts.size} blocks (min ${minPerBlock}, max ${maxPerBlock} per block), mean confidence ${meanConf.toFixed(2)}${driftWarnings > 0 ? `, ${driftWarnings} drift warning(s)` : ''}, ${chapterMarkers.length} chapters`,
  );

  return { alignments, chapterMarkers };
}

// ── CRUD ──

export function createDoc(rawMarkdown: string, titleOverride?: string, sourceRef?: string, onLog?: LogCallback): { id: string; title: string; parsed: ParsedScript } {
  const id = randomUUID();
  const parsed = parseScript(rawMarkdown, onLog);
  const finalTitle = titleOverride || parsed.title;
  const now = new Date().toISOString();
  const blocksCount = parsed.segments.reduce((s, seg) => s + seg.blocks.length, 0);
  const allNarration = parsed.segments.flatMap((seg) => seg.blocks.map((b) => b.narration)).filter(Boolean).join(' ');
  const wc = countWords(allNarration);
  const estDuration = Math.round((wc / 140) * 60);

  dbRun(
    `INSERT INTO script_docs (id, title, raw_markdown, parsed_json, source_ref, status, warnings_count, segments_count, blocks_count, words_count, est_duration_seconds, subtitle_style, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'parsed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, finalTitle, rawMarkdown, JSON.stringify(parsed), sourceRef ?? null, parsed.warnings.length, parsed.segments.length, blocksCount, wc, estDuration, JSON.stringify({
      enabled: true,
      fontFamily: 'Arial',
      fontSize: 24,
      fontColor: '#FFFFFF',
      fontWeight: 'bold',
      strokeColor: '#000000',
      strokeWidth: 2,
      bgColor: '#000000',
      bgOpacity: 0.5,
      position: 'bottom',
      alignment: 'center',
      marginX: 40,
      marginBottom: 60,
      uppercase: false,
      animation: 'none',
    }), now, now],
  );

  addLog(id, 'success', 'parse', `Document created and parsed: ${parsed.segments.length} segments, ${blocksCount} blocks, ${wc} words`);
  addLog(id, 'info', 'status_change', 'Status: draft → parsed');

  syncBlocksFromParsed(id, parsed);

  return { id, title: finalTitle, parsed };
}

export function updateDoc(id: string, rawMarkdown: string, titleOverride?: string, onLog?: LogCallback): { id: string; title: string; parsed: ParsedScript } {
  const parsed = parseScript(rawMarkdown, onLog);
  const finalTitle = titleOverride || parsed.title;
  const now = new Date().toISOString();

  dbRun(
    `UPDATE script_docs SET title = ?, raw_markdown = ?, status = 'parsed', updated_at = ? WHERE id = ?`,
    [finalTitle, rawMarkdown, now, id],
  );
  updateDocMeta(id, parsed);

  addLog(id, 'success', 'parse', `Document re-parsed: ${parsed.segments.length} segments, ${parsed.warnings.length} warnings`);
  addLog(id, 'info', 'status_change', 'Status → parsed (re-parse)');

  syncBlocksFromParsed(id, parsed);

  return { id, title: finalTitle, parsed };
}

export function getDoc(id: string) {
  const row = dbGet<ScriptDocRow>(`SELECT * FROM script_docs WHERE id = ?`, [id]);
  if (!row) return null;
  return rowToDoc(row);
}

export function listDocs() {
  const rows = dbAll<ScriptDocRow>(`SELECT * FROM script_docs ORDER BY updated_at DESC`);
  return rows.map(rowToDoc);
}

function rowToDoc(row: ScriptDocRow) {
  return {
    id: row.id,
    title: row.title,
    rawMarkdown: row.raw_markdown,
    parsed: JSON.parse(row.parsed_json) as ParsedScript,
    sourceRef: row.source_ref,
    status: row.status,
    linkedStoryboardId: row.linked_storyboard_id,
    warningsCount: row.warnings_count,
    segmentsCount: row.segments_count,
    blocksCount: row.blocks_count,
    wordsCount: row.words_count,
    estDurationSeconds: row.est_duration_seconds,
    subtitleStyle: row.subtitle_style ? JSON.parse(row.subtitle_style) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteDoc(id: string) {
  dbRun(`DELETE FROM script_docs WHERE id = ?`, [id]);
}

export function setDocStatus(id: string, status: DocStatus) {
  const doc = getDoc(id);
  if (!doc) return;
  const oldStatus = doc.status;
  dbRun(`UPDATE script_docs SET status = ?, updated_at = ? WHERE id = ?`, [status, new Date().toISOString(), id]);
  addLog(id, 'info', 'status_change', `Status: ${oldStatus} → ${status}`);
}

export function linkStoryboard(id: string, storyboardId: string) {
  dbRun(`UPDATE script_docs SET linked_storyboard_id = ?, updated_at = ? WHERE id = ?`, [storyboardId, new Date().toISOString(), id]);
}

export function markNarrationCopied(id: string) {
  const doc = getDoc(id);
  if (!doc) return;
  if (doc.status === 'parsed') {
    setDocStatus(id, 'narration_copied');
  }
  addLog(id, 'info', 'copy', 'Clean narration copied to clipboard');
}

export function getLogs(docId: string, limit = 200) {
  return dbAll<LogRow>(
    `SELECT * FROM script_doc_logs WHERE doc_id = ? ORDER BY ts DESC LIMIT ?`,
    [docId, limit],
  );
}

// ── Block helpers ──

function rowToBlock(row: ScriptBlockRow): ScriptBlockRecord {
  return {
    id: row.id,
    docId: row.doc_id,
    blockIndex: row.block_index,
    segmentIndex: row.segment_index,
    segmentName: row.segment_name,
    sceneNumber: row.scene_number || row.block_index + 1,
    narration: row.narration,
    pexelsQuery: row.pexels_query,
    chartSpec: row.chart_spec_json ? (JSON.parse(row.chart_spec_json) as ChartSpec) : null,
    overlays: JSON.parse(row.overlays_json || '[]') as string[],
    paceHint: row.pace_hint ?? null,
    contentHash: row.content_hash,
    audioPath: row.audio_path,
    audioDurationMs: row.audio_duration_ms,
    audioEngine: row.audio_engine ?? null,
    words: row.words_json ? (JSON.parse(row.words_json) as Array<{ word: string; offset_ms: number; duration_ms: number }>) : null,
    visualType: row.visual_type,
    clipAssetPath: row.clip_asset_path,
    clips: row.clips_json ? (JSON.parse(row.clips_json) as BlockClip[]) : [],
    clipsJson: row.clips_json,
    motion: row.motion,
    renderedClipPath: row.rendered_clip_path,
    status: row.status,
    errorMsg: row.error_msg,
    aiPrompt: row.ai_prompt,
    aiAssetPath: row.ai_asset_path,
    aiMeta: row.ai_meta_json ? (JSON.parse(row.ai_meta_json) as Record<string, unknown>) : null,
    voiceConfig: row.voice_config ?? null,
    clipStartSec: row.clip_start_sec ?? null,
    clipEndSec: row.clip_end_sec ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listBlocks(docId: string): ScriptBlockRecord[] {
  const rows = dbAll<ScriptBlockRow>(`SELECT * FROM script_blocks WHERE doc_id = ? ORDER BY block_index`, [docId]);
  return rows.map(rowToBlock);
}

export function getBlock(docId: string, blockIndex: number): ScriptBlockRecord | null {
  const row = dbGet<ScriptBlockRow>(`SELECT * FROM script_blocks WHERE doc_id = ? AND block_index = ?`, [docId, blockIndex]);
  return row ? rowToBlock(row) : null;
}

export function updateBlockVisual(docId: string, blockIndex: number, fields: {
  pexelsQuery?: string | null;
  motion?: string;
  clipAssetPath?: string | null;
  visualType?: string;
  aiPrompt?: string | null;
  clipStartSec?: number | null;
  clipEndSec?: number | null;
}): void {
  const now = new Date().toISOString();
  const updates: string[] = [];
  const vals: unknown[] = [];

  if ('pexelsQuery' in fields) { updates.push('pexels_query = ?'); vals.push(fields.pexelsQuery ?? null); }
  if ('motion' in fields && fields.motion != null) { updates.push('motion = ?'); vals.push(fields.motion); }
  if ('visualType' in fields) { updates.push('visual_type = ?'); vals.push(fields.visualType); }
  if ('clipStartSec' in fields) { updates.push('clip_start_sec = ?'); vals.push(fields.clipStartSec ?? null); }
  if ('clipEndSec' in fields) { updates.push('clip_end_sec = ?'); vals.push(fields.clipEndSec ?? null); }
  if ('aiPrompt' in fields) {
    updates.push('ai_prompt = ?');
    vals.push(fields.aiPrompt ?? null);
    // When aiPrompt changes, invalidate the cached AI clip
    updates.push('ai_asset_path = NULL');
    updates.push('clip_asset_path = NULL');
    updates.push('rendered_clip_path = NULL');
    updates.push('status = ?');
    vals.push('audio_ready');
  }
  if ('clipAssetPath' in fields) {
    updates.push('clip_asset_path = ?');
    vals.push(fields.clipAssetPath ?? null);
    // If clearing clip, reset rendered too
    if (!fields.clipAssetPath) { updates.push('rendered_clip_path = NULL'); updates.push('status = ?'); vals.push('pending'); }
  }

  if (!updates.length) return;
  updates.push('updated_at = ?');
  vals.push(now, docId, blockIndex);

  dbRun(`UPDATE script_blocks SET ${updates.join(', ')} WHERE doc_id = ? AND block_index = ?`, vals);
}

export function updateBlockClips(docId: string, blockIndex: number, clips: BlockClip[]): void {
  const now = new Date().toISOString();
  // Also sync legacy single-clip fields (clip_start_sec, clip_end_sec) for the producer
  const firstClip = clips.length > 0 ? clips[0] : null;
  const clipAssetPath = firstClip?.assetPath ?? null;
  const clipStartSec = firstClip?.startSec ?? null;
  const clipEndSec = firstClip?.endSec ?? null;
  const status = clips.length > 0 ? 'clip_ready' : 'pending';
  dbRun(
    `UPDATE script_blocks SET clips_json = ?, clip_asset_path = ?, clip_start_sec = ?, clip_end_sec = ?, rendered_clip_path = NULL, status = ?, updated_at = ? WHERE doc_id = ? AND block_index = ?`,
    [JSON.stringify(clips), clipAssetPath, clipStartSec, clipEndSec, status, now, docId, blockIndex],
  );
}

export function updateBlockAudio(docId: string, blockIndex: number, fields: {
  contentHash: string;
  audioPath: string;
  audioDurationMs: number;
  wordsJson: string;
  audioEngine?: string;
}): void {
  dbRun(
    `UPDATE script_blocks SET content_hash = ?, audio_path = ?, audio_duration_ms = ?, audio_engine = ?, words_json = ?,
     rendered_clip_path = NULL, status = 'audio_ready', updated_at = ? WHERE doc_id = ? AND block_index = ?`,
    [fields.contentHash, fields.audioPath, fields.audioDurationMs, fields.audioEngine ?? null, fields.wordsJson, new Date().toISOString(), docId, blockIndex],
  );
}

export function updateBlockClip(docId: string, blockIndex: number, clipAssetPath: string, visualType: string): void {
  dbRun(
    `UPDATE script_blocks SET clip_asset_path = ?, visual_type = ?, rendered_clip_path = NULL,
     clip_start_sec = NULL, clip_end_sec = NULL, clips_json = NULL,
     status = 'clip_ready', updated_at = ? WHERE doc_id = ? AND block_index = ?`,
    [clipAssetPath, visualType, new Date().toISOString(), docId, blockIndex],
  );
}

export function updateBlockRendered(docId: string, blockIndex: number, renderedClipPath: string): void {
  dbRun(
    `UPDATE script_blocks SET rendered_clip_path = ?, status = 'rendered', error_msg = NULL, updated_at = ? WHERE doc_id = ? AND block_index = ?`,
    [renderedClipPath, new Date().toISOString(), docId, blockIndex],
  );
}

export function updateBlockError(docId: string, blockIndex: number, errorMsg: string): void {
  dbRun(
    `UPDATE script_blocks SET status = 'error', error_msg = ?, updated_at = ? WHERE doc_id = ? AND block_index = ?`,
    [errorMsg, new Date().toISOString(), docId, blockIndex],
  );
}

export function updateBlockAi(
  docId: string,
  blockIndex: number,
  aiPrompt: string,
  aiAssetPath: string | null,
  aiMeta: Record<string, unknown> | null,
): void {
  dbRun(
    `UPDATE script_blocks SET ai_prompt = ?, ai_asset_path = ?, ai_meta_json = ?,
     clip_asset_path = COALESCE(?, clip_asset_path),
     visual_type = 'ai', rendered_clip_path = NULL,
     status = CASE WHEN ? IS NOT NULL THEN 'clip_ready' ELSE status END,
     updated_at = ? WHERE doc_id = ? AND block_index = ?`,
    [
      aiPrompt, aiAssetPath, aiMeta ? JSON.stringify(aiMeta) : null,
      aiAssetPath, aiAssetPath,
      new Date().toISOString(), docId, blockIndex,
    ],
  );
}

/**
 * Build a cinematic AI generation prompt from a block's content.
 * Used for [FLOW: auto] blocks and auto-fallback when Pexels returns nothing.
 */
export function buildFlowPrompt(
  block: Pick<ScriptBlockRecord, 'narration' | 'pexelsQuery' | 'segmentName' | 'segmentIndex'>,
  isPortrait: boolean,
): string {
  const parts: string[] = [];
  if (block.narration?.trim()) parts.push(block.narration.trim());
  if (block.pexelsQuery?.trim()) parts.push(block.pexelsQuery.trim());
  if (block.segmentName && !/^segment\s+\d+$/i.test(block.segmentName)) {
    parts.push(block.segmentName);
  }
  const base = parts.join('. ').replace(/\.\.\s*/g, '. ').trim();
  const aspect = isPortrait ? '9:16 vertical portrait' : '16:9 widescreen';
  return `${base} — documentary realism, natural lighting, ${aspect}, no text, no captions, no logos`;
}

const MOTION_CYCLE = ['slow-zoom', 'ken-burns-in', 'ken-burns-out', 'pan-left', 'pan-right'];

/** Upsert script_blocks after parsing. Preserves audio state when narration is unchanged. */
export function syncBlocksFromParsed(docId: string, parsed: ParsedScript): void {
  const now = new Date().toISOString();
  let flatIdx = 0;

  for (let si = 0; si < parsed.segments.length; si++) {
    const seg = parsed.segments[si];
    for (let bi = 0; bi < seg.blocks.length; bi++) {
      const block = seg.blocks[bi];
      const blockIndex = flatIdx++;
      const narrationHash = createHash('sha256').update(block.narration || '').digest('hex').slice(0, 16);
      const existing = dbGet<ScriptBlockRow>(
        `SELECT * FROM script_blocks WHERE doc_id = ? AND block_index = ?`,
        [docId, blockIndex],
      );

      const sceneNum = bi + 1;
      const voiceConfig = block.voiceConfig ?? null;

      // Chart wins if both [CHART:] and [FLOW:] present (conflict already warned during parse)
      const hasFlow = !!block.flowPrompt && !block.chartSpec;
      const parsedVisualType = block.chartSpec ? 'chart' : hasFlow ? 'ai' : block.pexelsQuery ? 'pexels' : 'inherit';
      const visualType = parsedVisualType === 'inherit'
        ? (existing ? existing.visual_type : 'pexels')
        : parsedVisualType;

      const aiPrompt = hasFlow ? block.flowPrompt! : null;
      const motion = MOTION_CYCLE[blockIndex % MOTION_CYCLE.length];
      const overlaysJson = JSON.stringify(block.overlays || []);
      const chartSpecJson = block.chartSpec ? JSON.stringify(block.chartSpec) : null;
      const paceHint = block.paceHint ?? null;

      if (!existing) {
        dbRun(
          `INSERT INTO script_blocks (id, doc_id, block_index, segment_index, segment_name, scene_number, narration, pexels_query, chart_spec_json, overlays_json, pace_hint, voice_config, ai_prompt, visual_type, motion, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [randomUUID(), docId, blockIndex, si + 1, seg.name, sceneNum, block.narration || '', block.pexelsQuery ?? null, chartSpecJson, overlaysJson, paceHint, voiceConfig, aiPrompt, visualType, motion, now, now],
        );
      } else {
        const narrationChanged = existing.content_hash !== narrationHash && existing.audio_path !== null;
        const visualChanged = (existing.pexels_query ?? null) !== (block.pexelsQuery ?? null)
          || (existing.chart_spec_json ?? null) !== (chartSpecJson ?? null)
          || (existing.ai_prompt ?? null) !== (aiPrompt ?? null)
          || (existing.clip_asset_path === null && existing.visual_type !== visualType);

        const targetVisualType = existing.clip_asset_path ? existing.visual_type : visualType;

        if (narrationChanged) {
          // Reset audio + render, keep clip asset path
          dbRun(
            `UPDATE script_blocks SET segment_index = ?, segment_name = ?, scene_number = ?, narration = ?, pexels_query = ?,
             chart_spec_json = ?, overlays_json = ?, pace_hint = ?, voice_config = ?, ai_prompt = ?, visual_type = ?, content_hash = NULL,
             audio_path = NULL, audio_duration_ms = NULL, words_json = NULL,
             rendered_clip_path = NULL, status = 'pending', error_msg = NULL, updated_at = ?
             WHERE doc_id = ? AND block_index = ?`,
            [si + 1, seg.name, sceneNum, block.narration || '', block.pexelsQuery ?? null, chartSpecJson, overlaysJson, paceHint, voiceConfig, aiPrompt, targetVisualType, now, docId, blockIndex],
          );
        } else if (visualChanged) {
          // Keep audio, reset clip + render
          dbRun(
            `UPDATE script_blocks SET segment_index = ?, segment_name = ?, scene_number = ?, pexels_query = ?,
             chart_spec_json = ?, overlays_json = ?, pace_hint = ?, voice_config = ?, ai_prompt = ?, visual_type = ?,
             clip_asset_path = NULL, ai_asset_path = NULL, rendered_clip_path = NULL,
             status = CASE WHEN status IN ('clip_ready','rendered') THEN 'audio_ready' ELSE status END,
             error_msg = NULL, updated_at = ?
             WHERE doc_id = ? AND block_index = ?`,
            [si + 1, seg.name, sceneNum, block.pexelsQuery ?? null, chartSpecJson, overlaysJson, paceHint, voiceConfig, aiPrompt, visualType, now, docId, blockIndex],
          );
        } else {
          // Just update metadata
          dbRun(
            `UPDATE script_blocks SET segment_index = ?, segment_name = ?, scene_number = ?, overlays_json = ?, pace_hint = ?, voice_config = ?, updated_at = ?
             WHERE doc_id = ? AND block_index = ?`,
            [si + 1, seg.name, sceneNum, overlaysJson, paceHint, voiceConfig, now, docId, blockIndex],
          );
        }
      }
    }
  }

  // Delete blocks beyond new total count
  const newCount = flatIdx;
  dbRun(`DELETE FROM script_blocks WHERE doc_id = ? AND block_index >= ?`, [docId, newCount]);
}

export function updateDocSubtitleStyle(id: string, style: any): void {
  dbRun(
    `UPDATE script_docs SET subtitle_style = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(style), new Date().toISOString(), id]
  );
}

export function deleteDocProduceJob(docId: string): void {
  const row = dbGet<{ id: string; payload: string; result: string | null }>(
    `SELECT * FROM jobs WHERE type = 'script-studio-produce'
     AND json_extract(payload, '$.docId') = ?
     ORDER BY created_at DESC LIMIT 1`,
    [docId]
  );

  if (row) {
    if (row.result) {
      try {
        const resObj = JSON.parse(row.result);
        if (resObj?.resultFilename) {
          const outDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
          const videoPath = path.join(outDir, resObj.resultFilename);
          if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
            addLog(docId, 'info', 'produce', `Deleted produced video file: ${resObj.resultFilename}`);
          }
        }
      } catch (err) {
        console.error('[produce] Failed to delete video file:', err);
      }
    }

    dbRun(`DELETE FROM jobs WHERE id = ?`, [row.id]);
  }

  // Also delete the document's cached block videos folder!
  try {
    const outDir = path.resolve(process.env.RENDERS_DIR ?? './renders', 'storyboard');
    const docDir = path.join(outDir, `doc_${docId}`);
    if (fs.existsSync(docDir)) {
      fs.rmSync(docDir, { recursive: true, force: true });
      addLog(docId, 'info', 'produce', `Deleted doc folder: doc_${docId}`);
    }
  } catch (err) {
    console.error(`[produce] Failed to delete doc folder:`, err);
  }

  // Reset status to parsed
  setDocStatus(docId, 'parsed');
}

export function getJobStatus(jobId: string): string | null {
  const row = dbGet<{ status: string }>('SELECT status FROM jobs WHERE id = ?', [jobId]);
  return row ? row.status : null;
}
