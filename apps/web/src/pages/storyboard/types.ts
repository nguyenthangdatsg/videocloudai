export type WorkflowStep = 'topics' | 'script' | 'audio' | 'prompts' | 'images' | 'timeline' | 'metadata' | 'assemble';

export interface TranscriptEntry {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface StagePart {
  label: string;
  content: string;
}
