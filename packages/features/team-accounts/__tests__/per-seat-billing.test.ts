import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAccountPerSeatBillingService } from '../src/server/services/account-per-seat-billing.service';

// Mock dependencies
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(async () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock billing gateway
const mockUpdateSubscriptionItem = vi.fn();

vi.mock('@kit/billing-gateway', () => ({
  createBillingGatewayService: vi.fn(() => ({
    updateSubscriptionItem: mockUpdateSubscriptionItem,
  })),
}));

// Valid UUIDs for testing
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const SUBSCRIPTION_ID = '550e8400-e29b-41d4-a716-446655440001';
const SUBSCRIPTION_ITEM_ID = '550e8400-e29b-41d4-a716-446655440002';

// Mock Supabase client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();

const mockSupabaseClient = {
  from: mockFrom,
} as unknown as SupabaseClient;

describe('AccountPerSeatBillingService', () => {
  let service: ReturnType<typeof createAccountPerSeatBillingService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createAccountPerSeatBillingService(mockSupabaseClient);

    // Setup mock chain
    mockFrom.mockReturnValue({
      select: mockSelect,
    });

    mockSelect.mockReturnValue({
      eq: mockEq,
    });

    mockEq.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: mockMaybeSingle,
      }),
    });
  });

  describe('getPerSeatSubscriptionItem', () => {
    it('should retrieve per-seat subscription item successfully', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      const result = await service.getPerSeatSubscriptionItem(ACCOUNT_ID);

      expect(mockFrom).toHaveBeenCalledWith('subscriptions');
      expect(result).toEqual(mockSubscription);
    });

    it('should return undefined when no subscription exists', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await service.getPerSeatSubscriptionItem(ACCOUNT_ID);

      expect(result).toBeUndefined();
    });

    it('should return undefined when subscription has no items', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: {
          provider: 'stripe',
          id: SUBSCRIPTION_ID,
          subscription_items: null,
        },
        error: null,
      });

      const result = await service.getPerSeatSubscriptionItem(ACCOUNT_ID);

      expect(result).toBeUndefined();
    });

    it('should throw error when database query fails', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'Database error', code: '500' },
      });

      await expect(
        service.getPerSeatSubscriptionItem(ACCOUNT_ID),
      ).rejects.toThrow();
    });

    it('should handle subscription with multiple items', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440010',
            quantity: 1,
            type: 'flat_rate',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      const result = await service.getPerSeatSubscriptionItem(ACCOUNT_ID);

      expect(result).toEqual(mockSubscription);
    });
  });

  describe('increaseSeats', () => {
    it('should increase seats for account with per-seat subscription', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.increaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: SUBSCRIPTION_ITEM_ID,
        quantity: 6, // 5 + 1
      });
    });

    it('should handle multiple per-seat subscription items', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440010',
            quantity: 3,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.increaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledTimes(2);
      expect(mockUpdateSubscriptionItem).toHaveBeenNthCalledWith(1, {
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: SUBSCRIPTION_ITEM_ID,
        quantity: 6,
      });
      expect(mockUpdateSubscriptionItem).toHaveBeenNthCalledWith(2, {
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: '550e8400-e29b-41d4-a716-446655440010',
        quantity: 4,
      });
    });

    it('should do nothing when account has no subscription', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      await service.increaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).not.toHaveBeenCalled();
    });

    it('should do nothing when subscription has no per-seat items', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 1,
            type: 'flat_rate',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      await service.increaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).not.toHaveBeenCalled();
    });

    it('should continue on error and not throw', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockRejectedValue(
        new Error('Billing API error'),
      );

      // Should not throw
      await expect(service.increaseSeats(ACCOUNT_ID)).resolves.toBeUndefined();
    });

    it('should support different billing providers', async () => {
      const providers = ['stripe', 'lemon-squeezy', 'paddle'];

      for (const provider of providers) {
        vi.clearAllMocks();

        mockMaybeSingle.mockResolvedValue({
          data: {
            provider,
            id: SUBSCRIPTION_ID,
            subscription_items: [
              {
                id: SUBSCRIPTION_ITEM_ID,
                quantity: 5,
                type: 'per_seat',
              },
            ],
          },
          error: null,
        });

        mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

        await service.increaseSeats(ACCOUNT_ID);

        expect(mockUpdateSubscriptionItem).toHaveBeenCalled();
      }
    });
  });

  describe('decreaseSeats', () => {
    it('should decrease seats for account with per-seat subscription', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.decreaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: SUBSCRIPTION_ITEM_ID,
        quantity: 4, // 5 - 1
      });
    });

    it('should handle multiple per-seat subscription items', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 10,
            type: 'per_seat',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440010',
            quantity: 8,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.decreaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledTimes(2);
      expect(mockUpdateSubscriptionItem).toHaveBeenNthCalledWith(1, {
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: SUBSCRIPTION_ITEM_ID,
        quantity: 9,
      });
      expect(mockUpdateSubscriptionItem).toHaveBeenNthCalledWith(2, {
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: '550e8400-e29b-41d4-a716-446655440010',
        quantity: 7,
      });
    });

    it('should do nothing when account has no subscription', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      await service.decreaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).not.toHaveBeenCalled();
    });

    it('should do nothing when subscription has no per-seat items', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 1,
            type: 'metered',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      await service.decreaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).not.toHaveBeenCalled();
    });

    it('should continue on error and not throw', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockRejectedValue(
        new Error('Billing API error'),
      );

      // Should not throw
      await expect(
        service.decreaseSeats(ACCOUNT_ID),
      ).resolves.toBeUndefined();
    });

    it('should handle edge case of quantity becoming zero', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 1,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.decreaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: SUBSCRIPTION_ITEM_ID,
        quantity: 0, // 1 - 1
      });
    });

    it('should filter out non-per-seat items', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440010',
            quantity: 1,
            type: 'flat_rate',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440011',
            quantity: 10,
            type: 'metered',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      await service.decreaseSeats(ACCOUNT_ID);

      // Should only call for the per_seat item
      expect(mockUpdateSubscriptionItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: SUBSCRIPTION_ITEM_ID,
        quantity: 4,
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should handle increase then decrease correctly', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      // Increase
      await service.increaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: SUBSCRIPTION_ITEM_ID,
        quantity: 6,
      });

      // Decrease
      await service.decreaseSeats(ACCOUNT_ID);

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledWith({
        subscriptionId: SUBSCRIPTION_ID,
        subscriptionItemId: SUBSCRIPTION_ITEM_ID,
        quantity: 4,
      });
    });

    it('should handle concurrent operations gracefully', async () => {
      const mockSubscription = {
        provider: 'stripe',
        id: SUBSCRIPTION_ID,
        subscription_items: [
          {
            id: SUBSCRIPTION_ITEM_ID,
            quantity: 5,
            type: 'per_seat',
          },
        ],
      };

      mockMaybeSingle.mockResolvedValue({
        data: mockSubscription,
        error: null,
      });

      mockUpdateSubscriptionItem.mockResolvedValue({ success: true });

      // Run concurrent operations
      await Promise.all([
        service.increaseSeats(ACCOUNT_ID),
        service.increaseSeats(ACCOUNT_ID),
      ]);

      expect(mockUpdateSubscriptionItem).toHaveBeenCalledTimes(2);
    });
  });
});
