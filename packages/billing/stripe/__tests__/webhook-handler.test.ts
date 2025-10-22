import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StripeWebhookHandlerService } from '../src/services/stripe-webhook-handler.service';

// Mock the stripe SDK
const mockConstructEventAsync = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();
const mockCheckoutSessionsRetrieve = vi.fn();

vi.mock('../src/services/stripe-sdk', () => ({
  createStripeClient: vi.fn(() =>
    Promise.resolve({
      webhooks: {
        constructEventAsync: mockConstructEventAsync,
      },
      subscriptions: {
        retrieve: mockSubscriptionsRetrieve,
      },
      checkout: {
        sessions: {
          retrieve: mockCheckoutSessionsRetrieve,
        },
      },
    }),
  ),
}));

// Mock the subscription payload builder
const mockPayloadBuilderBuild = vi.fn();
const mockGetPeriodStartsAt = vi.fn();
const mockGetPeriodEndsAt = vi.fn();

vi.mock('../src/services/stripe-subscription-payload-builder.service', () => ({
  createStripeSubscriptionPayloadBuilderService: vi.fn(() => ({
    build: mockPayloadBuilderBuild,
    getPeriodStartsAt: mockGetPeriodStartsAt,
    getPeriodEndsAt: mockGetPeriodEndsAt,
  })),
}));

// Mock environment schema
vi.mock('../src/schema/stripe-server-env.schema', () => ({
  StripeServerEnvSchema: {
    parse: vi.fn(() => ({
      secretKey: 'sk_test_123',
      webhooksSecret: 'whsec_test_123',
    })),
  },
}));

// Mock logger
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  ),
}));

describe('StripeWebhookHandlerService', () => {
  let service: StripeWebhookHandlerService;
  let mockRequest: Request;
  const planTypesMap = new Map([
    ['price_123', 'flat' as const],
    ['price_456', 'per_seat' as const],
    ['price_789', 'metered' as const],
  ]);

  beforeEach(() => {
    vi.clearAllMocks();

    service = new StripeWebhookHandlerService(planTypesMap);

    // Create mock request
    mockRequest = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 't=123,v1=signature',
      },
      body: JSON.stringify({ type: 'test.event' }),
    });

    // Set default environment variables
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';
  });

  describe('verifyWebhookSignature', () => {
    it('should verify valid webhook signature', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {} as Stripe.Event.Data.Object,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'checkout.session.completed',
      };

      mockConstructEventAsync.mockResolvedValue(mockEvent);

      const result = await service.verifyWebhookSignature(mockRequest);

      expect(result).toBe(mockEvent);
      expect(mockConstructEventAsync).toHaveBeenCalledWith(
        expect.any(String),
        't=123,v1=signature',
        'whsec_test_123',
      );
    });

    it('should throw error when signature is invalid', async () => {
      mockConstructEventAsync.mockResolvedValue(null);

      await expect(service.verifyWebhookSignature(mockRequest)).rejects.toThrow(
        'Invalid signature',
      );
    });

    it('should throw error when constructEventAsync fails', async () => {
      mockConstructEventAsync.mockRejectedValue(new Error('Invalid signature'));

      await expect(service.verifyWebhookSignature(mockRequest)).rejects.toThrow(
        'Invalid signature',
      );
    });

    it('should read stripe-signature header', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {} as Stripe.Event.Data.Object,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'test.event',
      };

      mockConstructEventAsync.mockResolvedValue(mockEvent);

      await service.verifyWebhookSignature(mockRequest);

      expect(mockConstructEventAsync).toHaveBeenCalledWith(
        expect.any(String),
        't=123,v1=signature',
        expect.any(String),
      );
    });
  });

  describe('handleWebhookEvent - checkout.session.completed', () => {
    it('should handle subscription checkout completion', async () => {
      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        currency: 'usd',
        cancel_at_period_end: false,
        trial_start: null,
        trial_end: null,
        items: {
          object: 'list',
          data: [
            {
              id: 'si_123',
              object: 'subscription_item',
              price: {
                id: 'price_123',
                object: 'price',
                active: true,
                currency: 'usd',
                product: 'prod_123' as any,
                unit_amount: 1000,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                },
              } as Stripe.Price,
              quantity: 1,
            } as Stripe.SubscriptionItem,
          ],
          has_more: false,
          url: '/v1/subscription_items',
        },
      };

      const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {
            id: 'cs_123',
            object: 'checkout.session',
            mode: 'subscription',
            customer: 'cus_123',
            subscription: 'sub_123',
            client_reference_id: 'acc_123',
          } as Stripe.Checkout.Session,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'checkout.session.completed',
      };

      mockSubscriptionsRetrieve.mockResolvedValue(mockSubscription);
      mockGetPeriodStartsAt.mockReturnValue(Date.now());
      mockGetPeriodEndsAt.mockReturnValue(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      );
      mockPayloadBuilderBuild.mockReturnValue({
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        target_subscription_id: 'sub_123',
      });

      const onCheckoutCompleted = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: onCheckoutCompleted,
        onSubscriptionUpdated: vi.fn(),
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid: vi.fn(),
      });

      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_123');
      expect(onCheckoutCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          target_account_id: 'acc_123',
          target_customer_id: 'cus_123',
        }),
      );
    });

    it('should handle one-time payment checkout completion', async () => {
      const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {
            id: 'cs_123',
            object: 'checkout.session',
            mode: 'payment',
            customer: 'cus_123',
            client_reference_id: 'acc_123',
            currency: 'usd',
            payment_status: 'paid',
            amount_total: 5000,
          } as Stripe.Checkout.Session,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'checkout.session.completed',
      };

      const mockSessionWithLineItems = {
        id: 'cs_123',
        payment_status: 'paid',
        amount_total: 5000,
        line_items: {
          data: [
            {
              id: 'li_123',
              quantity: 1,
              price: {
                id: 'price_123',
                product: 'prod_123',
                unit_amount: 5000,
              } as Stripe.Price,
            },
          ],
        },
      };

      mockCheckoutSessionsRetrieve.mockResolvedValue(mockSessionWithLineItems);

      const onCheckoutCompleted = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: onCheckoutCompleted,
        onSubscriptionUpdated: vi.fn(),
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid: vi.fn(),
      });

      expect(mockCheckoutSessionsRetrieve).toHaveBeenCalledWith('cs_123', {
        expand: ['line_items'],
      });

      expect(onCheckoutCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          target_account_id: 'acc_123',
          target_customer_id: 'cus_123',
          target_order_id: 'cs_123',
          billing_provider: 'stripe',
          status: 'succeeded',
          currency: 'usd',
          total_amount: 5000,
        }),
      );
    });

    it('should call onEvent callback when provided', async () => {
      const mockEvent: Stripe.CheckoutSessionCompletedEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {
            id: 'cs_123',
            object: 'checkout.session',
            mode: 'payment',
            customer: 'cus_123',
            client_reference_id: 'acc_123',
            currency: 'usd',
          } as Stripe.Checkout.Session,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'checkout.session.completed',
      };

      mockCheckoutSessionsRetrieve.mockResolvedValue({
        id: 'cs_123',
        payment_status: 'paid',
        amount_total: 5000,
        line_items: { data: [] },
      });

      const onEvent = vi.fn().mockResolvedValue(undefined);
      const onCheckoutCompleted = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: onCheckoutCompleted,
        onSubscriptionUpdated: vi.fn(),
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid: vi.fn(),
        onEvent,
      });

      expect(onEvent).toHaveBeenCalledWith(mockEvent);
    });
  });

  describe('handleWebhookEvent - customer.subscription.updated', () => {
    it('should handle subscription update event', async () => {
      const mockEvent: Stripe.CustomerSubscriptionUpdatedEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            object: 'subscription',
            customer: 'cus_123',
            status: 'active',
            currency: 'usd',
            cancel_at_period_end: false,
            trial_start: null,
            trial_end: null,
            metadata: {
              accountId: 'acc_123',
            },
            items: {
              object: 'list',
              data: [
                {
                  id: 'si_123',
                  object: 'subscription_item',
                  price: {
                    id: 'price_123',
                    object: 'price',
                    product: 'prod_123' as any,
                  } as Stripe.Price,
                  quantity: 1,
                } as Stripe.SubscriptionItem,
              ],
              has_more: false,
              url: '/v1/subscription_items',
            },
          } as Stripe.Subscription,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'customer.subscription.updated',
      };

      mockGetPeriodStartsAt.mockReturnValue(Date.now());
      mockGetPeriodEndsAt.mockReturnValue(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      );
      mockPayloadBuilderBuild.mockReturnValue({
        target_account_id: 'acc_123',
        target_subscription_id: 'sub_123',
      });

      const onSubscriptionUpdated = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: vi.fn(),
        onSubscriptionUpdated,
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid: vi.fn(),
      });

      expect(onSubscriptionUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          target_account_id: 'acc_123',
          target_subscription_id: 'sub_123',
        }),
      );
    });
  });

  describe('handleWebhookEvent - customer.subscription.deleted', () => {
    it('should handle subscription deletion event', async () => {
      const mockEvent: Stripe.CustomerSubscriptionDeletedEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            object: 'subscription',
          } as Stripe.Subscription,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'customer.subscription.deleted',
      };

      const onSubscriptionDeleted = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: vi.fn(),
        onSubscriptionUpdated: vi.fn(),
        onSubscriptionDeleted,
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid: vi.fn(),
      });

      expect(onSubscriptionDeleted).toHaveBeenCalledWith('sub_123');
    });
  });

  describe('handleWebhookEvent - payment events', () => {
    it('should handle async payment succeeded event', async () => {
      const mockEvent: Stripe.CheckoutSessionAsyncPaymentSucceededEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {
            id: 'cs_123',
            object: 'checkout.session',
          } as Stripe.Checkout.Session,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'checkout.session.async_payment_succeeded',
      };

      const onPaymentSucceeded = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: vi.fn(),
        onSubscriptionUpdated: vi.fn(),
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded,
        onPaymentFailed: vi.fn(),
        onInvoicePaid: vi.fn(),
      });

      expect(onPaymentSucceeded).toHaveBeenCalledWith('cs_123');
    });

    it('should handle async payment failed event', async () => {
      const mockEvent: Stripe.CheckoutSessionAsyncPaymentFailedEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {
            id: 'cs_123',
            object: 'checkout.session',
          } as Stripe.Checkout.Session,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'checkout.session.async_payment_failed',
      };

      const onPaymentFailed = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: vi.fn(),
        onSubscriptionUpdated: vi.fn(),
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed,
        onInvoicePaid: vi.fn(),
      });

      expect(onPaymentFailed).toHaveBeenCalledWith('cs_123');
    });
  });

  describe('handleWebhookEvent - invoice.paid', () => {
    it('should handle invoice paid event with subscription', async () => {
      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        currency: 'usd',
        cancel_at_period_end: false,
        trial_start: null,
        trial_end: null,
        metadata: {
          accountId: 'acc_123',
        },
        items: {
          object: 'list',
          data: [
            {
              id: 'si_123',
              object: 'subscription_item',
              price: {
                id: 'price_123',
                object: 'price',
                product: 'prod_123' as any,
              } as Stripe.Price,
              quantity: 1,
            } as Stripe.SubscriptionItem,
          ],
          has_more: false,
          url: '/v1/subscription_items',
        },
      };

      const mockEvent: Stripe.InvoicePaidEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {
            id: 'in_123',
            object: 'invoice',
            customer: 'cus_123',
            subscription: 'sub_123',
          } as Stripe.Invoice,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'invoice.paid',
      };

      mockSubscriptionsRetrieve.mockResolvedValue(mockSubscription);
      mockGetPeriodStartsAt.mockReturnValue(Date.now());
      mockGetPeriodEndsAt.mockReturnValue(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      );
      mockPayloadBuilderBuild.mockReturnValue({
        target_account_id: 'acc_123',
        target_subscription_id: 'sub_123',
      });

      const onInvoicePaid = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: vi.fn(),
        onSubscriptionUpdated: vi.fn(),
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid,
      });

      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_123');
      expect(onInvoicePaid).toHaveBeenCalledWith(
        expect.objectContaining({
          target_account_id: 'acc_123',
          target_subscription_id: 'sub_123',
        }),
      );
    });

    it('should handle invoice without subscription gracefully', async () => {
      const mockEvent: Stripe.InvoicePaidEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {
            id: 'in_123',
            object: 'invoice',
            customer: 'cus_123',
            subscription: null,
          } as Stripe.Invoice,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'invoice.paid',
      };

      const onInvoicePaid = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: vi.fn(),
        onSubscriptionUpdated: vi.fn(),
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid,
      });

      // Should not call onInvoicePaid if no subscription
      expect(onInvoicePaid).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhookEvent - unhandled events', () => {
    it('should call onEvent for unhandled event types', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {} as Stripe.Event.Data.Object,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'customer.created' as any,
      };

      const onEvent = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: vi.fn(),
        onSubscriptionUpdated: vi.fn(),
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid: vi.fn(),
        onEvent,
      });

      expect(onEvent).toHaveBeenCalledWith(mockEvent);
    });

    it('should handle unhandled event without onEvent callback', async () => {
      const mockEvent: Stripe.Event = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: {} as Stripe.Event.Data.Object,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'customer.created' as any,
      };

      // Should not throw error when no onEvent callback
      await expect(
        service.handleWebhookEvent(mockEvent, {
          onCheckoutSessionCompleted: vi.fn(),
          onSubscriptionUpdated: vi.fn(),
          onSubscriptionDeleted: vi.fn(),
          onPaymentSucceeded: vi.fn(),
          onPaymentFailed: vi.fn(),
          onInvoicePaid: vi.fn(),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('Plan Types Map', () => {
    it('should use plan type from map for known price IDs', async () => {
      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        currency: 'usd',
        cancel_at_period_end: false,
        trial_start: null,
        trial_end: null,
        metadata: {
          accountId: 'acc_123',
        },
        items: {
          object: 'list',
          data: [
            {
              id: 'si_456',
              object: 'subscription_item',
              price: {
                id: 'price_456', // per_seat type in map
                object: 'price',
                product: 'prod_456' as any,
                unit_amount: 1000,
                recurring: {
                  interval: 'month',
                  interval_count: 1,
                },
              } as Stripe.Price,
              quantity: 5,
            } as Stripe.SubscriptionItem,
          ],
          has_more: false,
          url: '/v1/subscription_items',
        },
      };

      const mockEvent: Stripe.CustomerSubscriptionUpdatedEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: mockSubscription as Stripe.Subscription,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'customer.subscription.updated',
      };

      mockGetPeriodStartsAt.mockReturnValue(Date.now());
      mockGetPeriodEndsAt.mockReturnValue(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      );

      const onSubscriptionUpdated = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: vi.fn(),
        onSubscriptionUpdated,
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid: vi.fn(),
      });

      // Verify that line items include the type from the map
      expect(mockPayloadBuilderBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          lineItems: expect.arrayContaining([
            expect.objectContaining({
              type: 'per_seat',
            }),
          ]),
        }),
      );
    });

    it('should default to flat type for unknown price IDs', async () => {
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const mockSubscription: Partial<Stripe.Subscription> = {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        currency: 'usd',
        cancel_at_period_end: false,
        trial_start: null,
        trial_end: null,
        metadata: {
          accountId: 'acc_123',
        },
        items: {
          object: 'list',
          data: [
            {
              id: 'si_999',
              object: 'subscription_item',
              price: {
                id: 'price_unknown', // Not in map
                object: 'price',
                product: 'prod_999' as any,
              } as Stripe.Price,
              quantity: 1,
            } as Stripe.SubscriptionItem,
          ],
          has_more: false,
          url: '/v1/subscription_items',
        },
      };

      const mockEvent: Stripe.CustomerSubscriptionUpdatedEvent = {
        id: 'evt_123',
        object: 'event',
        api_version: '2023-10-16',
        created: Date.now(),
        data: {
          object: mockSubscription as Stripe.Subscription,
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'customer.subscription.updated',
      };

      mockGetPeriodStartsAt.mockReturnValue(Date.now());
      mockGetPeriodEndsAt.mockReturnValue(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      );

      const onSubscriptionUpdated = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockEvent, {
        onCheckoutSessionCompleted: vi.fn(),
        onSubscriptionUpdated,
        onSubscriptionDeleted: vi.fn(),
        onPaymentSucceeded: vi.fn(),
        onPaymentFailed: vi.fn(),
        onInvoicePaid: vi.fn(),
      });

      // Should warn about unknown price ID
      expect(consoleWarnSpy).toHaveBeenCalled();

      // Should default to 'flat' type
      expect(mockPayloadBuilderBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          lineItems: expect.arrayContaining([
            expect.objectContaining({
              type: 'flat',
            }),
          ]),
        }),
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
