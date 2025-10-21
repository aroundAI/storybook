import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Import server actions after mocks
import {
  createPersonalAccountBillingPortalSession,
  createPersonalAccountCheckoutSession,
} from '../_lib/server/server-actions';
import { createUserBillingService } from '../_lib/server/user-billing.service';

// Mock dependencies before importing server actions
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({})),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: vi.fn(() =>
    Promise.resolve({
      data: {
        id: 'user-id-123',
        email: 'user@example.com',
      },
      error: null,
    }),
  ),
}));

vi.mock('~/config/feature-flags.config', () => ({
  default: {
    enablePersonalAccountBilling: true,
  },
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

vi.mock('../_lib/server/user-billing.service', () => ({
  createUserBillingService: vi.fn(),
}));

// Get mocked functions
const mockCreateUserBillingService = vi.mocked(createUserBillingService);
const mockGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);

describe('User Billing Server Actions', () => {
  let mockCreateCheckoutSession: ReturnType<typeof vi.fn>;
  let mockCreateBillingPortalSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock service methods
    mockCreateCheckoutSession = vi.fn().mockResolvedValue({
      url: 'https://stripe.com/checkout/session_123',
    });

    mockCreateBillingPortalSession = vi
      .fn()
      .mockResolvedValue('https://stripe.com/portal');

    mockCreateUserBillingService.mockReturnValue({
      createCheckoutSession: mockCreateCheckoutSession,
      createBillingPortalSession: mockCreateBillingPortalSession,
    } as any);
  });

  describe('createPersonalAccountCheckoutSession', () => {
    it('should create checkout session with valid data', async () => {
      const input = {
        planId: 'price_123',
        productId: 'prod_123',
      };

      const result = await createPersonalAccountCheckoutSession(input);

      expect(result).toEqual({
        url: 'https://stripe.com/checkout/session_123',
      });
    });

    it('should call createCheckoutSession with correct data', async () => {
      const input = {
        planId: 'price_456',
        productId: 'prod_456',
      };

      await createPersonalAccountCheckoutSession(input);

      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(input);
    });

    it('should reject empty planId', async () => {
      const input = {
        planId: '',
        productId: 'prod_123',
      };

      await expect(
        createPersonalAccountCheckoutSession(input),
      ).rejects.toThrow();
    });

    it('should reject empty productId', async () => {
      const input = {
        planId: 'price_123',
        productId: '',
      };

      await expect(
        createPersonalAccountCheckoutSession(input),
      ).rejects.toThrow();
    });

    it('should reject missing planId', async () => {
      const input = {
        productId: 'prod_123',
      } as any;

      await expect(
        createPersonalAccountCheckoutSession(input),
      ).rejects.toThrow();
    });

    it('should reject missing productId', async () => {
      const input = {
        planId: 'price_123',
      } as any;

      await expect(
        createPersonalAccountCheckoutSession(input),
      ).rejects.toThrow();
    });

    it('should handle service errors gracefully', async () => {
      mockCreateCheckoutSession.mockRejectedValue(
        new Error('Stripe API error'),
      );

      const input = {
        planId: 'price_123',
        productId: 'prod_123',
      };

      await expect(createPersonalAccountCheckoutSession(input)).rejects.toThrow(
        'Stripe API error',
      );
    });

    it('should create service with Supabase client', async () => {
      const input = {
        planId: 'price_123',
        productId: 'prod_123',
      };

      await createPersonalAccountCheckoutSession(input);

      expect(mockCreateUserBillingService).toHaveBeenCalledWith({});
    });

    it('should handle different plan types', async () => {
      const testCases = [
        { planId: 'price_monthly', productId: 'prod_basic' },
        { planId: 'price_yearly', productId: 'prod_pro' },
        { planId: 'price_enterprise', productId: 'prod_enterprise' },
      ];

      for (const input of testCases) {
        mockCreateCheckoutSession.mockResolvedValue({
          url: `https://stripe.com/checkout/${input.planId}`,
        });

        const result = await createPersonalAccountCheckoutSession(input);

        expect(result.url).toContain(input.planId);
        expect(mockCreateCheckoutSession).toHaveBeenCalledWith(input);
      }
    });
  });

  describe('createPersonalAccountBillingPortalSession', () => {
    it('should redirect to billing portal', async () => {
      try {
        await createPersonalAccountBillingPortalSession();
        expect.fail('Expected redirect to be thrown');
      } catch (error) {
        expect((error as Error).message).toBe(
          'NEXT_REDIRECT;https://stripe.com/portal',
        );
      }
    });

    it('should call createBillingPortalSession', async () => {
      try {
        await createPersonalAccountBillingPortalSession();
      } catch {
        // Expected redirect
      }

      expect(mockCreateBillingPortalSession).toHaveBeenCalledTimes(1);
    });

    it('should create service with Supabase client', async () => {
      try {
        await createPersonalAccountBillingPortalSession();
      } catch {
        // Expected redirect
      }

      expect(mockCreateUserBillingService).toHaveBeenCalledWith({});
    });

    it('should handle service errors', async () => {
      mockCreateBillingPortalSession.mockRejectedValue(
        new Error('Portal creation failed'),
      );

      await expect(createPersonalAccountBillingPortalSession()).rejects.toThrow(
        'Portal creation failed',
      );
    });

    it('should redirect to different portal URLs', async () => {
      const portalUrls = [
        'https://stripe.com/portal/session_1',
        'https://stripe.com/portal/session_2',
        'https://billing.example.com/portal',
      ];

      for (const url of portalUrls) {
        mockCreateBillingPortalSession.mockResolvedValue(url);

        try {
          await createPersonalAccountBillingPortalSession();
        } catch (error) {
          expect((error as Error).message).toBe(`NEXT_REDIRECT;${url}`);
        }
      }
    });
  });

  describe('Input Validation', () => {
    it('should validate planId format', async () => {
      const invalidInputs = [
        { planId: null, productId: 'prod_123' },
        { planId: undefined, productId: 'prod_123' },
        { planId: 123, productId: 'prod_123' },
        { planId: {}, productId: 'prod_123' },
        { planId: [], productId: 'prod_123' },
      ];

      for (const input of invalidInputs) {
        await expect(
          createPersonalAccountCheckoutSession(input as any),
        ).rejects.toThrow();
      }
    });

    it('should validate productId format', async () => {
      const invalidInputs = [
        { planId: 'price_123', productId: null },
        { planId: 'price_123', productId: undefined },
        { planId: 'price_123', productId: 123 },
        { planId: 'price_123', productId: {} },
        { planId: 'price_123', productId: [] },
      ];

      for (const input of invalidInputs) {
        await expect(
          createPersonalAccountCheckoutSession(input as any),
        ).rejects.toThrow();
      }
    });

    it('should accept valid string inputs only', async () => {
      const validInput = {
        planId: 'price_valid_123',
        productId: 'prod_valid_456',
      };

      const result = await createPersonalAccountCheckoutSession(validInput);

      expect(result).toBeDefined();
      expect(result.url).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long plan IDs', async () => {
      const input = {
        planId: 'price_' + 'a'.repeat(200),
        productId: 'prod_123',
      };

      const result = await createPersonalAccountCheckoutSession(input);

      expect(result).toBeDefined();
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(input);
    });

    it('should handle special characters in IDs', async () => {
      const input = {
        planId: 'price_test-plan_v2.0',
        productId: 'prod_test-product_v1.0',
      };

      const result = await createPersonalAccountCheckoutSession(input);

      expect(result).toBeDefined();
    });

    it('should handle concurrent checkout session creations', async () => {
      const inputs = Array.from({ length: 5 }, (_, i) => ({
        planId: `price_${i}`,
        productId: `prod_${i}`,
      }));

      const results = await Promise.all(
        inputs.map((input) => createPersonalAccountCheckoutSession(input)),
      );

      expect(results).toHaveLength(5);
      expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(5);
    });

    it('should handle concurrent portal session creations', async () => {
      const promises = Array.from({ length: 3 }, () =>
        (async () => {
          try {
            await createPersonalAccountBillingPortalSession();
          } catch {
            // Expected redirect
          }
        })(),
      );

      await Promise.all(promises);

      expect(mockCreateBillingPortalSession).toHaveBeenCalledTimes(3);
    });
  });

  describe('Return Values', () => {
    it('should return checkout URL from service', async () => {
      const expectedUrl = 'https://custom-domain.com/checkout/abc123';
      mockCreateCheckoutSession.mockResolvedValue({ url: expectedUrl });

      const input = {
        planId: 'price_123',
        productId: 'prod_123',
      };

      const result = await createPersonalAccountCheckoutSession(input);

      expect(result.url).toBe(expectedUrl);
    });

    it('should handle checkout session with additional metadata', async () => {
      mockCreateCheckoutSession.mockResolvedValue({
        url: 'https://stripe.com/checkout/session',
        sessionId: 'cs_test_123',
        customerId: 'cus_test_456',
      });

      const input = {
        planId: 'price_123',
        productId: 'prod_123',
      };

      const result = await createPersonalAccountCheckoutSession(input);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('customerId');
    });
  });
});
