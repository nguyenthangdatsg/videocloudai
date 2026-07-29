// Resync script blocks using updated parser logic
const Database = require('better-sqlite3');
const { createHash, randomUUID } = require('crypto');
const db = new Database('database/videocloudai.db');

const DOC_ID = process.argv[2];
if (!DOC_ID) { console.error('Usage: node scripts/resync-blocks.js <doc-id>'); process.exit(1); }

const row = db.prepare('SELECT raw_markdown FROM script_docs WHERE id = ?').get(DOC_ID);
if (!row) { console.error('Doc not found:', DOC_ID); process.exit(1); }
const lines = row.raw_markdown.split(/\r?\n/);

// ── Parser ──
let titleFound = false;
let segmentIndex = 0;
let currentSegment = null;
let hasExplicitScene = false;
let narrationLines = [];
let pendingTags = [];
let inProdNotes = false;
let scenePos = 0;
const segments = [];
const characters = {};

function flushNarration() {
  const rawNar = narrationLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Resolve inline [STAT: label | fallback | type] → fallback
  const narration = rawNar.replace(/\[STAT:\s*[^|[\]]+\|\s*([^|[\]]+)\|[^\]]*\]/gi, (_, fb) => fb.trim());
  if (!narration && pendingTags.length === 0) { narrationLines = []; pendingTags = []; return; }
  if (currentSegment) {
    scenePos++;
    const block = { narration, overlays: [], sceneNumber: scenePos };
    for (const tag of pendingTags) {
      if (tag.type === 'pexels') block.pexelsQuery = tag.value;
      else if (tag.type === 'flow') block.flowPrompt = tag.value;
      else if (tag.type === 'pace') block.paceHint = tag.value;
      else if (tag.type === 'voice') block.voiceConfig = tag.value;
      else if (tag.type === 'overlay') block.overlays.push(tag.value);
    }
    if (narration || block.pexelsQuery || block.flowPrompt || block.overlays.length) {
      currentSegment.blocks.push(block);
    }
  }
  narrationLines = []; pendingTags = [];
}

function flushSegment() {
  flushNarration();
  scenePos = 0; hasExplicitScene = false;
  if (currentSegment) segments.push(currentSegment);
  currentSegment = null;
}

for (const line of lines) {
  const trimmed = line.trim();

  // Production notes
  if (/^#{1,2}\s+.*production\s+notes/i.test(trimmed)) { flushSegment(); inProdNotes = true; continue; }
  if (inProdNotes) continue;

  // Horizontal rules
  if (/^[-*_]{3,}$/.test(trimmed)) continue;

  // Title (first # heading)
  if (/^#\s+/.test(trimmed) && !titleFound) { titleFound = true; continue; }

  // Comment lines after title (single # followed by space, before any segment)
  if (/^#[^#]/.test(trimmed) && titleFound) continue;

  // ### SCENE N — explicit block boundary
  if (/^###\s+SCENE\s+\d+/i.test(trimmed)) {
    if (currentSegment && (narrationLines.some(l => l.trim()) || pendingTags.length > 0)) flushNarration();
    hasExplicitScene = true;
    continue;
  }

  // Segment header: ## SEGMENT N — NAME (time)  or  ## N — NAME
  if (/^#{1,3}\s+(?:SEGMENT\s+)?\d+\s*[—–:\-]/i.test(trimmed)) {
    flushSegment(); segmentIndex++;
    // Extract name: strip hashes, strip leading "SEGMENT N —", strip trailing "(time)"
    const name = trimmed
      .replace(/^#{1,3}\s+/, '')
      .replace(/^(?:SEGMENT\s+)?\d+\s*[—–:\-]\s*/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim();
    currentSegment = { index: segmentIndex, name: name || ('Segment ' + segmentIndex), blocks: [] };
    continue;
  }

  // Alt segment header: ## COLD OPEN  or  ## COLD OPEN (0:00–0:25)
  const altMatch = trimmed.match(/^#{2,3}\s+([A-Z][A-Z\s&\/]+?)(?:\s*\([^)]+\))?\s*$/);
  if (altMatch && !narrationLines.some(l => l.trim())) {
    flushSegment(); segmentIndex++;
    currentSegment = { index: segmentIndex, name: altMatch[1].trim(), blocks: [] };
    continue;
  }

  // Auto-create unnamed segment if needed (only for actual content lines)
  if (!currentSegment && trimmed) {
    segmentIndex++;
    currentSegment = { index: segmentIndex, name: 'Segment ' + segmentIndex, blocks: [] };
  }

  // Bracket tags
  const tagMatch = trimmed.match(/^\[([A-Z][A-Z\s]*?):\s*([\s\S]+)\]$/i);
  if (tagMatch) {
    const type = tagMatch[1].trim().toUpperCase();
    let val = tagMatch[2].trim();
    if (type === 'CHARACTER') {
      const parts = val.split('|').map(s => s.trim());
      if (parts.length >= 2) characters[parts[0]] = parts.slice(1).join(' | ');
    } else if (type === 'VOICE') {
      if (currentSegment) pendingTags.push({ type: 'voice', value: val });
      // else doc-level — ignore for per-block purposes
    } else if (type === 'PEXELS') {
      // With explicit scene markers, PEXELS never creates a block boundary
      if (!hasExplicitScene && narrationLines.some(l => l.trim())) flushNarration();
      pendingTags.push({ type: 'pexels', value: val });
    } else if (type === 'FLOW') {
      if (!hasExplicitScene && narrationLines.some(l => l.trim())) flushNarration();
      let flowVal = val.toLowerCase() === 'auto' ? '__auto__' : val;
      // Expand @character references
      for (const [id, desc] of Object.entries(characters)) {
        flowVal = flowVal.replace(new RegExp('@' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), desc);
      }
      pendingTags.push({ type: 'flow', value: flowVal });
    } else if (type === 'PACE') {
      if (['slow', 'fast'].includes(val.toLowerCase())) pendingTags.push({ type: 'pace', value: val.toLowerCase() });
    } else if (type === 'TEXT ON SCREEN') {
      val = val.replace(/^["']|["']$/g, '');
      if (!hasExplicitScene && narrationLines.some(l => l.trim())) flushNarration();
      pendingTags.push({ type: 'overlay', value: val });
    }
    // CHART, unknown — skip for now
    continue;
  }

  // Empty line
  if (!trimmed) {
    if (hasExplicitScene) {
      // Preserve as paragraph break within the scene block
      if (narrationLines.length > 0) narrationLines.push('');
    } else if (narrationLines.some(l => l.trim())) {
      flushNarration();
    }
    continue;
  }

  // Narration text
  narrationLines.push(trimmed);
}
flushSegment();

const totalBlocks = segments.reduce((s, seg) => s + seg.blocks.length, 0);
console.log('Parsed: ' + segments.length + ' segments, ' + totalBlocks + ' blocks');
segments.forEach(seg => console.log('  Seg ' + seg.index + ' "' + seg.name + '": ' + seg.blocks.length + ' block(s)'));

// ── Sync to DB ──
const MOTION_CYCLE = ['slow-zoom', 'ken-burns-in', 'ken-burns-out', 'pan-left', 'pan-right'];
const now = new Date().toISOString();
let flatIdx = 0;

const stmts = {
  get: db.prepare('SELECT * FROM script_blocks WHERE doc_id=? AND block_index=?'),
  insert: db.prepare([
    'INSERT INTO script_blocks',
    '(id,doc_id,block_index,segment_index,segment_name,scene_number,narration,pexels_query,overlays_json,pace_hint,voice_config,ai_prompt,visual_type,motion,status,created_at,updated_at)',
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)"
  ].join(' ')),
  // Always update narration + reset audio/clip pipeline
  updateFull: db.prepare([
    'UPDATE script_blocks SET',
    'segment_index=?,segment_name=?,scene_number=?,narration=?,pexels_query=?,',
    'overlays_json=?,pace_hint=?,voice_config=?,ai_prompt=?,visual_type=?,',
    'content_hash=NULL,audio_path=NULL,audio_duration_ms=NULL,words_json=NULL,',
    "clip_asset_path=NULL,ai_asset_path=NULL,rendered_clip_path=NULL,status='pending',error_msg=NULL,updated_at=?",
    'WHERE doc_id=? AND block_index=?'
  ].join(' ')),
  // Narration unchanged, visual changed — keep audio, reset clip
  updateVis: db.prepare([
    'UPDATE script_blocks SET',
    'segment_index=?,segment_name=?,scene_number=?,pexels_query=?,',
    'overlays_json=?,pace_hint=?,voice_config=?,ai_prompt=?,visual_type=?,',
    'clip_asset_path=NULL,ai_asset_path=NULL,rendered_clip_path=NULL,',
    "status=CASE WHEN status IN ('clip_ready','rendered') THEN 'audio_ready' ELSE status END,",
    'error_msg=NULL,updated_at=?',
    'WHERE doc_id=? AND block_index=?'
  ].join(' ')),
  // Nothing changed — metadata only
  updateMeta: db.prepare([
    'UPDATE script_blocks SET',
    'segment_index=?,segment_name=?,scene_number=?,overlays_json=?,pace_hint=?,voice_config=?,updated_at=?',
    'WHERE doc_id=? AND block_index=?'
  ].join(' ')),
  delExtra: db.prepare('DELETE FROM script_blocks WHERE doc_id=? AND block_index>=?'),
  updateDoc: db.prepare('UPDATE script_docs SET blocks_count=?,segments_count=?,updated_at=? WHERE id=?'),
};

db.transaction(() => {
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    for (let bi = 0; bi < seg.blocks.length; bi++) {
      const block = seg.blocks[bi];
      const blockIndex = flatIdx++;
      const sceneNum = block.sceneNumber || (bi + 1);
      const hasFlow = !!block.flowPrompt;
      const visualType = hasFlow ? 'ai' : block.pexelsQuery ? 'pexels' : 'inherit';
      const aiPrompt = hasFlow ? block.flowPrompt : null;
      const motion = MOTION_CYCLE[blockIndex % MOTION_CYCLE.length];
      const overlaysJson = JSON.stringify(block.overlays || []);
      const paceHint = block.paceHint || null;
      const voiceConfig = block.voiceConfig || null;
      const newNarration = block.narration || '';

      const existing = stmts.get.get(DOC_ID, blockIndex);
      if (!existing) {
        stmts.insert.run(randomUUID(), DOC_ID, blockIndex, si + 1, seg.name, sceneNum,
          newNarration, block.pexelsQuery || null, overlaysJson, paceHint, voiceConfig,
          aiPrompt, visualType, motion, now, now);
      } else {
        // Always compare narration strings directly (not hashes) so we don't skip updates
        const narrationChanged = existing.narration !== newNarration;
        const visChanged =
          (existing.pexels_query || null) !== (block.pexelsQuery || null) ||
          (existing.ai_prompt || null) !== (aiPrompt || null) ||
          existing.visual_type !== visualType;

        if (narrationChanged) {
          // Narration changed: reset entire pipeline
          stmts.updateFull.run(
            si + 1, seg.name, sceneNum, newNarration, block.pexelsQuery || null,
            overlaysJson, paceHint, voiceConfig, aiPrompt, visualType, now, DOC_ID, blockIndex);
        } else if (visChanged) {
          // Narration same, visual changed: keep audio, reset clip
          stmts.updateVis.run(
            si + 1, seg.name, sceneNum, block.pexelsQuery || null,
            overlaysJson, paceHint, voiceConfig, aiPrompt, visualType, now, DOC_ID, blockIndex);
        } else {
          // Nothing content-related changed: metadata only
          stmts.updateMeta.run(
            si + 1, seg.name, sceneNum, overlaysJson, paceHint, voiceConfig, now, DOC_ID, blockIndex);
        }
      }
    }
  }
  stmts.delExtra.run(DOC_ID, flatIdx);
  stmts.updateDoc.run(flatIdx, segments.length, now, DOC_ID);
})();

const count = db.prepare('SELECT COUNT(*) as c FROM script_blocks WHERE doc_id=?').get(DOC_ID).c;
console.log('\nDB blocks after sync: ' + count);
db.close();
