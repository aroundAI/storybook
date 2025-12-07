import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBillingGatewayService } from '../src/server/services/billing-gateway/billing-gateway.service';

// Mock the billing strategy registry
const mockStrategy = {
  createCheckoutSession: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
  cancelSubscription: vi.fn(),
  reportUsage: vi.fn(),
  queryUsage: vi.fn(),
  getPlanById: vi.fn(),
  updateSubscriptionItem: vi.fn(),
  getSubscription: vi.fn(),
};

vi.mock(
  '../src/server/services/billing-gateway/billing-gateway-registry',
  () => ({
    billingStrategyRegistry: {
      get: vi.fn(() => Promise.resolve(mockStrategy)),
    },
  }),
);

describe('BillingGatewayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createCheckoutSession', () => {
    it('should create checkout session with valid params', async () => {
      const service = createBillingGatewayService('stripe');
      const mockSession = {
        id: 'session_123',
        url: 'https://checkout.stripe.com/123',
      };

      mockStrategy.createCheckoutSession.mockResolvedValue(mockSession);

      const params = {
        returnUrl: 'https://example.com/success',
        accountId: '123e4567-e89b-12d3-a456-426614174000',
        plan: {
          id: 'price_123',
          name: 'Pro Plan',
          paymentType: 'recurring' as const,
          interval: 'month' as const,
          lineItems: [
            {
              id: 'li_123',
              name: 'Base subscription',
              cost: 2900,
              type: 'flat' as const,
            },
          ],
        },
        variantQuantities: [
          {
            variantId: 'variant-123',
            quantity: 1,
          },
        ],
        customerId: 'cus_123',
      };

      const result = await service.createCheckoutSession(params);

      expect(result).toEqual(mockSession);
      expect(mockStrategy.createCheckoutSession).toHaveBeenCalledWith(params);
    });

    it('should validate params with schema', async () => {
      const service = createBillingGatewayService('stripe');

      const invalidParams = {
        // Missing required fields
        returnUrl: 'not-a-url', // Invalid URL
      };

      await expect(
        service.createCheckoutSession(invalidParams as any),
      ).rejects.toThrow();
    });

    it('should delegate to correct strategy provider', async () => {
      const service = createBillingGatewayService('stripe');

      mockStrategy.createCheckoutSession.mockResolvedValue({
        id: 'session_123',
      });

      await service.createCheckoutSession({
        returnUrl: 'https://example.com/success',
        accountId: '456e7890-e89b-12d3-a456-426614174001',
        plan: {
          id: 'price_123',
          name: 'Starter Plan',
          paymentType: 'recurring' as const,
          interval: 'month' as const,
          lineItems: [
            {
              id: 'li_456',
              name: 'Monthly subscription',
              cost: 1500,
              type: 'flat' as const,
            },
          ],
        },
        variantQuantities: [
          {
            variantId: 'variant-456',
            quantity: 1,
          },
        ],
        customerId: 'cus_123',
      });

      expect(mockStrategy.createCheckoutSession).toHaveBeenCalled();
    });
  });

  describe('retrieveCheckoutSession', () => {
    it('should retrieve checkout session by ID', async () => {
      const service = createBillingGatewayService('stripe');
      const mockSession = {
        id: 'session_123',
        status: 'complete',
        customer: 'cus_123',
      };

      mockStrategy.retrieveCheckoutSession.mockResolvedValue(mockSession);

      const result = await service.retrieveCheckoutSession({
        sessionId: 'session_123',
      });

      expect(result).toEqual(mockSession);
      expect(mockStrategy.retrieveCheckoutSession).toHaveBeenCalledWith({
        sessionId: 'session_123',
      });
    });

    it('should validate session ID param', async () => {
      const service = createBillingGatewayService('stripe');

      await expect(
        service.retrieveCheckoutSession({ sessionId: null as any }),
      ).rejects.toThrow();
    });
  });

  describe('createBillingPortalSession', () => {
    it('should create portal session with customer ID', async () => {
      const service = createBillingGatewayService('stripe');
      const mockPortalSession = {
        url: 'https://billing.stripe.com/session/portal_123',
      };

      mockStrategy.createBillingPortalSession.mockResolvedValue(
        mockPortalSession,
      );

      const params = {
        customerId: 'cus_123',
        returnUrl: 'https://example.com/account',
      };

      const result = await service.createBillingPortalSession(params);

      expect(result).toEqual(mockPortalSession);
      expect(mockStrategy.createBillingPortalSession).toHaveBeenCalledWith(
        params,
      );
    });

    it('should validate customer ID and return URL', async () => {
      const service = createBillingGatewayService('stripe');

      await expect(
        service.createBillingPortalSession({
          customerId: '',
          returnUrl: 'not-a-url',
        }),
      ).rejects.toThrow();
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription successfully', async () => {
      const service = createBillingGatewayService('stripe');
      const mockCanceled = {
        id: 'sub_123',
        status: 'canceled',
        canceled_at: Date.now(),
      };

      mockStrategy.cancelSubscription.mockResolvedValue(mockCanceled);

      const params = {
        subscriptionId: 'sub_123',
      };

      const result = await service.cancelSubscription(params);

      expect(result).toEqual(mockCanceled);
      expect(mockStrategy.cancelSubscription).toHaveBeenCalledWith(params);
    });

    it('should validate subscription ID', async () => {
      const service = createBillingGatewayService('stripe');

      await expect(
        service.cancelSubscription({ subscriptionId: 123 as any }),
      ).rejects.toThrow();
    });

    it('should handle cancellation errors from provider', async () => {
      const service = createBillingGatewayService('stripe');

      mockStrategy.cancelSubscription.mockRejectedValue(
        new Error('Subscription not found'),
      );

      await expect(
        service.cancelSubscription({
          subscriptionId: 'sub_nonexistent',
        }),
      ).rejects.toThrow('Subscription not found');
    });
  });

  describe('reportUsage', () => {
    it('should report usage for metered billing', async () => {
      const service = createBillingGatewayService('stripe');
      const mockResponse = { success: true, id: 'usage_123' };

      mockStrategy.reportUsage.mockResolvedValue(mockResponse);

      const params = {
        id: 'cus_123',
        usage: {
          quantity: 100,
          action: 'increment' as const,
        },
        eventName: 'api_call',
      };

      const result = await service.reportUsage(params);

      expect(result).toEqual(mockResponse);
      expect(mockStrategy.reportUsage).toHaveBeenCalledWith(params);
    });

    it('should validate usage params', async () => {
      const service = createBillingGatewayService('stripe');

      await expect(
        service.reportUsage({
          id: 123 as any, // Invalid type
          usage: 'invalid' as any, // Invalid type
        }),
      ).rejects.toThrow();
    });
  });

  describe('queryUsage', () => {
    it('should query usage for subscription item', async () => {
      const service = createBillingGatewayService('stripe');
      const mockUsage = {
        total: 500,
        period_start: '2024-01-01',
        period_end: '2024-01-31',
      };

      mockStrategy.queryUsage.mockResolvedValue(mockUsage);

      const params = {
        id: 'meter_123',
        customerId: 'cus_123',
        filter: {
          startTime: 1704067200,
          endTime: 1706745600,
        },
      };

      const result = await service.queryUsage(params);

      expect(result).toEqual(mockUsage);
      expect(mockStrategy.queryUsage).toHaveBeenCalledWith(params);
    });

    it('should validate subscription item ID', async () => {
      const service = createBillingGatewayService('stripe');

      await expect(
        service.queryUsage({
          id: 123 as any, // Invalid type
          customerId: null as any, // Invalid type
          filter: 'invalid' as any, // Invalid type
        }),
      ).rejects.toThrow();
    });
  });

  describe('getPlanById', () => {
    it('should retrieve plan details by ID', async () => {
      const service = createBillingGatewayService('stripe');
      const mockPlan = {
        id: 'price_123',
        name: 'Pro Plan',
        amount: 2900,
        currency: 'usd',
        interval: 'month',
      };

      mockStrategy.getPlanById.mockResolvedValue(mockPlan);

      const result = await service.getPlanById('price_123');

      expect(result).toEqual(mockPlan);
      expect(mockStrategy.getPlanById).toHaveBeenCalledWith('price_123');
    });

    it('should handle missing plan errors', async () => {
      const service = createBillingGatewayService('stripe');

      mockStrategy.getPlanById.mockRejectedValue(new Error('Plan not found'));

      await expect(service.getPlanById('price_nonexistent')).rejects.toThrow(
        'Plan not found',
      );
    });
  });

  describe('updateSubscriptionItem', () => {
    it('should update subscription with new quantity', async () => {
      const service = createBillingGatewayService('stripe');
      const mockUpdated = {
        id: 'sub_123',
        quantity: 5,
        updated_at: Date.now(),
      };

      mockStrategy.updateSubscriptionItem.mockResolvedValue(mockUpdated);

      const params = {
        subscriptionId: 'sub_123',
        subscriptionItemId: 'si_123',
        quantity: 5,
      };

      const result = await service.updateSubscriptionItem(params);

      expect(result).toEqual(mockUpdated);
      expect(mockStrategy.updateSubscriptionItem).toHaveBeenCalledWith(params);
    });

    it('should validate update params', async () => {
      const service = createBillingGatewayService('stripe');

      await expect(
        service.updateSubscriptionItem({
          subscriptionId: '',
          subscriptionItemId: '',
          quantity: -1,
        }),
      ).rejects.toThrow();
    });

    it('should handle update errors from provider', async () => {
      const service = createBillingGatewayService('stripe');

      mockStrategy.updateSubscriptionItem.mockRejectedValue(
        new Error('Invalid subscription item'),
      );

      await expect(
        service.updateSubscriptionItem({
          subscriptionId: 'sub_123',
          subscriptionItemId: 'si_invalid',
          quantity: 10,
        }),
      ).rejects.toThrow('Invalid subscription item');
    });
  });

  describe('getSubscription', () => {
    it('should retrieve subscription by ID', async () => {
      const service = createBillingGatewayService('stripe');
      const mockSubscription = {
        id: 'sub_123',
        status: 'active',
        customer: 'cus_123',
        current_period_end: Date.now() + 30 * 24 * 60 * 60 * 1000,
      };

      mockStrategy.getSubscription.mockResolvedValue(mockSubscription);

      const result = await service.getSubscription('sub_123');

      expect(result).toEqual(mockSubscription);
      expect(mockStrategy.getSubscription).toHaveBeenCalledWith('sub_123');
    });

    it('should handle subscription not found errors', async () => {
      const service = createBillingGatewayService('stripe');

      mockStrategy.getSubscription.mockRejectedValue(
        new Error('Subscription not found'),
      );

      await expect(service.getSubscription('sub_nonexistent')).rejects.toThrow(
        'Subscription not found',
      );
    });
  });

  describe('provider selection', () => {
    it('should support stripe provider', () => {
      const service = createBillingGatewayService('stripe');
      expect(service).toBeDefined();
    });

    it('should support lemon-squeezy provider', () => {
      const service = createBillingGatewayService('lemon-squeezy');
      expect(service).toBeDefined();
    });

    it('should support paddle provider', () => {
      const service = createBillingGatewayService('paddle');
      expect(service).toBeDefined();
    });
  });
});
