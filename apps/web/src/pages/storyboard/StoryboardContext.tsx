import { createContext, useContext } from 'react';
import type { WorkflowStep, TranscriptEntry, StagePart } from './types';
import type { StoryboardSegment, StoryboardPromptItem, VoiceInfo, MotionEffect, SubtitleStyle } from '../../lib/api';
import type { GenImage, GenMediaType } from '../../store/image-generation';

export interface StoryboardContextValue {
  // Navigation
  t: (key: string, vars?: Record<string, unknown>) => string;
  projectId: string | undefined;
  step: WorkflowStep;
  setStep: (s: WorkflowStep) => void;
  error: string | null;
  setError: (e: string | null) => void;
  saveProject: (updates: Record<string, unknown>) => void;

  // Project
  projectName: string;
  projectLoaded: boolean;

  // Template
  templateText: string;
  setTemplateText: (v: string) => void;
  templateLoaded: boolean;
  templateSections: Record<string, string>;
  templateStageParts: Record<string, StagePart[]>;
  setTemplateStageParts: React.Dispatch<React.SetStateAction<Record<string, StagePart[]>>>;
  showTemplate: boolean;
  setShowTemplate: (v: boolean) => void;
  savingTemplate: boolean;
  templateFileRef: React.RefObject<HTMLInputElement>;
  handleSaveTemplate: () => void;
  handleTemplateFile: (e: React.ChangeEvent<HTMLInputElement>) => void;

  // Stage prompts
  topicsPrompt: string;
  setTopicsPrompt: (v: string) => void;
  scriptPrompt: string;
  setScriptPrompt: (v: string) => void;
  imagePromptPrompt: string;
  setImagePromptPrompt: (v: string) => void;
  metadataPrompt: string;
  setMetadataPrompt: (v: string) => void;
  savingPrompt: string | null;
  savedPromptStage: string | null;
  handleSaveStagePrompt: (stage: string, prompt: string) => void;

  // Step 0: Topics
  topicIdeas: string[];
  generatingTopics: boolean;
  handleGenerateTopics: () => void;
  handlePickTopic: (topic: string) => void;

  // Step 1: Script
  scriptText: string;
  setScriptText: (v: string) => void;
  scriptTopic: string;
  setScriptTopic: (v: string) => void;
  scriptDuration: number;
  setScriptDuration: (v: number) => void;
  generatingScript: boolean;
  handleGenerateScript: () => void;

  // Step 2: Audio
  voice: string;
  setVoice: (v: string) => void;
  langFilter: string;
  setLangFilter: (v: string) => void;
  ttsRate: number;
  setTtsRate: (v: number) => void;
  ttsPitch: number;
  setTtsPitch: (v: number) => void;
  ttsVolume: number;
  setTtsVolume: (v: number) => void;
  ttsStyle: string;
  setTtsStyle: (v: string) => void;
  voicePreviewLoading: boolean;
  voicePreviewPlaying: boolean;
  generatingAudio: boolean;
  audioProgress: string[];
  audioFile: { filename: string; url: string; duration: number } | null;
  transcriptEntries: TranscriptEntry[];
  setTranscriptEntries: React.Dispatch<React.SetStateAction<TranscriptEntry[]>>;
  handleSplitEntry: (entryIndex: number, maxSec: number) => void;
  handleMergeEntry: (entryIndex: number, direction: 'prev' | 'next') => void;
  handleSplitAtCursor: (entryIndex: number, cursorPos: number, currentText?: string) => void;
  handleUpdateEntryText: (entryIndex: number, text: string) => void;
  handleAutoSeparate: (maxSec?: number) => void;
  handleRetranscribe: () => void;
  voices: { voices: Record<string, VoiceInfo>; languages: Record<string, string> } | undefined;
  handleVoicePreview: () => void;
  handleGenerateAudio: () => void;
  audioLogRef: React.RefObject<HTMLDivElement>;

  // Step 3: Prompts
  prompts: StoryboardPromptItem[];
  setPrompts: React.Dispatch<React.SetStateAction<StoryboardPromptItem[]>>;
  generatingPrompts: boolean;
  promptProgress: string[];
  editingPromptIdx: number | null;
  setEditingPromptIdx: (v: number | null) => void;
  handleGeneratePrompts: () => void;
  handleStopPrompts: () => void;
  handleRegenPrompt: (idx: number) => void;
  regenPromptIdx: number | null;
  promptLogRef: React.RefObject<HTMLDivElement>;
  linkedTemplate: { visualStyle?: string } | undefined;

  // Step 4: Images
  generatedImages: GenImage[];
  setGeneratedImages: React.Dispatch<React.SetStateAction<GenImage[]>>;
  generatingImages: boolean;
  imageProgress: string[];
  provider: string;
  setProvider: (v: string) => void;
  imageModel: string;
  setImageModel: (v: string) => void;
  aspectRatio: string;
  setAspectRatio: (v: string) => void;
  uploadingZip: boolean;
  zipInputRef: React.RefObject<HTMLInputElement>;
  imageCardRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  imageTab: 'generate' | 'upload' | 'flow';
  setImageTab: (v: 'generate' | 'upload' | 'flow') => void;
  flowAvailable: boolean;
  flowProvider: 'google-flow' | 'grok' | 'chatgpt';
  setFlowProvider: (v: 'google-flow' | 'grok' | 'chatgpt') => void;
  mediaType: GenMediaType;
  setMediaType: (v: GenMediaType) => void;
  videoDuration: number;
  setVideoDuration: (v: number) => void;
  imageProviders: Array<{ id: string; name: string; models?: string[] }> | undefined;
  selectedProviderInfo: { id: string; name: string; models?: string[] } | undefined;
  handleGenerateImages: () => void;
  handleGenerateVideos: () => void;
  handleStopImages: () => void;
  handleUploadZip: (file: File) => void;
  handleFlowGenerate: () => void;
  handleFlowRegenerateAll: () => void;
  handleFlowResume: () => void;
  handleRegenSingle: (idx: number, overrideProvider?: 'google-flow' | 'grok' | 'chatgpt') => void;
  handleDropImage: (idx: number) => void;
  regenIndex: number | null;
  failedImageCount: number;
  editingImageIdx: number | null;
  setEditingImageIdx: (v: number | null) => void;
  editingImagePrompt: string;
  setEditingImagePrompt: (v: string) => void;

  // Step 5: Timeline
  segments: StoryboardSegment[];
  setSegments: React.Dispatch<React.SetStateAction<StoryboardSegment[]>>;
  hoveredSegment: number | null;
  setHoveredSegment: (v: number | null) => void;
  playingSegment: number | null;
  setPlayingSegment: (v: number | null) => void;
  playheadTime: number | null;
  setPlayheadTime: (v: number | null) => void;
  isAudioPaused: boolean;
  segAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
  segmentsRef: React.MutableRefObject<StoryboardSegment[]>;
  timeFormat: 'seconds' | 'minutes';
  setTimeFormat: (v: 'seconds' | 'minutes') => void;
  frameTransition: 'voice' | 'hold';
  setFrameTransition: (v: 'voice' | 'hold') => void;
  frameHoldTime: number;
  setFrameHoldTime: (v: number) => void;
  segmentRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  timelineTrackRef: React.RefObject<HTMLDivElement>;
  trackZoom: number;
  setTrackZoom: (v: number) => void;
  trackHeight: number;
  setTrackHeight: (v: number) => void;
  trackGrabbing: boolean;
  setTrackGrabbing: (v: boolean) => void;
  trackDragRef: React.MutableRefObject<{ startX: number; scrollLeft: number; raf: number | null } | null>;
  manualScrolling: React.MutableRefObject<boolean>;
  allEffects: MotionEffect[];
  randomEffects: Set<MotionEffect>;
  setRandomEffects: React.Dispatch<React.SetStateAction<Set<MotionEffect>>>;
  bgMusicFilename: string;
  setBgMusicFilename: (v: string) => void;
  voiceVolume: number;
  setVoiceVolume: (v: number) => void;
  musicVolume: number;
  setMusicVolume: (v: number) => void;
  dragIdx: number | null;
  dragOverIdx: number | null;
  dragAllowed: React.MutableRefObject<boolean>;
  handleDragStart: (e: React.DragEvent, idx: number) => void;
  handleDragOver: (e: React.DragEvent, idx: number) => void;
  handleDrop: (e: React.DragEvent, toIdx: number) => void;
  setDragIdx: (v: number | null) => void;
  setDragOverIdx: (v: number | null) => void;
  updateSegmentTimeAutoMerge: (idx: number, field: 'startTime' | 'endTime', value: number) => void;
  handleTrackEdgeDrag: (e: React.MouseEvent, boundaryIdx: number) => void;
  handleCardResizeStart: (e: React.MouseEvent, idx: number, barEl: HTMLDivElement) => void;
  updateSegmentMotion: (idx: number, motion: MotionEffect) => void;
  playSegmentAudio: (idx: number) => void;
  pauseAudio: () => void;
  resumeAudio: () => void;
  stopAudio: () => void;
  skipSegment: (dir: -1 | 1) => void;
  seekToTime: (t: number) => void;
  handleBuildTimeline: () => void;

  // Subtitle style
  subtitleStyle: SubtitleStyle;
  setSubtitleStyle: React.Dispatch<React.SetStateAction<SubtitleStyle>>;

  // Step 6: Metadata
  generatingMetadata: boolean;
  metadataTitle: string;
  setMetadataTitle: (v: string) => void;
  metadataDesc: string;
  setMetadataDesc: (v: string) => void;
  metadataTags: string[];
  setMetadataTags: (v: string[]) => void;
  metadataThumbnailPrompt: string;
  setMetadataThumbnailPrompt: (v: string) => void;
  thumbnailUrl: string;
  setThumbnailUrl: (v: string) => void;
  generatingThumbnail: boolean;
  thumbnailProgress: string;
  generatingThumbnailPrompt: boolean;
  thumbnailBgColor: string;
  setThumbnailBgColor: (v: string) => void;
  handleGenerateMetadata: () => void;
  handleGenerateThumbnail: () => void;
  handleAutoGenerateThumbnailPrompt: () => void;

  // Step 7: Assemble
  assembling: boolean;
  assembleAbortRef: React.RefObject<AbortController>;
  speed: number;
  setSpeed: (v: number) => void;
  bgColor: string;
  setBgColor: (v: string) => void;
  lightboxUrl: string | null;
  setLightboxUrl: (v: string | null) => void;
  assembleProgress: string[];
  assembleLogRef: React.RefObject<HTMLDivElement>;
  assembleStep: string;
  assembleClipProgress: { current: number; total: number };
  result: { filename: string; url: string; sizeKB: number; duration: number } | null;
  handleAssemble: () => void;
}

const StoryboardContext = createContext<StoryboardContextValue | null>(null);

export const StoryboardProvider = StoryboardContext.Provider;

export function useStoryboard(): StoryboardContextValue {
  const ctx = useContext(StoryboardContext);
  if (!ctx) throw new Error('useStoryboard must be used within StoryboardProvider');
  return ctx;
}
