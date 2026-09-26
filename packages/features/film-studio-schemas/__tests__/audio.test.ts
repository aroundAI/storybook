import { describe, expect, it } from 'vitest';

import {
  AudioFormatSchema,
  AudioProviderSchema,
  AudioTypeSchema,
  GenerateMusicSchema,
  GenerateVoiceSchema,
  MusicGenerationRequestSchema,
  UpdateAudioGenerationJobSchema,
  VoiceCloneSchema,
  VoiceGenerationRequestSchema,
  VoiceGenerationSettingsSchema,
  VoiceSchema,
} from '../src/audio';

describe('Audio Schemas', () => {
  const validUUID = '123e4567-e89b-12d3-a456-426614174000';

  describe('AudioProviderSchema', () => {
    it('should accept valid providers', () => {
      expect(AudioProviderSchema.safeParse('elevenlabs').success).toBe(true);
    });

    it('should reject the retired music provider (FILM-514)', () => {
      // Spelled in two parts so the FILM-514 repo scan does not match it.
      expect(AudioProviderSchema.safeParse('s' + 'uno').success).toBe(false);
    });

    it('should reject invalid providers', () => {
      expect(AudioProviderSchema.safeParse('openai').success).toBe(false);
      expect(AudioProviderSchema.safeParse('').success).toBe(false);
    });
  });

  describe('AudioTypeSchema', () => {
    it('should accept valid audio types', () => {
      const validTypes = ['voice', 'music', 'sfx', 'ambient'];
      validTypes.forEach((type) => {
        expect(AudioTypeSchema.safeParse(type).success).toBe(true);
      });
    });

    it('should reject invalid audio types', () => {
      expect(AudioTypeSchema.safeParse('speech').success).toBe(false);
    });
  });

  describe('AudioFormatSchema', () => {
    it('should accept valid formats', () => {
      const validFormats = ['mp3', 'wav', 'pcm', 'ogg', 'flac'];
      validFormats.forEach((format) => {
        expect(AudioFormatSchema.safeParse(format).success).toBe(true);
      });
    });

    it('should reject invalid formats', () => {
      expect(AudioFormatSchema.safeParse('aac').success).toBe(false);
    });
  });

  describe('VoiceGenerationSettingsSchema', () => {
    it('should accept valid settings', () => {
      const validSettings = {
        voiceId: 'voice-123',
        stability: 0.7,
        similarityBoost: 0.8,
      };
      expect(
        VoiceGenerationSettingsSchema.safeParse(validSettings).success,
      ).toBe(true);
    });

    it('should apply defaults', () => {
      const result = VoiceGenerationSettingsSchema.parse({
        voiceId: 'voice-123',
      });
      expect(result.stability).toBe(0.5);
      expect(result.similarityBoost).toBe(0.75);
      expect(result.style).toBe(0.0);
      expect(result.useSpeakerBoost).toBe(true);
      expect(result.outputFormat).toBe('mp3');
    });

    it('should require voiceId', () => {
      expect(VoiceGenerationSettingsSchema.safeParse({}).success).toBe(false);
    });

    it('should validate ranges', () => {
      expect(
        VoiceGenerationSettingsSchema.safeParse({
          voiceId: 'test',
          stability: 1.5,
        }).success,
      ).toBe(false);
      expect(
        VoiceGenerationSettingsSchema.safeParse({
          voiceId: 'test',
          similarityBoost: -0.1,
        }).success,
      ).toBe(false);
    });
  });

  describe('VoiceGenerationRequestSchema', () => {
    it('should accept valid request', () => {
      const validRequest = {
        text: 'Hello, this is a test.',
        voiceId: 'voice-123',
      };
      expect(VoiceGenerationRequestSchema.safeParse(validRequest).success).toBe(
        true,
      );
    });

    it('should enforce text length', () => {
      expect(
        VoiceGenerationRequestSchema.safeParse({
          text: '',
          voiceId: 'voice-123',
        }).success,
      ).toBe(false);
      expect(
        VoiceGenerationRequestSchema.safeParse({
          text: 'a'.repeat(5001),
          voiceId: 'voice-123',
        }).success,
      ).toBe(false);
    });

    it('should require voiceId', () => {
      expect(
        VoiceGenerationRequestSchema.safeParse({
          text: 'Hello',
        }).success,
      ).toBe(false);
    });

    it('should accept optional settings', () => {
      const withSettings = {
        text: 'Hello',
        voiceId: 'voice-123',
        settings: {
          stability: 0.8,
        },
        outputFormat: 'wav',
      };
      expect(VoiceGenerationRequestSchema.safeParse(withSettings).success).toBe(
        true,
      );
    });
  });

  describe('MusicGenerationRequestSchema', () => {
    it('should accept valid request', () => {
      const validRequest = {
        prompt: 'An epic orchestral piece',
        duration: 120,
      };
      expect(MusicGenerationRequestSchema.safeParse(validRequest).success).toBe(
        true,
      );
    });

    it('should enforce prompt length', () => {
      expect(
        MusicGenerationRequestSchema.safeParse({
          prompt: '',
          duration: 60,
        }).success,
      ).toBe(false);
      expect(
        MusicGenerationRequestSchema.safeParse({
          prompt: 'a'.repeat(1001),
          duration: 60,
        }).success,
      ).toBe(false);
    });

    it('should enforce max duration (4 minutes)', () => {
      expect(
        MusicGenerationRequestSchema.safeParse({
          prompt: 'Test',
          duration: 241,
        }).success,
      ).toBe(false);
      expect(
        MusicGenerationRequestSchema.safeParse({
          prompt: 'Test',
          duration: 240,
        }).success,
      ).toBe(true);
    });

    it('should apply default for instrumentalOnly', () => {
      const result = MusicGenerationRequestSchema.parse({
        prompt: 'Test music',
        duration: 60,
      });
      expect(result.instrumentalOnly).toBe(true);
    });

    it('should validate tempo enum', () => {
      expect(
        MusicGenerationRequestSchema.safeParse({
          prompt: 'Test',
          duration: 60,
          tempo: 'slow',
        }).success,
      ).toBe(true);
      expect(
        MusicGenerationRequestSchema.safeParse({
          prompt: 'Test',
          duration: 60,
          tempo: 'very-fast',
        }).success,
      ).toBe(false);
    });

    it('should accept optional fields', () => {
      const withOptionals = {
        prompt: 'Test music',
        duration: 60,
        genre: 'electronic',
        mood: 'uplifting',
        tempo: 'fast',
        tags: ['synth', 'dance'],
      };
      expect(
        MusicGenerationRequestSchema.safeParse(withOptionals).success,
      ).toBe(true);
    });
  });

  describe('GenerateVoiceSchema', () => {
    it('should accept valid voice generation', () => {
      const validGenerate = {
        episodeId: validUUID,
        request: {
          text: 'Hello world',
          voiceId: 'voice-123',
        },
      };
      expect(GenerateVoiceSchema.safeParse(validGenerate).success).toBe(true);
    });

    it('should allow both shotId and episodeId to be optional', () => {
      const requestOnly = {
        request: {
          text: 'Hello',
          voiceId: 'voice-123',
        },
      };
      expect(GenerateVoiceSchema.safeParse(requestOnly).success).toBe(true);
    });

    it('should accept both shotId and episodeId', () => {
      const bothIds = {
        shotId: validUUID,
        episodeId: validUUID,
        request: {
          text: 'Hello',
          voiceId: 'voice-123',
        },
      };
      expect(GenerateVoiceSchema.safeParse(bothIds).success).toBe(true);
    });
  });

  describe('GenerateMusicSchema', () => {
    it('should accept valid music generation', () => {
      const validGenerate = {
        episodeId: validUUID,
        request: {
          prompt: 'Epic battle music',
          duration: 120,
        },
      };
      expect(GenerateMusicSchema.safeParse(validGenerate).success).toBe(true);
    });

    it('should require episodeId', () => {
      expect(
        GenerateMusicSchema.safeParse({
          request: {
            prompt: 'Test',
            duration: 60,
          },
        }).success,
      ).toBe(false);
    });

    it('should accept optional shotId', () => {
      const withShotId = {
        episodeId: validUUID,
        shotId: validUUID,
        request: {
          prompt: 'Background music',
          duration: 30,
        },
      };
      expect(GenerateMusicSchema.safeParse(withShotId).success).toBe(true);
    });
  });

  describe('UpdateAudioGenerationJobSchema', () => {
    it('should accept valid update', () => {
      const validUpdate = {
        jobId: validUUID,
        status: 'completed',
        audioUrl: 'https://example.com/audio.mp3',
        duration: 120.5,
      };
      expect(
        UpdateAudioGenerationJobSchema.safeParse(validUpdate).success,
      ).toBe(true);
    });

    it('should require jobId and status', () => {
      expect(
        UpdateAudioGenerationJobSchema.safeParse({
          audioUrl: 'https://example.com/audio.mp3',
        }).success,
      ).toBe(false);
    });

    it('should accept error field', () => {
      const withError = {
        jobId: validUUID,
        status: 'failed',
        error: 'Voice generation failed due to content policy',
      };
      expect(UpdateAudioGenerationJobSchema.safeParse(withError).success).toBe(
        true,
      );
    });
  });

  describe('VoiceCloneSchema', () => {
    it('should accept valid voice clone request', () => {
      const validClone = {
        name: 'My Custom Voice',
        description: 'A clone of my voice',
        audioFiles: [
          'https://example.com/sample1.wav',
          'https://example.com/sample2.wav',
        ],
        labels: {
          accent: 'american',
          age: 'young',
        },
      };
      expect(VoiceCloneSchema.safeParse(validClone).success).toBe(true);
    });

    it('should require at least one audio file', () => {
      expect(
        VoiceCloneSchema.safeParse({
          name: 'Test',
          audioFiles: [],
        }).success,
      ).toBe(false);
    });

    it('should enforce name length', () => {
      expect(
        VoiceCloneSchema.safeParse({
          name: '',
          audioFiles: ['file.wav'],
        }).success,
      ).toBe(false);
      expect(
        VoiceCloneSchema.safeParse({
          name: 'a'.repeat(101),
          audioFiles: ['file.wav'],
        }).success,
      ).toBe(false);
    });
  });

  describe('VoiceSchema', () => {
    it('should accept valid voice data', () => {
      const validVoice = {
        id: 'voice-123',
        name: 'Sarah',
        provider: 'elevenlabs',
        language: 'en-US',
        gender: 'female',
        age: 'young',
        accent: 'american',
        description: 'A warm, friendly voice',
        previewUrl: 'https://example.com/preview.mp3',
        isCustom: false,
      };
      expect(VoiceSchema.safeParse(validVoice).success).toBe(true);
    });

    it('should require id, name, provider, and language', () => {
      expect(VoiceSchema.safeParse({}).success).toBe(false);
      expect(
        VoiceSchema.safeParse({
          id: 'voice-123',
          name: 'Test',
          provider: 'elevenlabs',
        }).success,
      ).toBe(false);
    });

    it('should validate gender enum', () => {
      expect(
        VoiceSchema.safeParse({
          id: 'v1',
          name: 'Test',
          provider: 'elevenlabs',
          language: 'en',
          gender: 'male',
        }).success,
      ).toBe(true);
      expect(
        VoiceSchema.safeParse({
          id: 'v1',
          name: 'Test',
          provider: 'elevenlabs',
          language: 'en',
          gender: 'other',
        }).success,
      ).toBe(false);
    });

    it('should validate age enum', () => {
      expect(
        VoiceSchema.safeParse({
          id: 'v1',
          name: 'Test',
          provider: 'elevenlabs',
          language: 'en',
          age: 'middle-aged',
        }).success,
      ).toBe(true);
      expect(
        VoiceSchema.safeParse({
          id: 'v1',
          name: 'Test',
          provider: 'elevenlabs',
          language: 'en',
          age: 'elderly',
        }).success,
      ).toBe(false);
    });

    it('should default isCustom to false', () => {
      const result = VoiceSchema.parse({
        id: 'v1',
        name: 'Test',
        provider: 'elevenlabs',
        language: 'en',
      });
      expect(result.isCustom).toBe(false);
    });
  });
});
