/**
 * Audio generation types
 * Provides type definitions for voice and music generation providers
 */

// Provider types
export type VoiceProviderName =
  | 'elevenlabs'
  | 'playht'
  | 'deepgram'
  | 'azure'
  | 'google';
export type AudioProvider = VoiceProviderName;
export type AudioType = 'voice' | 'music' | 'sfx';

// Voice types
export interface Voice {
  id: string;
  name: string;
  provider: VoiceProviderName;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  age?: string;
  accent?: string;
  description?: string;
  previewUrl?: string;
  isCloned?: boolean;
  settings?: VoiceSettings;
  metadata?: Record<string, unknown>;
}

export interface VoiceSettings {
  stability?: number; // 0-1
  similarityBoost?: number; // 0-1
  style?: number; // 0-1
  speed?: number; // 0.5-2.0
  useSpeakerBoost?: boolean;
}

export interface VoiceGenerationRequest {
  text: string;
  voiceId: string;
  settings?: VoiceSettings;
  modelId?: string;
  outputFormat?: 'mp3' | 'wav' | 'pcm' | 'ogg';
  sampleRate?: number;
}

export interface VoiceGenerationResponse {
  audioUrl: string;
  audioBuffer?: Buffer;
  duration: number;
  format: string;
  size?: number;
  sampleRate?: number;
  characterCount?: number;
  cost?: number;
  metadata?: {
    voiceId: string;
    modelId?: string;
    settings?: VoiceSettings;
    requestId?: string;
  };
}

// Voice cloning types
export interface CloneVoiceRequest {
  name: string;
  description?: string;
  audioFiles: Buffer[] | File[];
  labels?: Record<string, string>;
  language?: string;
}

export interface CloneVoiceResponse {
  voiceId: string;
  name: string;
  status: 'processing' | 'ready' | 'failed';
}

// Music generation types
export interface MusicGenerationRequest {
  prompt: string;
  duration: number;
  genre?: string;
  mood?: string;
  tempo?: string;
  instrumentalOnly?: boolean;
  tags?: string[];
}

export interface MusicGenerationResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl?: string;
  estimatedTime?: number;
  duration?: number;
  cost?: number;
}

// Provider configuration types
export interface VoiceProviderConfig {
  apiKey: string;
  userId?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface MusicProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

// Provider metadata types
export interface VoiceProviderMetadata {
  name: VoiceProviderName;
  displayName: string;
  description: string;
  supportedLanguages: string[];
  voiceCount?: number;
  supportsCloning: boolean;
  supportsStreaming: boolean;
  costPer1000Chars: number; // in cents
  features: {
    stability: boolean;
    similarity: boolean;
    style: boolean;
    speed: boolean;
  };
}

// Audio generation job types
export interface AudioGenerationJob {
  id: string;
  shotId: string | null;
  episodeId: string | null;
  type: AudioType;
  provider: AudioProvider;
  providerJobId: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audioUrl: string | null;
  duration: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

// Factory options
export interface AudioProviderFactoryOptions {
  accountId: string;
  projectId?: string;
  webhookBaseUrl?: string;
}

/**
 * Project audio settings shape (stored in projects.audio_settings)
 */
export interface ProjectAudioSettings {
  elevenlabs?: {
    enabled?: boolean;
    tts_model?: string;
    sfx_model?: string;
    music_model?: string;
  };
  voice_provider?: VoiceProviderName;
  sfx_provider?: 'elevenlabs';
  music_provider?: 'elevenlabs';
}

export interface VoiceProviderFactoryOptions
  extends AudioProviderFactoryOptions {
  provider?: VoiceProviderName;
  modelOverride?: string;
  projectAudioSettings?: ProjectAudioSettings | null;
}

// List voices params
export interface ListVoicesParams {
  language?: string;
  gender?: string;
  age?: string;
  accent?: string;
}

export interface ListVoicesResult {
  voices: Voice[];
  total: number;
}
