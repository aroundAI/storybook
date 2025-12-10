import { describe, expect, it } from 'vitest';

import {
  ApiKeyProviders,
  DeleteApiKeySchema,
  GetApiKeysSchema,
  SaveApiKeySchema,
  ValidateApiKeySchema,
} from '../src/schemas/api-keys.schema';

describe('API Keys Schemas', () => {
  describe('ApiKeyProviders', () => {
    it('should contain all expected providers', () => {
      const expectedProviders = [
        'kling',
        'runway',
        'hailuo',
        'elevenlabs',
        'playht',
        'suno',
        'claude',
        'openai',
        'gemini',
      ];

      expect(ApiKeyProviders).toEqual(expectedProviders);
    });

    it('should have 9 providers', () => {
      expect(ApiKeyProviders).toHaveLength(9);
    });
  });

  describe('GetApiKeysSchema', () => {
    it('should accept valid accountSlug', () => {
      const result = GetApiKeysSchema.safeParse({ accountSlug: 'my-team' });

      expect(result.success).toBe(true);
    });

    it('should reject empty accountSlug', () => {
      const result = GetApiKeysSchema.safeParse({ accountSlug: '' });

      expect(result.success).toBe(false);
    });

    it('should reject missing accountSlug', () => {
      const result = GetApiKeysSchema.safeParse({});

      expect(result.success).toBe(false);
    });
  });

  describe('SaveApiKeySchema', () => {
    it('should accept valid input', () => {
      const result = SaveApiKeySchema.safeParse({
        accountSlug: 'my-team',
        provider: 'openai',
        apiKey: 'sk-1234567890',
      });

      expect(result.success).toBe(true);
    });

    it('should reject API key shorter than 10 characters', () => {
      const result = SaveApiKeySchema.safeParse({
        accountSlug: 'my-team',
        provider: 'openai',
        apiKey: 'short',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          'API key must be at least 10 characters',
        );
      }
    });

    it('should reject invalid provider', () => {
      const result = SaveApiKeySchema.safeParse({
        accountSlug: 'my-team',
        provider: 'invalid-provider',
        apiKey: 'sk-1234567890',
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty accountSlug', () => {
      const result = SaveApiKeySchema.safeParse({
        accountSlug: '',
        provider: 'openai',
        apiKey: 'sk-1234567890',
      });

      expect(result.success).toBe(false);
    });

    it('should accept all valid providers', () => {
      for (const provider of ApiKeyProviders) {
        const result = SaveApiKeySchema.safeParse({
          accountSlug: 'my-team',
          provider,
          apiKey: 'sk-1234567890',
        });

        expect(result.success).toBe(true);
      }
    });
  });

  describe('DeleteApiKeySchema', () => {
    it('should accept valid input', () => {
      const result = DeleteApiKeySchema.safeParse({
        accountSlug: 'my-team',
        provider: 'elevenlabs',
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid provider', () => {
      const result = DeleteApiKeySchema.safeParse({
        accountSlug: 'my-team',
        provider: 'unknown-provider',
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty accountSlug', () => {
      const result = DeleteApiKeySchema.safeParse({
        accountSlug: '',
        provider: 'elevenlabs',
      });

      expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
      const result1 = DeleteApiKeySchema.safeParse({ accountSlug: 'my-team' });
      const result2 = DeleteApiKeySchema.safeParse({ provider: 'elevenlabs' });

      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });
  });

  describe('ValidateApiKeySchema', () => {
    it('should accept valid input', () => {
      const result = ValidateApiKeySchema.safeParse({
        provider: 'claude',
        apiKey: 'sk-ant-test-key',
      });

      expect(result.success).toBe(true);
    });

    it('should reject empty API key', () => {
      const result = ValidateApiKeySchema.safeParse({
        provider: 'claude',
        apiKey: '',
      });

      expect(result.success).toBe(false);
    });

    it('should reject invalid provider', () => {
      const result = ValidateApiKeySchema.safeParse({
        provider: 'not-a-provider',
        apiKey: 'some-key',
      });

      expect(result.success).toBe(false);
    });

    it('should accept short API keys for validation (unlike save)', () => {
      // ValidateApiKeySchema requires min 1 char, not 10 like SaveApiKeySchema
      const result = ValidateApiKeySchema.safeParse({
        provider: 'openai',
        apiKey: 'x',
      });

      expect(result.success).toBe(true);
    });
  });
});

describe('Schema Type Safety', () => {
  it('should infer correct types from GetApiKeysSchema', () => {
    const validData = { accountSlug: 'test' };
    const result = GetApiKeysSchema.parse(validData);

    // Type check: result should have accountSlug property
    expect(typeof result.accountSlug).toBe('string');
  });

  it('should infer correct types from SaveApiKeySchema', () => {
    const validData = {
      accountSlug: 'test',
      provider: 'openai' as const,
      apiKey: 'sk-1234567890',
    };
    const result = SaveApiKeySchema.parse(validData);

    expect(typeof result.accountSlug).toBe('string');
    expect(typeof result.provider).toBe('string');
    expect(typeof result.apiKey).toBe('string');
  });
});
