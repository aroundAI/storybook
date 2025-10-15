/**
 * Parameter Store Unit Tests
 *
 * Tests for secure secret management utility
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearParameterCache,
  getDatabaseCredentials,
  getParameter,
  getParameterWithFallback,
  getParameters,
  invalidateParameterCache,
} from '../parameter-store';

// Mock AWS SDK
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn(() => ({
    send: vi.fn(),
  })),
  GetParameterCommand: vi.fn(),
  GetParametersCommand: vi.fn(),
}));

describe('Parameter Store - Input Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearParameterCache();
  });

  describe('getParameter validation', () => {
    it('should reject parameter names not starting with /', async () => {
      await expect(getParameter('invalid-name')).rejects.toThrow(
        'must start with "/"',
      );
    });

    it('should reject parameter names with path traversal (../)', async () => {
      await expect(
        getParameter('/production/../staging/password'),
      ).rejects.toThrow('path traversal detected');
    });

    it('should reject parameter names with path traversal (./)', async () => {
      await expect(getParameter('/production/./password')).rejects.toThrow(
        'path traversal detected',
      );
    });

    it('should reject parameter names exceeding 2048 characters', async () => {
      const longName = '/' + 'a'.repeat(2048);
      await expect(getParameter(longName)).rejects.toThrow(
        'exceeds maximum length',
      );
    });

    it('should reject parameter names with invalid characters', async () => {
      await expect(getParameter('/production/db/pass{word}')).rejects.toThrow(
        'invalid characters',
      );
    });

    it('should accept valid parameter names', async () => {
      const { SSMClient } = await import('@aws-sdk/client-ssm');
      const mockSend = vi.fn().mockResolvedValue({
        Parameter: { Value: 'test-value' },
      });

      const mockClient = new SSMClient({});
      vi.mocked(mockClient.send).mockImplementation(mockSend);

      // Valid names should not throw validation errors
      const validNames = [
        '/production/db/password',
        '/staging/api-key',
        '/dev/stripe/secret-key',
        '/test_env/value.with.dots',
        '/path-with-dashes/value',
      ];

      for (const name of validNames) {
        // Will throw on actual AWS call (not mocked properly), but should pass validation
        try {
          await getParameter(name);
        } catch (error) {
          // Only validation errors should fail the test
          expect(error).not.toMatch(/Invalid parameter name/);
        }
      }
    });
  });

  describe('getParameters validation', () => {
    it('should validate all parameter names', async () => {
      await expect(
        getParameters([
          '/production/valid',
          'invalid-name',
          '/staging/also-valid',
        ]),
      ).rejects.toThrow('must start with "/"');
    });

    it('should reject if any parameter has path traversal', async () => {
      await expect(
        getParameters([
          '/production/password',
          '/staging/../production/secret',
        ]),
      ).rejects.toThrow('path traversal detected');
    });
  });
});

describe('Parameter Store - Caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearParameterCache();
    delete process.env.PARAMETER_CACHE_TTL_MS;
  });

  it('should cache parameter values', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi.fn().mockResolvedValue({
      Parameter: { Value: 'cached-value' },
    });

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    // First call - should hit AWS
    await getParameter('/test/param');

    // Second call - should use cache
    await getParameter('/test/param');

    // AWS should only be called once
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should skip cache when skipCache=true', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi.fn().mockResolvedValue({
      Parameter: { Value: 'fresh-value' },
    });

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    // First call with cache
    await getParameter('/test/param');

    // Second call without cache
    await getParameter('/test/param', { skipCache: true });

    // AWS should be called twice
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('should respect custom cache TTL from environment', async () => {
    // Set short cache TTL for testing
    process.env.PARAMETER_CACHE_TTL_MS = '100';

    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi.fn().mockResolvedValue({
      Parameter: { Value: 'test-value' },
    });

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    // First call
    await getParameter('/test/param');

    // Wait for cache to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Second call should hit AWS again
    await getParameter('/test/param');

    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe('Parameter Store - Cache Invalidation', () => {
  beforeEach(() => {
    clearParameterCache();
  });

  it('should invalidate single parameter', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi.fn().mockResolvedValue({
      Parameter: { Value: 'test-value' },
    });

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    // Cache the parameter
    await getParameter('/test/param');

    // Invalidate it
    invalidateParameterCache('/test/param');

    // Next call should hit AWS
    await getParameter('/test/param');

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('should invalidate multiple parameters', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi.fn().mockResolvedValue({
      Parameter: { Value: 'test-value' },
    });

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    // Cache multiple parameters
    await getParameter('/test/param1');
    await getParameter('/test/param2');

    // Invalidate both
    invalidateParameterCache(['/test/param1', '/test/param2']);

    // Next calls should hit AWS
    await getParameter('/test/param1');
    await getParameter('/test/param2');

    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('should clear all cached parameters', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi.fn().mockResolvedValue({
      Parameter: { Value: 'test-value' },
    });

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    // Cache multiple parameters
    await getParameter('/test/param1');
    await getParameter('/test/param2');
    await getParameter('/test/param3');

    // Clear all cache
    clearParameterCache();

    // Next calls should hit AWS
    await getParameter('/test/param1');
    await getParameter('/test/param2');
    await getParameter('/test/param3');

    expect(mockSend).toHaveBeenCalledTimes(6);
  });
});

describe('Parameter Store - Fallback', () => {
  beforeEach(() => {
    clearParameterCache();
    delete process.env.TEST_SECRET;
  });

  it('should use Parameter Store value when available', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi.fn().mockResolvedValue({
      Parameter: { Value: 'param-store-value' },
    });

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    process.env.TEST_SECRET = 'env-var-value';

    const value = await getParameterWithFallback('/test/secret', 'TEST_SECRET');

    expect(value).toBe('param-store-value');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should fall back to environment variable when Parameter Store fails', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi
      .fn()
      .mockRejectedValue(new Error('Parameter not found'));

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    process.env.TEST_SECRET = 'env-var-value';

    const value = await getParameterWithFallback('/test/secret', 'TEST_SECRET');

    expect(value).toBe('env-var-value');
  });

  it('should throw error when both Parameter Store and env var are missing', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi
      .fn()
      .mockRejectedValue(new Error('Parameter not found'));

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    // No env var set

    await expect(
      getParameterWithFallback('/test/secret', 'MISSING_VAR'),
    ).rejects.toThrow('Neither Parameter Store parameter');
  });

  it('should capture env var atomically to prevent race condition', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi
      .fn()
      .mockRejectedValue(new Error('Parameter not found'));

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    // Set env var
    process.env.TEST_SECRET = 'initial-value';

    // Start fetching
    const promise = getParameterWithFallback('/test/secret', 'TEST_SECRET');

    // Delete env var while fetch is in progress (simulates race condition)
    delete process.env.TEST_SECRET;

    // Should still get the initial value (captured atomically)
    const value = await promise;
    expect(value).toBe('initial-value');
  });
});

describe('Parameter Store - Helper Functions', () => {
  beforeEach(() => {
    clearParameterCache();
  });

  it('should fetch database credentials', async () => {
    const { SSMClient } = await import('@aws-sdk/client-ssm');
    const mockSend = vi.fn().mockResolvedValue({
      Parameters: [
        { Name: '/production/db/host', Value: 'db.example.com' },
        { Name: '/production/db/port', Value: '5432' },
        { Name: '/production/db/name', Value: 'mydb' },
        { Name: '/production/db/user', Value: 'dbuser' },
        { Name: '/production/db/password', Value: 'secret123' },
      ],
    });

    const mockClient = new SSMClient({});
    vi.mocked(mockClient.send).mockImplementation(mockSend);

    const creds = await getDatabaseCredentials('production');

    expect(creds).toEqual({
      host: 'db.example.com',
      port: 5432,
      database: 'mydb',
      user: 'dbuser',
      password: 'secret123',
    });
  });
});
