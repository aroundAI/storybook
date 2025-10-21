import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock logger
vi.mock('@kit/shared/logger', () => ({
  logger: {
    error: vi.fn(),
  },
  getLogger: vi.fn(() =>
    Promise.resolve({
      error: vi.fn(),
    }),
  ),
}));

import { createAdminDashboardService } from '../src/lib/server/services/admin-dashboard.service';

describe('admin-dashboard.service', () => {
  let mockClient: SupabaseClient;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockEq: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEq = vi.fn();
    mockSelect = vi.fn(() => ({
      eq: mockEq,
    }));
    mockFrom = vi.fn(() => ({
      select: mockSelect,
    }));

    mockClient = {
      from: mockFrom,
    } as unknown as SupabaseClient;
  });

  describe('getDashboardData', () => {
    describe('successful queries', () => {
      it('should fetch dashboard data with default count mode (estimated)', async () => {
        const service = createAdminDashboardService(mockClient);

        // Mock responses for each query
        mockEq
          .mockResolvedValueOnce({ count: 100, error: null }) // Active subscriptions
          .mockResolvedValueOnce({ count: 25, error: null }) // Trial subscriptions
          .mockResolvedValueOnce({ count: 500, error: null }) // Personal accounts
          .mockResolvedValueOnce({ count: 150, error: null }); // Team accounts

        const result = await service.getDashboardData();

        expect(result).toEqual({
          subscriptions: 100,
          trials: 25,
          accounts: 500,
          teamAccounts: 150,
        });

        // Verify correct queries were made
        expect(mockFrom).toHaveBeenCalledWith('subscriptions');
        expect(mockFrom).toHaveBeenCalledWith('accounts');
        expect(mockSelect).toHaveBeenCalledWith('*', {
          count: 'estimated',
          head: true,
        });
      });

      it('should fetch dashboard data with exact count mode', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 100, error: null })
          .mockResolvedValueOnce({ count: 25, error: null })
          .mockResolvedValueOnce({ count: 500, error: null })
          .mockResolvedValueOnce({ count: 150, error: null });

        const result = await service.getDashboardData({ count: 'exact' });

        expect(result).toEqual({
          subscriptions: 100,
          trials: 25,
          accounts: 500,
          teamAccounts: 150,
        });

        expect(mockSelect).toHaveBeenCalledWith('*', {
          count: 'exact',
          head: true,
        });
      });

      it('should fetch dashboard data with planned count mode', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 100, error: null })
          .mockResolvedValueOnce({ count: 25, error: null })
          .mockResolvedValueOnce({ count: 500, error: null })
          .mockResolvedValueOnce({ count: 150, error: null });

        const result = await service.getDashboardData({ count: 'planned' });

        expect(result).toEqual({
          subscriptions: 100,
          trials: 25,
          accounts: 500,
          teamAccounts: 150,
        });

        expect(mockSelect).toHaveBeenCalledWith('*', {
          count: 'planned',
          head: true,
        });
      });

      it('should handle zero counts', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 0, error: null })
          .mockResolvedValueOnce({ count: 0, error: null })
          .mockResolvedValueOnce({ count: 0, error: null })
          .mockResolvedValueOnce({ count: 0, error: null });

        const result = await service.getDashboardData();

        expect(result).toEqual({
          subscriptions: 0,
          trials: 0,
          accounts: 0,
          teamAccounts: 0,
        });
      });

      it('should handle null counts', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: null, error: null })
          .mockResolvedValueOnce({ count: null, error: null })
          .mockResolvedValueOnce({ count: null, error: null })
          .mockResolvedValueOnce({ count: null, error: null });

        const result = await service.getDashboardData();

        expect(result).toEqual({
          subscriptions: null,
          trials: null,
          accounts: null,
          teamAccounts: null,
        });
      });

      it('should query active subscriptions correctly', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 100, error: null })
          .mockResolvedValueOnce({ count: 25, error: null })
          .mockResolvedValueOnce({ count: 500, error: null })
          .mockResolvedValueOnce({ count: 150, error: null });

        await service.getDashboardData();

        // Verify subscriptions query
        expect(mockFrom).toHaveBeenNthCalledWith(1, 'subscriptions');
        expect(mockEq).toHaveBeenNthCalledWith(1, 'status', 'active');
      });

      it('should query trial subscriptions correctly', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 100, error: null })
          .mockResolvedValueOnce({ count: 25, error: null })
          .mockResolvedValueOnce({ count: 500, error: null })
          .mockResolvedValueOnce({ count: 150, error: null });

        await service.getDashboardData();

        // Verify trials query
        expect(mockFrom).toHaveBeenNthCalledWith(2, 'subscriptions');
        expect(mockEq).toHaveBeenNthCalledWith(2, 'status', 'trialing');
      });

      it('should query personal accounts correctly', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 100, error: null })
          .mockResolvedValueOnce({ count: 25, error: null })
          .mockResolvedValueOnce({ count: 500, error: null })
          .mockResolvedValueOnce({ count: 150, error: null });

        await service.getDashboardData();

        // Verify personal accounts query
        expect(mockFrom).toHaveBeenNthCalledWith(3, 'accounts');
        expect(mockEq).toHaveBeenNthCalledWith(3, 'is_personal_account', true);
      });

      it('should query team accounts correctly', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 100, error: null })
          .mockResolvedValueOnce({ count: 25, error: null })
          .mockResolvedValueOnce({ count: 500, error: null })
          .mockResolvedValueOnce({ count: 150, error: null });

        await service.getDashboardData();

        // Verify team accounts query
        expect(mockFrom).toHaveBeenNthCalledWith(4, 'accounts');
        expect(mockEq).toHaveBeenNthCalledWith(4, 'is_personal_account', false);
      });
    });

    describe('error handling', () => {
      it('should throw when active subscriptions query fails', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq.mockResolvedValueOnce({
          count: null,
          error: { message: 'Database error' },
        });

        await expect(service.getDashboardData()).rejects.toThrow();
      });

      it('should throw when trial subscriptions query fails', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 100, error: null }) // Active subscriptions succeeds
          .mockResolvedValueOnce({
            count: null,
            error: { message: 'Database error' },
          }); // Trials fails

        await expect(service.getDashboardData()).rejects.toThrow();
      });

      it('should throw when personal accounts query fails', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 100, error: null }) // Active subscriptions
          .mockResolvedValueOnce({ count: 25, error: null }) // Trials
          .mockResolvedValueOnce({
            count: null,
            error: { message: 'Database error' },
          }); // Personal accounts fails

        await expect(service.getDashboardData()).rejects.toThrow();
      });

      it('should throw when team accounts query fails', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({ count: 100, error: null }) // Active subscriptions
          .mockResolvedValueOnce({ count: 25, error: null }) // Trials
          .mockResolvedValueOnce({ count: 500, error: null }) // Personal accounts
          .mockResolvedValueOnce({
            count: null,
            error: { message: 'Database error' },
          }); // Team accounts fails

        await expect(service.getDashboardData()).rejects.toThrow();
      });

      it('should throw when multiple queries fail', async () => {
        const service = createAdminDashboardService(mockClient);

        mockEq
          .mockResolvedValueOnce({
            count: null,
            error: { message: 'Error 1' },
          })
          .mockResolvedValueOnce({
            count: null,
            error: { message: 'Error 2' },
          })
          .mockResolvedValueOnce({ count: 500, error: null })
          .mockResolvedValueOnce({ count: 150, error: null });

        // Should throw on first error
        await expect(service.getDashboardData()).rejects.toThrow();
      });
    });

    describe('parallel execution', () => {
      it('should execute all queries in parallel', async () => {
        const service = createAdminDashboardService(mockClient);

        // Mock all queries to succeed
        mockEq
          .mockResolvedValueOnce({ count: 100, error: null })
          .mockResolvedValueOnce({ count: 25, error: null })
          .mockResolvedValueOnce({ count: 500, error: null })
          .mockResolvedValueOnce({ count: 150, error: null });

        const result = await service.getDashboardData();

        // Verify result
        expect(result).toEqual({
          subscriptions: 100,
          trials: 25,
          accounts: 500,
          teamAccounts: 150,
        });

        // Verify all 4 queries were called (confirms Promise.all behavior)
        expect(mockEq).toHaveBeenCalledTimes(4);

        // Verify queries were made to correct tables
        expect(mockFrom).toHaveBeenCalledWith('subscriptions');
        expect(mockFrom).toHaveBeenCalledWith('accounts');
      });
    });
  });
});
