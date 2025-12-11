import { PLAYHT } from '../../lib/constants';
import type {
  CloneVoiceRequest,
  CloneVoiceResponse,
  ListVoicesParams,
  ListVoicesResult,
  Voice,
  VoiceGenerationRequest,
  VoiceGenerationResponse,
  VoiceProviderConfig,
  VoiceSettings,
} from '../../lib/types';
import { BaseVoiceGenerationProvider } from '../base';
import { PLAYHT_PROVIDER } from './constants';
import type {
  PlayHTCloneResponse,
  PlayHTClonedVoice,
  PlayHTGenerationResponse,
  PlayHTOutputFormat,
  PlayHTQuality,
  PlayHTSampleRate,
  PlayHTTTSPayload,
  PlayHTVoice,
  PlayHTVoiceSettings,
} from './types';
import { PlayHTVoiceSettingsSchema } from './types';

/**
 * PlayHT voice generation provider
 * Cost-effective AI voice synthesis with voice cloning support
 *
 * Features:
 * - Text-to-speech with customizable voice settings
 * - Streaming audio generation for real-time playback
 * - Instant voice cloning from audio samples
 * - 600+ voices in 140+ languages
 * - Lower cost than ElevenLabs ($0.20 vs $0.30 per 1K chars)
 */
export class PlayHTProvider extends BaseVoiceGenerationProvider {
  readonly name = 'playht';
  readonly supportedLanguages = PLAYHT.SUPPORTED_LANGUAGES;
  readonly supportsCloning = true;
  readonly supportsStreaming = true;

  private readonly baseUrl: string;
  private readonly userId: string;

  constructor(config: VoiceProviderConfig) {
    super(config);

    // PlayHT requires userId in addition to apiKey
    if (!config.userId) {
      throw new Error('PlayHT requires userId in configuration');
    }

    this.userId = config.userId;
    this.baseUrl = config.baseUrl ?? PLAYHT_PROVIDER.API.BASE_URL;
  }

  /**
   * Generate voice audio from text
   */
  async generateVoice(
    request: VoiceGenerationRequest,
  ): Promise<VoiceGenerationResponse> {
    // PlayHT supports up to 10000 chars, skip base validation which has 5000 limit
    // and use our own PlayHT-specific validation
    this.validatePlayHTRequest(request);

    const settings = this.parseSettings(request.settings);

    const payload: PlayHTTTSPayload = {
      text: request.text,
      voice: request.voiceId,
      output_format: settings.outputFormat as PlayHTOutputFormat,
      sample_rate: settings.sampleRate as PlayHTSampleRate,
      speed: settings.speed,
      temperature: settings.temperature,
      quality: settings.quality as PlayHTQuality,
    };

    if (settings.emotion) {
      payload.emotion = settings.emotion;
    }
    if (settings.seed) {
      payload.seed = settings.seed;
    }

    try {
      const response = await this.makePlayHTRequest<PlayHTGenerationResponse>(
        PLAYHT_PROVIDER.API.ENDPOINTS.TTS,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );

      // PlayHT returns audio URL in the response
      const audioUrl = response.audio_url;

      if (!audioUrl) {
        throw new Error('No audio URL returned from PlayHT');
      }

      // Fetch the audio data
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(`Failed to fetch audio: ${audioResponse.statusText}`);
      }

      const audioArrayBuffer = await audioResponse.arrayBuffer();
      const audioBuffer = Buffer.from(audioArrayBuffer);
      const cost = this.estimateCost(request);

      return {
        audioUrl,
        audioBuffer,
        duration: response.duration ?? this.estimateDuration(audioBuffer),
        format: settings.outputFormat,
        size: audioBuffer.length,
        sampleRate: settings.sampleRate,
        characterCount: request.text.length,
        cost,
        metadata: {
          voiceId: request.voiceId,
          settings: request.settings,
          requestId: response.id,
        },
      };
    } catch (error) {
      throw this.handleError(error, 'generateVoice');
    }
  }

  /**
   * Generate voice audio as a stream (for real-time playback)
   */
  async generateVoiceStream(
    request: VoiceGenerationRequest,
  ): Promise<ReadableStream<Uint8Array>> {
    // PlayHT supports up to 10000 chars
    this.validatePlayHTRequest(request);

    const settings = this.parseSettings(request.settings);

    const payload = {
      text: request.text,
      voice: request.voiceId,
      output_format: 'mp3',
      speed: settings.speed,
      temperature: settings.temperature,
    };

    const response = await fetch(
      `${this.baseUrl}${PLAYHT_PROVIDER.API.ENDPOINTS.TTS_STREAM}`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const error = await this.parseErrorResponse(response);
      throw new Error(`PlayHT streaming error: ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming');
    }

    return response.body;
  }

  /**
   * List available stock voices
   */
  async getVoices(params?: ListVoicesParams): Promise<ListVoicesResult> {
    try {
      const response = await this.makePlayHTRequest<PlayHTVoice[]>(
        PLAYHT_PROVIDER.API.ENDPOINTS.VOICES,
        { method: 'GET' },
      );

      let voices = response.map((voice) => this.mapPlayHTVoice(voice, false));

      // Apply filters
      voices = this.applyVoiceFilters(voices, params);

      return {
        voices,
        total: voices.length,
      };
    } catch (error) {
      throw this.handleError(error, 'getVoices');
    }
  }

  /**
   * Get user's cloned voices
   */
  async getClonedVoices(): Promise<Voice[]> {
    try {
      const response = await this.makePlayHTRequest<PlayHTClonedVoice[]>(
        PLAYHT_PROVIDER.API.ENDPOINTS.CLONED_VOICES,
        { method: 'GET' },
      );

      return response.map((voice) => ({
        id: voice.id,
        name: voice.name,
        provider: 'playht' as const,
        language: 'en-US', // Default, PlayHT doesn't return language for cloned voices
        isCloned: true,
        metadata: {
          type: voice.type,
          status: voice.status,
          createdAt: voice.created_at,
        },
      }));
    } catch (error) {
      throw this.handleError(error, 'getClonedVoices');
    }
  }

  /**
   * Clone a voice from audio samples
   */
  async cloneVoice(request: CloneVoiceRequest): Promise<CloneVoiceResponse> {
    this.validateCloneRequest(request);

    try {
      const formData = new FormData();
      formData.append('voice_name', request.name);

      if (request.description) {
        formData.append('description', request.description);
      }

      // Add audio files - PlayHT uses 'sample_file' for each file
      for (let i = 0; i < request.audioFiles.length; i++) {
        const file = request.audioFiles[i];
        if (file instanceof File) {
          formData.append('sample_file', file);
        } else if (file) {
          // Buffer
          const uint8Array = new Uint8Array(file);
          const blob = new Blob([uint8Array], { type: 'audio/mpeg' });
          formData.append('sample_file', blob, `sample_${i}.mp3`);
        }
      }

      const response = await fetch(
        `${this.baseUrl}${PLAYHT_PROVIDER.API.ENDPOINTS.CLONE_INSTANT}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'X-User-ID': this.userId,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        const errorText = await this.parseErrorResponse(response);
        throw new Error(`Voice cloning failed: ${errorText}`);
      }

      const data: PlayHTCloneResponse = await response.json();

      return {
        voiceId: data.id,
        name: data.name,
        status: data.status === 'ready' ? 'ready' : 'processing',
      };
    } catch (error) {
      throw this.handleError(error, 'cloneVoice');
    }
  }

  /**
   * Delete a cloned voice
   */
  async deleteClonedVoice(voiceId: string): Promise<void> {
    try {
      await this.makePlayHTRequest(
        `${PLAYHT_PROVIDER.API.ENDPOINTS.CLONED_VOICES}/${voiceId}`,
        { method: 'DELETE' },
      );
    } catch (error) {
      throw this.handleError(error, 'deleteClonedVoice');
    }
  }

  /**
   * Estimate cost for voice generation (in cents)
   * PlayHT pricing: $0.20 per 1000 characters
   */
  estimateCost(request: VoiceGenerationRequest): number {
    const characterCount = request.text.length;
    return Math.ceil((characterCount / 1000) * PLAYHT.COST_PER_1000_CHARS);
  }

  /**
   * Get rate limit configuration
   */
  getRateLimits() {
    return {
      requestsPerMinute: PLAYHT_PROVIDER.LIMITS.API.REQUESTS_PER_MINUTE,
      concurrentRequests: PLAYHT_PROVIDER.LIMITS.API.CONCURRENT_REQUESTS,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Get PlayHT-specific headers
   */
  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'X-User-ID': this.userId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Make HTTP request to PlayHT API with error handling
   */
  private async makePlayHTRequest<T>(
    endpoint: string,
    options: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await this.makeRequestWithRetry<T>(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...(options.headers || {}),
      },
    });

    return response;
  }

  /**
   * Parse and format error response from PlayHT API
   */
  private async parseErrorResponse(response: Response): Promise<string> {
    try {
      const errorData = (await response.json()) as {
        error_message?: string;
        message?: string;
        error?: string;
      };
      return (
        errorData.error_message ||
        errorData.message ||
        errorData.error ||
        response.statusText
      );
    } catch {
      return response.statusText;
    }
  }

  /**
   * Parse and validate voice settings
   */
  private parseSettings(settings?: VoiceSettings): PlayHTVoiceSettings {
    if (!settings) {
      return {
        speed: PLAYHT_PROVIDER.DEFAULTS.SPEED,
        temperature: PLAYHT_PROVIDER.DEFAULTS.TEMPERATURE,
        quality: PLAYHT_PROVIDER.AUDIO.DEFAULT_QUALITY,
        sampleRate: PLAYHT_PROVIDER.AUDIO.DEFAULT_SAMPLE_RATE,
        outputFormat: PLAYHT_PROVIDER.AUDIO.DEFAULT_FORMAT,
      };
    }

    // Map generic VoiceSettings to PlayHT-specific settings
    // VoiceSettings uses 'speed' which maps directly to PlayHT speed
    return PlayHTVoiceSettingsSchema.parse({
      speed: settings.speed ?? PLAYHT_PROVIDER.DEFAULTS.SPEED,
      temperature: PLAYHT_PROVIDER.DEFAULTS.TEMPERATURE, // VoiceSettings doesn't have temperature
      quality: PLAYHT_PROVIDER.AUDIO.DEFAULT_QUALITY, // VoiceSettings doesn't have quality
      sampleRate: PLAYHT_PROVIDER.AUDIO.DEFAULT_SAMPLE_RATE,
      outputFormat: PLAYHT_PROVIDER.AUDIO.DEFAULT_FORMAT,
    });
  }

  /**
   * Validate PlayHT-specific request constraints
   */
  private validatePlayHTRequest(request: VoiceGenerationRequest): void {
    if (!request.text || request.text.length === 0) {
      throw new Error('Text is required');
    }
    if (request.text.length > PLAYHT_PROVIDER.LIMITS.TEXT.MAX_LENGTH) {
      throw new Error(
        `Text exceeds maximum length of ${PLAYHT_PROVIDER.LIMITS.TEXT.MAX_LENGTH} characters`,
      );
    }
    if (!request.voiceId || request.voiceId.length === 0) {
      throw new Error('Voice ID is required');
    }
  }

  /**
   * Validate clone voice request
   */
  private validateCloneRequest(request: CloneVoiceRequest): void {
    if (!request.name || request.name.trim().length === 0) {
      throw new Error('Voice name is required');
    }

    if (!request.audioFiles || request.audioFiles.length === 0) {
      throw new Error('At least one audio file is required');
    }
  }

  /**
   * Map PlayHT voice to internal Voice type
   */
  private mapPlayHTVoice(voice: PlayHTVoice, isCloned: boolean): Voice {
    return {
      id: voice.id,
      name: voice.name,
      provider: 'playht',
      language: voice.language_code || voice.language || 'en-US',
      gender: voice.gender,
      age: voice.age,
      accent: voice.accent,
      previewUrl: voice.sample,
      isCloned,
      metadata: {
        voiceEngine: voice.voice_engine || voice.voiceEngine,
        style: voice.style,
        tempo: voice.tempo,
        loudness: voice.loudness,
        texture: voice.texture,
      },
    };
  }

  /**
   * Apply filters to voice list
   */
  private applyVoiceFilters(
    voices: Voice[],
    params?: ListVoicesParams,
  ): Voice[] {
    if (!params) return voices;

    let filtered = voices;

    if (params.language) {
      filtered = filtered.filter((v) =>
        v.language?.toLowerCase().includes(params.language!.toLowerCase()),
      );
    }
    if (params.gender) {
      filtered = filtered.filter((v) => v.gender === params.gender);
    }
    if (params.age) {
      filtered = filtered.filter((v) => v.age === params.age);
    }
    if (params.accent) {
      filtered = filtered.filter((v) =>
        v.accent?.toLowerCase().includes(params.accent!.toLowerCase()),
      );
    }

    return filtered;
  }

  /**
   * Estimate audio duration from buffer (simplified)
   */
  private estimateDuration(buffer: Buffer): number {
    // Rough estimate based on file size and typical MP3 bitrate
    const bytesPerSecond = 16000; // ~128kbps MP3
    return Math.ceil(buffer.length / bytesPerSecond);
  }
}
