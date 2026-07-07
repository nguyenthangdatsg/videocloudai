// ── Drama Studio Types ──

// Art styles for drama projects
export type DramaArtStyle = 'cinematic' | 'anime' | 'illustrated' | '3d-rendered' | 'watercolor' | 'noir' | 'comic' | 'custom';

// Genres
export type DramaGenre = 'romance' | 'fantasy' | 'mystery' | 'thriller' | 'revenge' | 'billionaire' | 'workplace' | 'family' | 'horror' | 'comedy' | 'sci-fi' | 'historical' | 'supernatural' | 'crime' | 'coming-of-age';

// Tone options
export type DramaTone = 'dark' | 'suspenseful' | 'romantic' | 'comedic' | 'dramatic' | 'whimsical' | 'gritty' | 'hopeful' | 'melancholic' | 'intense';

// Episode format
export type EpisodeFormat = 'single' | 'series';

// Aspect ratio for drama output
export type DramaAspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4' | '21:9';

// Production stages in order
export type DramaStage = 'setup' | 'story' | 'script' | 'characters' | 'locations' | 'storyboard' | 'video' | 'audio' | 'subtitles' | 'assembly' | 'export';

// Project status
export type DramaProjectStatus = 'draft' | 'in_progress' | 'completed' | 'archived';

// Episode status
export type DramaEpisodeStatus = 'outline' | 'scripted' | 'storyboarded' | 'generating' | 'assembled' | 'exported';

// Character role
export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting' | 'extra';

// Camera angles
export type CameraAngle = 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'over-the-shoulder' | 'low-angle' | 'high-angle' | 'dutch-angle' | 'pov' | 'two-shot' | 'establishing';

// Camera movements
export type CameraMovement = 'static' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down' | 'zoom-in' | 'zoom-out' | 'dolly-in' | 'dolly-out' | 'tracking';

// Shot transition types
export type ShotTransition = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'flash';

// Beat type for story structure
export type BeatType = 'hook' | 'setup' | 'inciting-incident' | 'rising-action' | 'midpoint' | 'escalation' | 'climax' | 'resolution' | 'cliffhanger';

// ── Interfaces ──

export interface DramaProject {
  id: string;
  title: string;
  description: string;
  genre: DramaGenre;
  tone: DramaTone;
  artStyle: DramaArtStyle;
  aspectRatio: DramaAspectRatio;
  language: string;
  episodeFormat: EpisodeFormat;
  durationTarget: number; // seconds per episode
  status: DramaProjectStatus;
  currentStage: DramaStage;
  episodeCount: number;
  createdAt: string;
  updatedAt: string;
  mode?: 'video' | 'image';
}

export interface DramaBeat {
  id: string;
  type: BeatType;
  description: string;
  emotionTag: string;
  durationEstimate: number; // seconds
  sortOrder: number;
}

export interface DramaEpisode {
  id: string;
  projectId: string;
  episodeNumber: number;
  title: string;
  synopsis: string;
  beats: DramaBeat[];
  script: string;
  scriptVersion: number;
  durationEstimate: number;
  status: DramaEpisodeStatus;
  stage: DramaStage;
  reviewScore: number | null;
  audioFilename?: string | null;
  audioDuration?: number | null;
  srtFilename?: string | null;
  videoFilename?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DramaCharacter {
  id: string;
  projectId: string;
  name: string;
  role: CharacterRole;
  age: string;
  gender: string;
  physicalDescription: string;
  personality: string;
  wardrobeDefault: string;
  backstory: string;
  referencePrompt: string;
  referenceImages: string[]; // asset paths
  voiceId: string;
  voiceSettings: {
    pitch: number;
    speed: number;
    accent: string;
  };
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DramaLocation {
  id: string;
  projectId: string;
  name: string;
  type: 'interior' | 'exterior';
  description: string;
  lighting: string;
  timeOfDay: string;
  weather: string;
  mood: string;
  props: string[];
  referenceImages: string[];
  referencePrompt: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DramaShot {
  id: string;
  sceneId: string;
  shotNumber: number;
  description: string;
  cameraAngle: CameraAngle;
  cameraMovement: CameraMovement;
  characterIds: string[];
  action: string;
  expression: string;
  dialogueLine: string;
  duration: number;
  transitionIn: ShotTransition;
  transitionOut: ShotTransition;
  sortOrder: number;
  prompt: string;
  negativePrompt: string;
  keyframeUrl: string;
  videoUrl: string;
  generationStatus: 'pending' | 'generating' | 'completed' | 'failed';
  consistencyScore: number | null;
  createdAt: string;
}

export interface DramaScene {
  id: string;
  episodeId: string;
  sceneNumber: number;
  heading: string; // INT. OFFICE - NIGHT
  locationId: string;
  description: string;
  dialogue: Array<{
    characterId: string;
    line: string;
    emotion: string;
  }>;
  actionLines: string;
  mood: string;
  musicMood: string;
  durationEstimate: number;
  sortOrder: number;
  shots: DramaShot[];
  createdAt: string;
}

// Input type for creating a new project
export interface CreateDramaProjectInput {
  title: string;
  description?: string;
  genre: DramaGenre;
  tone: DramaTone;
  artStyle: DramaArtStyle;
  aspectRatio: DramaAspectRatio;
  language: string;
  episodeFormat: EpisodeFormat;
  durationTarget: number;
  episodeCount?: number;
  storyInput?: string;
  inputMode?: 'idea' | 'outline' | 'script' | 'novel' | 'generate';
  mode?: 'video' | 'image';
}

// Story generation input
export interface GenerateStoryInput {
  projectId: string;
  episodeId: string;
  storyInput: string;
  inputMode: 'idea' | 'outline' | 'script' | 'novel' | 'generate';
  genre: DramaGenre;
  tone: DramaTone;
  durationTarget: number;
}

// Script generation input
export interface GenerateScriptInput {
  projectId: string;
  episodeId: string;
  beats: DramaBeat[];
  characters: DramaCharacter[];
  genre: DramaGenre;
  tone: DramaTone;
}

// Character generation input
export interface GenerateCharacterInput {
  projectId: string;
  name: string;
  description: string;
  role: CharacterRole;
  artStyle: DramaArtStyle;
}
