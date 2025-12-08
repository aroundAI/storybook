import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RUNWAY_STATUS_MAP } from '../src/lib/provider-status';

// Mock the logger
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Runway Poller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variable
    delete process.env.RUNWAY_API_KEY;
  });

  describe('RUNWAY_STATUS_MAP', () => {
    it('should map PENDING to queued', () => {
      expect(RUNWAY_STATUS_MAP['PENDING']).toBe('queued');
    });

    it('should map RUNNING to processing', () => {
      expect(RUNWAY_STATUS_MAP['RUNNING']).toBe('processing');
    });

    it('should map SUCCEEDED to completed', () => {
      expect(RUNWAY_STATUS_MAP['SUCCEEDED']).toBe('completed');
    });

    it('should map FAILED to failed', () => {
      expect(RUNWAY_STATUS_MAP['FAILED']).toBe('failed');
    });

    it('should map CANCELLED to cancelled', () => {
      expect(RUNWAY_STATUS_MAP['CANCELLED']).toBe('cancelled');
    });
  });

  describe('pollRunwayJobs', () => {
    it('should skip polling when API key is not configured', async () => {
      // Dynamically import after mocks are set up
      const { pollRunwayJobs } = await import('../src/lib/runway-poller');

      const mockClient = {
        from: vi.fn(),
      };

      const results = await pollRunwayJobs(mockClient as any);

      expect(results).toEqual([]);
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    it('should return empty array when no active jobs', async () => {
      process.env.RUNWAY_API_KEY = 'test-api-key';

      const { pollRunwayJobs } = await import('../src/lib/runway-poller');

      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() =>
                Promise.resolve({
                  data: [],
                  error: null,
                }),
              ),
            })),
          })),
        })),
      };

      const results = await pollRunwayJobs(mockClient as any, {
        apiKey: 'test-key',
      });

      expect(results).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      process.env.RUNWAY_API_KEY = 'test-api-key';

      const { pollRunwayJobs } = await import('../src/lib/runway-poller');

      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() =>
                Promise.resolve({
                  data: null,
                  error: new Error('Database error'),
                }),
              ),
            })),
          })),
        })),
      };

      await expect(
        pollRunwayJobs(mockClient as any, { apiKey: 'test-key' }),
      ).rejects.toThrow();
    });

    it('should poll active jobs and update completed ones', async () => {
      process.env.RUNWAY_API_KEY = 'test-api-key';

      // Reset module to pick up new env
      vi.resetModules();
      const { pollRunwayJobs } = await import('../src/lib/runway-poller');

      const mockJob = {
        id: 'job-123',
        provider_job_id: 'runway-task-456',
        reference_id: 'shot-789',
        reference_type: 'shot',
        account_id: 'account-abc',
        estimated_cost_cents: 100,
      };

      // Mock fetch globally
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'runway-task-456',
              status: 'SUCCEEDED',
              output: [{ url: 'https://example.com/video.mp4', duration: 5 }],
            }),
        }),
      ) as any;

      const mockUpdate = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      }));

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'generation_jobs') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() =>
                    Promise.resolve({
                      data: [mockJob],
                      error: null,
                    }),
                  ),
                })),
              })),
              update: mockUpdate,
            };
          }
          if (table === 'shots') {
            return {
              update: mockUpdate,
            };
          }
          return {};
        }),
      };

      const results = await pollRunwayJobs(mockClient as any, {
        apiKey: 'test-key',
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        jobId: 'job-123',
        providerJobId: 'runway-task-456',
        status: 'completed',
        updated: true,
      });

      // Restore fetch
      global.fetch = originalFetch;
    });

    it('should handle Runway API errors', async () => {
      process.env.RUNWAY_API_KEY = 'test-api-key';

      vi.resetModules();
      const { pollRunwayJobs } = await import('../src/lib/runway-poller');

      const mockJob = {
        id: 'job-123',
        provider_job_id: 'runway-task-456',
        reference_id: null,
        reference_type: null,
        account_id: 'account-abc',
        estimated_cost_cents: 100,
      };

      // Mock fetch to return error
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        }),
      ) as any;

      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() =>
                Promise.resolve({
                  data: [mockJob],
                  error: null,
                }),
              ),
            })),
          })),
        })),
      };

      const results = await pollRunwayJobs(mockClient as any, {
        apiKey: 'test-key',
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        jobId: 'job-123',
        updated: false,
        error: expect.stringContaining('Runway API error 500'),
      });

      global.fetch = originalFetch;
    });
  });
});
