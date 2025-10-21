import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import server actions after mocks
import {
  createBillingPortalSession,
  createTeamAccountCheckoutSession,
} from '../_lib/server/server-actions';
import { createTeamBillingService } from '../_lib/server/team-billing.service';

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
    enableTeamAccountBilling: true,
  },
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

vi.mock('../_lib/server/team-billing.service', () => ({
  createTeamBillingService: vi.fn(),
}));

// Get mocked functions
const mockCreateTeamBillingService = vi.mocked(createTeamBillingService);

describe('Team Billing Server Actions', () => {
  let mockCreateCheckout: ReturnType<typeof vi.fn>;
  let mockCreateBillingPortalSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock service methods
    mockCreateCheckout = vi.fn().mockResolvedValue({
      url: 'https://stripe.com/checkout/team_session_123',
    });

    mockCreateBillingPortalSession = vi
      .fn()
      .mockResolvedValue('https://stripe.com/portal/team');

    mockCreateTeamBillingService.mockReturnValue({
      createCheckout: mockCreateCheckout,
      createBillingPortalSession: mockCreateBillingPortalSession,
    } as any);
  });

  describe('createTeamAccountCheckoutSession', () => {
    it('should create checkout session with valid data', async () => {
      const input = {
        slug: 'my-team',
        productId: 'prod_team_123',
        planId: 'price_team_123',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = await createTeamAccountCheckoutSession(input);

      expect(result).toEqual({
        url: 'https://stripe.com/checkout/team_session_123',
      });
    });

    it('should call createCheckout with correct data', async () => {
      const input = {
        slug: 'engineering-team',
        productId: 'prod_456',
        planId: 'price_456',
        accountId: '550e8400-e29b-41d4-a716-446655440001',
      };

      await createTeamAccountCheckoutSession(input);

      expect(mockCreateCheckout).toHaveBeenCalledWith(input);
    });

    it('should reject empty slug', async () => {
      const input = {
        slug: '',
        productId: 'prod_123',
        planId: 'price_123',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      await expect(createTeamAccountCheckoutSession(input)).rejects.toThrow();
    });

    it('should reject invalid accountId', async () => {
      const input = {
        slug: 'my-team',
        productId: 'prod_123',
        planId: 'price_123',
        accountId: 'not-a-valid-uuid',
      };

      await expect(createTeamAccountCheckoutSession(input)).rejects.toThrow();
    });

    it('should reject empty planId', async () => {
      const input = {
        slug: 'my-team',
        productId: 'prod_123',
        planId: '',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      await expect(createTeamAccountCheckoutSession(input)).rejects.toThrow();
    });

    it('should reject empty productId', async () => {
      const input = {
        slug: 'my-team',
        productId: '',
        planId: 'price_123',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      await expect(createTeamAccountCheckoutSession(input)).rejects.toThrow();
    });

    it('should handle service errors gracefully', async () => {
      mockCreateCheckout.mockRejectedValue(
        new Error('Stripe API error for team'),
      );

      const input = {
        slug: 'my-team',
        productId: 'prod_123',
        planId: 'price_123',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      await expect(createTeamAccountCheckoutSession(input)).rejects.toThrow(
        'Stripe API error for team',
      );
    });

    it('should create service with Supabase client', async () => {
      const input = {
        slug: 'my-team',
        productId: 'prod_123',
        planId: 'price_123',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      await createTeamAccountCheckoutSession(input);

      expect(mockCreateTeamBillingService).toHaveBeenCalledWith({});
    });

    it('should handle different team plan types', async () => {
      const testCases = [
        {
          slug: 'team-basic',
          productId: 'prod_basic',
          planId: 'price_monthly',
          accountId: '550e8400-e29b-41d4-a716-446655440000',
        },
        {
          slug: 'team-pro',
          productId: 'prod_pro',
          planId: 'price_yearly',
          accountId: '550e8400-e29b-41d4-a716-446655440001',
        },
        {
          slug: 'team-enterprise',
          productId: 'prod_enterprise',
          planId: 'price_enterprise',
          accountId: '550e8400-e29b-41d4-a716-446655440002',
        },
      ];

      for (const input of testCases) {
        mockCreateCheckout.mockResolvedValue({
          url: `https://stripe.com/checkout/${input.slug}`,
        });

        const result = await createTeamAccountCheckoutSession(input);

        expect(result.url).toContain(input.slug);
        expect(mockCreateCheckout).toHaveBeenCalledWith(input);
      }
    });
  });

  describe('createBillingPortalSession', () => {
    it('should redirect to billing portal', async () => {
      const formData = new FormData();
      formData.append('accountId', '550e8400-e29b-41d4-a716-446655440000');
      formData.append('slug', 'my-team');

      try {
        await createBillingPortalSession(formData);
        expect.fail('Expected redirect to be thrown');
      } catch (error) {
        expect((error as Error).message).toBe(
          'NEXT_REDIRECT;https://stripe.com/portal/team',
        );
      }
    });

    it('should call createBillingPortalSession with parsed params', async () => {
      const formData = new FormData();
      formData.append('accountId', '550e8400-e29b-41d4-a716-446655440000');
      formData.append('slug', 'engineering-team');

      try {
        await createBillingPortalSession(formData);
      } catch {
        // Expected redirect
      }

      expect(mockCreateBillingPortalSession).toHaveBeenCalledWith({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        slug: 'engineering-team',
      });
    });

    it('should reject invalid accountId in form data', async () => {
      const formData = new FormData();
      formData.append('accountId', 'invalid-uuid');
      formData.append('slug', 'my-team');

      await expect(createBillingPortalSession(formData)).rejects.toThrow();
    });

    it('should reject empty slug in form data', async () => {
      const formData = new FormData();
      formData.append('accountId', '550e8400-e29b-41d4-a716-446655440000');
      formData.append('slug', '');

      await expect(createBillingPortalSession(formData)).rejects.toThrow();
    });

    it('should handle service errors', async () => {
      mockCreateBillingPortalSession.mockRejectedValue(
        new Error('Team portal creation failed'),
      );

      const formData = new FormData();
      formData.append('accountId', '550e8400-e29b-41d4-a716-446655440000');
      formData.append('slug', 'my-team');

      await expect(createBillingPortalSession(formData)).rejects.toThrow(
        'Team portal creation failed',
      );
    });

    it('should redirect to different portal URLs', async () => {
      const portalUrls = [
        'https://stripe.com/portal/team_1',
        'https://stripe.com/portal/team_2',
        'https://billing.example.com/team-portal',
      ];

      for (const url of portalUrls) {
        mockCreateBillingPortalSession.mockResolvedValue(url);

        const formData = new FormData();
        formData.append('accountId', '550e8400-e29b-41d4-a716-446655440000');
        formData.append('slug', 'my-team');

        try {
          await createBillingPortalSession(formData);
        } catch (error) {
          expect((error as Error).message).toBe(`NEXT_REDIRECT;${url}`);
        }
      }
    });
  });

  describe('Input Validation', () => {
    it('should validate slug format for checkout', async () => {
      const invalidInputs = [
        {
          slug: null,
          productId: 'prod_123',
          planId: 'price_123',
          accountId: '550e8400-e29b-41d4-a716-446655440000',
        },
        {
          slug: undefined,
          productId: 'prod_123',
          planId: 'price_123',
          accountId: '550e8400-e29b-41d4-a716-446655440000',
        },
        {
          slug: 123,
          productId: 'prod_123',
          planId: 'price_123',
          accountId: '550e8400-e29b-41d4-a716-446655440000',
        },
      ];

      for (const input of invalidInputs) {
        await expect(
          createTeamAccountCheckoutSession(input as any),
        ).rejects.toThrow();
      }
    });

    it('should validate accountId format', async () => {
      const invalidInputs = [
        {
          slug: 'my-team',
          productId: 'prod_123',
          planId: 'price_123',
          accountId: 'not-a-uuid',
        },
        {
          slug: 'my-team',
          productId: 'prod_123',
          planId: 'price_123',
          accountId: null,
        },
        {
          slug: 'my-team',
          productId: 'prod_123',
          planId: 'price_123',
          accountId: undefined,
        },
      ];

      for (const input of invalidInputs) {
        await expect(
          createTeamAccountCheckoutSession(input as any),
        ).rejects.toThrow();
      }
    });

    it('should accept valid inputs', async () => {
      const validInput = {
        slug: 'valid-team-slug',
        productId: 'prod_valid_456',
        planId: 'price_valid_123',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = await createTeamAccountCheckoutSession(validInput);

      expect(result).toBeDefined();
      expect(result.url).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long slugs', async () => {
      const input = {
        slug: 'team-' + 'a'.repeat(200),
        productId: 'prod_123',
        planId: 'price_123',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = await createTeamAccountCheckoutSession(input);

      expect(result).toBeDefined();
      expect(mockCreateCheckout).toHaveBeenCalledWith(input);
    });

    it('should handle special characters in slugs', async () => {
      const input = {
        slug: 'team-test_v2.0',
        productId: 'prod_test-product_v1.0',
        planId: 'price_test-plan_v2.0',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = await createTeamAccountCheckoutSession(input);

      expect(result).toBeDefined();
    });

    it('should handle concurrent checkout session creations', async () => {
      const inputs = Array.from({ length: 5 }, (_, i) => ({
        slug: `team-${i}`,
        productId: `prod_${i}`,
        planId: `price_${i}`,
        accountId: `550e8400-e29b-41d4-a716-44665544000${i}`,
      }));

      const results = await Promise.all(
        inputs.map((input) => createTeamAccountCheckoutSession(input)),
      );

      expect(results).toHaveLength(5);
      expect(mockCreateCheckout).toHaveBeenCalledTimes(5);
    });

    it('should handle concurrent portal session creations', async () => {
      const promises = Array.from({ length: 3 }, () =>
        (async () => {
          const formData = new FormData();
          formData.append('accountId', '550e8400-e29b-41d4-a716-446655440000');
          formData.append('slug', 'my-team');

          try {
            await createBillingPortalSession(formData);
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
      const expectedUrl = 'https://custom-domain.com/checkout/team-abc123';
      mockCreateCheckout.mockResolvedValue({ url: expectedUrl });

      const input = {
        slug: 'my-team',
        productId: 'prod_123',
        planId: 'price_123',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = await createTeamAccountCheckoutSession(input);

      expect(result.url).toBe(expectedUrl);
    });

    it('should handle checkout session with additional metadata', async () => {
      mockCreateCheckout.mockResolvedValue({
        url: 'https://stripe.com/checkout/team-session',
        sessionId: 'cs_team_test_123',
        customerId: 'cus_team_test_456',
      });

      const input = {
        slug: 'my-team',
        productId: 'prod_123',
        planId: 'price_123',
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const result = await createTeamAccountCheckoutSession(input);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('sessionId');
      expect(result).toHaveProperty('customerId');
    });
  });
});
