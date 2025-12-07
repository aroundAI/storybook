import { describe, expect, it } from 'vitest';

import {
  AudioTypeSchema,
  CloneVoiceSchema,
  GenerateMusicSchema,
  GenerateVoiceSchema,
  GetVoicesSchema,
  MusicGenerationRequestSchema,
  MusicProviderNameSchema,
  VoiceGenerationRequestSchema,
  VoiceProviderNameSchema,
  VoiceSettingsSchema,
} from '../src/lib/schemas';

describe('Audio Generation Schemas', () => {
  describe('VoiceProviderNameSchema', () => {
    it('should accept valid voice providers', () => {
      expect(VoiceProviderNameSchema.safeParse('elevenlabs').success).toBe(
        true,
      );
      expect(VoiceProviderNameSchema.safeParse('playht').success).toBe(true);
      expect(VoiceProviderNameSchema.safeParse('deepgram').success).toBe(true);
      expect(VoiceProviderNameSchema.safeParse('azure').success).toBe(true);
      expect(VoiceProviderNameSchema.safeParse('google').success).toBe(true);
    });

    it('should reject invalid providers', () => {
      expect(VoiceProviderNameSchema.safeParse('invalid').success).toBe(false);
      expect(VoiceProviderNameSchema.safeParse('').success).toBe(false);
      expect(VoiceProviderNameSchema.safeParse(null).success).toBe(false);
    });
  });

  describe('MusicProviderNameSchema', () => {
    it('should accept valid music providers', () => {
      expect(MusicProviderNameSchema.safeParse('suno').success).toBe(true);
      expect(MusicProviderNameSchema.safeParse('udio').success).toBe(true);
      expect(MusicProviderNameSchema.safeParse('mubert').success).toBe(true);
      expect(MusicProviderNameSchema.safeParse('beatoven').success).toBe(true);
    });

    it('should reject invalid providers', () => {
      expect(MusicProviderNameSchema.safeParse('spotify').success).toBe(false);
      expect(MusicProviderNameSchema.safeParse('').success).toBe(false);
    });
  });

  describe('AudioTypeSchema', () => {
    it('should accept all valid audio types', () => {
      const types = ['voice', 'music', 'sfx'];

      types.forEach((type) => {
        expect(AudioTypeSchema.safeParse(type).success).toBe(true);
      });
    });

    it('should reject invalid types', () => {
      expect(AudioTypeSchema.safeParse('video').success).toBe(false);
      expect(AudioTypeSchema.safeParse('').success).toBe(false);
    });
  });

  describe('VoiceSettingsSchema', () => {
    it('should accept valid settings', () => {
      const result = VoiceSettingsSchema.safeParse({
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0.3,
        speed: 1.0,
        useSpeakerBoost: true,
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty settings', () => {
      const result = VoiceSettingsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should reject stability out of range', () => {
      expect(
        VoiceSettingsSchema.safeParse({ stability: 1.5 }).success,
      ).toBe(false);
      expect(
        VoiceSettingsSchema.safeParse({ stability: -0.1 }).success,
      ).toBe(false);
    });

    it('should reject speed out of range', () => {
      expect(VoiceSettingsSchema.safeParse({ speed: 0.3 }).success).toBe(false);
      expect(VoiceSettingsSchema.safeParse({ speed: 2.5 }).success).toBe(false);
    });
  });

  describe('VoiceGenerationRequestSchema', () => {
    const validRequest = {
      text: 'Hello, this is a test.',
      voiceId: 'voice-123',
    };

    it('should accept valid request', () => {
      const result = VoiceGenerationRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should accept request with all optional fields', () => {
      const fullRequest = {
        ...validRequest,
        settings: { stability: 0.5, similarityBoost: 0.75 },
        modelId: 'eleven_monolingual_v1',
        outputFormat: 'mp3',
        sampleRate: 44100,
      };

      const result = VoiceGenerationRequestSchema.safeParse(fullRequest);
      expect(result.success).toBe(true);
    });

    it('should reject empty text', () => {
      const result = VoiceGenerationRequestSchema.safeParse({
        ...validRequest,
        text: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject text exceeding max length', () => {
      const result = VoiceGenerationRequestSchema.safeParse({
        ...validRequest,
        text: 'a'.repeat(5001),
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty voiceId', () => {
      const result = VoiceGenerationRequestSchema.safeParse({
        ...validRequest,
        voiceId: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid output format', () => {
      const result = VoiceGenerationRequestSchema.safeParse({
        ...validRequest,
        outputFormat: 'flac',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MusicGenerationRequestSchema', () => {
    const validRequest = {
      prompt: 'An epic orchestral piece for a battle scene',
      duration: 60,
    };

    it('should accept valid request', () => {
      const result = MusicGenerationRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it('should accept request with all optional fields', () => {
      const fullRequest = {
        ...validRequest,
        genre: 'orchestral',
        mood: 'epic',
        tempo: 'fast',
        instrumentalOnly: true,
        tags: ['action', 'cinematic'],
      };

      const result = MusicGenerationRequestSchema.safeParse(fullRequest);
      expect(result.success).toBe(true);
    });

    it('should reject empty prompt', () => {
      const result = MusicGenerationRequestSchema.safeParse({
        ...validRequest,
        prompt: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject prompt exceeding max length', () => {
      const result = MusicGenerationRequestSchema.safeParse({
        ...validRequest,
        prompt: 'a'.repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-positive duration', () => {
      expect(
        MusicGenerationRequestSchema.safeParse({
          ...validRequest,
          duration: 0,
        }).success,
      ).toBe(false);

      expect(
        MusicGenerationRequestSchema.safeParse({
          ...validRequest,
          duration: -10,
        }).success,
      ).toBe(false);
    });

    it('should reject duration exceeding maximum', () => {
      const result = MusicGenerationRequestSchema.safeParse({
        ...validRequest,
        duration: 241,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('GenerateVoiceSchema', () => {
    const validInput = {
      episodeId: '123e4567-e89b-12d3-a456-426614174000',
      provider: 'elevenlabs',
      request: {
        text: 'Hello world',
        voiceId: 'voice-123',
      },
    };

    it('should accept valid input', () => {
      const result = GenerateVoiceSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept input without optional fields', () => {
      const result = GenerateVoiceSchema.safeParse({
        request: validInput.request,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid episodeId', () => {
      const result = GenerateVoiceSchema.safeParse({
        ...validInput,
        episodeId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid provider', () => {
      const result = GenerateVoiceSchema.safeParse({
        ...validInput,
        provider: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('GenerateMusicSchema', () => {
    const validInput = {
      episodeId: '123e4567-e89b-12d3-a456-426614174000',
      provider: 'suno',
      request: {
        prompt: 'Epic battle music',
        duration: 60,
      },
    };

    it('should accept valid input', () => {
      const result = GenerateMusicSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing episodeId', () => {
      const result = GenerateMusicSchema.safeParse({
        provider: 'suno',
        request: validInput.request,
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid provider', () => {
      const result = GenerateMusicSchema.safeParse({
        ...validInput,
        provider: 'spotify',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('GetVoicesSchema', () => {
    it('should accept valid filter options', () => {
      const result = GetVoicesSchema.safeParse({
        provider: 'elevenlabs',
        language: 'en',
        gender: 'female',
        age: 'young',
        accent: 'american',
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty filter', () => {
      const result = GetVoicesSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should reject invalid gender', () => {
      const result = GetVoicesSchema.safeParse({
        gender: 'unknown',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CloneVoiceSchema', () => {
    it('should accept valid clone request', () => {
      const result = CloneVoiceSchema.safeParse({
        provider: 'elevenlabs',
        name: 'My Custom Voice',
        description: 'A cloned voice for narration',
        language: 'en',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const result = CloneVoiceSchema.safeParse({
        name: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject name exceeding max length', () => {
      const result = CloneVoiceSchema.safeParse({
        name: 'a'.repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it('should reject description exceeding max length', () => {
      const result = CloneVoiceSchema.safeParse({
        name: 'Valid Name',
        description: 'a'.repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });
});
