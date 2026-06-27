import type { SceneLine, SceneMood, SceneStyle, CameraType, AtmosphereType } from '@videocloudai/shared';

interface ScriptProcessorConfig {
  defaultDuration?: number;
  targetDuration?: number;
}

const MOOD_KEYWORDS: Record<SceneMood, string[]> = {
  sad: ['alone', 'lost', 'empty', 'broken', 'tears', 'pain', 'failure', 'dark', 'regret', 'goodbye'],
  hopeful: ['dream', 'future', 'chance', 'rise', 'believe', 'begin', 'start', 'hope', 'better', 'tomorrow'],
  dramatic: ['moment', 'change', 'realize', 'truth', 'suddenly', 'decision', 'turn', 'face', 'stand'],
  energetic: ['run', 'fight', 'push', 'hustle', 'grind', 'strong', 'power', 'move', 'action', 'never stop'],
  calm: ['breathe', 'peace', 'quiet', 'still', 'gentle', 'slow', 'rest', 'wait', 'simple'],
  mysterious: ['secret', 'unknown', 'hidden', 'shadow', 'question', 'wondering', 'strange', 'between'],
  romantic: ['love', 'heart', 'together', 'hold', 'close', 'feel', 'miss', 'longing'],
  dark: ['fear', 'danger', 'threat', 'hollow', 'void', 'consume', 'trapped', 'chain'],
  uplifting: ['success', 'achieve', 'overcome', 'win', 'break', 'free', 'soar', 'grow'],
  tense: ['wait', 'edge', 'moment', 'silent', 'watch', 'breathless', 'closer', 'almost'],
  melancholic: ['remember', 'used to', 'once', 'time', 'fade', 'memory', 'miss', 'left behind'],
  euphoric: ['alive', 'feel everything', 'burst', 'overflow', 'peak', 'summit', 'finally'],
};

const VISUAL_KEYWORDS: Record<string, string[]> = {
  'person sitting dark room': ['alone', 'sit', 'dark', 'room', 'wait', 'quiet', 'inside'],
  'person walking alone': ['walk', 'alone', 'street', 'path', 'night', 'road', 'move'],
  'city skyline time lapse': ['city', 'time', 'world', 'life', 'pass', 'rush', 'busy'],
  'dramatic eye closeup': ['see', 'look', 'eyes', 'watch', 'realize', 'truth', 'face'],
  'rainy window reflection': ['rain', 'window', 'outside', 'glass', 'reflect', 'stare'],
  'running through city': ['run', 'chase', 'escape', 'rush', 'hurry', 'motion'],
  'hands reaching up': ['reach', 'try', 'grasp', 'aim', 'want', 'stretch', 'above'],
  'sunset on horizon': ['end', 'begin', 'close', 'far', 'distant', 'day', 'tomorrow'],
  'crowd in city': ['people', 'everyone', 'world', 'around', 'busy', 'rush'],
  'empty road at night': ['alone', 'dark', 'ahead', 'journey', 'path', 'forward'],
  'person on rooftop': ['above', 'alone', 'city', 'top', 'stand', 'view', 'overlook'],
  'phone screen glow': ['message', 'news', 'scroll', 'digital', 'screen', 'check'],
  'coffee steam close up': ['morning', 'begin', 'start', 'warm', 'wake', 'ritual'],
  'clock ticking': ['time', 'wait', 'count', 'moment', 'tick', 'pass', 'hurry'],
  'flowers blooming timelapse': ['grow', 'bloom', 'transform', 'change', 'nature', 'life'],
};

const ATMOSPHERE_BY_MOOD: Record<SceneMood, AtmosphereType> = {
  sad: 'rainy',
  hopeful: 'golden-hour',
  dramatic: 'overcast',
  energetic: 'clear',
  calm: 'clear',
  mysterious: 'foggy',
  romantic: 'blue-hour',
  dark: 'night',
  uplifting: 'sunny',
  tense: 'overcast',
  melancholic: 'overcast',
  euphoric: 'golden-hour',
};

const CAMERA_BY_MOOD: Record<SceneMood, CameraType> = {
  sad: 'handheld',
  hopeful: 'dolly',
  dramatic: 'closeup',
  energetic: 'tracking',
  calm: 'static',
  mysterious: 'static',
  romantic: 'dolly',
  dark: 'handheld',
  uplifting: 'crane',
  tense: 'closeup',
  melancholic: 'dolly',
  euphoric: 'aerial',
};

export class ScriptProcessor {
  private config: Required<ScriptProcessorConfig>;

  constructor(config: ScriptProcessorConfig = {}) {
    this.config = {
      defaultDuration: config.defaultDuration ?? 4,
      targetDuration: config.targetDuration ?? 60,
    };
  }

  process(script: string, targetDuration?: number): SceneLine[] {
    const target = targetDuration ?? this.config.targetDuration;
    const sentences = this.splitIntoSentences(script);
    const scenes = sentences.map((sentence) => this.sentenceToScene(sentence));
    return this.adjustDurations(scenes, target);
  }

  private splitIntoSentences(text: string): string[] {
    return text
      .replace(/\n+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3);
  }

  private sentenceToScene(line: string): SceneLine {
    const mood = this.detectMood(line);
    const visual = this.detectVisual(line, mood);
    const duration = this.estimateDuration(line);

    return {
      line,
      visual,
      mood,
      duration,
      style: this.moodToStyle(mood),
      cameraType: CAMERA_BY_MOOD[mood],
      atmosphere: ATMOSPHERE_BY_MOOD[mood],
      tags: this.extractTags(line, visual, mood),
    };
  }

  private detectMood(text: string): SceneMood {
    const lower = text.toLowerCase();
    const scores: Partial<Record<SceneMood, number>> = {};

    for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS) as [SceneMood, string[]][]) {
      scores[mood] = keywords.filter((kw) => lower.includes(kw)).length;
    }

    const sorted = (Object.entries(scores) as [SceneMood, number][]).sort((a, b) => b[1] - a[1]);
    return sorted[0][1] > 0 ? sorted[0][0] : 'dramatic';
  }

  private detectVisual(text: string, mood: SceneMood): string {
    const lower = text.toLowerCase();
    let bestMatch = '';
    let bestScore = 0;

    for (const [visual, keywords] of Object.entries(VISUAL_KEYWORDS)) {
      const score = keywords.filter((kw) => lower.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = visual;
      }
    }

    if (!bestMatch || bestScore === 0) {
      return this.defaultVisualForMood(mood);
    }

    return bestMatch;
  }

  private defaultVisualForMood(mood: SceneMood): string {
    const defaults: Record<SceneMood, string> = {
      sad: 'person sitting dark room',
      hopeful: 'sunrise over horizon',
      dramatic: 'dramatic eye closeup',
      energetic: 'running through city',
      calm: 'quiet nature landscape',
      mysterious: 'shadow in dark corridor',
      romantic: 'two silhouettes at sunset',
      dark: 'empty dark streets',
      uplifting: 'person standing on peak',
      tense: 'ticking clock closeup',
      melancholic: 'rainy window reflection',
      euphoric: 'crowd celebrating at night',
    };
    return defaults[mood];
  }

  private estimateDuration(text: string): number {
    const wordCount = text.split(/\s+/).length;
    const baseSeconds = Math.max(3, Math.ceil(wordCount / 2.5));
    return Math.min(baseSeconds, 8);
  }

  private moodToStyle(mood: SceneMood): SceneStyle {
    const map: Record<SceneMood, SceneStyle> = {
      sad: 'emotional-storytelling',
      hopeful: 'documentary',
      dramatic: 'emotional-storytelling',
      energetic: 'modern',
      calm: 'natural',
      mysterious: 'noir',
      romantic: 'emotional-storytelling',
      dark: 'dark-fantasy',
      uplifting: 'documentary',
      tense: 'noir',
      melancholic: 'emotional-storytelling',
      euphoric: 'modern',
    };
    return map[mood];
  }

  private extractTags(line: string, visual: string, mood: SceneMood): string[] {
    const tags = new Set<string>();
    tags.add(mood);
    tags.add(visual.split(' ')[0]);

    const lower = line.toLowerCase();
    const importantWords = lower.match(/\b[a-z]{5,}\b/g) ?? [];
    importantWords.slice(0, 3).forEach((w) => tags.add(w));

    return Array.from(tags);
  }

  private adjustDurations(scenes: SceneLine[], targetDuration: number): SceneLine[] {
    const totalRaw = scenes.reduce((s, c) => s + c.duration, 0);
    if (totalRaw === 0) return scenes;

    const scale = targetDuration / totalRaw;

    return scenes.map((scene) => ({
      ...scene,
      duration: Math.round(Math.max(2, scene.duration * scale)),
    }));
  }
}
