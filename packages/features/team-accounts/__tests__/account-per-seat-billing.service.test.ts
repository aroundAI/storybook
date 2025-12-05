import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAccountPerSeatBillingService } from '../src/server/services/account-per-seat-billing.service';

// Mock logger
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  ),
}));

// Mock billing gateway service
const mockUpdateSubscriptionItem = vi.fn();

vi.mock('@kit/billing-gateway', () => ({
  createBillingGatewayService: vi.fn(() => ({
    updateSubscriptionItem: mockUpdateSubscriptionItem,
  })),
}));

// Create mock Supabase client
const createMockClient = () => ({
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: {
          provider: 'stripe',
          id: 'sub-123',
          subscription_items: [
            {
              id: 'si-456',
              quantity: 5,
              type: 'per_seat',
            },
          ],
        },
        error: null,
      }),
    ),
  })),
});

describe('AccountPerSeatBillingService', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.clearAllMocks();
  });

  describe('getPerSeatSubscriptionItem', () => {
    it('should retrieve per-seat subscription successfully', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      const result = await service.getPerSeatSubscriptionItem('acc-123');

      expect(mockClient.from).toHaveBeenCalledWith('subscriptions');
      expect(result).toEqual({
        provider: 'stripe',
        id: 'sub-123',
        subscription_items: [
          {
            id: 'si-456',
            quantity: 5,
            type: 'per_seat',
          },
        ],
      });
    });

    it('should return undefined when no per-seat subscription exists', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: null,
          }),
        ),
      } as any);

      const result = await service.getPerSeatSubscriptionItem('acc-123');

      expect(result).toBeUndefined();
    });

    it('should return undefined when subscription has no items', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: {
              provider: 'stripe',
              id: 'sub-123',
              subscription_items: null,
            },
            error: null,
          }),
        ),
      } as any);

      const result = await service.getPerSeatSubscriptionItem('acc-123');

      expect(result).toBeUndefined();
    });

    it('should throw error when database query fails', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);
      const error = new Error('Database error');

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: null,
            error,
          }),
        ),
      } as any);

      await expect(
        service.getPerSeatSubscriptionItem('acc-123'),
      ).rejects.toThrow('Database error');
    });
  });

  describe('increaseSeats', () => {
    it('should increase seats successfully', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.increaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
        subscriptionItemId: 'si-456',
        quantity: 6, // 5 + 1
      });
    });

    it('should not call billing gateway when no subscription exists', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: null,
          }),
        ),
      } as any);

      await service.increaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).not.toHaveBeenCalled();
    });

    it('should not call billing gateway when no per-seat items exist', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: {
              provider: 'stripe',
              id: 'sub-123',
              subscription_items: [
                {
                  id: 'si-789',
                  quantity: 3,
                  type: 'flat', // Not per_seat
                },
              ],
            },
            error: null,
          }),
        ),
      } as any);

      await service.increaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).not.toHaveBeenCalled();
    });

    it('should handle multiple per-seat items', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: {
              provider: 'stripe',
              id: 'sub-123',
              subscription_items: [
                { id: 'si-1', quantity: 5, type: 'per_seat' },
                { id: 'si-2', quantity: 3, type: 'per_seat' },
              ],
            },
            error: null,
          }),
        ),
      } as any);

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.increaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledTimes(2);
      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
        subscriptionItemId: 'si-1',
        quantity: 6,
      });
      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
        subscriptionItemId: 'si-2',
        quantity: 4,
      });
    });

    it('should continue processing other items if one fails', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: {
              provider: 'stripe',
              id: 'sub-123',
              subscription_items: [
                { id: 'si-1', quantity: 5, type: 'per_seat' },
                { id: 'si-2', quantity: 3, type: 'per_seat' },
              ],
            },
            error: null,
          }),
        ),
      } as any);

      mockUpdateSubscriptionItem
        .mockRejectedValueOnce(new Error('Failed to update'))
        .mockResolvedValueOnce({ success: true });

      await service.increaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledTimes(2);
    });
  });

  describe('decreaseSeats', () => {
    it('should decrease seats successfully', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.decreaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
        subscriptionItemId: 'si-456',
        quantity: 4, // 5 - 1
      });
    });

    it('should not call billing gateway when no subscription exists', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: null,
          }),
        ),
      } as any);

      await service.decreaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).not.toHaveBeenCalled();
    });

    it('should not call billing gateway when no per-seat items exist', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: {
              provider: 'stripe',
              id: 'sub-123',
              subscription_items: [
                {
                  id: 'si-789',
                  quantity: 3,
                  type: 'metered', // Not per_seat
                },
              ],
            },
            error: null,
          }),
        ),
      } as any);

      await service.decreaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).not.toHaveBeenCalled();
    });

    it('should handle multiple per-seat items', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: {
              provider: 'stripe',
              id: 'sub-123',
              subscription_items: [
                { id: 'si-1', quantity: 5, type: 'per_seat' },
                { id: 'si-2', quantity: 3, type: 'per_seat' },
              ],
            },
            error: null,
          }),
        ),
      } as any);

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.decreaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledTimes(2);
      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
        subscriptionItemId: 'si-1',
        quantity: 4,
      });
      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: 'sub-123',
        subscriptionItemId: 'si-2',
        quantity: 2,
      });
    });

    it('should continue processing other items if one fails', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: {
              provider: 'stripe',
              id: 'sub-123',
              subscription_items: [
                { id: 'si-1', quantity: 5, type: 'per_seat' },
                { id: 'si-2', quantity: 3, type: 'per_seat' },
              ],
            },
            error: null,
          }),
        ),
      } as any);

      mockUpdateSubscriptionItem
        .mockRejectedValueOnce(new Error('Failed to update'))
        .mockResolvedValueOnce({ success: true });

      await service.decreaseSeats('acc-123');

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledTimes(2);
    });

    it('should use correct billing provider', async () => {
      const service = createAccountPerSeatBillingService(mockClient as any);

      mockClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: {
              provider: 'lemon-squeezy',
              id: 'sub-123',
              subscription_items: [
                { id: 'si-456', quantity: 5, type: 'per_seat' },
              ],
            },
            error: null,
          }),
        ),
      } as any);

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.decreaseSeats('acc-123');

      const { createBillingGatewayService } = await import(
        '@kit/billing-gateway'
      );
      expect(createBillingGatewayService).toHaveBeenCalledWith('lemon-squeezy');
    });
  });
});
