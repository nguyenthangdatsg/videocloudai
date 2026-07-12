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

/** Split a single transcript entry into sub-entries no longer than maxMs.
 *  Distributes words proportionally to duration of each slice. */
export function splitSegment(seg: TranscriptEntry, maxMs: number): TranscriptEntry[] {
  const duration = seg.endMs - seg.startMs;
  if (duration <= maxMs) {
    return [seg];
  }

  const words = seg.text.trim().split(/\s+/).filter(Boolean);

  // Can't meaningfully split a single word or empty text — just return as-is
  if (words.length <= 1) {
    return [seg];
  }

  const result: TranscriptEntry[] = [];
  const numChunks = Math.max(2, Math.ceil(duration / maxMs));
  const wordsPerChunk = Math.max(1, Math.floor(words.length / numChunks));
  let wordIdx = 0;
  let currentStart = seg.startMs;

  for (let c = 0; c < numChunks; c++) {
    const isLast = c === numChunks - 1;
    const chunkWordCount = isLast ? words.length - wordIdx : wordsPerChunk;
    if (chunkWordCount <= 0) break;

    const chunkWords = words.slice(wordIdx, wordIdx + chunkWordCount);
    wordIdx += chunkWordCount;

    const charsSoFar = words.slice(0, wordIdx).join(' ').length;
    const totalChars = words.join(' ').length;
    const chunkEnd = isLast ? seg.endMs : seg.startMs + Math.round((charsSoFar / totalChars) * duration);

    result.push({
      index: 0,
      startTime: '',
      endTime: '',
      text: chunkWords.join(' '),
      startMs: currentStart,
      endMs: chunkEnd,
    });

    currentStart = chunkEnd;
  }

  return result;
}

// Transition words/phrases that signal a natural break point
const TRANSITION_RE = /^(however|but|then|so|yet|still|also|meanwhile|furthermore|moreover|therefore|thus|hence|instead|nevertheless|nonetheless|otherwise|consequently|additionally|finally|next|first|second|third|lastly|in fact|for example|for instance|on the other hand|in contrast|as a result|in addition|at the same time|after that|because of this|that's why|and then|which means|this means|while|although|even though|despite|in other words|not only)\b/i;

/** Check if text starts with a transition word/phrase */
function startsWithTransition(text: string): boolean {
  return TRANSITION_RE.test(text.trim());
}

/** Find the best split point in text, preferring natural boundaries.
 *  Priority: sentence end > semicolon/colon > transition word after comma > comma > dash > space
 *  Returns character index of the split point, or -1 if no good split found. */
function findBestSplitPoint(text: string, idealPos: number, minPos: number, maxPos: number): number {
  // Search window around idealPos
  const windowStart = Math.max(minPos, idealPos - Math.floor(text.length * 0.3));
  const windowEnd = Math.min(maxPos, idealPos + Math.floor(text.length * 0.3));
  const region = text.substring(windowStart, windowEnd);

  type Candidate = { pos: number; priority: number };
  const candidates: Candidate[] = [];

  // Find sentence endings (.!?)
  const sentenceRe = /[.!?…。！？]\s+/g;
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(region)) !== null) {
    candidates.push({ pos: windowStart + m.index + m[0].length, priority: 1 });
  }

  // Find semicolons/colons
  const semiRe = /[;:]\s+/g;
  while ((m = semiRe.exec(region)) !== null) {
    candidates.push({ pos: windowStart + m.index + m[0].length, priority: 2 });
  }

  // Find commas followed by transition words
  const commaTransRe = /,\s+/g;
  while ((m = commaTransRe.exec(region)) !== null) {
    const afterComma = text.substring(windowStart + m.index + m[0].length);
    if (startsWithTransition(afterComma)) {
      candidates.push({ pos: windowStart + m.index + m[0].length, priority: 3 });
    }
  }

  // Find regular commas
  const commaRe = /,\s+/g;
  while ((m = commaRe.exec(region)) !== null) {
    candidates.push({ pos: windowStart + m.index + m[0].length, priority: 4 });
  }

  // Find dashes
  const dashRe = /\s+[-–—]\s+/g;
  while ((m = dashRe.exec(region)) !== null) {
    candidates.push({ pos: windowStart + m.index + m[0].length, priority: 5 });
  }

  if (candidates.length === 0) return -1;

  // Pick the highest priority (lowest number), breaking ties by closest to idealPos
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return Math.abs(a.pos - idealPos) - Math.abs(b.pos - idealPos);
  });

  return candidates[0].pos;
}

/** Merge adjacent transcript entries into complete sentences, then split overly long ones.
 *  Step 1: Join entries until a natural boundary is found (sentence end, transition word).
 *  Step 2: Split long segments at natural boundaries (sentences, commas, transitions),
 *          distributing time proportionally by character count. */
export function mergeToSentences(entries: TranscriptEntry[]): TranscriptEntry[] {
  // Filter out empty/whitespace-only entries
  const valid = entries.filter(e => e.text.trim().length > 0);
  if (valid.length <= 1) return valid.length ? valid : entries;

  // Step 1: Merge fragments into natural clauses (minimum 3 seconds)
  const MIN_SEGMENT_MS = 3000;
  const IDEAL_SEGMENT_MS = 6000;
  const merged: TranscriptEntry[] = [];
  let acc: TranscriptEntry | null = null;
  for (const e of valid) {
    if (!acc) {
      acc = { ...e };
    } else {
      acc.text = acc.text + ' ' + e.text;
      acc.endTime = e.endTime;
      acc.endMs = e.endMs;
    }
    const duration = acc.endMs - acc.startMs;
    const text = acc.text.trim();

    // Check for natural break points
    const hasSentenceEnd = /[.!?…。！？]\s*$/.test(text);
    const endsWithCommaClause = /,\s*$/.test(text) && duration >= IDEAL_SEGMENT_MS;
    const endsWithSemicolon = /[;:]\s*$/.test(text) && duration >= MIN_SEGMENT_MS;

    // Finalize segment at natural boundaries when duration is sufficient
    if ((hasSentenceEnd && duration >= MIN_SEGMENT_MS) ||
        endsWithSemicolon ||
        endsWithCommaClause ||
        duration >= IDEAL_SEGMENT_MS * 2) {
      acc.index = merged.length + 1;
      merged.push(acc);
      acc = null;
    }
  }
  if (acc) {
    if (merged.length > 0 && (acc.endMs - acc.startMs) < MIN_SEGMENT_MS) {
      const last = merged[merged.length - 1];
      last.text = last.text + ' ' + acc.text;
      last.endTime = acc.endTime;
      last.endMs = acc.endMs;
    } else {
      acc.index = merged.length + 1;
      merged.push(acc);
    }
  }

  // Step 2: Split long segments at natural boundaries
  const MAX_CHARS = 120;
  const MAX_MS = 10000;
  const result: TranscriptEntry[] = [];

  for (const seg of merged) {
    const segDur = seg.endMs - seg.startMs;
    if (seg.text.length <= MAX_CHARS && segDur <= MAX_MS) {
      seg.index = result.length + 1;
      result.push(seg);
      continue;
    }

    // Try to split at natural boundaries
    const parts: { text: string; startMs: number; endMs: number }[] = [];
    let remaining = seg.text;
    let remainStartMs = seg.startMs;
    const totalChars = seg.text.length;
    const totalMs = segDur;

    while (remaining.length > MAX_CHARS || (seg.endMs - remainStartMs) > MAX_MS) {
      const idealSplitChar = Math.round(MAX_CHARS * 0.7);
      const splitPos = findBestSplitPoint(remaining, idealSplitChar, Math.floor(MAX_CHARS * 0.3), Math.min(remaining.length - 10, MAX_CHARS));

      if (splitPos <= 0 || splitPos >= remaining.length - 5) {
        // No good split found — try sentence boundary fallback
        const sentenceMatch = remaining.match(/^([^.!?…。！？]*[.!?…。！？]+\s*)/);
        if (sentenceMatch && sentenceMatch[0].length < remaining.length) {
          const partText = sentenceMatch[0].trim();
          const charRatio = (totalChars - remaining.length + partText.length) / totalChars;
          const partEndMs = seg.startMs + Math.round(charRatio * totalMs);
          parts.push({ text: partText, startMs: remainStartMs, endMs: partEndMs });
          remaining = remaining.substring(sentenceMatch[0].length).trim();
          remainStartMs = partEndMs;
        } else {
          break; // Can't split further
        }
      } else {
        const partText = remaining.substring(0, splitPos).trim();
        const charRatio = (totalChars - remaining.length + splitPos) / totalChars;
        const partEndMs = seg.startMs + Math.round(charRatio * totalMs);
        parts.push({ text: partText, startMs: remainStartMs, endMs: partEndMs });
        remaining = remaining.substring(splitPos).trim();
        remainStartMs = partEndMs;
      }
    }

    // Push remaining
    if (remaining.trim()) {
      parts.push({ text: remaining.trim(), startMs: remainStartMs, endMs: seg.endMs });
    }

    if (parts.length <= 1) {
      seg.index = result.length + 1;
      result.push(seg);
    } else {
      for (const p of parts) {
        result.push({
          index: result.length + 1,
          startTime: '', endTime: '',
          text: p.text,
          startMs: p.startMs,
          endMs: p.endMs,
        });
      }
    }
  }

  // Step 3: Merge any segments shorter than MIN_SEGMENT_MS into neighbors
  const cleaned: TranscriptEntry[] = [];
  for (const seg of result) {
    const dur = seg.endMs - seg.startMs;
    if (dur < MIN_SEGMENT_MS && cleaned.length > 0) {
      // Merge into previous segment
      const prev = cleaned[cleaned.length - 1];
      prev.text = prev.text + ' ' + seg.text;
      prev.endMs = seg.endMs;
    } else if (dur < MIN_SEGMENT_MS && cleaned.length === 0) {
      // First segment is too short — push it, will try to merge forward later
      cleaned.push(seg);
    } else {
      // Check if previous segment is too short and merge it into this one
      if (cleaned.length > 0) {
        const prev = cleaned[cleaned.length - 1];
        if ((prev.endMs - prev.startMs) < MIN_SEGMENT_MS) {
          prev.text = prev.text + ' ' + seg.text;
          prev.endMs = seg.endMs;
          continue;
        }
      }
      cleaned.push(seg);
    }
  }

  for (let i = 0; i < cleaned.length; i++) {
    cleaned[i].index = i + 1;
    cleaned[i].startTime = msToTimeStr(cleaned[i].startMs);
    cleaned[i].endTime = msToTimeStr(cleaned[i].endMs);
  }
  return cleaned;
}
