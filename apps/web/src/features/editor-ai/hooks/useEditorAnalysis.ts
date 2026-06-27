import { useEffect, useRef } from 'react';
import type { SceneLine } from '@videocloudai/shared';
import { useEditorAIStore } from '../store';

export function useEditorAnalysis(scenes: SceneLine[]) {
  const analyze = useEditorAIStore((s) => s.analyze);
  const reset = useEditorAIStore((s) => s.reset);
  const lastKey = useRef('');

  useEffect(() => {
    // Fingerprint by mood+duration+line-length — avoids re-analysis on unrelated refetches
    const key = scenes
      .map((s) => `${s.mood}:${s.duration}:${s.line.length}`)
      .join('|');

    if (key !== lastKey.current) {
      lastKey.current = key;
      if (key === '') {
        reset();
      } else {
        analyze(scenes);
      }
    }
  }, [scenes, analyze, reset]);
}
