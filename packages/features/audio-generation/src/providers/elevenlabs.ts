import { DEFAULT_VOICE_SETTINGS, ELEVENLABS } from '../lib/constants';
import type {
  CloneVoiceRequest,
  CloneVoiceResponse,
  ListVoicesParams,
  ListVoicesResult,
  VoiceGenerationRequest,
  VoiceGenerationResponse,
  VoiceProviderConfig,
} from '../lib/types';
import { BaseVoiceGenerationProvider } from './base';

/**
 * ElevenLabs voice generation provider
 * Premium AI voice synthesis with natural-sounding voices
 *
 * Features:
 * - Text-to-speech with customizable voice settings
 * - Streaming audio generation for real-time playback
 * - Voice cloning from audio samples (up to 25 files)
 * - Voice listing with filtering by language, gender, age, accent
 */
export class ElevenLabsProvider extends BaseVoiceGenerationProvider {
  readonly name = 'elevenlabs';
  readonly supportedLanguages = ELEVENLABS.SUPPORTED_LANGUAGES;
  readonly supportsCloning = true;
  readonly supportsStreaming = true;

  private readonly baseUrl: string;

  constructor(config: VoiceProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? ELEVENLABS.BASE_URL;
  }

  /**
   * Generate voice audio from text
   */
  async generateVoice(
    request: VoiceGenerationRequest,
  ): Promise<VoiceGenerationResponse> {
    this.validateRequest(request);

    const settings = { ...DEFAULT_VOICE_SETTINGS, ...request.settings };

    try {
      const response = await this.makeRequestWithRetry<ArrayBuffer>(
        `${this.baseUrl}/text-to-speech/${request.voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.config.apiKey,
          },
          body: JSON.stringify({
            text: request.text,
            model_id: this.requireModelId(request.modelId),
            voice_settings: {
              stability: settings.stability,
              similarity_boost: settings.similarityBoost,
              style: settings.style,
              speed: settings.speed,
              use_speaker_boost: settings.useSpeakerBoost,
            },
            output_format: request.outputFormat ?? 'mp3_44100_128',
          }),
        },
        true,
      );

      const audioBuffer = Buffer.from(response);
      const cost = this.estimateCost(request);

      return {
        audioUrl: '', // Will be set after upload to storage
        audioBuffer,
        duration: this.estimateDuration(audioBuffer),
        format: request.outputFormat ?? 'mp3',
        size: audioBuffer.length,
        characterCount: request.text.length,
        cost,
        metadata: {
          voiceId: request.voiceId,
          modelId: request.modelId,
          settings,
          requestId: `el_${Date.now()}`,
        },
      };
    } catch (error) {
      throw this.handleError(error, 'generateVoice');
    }
  }

  /**
   * Generate voice audio as a stream
   */
  async generateVoiceStream(
    request: VoiceGenerationRequest,
  ): Promise<ReadableStream<Uint8Array>> {
    this.validateRequest(request);

    const settings = { ...DEFAULT_VOICE_SETTINGS, ...request.settings };

    const response = await fetch(
      `${this.baseUrl}/text-to-speech/${request.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.config.apiKey,
        },
        body: JSON.stringify({
          text: request.text,
          model_id: this.requireModelId(request.modelId),
          voice_settings: {
            stability: settings.stability,
            similarity_boost: settings.similarityBoost,
            style: settings.style,
            speed: settings.speed,
            use_speaker_boost: settings.useSpeakerBoost,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs streaming error: ${response.statusText}`);
    }

    return response.body!;
  }

  /**
   * List available voices
   */
  async getVoices(params?: ListVoicesParams): Promise<ListVoicesResult> {
    try {
      interface ElevenLabsVoice {
        voice_id: string;
        name: string;
        category: string;
        description?: string;
        labels: Record<string, string>;
        preview_url?: string;
        available_for_tiers: string[];
        settings?: {
          stability: number;
          similarity_boost: number;
          style?: number;
          use_speaker_boost?: boolean;
        };
      }

      const response = await this.makeRequestWithRetry<{
        voices: ElevenLabsVoice[];
      }>(`${this.baseUrl}/voices`, {
        method: 'GET',
        headers: {
          'xi-api-key': this.config.apiKey,
        },
      });

      let voices = response.voices.map((voice) => ({
        id: voice.voice_id,
        name: voice.name,
        provider: 'elevenlabs' as const,
        language: voice.labels.accent ?? 'en',
        gender: voice.labels.gender as
          | 'male'
          | 'female'
          | 'neutral'
          | undefined,
        age: voice.labels.age,
        accent: voice.labels.accent,
        description: voice.description,
        previewUrl: voice.preview_url,
        isCloned: voice.category === 'cloned',
        settings: voice.settings
          ? {
            stability: voice.settings.stability,
            similarityBoost: voice.settings.similarity_boost,
            style: voice.settings.style,
            useSpeakerBoost: voice.settings.use_speaker_boost,
          }
          : undefined,
      }));

      // Apply filters
      if (params?.language) {
        voices = voices.filter((v) => v.language?.includes(params.language!));
      }
      if (params?.gender) {
        voices = voices.filter((v) => v.gender === params.gender);
      }
      if (params?.age) {
        voices = voices.filter((v) => v.age === params.age);
      }
      if (params?.accent) {
        voices = voices.filter((v) => v.accent === params.accent);
      }

      return {
        voices,
        total: voices.length,
      };
    } catch (error) {
      throw this.handleError(error, 'getVoices');
    }
  }

  /**
   * Clone a voice from audio samples
   */
  async cloneVoice(request: CloneVoiceRequest): Promise<CloneVoiceResponse> {
    this.validateCloneRequest(request);

    try {
      const formData = new FormData();
      formData.append('name', request.name);
      if (request.description) {
        formData.append('description', request.description);
      }
      if (request.labels) {
        formData.append('labels', JSON.stringify(request.labels));
      }

      // Add audio files
      request.audioFiles.forEach((file, index) => {
        if (file instanceof File) {
          formData.append('files', file, `sample_${index}.mp3`);
        } else {
          // Convert Buffer to Uint8Array for Blob compatibility
          const uint8Array = new Uint8Array(file);
          const blob = new Blob([uint8Array]);
          formData.append('files', blob, `sample_${index}.mp3`);
        }
      });

      const data = await this.makeRequestWithRetry<{
        voice_id: string;
        name: string;
      }>(`${this.baseUrl}/voices/add`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey,
        },
        body: formData,
      });

      return {
        voiceId: data.voice_id,
        name: data.name,
        status: 'ready',
      };
    } catch (error) {
      throw this.handleError(error, 'cloneVoice');
    }
  }

  /**
   * Delete a cloned voice
   */
  async deleteClonedVoice(voiceId: string): Promise<void> {
    await this.makeRequestWithRetry(`${this.baseUrl}/voices/${voiceId}`, {
      method: 'DELETE',
      headers: {
        'xi-api-key': this.config.apiKey,
      },
    });
  }

  /**
   * Estimate cost for voice generation (in cents)
   * ElevenLabs pricing: $0.30 per 1000 characters
   */
  estimateCost(request: VoiceGenerationRequest): number {
    const characterCount = request.text.length;
    return Math.ceil((characterCount / 1000) * ELEVENLABS.COST_PER_1000_CHARS);
  }

  /**
   * Get rate limit configuration
   */
  getRateLimits() {
    return {
      requestsPerMinute: ELEVENLABS.RATE_LIMITS.REQUESTS_PER_MINUTE,
      concurrentRequests: ELEVENLABS.RATE_LIMITS.CONCURRENT_REQUESTS,
    };
  }

  /**
   * Require modelId to be explicitly provided - no defaults
   */
  private requireModelId(modelId: string | undefined): string {
    if (!modelId) {
      throw new Error(
        'modelId is required. Configure project audio settings or pass modelId explicitly.',
      );
    }
    return modelId;
  }

  /**
   * Validate voice cloning request
   */
  private validateCloneRequest(request: CloneVoiceRequest): void {
    if (!request.name || request.name.trim().length === 0) {
      throw new Error('Voice name is required');
    }

    if (!request.audioFiles || request.audioFiles.length === 0) {
      throw new Error('At least one audio file is required');
    }

    if (request.audioFiles.length > 25) {
      throw new Error('Maximum 25 audio files allowed');
    }
  }

  /**
   * Estimate audio duration from buffer (simplified)
   */
  private estimateDuration(buffer: Buffer): number {
    // Rough estimate based on file size and typical MP3 bitrate
    // In production, use a library like 'music-metadata' for accurate duration
    const bytesPerSecond = 16000; // ~128kbps MP3
    return Math.ceil(buffer.length / bytesPerSecond);
  }
}
