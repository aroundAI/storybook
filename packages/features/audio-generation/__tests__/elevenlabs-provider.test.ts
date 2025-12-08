import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_VOICE_SETTINGS, ELEVENLABS } from '../src/lib/constants';
import { ElevenLabsProvider } from '../src/providers/elevenlabs';

// Helper to create a proper mock response
function createMockResponse(options: {
  ok?: boolean;
  statusText?: string;
  data?: unknown;
  arrayBuffer?: ArrayBuffer;
}) {
  return {
    ok: options.ok ?? true,
    statusText: options.statusText ?? 'OK',
    json: vi.fn().mockResolvedValue(options.data ?? {}),
    arrayBuffer: vi
      .fn()
      .mockResolvedValue(options.arrayBuffer ?? new ArrayBuffer(0)),
  };
}

describe('ElevenLabsProvider', () => {
  let provider: ElevenLabsProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    fetchMock = vi.fn();
    global.fetch = fetchMock;

    provider = new ElevenLabsProvider({
      apiKey: 'test-api-key',
      maxRetries: 1, // Minimize retries in tests
      timeout: 1000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create provider with default base URL', () => {
      expect(provider.name).toBe('elevenlabs');
      expect(provider.supportsCloning).toBe(true);
      expect(provider.supportsStreaming).toBe(true);
    });

    it('should use custom base URL when provided', () => {
      const customProvider = new ElevenLabsProvider({
        apiKey: 'test-key',
        baseUrl: 'https://custom.api.com',
      });
      expect(customProvider.name).toBe('elevenlabs');
    });
  });

  describe('generateVoice', () => {
    const mockAudioData = new ArrayBuffer(1024);

    it('should generate voice audio with valid input', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          arrayBuffer: mockAudioData,
        }),
      );

      const resultPromise = provider.generateVoice({
        text: 'Hello world',
        voiceId: 'voice-123',
      });

      // Fast-forward timers for AbortSignal
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.audioBuffer).toBeInstanceOf(Buffer);
      expect(result.characterCount).toBe(11);
      expect(result.format).toBe('mp3');
      expect(result.metadata?.voiceId).toBe('voice-123');
      expect(result.metadata?.modelId).toBe('eleven_monolingual_v1');
    });

    it('should apply custom voice settings', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          arrayBuffer: mockAudioData,
        }),
      );

      const resultPromise = provider.generateVoice({
        text: 'Hello',
        voiceId: 'voice-123',
        settings: {
          stability: 0.8,
          similarityBoost: 0.9,
          style: 0.5,
          speed: 1.2,
        },
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      const fetchCall = fetchMock.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.voice_settings.stability).toBe(0.8);
      expect(body.voice_settings.similarity_boost).toBe(0.9);
      expect(body.voice_settings.style).toBe(0.5);
      expect(body.voice_settings.speed).toBe(1.2);
    });

    it('should use default settings when not provided', async () => {
      fetchMock.mockResolvedValueOnce(
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

      expect(body.voice_settings.stability).toBe(
        DEFAULT_VOICE_SETTINGS.stability,
      );
      expect(body.voice_settings.similarity_boost).toBe(
        DEFAULT_VOICE_SETTINGS.similarityBoost,
      );
    });

    it('should send correct headers with API key', async () => {
      fetchMock.mockResolvedValueOnce(
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
      expect(fetchCall[1].headers['xi-api-key']).toBe('test-api-key');
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json');
    });

    it('should use correct endpoint URL', async () => {
      fetchMock.mockResolvedValueOnce(
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
        `${ELEVENLABS.BASE_URL}/text-to-speech/voice-123`,
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
          text: 'a'.repeat(5001),
          voiceId: 'voice-123',
        }),
      ).rejects.toThrow();
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

      // Immediately await without running timers since the response is already resolved
      await expect(resultPromise).rejects.toThrow(
        'elevenlabs generateVoice failed',
      );
    });
  });

  describe('getVoices', () => {
    const mockVoicesResponse = {
      voices: [
        {
          voice_id: 'v1',
          name: 'Rachel',
          category: 'premade',
          description: 'A warm voice',
          labels: { gender: 'female', age: 'young', accent: 'american' },
          preview_url: 'https://example.com/preview.mp3',
          available_for_tiers: ['free', 'starter'],
          settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        },
        {
          voice_id: 'v2',
          name: 'Josh',
          category: 'premade',
          labels: { gender: 'male', age: 'middle-aged', accent: 'british' },
          preview_url: 'https://example.com/preview2.mp3',
          available_for_tiers: ['free', 'starter'],
        },
        {
          voice_id: 'v3',
          name: 'Custom Voice',
          category: 'cloned',
          labels: { gender: 'female', accent: 'american' },
          available_for_tiers: ['starter'],
        },
      ],
    };

    it('should return all voices', async () => {
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
      expect(result.voices[0]?.name).toBe('Rachel');
      expect(result.voices[0]?.id).toBe('v1');
      expect(result.voices[0]?.provider).toBe('elevenlabs');
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
      expect(result.voices[0]?.name).toBe('Josh');
    });

    it('should filter voices by age', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices({ age: 'young' });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]?.name).toBe('Rachel');
    });

    it('should identify cloned voices', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      const clonedVoice = result.voices.find((v) => v.name === 'Custom Voice');
      expect(clonedVoice?.isCloned).toBe(true);

      const premadeVoice = result.voices.find((v) => v.name === 'Rachel');
      expect(premadeVoice?.isCloned).toBe(false);
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
        'https://example.com/preview.mp3',
      );
    });

    it('should map voice settings correctly', async () => {
      fetchMock.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          data: mockVoicesResponse,
        }),
      );

      const resultPromise = provider.getVoices();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.voices[0]?.settings?.stability).toBe(0.5);
      expect(result.voices[0]?.settings?.similarityBoost).toBe(0.75);
    });
  });

  describe('cloneVoice', () => {
    it('should clone voice with valid audio samples', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ voice_id: 'cloned-123', name: 'My Voice' }),
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

    it('should send description and labels when provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ voice_id: 'cloned-123', name: 'My Voice' }),
      });

      const resultPromise = provider.cloneVoice({
        name: 'My Voice',
        description: 'A custom narration voice',
        audioFiles: [Buffer.from('audio-data')],
        labels: { accent: 'american', gender: 'male' },
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      const fetchCall = fetchMock.mock.calls[0];
      expect(fetchCall[0]).toBe(`${ELEVENLABS.BASE_URL}/voices/add`);
      expect(fetchCall[1].method).toBe('POST');
    });

    it('should reject more than 25 audio files', async () => {
      const audioFiles = Array(26)
        .fill(null)
        .map(() => Buffer.from('audio'));

      await expect(
        provider.cloneVoice({
          name: 'My Voice',
          audioFiles,
        }),
      ).rejects.toThrow('Maximum 25 audio files allowed');
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

    it('should handle API errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ message: 'Invalid audio format' }),
      });

      const resultPromise = provider.cloneVoice({
        name: 'My Voice',
        audioFiles: [Buffer.from('audio-data')],
      });

      // Immediately await without running timers since the response is already resolved
      await expect(resultPromise).rejects.toThrow('cloneVoice failed');
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
        `${ELEVENLABS.BASE_URL}/voices/voice-to-delete`,
      );
      expect(fetchCall[1].method).toBe('DELETE');
    });
  });

  describe('estimateCost', () => {
    it('should calculate cost correctly for short text', () => {
      const cost = provider.estimateCost({
        text: 'Hello world',
        voiceId: 'voice-123',
      });

      // 11 characters / 1000 * 30 cents = 0.33, rounded up = 1 cent
      expect(cost).toBe(1);
    });

    it('should calculate cost correctly for 1000 characters', () => {
      const cost = provider.estimateCost({
        text: 'a'.repeat(1000),
        voiceId: 'voice-123',
      });

      // 1000 characters / 1000 * 30 = 30 cents
      expect(cost).toBe(30);
    });

    it('should calculate cost correctly for 1500 characters', () => {
      const cost = provider.estimateCost({
        text: 'a'.repeat(1500),
        voiceId: 'voice-123',
      });

      // 1500 characters / 1000 * 30 = 45 cents
      expect(cost).toBe(45);
    });

    it('should round up cost for partial thousands', () => {
      const cost = provider.estimateCost({
        text: 'a'.repeat(1001),
        voiceId: 'voice-123',
      });

      // 1001 / 1000 * 30 = 30.03, rounded up = 31 cents
      expect(cost).toBe(31);
    });
  });

  describe('getRateLimits', () => {
    it('should return expected rate limits', () => {
      const limits = provider.getRateLimits();

      expect(limits.requestsPerMinute).toBe(100);
      expect(limits.concurrentRequests).toBe(10);
    });
  });

  describe('supportedLanguages', () => {
    it('should have expected supported languages', () => {
      expect(provider.supportedLanguages).toContain('en');
      expect(provider.supportedLanguages).toContain('es');
      expect(provider.supportedLanguages).toContain('fr');
      expect(provider.supportedLanguages).toContain('de');
      expect(provider.supportedLanguages).toContain('ja');
      expect(provider.supportedLanguages).toContain('zh');
    });

    it('should match ELEVENLABS constants', () => {
      expect(provider.supportedLanguages).toEqual(
        ELEVENLABS.SUPPORTED_LANGUAGES,
      );
    });
  });
});
