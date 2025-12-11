import { describe, expect, it } from 'vitest';

import {
  CheckCloneStatusSchema,
  CloneStatusSchema,
  DeleteVoiceCloneSchema,
  StartVoiceCloneSchema,
  VoiceCloneConsentSchema,
} from '../src/lib/schemas';

describe('Voice Cloning Schemas', () => {
  describe('CloneStatusSchema', () => {
    it('should accept all valid clone statuses', () => {
      const statuses = ['pending', 'training', 'ready', 'failed'];

      statuses.forEach((status) => {
        expect(CloneStatusSchema.safeParse(status).success).toBe(true);
      });
    });

    it('should reject invalid statuses', () => {
      expect(CloneStatusSchema.safeParse('processing').success).toBe(false);
      expect(CloneStatusSchema.safeParse('').success).toBe(false);
      expect(CloneStatusSchema.safeParse(null).success).toBe(false);
    });
  });

  describe('VoiceCloneConsentSchema', () => {
    const validConsent = {
      consenterName: 'John Doe',
      consenterEmail: 'john@example.com',
      consentType: 'self' as const,
      consentText:
        'I hereby confirm that I am the owner of the voice used in the audio samples and I agree to the terms.',
      consentSignature: 'John Doe',
    };

    it('should accept valid consent with all fields', () => {
      const result = VoiceCloneConsentSchema.safeParse(validConsent);
      expect(result.success).toBe(true);
    });

    it('should accept consent with optional fields omitted', () => {
      const result = VoiceCloneConsentSchema.safeParse({
        consenterName: 'John Doe',
        consentType: 'self',
        consentText:
          'I hereby confirm that I am the owner of the voice used in the audio samples.',
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty email string', () => {
      const result = VoiceCloneConsentSchema.safeParse({
        ...validConsent,
        consenterEmail: '',
      });
      expect(result.success).toBe(true);
    });

    it('should accept other_authorized consent type', () => {
      const result = VoiceCloneConsentSchema.safeParse({
        ...validConsent,
        consentType: 'other_authorized',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty consenter name', () => {
      const result = VoiceCloneConsentSchema.safeParse({
        ...validConsent,
        consenterName: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid email', () => {
      const result = VoiceCloneConsentSchema.safeParse({
        ...validConsent,
        consenterEmail: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid consent type', () => {
      const result = VoiceCloneConsentSchema.safeParse({
        ...validConsent,
        consentType: 'third_party',
      });
      expect(result.success).toBe(false);
    });

    it('should reject consent text under 50 characters', () => {
      const result = VoiceCloneConsentSchema.safeParse({
        ...validConsent,
        consentText: 'Too short',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('StartVoiceCloneSchema', () => {
    const validInput = {
      assetId: '123e4567-e89b-12d3-a456-426614174000',
      voiceName: 'My Custom Voice',
      description: 'A voice for my character',
      samples: [
        'https://storage.example.com/sample1.mp3',
        'https://storage.example.com/sample2.mp3',
      ],
      consent: {
        consenterName: 'John Doe',
        consentType: 'self' as const,
        consentText:
          'I hereby confirm that I am the owner of the voice used in the audio samples.',
      },
    };

    it('should accept valid input', () => {
      const result = StartVoiceCloneSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should accept input without optional description', () => {
      const { description: _desc, ...inputWithoutDesc } = validInput;
      const result = StartVoiceCloneSchema.safeParse(inputWithoutDesc);
      expect(result.success).toBe(true);
    });

    it('should reject invalid assetId', () => {
      const result = StartVoiceCloneSchema.safeParse({
        ...validInput,
        assetId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty voice name', () => {
      const result = StartVoiceCloneSchema.safeParse({
        ...validInput,
        voiceName: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject voice name exceeding 100 characters', () => {
      const result = StartVoiceCloneSchema.safeParse({
        ...validInput,
        voiceName: 'a'.repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty samples array', () => {
      const result = StartVoiceCloneSchema.safeParse({
        ...validInput,
        samples: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject more than 25 samples', () => {
      const samples = Array(26)
        .fill(null)
        .map((_, i) => `https://storage.example.com/sample${i}.mp3`);
      const result = StartVoiceCloneSchema.safeParse({
        ...validInput,
        samples,
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid sample URLs', () => {
      const result = StartVoiceCloneSchema.safeParse({
        ...validInput,
        samples: ['not-a-url', 'also-not-a-url'],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid consent object', () => {
      const result = StartVoiceCloneSchema.safeParse({
        ...validInput,
        consent: { consenterName: '' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('DeleteVoiceCloneSchema', () => {
    it('should accept valid assetId', () => {
      const result = DeleteVoiceCloneSchema.safeParse({
        assetId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid assetId', () => {
      const result = DeleteVoiceCloneSchema.safeParse({
        assetId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing assetId', () => {
      const result = DeleteVoiceCloneSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('CheckCloneStatusSchema', () => {
    it('should accept valid assetId', () => {
      const result = CheckCloneStatusSchema.safeParse({
        assetId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid assetId', () => {
      const result = CheckCloneStatusSchema.safeParse({
        assetId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });
  });
});
