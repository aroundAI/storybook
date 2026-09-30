import { assertApiKey, fetchWithRetry, handleProviderError } from '../lib/http';
import { VoiceGenerationRequestSchema } from '../lib/schemas';
import type {
  CloneVoiceRequest,
  CloneVoiceResponse,
  ListVoicesParams,
  ListVoicesResult,
  MusicGenerationRequest,
  MusicGenerationResponse,
  MusicProviderConfig,
  VoiceGenerationRequest,
  VoiceGenerationResponse,
  VoiceProviderConfig,
} from '../lib/types';

/**
 * Voice generation provider interface
 * Implement this interface for voice/TTS providers (ElevenLabs, PlayHT, etc.)
 */
export interface VoiceGenerationProvider {
  readonly name: string;
  readonly supportedLanguages: readonly string[];
  readonly supportsCloning: boolean;
  readonly supportsStreaming: boolean;

  /**
   * Generate voice audio from text
   */
  generateVoice(
    request: VoiceGenerationRequest,
  ): Promise<VoiceGenerationResponse>;

  /**
   * Generate voice audio as a stream (for real-time playback)
   */
  generateVoiceStream?(
    request: VoiceGenerationRequest,
  ): Promise<ReadableStream<Uint8Array>>;

  /**
   * List available voices
   */
  getVoices(params?: ListVoicesParams): Promise<ListVoicesResult>;

  /**
   * Clone a voice from audio samples
   */
  cloneVoice?(request: CloneVoiceRequest): Promise<CloneVoiceResponse>;

  /**
   * Delete a cloned voice
   */
  deleteClonedVoice?(voiceId: string): Promise<void>;

  /**
   * Estimate cost for voice generation (in cents)
   */
  estimateCost(request: VoiceGenerationRequest): number;

  /**
   * Get rate limit configuration
   */
  getRateLimits(): {
    requestsPerMinute: number;
    concurrentRequests: number;
    dailyLimit?: number;
  };
}

/**
 * Music generation provider interface
 * Implement this interface for music providers (ElevenLabs Music)
 */
export interface MusicGenerationProvider {
  readonly name: string;
  readonly maxDuration: number;
  readonly supportsVocals: boolean;
  readonly supportsInstrumental: boolean;
  readonly supportedGenres: readonly string[];

  /**
   * Generate music from prompt
   */
  generateMusic(
    request: MusicGenerationRequest,
  ): Promise<MusicGenerationResponse>;

  /**
   * Get status of a music generation job
   */
  getStatus(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    audioUrl?: string;
    progress?: number;
    error?: string;
  }>;

  /**
   * Estimate cost for music generation (in cents)
   */
  estimateCost(request: MusicGenerationRequest): number;

  /**
   * Get rate limit configuration
   */
  getRateLimits(): {
    requestsPerMinute: number;
    concurrentRequests: number;
    dailyLimit?: number;
  };
}

/**
 * Base class for voice generation providers
 * Provides common validation and error handling logic
 */
export abstract class BaseVoiceGenerationProvider
  implements VoiceGenerationProvider
{
  abstract readonly name: string;
  abstract readonly supportedLanguages: readonly string[];
  abstract readonly supportsCloning: boolean;
  abstract readonly supportsStreaming: boolean;

  protected config: VoiceProviderConfig;

  constructor(config: VoiceProviderConfig) {
    this.config = config;
  }

  abstract generateVoice(
    request: VoiceGenerationRequest,
  ): Promise<VoiceGenerationResponse>;

  abstract getVoices(params?: ListVoicesParams): Promise<ListVoicesResult>;

  abstract estimateCost(request: VoiceGenerationRequest): number;

  abstract getRateLimits(): {
    requestsPerMinute: number;
    concurrentRequests: number;
    dailyLimit?: number;
  };

  /**
   * Validate voice generation request
   */
  protected validateRequest(request: VoiceGenerationRequest): void {
    const result = VoiceGenerationRequestSchema.safeParse(request);
    if (!result.success) {
      throw new Error(`Invalid request: ${result.error.message}`);
    }
  }

  /**
   * Handle and format errors consistently
   */
  protected handleError(error: unknown, operation: string): Error {
    return handleProviderError(this.name, operation, error, this.config.apiKey);
  }

  /**
   * Make HTTP request with retry logic
   */
  protected async makeRequestWithRetry<T>(
    url: string,
    options: RequestInit,
    binary: boolean = false,
  ): Promise<T> {
    assertApiKey(this.name, this.config.apiKey);

    return fetchWithRetry<T>(
      url,
      options,
      {
        maxRetries: this.config.maxRetries,
        timeout: this.config.timeout,
      },
      binary,
    );
  }
}

/**
 * Base class for music generation providers
 * Provides common validation and error handling logic
 */
export abstract class BaseMusicGenerationProvider
  implements MusicGenerationProvider
{
  abstract readonly name: string;
  abstract readonly maxDuration: number;
  abstract readonly supportsVocals: boolean;
  abstract readonly supportsInstrumental: boolean;
  abstract readonly supportedGenres: readonly string[];

  protected config: MusicProviderConfig;

  constructor(config: MusicProviderConfig) {
    this.config = config;
  }

  abstract generateMusic(
    request: MusicGenerationRequest,
  ): Promise<MusicGenerationResponse>;

  abstract getStatus(jobId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed';
    audioUrl?: string;
    progress?: number;
    error?: string;
  }>;

  abstract estimateCost(request: MusicGenerationRequest): number;

  abstract getRateLimits(): {
    requestsPerMinute: number;
    concurrentRequests: number;
    dailyLimit?: number;
  };

  /**
   * Validate music generation request
   */
  protected validateRequest(request: MusicGenerationRequest): void {
    if (!request.prompt || request.prompt.trim().length === 0) {
      throw new Error('Prompt is required');
    }

    if (request.prompt.length > 1000) {
      throw new Error('Prompt exceeds maximum length of 1000 characters');
    }

    if (request.duration <= 0) {
      throw new Error('Duration must be positive');
    }

    if (request.duration > this.maxDuration) {
      throw new Error(
        `Duration exceeds maximum of ${this.maxDuration} seconds`,
      );
    }
  }

  /**
   * Handle and format errors consistently
   */
  protected handleError(error: unknown, operation: string): Error {
    return handleProviderError(this.name, operation, error, this.config.apiKey);
  }

  /**
   * Make HTTP request with retry logic
   */
  protected async makeRequestWithRetry<T>(
    url: string,
    options: RequestInit,
  ): Promise<T> {
    assertApiKey(this.name, this.config.apiKey);

    return fetchWithRetry<T>(url, options, {
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout ?? 60000,
    });
  }
}
