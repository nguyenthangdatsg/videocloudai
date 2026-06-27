import type { SceneStyle, SceneMood, CameraType, AtmosphereType } from '@videocloudai/shared';

interface EnhancerConfig {
  defaultStyle?: SceneStyle;
}

const STYLE_SUFFIXES: Record<SceneStyle, string> = {
  'anime-cinematic':
    'anime cinematic style, detailed background art, cel-shaded lighting, emotional color palette, studio ghibli atmosphere',
  documentary:
    'documentary style, natural lighting, handheld realism, authentic atmosphere, raw emotional depth',
  noir: 'film noir style, high contrast black and white, dramatic shadows, venetian blind light patterns, moody atmosphere',
  'dark-fantasy':
    'dark fantasy aesthetic, dramatic lighting, atmospheric fog, gothic undertones, cinematic depth',
  'sci-fi':
    'sci-fi cyberpunk aesthetic, neon lighting, holographic elements, futuristic atmosphere, chrome and glass',
  'emotional-storytelling':
    'emotional storytelling style, soft lighting, shallow depth of field, warm tones, intimate framing',
  cyberpunk:
    'cyberpunk aesthetic, neon-drenched rain, holographic billboards, atmospheric fog, ultradetailed urban grit',
  natural:
    'natural photography style, golden hour lighting, organic textures, authentic color grading, environmental storytelling',
  vintage: 'vintage film aesthetic, grain overlay, warm desaturated tones, lens flare, retro color palette',
  modern: 'modern cinematic style, clean composition, professional color grade, high production value',
};

const CAMERA_PREFIXES: Record<CameraType, string> = {
  handheld: 'handheld camera, slight motion, intimate feel',
  dolly: 'smooth dolly shot, cinematic movement',
  aerial: 'aerial drone shot, sweeping perspective',
  closeup: 'extreme closeup, macro lens, intimate detail',
  'wide-shot': 'wide cinematic shot, epic scope',
  tracking: 'dynamic tracking shot, following motion',
  static: 'static locked-off shot, deliberate composition',
  pov: 'point-of-view shot, first person perspective',
  crane: 'crane shot, revealing movement, majestic scale',
};

const ATMOSPHERE_ENHANCEMENTS: Record<AtmosphereType, string> = {
  rainy: 'rain-soaked streets, water droplets, neon reflections in puddles, atmospheric moisture',
  foggy: 'mysterious fog, diffused light, limited visibility, atmospheric depth',
  sunny: 'bright natural sunlight, long shadows, warm golden tones',
  overcast: 'overcast sky, flat diffused lighting, moody gray tones',
  night: 'deep night, artificial light pools, stark shadows, urban glow',
  'golden-hour': 'golden hour sunlight, warm amber tones, long dramatic shadows, cinematic warmth',
  'blue-hour': 'blue hour twilight, cool tones, city lights emerging, romantic atmosphere',
  stormy: 'stormy atmosphere, dramatic clouds, lightning potential, tense energy',
  clear: 'crystal clear atmosphere, sharp details, vivid colors',
  smoky: 'smoky haze, diffused backlight, particle atmosphere, industrial feel',
};

const MOOD_ENHANCEMENTS: Record<SceneMood, string> = {
  sad: 'melancholic color grade, desaturated blues, emotional weight, heavy atmosphere',
  hopeful: 'warm optimistic lighting, rising composition, expansive feeling, bright horizon',
  dramatic: 'high contrast lighting, dramatic shadows, tense composition, cinematic weight',
  energetic: 'vibrant saturated colors, dynamic motion, intense energy, kinetic atmosphere',
  calm: 'soft muted palette, gentle lighting, peaceful composition, serene atmosphere',
  mysterious: 'dark shadows, hidden details, intrigue, mysterious silhouettes',
  romantic: 'warm soft bokeh, intimate lighting, romantic color grade, emotional softness',
  dark: 'deep shadows, desaturated palette, threatening atmosphere, cold tones',
  uplifting: 'bright uplifting colors, expansive composition, triumphant feeling',
  tense: 'tight framing, high contrast, unsettling composition, nervous energy',
  melancholic: 'cool desaturated tones, heavy atmosphere, nostalgic quality',
  euphoric: 'vibrant saturated colors, dynamic lighting, exhilarating composition',
};

const QUALITY_SUFFIX =
  '8k resolution, photorealistic, ultra-detailed, professional cinematography, masterful composition';

export class PromptEnhancer {
  private config: Required<EnhancerConfig>;

  constructor(config: EnhancerConfig = {}) {
    this.config = {
      defaultStyle: config.defaultStyle ?? 'emotional-storytelling',
    };
  }

  enhance(
    prompt: string,
    options: {
      style?: SceneStyle;
      mood?: SceneMood;
      cameraType?: CameraType;
      atmosphere?: AtmosphereType;
      duration?: number;
    } = {}
  ): string {
    const parts: string[] = [];

    if (options.cameraType) {
      parts.push(CAMERA_PREFIXES[options.cameraType]);
    }

    parts.push(prompt);

    if (options.atmosphere) {
      parts.push(ATMOSPHERE_ENHANCEMENTS[options.atmosphere]);
    }

    if (options.mood) {
      parts.push(MOOD_ENHANCEMENTS[options.mood]);
    }

    const style = options.style ?? this.config.defaultStyle;
    parts.push(STYLE_SUFFIXES[style]);
    parts.push(QUALITY_SUFFIX);

    if (options.duration && options.duration > 0) {
      parts.push(`${options.duration} second cinematic sequence`);
    }

    return parts.join(', ');
  }

  generateVariations(
    prompt: string,
    count: number,
    options: {
      style?: SceneStyle;
      mood?: SceneMood;
    } = {}
  ): string[] {
    const variationSuffixes = [
      'version A, slight angle variation',
      'version B, alternative lighting',
      'version C, different composition',
      'version D, color grade variation',
      'version E, time of day shift',
    ];

    return Array.from({ length: Math.min(count, 5) }, (_, i) => {
      const base = this.enhance(prompt, options);
      return `${base}, ${variationSuffixes[i] ?? `variation ${i + 1}`}`;
    });
  }

  buildSearchQuery(prompt: string): string[] {
    return prompt
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(' ')
      .filter((w) => w.length > 3)
      .slice(0, 8);
  }
}
