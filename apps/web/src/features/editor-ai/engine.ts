import type { SceneLine } from '@videocloudai/shared';
import type { Recommendation, RecommendationType, CinematicEffect, TransitionType, SubtitleStyle } from './types';

function rec(
  type: RecommendationType,
  message: string,
  confidence: number,
  actionLabel: string,
  opts: {
    sceneIndex?: number;
    detail?: string;
    effect?: CinematicEffect;
    transition?: TransitionType;
    subtitleStyle?: SubtitleStyle;
  } = {}
): Recommendation {
  return {
    id: `${type}-${opts.sceneIndex ?? 'global'}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    message,
    confidence,
    actionLabel,
    ...opts,
  };
}

export function analyzeScenes(scenes: SceneLine[]): Recommendation[] {
  if (scenes.length === 0) return [];

  const results: Recommendation[] = [];
  const totalDuration = scenes.reduce((s, sc) => s + sc.duration, 0);
  const avgDuration = totalDuration / scenes.length;

  scenes.forEach((scene, i) => {
    const prev = scenes[i - 1];
    const next = scenes[i + 1];

    // --- Pacing: intro too slow ---
    if (i === 0 && scene.duration > 5) {
      results.push(rec(
        'pacing-slow', 'Intro feels too slow', 0.88, 'Trim intro',
        { sceneIndex: i, detail: `${scene.duration}s open — hook viewers in under 3s` }
      ));
    }

    // --- Pacing: scene significantly above average ---
    if (scene.duration > avgDuration * 1.8 && scene.duration > 6) {
      results.push(rec(
        'cut', `Scene ${i + 1} drags on`, 0.75, 'Suggest cut',
        {
          sceneIndex: i,
          detail: `${scene.duration}s vs avg ${avgDuration.toFixed(1)}s — consider splitting`,
        }
      ));
    }

    // --- Mood transition without visual bridge ---
    if (prev && prev.mood !== scene.mood) {
      const trans: TransitionType = ['dramatic', 'tense', 'dark'].includes(scene.mood)
        ? 'zoom-in'
        : ['calm', 'sad', 'melancholic'].includes(scene.mood)
        ? 'dissolve'
        : 'fade';
      results.push(rec(
        'transition', `Mood shift: ${prev.mood} → ${scene.mood}`, 0.82, 'Add transition',
        { sceneIndex: i, detail: 'A visual bridge would smooth this emotional change', transition: trans }
      ));
    }

    // --- Zoom punch for high-energy moods ---
    if (['dramatic', 'tense', 'energetic'].includes(scene.mood)) {
      results.push(rec(
        'zoom-punch', 'Add zoom punch here', 0.79, 'Apply zoom',
        {
          sceneIndex: i,
          detail: `${scene.mood} scene is perfect for zoom-in emphasis`,
          effect: 'zoom-punch',
        }
      ));
    }

    // --- Emotional glow ---
    if (['sad', 'melancholic', 'romantic', 'hopeful'].includes(scene.mood)) {
      results.push(rec(
        'emotional-highlight', 'Emotional moment — enhance it', 0.74, 'Add glow',
        {
          sceneIndex: i,
          detail: 'Glow or vignette amplifies this mood beautifully',
          effect: 'glow',
        }
      ));
    }

    // --- Long subtitle: keyword emphasis ---
    if (scene.line.length > 75) {
      results.push(rec(
        'subtitle-emphasis', 'Subtitle needs keyword emphasis', 0.86, 'Emphasize',
        {
          sceneIndex: i,
          detail: `${scene.line.length} chars — highlight key words for impact`,
          subtitleStyle: 'keyword-emphasis',
        }
      ));
    }

    // --- Three consecutive same-mood scenes ---
    if (
      i >= 2 &&
      scenes[i - 2].mood === scenes[i - 1].mood &&
      scenes[i - 1].mood === scene.mood
    ) {
      results.push(rec(
        'mood-shift', `3 consecutive ${scene.mood} scenes`, 0.70, 'Vary mood',
        {
          sceneIndex: i,
          detail: 'Vary the emotional rhythm to keep viewers engaged',
        }
      ));
    }

    // --- Commentary on dark/mysterious scenes ---
    if (['dark', 'mysterious'].includes(scene.mood)) {
      results.push(rec(
        'commentary-overlay', 'Add commentary overlay here', 0.65, 'Add commentary',
        {
          sceneIndex: i,
          detail: 'This moment benefits from context or reaction narration',
        }
      ));
    }

    // --- Anime style: suggest flash ---
    if (scene.style === 'anime-cinematic') {
      results.push(rec(
        'add-effect', 'Anime flash effect here', 0.77, 'Apply flash',
        {
          sceneIndex: i,
          detail: 'Speed flash will enhance this anime-style scene',
          effect: 'anime-flash',
        }
      ));
    }

    // --- Energetic: speed ramp ---
    if (scene.mood === 'energetic' && scene.duration > 3) {
      results.push(rec(
        'pacing-fast', 'Speed ramp opportunity', 0.73, 'Speed ramp',
        {
          sceneIndex: i,
          detail: 'Energetic scene would pop with a speed ramp effect',
          effect: 'speed-ramp',
        }
      ));
    }

    // --- Last scene: check for strong outro ---
    if (i === scenes.length - 1 && scene.mood !== 'uplifting' && scene.mood !== 'hopeful') {
      results.push(rec(
        'scene-restructure', 'Outro may feel flat', 0.62, 'Review outro',
        {
          sceneIndex: i,
          detail: 'Consider ending on an uplifting or hopeful note for better retention',
        }
      ));
    }
  });

  // Deduplicate by sceneIndex+type, keep highest confidence, sort, and limit
  const map = new Map<string, Recommendation>();
  for (const r of results) {
    const key = `${r.sceneIndex}-${r.type}`;
    const existing = map.get(key);
    if (!existing || r.confidence > existing.confidence) {
      map.set(key, r);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12);
}
