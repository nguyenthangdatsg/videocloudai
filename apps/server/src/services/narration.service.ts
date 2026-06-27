import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSettings } from './settings.service';
import { resolveFfmpegPathSync } from './import.service';

const execFileAsync = promisify(execFile);

export interface VoiceInfo {
  lang: string;
  label: string;
  flag: string;
  gender: 'male' | 'female';
  styles?: string[];
}

// Curated voices — main selection shown in UI
export const VOICES: Record<string, VoiceInfo> = {
  // English — US (verified against edge-tts --list-voices)
  'en-US-GuyNeural':           { lang: 'en', label: 'Guy · Neutral',         flag: '🇺🇸', gender: 'male' },
  'en-US-JennyNeural':         { lang: 'en', label: 'Jenny · Neutral',       flag: '🇺🇸', gender: 'female' },
  'en-US-AriaNeural':          { lang: 'en', label: 'Aria · Expressive',     flag: '🇺🇸', gender: 'female' },
  'en-US-AndrewNeural':        { lang: 'en', label: 'Andrew · Narrator',     flag: '🇺🇸', gender: 'male' },
  'en-US-AvaNeural':           { lang: 'en', label: 'Ava · Friendly',        flag: '🇺🇸', gender: 'female' },
  'en-US-BrianNeural':         { lang: 'en', label: 'Brian · Deep',          flag: '🇺🇸', gender: 'male' },
  'en-US-EmmaNeural':          { lang: 'en', label: 'Emma · Bright',         flag: '🇺🇸', gender: 'female' },
  'en-US-ChristopherNeural':   { lang: 'en', label: 'Christopher · Clear',   flag: '🇺🇸', gender: 'male' },
  'en-US-MichelleNeural':      { lang: 'en', label: 'Michelle · Warm',       flag: '🇺🇸', gender: 'female' },
  'en-US-RogerNeural':         { lang: 'en', label: 'Roger · Confident',     flag: '🇺🇸', gender: 'male' },
  'en-US-SteffanNeural':       { lang: 'en', label: 'Steffan · Calm',        flag: '🇺🇸', gender: 'male' },
  'en-US-EricNeural':          { lang: 'en', label: 'Eric · Casual',         flag: '🇺🇸', gender: 'male' },
  // English — UK
  'en-GB-RyanNeural':          { lang: 'en', label: 'Ryan · British',        flag: '🇬🇧', gender: 'male' },
  'en-GB-SoniaNeural':         { lang: 'en', label: 'Sonia · British',       flag: '🇬🇧', gender: 'female' },
  'en-GB-LibbyNeural':         { lang: 'en', label: 'Libby · British',       flag: '🇬🇧', gender: 'female' },
  // English — AU
  'en-AU-WilliamNeural':       { lang: 'en', label: 'William · Australian',  flag: '🇦🇺', gender: 'male' },
  'en-AU-NatashaNeural':       { lang: 'en', label: 'Natasha · Australian',  flag: '🇦🇺', gender: 'female' },
  // English — IN
  'en-IN-PrabhatNeural':       { lang: 'en', label: 'Prabhat · Indian',      flag: '🇮🇳', gender: 'male' },
  'en-IN-NeerjaNeural':        { lang: 'en', label: 'Neerja · Indian',       flag: '🇮🇳', gender: 'female' },
  // Vietnamese
  'vi-VN-HoaiMyNeural':        { lang: 'vi', label: 'Hoài My · Nữ',         flag: '🇻🇳', gender: 'female' },
  'vi-VN-NamMinhNeural':       { lang: 'vi', label: 'Nam Minh · Nam',        flag: '🇻🇳', gender: 'male' },
  // Spanish
  'es-ES-AlvaroNeural':        { lang: 'es', label: 'Álvaro · España',       flag: '🇪🇸', gender: 'male' },
  'es-ES-ElviraNeural':        { lang: 'es', label: 'Elvira · España',       flag: '🇪🇸', gender: 'female' },
  'es-MX-DaliaNeural':         { lang: 'es', label: 'Dalia · México',        flag: '🇲🇽', gender: 'female' },
  'es-MX-JorgeNeural':         { lang: 'es', label: 'Jorge · México',        flag: '🇲🇽', gender: 'male' },
  // French
  'fr-FR-HenriNeural':         { lang: 'fr', label: 'Henri · France',        flag: '🇫🇷', gender: 'male' },
  'fr-FR-DeniseNeural':        { lang: 'fr', label: 'Denise · France',       flag: '🇫🇷', gender: 'female' },
  // German
  'de-DE-ConradNeural':        { lang: 'de', label: 'Conrad · Deutschland',  flag: '🇩🇪', gender: 'male', styles: ['cheerful', 'angry', 'excited', 'friendly', 'hopeful', 'sad', 'shouting', 'whispering'] },
  'de-DE-KatjaNeural':         { lang: 'de', label: 'Katja · Deutschland',   flag: '🇩🇪', gender: 'female' },
  // Portuguese
  'pt-BR-AntonioNeural':       { lang: 'pt', label: 'Antonio · Brasil',      flag: '🇧🇷', gender: 'male' },
  'pt-BR-FranciscaNeural':     { lang: 'pt', label: 'Francisca · Brasil',    flag: '🇧🇷', gender: 'female' },
  // Japanese
  'ja-JP-KeitaNeural':         { lang: 'ja', label: 'Keita · 日本語',          flag: '🇯🇵', gender: 'male' },
  'ja-JP-NanamiNeural':        { lang: 'ja', label: 'Nanami · 日本語',         flag: '🇯🇵', gender: 'female' },
  // Korean
  'ko-KR-InJoonNeural':        { lang: 'ko', label: 'InJoon · 한국어',         flag: '🇰🇷', gender: 'male' },
  'ko-KR-SunHiNeural':         { lang: 'ko', label: 'SunHi · 한국어',          flag: '🇰🇷', gender: 'female' },
  // Chinese
  'zh-CN-YunxiNeural':         { lang: 'zh', label: 'Yunxi · 中文',            flag: '🇨🇳', gender: 'male', styles: ['narration', 'cheerful', 'sad', 'angry', 'fearful', 'disgruntled', 'serious', 'depressed'] },
  'zh-CN-XiaoxiaoNeural':      { lang: 'zh', label: 'Xiaoxiao · 中文',         flag: '🇨🇳', gender: 'female', styles: ['cheerful', 'sad', 'angry', 'fearful', 'disgruntled', 'serious', 'gentle', 'narration'] },
  // Hindi
  'hi-IN-MadhurNeural':        { lang: 'hi', label: 'Madhur · हिन्दी',          flag: '🇮🇳', gender: 'male' },
  'hi-IN-SwaraNeural':         { lang: 'hi', label: 'Swara · हिन्दी',           flag: '🇮🇳', gender: 'female' },
  // Arabic
  'ar-SA-HamedNeural':         { lang: 'ar', label: 'Hamed · العربية',         flag: '🇸🇦', gender: 'male' },
  'ar-SA-ZariyahNeural':       { lang: 'ar', label: 'Zariyah · العربية',       flag: '🇸🇦', gender: 'female' },
  // Italian
  'it-IT-DiegoNeural':         { lang: 'it', label: 'Diego · Italiano',      flag: '🇮🇹', gender: 'male' },
  'it-IT-ElsaNeural':          { lang: 'it', label: 'Elsa · Italiano',       flag: '🇮🇹', gender: 'female' },
  // Russian
  'ru-RU-DmitryNeural':        { lang: 'ru', label: 'Dmitry · Русский',      flag: '🇷🇺', gender: 'male' },
  'ru-RU-SvetlanaNeural':      { lang: 'ru', label: 'Svetlana · Русский',    flag: '🇷🇺', gender: 'female' },
  // Thai
  'th-TH-PremwadeeNeural':     { lang: 'th', label: 'Premwadee · ไทย',       flag: '🇹🇭', gender: 'female' },
  'th-TH-NiwatNeural':         { lang: 'th', label: 'Niwat · ไทย',           flag: '🇹🇭', gender: 'male' },
  // Turkish
  'tr-TR-AhmetNeural':         { lang: 'tr', label: 'Ahmet · Türkçe',        flag: '🇹🇷', gender: 'male' },
  'tr-TR-EmelNeural':          { lang: 'tr', label: 'Emel · Türkçe',         flag: '🇹🇷', gender: 'female' },
  // Indonesian
  'id-ID-ArdiNeural':          { lang: 'id', label: 'Ardi · Indonesia',      flag: '🇮🇩', gender: 'male' },
  'id-ID-GadisNeural':         { lang: 'id', label: 'Gadis · Indonesia',     flag: '🇮🇩', gender: 'female' },
  // Dutch
  'nl-NL-MaartenNeural':       { lang: 'nl', label: 'Maarten · Nederlands',  flag: '🇳🇱', gender: 'male' },
  'nl-NL-ColetteNeural':       { lang: 'nl', label: 'Colette · Nederlands',  flag: '🇳🇱', gender: 'female' },
  // Polish
  'pl-PL-MarekNeural':         { lang: 'pl', label: 'Marek · Polski',        flag: '🇵🇱', gender: 'male' },
  'pl-PL-ZofiaNeural':         { lang: 'pl', label: 'Zofia · Polski',        flag: '🇵🇱', gender: 'female' },
};

export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English', vi: 'Tiếng Việt', es: 'Español', fr: 'Français',
  de: 'Deutsch', pt: 'Português', ja: '日本語', ko: '한국어',
  zh: '中文', hi: 'हिन्दी', ar: 'العربية', it: 'Italiano',
  ru: 'Русский', th: 'ไทย', tr: 'Türkçe', id: 'Indonesia',
  nl: 'Nederlands', pl: 'Polski',
};

export type VoiceName = string;

export type TtsProgressFn = (step: string, detail?: string) => void;

export interface TtsOptions {
  voice?: VoiceName;
  rate?: string;
  pitch?: string;
  volume?: string;
  style?: string;
  videoId?: string;
  onProgress?: TtsProgressFn;
}

export interface NarrationSegment {
  text: string;
  startTime: number;
  endTime: number;
  audioPath: string;
}

export interface NarrationResult {
  totalPath: string;
  segments: NarrationSegment[];
  duration: number;
}

export class NarrationService {
  private cacheDir: string;
  private audioDir: string;

  constructor() {
    this.cacheDir = path.join(process.env.CACHE_DIR ?? './cache', 'narration');
    this.audioDir = path.join(process.env.ASSETS_DIR ?? './assets', 'audio');
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.mkdirSync(this.audioDir, { recursive: true });
  }

  private getDefaultVoice(): VoiceName {
    return (getSettings().get('default_voice') as VoiceName) ?? 'en-US-GuyNeural';
  }

  async generateNarration(
    script: string,
    options: TtsOptions = {}
  ): Promise<NarrationResult> {
    const voice = options.voice || this.getDefaultVoice();
    const rate = options.rate ?? '+0%';
    const pitch = options.pitch ?? '+0Hz';
    const volume = options.volume ?? '+0%';
    const style = options.style ?? '';
    const progress = options.onProgress ?? (() => {});
    const checksum = crypto.createHash('md5').update(`${script}|${voice}|${rate}|${pitch}|${volume}|${style}`).digest('hex');
    const cachedPath = path.join(this.cacheDir, `${checksum}.mp3`);

    if (fs.existsSync(cachedPath)) {
      progress('cached', 'Using cached audio');
      const duration = await this.getAudioDuration(cachedPath);
      return { totalPath: cachedPath, segments: [], duration };
    }

    const outputPath = options.videoId
      ? path.join(this.audioDir, `narration_${options.videoId}.mp3`)
      : cachedPath;

    const chunks = this.splitTextIntoChunks(script, 2000);
    progress('start', `${script.length} chars, ${chunks.length} chunk(s)`);

    if (chunks.length <= 1) {
      progress('generating', 'Generating audio...');
      if (style && this.voiceSupportsStyle(voice)) {
        await this.runEdgeTtsSSML(script, voice, rate, pitch, volume, style, outputPath);
      } else {
        await this.runEdgeTTS(script, voice, rate, pitch, volume, outputPath);
      }
    } else {
      const chunkPaths: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        progress('chunk', `Generating chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);
        const chunkPath = path.join(this.cacheDir, `_chunk_${checksum}_${i}.mp3`);
        if (style && this.voiceSupportsStyle(voice)) {
          await this.runEdgeTtsSSML(chunks[i], voice, rate, pitch, volume, style, chunkPath);
        } else {
          await this.runEdgeTTS(chunks[i], voice, rate, pitch, volume, chunkPath);
        }
        chunkPaths.push(chunkPath);
      }
      progress('concat', `Concatenating ${chunks.length} chunks...`);
      await this.concatAudioFiles(chunkPaths, outputPath);
      for (const cp of chunkPaths) {
        try { fs.unlinkSync(cp); } catch { /* ignore */ }
      }
    }

    progress('finalizing', 'Getting duration...');
    if (outputPath !== cachedPath) {
      fs.copyFileSync(outputPath, cachedPath);
    }

    const duration = await this.getAudioDuration(outputPath);
    progress('done', `Complete: ${duration.toFixed(1)}s`);
    return { totalPath: outputPath, segments: [], duration };
  }

  private splitTextIntoChunks(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxChars) {
        chunks.push(remaining);
        break;
      }
      // Find best split point: sentence boundary near maxChars
      let splitAt = -1;
      for (const sep of ['. ', '! ', '? ', '.\n', '!\n', '?\n']) {
        const idx = remaining.lastIndexOf(sep, maxChars);
        if (idx > maxChars * 0.3 && idx > splitAt) splitAt = idx + sep.length;
      }
      // Fallback: split at last space
      if (splitAt <= 0) {
        splitAt = remaining.lastIndexOf(' ', maxChars);
        if (splitAt <= 0) splitAt = maxChars;
      }
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    return chunks.filter(Boolean);
  }

  private async concatAudioFiles(inputs: string[], outputPath: string): Promise<void> {
    const ffmpeg = resolveFfmpegPathSync('ffmpeg');
    const listFile = path.join(path.dirname(outputPath), `_concat_${Date.now()}.txt`);
    const content = inputs.map((f) => `file '${path.resolve(f).replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listFile, content, 'utf-8');
    try {
      await execFileAsync(ffmpeg, [
        '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c', 'copy', '-y', outputPath,
      ], { timeout: 30000 });
    } finally {
      try { fs.unlinkSync(listFile); } catch { /* ignore */ }
    }
  }

  async generateSegments(lines: string[], voice?: VoiceName): Promise<NarrationSegment[]> {
    const v = voice ?? this.getDefaultVoice();
    const segments: NarrationSegment[] = [];
    let currentTime = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      const checksum = crypto.createHash('md5').update(`${line}|${v}`).digest('hex');
      const segPath = path.join(this.cacheDir, `seg_${checksum}.mp3`);
      if (!fs.existsSync(segPath)) await this.runEdgeTTS(line, v, '+0%', '+0Hz', '+0%', segPath);
      const duration = await this.getAudioDuration(segPath);
      segments.push({ text: line, startTime: currentTime, endTime: currentTime + duration, audioPath: segPath });
      currentTime += duration;
    }

    return segments;
  }

  private voiceSupportsStyle(voice: string): boolean {
    return Boolean(VOICES[voice]?.styles?.length);
  }

  getVoiceStyles(voice: string): string[] {
    return VOICES[voice]?.styles ?? [];
  }

  private async runEdgeTTS(text: string, voice: VoiceName, rate: string, pitch: string, volume: string, outputPath: string): Promise<void> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Write text to temp file to avoid Windows command-line length limits
    const tmpText = path.join(path.dirname(outputPath), `_text_${Date.now()}.txt`);
    fs.writeFileSync(tmpText, text, 'utf-8');

    const timeout = Math.max(60000, text.length * 30); // scale timeout with text length

    const tryRun = async (v: string): Promise<void> => {
      const args = ['--voice', v, '--rate', rate, '--pitch', pitch, '--volume', volume, '--file', tmpText, '--write-media', outputPath];
      try {
        await execFileAsync('edge-tts', args, { timeout });
      } catch {
        await execFileAsync('python', ['-m', 'edge_tts', ...args], { timeout });
      }
    };

    try {
      await tryRun(voice);
    } catch {
      // Voice may be deprecated — retry with default voice
      const fallback = 'en-US-GuyNeural';
      if (voice !== fallback) {
        console.warn(`[tts] Voice "${voice}" failed, falling back to "${fallback}"`);
        try {
          await tryRun(fallback);
        } catch (err) {
          fs.unlinkSync(tmpText);
          throw new Error(`edge-tts failed with both "${voice}" and fallback "${fallback}". Error: ${err}`);
        }
      } else {
        fs.unlinkSync(tmpText);
        throw new Error(`edge-tts failed. Install with: pip install edge-tts`);
      }
    }
    fs.unlinkSync(tmpText);
  }

  // Style mode — edge-tts CLI doesn't support SSML, so we fall back to plain text with rate/pitch/volume flags.
  // The style parameter is ignored at CLI level (only available via the Python API).
  private async runEdgeTtsSSML(
    text: string, voice: string, rate: string, pitch: string, volume: string, _style: string, outputPath: string
  ): Promise<void> {
    // SSML not supported by edge-tts CLI — fall back to plain text mode
    await this.runEdgeTTS(text, voice, rate, pitch, volume, outputPath);
  }

  async getAudioDuration(filePath: string): Promise<number> {
    const ffprobe = resolveFfmpegPathSync('ffprobe');
    try {
      const { stdout } = await execFileAsync(ffprobe, [
        '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
      ]);
      const data = JSON.parse(stdout) as { format: { duration: string } };
      return parseFloat(data.format.duration ?? '0');
    } catch {
      return 0;
    }
  }

  getAvailableVoices(): typeof VOICES {
    return VOICES;
  }
}
