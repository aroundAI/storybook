import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBillingGatewayService } from '../src/server/services/billing-gateway/billing-gateway.service';
import { billingStrategyRegistry } from '../src/server/services/billing-gateway/billing-gateway-registry';
import { getBillingGatewayProvider } from '../src/server/services/billing-gateway/billing-gateway-provider-factory';

// Mock the billing strategy
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

// Mock Supabase client
const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(),
    })),
  })),
};

describe('BillingGatewayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock the registry to return our mock strategy
    vi.spyOn(billingStrategyRegistry, 'get').mockResolvedValue(mockStrategy);
  });

  describe('Factory function', () => {
    it('should create billing gateway service with provider', () => {
      const service = createBillingGatewayService('stripe');

      expect(service).toBeDefined();
      expect(typeof service.createCheckoutSession).toBe('function');
      expect(typeof service.retrieveCheckoutSession).toBe('function');
      expect(typeof service.createBillingPortalSession).toBe('function');
      expect(typeof service.cancelSubscription).toBe('function');
      expect(typeof service.reportUsage).toBe('function');
      expect(typeof service.queryUsage).toBe('function');
      expect(typeof service.getPlanById).toBe('function');
      expect(typeof service.updateSubscriptionItem).toBe('function');
      expect(typeof service.getSubscription).toBe('function');
    });
  });

  describe('Provider factory', () => {
    it('should retrieve provider from database and create service', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { billing_provider: 'stripe' },
            error: null,
          }),
        })),
      }));

      const service = await getBillingGatewayProvider(
        mockSupabaseClient as never,
      );

      expect(service).toBeDefined();
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('config');
    });

    it('should throw error when billing provider not found', async () => {
      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { billing_provider: null },
            error: null,
          }),
        })),
      }));

      await expect(
        getBillingGatewayProvider(mockSupabaseClient as never),
      ).rejects.toThrow();
    });

    it('should throw error on database error', async () => {
      const dbError = new Error('Database connection failed');

      mockSupabaseClient.from = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: dbError,
          }),
        })),
      }));

      await expect(
        getBillingGatewayProvider(mockSupabaseClient as never),
      ).rejects.toThrow();
    });
  });

  describe('Strategy delegation', () => {
    it('should delegate getPlanById to strategy', async () => {
      const service = createBillingGatewayService('stripe');

      mockStrategy.getPlanById.mockResolvedValueOnce({
        id: 'price_123',
        name: 'Pro Plan',
      });

      const result = await service.getPlanById('price_123');

      expect(result).toEqual({
        id: 'price_123',
        name: 'Pro Plan',
      });

      expect(billingStrategyRegistry.get).toHaveBeenCalledWith('stripe');
      expect(mockStrategy.getPlanById).toHaveBeenCalledWith('price_123');
    });

    it('should delegate getSubscription to strategy', async () => {
      const service = createBillingGatewayService('stripe');

      mockStrategy.getSubscription.mockResolvedValueOnce({
        id: 'sub_123',
        status: 'active',
      });

      const result = await service.getSubscription('sub_123');

      expect(result).toEqual({
        id: 'sub_123',
        status: 'active',
      });

      expect(mockStrategy.getSubscription).toHaveBeenCalledWith('sub_123');
    });
  });

  describe('Provider selection', () => {
    it('should use stripe provider strategy', async () => {
      const service = createBillingGatewayService('stripe');

      mockStrategy.getPlanById.mockResolvedValueOnce({ id: 'plan_1' });

      await service.getPlanById('plan_1');

      expect(billingStrategyRegistry.get).toHaveBeenCalledWith('stripe');
    });

    it('should use lemon-squeezy provider strategy', async () => {
      const service = createBillingGatewayService('lemon-squeezy');

      mockStrategy.getPlanById.mockResolvedValueOnce({ id: 'plan_1' });

      await service.getPlanById('plan_1');

      expect(billingStrategyRegistry.get).toHaveBeenCalledWith('lemon-squeezy');
    });

    it('should use paddle provider strategy', async () => {
      const service = createBillingGatewayService('paddle');

      mockStrategy.getPlanById.mockResolvedValueOnce({ id: 'plan_1' });

      await service.getPlanById('plan_1');

      expect(billingStrategyRegistry.get).toHaveBeenCalledWith('paddle');
    });
  });

  describe('Error handling', () => {
    it('should propagate strategy errors', async () => {
      const service = createBillingGatewayService('stripe');

      const strategyError = new Error('Stripe API error');
      mockStrategy.getPlanById.mockRejectedValueOnce(strategyError);

      await expect(service.getPlanById('price_123')).rejects.toThrow(
        'Stripe API error',
      );
    });

    it('should handle registry errors', async () => {
      const service = createBillingGatewayService('stripe');

      vi.spyOn(billingStrategyRegistry, 'get').mockRejectedValueOnce(
        new Error('Provider not found'),
      );

      await expect(service.getPlanById('price_123')).rejects.toThrow(
        'Provider not found',
      );
    });
  });

  describe('Registry configuration', () => {
    it('should throw error for paddle provider (not implemented)', async () => {
      // Restore real registry for this test
      vi.restoreAllMocks();

      await expect(billingStrategyRegistry.get('paddle')).rejects.toThrow(
        'Paddle is not supported yet',
      );
    });

    it('should throw error for unknown provider', async () => {
      // Restore real registry for this test
      vi.restoreAllMocks();

      await expect(
        billingStrategyRegistry.get('unknown-provider' as never),
      ).rejects.toThrow();
    });
  });
});
