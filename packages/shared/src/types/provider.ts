export type ProviderName = 'google-flow' | 'google-imagefx' | 'manual';
export type ProviderStatus = 'active' | 'rate-limited' | 'error' | 'disabled';
export type GenerationType = 'video' | 'image';

export interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  projectId?: string;
  requestsPerMinute: number;
  maxRetries: number;
  timeoutMs: number;
  enabled: boolean;
}

export interface GenerationRequest {
  id: string;
  providerId: ProviderName;
  promptId: string;
  prompt: string;
  enhancedPrompt: string;
  type: GenerationType;
  duration?: number;
  aspectRatio?: string;
  style?: string;
  retryCount: number;
  maxRetries: number;
  status: 'queued' | 'submitted' | 'processing' | 'completed' | 'failed';
  resultAssetId?: string;
  errorMessage?: string;
  submittedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface GenerationResult {
  requestId: string;
  assetId: string;
  assetPath: string;
  provider: ProviderName;
  metadata: Record<string, unknown>;
}

export interface PromptRecord {
  id: string;
  originalPrompt: string;
  enhancedPrompt: string;
  style?: string;
  mood?: string;
  checksum: string;
  timesUsed: number;
  lastUsedAt?: string;
  createdAt: string;
}

export interface RateLimitState {
  provider: ProviderName;
  requestCount: number;
  windowStartMs: number;
  isLimited: boolean;
}
