import type { TranscriptEntry } from './types';

/** Convert milliseconds to SRT-style time string (HH:MM:SS,mmm) */
export function msToTimeStr(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = ms % 1000;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(rem).padStart(3,'0')}`;
}

/** Format seconds to mm:ss.s display */
export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** Parse mm:ss.s or raw number to seconds */
export function parseTimeInput(val: string): number {
  if (val.includes(':')) {
    const [mStr, sStr] = val.split(':');
    return parseInt(mStr || '0') * 60 + parseFloat(sStr || '0');
  }
  return parseFloat(val) || 0;
}

/** Merge adjacent transcript entries into complete sentences, then split overly long ones.
 *  Step 1: Join entries until sentence-ending punctuation is found (fixes Whisper mid-sentence splits).
 *  Step 2: Split any segment longer than ~2 sentences at internal sentence boundaries,
 *          distributing time proportionally by character count. */
export function mergeToSentences(entries: TranscriptEntry[]): TranscriptEntry[] {
  if (entries.length <= 1) return entries;

  // Step 1: Merge fragments into complete sentences
  const merged: TranscriptEntry[] = [];
  let acc: TranscriptEntry | null = null;
  for (const e of entries) {
    if (!acc) {
      acc = { ...e };
    } else {
      acc.text = acc.text + ' ' + e.text;
      acc.endTime = e.endTime;
      acc.endMs = e.endMs;
    }
    if (/[.!?…。！？]\s*$/.test(acc.text.trim())) {
      acc.index = merged.length + 1;
      merged.push(acc);
      acc = null;
    }
  }
  if (acc) {
    acc.index = merged.length + 1;
    merged.push(acc);
  }

  // Step 2: Split long segments at sentence boundaries
  const MAX_CHARS = 150;
  const MAX_MS = 15000;
  const result: TranscriptEntry[] = [];

  for (const seg of merged) {
    if (seg.text.length <= MAX_CHARS && (seg.endMs - seg.startMs) <= MAX_MS) {
      seg.index = result.length + 1;
      result.push(seg);
      continue;
    }
    const sentences = seg.text.match(/[^.!?…。！？]*[.!?…。！？]+\s*/g) || [seg.text];
    if (sentences.length <= 1) {
      seg.index = result.length + 1;
      result.push(seg);
      continue;
    }
    const totalChars = seg.text.length;
    const totalMs = seg.endMs - seg.startMs;
    let chunkText = '';
    let chunkStartMs = seg.startMs;
    let charsSoFar = 0;

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i].trim();
      if (!s) continue;
      const wouldBe = chunkText ? chunkText + ' ' + s : s;
      if (chunkText && (wouldBe.length > MAX_CHARS)) {
        const chunkEndMs = seg.startMs + Math.round((charsSoFar / totalChars) * totalMs);
        result.push({
          index: result.length + 1,
          startTime: '', endTime: '',
          text: chunkText.trim(),
          startMs: chunkStartMs,
          endMs: chunkEndMs,
        });
        chunkStartMs = chunkEndMs;
        chunkText = s;
        charsSoFar += s.length;
      } else {
        chunkText = wouldBe;
        charsSoFar += s.length;
      }
    }
    if (chunkText.trim()) {
      result.push({
        index: result.length + 1,
        startTime: '', endTime: '',
        text: chunkText.trim(),
        startMs: chunkStartMs,
        endMs: seg.endMs,
      });
    }
  }

  for (const r of result) {
    r.startTime = msToTimeStr(r.startMs);
    r.endTime = msToTimeStr(r.endMs);
  }
  return result;
}
