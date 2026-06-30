import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSettings } from './settings.service';
import { resolveFfmpegPathSync } from './import.service';

const execFileAsync = promisify(execFile);

export const MOOD_TAGS: Record<string, string> = {
  dramatic:    'cinematic orchestral epic',
  sad:         'sad melancholic emotional',
  hopeful:     'inspirational hopeful',
  energetic:   'energetic upbeat motivational',
  calm:        'ambient relaxing peaceful',
  mysterious:  'mysterious dark atmospheric',
  romantic:    'romantic love soft',
  dark:        'dark atmospheric drone',
  uplifting:   'uplifting inspiring positive',
  tense:       'tense suspense thriller',
  melancholic: 'melancholic nostalgic',
  euphoric:    'euphoric happy',
};

// Epidemic Sound mood slugs (used in their moods= query param)
const EPIDEMIC_MOOD_MAP: Record<string, string> = {
  dramatic:    'epic',
  sad:         'sad',
  hopeful:     'hopeful',
  energetic:   'happy',
  calm:        'relaxing',
  mysterious:  'mysterious',
  romantic:    'romantic',
  dark:        'dark',
  uplifting:   'hopeful',
  tense:       'angry',
  melancholic: 'sad',
  euphoric:    'happy',
};

// ── Epidemic Sound types ──────────────────────────────────────────────────────
export interface EpidemicTrack {
  id: number;
  title: string;
  artist: string;
  duration: number;       // seconds
  previewUrl: string;     // lqMp3Url from stems
  genres: string[];
  moods: string[];
}

interface EpidemicStem {
  stemType: string;
  lqMp3Url: string;
}

interface EpidemicSong {
  id: number;
  title: string;
  length: number;
  creatives?: Record<string, Array<{ name?: string; slug?: string }>>;
  stems: Record<string, EpidemicStem>;
  genres?: Array<{ displayTag: string }>;
  moods?: Array<{ displayTag: string }>;
}

interface EpidemicResponse {
  entities: { tracks: Record<string, EpidemicSong> };
  meta: { totalHits: number };
}

export interface JamendoTrack {
  id: string;
  name: string;
  artist_name: string;
  duration: number;
  audio: string;
  audiodownload: string;
  image: string;
  shareurl: string;
  tags?: string;
}

interface JamendoResponse {
  headers: { status: string; code: number; error_message?: string };
  results: JamendoTrack[];
}

export class MusicService {
  private cacheDir: string;

  constructor() {
    this.cacheDir = path.resolve(process.env.CACHE_DIR ?? './cache', 'music');
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  getCacheDir(): string {
    return this.cacheDir;
  }

  getClientId(): string {
    return getSettings().get('jamendo_client_id');
  }

  getMusicVolume(): number {
    return parseFloat(getSettings().get('music_volume') || '0.20');
  }

  async searchTracks(mood: string, limit = 10): Promise<JamendoTrack[]> {
    const clientId = this.getClientId();
    if (!clientId) throw new Error('Jamendo Client ID not configured');

    const tags = MOOD_TAGS[mood] ?? mood;
    const url = new URL('https://api.jamendo.com/v3.0/tracks/');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('tags', tags.split(' ')[0]); // Jamendo tags param: one tag at a time for accuracy
    url.searchParams.set('search', tags.split(' ').slice(1).join(' '));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('audioformat', 'mp32');
    url.searchParams.set('include', 'musicinfo');
    url.searchParams.set('order', 'popularity_total');
    url.searchParams.set('format', 'json');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Jamendo API error: ${res.status} ${res.statusText}`);

    const data = await res.json() as JamendoResponse;
    if (data.headers.code !== 0) {
      throw new Error(`Jamendo error: ${data.headers.error_message ?? 'unknown'}`);
    }
    return data.results ?? [];
  }

  async downloadTrack(track: JamendoTrack): Promise<string> {
    const cachedPath = path.join(this.cacheDir, `${track.id}.mp3`);
    if (fs.existsSync(cachedPath)) return cachedPath;

    const url = track.audiodownload || track.audio;
    if (!url) throw new Error(`No download URL for track ${track.id}`);

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Failed to download track ${track.id}: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(cachedPath, buffer);
    return cachedPath;
  }

  async getTrackForMood(mood: string): Promise<{ localPath: string; track?: JamendoTrack; trackName?: string } | null> {
    // Try Jamendo first (if configured), fall back to Epidemic Sound
    if (this.getClientId()) {
      try {
        const tracks = await this.searchTracks(mood, 10);
        if (tracks.length) {
          const track = tracks[Math.floor(Math.random() * Math.min(tracks.length, 5))];
          const localPath = await this.downloadTrack(track);
          return { localPath, track };
        }
      } catch {
        // fall through to Epidemic Sound
      }
    }
    // Epidemic Sound — no API key needed
    return this.getEpidemicTrackForMood(mood);
  }

  // ── Epidemic Sound (no API key needed) ───────────────────────────────────────
  async searchEpidemic(mood: string, term?: string, limit = 15): Promise<EpidemicTrack[]> {
    const moodSlug = mood ? (EPIDEMIC_MOOD_MAP[mood] ?? mood) : '';
    const params = new URLSearchParams({
      limit: String(limit),
      page: '1',
      order: 'desc',
      sort: 'relevance',
    });
    if (term) params.set('term', term);
    if (moodSlug) params.set('moods', moodSlug);

    const url = `https://www.epidemicsound.com/json/search/tracks/?${params}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Epidemic Sound search failed: ${res.status}`);

    const data = await res.json() as EpidemicResponse;
    const songs = Object.values(data.entities?.tracks ?? {});

    return songs.map((s) => {
      const fullStem = s.stems?.full ?? Object.values(s.stems ?? {})[0];
      const artist = s.creatives?.mainArtists?.[0]?.name ?? 'Unknown';
      return {
        id: s.id,
        title: s.title,
        artist,
        duration: s.length,
        previewUrl: fullStem?.lqMp3Url ?? '',
        genres: (s.genres ?? []).map((g) => g.displayTag),
        moods: (s.moods ?? []).map((m) => m.displayTag),
      };
    }).filter((t) => t.previewUrl);
  }

  async downloadEpidemicTrack(track: EpidemicTrack): Promise<string> {
    const filename = `es_${track.id}.mp3`;
    const cachedPath = path.join(this.cacheDir, filename);
    if (fs.existsSync(cachedPath)) return cachedPath;

    if (!track.previewUrl) throw new Error('No preview URL');

    const res = await fetch(track.previewUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(cachedPath, buffer);
    return cachedPath;
  }

  async getEpidemicTrackForMood(mood: string): Promise<{ localPath: string; trackName: string } | null> {
    try {
      const tracks = await this.searchEpidemic(mood, undefined, 10);
      if (!tracks.length) return null;
      const track = tracks[Math.floor(Math.random() * Math.min(tracks.length, 5))];
      const localPath = await this.downloadEpidemicTrack(track);
      return { localPath, trackName: `${track.title} — ${track.artist}` };
    } catch (err) {
      console.warn('[music] Epidemic Sound search failed:', (err as Error).message);
      return null;
    }
  }

  getTrackPath(filename: string): string {
    return path.join(this.cacheDir, filename);
  }

  listCached(): Array<{ id: string; filename: string; sizeKB: number; duration?: number }> {
    try {
      return fs.readdirSync(this.cacheDir)
        .filter((f) => f.endsWith('.mp3'))
        .map((f) => ({
          id: path.basename(f, '.mp3'),
          filename: f,
          sizeKB: Math.round(fs.statSync(path.join(this.cacheDir, f)).size / 1024),
        }));
    } catch {
      return [];
    }
  }

  async listCachedWithDuration(): Promise<Array<{ id: string; filename: string; sizeKB: number; duration: number }>> {
    const items = this.listCached();
    return Promise.all(items.map(async (item) => {
      const dur = await this.probeAudioDuration(path.join(this.cacheDir, item.filename));
      return { ...item, duration: dur };
    }));
  }

  async probeAudioDuration(filePath: string): Promise<number> {
    try {
      const ffprobe = resolveFfmpegPathSync('ffprobe');
      const { stdout } = await execFileAsync(ffprobe, [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
      ], { timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
      return Math.round(parseFloat(stdout.trim()) || 0);
    } catch {
      return 0;
    }
  }

  getFilePath(filename: string): string | null {
    const filePath = path.join(this.cacheDir, path.basename(filename));
    return fs.existsSync(filePath) ? filePath : null;
  }

  clearCache(): void {
    try {
      fs.readdirSync(this.cacheDir)
        .filter((f) => f.endsWith('.mp3'))
        .forEach((f) => fs.rmSync(path.join(this.cacheDir, f)));
    } catch {
      // best-effort
    }
  }
}

let _instance: MusicService | null = null;
export function getMusicService(): MusicService {
  if (!_instance) _instance = new MusicService();
  return _instance;
}
