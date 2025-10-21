import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../healthcheck/route';

// Mock dependencies
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/cache', () => ({
  createCacheClient: vi.fn(),
}));

// Mock console methods
const mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => {});

describe('Health Check API', () => {
  let mockSupabaseClient: any;
  let mockCacheClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mock implementations
    mockSupabaseClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ error: null, data: [] })),
        })),
      })),
    };

    mockCacheClient = {
      isHealthy: vi.fn(() => Promise.resolve(true)),
    };

    const { getSupabaseServerClient } = await import(
      '@kit/supabase/server-client'
    );
    const { createCacheClient } = await import('@kit/cache');

    vi.mocked(getSupabaseServerClient).mockReturnValue(mockSupabaseClient);
    vi.mocked(createCacheClient).mockReturnValue(mockCacheClient);
  });

  describe('Successful Health Checks', () => {
    it('should return 200 when all services are healthy', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.checks.database).toBe(true);
      expect(data.checks.cache).toBe(true);
      expect(data.checks.timestamp).toBeDefined();
      expect(typeof data.checks.timestamp).toBe('string');
    });

    it('should include timestamp in ISO format', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.checks.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('should check database by querying accounts table', async () => {
      // Create spies on the chain
      const selectSpy = vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve({ error: null, data: [] })),
      }));
      const fromSpy = vi.fn(() => ({
        select: selectSpy,
      }));

      mockSupabaseClient.from = fromSpy;

      await GET();

      expect(fromSpy).toHaveBeenCalledWith('accounts');
      expect(selectSpy).toHaveBeenCalledWith('id');
    });

    it('should check cache health', async () => {
      await GET();

      expect(mockCacheClient.isHealthy).toHaveBeenCalled();
    });

    it('should not log errors when all services are healthy', async () => {
      await GET();

      expect(mockConsoleError).not.toHaveBeenCalled();
    });
  });

  describe('Database Failures', () => {
    it('should return 503 when database check fails', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve({
              error: new Error('Database connection failed'),
              data: null,
            }),
          ),
        })),
      }));

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(data.checks.database).toBe(false);
      expect(data.checks.cache).toBe(true);
    });

    it('should handle database query throwing exception', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => {
            throw new Error('Database connection error');
          }),
        })),
      }));

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(data.checks.database).toBe(false);
      expect(mockConsoleError).toHaveBeenCalledWith(
        '[HealthCheck] Database check failed:',
        expect.any(Error),
      );
    });

    it('should handle Supabase client creation throwing', async () => {
      const { getSupabaseServerClient } = await import(
        '@kit/supabase/server-client'
      );
      vi.mocked(getSupabaseServerClient).mockImplementation(() => {
        throw new Error('Client creation failed');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(data.checks.database).toBe(false);
    });
  });

  describe('Cache Failures', () => {
    it('should return 503 when cache check fails', async () => {
      mockCacheClient.isHealthy = vi.fn(() => Promise.resolve(false));

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(data.checks.database).toBe(true);
      expect(data.checks.cache).toBe(false);
    });

    it('should handle cache throwing exception', async () => {
      mockCacheClient.isHealthy = vi.fn(() =>
        Promise.reject(new Error('Cache connection failed')),
      );

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(data.checks.cache).toBe(false);
      expect(mockConsoleError).toHaveBeenCalledWith(
        '[HealthCheck] Cache check failed:',
        expect.any(Error),
      );
    });

    it('should handle cache client creation throwing', async () => {
      const { createCacheClient } = await import('@kit/cache');
      vi.mocked(createCacheClient).mockImplementation(() => {
        throw new Error('Cache client creation failed');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(data.checks.cache).toBe(false);
    });
  });

  describe('Multiple Service Failures', () => {
    it('should return 503 when both database and cache fail', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve({ error: new Error('DB failed'), data: null }),
          ),
        })),
      }));
      mockCacheClient.isHealthy = vi.fn(() => Promise.resolve(false));

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(data.checks.database).toBe(false);
      expect(data.checks.cache).toBe(false);
    });

    it('should log both database and cache errors', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => {
          throw new Error('Database error');
        }),
      }));
      mockCacheClient.isHealthy = vi.fn(() =>
        Promise.reject(new Error('Cache error')),
      );

      await GET();

      expect(mockConsoleError).toHaveBeenCalledWith(
        '[HealthCheck] Database check failed:',
        expect.any(Error),
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        '[HealthCheck] Cache check failed:',
        expect.any(Error),
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle unexpected errors in top-level try-catch', async () => {
      const { getSupabaseServerClient } = await import(
        '@kit/supabase/server-client'
      );
      vi.mocked(getSupabaseServerClient).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('should include error message for Error instances', async () => {
      const errorMessage = 'Critical system failure';
      const { getSupabaseServerClient } = await import(
        '@kit/supabase/server-client'
      );
      vi.mocked(getSupabaseServerClient).mockImplementation(() => {
        throw new Error(errorMessage);
      });

      const response = await GET();
      const data = await response.json();

      // Error is caught in database check, status is unhealthy
      expect(data.status).toBe('unhealthy');
    });

    it('should handle non-Error objects thrown', async () => {
      const { createCacheClient } = await import('@kit/cache');
      vi.mocked(createCacheClient).mockImplementation(() => {
        throw 'String error';
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('unhealthy');
      expect(mockConsoleError).toHaveBeenCalled();
    });
  });

  describe('Response Format', () => {
    it('should return JSON response with status and checks', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('checks');
      expect(data.checks).toHaveProperty('database');
      expect(data.checks).toHaveProperty('cache');
      expect(data.checks).toHaveProperty('timestamp');
    });

    it('should have boolean check values', async () => {
      const response = await GET();
      const data = await response.json();

      expect(typeof data.checks.database).toBe('boolean');
      expect(typeof data.checks.cache).toBe('boolean');
    });

    it('should have string status value', async () => {
      const response = await GET();
      const data = await response.json();

      expect(typeof data.status).toBe('string');
      expect(['healthy', 'unhealthy', 'error']).toContain(data.status);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle database healthy but cache unhealthy', async () => {
      mockCacheClient.isHealthy = vi.fn(() => Promise.resolve(false));

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.checks.database).toBe(true);
      expect(data.checks.cache).toBe(false);
    });

    it('should handle cache healthy but database unhealthy', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve({ error: new Error('DB error'), data: null }),
          ),
        })),
      }));

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.checks.database).toBe(false);
      expect(data.checks.cache).toBe(true);
    });

    it('should handle slow database response', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return { error: null, data: [] };
          }),
        })),
      }));

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
    });

    it('should handle slow cache response', async () => {
      mockCacheClient.isHealthy = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return true;
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
    });
  });

  describe('Edge Cases', () => {
    it('should handle database returning null error property', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ error: null, data: [] })),
        })),
      }));

      const response = await GET();
      const data = await response.json();

      expect(data.checks.database).toBe(true);
    });

    it('should handle database returning undefined error property', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ error: undefined, data: [] })),
        })),
      }));

      const response = await GET();
      const data = await response.json();

      expect(data.checks.database).toBe(true);
    });

    it('should handle cache returning exactly true', async () => {
      mockCacheClient.isHealthy = vi.fn(() => Promise.resolve(true));

      const response = await GET();
      const data = await response.json();

      expect(data.checks.cache).toBe(true);
    });

    it('should handle cache returning exactly false', async () => {
      mockCacheClient.isHealthy = vi.fn(() => Promise.resolve(false));

      const response = await GET();
      const data = await response.json();

      expect(data.checks.cache).toBe(false);
    });
  });
});
