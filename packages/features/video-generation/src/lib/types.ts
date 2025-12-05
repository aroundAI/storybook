export type VideoProvider = 'kling' | 'runway' | 'luma';

export type GenerationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  duration: number;
  aspectRatio: string;
  seed?: number;
  modelVersion?: string;
  settings?: Record<string, unknown>;
}

export interface VideoGenerationResponse {
  jobId: string;
  status: GenerationStatus;
  estimatedTime?: number;
  message?: string;
}

export interface VideoGenerationStatus {
  jobId: string;
  status: GenerationStatus;
  progress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  completedAt?: string;
}

export interface VideoGenerationJob {
  id: string;
  shotId: string;
  provider: VideoProvider;
  providerJobId: string;
  status: GenerationStatus;
  request: VideoGenerationRequest;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  webhookSecret?: string;
}

export interface ProviderCapabilities {
  readonly supportedAspectRatios: readonly string[];
  readonly maxDuration: number;
  readonly supportsImageToVideo: boolean;
  readonly supportsNegativePrompt: boolean;
}
