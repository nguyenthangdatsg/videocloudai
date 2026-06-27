export { useEditorAIStore } from './store';
export { useEditorAnalysis } from './hooks/useEditorAnalysis';
export { PresetBar } from './components/PresetBar';
export { AIRecommendationSidebar } from './components/AIRecommendationSidebar';
export { RecommendationCard } from './components/RecommendationCard';
export { SceneSplitter } from './components/SceneSplitter';
export { TransformPanel } from './components/TransformPanel';
export type {
  Recommendation,
  EditPreset,
  AppliedEdit,
  CinematicEffect,
  TransitionType,
  SubtitleStyle,
  PresetId,
  RecommendationType,
} from './types';
export { EFFECT_LABELS, TRANSITION_LABELS, SUBTITLE_STYLE_LABELS } from './types';
export { EDIT_PRESETS } from './presets';
export { analyzeScenes } from './engine';
