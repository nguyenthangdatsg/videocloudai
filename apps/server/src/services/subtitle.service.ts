import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSettings } from './settings.service';
import { resolveFfmpegPathSync } from './import.service';

const execFileAsync = promisify(execFile);

export interface SubtitleEntry {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface SubtitleResult {
  srtPath: string;
  vttPath: string;
  entries: SubtitleEntry[];
  duration: number;
}

function timeToMs(timeStr: string): number {
  const [h, m, sWithMs] = timeStr.split(':');
  const [s, ms] = sWithMs.replace(',', '.').split('.');
  return (
    parseInt(h) * 3_600_000 +
    parseInt(m) * 60_000 +
    parseInt(s) * 1000 +
    parseInt(ms ?? '0')
  );
}

function msToSrt(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const msRem = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msRem).padStart(3, '0')}`;
}

// Escape font path for FFmpeg filter string (handle Windows drive letters)
function escapeFontPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

export class SubtitleService {
  private subtitlesDir: string;

  constructor() {
    this.subtitlesDir = path.join(process.env.ASSETS_DIR ?? './assets', 'subtitles');
    fs.mkdirSync(this.subtitlesDir, { recursive: true });
  }

  async generateFromAudio(audioPath: string, videoId: string): Promise<SubtitleResult> {
    const outBase = path.join(this.subtitlesDir, `subs_${videoId}`);
    const srtPath = `${outBase}.srt`;
    if (fs.existsSync(srtPath)) return this.parseSRT(srtPath, `${outBase}.vtt`);
    await this.runWhisper(audioPath, outBase);
    return this.parseSRT(srtPath, `${outBase}.vtt`);
  }

  generateFromScript(lines: string[], durations: number[], videoId: string): SubtitleResult {
    const outBase = path.join(this.subtitlesDir, `subs_${videoId}`);
    const srtPath = `${outBase}.srt`;
    const vttPath = `${outBase}.vtt`;

    let currentMs = 0;
    const entries: SubtitleEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const durationMs = (durations[i] ?? 4) * 1000;
      entries.push({
        index: entries.length + 1,
        startTime: msToSrt(currentMs),
        endTime: msToSrt(currentMs + durationMs - 100),
        text: line,
        startMs: currentMs,
        endMs: currentMs + durationMs - 100,
      });
      currentMs += durationMs;
    }

    const srtContent = entries.map((e) => `${e.index}\n${e.startTime} --> ${e.endTime}\n${e.text}\n`).join('\n');
    fs.writeFileSync(srtPath, srtContent);
    this.convertToVTT(srtPath, vttPath);

    return { srtPath, vttPath, entries, duration: currentMs / 1000 };
  }

  async runWhisper(audioPath: string, outBase: string, options?: { model?: string; language?: string }): Promise<void> {
    const absAudioPath = path.resolve(audioPath);
    const absOutBase = path.resolve(outBase);
    const outDir = path.dirname(absOutBase);
    const model = options?.model || getSettings().get('whisper_model') || 'tiny';
    const lang = options?.language || getSettings().get('whisper_language') || 'en';

    // Use our Python wrapper script that injects ffmpeg-static into PATH
    // (Remotion's ffmpeg is a limited build missing s16le muxer that whisper needs)
    let ffmpegDir: string;
    try {
      // ffmpeg-static exports the path to the binary
      const ffmpegStaticBin = require('ffmpeg-static') as string;
      ffmpegDir = path.dirname(ffmpegStaticBin);
    } catch {
      ffmpegDir = path.dirname(resolveFfmpegPathSync('ffmpeg'));
    }
    // scripts/ is at apps/server/scripts/ — __dirname varies (src/services/ in dev, dist/services/ in prod)
    const scriptPath = path.resolve(__dirname, '../../scripts/whisper_transcribe.py');

    const args = [scriptPath, absAudioPath, outDir, model, lang, ffmpegDir];
    console.log('[whisper] running:', 'python', args);

    try {
      const { stdout, stderr } = await execFileAsync('python', args, { timeout: 600000, maxBuffer: 50 * 1024 * 1024, shell: true });
      console.log('[whisper] stdout:', stdout);
      if (stderr) console.log('[whisper] stderr:', stderr);
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      const detail = e.stderr || e.message || String(err);
      console.error('[whisper] failed:', detail);
      throw new Error(`Whisper transcription failed: ${detail}`);
    }

    // The script writes SRT named after the audio file basename
    const audioBase = path.basename(absAudioPath, path.extname(absAudioPath));
    const whisperOut = path.join(outDir, `${audioBase}.srt`);
    const targetSrt = `${absOutBase}.srt`;
    if (fs.existsSync(whisperOut) && whisperOut !== targetSrt) {
      fs.renameSync(whisperOut, targetSrt);
    }
  }

  parseSRTFile(srtPath: string): SubtitleResult {
    return this.parseSRT(srtPath);
  }

  private parseSRT(srtPath: string, vttPath?: string): SubtitleResult {
    // Strip BOM and normalize line endings (Windows \r\n → \n)
    const content = fs.readFileSync(srtPath, 'utf-8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const blocks = content.trim().split(/\n\n+/);
    const entries: SubtitleEntry[] = [];

    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 2) continue;
      // Try standard 3-line format first (index, timestamp, text)
      const index = parseInt(lines[0]);
      let timeLine: string;
      let textLines: string[];
      if (!isNaN(index) && lines.length >= 3 && lines[1].includes('-->')) {
        timeLine = lines[1];
        textLines = lines.slice(2);
      } else if (lines[0].includes('-->')) {
        // No index line — just timestamp + text
        timeLine = lines[0];
        textLines = lines.slice(1);
      } else {
        continue;
      }
      const [start, end] = timeLine.split('-->').map(s => s.trim());
      const text = textLines.join(' ').trim();
      if (start && end && text) {
        entries.push({ index: entries.length + 1, startTime: start, endTime: end, text, startMs: timeToMs(start), endMs: timeToMs(end) });
      }
    }
    console.log(`[srt] Parsed ${entries.length} entries from ${blocks.length} blocks in ${srtPath}`);

    let duration = 0;
    if (entries.length > 0) duration = entries[entries.length - 1].endMs / 1000;

    if (vttPath && !fs.existsSync(vttPath)) this.convertToVTT(srtPath, vttPath);
    return { srtPath, vttPath: vttPath ?? '', entries, duration };
  }

  private convertToVTT(srtPath: string, vttPath: string): void {
    const srt = fs.readFileSync(srtPath, 'utf-8');
    fs.writeFileSync(vttPath, 'WEBVTT\n\n' + srt.replace(/,(\d{3})/g, '.$1'));
  }

  srtToFFmpegFilter(entries: SubtitleEntry[]): string {
    const fontPath = getSettings().get('subtitle_font_path');
    const fontSize = parseInt(getSettings().get('subtitle_font_size') || '52');

    const fontPart = fontPath
      ? `fontfile='${escapeFontPath(fontPath)}':`
      : '';

    return entries
      .map((e) => {
        const start = e.startMs / 1000;
        const end = e.endMs / 1000;
        const text = e.text.replace(/'/g, "\\'").replace(/:/g, '\\:');
        return (
          `drawtext=${fontPart}text='${text}':fontsize=${fontSize}:fontcolor=white:` +
          `bordercolor=black:borderw=3:x=(w-text_w)/2:y=h*0.78:` +
          `enable='between(t,${start},${end})'`
        );
      })
      .join(',');
  }
}
