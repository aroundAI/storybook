import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RunwayGenerationRequestSchema } from '../src/lib/runway-schemas';
import { RunwayProviderError } from '../src/lib/runway-types';

// Mock server-only
vi.mock('server-only', () => ({}));

// Mock the cache client
vi.mock('@kit/cache', () => ({
  createCacheClient: vi.fn(() => ({
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  })),
}));

// Mock the logger
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  ),
}));

describe('RunwayProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('RunwayGenerationRequestSchema', () => {
    it('should validate a valid text-to-video request', () => {
      const request = {
        prompt: 'A cat playing piano in a concert hall',
        duration: 10,
        aspectRatio: '16:9',
        model: 'gen3_turbo',
      };

      const result = RunwayGenerationRequestSchema.parse(request);

      expect(result.prompt).toBe(request.prompt);
      expect(result.duration).toBe(10);
      expect(result.aspectRatio).toBe('16:9');
      expect(result.model).toBe('gen3_turbo');
      expect(result.motionStrength).toBe(0.5); // default
    });

    it('should validate an image-to-video request', () => {
      const request = {
        prompt: 'Make this image come alive',
        duration: 5,
        aspectRatio: '9:16',
        model: 'gen3_alpha',
        referenceImageUrl: 'https://example.com/image.jpg',
        motionStrength: 0.8,
      };

      const result = RunwayGenerationRequestSchema.parse(request);

      expect(result.referenceImageUrl).toBe(request.referenceImageUrl);
      expect(result.motionStrength).toBe(0.8);
      expect(result.model).toBe('gen3_alpha');
    });

    it('should reject empty prompts', () => {
      const request = {
        prompt: '',
        duration: 10,
        aspectRatio: '16:9',
      };

      expect(() => RunwayGenerationRequestSchema.parse(request)).toThrow();
    });

    it('should reject prompts over 1000 characters', () => {
      const request = {
        prompt: 'a'.repeat(1001),
        duration: 10,
        aspectRatio: '16:9',
      };

      expect(() => RunwayGenerationRequestSchema.parse(request)).toThrow();
    });

    it('should reject invalid durations', () => {
      const request = {
        prompt: 'A test video',
        duration: 15,
        aspectRatio: '16:9',
      };

      expect(() => RunwayGenerationRequestSchema.parse(request)).toThrow();
    });

    it('should reject invalid aspect ratios', () => {
      const request = {
        prompt: 'A test video',
        duration: 10,
        aspectRatio: '4:3',
      };

      expect(() => RunwayGenerationRequestSchema.parse(request)).toThrow();
    });

    it('should accept 18 second duration', () => {
      const request = {
        prompt: 'A long video',
        duration: 18,
        aspectRatio: '16:9',
      };

      const result = RunwayGenerationRequestSchema.parse(request);
      expect(result.duration).toBe(18);
    });

    it('should accept 4:5 aspect ratio', () => {
      const request = {
        prompt: 'Instagram style video',
        duration: 10,
        aspectRatio: '4:5',
      };

      const result = RunwayGenerationRequestSchema.parse(request);
      expect(result.aspectRatio).toBe('4:5');
    });

    it('should reject motion strength out of range', () => {
      const request = {
        prompt: 'A test video',
        duration: 10,
        aspectRatio: '16:9',
        motionStrength: 1.5,
      };

      expect(() => RunwayGenerationRequestSchema.parse(request)).toThrow();
    });

    it('should reject negative motion strength', () => {
      const request = {
        prompt: 'A test video',
        duration: 10,
        aspectRatio: '16:9',
        motionStrength: -0.1,
      };

      expect(() => RunwayGenerationRequestSchema.parse(request)).toThrow();
    });

    it('should use default values', () => {
      const request = {
        prompt: 'A minimal request',
      };

      const result = RunwayGenerationRequestSchema.parse(request);

      expect(result.duration).toBe(10); // default
      expect(result.aspectRatio).toBe('16:9'); // default
      expect(result.model).toBe('gen3_turbo'); // default
      expect(result.motionStrength).toBe(0.5); // default
    });
  });

  describe('RunwayProviderError', () => {
    it('should create error with code', () => {
      const error = new RunwayProviderError('Test error', 'AUTH_ERROR');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.retryable).toBe(false);
      expect(error.retryAfter).toBeUndefined();
    });

    it('should create retryable error with retryAfter', () => {
      const error = new RunwayProviderError('Rate limited', 'RATE_LIMITED', {
        retryable: true,
        retryAfter: 60,
      });

      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retryable).toBe(true);
      expect(error.retryAfter).toBe(60);
    });

    it('should be an instance of Error', () => {
      const error = new RunwayProviderError('Test', 'PROVIDER_ERROR');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('RunwayProviderError');
    });
  });

  describe('RunwayProvider class', () => {
    it('should be instantiable with config', async () => {
      const { RunwayProvider } = await import('../src/providers/runway');

      const provider = new RunwayProvider({
        apiKey: 'test-api-key',
      });

      expect(provider.name).toBe('runway');
      expect(provider.capabilities.maxDuration).toBe(18);
      expect(provider.capabilities.supportsImageToVideo).toBe(true);
      expect(provider.capabilities.supportsNegativePrompt).toBe(false);
    });

    it('should have correct capabilities', async () => {
      const { RunwayProvider } = await import('../src/providers/runway');

      const provider = new RunwayProvider({
        apiKey: 'test-api-key',
      });

      expect(provider.capabilities.supportedAspectRatios).toContain('16:9');
      expect(provider.capabilities.supportedAspectRatios).toContain('9:16');
      expect(provider.capabilities.supportedAspectRatios).toContain('1:1');
      expect(provider.capabilities.supportedAspectRatios).toContain('4:5');
    });

    describe('generateVideo', () => {
      it('should submit text-to-video request', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'runway-task-123',
                status: 'PENDING',
                createdAt: '2024-01-01T00:00:00Z',
              }),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const result = await provider.generateVideo({
          prompt: 'A cat playing piano',
          duration: 10,
          aspectRatio: '16:9',
        });

        expect(result.jobId).toBe('runway-task-123');
        expect(result.status).toBe('pending');
        expect(result.estimatedTime).toBe(60); // gen3_turbo 10s

        global.fetch = originalFetch;
      });

      it('should include webhook URL in request', async () => {
        let capturedBody: unknown;
        const originalFetch = global.fetch;
        global.fetch = vi.fn((url, options) => {
          capturedBody = JSON.parse((options as RequestInit).body as string);
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'runway-task-123',
                status: 'PENDING',
                createdAt: '2024-01-01T00:00:00Z',
              }),
          });
        }) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
          webhookSecret: 'https://example.com/webhook',
        });

        await provider.generateVideo({
          prompt: 'Test video',
          duration: 5,
          aspectRatio: '16:9',
        });

        expect((capturedBody as Record<string, unknown>).callback_url).toBe(
          'https://example.com/webhook',
        );

        global.fetch = originalFetch;
      });

      it('should reject negative prompt (not supported)', async () => {
        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        await expect(
          provider.generateVideo({
            prompt: 'A test video',
            negativePrompt: 'blurry, low quality',
            duration: 10,
            aspectRatio: '16:9',
          }),
        ).rejects.toThrow('does not support negative prompts');
      });
    });

    describe('getStatus', () => {
      it('should return completed status with video URL', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'runway-task-123',
                status: 'SUCCEEDED',
                progress: 100,
                output: [
                  { url: 'https://example.com/video.mp4', duration: 10 },
                ],
              }),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const status = await provider.getStatus('runway-task-123');

        expect(status.status).toBe('completed');
        expect(status.videoUrl).toBe('https://example.com/video.mp4');
        expect(status.progress).toBe(100);

        global.fetch = originalFetch;
      });

      it('should return processing status', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'runway-task-123',
                status: 'RUNNING',
                progress: 45,
              }),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const status = await provider.getStatus('runway-task-123');

        expect(status.status).toBe('processing');
        expect(status.progress).toBe(45);
        expect(status.videoUrl).toBeUndefined();

        global.fetch = originalFetch;
      });

      it('should return failed status with error', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'runway-task-123',
                status: 'FAILED',
                failure: 'Content policy violation',
                failureCode: 'CONTENT_MODERATION',
              }),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const status = await provider.getStatus('runway-task-123');

        expect(status.status).toBe('failed');
        expect(status.error).toBe('Content policy violation');

        global.fetch = originalFetch;
      });

      it('should map CANCELLED status correctly', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'runway-task-123',
                status: 'CANCELLED',
              }),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const status = await provider.getStatus('runway-task-123');

        expect(status.status).toBe('cancelled');

        global.fetch = originalFetch;
      });
    });

    describe('cancelJob', () => {
      it('should call DELETE endpoint', async () => {
        let capturedMethod: string | undefined;
        let capturedUrl: string | undefined;
        const originalFetch = global.fetch;
        global.fetch = vi.fn((url, options) => {
          capturedUrl = url as string;
          capturedMethod = (options as RequestInit).method;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
          });
        }) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        await provider.cancelJob('runway-task-123');

        expect(capturedMethod).toBe('DELETE');
        expect(capturedUrl).toContain('/tasks/runway-task-123');

        global.fetch = originalFetch;
      });
    });

    describe('estimateCost', () => {
      it('should return correct cost for gen3_turbo 5s', async () => {
        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const estimate = provider.estimateCost({
          prompt: 'Test',
          duration: 5,
          aspectRatio: '16:9',
          model: 'gen3_turbo',
        });

        expect(estimate.costCents).toBe(50);
        expect(estimate.breakdown.model).toBe('gen3_turbo');
        expect(estimate.breakdown.duration).toBe(5);
      });

      it('should return correct cost for gen3_turbo 10s', async () => {
        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const estimate = provider.estimateCost({
          prompt: 'Test',
          duration: 10,
          aspectRatio: '16:9',
          model: 'gen3_turbo',
        });

        expect(estimate.costCents).toBe(100);
      });

      it('should return correct cost for gen3_turbo 18s', async () => {
        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const estimate = provider.estimateCost({
          prompt: 'Test',
          duration: 18,
          aspectRatio: '16:9',
          model: 'gen3_turbo',
        });

        expect(estimate.costCents).toBe(180);
      });

      it('should return correct cost for gen3_alpha 5s', async () => {
        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const estimate = provider.estimateCost({
          prompt: 'Test',
          duration: 5,
          aspectRatio: '16:9',
          model: 'gen3_alpha',
        });

        expect(estimate.costCents).toBe(100);
      });

      it('should return correct cost for gen3_alpha 10s', async () => {
        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const estimate = provider.estimateCost({
          prompt: 'Test',
          duration: 10,
          aspectRatio: '16:9',
          model: 'gen3_alpha',
        });

        expect(estimate.costCents).toBe(200);
      });

      it('should return correct cost for gen3_alpha 18s', async () => {
        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const estimate = provider.estimateCost({
          prompt: 'Test',
          duration: 18,
          aspectRatio: '16:9',
          model: 'gen3_alpha',
        });

        expect(estimate.costCents).toBe(360);
      });

      it('should default to gen3_turbo when no model specified', async () => {
        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        const estimate = provider.estimateCost({
          prompt: 'Test',
          duration: 10,
          aspectRatio: '16:9',
        });

        expect(estimate.costCents).toBe(100); // gen3_turbo 10s
        expect(estimate.breakdown.model).toBe('gen3_turbo');
      });
    });

    describe('error handling', () => {
      it('should throw RATE_LIMITED error on 429', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 429,
            json: () => Promise.resolve({ message: 'Too many requests' }),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        try {
          await provider.generateVideo({
            prompt: 'Test',
            duration: 10,
            aspectRatio: '16:9',
          });
          expect.fail('Expected error to be thrown');
        } catch (error) {
          const err = error as {
            name: string;
            code: string;
            retryable: boolean;
          };
          expect(err.name).toBe('RunwayProviderError');
          expect(err.code).toBe('RATE_LIMITED');
          expect(err.retryable).toBe(true);
        }

        global.fetch = originalFetch;
      });

      it('should throw CREDIT_ERROR on 402', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 402,
            json: () => Promise.resolve({ message: 'Insufficient credits' }),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        try {
          await provider.generateVideo({
            prompt: 'Test',
            duration: 10,
            aspectRatio: '16:9',
          });
        } catch (error) {
          expect((error as RunwayProviderError).code).toBe('CREDIT_ERROR');
          expect((error as RunwayProviderError).retryable).toBe(false);
        }

        global.fetch = originalFetch;
      });

      it('should throw AUTH_ERROR on 401', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ message: 'Unauthorized' }),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'invalid-key',
        });

        try {
          await provider.generateVideo({
            prompt: 'Test',
            duration: 10,
            aspectRatio: '16:9',
          });
        } catch (error) {
          expect((error as RunwayProviderError).code).toBe('AUTH_ERROR');
        }

        global.fetch = originalFetch;
      });

      it('should throw AUTH_ERROR on 403', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ message: 'Forbidden' }),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'invalid-key',
        });

        try {
          await provider.generateVideo({
            prompt: 'Test',
            duration: 10,
            aspectRatio: '16:9',
          });
        } catch (error) {
          expect((error as RunwayProviderError).code).toBe('AUTH_ERROR');
        }

        global.fetch = originalFetch;
      });

      it('should throw PROVIDER_ERROR on 500 with retryable', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.resolve({}),
          }),
        ) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        try {
          await provider.generateVideo({
            prompt: 'Test',
            duration: 10,
            aspectRatio: '16:9',
          });
        } catch (error) {
          expect((error as RunwayProviderError).code).toBe('PROVIDER_ERROR');
          expect((error as RunwayProviderError).retryable).toBe(true);
        }

        global.fetch = originalFetch;
      });
    });

    describe('request headers', () => {
      it('should include Authorization header', async () => {
        let capturedHeaders: Record<string, string> | undefined;
        const originalFetch = global.fetch;
        global.fetch = vi.fn((url, options) => {
          capturedHeaders = (options as RequestInit).headers as Record<
            string,
            string
          >;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'runway-task-123',
                status: 'PENDING',
              }),
          });
        }) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'my-api-key-123',
        });

        await provider.generateVideo({
          prompt: 'Test',
          duration: 10,
          aspectRatio: '16:9',
        });

        expect(capturedHeaders?.['Authorization']).toBe(
          'Bearer my-api-key-123',
        );

        global.fetch = originalFetch;
      });

      it('should include X-Runway-Version header', async () => {
        let capturedHeaders: Record<string, string> | undefined;
        const originalFetch = global.fetch;
        global.fetch = vi.fn((url, options) => {
          capturedHeaders = (options as RequestInit).headers as Record<
            string,
            string
          >;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 'runway-task-123',
                status: 'PENDING',
              }),
          });
        }) as unknown as typeof fetch;

        const { RunwayProvider } = await import('../src/providers/runway');

        const provider = new RunwayProvider({
          apiKey: 'test-api-key',
        });

        await provider.generateVideo({
          prompt: 'Test',
          duration: 10,
          aspectRatio: '16:9',
        });

        expect(capturedHeaders?.['X-Runway-Version']).toBe('2024-11-06');

        global.fetch = originalFetch;
      });
    });
  });
});
