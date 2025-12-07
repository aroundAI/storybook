import { describe, expect, it } from 'vitest';

import type {
  ProviderCapabilities,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationStatus,
} from '../src/lib/types';
import { BaseVideoGenerationProvider } from '../src/providers/base';

// Test implementation to expose protected validateRequest method
class TestProvider extends BaseVideoGenerationProvider {
  readonly name: string = 'test';
  readonly capabilities: ProviderCapabilities = {
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    maxDuration: 10,
    supportsImageToVideo: false,
    supportsNegativePrompt: true,
  };

  async generateVideo(): Promise<VideoGenerationResponse> {
    throw new Error('Not implemented');
  }

  async getStatus(): Promise<VideoGenerationStatus> {
    throw new Error('Not implemented');
  }

  async cancelJob(): Promise<void> {
    throw new Error('Not implemented');
  }

  // Expose protected method for testing
  public testValidateRequest(request: VideoGenerationRequest): void {
    this.validateRequest(request);
  }
}

// Provider that doesn't support negative prompts
class NoNegativePromptProvider extends TestProvider {
  override readonly name = 'no-negative-provider';
  override readonly capabilities: ProviderCapabilities = {
    supportedAspectRatios: ['16:9'],
    maxDuration: 5,
    supportsImageToVideo: false,
    supportsNegativePrompt: false,
  };
}

describe('BaseVideoGenerationProvider', () => {
  const provider = new TestProvider();
  const noNegativeProvider = new NoNegativePromptProvider();

  const validRequest: VideoGenerationRequest = {
    prompt: 'A beautiful sunset',
    duration: 5,
    aspectRatio: '16:9',
  };

  describe('validateRequest', () => {
    it('should accept valid request', () => {
      expect(() => provider.testValidateRequest(validRequest)).not.toThrow();
    });

    it('should reject empty prompt', () => {
      expect(() =>
        provider.testValidateRequest({ ...validRequest, prompt: '' }),
      ).toThrow('Prompt is required');
    });

    it('should reject whitespace-only prompt', () => {
      expect(() =>
        provider.testValidateRequest({ ...validRequest, prompt: '   ' }),
      ).toThrow('Prompt is required');
    });

    it('should reject non-positive duration', () => {
      expect(() =>
        provider.testValidateRequest({ ...validRequest, duration: 0 }),
      ).toThrow('Duration must be positive');

      expect(() =>
        provider.testValidateRequest({ ...validRequest, duration: -5 }),
      ).toThrow('Duration must be positive');
    });

    it('should reject duration exceeding max', () => {
      expect(() =>
        provider.testValidateRequest({ ...validRequest, duration: 15 }),
      ).toThrow('Duration exceeds maximum of 10 seconds for test');
    });

    it('should accept duration at max', () => {
      expect(() =>
        provider.testValidateRequest({ ...validRequest, duration: 10 }),
      ).not.toThrow();
    });

    it('should reject unsupported aspect ratio', () => {
      expect(() =>
        provider.testValidateRequest({ ...validRequest, aspectRatio: '4:3' }),
      ).toThrow(
        'Aspect ratio 4:3 not supported by test. Supported: 16:9, 9:16, 1:1',
      );
    });

    it('should accept all supported aspect ratios', () => {
      ['16:9', '9:16', '1:1'].forEach((ratio) => {
        expect(() =>
          provider.testValidateRequest({ ...validRequest, aspectRatio: ratio }),
        ).not.toThrow();
      });
    });

    it('should accept negative prompt when supported', () => {
      expect(() =>
        provider.testValidateRequest({
          ...validRequest,
          negativePrompt: 'blurry, low quality',
        }),
      ).not.toThrow();
    });

    it('should reject negative prompt when not supported', () => {
      expect(() =>
        noNegativeProvider.testValidateRequest({
          ...validRequest,
          aspectRatio: '16:9',
          negativePrompt: 'blurry',
        }),
      ).toThrow('no-negative-provider does not support negative prompts');
    });

    it('should accept request without negative prompt on provider that does not support it', () => {
      expect(() =>
        noNegativeProvider.testValidateRequest({
          ...validRequest,
          aspectRatio: '16:9',
        }),
      ).not.toThrow();
    });
  });

  describe('Provider Interface', () => {
    it('should have required properties', () => {
      expect(provider.name).toBe('test');
      expect(provider.capabilities).toBeDefined();
      expect(provider.capabilities.supportedAspectRatios).toBeInstanceOf(Array);
      expect(typeof provider.capabilities.maxDuration).toBe('number');
      expect(typeof provider.capabilities.supportsImageToVideo).toBe('boolean');
      expect(typeof provider.capabilities.supportsNegativePrompt).toBe(
        'boolean',
      );
    });

    it('should have required methods', () => {
      expect(typeof provider.generateVideo).toBe('function');
      expect(typeof provider.getStatus).toBe('function');
      expect(typeof provider.cancelJob).toBe('function');
    });
  });
});
