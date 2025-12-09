import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HAILUO_STATUS_MAP,
  KLING_STATUS_MAP,
} from '../src/lib/provider-status';

// Mock the logger
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Webhook Processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('KLING_STATUS_MAP', () => {
    it('should map submitted to queued', () => {
      expect(KLING_STATUS_MAP['submitted']).toBe('queued');
    });

    it('should map processing to processing', () => {
      expect(KLING_STATUS_MAP['processing']).toBe('processing');
    });

    it('should map succeed to completed', () => {
      expect(KLING_STATUS_MAP['succeed']).toBe('completed');
    });

    it('should map failed to failed', () => {
      expect(KLING_STATUS_MAP['failed']).toBe('failed');
    });
  });

  describe('HAILUO_STATUS_MAP', () => {
    it('should map Queueing to queued', () => {
      expect(HAILUO_STATUS_MAP['Queueing']).toBe('queued');
    });

    it('should map Processing to processing', () => {
      expect(HAILUO_STATUS_MAP['Processing']).toBe('processing');
    });

    it('should map Success to completed', () => {
      expect(HAILUO_STATUS_MAP['Success']).toBe('completed');
    });

    it('should map Fail to failed', () => {
      expect(HAILUO_STATUS_MAP['Fail']).toBe('failed');
    });
  });

  describe('processVideoWebhook', () => {
    it('should return error when job not found', async () => {
      const { processVideoWebhook } = await import(
        '../src/lib/webhook-processor'
      );

      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({
                    data: null,
                    error: { message: 'Not found' },
                  }),
                ),
              })),
            })),
          })),
        })),
      };

      const result = await processVideoWebhook(
        mockClient as any,
        { provider: 'kling', providerJobId: 'task-123' },
        {
          task_id: 'task-123',
          task_status: 'succeed',
          task_status_msg: 'Completed',
          updated_at: Date.now() / 1000,
          progress: 100,
        },
      );

      expect(result.jobId).toBeNull();
      expect(result.error).toContain('Job not found');
      expect(result.isIdempotent).toBe(false);
    });

    it('should return idempotent response for already completed jobs', async () => {
      const { processVideoWebhook } = await import(
        '../src/lib/webhook-processor'
      );

      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() =>
                  Promise.resolve({
                    data: {
                      id: 'job-123',
                      status: 'completed',
                      reference_id: 'shot-456',
                      reference_type: 'shot',
                      account_id: 'account-789',
                      estimated_cost_cents: 100,
                    },
                    error: null,
                  }),
                ),
              })),
            })),
          })),
        })),
      };

      const result = await processVideoWebhook(
        mockClient as any,
        { provider: 'kling', providerJobId: 'task-123' },
        {
          task_id: 'task-123',
          task_status: 'succeed',
          task_status_msg: 'Completed',
          updated_at: Date.now() / 1000,
          progress: 100,
        },
      );

      expect(result.jobId).toBe('job-123');
      expect(result.status).toBe('completed');
      expect(result.isIdempotent).toBe(true);
    });

    it('should update job and shot on successful completion', async () => {
      const { processVideoWebhook } = await import(
        '../src/lib/webhook-processor'
      );

      const mockUpdate = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      }));

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'generation_jobs') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(() =>
                      Promise.resolve({
                        data: {
                          id: 'job-123',
                          status: 'processing',
                          reference_id: 'shot-456',
                          reference_type: 'shot',
                          account_id: 'account-789',
                          estimated_cost_cents: 100,
                        },
                        error: null,
                      }),
                    ),
                  })),
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

      const result = await processVideoWebhook(
        mockClient as any,
        { provider: 'kling', providerJobId: 'task-123' },
        {
          task_id: 'task-123',
          task_status: 'succeed',
          task_status_msg: 'Completed',
          updated_at: Date.now() / 1000,
          progress: 100,
          task_result: {
            videos: [
              {
                id: 'video-1',
                url: 'https://example.com/video.mp4',
                duration: 5,
              },
            ],
          },
        },
      );

      expect(result.jobId).toBe('job-123');
      expect(result.status).toBe('completed');
      expect(result.isIdempotent).toBe(false);
      // Verify both job and shot were updated
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });

    it('should handle failed jobs correctly', async () => {
      const { processVideoWebhook } = await import(
        '../src/lib/webhook-processor'
      );

      const mockUpdate = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      }));

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'generation_jobs') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(() =>
                      Promise.resolve({
                        data: {
                          id: 'job-123',
                          status: 'processing',
                          reference_id: 'shot-456',
                          reference_type: 'shot',
                          account_id: 'account-789',
                          estimated_cost_cents: 100,
                        },
                        error: null,
                      }),
                    ),
                  })),
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

      const result = await processVideoWebhook(
        mockClient as any,
        { provider: 'kling', providerJobId: 'task-123' },
        {
          task_id: 'task-123',
          task_status: 'failed',
          task_status_msg: 'Content policy violation',
          updated_at: Date.now() / 1000,
          progress: 0,
          error: {
            code: 'CONTENT_POLICY',
            message: 'Content violates policy',
          },
        },
      );

      expect(result.jobId).toBe('job-123');
      expect(result.status).toBe('failed');
      expect(result.isIdempotent).toBe(false);
    });

    it('should process Hailuo webhooks correctly', async () => {
      const { processVideoWebhook } = await import(
        '../src/lib/webhook-processor'
      );

      const mockUpdate = vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      }));

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'generation_jobs') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(() =>
                      Promise.resolve({
                        data: {
                          id: 'job-123',
                          status: 'processing',
                          reference_id: 'shot-456',
                          reference_type: 'shot',
                          account_id: 'account-789',
                          estimated_cost_cents: 150,
                        },
                        error: null,
                      }),
                    ),
                  })),
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

      const result = await processVideoWebhook(
        mockClient as any,
        { provider: 'hailuo', providerJobId: 'task-456' },
        {
          task_id: 'task-456',
          status: 'Success',
          video_url: 'https://example.com/hailuo-video.mp4',
          cover_url: 'https://example.com/thumbnail.jpg',
          duration: 10,
          created_at: Date.now() / 1000,
        },
      );

      expect(result.jobId).toBe('job-123');
      expect(result.status).toBe('completed');
      expect(result.isIdempotent).toBe(false);
    });
  });
});
