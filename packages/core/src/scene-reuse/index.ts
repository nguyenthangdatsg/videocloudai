import type {
  SceneMetadata,
  AssetRecord,
  SceneLine,
  SceneMatch,
  SceneMood,
  SceneStyle,
  AtmosphereType,
} from '@videocloudai/shared';

interface ReuseEngineConfig {
  minScore?: number;
  maxResults?: number;
}

interface SceneCandidate {
  scene: SceneMetadata;
  asset: AssetRecord;
}

export class SceneReuseEngine {
  private config: Required<ReuseEngineConfig>;

  constructor(config: ReuseEngineConfig = {}) {
    this.config = {
      minScore: config.minScore ?? 0.3,
      maxResults: config.maxResults ?? 5,
    };
  }

  findMatches(target: SceneLine, candidates: SceneCandidate[]): SceneMatch[] {
    const scored = candidates
      .map((candidate) => ({
        candidate,
        result: this.scoreCandidate(target, candidate),
      }))
      .filter((item) => item.result.score >= this.config.minScore)
      .sort((a, b) => b.result.score - a.result.score)
      .slice(0, this.config.maxResults);

    return scored.map((item) => ({
      sceneId: item.candidate.scene.id,
      score: item.result.score,
      matchReason: item.result.reasons,
      asset: item.candidate.asset,
    }));
  }

  private scoreCandidate(
    target: SceneLine,
    candidate: SceneCandidate
  ): { score: number; reasons: string[] } {
    const { scene } = candidate;
    let score = 0;
    const reasons: string[] = [];

    // Mood match — highest weight
    if (target.mood && scene.mood === target.mood) {
      score += 0.35;
      reasons.push(`mood match: ${target.mood}`);
    } else if (target.mood && this.moodCompatible(target.mood, scene.mood)) {
      score += 0.15;
      reasons.push(`compatible mood: ${scene.mood}`);
    }

    // Style match
    if (target.style && scene.style === target.style) {
      score += 0.2;
      reasons.push(`style match: ${target.style}`);
    }

    // Atmosphere match
    if (target.atmosphere && scene.atmosphere === target.atmosphere) {
      score += 0.15;
      reasons.push(`atmosphere match: ${target.atmosphere}`);
    }

    // Tag overlap
    const targetTags = new Set(target.tags ?? []);
    const tagOverlap = scene.tags.filter((t) => targetTags.has(t)).length;
    if (tagOverlap > 0) {
      const tagScore = Math.min(0.2, tagOverlap * 0.07);
      score += tagScore;
      reasons.push(`${tagOverlap} matching tag(s)`);
    }

    // Keyword overlap in visual description
    const targetWords = new Set(target.visual.toLowerCase().split(/\s+/));
    const keywordOverlap = scene.reuseKeywords.filter((k) =>
      targetWords.has(k.toLowerCase())
    ).length;
    if (keywordOverlap > 0) {
      const kwScore = Math.min(0.1, keywordOverlap * 0.05);
      score += kwScore;
      reasons.push(`${keywordOverlap} keyword match(es)`);
    }

    // Duration penalty if too short
    if (scene.duration < target.duration * 0.5) {
      score -= 0.1;
      reasons.push('duration too short');
    }

    // Quality bonus
    if (scene.qualityScore >= 0.8) {
      score += 0.05;
      reasons.push('high quality asset');
    }

    // Prefer less-used scenes (diversity)
    if (scene.usageCount === 0) {
      score += 0.03;
    }

    return { score: Math.max(0, Math.min(1, score)), reasons };
  }

  private moodCompatible(target: SceneMood, candidate: SceneMood): boolean {
    const compatibilityMap: Partial<Record<SceneMood, SceneMood[]>> = {
      sad: ['melancholic', 'dark', 'mysterious'],
      hopeful: ['uplifting', 'calm', 'euphoric'],
      dramatic: ['tense', 'dark', 'mysterious'],
      energetic: ['euphoric', 'uplifting'],
      calm: ['hopeful', 'romantic'],
      melancholic: ['sad', 'mysterious', 'dark'],
      uplifting: ['hopeful', 'euphoric', 'energetic'],
      dark: ['sad', 'tense', 'mysterious'],
      tense: ['dramatic', 'dark'],
      euphoric: ['energetic', 'uplifting'],
      mysterious: ['dark', 'tense'],
      romantic: ['calm', 'melancholic'],
    };
    return (compatibilityMap[target] ?? []).includes(candidate);
  }

  rankForReuse(candidates: SceneCandidate[]): SceneCandidate[] {
    return [...candidates].sort((a, b) => {
      const scoreA = a.scene.qualityScore - a.scene.usageCount * 0.01;
      const scoreB = b.scene.qualityScore - b.scene.usageCount * 0.01;
      return scoreB - scoreA;
    });
  }

  suggestReuseContexts(scene: SceneMetadata): string[] {
    const contexts: string[] = [];

    const moodContexts: Record<SceneMood, string[]> = {
      sad: ['sad edit', 'emotional video', 'breakup montage', 'reflection content'],
      hopeful: ['motivation video', 'success story', 'new beginnings', 'inspirational reel'],
      dramatic: ['storytelling video', 'drama clip', 'intense moment', 'plot reveal'],
      energetic: ['workout motivation', 'hype reel', 'action montage', 'sports edit'],
      calm: ['meditation video', 'mindfulness content', 'peaceful edit', 'ambient video'],
      mysterious: ['mystery edit', 'thriller content', 'suspense reel', 'dark aesthetic'],
      romantic: ['love edit', 'couple video', 'romantic reel', 'relationship content'],
      dark: ['dark aesthetic', 'edgy content', 'atmospheric edit', 'moody reel'],
      uplifting: ['success story', 'inspiration video', 'achievement reel', 'positive content'],
      tense: ['thriller clip', 'suspense moment', 'tension build', 'dramatic reveal'],
      melancholic: ['nostalgic edit', 'memories montage', 'reflection video', 'bittersweet content'],
      euphoric: ['celebration reel', 'party highlight', 'joy montage', 'peak moment'],
    };

    contexts.push(...(moodContexts[scene.mood] ?? []));

    const styleContexts: Record<SceneStyle, string[]> = {
      'anime-cinematic': ['anime edit', 'weebs content', 'anime aesthetic', 'manga vibe'],
      documentary: ['documentary style', 'real stories', 'authentic content'],
      noir: ['noir aesthetic', 'black and white edit', 'classic cinema vibe'],
      'dark-fantasy': ['fantasy content', 'epic edit', 'dark magic aesthetic'],
      'sci-fi': ['sci-fi edit', 'futuristic content', 'tech aesthetic'],
      'emotional-storytelling': ['story time', 'personal journey', 'emotional moment'],
      cyberpunk: ['cyberpunk aesthetic', 'neon edit', 'future city vibe'],
      natural: ['nature content', 'outdoor reel', 'landscape video'],
      vintage: ['vintage aesthetic', 'retro edit', 'throwback content'],
      modern: ['modern edit', 'clean aesthetic', 'professional reel'],
    };

    contexts.push(...(styleContexts[scene.style] ?? []));

    return [...new Set(contexts)];
  }
}
