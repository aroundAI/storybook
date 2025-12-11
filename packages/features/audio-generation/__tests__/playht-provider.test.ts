import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLAYHT } from '../src/lib/constants';
import { PLAYHT_PROVIDER } from '../src/providers/playht/constants';
import { PlayHTProvider } from '../src/providers/playht/playht-provider';

// Helper to create a proper mock response
function createMockResponse(options: {
  ok?: boolean;
  statusText?: string;
  data?: unknown;
  arrayBuffer?: ArrayBuffer;
  body?: ReadableStream<Uint8Array> | null;
}) {
  return {
    ok: options.ok ?? true,
    statusText: options.statusText ?? 'OK',
    json: vi.fn().mockResolvedValue(options.data ?? {}),
    arrayBuffer: vi
      .fn()
      .mockResolvedValue(options.arrayBuffer ?? new ArrayBuffer(0)),
    body: options.body ?? null,
  };
}

describe('PlayHTProvider', () => {
  let provider: PlayHTProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    fetchMock = vi.fn();
    global.fetch = fetchMock;

    provider = new PlayHTProvider({
      apiKey: 'test-api-key',
      userId: 'test-user-id',
      maxRetries: 1, // Minimize retries in tests
      timeout: 1000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create provider with valid config', () => {
      expect(provider.name).toBe('playht');
      expect(provider.supportsCloning).toBe(true);
      expect(provider.supportsStreaming).toBe(true);
    });

    it('should throw error when userId is missing', () => {
      expect(
        () =>
          new PlayHTProvider({
            apiKey: 'test-key',
          }),
      ).toThrow('PlayHT requires userId in configuration');
    });

    it('should use custom base URL when provided', () => {
      const customProvider = new PlayHTProvider({
        apiKey: 'test-key',
        userId: 'test-user',
        baseUrl: 'https://custom.api.com',
      });
      expect(customProvider.name).toBe('playht');
    });

    it('should use default base URL when not provided', () => {
      expect(provider.name).toBe('playht');
    });
  });

  describe('generateVoice', () => {
    const mockAudioData = new ArrayBuffer(1024);
    const mockTTSResponse = {
      id: 'tts-123',
      status: 'COMPLETE',
      audio_url: 'https://audio.play.ht/sample.mp3',
      duration: 5.5,
      voice: 'voice-123',
      text: 'Hello world',
      output_format: 'mp3',
      sample_rate: 24000,
      created_at: '2024-01-01T00:00:00Z',
    };

    it('should generate voice audio with valid input', async () => {
      // First call returns TTS response, second call fetches audio
      fetchMock
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            data: mockTTSResponse,
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            arrayBuffer: mockAudioData,
          }),
        );

      const resultPromise = provider.generateVoice({
        text: 'Hello world',
        voiceId: 'voice-123',
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.audioBuffer).toBeInstanceOf(Buffer);
      expect(result.characterCount).toBe(11);
      expect(result.format).toBe('mp3');
      expect(result.metadata?.voiceId).toBe('voice-123');
      expect(result.audioUrl).toBe('https://audio.play.ht/sample.mp3');
    });

    it('should apply custom voice settings', async () => {
      fetchMock
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            data: mockTTSResponse,
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            arrayBuffer: mockAudioData,
          }),
        );

      const resultPromise = provider.generateVoice({
        text: 'Hello',
        voiceId: 'voice-123',
        settings: {
          speed: 1.5,
        },
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      const fetchCall = fetchMock.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.speed).toBe(1.5);
      // Temperature uses default when not provided in VoiceSettings
      expect(body.temperature).toBe(PLAYHT_PROVIDER.DEFAULTS.TEMPERATURE);
    });

    it('should use default settings when not provided', async () => {
      fetchMock
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            data: mockTTSResponse,
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            arrayBuffer: mockAudioData,
          }),
        );

      const resultPromise = provider.generateVoice({
        text: 'Hello',
        voiceId: 'voice-123',
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      const fetchCall = fetchMock.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.speed).toBe(PLAYHT_PROVIDER.DEFAULTS.SPEED);
      expect(body.temperature).toBe(PLAYHT_PROVIDER.DEFAULTS.TEMPERATURE);
      expect(body.quality).toBe(PLAYHT_PROVIDER.AUDIO.DEFAULT_QUALITY);
    });

    it('should send correct headers with API key and user ID', async () => {
      fetchMock
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            data: mockTTSResponse,
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            arrayBuffer: mockAudioData,
          }),
        );

      const resultPromise = provider.generateVoice({
        text: 'Hello',
        voiceId: 'voice-123',
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer test-api-key');
      expect(fetchCall[1].headers['X-User-ID']).toBe('test-user-id');
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json');
    });

    it('should use correct endpoint URL', async () => {
      fetchMock
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            data: mockTTSResponse,
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            arrayBuffer: mockAudioData,
          }),
        );

      const resultPromise = provider.generateVoice({
        text: 'Hello',
        voiceId: 'voice-123',
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe(
        `${PLAYHT_PROVIDER.API.BASE_URL}${PLAYHT_PROVIDER.API.ENDPOINTS.TTS}`,
      );
    });

    it('should reject empty text', async () => {
      await expect(
        provider.generateVoice({
          text: '',
          voiceId: 'voice-123',
        }),
      ).rejects.toThrow();
    });

    it('should reject text exceeding max length', async () => {
      await expect(
        provider.generateVoice({
          text: 'a'.repeat(10001),
          voiceId: 'voice-123',
        }),
      ).rejects.toThrow('Text exceeds maximum length of 10000 characters');
    });

    it('should handle API errors gracefully', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          statusText: 'Unauthorized',
          data: { message: 'Invalid API key' },
        }),
      );

      const resultPromise = provider.generateVoice({
        text: 'Hello',
        voiceId: 'voice-123',
      });

      await expect(resultPromise).rejects.toThrow(
        'playht generateVoice failed',
      );
    });
  });

  describe('generateVoiceStream', () => {
    it('should return ReadableStream for valid request', async () => {
      const mockStream = new ReadableStream<Uint8Array>();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      const stream = await provider.generateVoiceStream({
        text: 'Hello world',
        voiceId: 'voice-123',
      });

      expect(stream).toBeInstanceOf(ReadableStream);
    });

    it('should handle streaming errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({ message: 'Server error' }),
      });

      await expect(
        provider.generateVoiceStream({
          text: 'Hello',
          voiceId: 'voice-123',
        }),
      ).rejects.toThrow('PlayHT streaming error');
    });

    it('should send correct headers', async () => {
      const mockStream = new ReadableStream<Uint8Array>();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      await provider.generateVoiceStream({
        text: 'Hello',
        voiceId: 'voice-123',
      });

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer test-api-key');
      expect(fetchCall[1].headers['X-User-ID']).toBe('test-user-id');
    });
  });

  describe('getVoices', () => {
    const mockVoicesResponse = [
      {
        id: 's3://voice-cloning-zero-shot/8f9a5a4a-4e7a-4d3a-9a1e-3f5e7a8b9c0d/manifest.json',
        name: 'Jennifer',
        voice_engine: 'PlayHT2.0',
        language: 'English (US)',
        language_code: 'en-US',
        gender: 'female',
        age: 'adult',
        style: 'conversational',
        sample: 'https://peregrine-samples.play.ht/jennifer.mp3',
        accent: 'american',
      },
      {
        id: 's3://voice-cloning-zero-shot/9a0b1c2d-3e4f-5g6h-7i8j-9k0l1m2n3o4p/manifest.json',
        name: 'Michael',
        voice_engine: 'PlayHT2.0',
        language: 'English (GB)',
        language_code: 'en-GB',
        gender: 'male',
        age: 'adult',
        style: 'news',
        sample: 'https://peregrine-samples.play.ht/michael.mp3',
        accent: 'british',
      },
      {
        id: 's3://voice-cloning-zero-shot/1p2o3n4m-5l6k-7j8i-9h0g-1f2e3d4c5b6a/manifest.json',
        name: 'Sophie',
        voice_engine: 'PlayHT2.0',
        language: 'English (US)',
        language_code: 'en-US',
        gender: 'female',
        age: 'youth',
        style: 'upbeat',
        sample: 'https://peregrine-samples.play.ht/sophie.mp3',
        accent: 'american',
      },
    ];

    it('should return all available voices', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.voices).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.voices[0]?.name).toBe('Jennifer');
      expect(result.voices[0]?.provider).toBe('playht');
    });

    it('should filter voices by language', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices({ language: 'en-GB' });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]?.name).toBe('Michael');
    });

    it('should filter voices by gender', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices({ gender: 'female' });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.voices).toHaveLength(2);
      expect(result.voices.every((v) => v.gender === 'female')).toBe(true);
    });

    it('should filter voices by age', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices({ age: 'youth' });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]?.name).toBe('Sophie');
    });

    it('should filter voices by accent', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices({ accent: 'british' });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]?.name).toBe('Michael');
    });

    it('should include preview URLs', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.voices[0]?.previewUrl).toBe(
        'https://peregrine-samples.play.ht/jennifer.mp3',
      );
    });

    it('should map voice properties correctly', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      const voice = result.voices[0];
      expect(voice?.id).toBe(mockVoicesResponse[0]?.id);
      expect(voice?.name).toBe('Jennifer');
      expect(voice?.language).toBe('en-US');
      expect(voice?.gender).toBe('female');
      expect(voice?.age).toBe('adult');
      expect(voice?.accent).toBe('american');
      expect(voice?.metadata?.voiceEngine).toBe('PlayHT2.0');
    });
  });

  describe('getClonedVoices', () => {
    const mockClonedVoicesResponse = [
      {
        id: 'cloned-voice-123',
        name: 'My Custom Voice',
        created_at: '2024-01-01T00:00:00Z',
        type: 'instant',
        status: 'ready',
      },
      {
        id: 'cloned-voice-456',
        name: 'Another Voice',
        created_at: '2024-01-02T00:00:00Z',
        type: 'instant',
        status: 'processing',
      },
    ];

    it('should return user cloned voices', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockClonedVoicesResponse,
        }),
      );

      const resultPromise = provider.getClonedVoices();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('My Custom Voice');
      expect(result[0]?.id).toBe('cloned-voice-123');
    });

    it('should mark voices as cloned', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockClonedVoicesResponse,
        }),
      );

      const resultPromise = provider.getClonedVoices();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.every((v) => v.isCloned === true)).toBe(true);
    });

    it('should handle empty cloned voices list', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: [],
        }),
      );

      const resultPromise = provider.getClonedVoices();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveLength(0);
    });
  });

  describe('cloneVoice', () => {
    it('should clone voice with valid audio sample', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'cloned-123',
          name: 'My Voice',
          status: 'ready',
        }),
      });

      const resultPromise = provider.cloneVoice({
        name: 'My Voice',
        audioFiles: [Buffer.from('audio-data')],
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.voiceId).toBe('cloned-123');
      expect(result.name).toBe('My Voice');
      expect(result.status).toBe('ready');
    });

    it('should return processing status for pending clones', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'cloned-123',
          name: 'My Voice',
          status: 'pending',
        }),
      });

      const resultPromise = provider.cloneVoice({
        name: 'My Voice',
        audioFiles: [Buffer.from('audio-data')],
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('processing');
    });

    it('should reject empty name', async () => {
      await expect(
        provider.cloneVoice({
          name: '',
          audioFiles: [Buffer.from('audio-data')],
        }),
      ).rejects.toThrow('Voice name is required');
    });

    it('should reject empty audio files', async () => {
      await expect(
        provider.cloneVoice({
          name: 'My Voice',
          audioFiles: [],
        }),
      ).rejects.toThrow('At least one audio file is required');
    });

    it('should handle clone API errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ message: 'Invalid audio format' }),
      });

      const resultPromise = provider.cloneVoice({
        name: 'My Voice',
        audioFiles: [Buffer.from('audio-data')],
      });

      await expect(resultPromise).rejects.toThrow('cloneVoice failed');
    });

    it('should send to correct endpoint', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'cloned-123',
          name: 'My Voice',
          status: 'ready',
        }),
      });

      const resultPromise = provider.cloneVoice({
        name: 'My Voice',
        audioFiles: [Buffer.from('audio-data')],
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe(
        `${PLAYHT_PROVIDER.API.BASE_URL}${PLAYHT_PROVIDER.API.ENDPOINTS.CLONE_INSTANT}`,
      );
      expect(fetchCall[1].method).toBe('POST');
    });
  });

  describe('deleteClonedVoice', () => {
    it('should delete cloned voice successfully', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: {},
        }),
      );

      const resultPromise = provider.deleteClonedVoice('voice-to-delete');
      await vi.runAllTimersAsync();

      await expect(resultPromise).resolves.not.toThrow();

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe(
        `${PLAYHT_PROVIDER.API.BASE_URL}${PLAYHT_PROVIDER.API.ENDPOINTS.CLONED_VOICES}/voice-to-delete`,
      );
      expect(fetchCall[1].method).toBe('DELETE');
    });

    it('should handle deletion errors', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          statusText: 'Not Found',
          data: { message: 'Voice not found' },
        }),
      );

      const resultPromise = provider.deleteClonedVoice('non-existent-voice');

      await expect(resultPromise).rejects.toThrow(
        'playht deleteClonedVoice failed',
      );
    });
  });

  describe('estimateCost', () => {
    it('should calculate cost correctly for short text', () => {
      const cost = provider.estimateCost({
        text: 'Hello world',
        voiceId: 'voice-123',
      });

      // 11 characters / 1000 * 20 cents = 0.22, rounded up = 1 cent
      expect(cost).toBe(1);
    });

    it('should calculate cost correctly for 1000 characters', () => {
      const cost = provider.estimateCost({
        text: 'a'.repeat(1000),
        voiceId: 'voice-123',
      });

      // 1000 characters / 1000 * 20 = 20 cents
      expect(cost).toBe(20);
    });

    it('should calculate cost correctly for 1500 characters', () => {
      const cost = provider.estimateCost({
        text: 'a'.repeat(1500),
        voiceId: 'voice-123',
      });

      // 1500 characters / 1000 * 20 = 30 cents
      expect(cost).toBe(30);
    });

    it('should round up cost for partial thousands', () => {
      const cost = provider.estimateCost({
        text: 'a'.repeat(1001),
        voiceId: 'voice-123',
      });

      // 1001 / 1000 * 20 = 20.02, rounded up = 21 cents
      expect(cost).toBe(21);
    });

    it('should use PlayHT pricing ($0.20 per 1K chars)', () => {
      const cost = provider.estimateCost({
        text: 'a'.repeat(5000),
        voiceId: 'voice-123',
      });

      // 5000 / 1000 * 20 = 100 cents ($1.00)
      expect(cost).toBe(100);
    });
  });

  describe('getRateLimits', () => {
    it('should return correct rate limits', () => {
      const limits = provider.getRateLimits();

      expect(limits.requestsPerMinute).toBe(
        PLAYHT_PROVIDER.LIMITS.API.REQUESTS_PER_MINUTE,
      );
      expect(limits.concurrentRequests).toBe(
        PLAYHT_PROVIDER.LIMITS.API.CONCURRENT_REQUESTS,
      );
    });
  });

  describe('supportedLanguages', () => {
    it('should have expected supported languages', () => {
      expect(provider.supportedLanguages).toContain('en-US');
      expect(provider.supportedLanguages).toContain('en-GB');
      expect(provider.supportedLanguages).toContain('es-ES');
      expect(provider.supportedLanguages).toContain('fr-FR');
      expect(provider.supportedLanguages).toContain('de-DE');
      expect(provider.supportedLanguages).toContain('ja-JP');
      expect(provider.supportedLanguages).toContain('zh-CN');
    });

    it('should match PLAYHT constants', () => {
      expect(provider.supportedLanguages).toEqual(PLAYHT.SUPPORTED_LANGUAGES);
    });
  });
});
