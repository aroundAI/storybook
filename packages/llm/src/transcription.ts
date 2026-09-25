/**
 * Whisper Transcription Service
 *
 * Provides speech-to-text transcription using OpenAI's Whisper API
 * with support for word-level timing.
 *
 * @example
 * ```typescript
 * import { createTranscriptionService } from '@kit/llm';
 *
 * const service = createTranscriptionService();
 *
 * // Transcribe from URL
 * const result = await service.transcribeFromUrl('https://example.com/audio.mp3');
 *
 * console.log(result.text);
 * console.log(result.segments); // With timing
 * ```
 */
import OpenAI from 'openai';

import { vendorUrl } from '@kit/shared/vendors';

import { LLMError } from './types';

/**
 * Word-level timing information
 */
export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

/**
 * Segment with timing information
 */
export interface TranscriptionSegment {
  id: number;
  text: string;
  start: number;
  end: number;
  words?: TranscriptionWord[];
}

/**
 * Complete transcription result
 */
export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
}

/**
 * Configuration for the transcription service
 */
export interface TranscriptionConfig {
  /** OpenAI API key (falls back to OPENAI_API_KEY env var) */
  apiKey?: string;
  /** Whisper model to use */
  model?: 'whisper-1';
  /** Language hint for transcription (ISO 639-1 code) */
  language?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Whisper transcription service
 */
export class WhisperTranscriptionService {
  private client: OpenAI;
  private config: Required<Pick<TranscriptionConfig, 'model'>> &
    Omit<TranscriptionConfig, 'model'>;

  constructor(config: TranscriptionConfig = {}) {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new LLMError(
        'OpenAI API key is required for transcription. Set OPENAI_API_KEY environment variable or pass apiKey in config.',
        'openai',
        'MISSING_API_KEY',
      );
    }

    this.config = {
      model: 'whisper-1',
      ...config,
    };

    // An explicit baseURL, so the SDK never reads OPENAI_BASE_URL (FILM-1805).
    this.client = new OpenAI({
      apiKey,
      baseURL: `${vendorUrl('openai')}/v1`,
      timeout: config.timeout ?? 120000, // 2 minutes default
    });
  }

  /**
   * Transcribe audio from a URL
   *
   * @param audioUrl - URL to the audio file
   * @returns Transcription result with segments and word-level timing
   */
  async transcribeFromUrl(audioUrl: string): Promise<TranscriptionResult> {
    try {
      // Fetch audio file from URL
      const response = await fetch(audioUrl);

      if (!response.ok) {
        throw new LLMError(
          `Failed to fetch audio from URL: ${response.status} ${response.statusText}`,
          'openai',
          'FETCH_FAILED',
          response.status,
        );
      }

      const contentType = response.headers.get('content-type') ?? 'audio/mpeg';
      const audioBlob = await response.blob();

      // Determine file extension from content type
      const extension = this.getExtensionFromContentType(contentType);
      const filename = `audio.${extension}`;

      // Create file from blob
      const file = new File([audioBlob], filename, { type: contentType });

      return this.transcribe(file);
    } catch (error) {
      if (error instanceof LLMError) {
        throw error;
      }
      throw new LLMError(
        error instanceof Error
          ? error.message
          : 'Failed to transcribe from URL',
        'openai',
        'TRANSCRIPTION_FAILED',
      );
    }
  }

  /**
   * Transcribe an audio file
   *
   * @param audioFile - Audio file to transcribe
   * @returns Transcription result with segments and word-level timing
   */
  async transcribe(audioFile: File): Promise<TranscriptionResult> {
    try {
      const transcription = await this.client.audio.transcriptions.create({
        file: audioFile,
        model: this.config.model,
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        language: this.config.language,
      });

      // Map OpenAI response to our format
      return {
        text: transcription.text,
        segments: this.mapSegments(transcription),
        language: transcription.language ?? 'en',
        duration: transcription.duration ?? 0,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Map OpenAI transcription segments to our format
   */
  private mapSegments(
    transcription: OpenAI.Audio.Transcription,
  ): TranscriptionSegment[] {
    // Access segments from the verbose_json response
    const segments = (transcription as unknown as VerboseTranscription)
      .segments;
    const words = (transcription as unknown as VerboseTranscription).words;

    if (!segments || !Array.isArray(segments)) {
      // If no segments, create a single segment from the full text
      return [
        {
          id: 0,
          text: transcription.text,
          start: 0,
          end: (transcription as unknown as VerboseTranscription).duration ?? 0,
          words: words?.map((w) => ({
            word: w.word,
            start: w.start,
            end: w.end,
          })),
        },
      ];
    }

    return segments.map((seg, idx) => {
      // Find words that belong to this segment
      const segmentWords = words?.filter(
        (w) => w.start >= seg.start && w.end <= seg.end,
      );

      return {
        id: idx,
        text: seg.text.trim(),
        start: seg.start,
        end: seg.end,
        words: segmentWords?.map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
        })),
      };
    });
  }

  /**
   * Get file extension from content type
   */
  private getExtensionFromContentType(contentType: string): string {
    const typeMap: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/flac': 'flac',
      'audio/m4a': 'm4a',
      'audio/mp4': 'm4a',
    };

    const baseType = contentType.split(';')[0] ?? '';
    return typeMap[baseType] ?? 'mp3';
  }

  /**
   * Handle OpenAI-specific errors
   */
  private handleError(error: unknown): LLMError {
    if (error instanceof OpenAI.APIError) {
      return new LLMError(
        error.message,
        'openai',
        error.code ?? 'TRANSCRIPTION_ERROR',
        error.status,
      );
    }

    if (error instanceof Error) {
      return new LLMError(error.message, 'openai', 'TRANSCRIPTION_ERROR');
    }

    return new LLMError(
      'Unknown error during transcription',
      'openai',
      'UNKNOWN_ERROR',
    );
  }
}

/**
 * Internal type for verbose_json response
 */
interface VerboseTranscription {
  text: string;
  language: string;
  duration: number;
  segments?: Array<{
    id: number;
    text: string;
    start: number;
    end: number;
  }>;
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
}

/**
 * Create a transcription service instance
 *
 * @param config - Optional configuration
 * @returns Transcription service instance
 */
export function createTranscriptionService(
  config?: TranscriptionConfig,
): WhisperTranscriptionService {
  return new WhisperTranscriptionService(config);
}
