import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingWebhookHandlerService } from '@kit/billing';
import type {
  UpsertOrderParams,
  UpsertSubscriptionParams,
} from '@kit/billing/types';

import { createBillingEventHandlerService } from '../src/server/services/billing-event-handler/billing-event-handler.service';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() => Promise.resolve(mockLogger)),
}));

// Mock strategy
const mockVerifyWebhookSignature = vi.fn();
const mockHandleWebhookEvent = vi.fn();

const mockStrategy: BillingWebhookHandlerService = {
  verifyWebhookSignature: mockVerifyWebhookSignature,
  handleWebhookEvent: mockHandleWebhookEvent,
};

// Mock Supabase client
let mockSupabaseClient: any;

describe('BillingEventHandlerService', () => {
  let service: ReturnType<typeof createBillingEventHandlerService>;
  let mockRequest: Request;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock client before each test
    mockSupabaseClient = {
      from: vi.fn(() => ({
        delete: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        match: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    };

    service = createBillingEventHandlerService(
      () => mockSupabaseClient as any,
      mockStrategy,
    );

    mockRequest = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 't=123,v1=signature',
      },
      body: JSON.stringify({ type: 'test.event' }),
    });
  });

  describe('handleWebhookEvent - signature verification', () => {
    it('should verify webhook signature before processing', async () => {
      const mockEvent = { id: 'evt_123', type: 'test.event' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);
      mockHandleWebhookEvent.mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockRequest);

      expect(mockVerifyWebhookSignature).toHaveBeenCalledWith(mockRequest);
      expect(mockHandleWebhookEvent).toHaveBeenCalled();
    });

    it('should throw error when signature verification fails', async () => {
      mockVerifyWebhookSignature.mockResolvedValue(null);

      await expect(service.handleWebhookEvent(mockRequest)).rejects.toThrow(
        'Invalid signature',
      );

      expect(mockHandleWebhookEvent).not.toHaveBeenCalled();
    });

    it('should throw error when signature verification throws', async () => {
      mockVerifyWebhookSignature.mockRejectedValue(
        new Error('Invalid signature'),
      );

      await expect(service.handleWebhookEvent(mockRequest)).rejects.toThrow(
        'Invalid signature',
      );

      expect(mockHandleWebhookEvent).not.toHaveBeenCalled();
    });
  });

  describe('onSubscriptionDeleted', () => {
    it('should delete subscription from database', async () => {
      const mockEvent = { id: 'evt_123', type: 'subscription.deleted' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      // Call the onSubscriptionDeleted handler
      await capturedHandlers.onSubscriptionDeleted('sub_123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('subscriptions');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'billing',
          subscriptionId: 'sub_123',
        }),
        'Processing subscription deleted event...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub_123',
        }),
        'Successfully deleted subscription',
      );
    });

    it('should call custom handler when provided', async () => {
      const mockEvent = { id: 'evt_123', type: 'subscription.deleted' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      const onSubscriptionDeleted = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockRequest, {
        onSubscriptionDeleted,
      });

      await capturedHandlers.onSubscriptionDeleted('sub_123');

      expect(onSubscriptionDeleted).toHaveBeenCalledWith('sub_123');
    });

    it('should throw error when database deletion fails', async () => {
      const mockEvent = { id: 'evt_123', type: 'subscription.deleted' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      mockSupabaseClient.from.mockReturnValue({
        delete: vi.fn().mockReturnThis(),
        match: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { message: 'Database error' },
          }),
        ),
      } as any);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      await expect(
        capturedHandlers.onSubscriptionDeleted('sub_123'),
      ).rejects.toThrow('Failed to delete subscription');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { message: 'Database error' },
          subscriptionId: 'sub_123',
        }),
        'Failed to delete subscription',
      );
    });
  });

  describe('onSubscriptionUpdated', () => {
    it('should update subscription in database via RPC', async () => {
      const mockEvent = { id: 'evt_123', type: 'subscription.updated' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      const subscriptionPayload: UpsertSubscriptionParams = {
        target_subscription_id: 'sub_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'active',
        currency: 'usd',
        interval: 'month',
        interval_count: 1,
        period_starts_at: Date.now(),
        period_ends_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancel_at_period_end: false,
        line_items: [],
      };

      await capturedHandlers.onSubscriptionUpdated(subscriptionPayload);

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'upsert_subscription',
        subscriptionPayload,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'billing',
          subscriptionId: 'sub_123',
          provider: 'stripe',
          accountId: 'acc_123',
          customerId: 'cus_123',
        }),
        'Processing subscription updated event ...',
      );
    });

    it('should call custom handler when provided', async () => {
      const mockEvent = { id: 'evt_123', type: 'subscription.updated' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      const onSubscriptionUpdated = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockRequest, {
        onSubscriptionUpdated,
      });

      const subscriptionPayload: UpsertSubscriptionParams = {
        target_subscription_id: 'sub_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'active',
        currency: 'usd',
        interval: 'month',
        interval_count: 1,
        period_starts_at: Date.now(),
        period_ends_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancel_at_period_end: false,
        line_items: [],
      };

      await capturedHandlers.onSubscriptionUpdated(subscriptionPayload);

      expect(onSubscriptionUpdated).toHaveBeenCalledWith(subscriptionPayload);
    });

    it('should throw error when RPC fails', async () => {
      const mockEvent = { id: 'evt_123', type: 'subscription.updated' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      mockSupabaseClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC error' },
      });

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      const subscriptionPayload: UpsertSubscriptionParams = {
        target_subscription_id: 'sub_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'active',
        currency: 'usd',
        interval: 'month',
        interval_count: 1,
        period_starts_at: Date.now(),
        period_ends_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancel_at_period_end: false,
        line_items: [],
      };

      await expect(
        capturedHandlers.onSubscriptionUpdated(subscriptionPayload),
      ).rejects.toThrow('Failed to update subscription');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { message: 'RPC error' },
        }),
        'Failed to update subscription',
      );
    });
  });

  describe('onCheckoutSessionCompleted - subscription', () => {
    it('should create subscription via RPC for subscription payload', async () => {
      const mockEvent = { id: 'evt_123', type: 'checkout.session.completed' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      const subscriptionPayload: UpsertSubscriptionParams = {
        target_subscription_id: 'sub_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'active',
        currency: 'usd',
        interval: 'month',
        interval_count: 1,
        period_starts_at: Date.now(),
        period_ends_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancel_at_period_end: false,
        line_items: [],
      };

      await capturedHandlers.onCheckoutSessionCompleted(subscriptionPayload);

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'upsert_subscription',
        subscriptionPayload,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'billing',
          subscriptionId: 'sub_123',
          provider: 'stripe',
          accountId: 'acc_123',
        }),
        'Processing checkout session completed event...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub_123',
        }),
        'Successfully added subscription',
      );
    });

    it('should call custom handler with subscription payload', async () => {
      const mockEvent = { id: 'evt_123', type: 'checkout.session.completed' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      const onCheckoutSessionCompleted = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockRequest, {
        onCheckoutSessionCompleted,
      });

      const subscriptionPayload: UpsertSubscriptionParams = {
        target_subscription_id: 'sub_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'active',
        currency: 'usd',
        interval: 'month',
        interval_count: 1,
        period_starts_at: Date.now(),
        period_ends_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancel_at_period_end: false,
        line_items: [],
      };

      await capturedHandlers.onCheckoutSessionCompleted(subscriptionPayload);

      expect(onCheckoutSessionCompleted).toHaveBeenCalledWith(
        subscriptionPayload,
        'cus_123',
      );
    });

    it('should throw error when subscription creation fails', async () => {
      const mockEvent = { id: 'evt_123', type: 'checkout.session.completed' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      mockSupabaseClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC error' },
      });

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      const subscriptionPayload: UpsertSubscriptionParams = {
        target_subscription_id: 'sub_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'active',
        currency: 'usd',
        interval: 'month',
        interval_count: 1,
        period_starts_at: Date.now(),
        period_ends_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancel_at_period_end: false,
        line_items: [],
      };

      await expect(
        capturedHandlers.onCheckoutSessionCompleted(subscriptionPayload),
      ).rejects.toThrow('Failed to add subscription');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { message: 'RPC error' },
        }),
        'Failed to add subscription',
      );
    });
  });

  describe('onCheckoutSessionCompleted - order', () => {
    it('should create order via RPC for order payload', async () => {
      const mockEvent = { id: 'evt_123', type: 'checkout.session.completed' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      const orderPayload: UpsertOrderParams = {
        target_order_id: 'order_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'succeeded',
        currency: 'usd',
        total_amount: 5000,
        line_items: [],
      };

      await capturedHandlers.onCheckoutSessionCompleted(orderPayload);

      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        'upsert_order',
        orderPayload,
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'billing',
          orderId: 'order_123',
          provider: 'stripe',
          accountId: 'acc_123',
        }),
        'Processing order completed event...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order_123',
        }),
        'Successfully added order',
      );
    });

    it('should call custom handler with order payload', async () => {
      const mockEvent = { id: 'evt_123', type: 'checkout.session.completed' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      const onCheckoutSessionCompleted = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockRequest, {
        onCheckoutSessionCompleted,
      });

      const orderPayload: UpsertOrderParams = {
        target_order_id: 'order_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'succeeded',
        currency: 'usd',
        total_amount: 5000,
        line_items: [],
      };

      await capturedHandlers.onCheckoutSessionCompleted(orderPayload);

      expect(onCheckoutSessionCompleted).toHaveBeenCalledWith(
        orderPayload,
        'cus_123',
      );
    });

    it('should throw error when order creation fails', async () => {
      const mockEvent = { id: 'evt_123', type: 'checkout.session.completed' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      mockSupabaseClient.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC error' },
      });

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      const orderPayload: UpsertOrderParams = {
        target_order_id: 'order_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'succeeded',
        currency: 'usd',
        total_amount: 5000,
        line_items: [],
      };

      await expect(
        capturedHandlers.onCheckoutSessionCompleted(orderPayload),
      ).rejects.toThrow('Failed to add order');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { message: 'RPC error' },
        }),
        'Failed to add order',
      );
    });
  });

  describe('onPaymentSucceeded', () => {
    it('should update order status to succeeded', async () => {
      const mockEvent = { id: 'evt_123', type: 'payment.succeeded' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      await capturedHandlers.onPaymentSucceeded('session_123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('orders');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'billing',
          sessionId: 'session_123',
        }),
        'Processing payment succeeded event...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session_123',
        }),
        'Successfully updated payment status',
      );
    });

    it('should call custom handler when provided', async () => {
      const mockEvent = { id: 'evt_123', type: 'payment.succeeded' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      const onPaymentSucceeded = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockRequest, {
        onPaymentSucceeded,
      });

      await capturedHandlers.onPaymentSucceeded('session_123');

      expect(onPaymentSucceeded).toHaveBeenCalledWith('session_123');
    });

    it('should throw error when update fails', async () => {
      const mockEvent = { id: 'evt_123', type: 'payment.succeeded' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      mockSupabaseClient.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        match: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { message: 'Database error' },
          }),
        ),
      } as any);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      await expect(
        capturedHandlers.onPaymentSucceeded('session_123'),
      ).rejects.toThrow('Failed to update payment status');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { message: 'Database error' },
        }),
        'Failed to update payment status',
      );
    });
  });

  describe('onPaymentFailed', () => {
    it('should update order status to failed', async () => {
      const mockEvent = { id: 'evt_123', type: 'payment.failed' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      await capturedHandlers.onPaymentFailed('session_123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('orders');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'billing',
          sessionId: 'session_123',
        }),
        'Processing payment failed event',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session_123',
        }),
        'Successfully updated payment status',
      );
    });

    it('should call custom handler when provided', async () => {
      const mockEvent = { id: 'evt_123', type: 'payment.failed' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      const onPaymentFailed = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockRequest, {
        onPaymentFailed,
      });

      await capturedHandlers.onPaymentFailed('session_123');

      expect(onPaymentFailed).toHaveBeenCalledWith('session_123');
    });

    it('should throw error when update fails', async () => {
      const mockEvent = { id: 'evt_123', type: 'payment.failed' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      mockSupabaseClient.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        match: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: { message: 'Database error' },
          }),
        ),
      } as any);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      await expect(
        capturedHandlers.onPaymentFailed('session_123'),
      ).rejects.toThrow('Failed to update payment status');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { message: 'Database error' },
        }),
        'Failed to update payment status',
      );
    });
  });

  describe('onInvoicePaid', () => {
    it('should call custom handler when provided', async () => {
      const mockEvent = { id: 'evt_123', type: 'invoice.paid' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      const onInvoicePaid = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockRequest, {
        onInvoicePaid,
      });

      const subscriptionPayload: UpsertSubscriptionParams = {
        target_subscription_id: 'sub_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'active',
        currency: 'usd',
        interval: 'month',
        interval_count: 1,
        period_starts_at: Date.now(),
        period_ends_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancel_at_period_end: false,
        line_items: [],
      };

      await capturedHandlers.onInvoicePaid(subscriptionPayload);

      expect(onInvoicePaid).toHaveBeenCalledWith(subscriptionPayload);
    });

    it('should not throw when custom handler not provided', async () => {
      const mockEvent = { id: 'evt_123', type: 'invoice.paid' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      await service.handleWebhookEvent(mockRequest);

      const subscriptionPayload: UpsertSubscriptionParams = {
        target_subscription_id: 'sub_123',
        target_account_id: 'acc_123',
        target_customer_id: 'cus_123',
        billing_provider: 'stripe',
        status: 'active',
        currency: 'usd',
        interval: 'month',
        interval_count: 1,
        period_starts_at: Date.now(),
        period_ends_at: Date.now() + 30 * 24 * 60 * 60 * 1000,
        cancel_at_period_end: false,
        line_items: [],
      };

      await expect(
        capturedHandlers.onInvoicePaid(subscriptionPayload),
      ).resolves.toBeUndefined();
    });
  });

  describe('onEvent', () => {
    it('should pass through onEvent handler to strategy', async () => {
      const mockEvent = { id: 'evt_123', type: 'test.event' };
      mockVerifyWebhookSignature.mockResolvedValue(mockEvent);

      let capturedHandlers: any;
      mockHandleWebhookEvent.mockImplementation((_event, handlers) => {
        capturedHandlers = handlers;
        return Promise.resolve();
      });

      const onEvent = vi.fn().mockResolvedValue(undefined);

      await service.handleWebhookEvent(mockRequest, {
        onEvent,
      });

      expect(capturedHandlers.onEvent).toBe(onEvent);
    });
  });
});
