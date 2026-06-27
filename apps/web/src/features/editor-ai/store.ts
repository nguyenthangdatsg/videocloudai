import { create } from 'zustand';
import type { SceneLine } from '@videocloudai/shared';
import type {
  Recommendation,
  AppliedEdit,
  PresetId,
  SubtitleStyle,
} from './types';
import { analyzeScenes } from './engine';
import { EDIT_PRESETS } from './presets';

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface FrameTransform {
  // Crop is normalized 0-1 of the source frame. null = no crop.
  crop: { x: number; y: number; width: number; height: number } | null;
  flipH: boolean;
  flipV: boolean;
  rotation: 0 | 90 | 180 | 270;
  // Logo / watermark overlay
  logoUrl: string | null;
  logoPosition: LogoPosition;
  logoSize: number;     // % of container width, 5-50
  logoOpacity: number;  // 0-1
}

export const DEFAULT_FRAME_TRANSFORM: FrameTransform = {
  crop: null,
  flipH: false,
  flipV: false,
  rotation: 0,
  logoUrl: null,
  logoPosition: 'bottom-right',
  logoSize: 12,
  logoOpacity: 0.85,
};

interface EditorAIStore {
  recommendations: Recommendation[];
  dismissedIds: Set<string>;
  appliedPresetId: PresetId | null;
  appliedEdits: AppliedEdit[];
  globalSubtitleStyle: SubtitleStyle;
  sidebarOpen: boolean;
  activeTab: 'properties' | 'ai' | 'transform' | 'tools';
  isAnalyzing: boolean;
  // Seek request — incrementing token forces the player to re-apply even if seekTime repeats
  seekTime: number;
  seekToken: number;
  // Current player time, reported by the player so panels (timeline) can highlight the active scene
  currentTime: number;
  // Actual video element duration, reported by the player. Source of truth for the trim
  // scrubber when project.scenes is empty (e.g. URL-imported clips).
  videoDuration: number;
  // Frame transforms — crop, flip, rotate, logo overlay
  frameTransform: FrameTransform;

  analyze: (scenes: SceneLine[]) => void;
  dismissRecommendation: (id: string) => void;
  applyRecommendation: (id: string) => void;
  applyPreset: (presetId: PresetId, scenes: SceneLine[]) => void;
  clearPreset: () => void;
  setGlobalSubtitleStyle: (style: SubtitleStyle) => void;
  setActiveTab: (tab: 'properties' | 'ai' | 'transform' | 'tools') => void;
  requestSeek: (time: number) => void;
  setCurrentTime: (t: number) => void;
  setVideoDuration: (d: number) => void;
  updateTransform: (changes: Partial<FrameTransform>) => void;
  resetTransform: () => void;
  reset: () => void;
}

export const useEditorAIStore = create<EditorAIStore>((set, get) => ({
  recommendations: [],
  dismissedIds: new Set(),
  appliedPresetId: null,
  appliedEdits: [],
  globalSubtitleStyle: 'default',
  sidebarOpen: true,
  activeTab: 'properties',
  isAnalyzing: false,
  seekTime: 0,
  seekToken: 0,
  currentTime: 0,
  videoDuration: 0,
  frameTransform: { ...DEFAULT_FRAME_TRANSFORM },

  analyze: (scenes) => {
    if (scenes.length === 0) return;
    set({ isAnalyzing: true });
    // Defer off the render thread
    setTimeout(() => {
      const recs = analyzeScenes(scenes);
      set({ recommendations: recs, isAnalyzing: false });
    }, 80);
  },

  dismissRecommendation: (id) =>
    set((s) => ({ dismissedIds: new Set([...s.dismissedIds, id]) })),

  applyRecommendation: (id) => {
    const rec = get().recommendations.find((r) => r.id === id);
    if (!rec || rec.sceneIndex === undefined) return;
    const sceneIndex = rec.sceneIndex; // narrow to number

    set((s) => {
      const existing = s.appliedEdits.find((e) => e.sceneIndex === sceneIndex);
      const updatedEdits: AppliedEdit[] = existing
        ? s.appliedEdits.map((e) =>
            e.sceneIndex === sceneIndex
              ? {
                  ...e,
                  effects: rec.effect
                    ? ([...new Set([...e.effects, rec.effect])] as AppliedEdit['effects'])
                    : e.effects,
                  transition: rec.transition ?? e.transition,
                  subtitleStyle: rec.subtitleStyle ?? e.subtitleStyle,
                }
              : e
          )
        : [
            ...s.appliedEdits,
            {
              sceneIndex,
              effects: rec.effect ? [rec.effect] : [],
              transition: rec.transition,
              subtitleStyle: rec.subtitleStyle,
              durationMultiplier: 1,
            },
          ];

      return {
        appliedEdits: updatedEdits,
        dismissedIds: new Set([...s.dismissedIds, id]),
      };
    });
  },

  applyPreset: (presetId, scenes) => {
    const preset = EDIT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    // For imported videos (no scenes), create a single global edit at index 0 so the
    // preset's effects actually take hold. Otherwise create per-scene edits.
    const edits: AppliedEdit[] =
      scenes.length === 0
        ? [
            {
              sceneIndex: 0,
              effects: [...preset.effects],
              transition: preset.transitions[0],
              subtitleStyle: preset.subtitleStyle,
              durationMultiplier: preset.durationMultiplier,
            },
          ]
        : scenes.map((_, i) => ({
            sceneIndex: i,
            effects: [...preset.effects],
            transition: preset.transitions[0],
            subtitleStyle: preset.subtitleStyle,
            durationMultiplier: preset.durationMultiplier,
          }));

    set({
      appliedPresetId: presetId,
      appliedEdits: edits,
      globalSubtitleStyle: preset.subtitleStyle,
      activeTab: 'ai',
    });
  },

  clearPreset: () =>
    set({
      appliedPresetId: null,
      appliedEdits: [],
      globalSubtitleStyle: 'default',
    }),

  setGlobalSubtitleStyle: (style) => set({ globalSubtitleStyle: style }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  requestSeek: (time) => set((s) => ({ seekTime: Math.max(0, time), seekToken: s.seekToken + 1 })),

  setCurrentTime: (t) => set({ currentTime: t }),

  setVideoDuration: (d) => set({ videoDuration: Math.max(0, d) }),

  updateTransform: (changes) =>
    set((s) => ({ frameTransform: { ...s.frameTransform, ...changes } })),

  resetTransform: () => set({ frameTransform: { ...DEFAULT_FRAME_TRANSFORM } }),

  reset: () =>
    set({
      recommendations: [],
      dismissedIds: new Set(),
      appliedPresetId: null,
      appliedEdits: [],
      globalSubtitleStyle: 'default',
    }),
}));
