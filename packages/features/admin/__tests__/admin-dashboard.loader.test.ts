import { describe, expect, it, vi } from 'vitest';

// Mock dependencies
const mockGetDashboardData = vi.fn();

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({})),
}));

vi.mock('../src/lib/server/services/admin-dashboard.service', () => ({
  createAdminDashboardService: vi.fn(() => ({
    getDashboardData: mockGetDashboardData,
  })),
}));

// Import after mocks
import { loadAdminDashboard } from '../src/lib/server/loaders/admin-dashboard.loader';

describe('admin-dashboard.loader', () => {
  describe('loadAdminDashboard', () => {
    it('should call service getDashboardData', async () => {
      const mockData = {
        subscriptions: 100,
        trials: 25,
        accounts: 500,
        teamAccounts: 150,
      };

      mockGetDashboardData.mockResolvedValue(mockData);

      const result = await loadAdminDashboard();

      expect(result).toEqual(mockData);
      expect(mockGetDashboardData).toHaveBeenCalledOnce();
    });

    it('should propagate service errors', async () => {
      mockGetDashboardData.mockRejectedValue(new Error('Database error'));

      await expect(loadAdminDashboard()).rejects.toThrow('Database error');
    });

    it('should return zero counts when no data exists', async () => {
      const mockData = {
        subscriptions: 0,
        trials: 0,
        accounts: 0,
        teamAccounts: 0,
      };

      mockGetDashboardData.mockResolvedValue(mockData);

      const result = await loadAdminDashboard();

      expect(result).toEqual(mockData);
    });

    it('should handle null counts gracefully', async () => {
      const mockData = {
        subscriptions: null,
        trials: null,
        accounts: null,
        teamAccounts: null,
      };

      mockGetDashboardData.mockResolvedValue(mockData);

      const result = await loadAdminDashboard();

      expect(result).toEqual(mockData);
    });

    it('should be cacheable (react cache wrapper)', async () => {
      const mockData = {
        subscriptions: 100,
        trials: 25,
        accounts: 500,
        teamAccounts: 150,
      };

      mockGetDashboardData.mockResolvedValue(mockData);

      // Call multiple times
      const result1 = await loadAdminDashboard();
      const result2 = await loadAdminDashboard();

      expect(result1).toEqual(mockData);
      expect(result2).toEqual(mockData);

      // Note: React cache behavior is tested at React level
      // This test just ensures the loader can be called multiple times
    });
  });
});
