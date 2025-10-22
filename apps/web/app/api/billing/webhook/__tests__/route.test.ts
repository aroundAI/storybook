import { beforeEach, describe, expect, it, vi } from 'vitest';

// Get mocked functions
import { getBillingEventHandlerService } from '@kit/billing-gateway';
import { getLogger } from '@kit/shared/logger';

import { POST } from '../route';

// Mock dependencies before importing
vi.mock('@kit/billing', () => ({
  getPlanTypesMap: vi.fn(() => ({
    basic: 'one_time',
    pro: 'recurring',
    enterprise: 'recurring',
  })),
}));

vi.mock('@kit/billing-gateway', () => ({
  getBillingEventHandlerService: vi.fn(),
}));

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

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: vi.fn(() => ({})),
}));

vi.mock('~/config/billing.config', () => ({
  default: {
    provider: 'stripe',
    products: [],
  },
}));

const mockGetBillingEventHandlerService = vi.mocked(
  getBillingEventHandlerService,
);
const mockGetLogger = vi.mocked(getLogger);

describe('Billing Webhook API Route', () => {
  let mockHandleWebhookEvent: ReturnType<typeof vi.fn>;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock logger
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    mockGetLogger.mockResolvedValue(mockLogger as any);

    // Setup mock webhook handler
    mockHandleWebhookEvent = vi.fn().mockResolvedValue(undefined);

    mockGetBillingEventHandlerService.mockResolvedValue({
      handleWebhookEvent: mockHandleWebhookEvent,
    } as any);
  });

  describe('Successful webhook processing', () => {
    it('should process webhook and return 200', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'checkout.session.completed' }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    });

    it('should call handleWebhookEvent with request', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'payment_intent.succeeded' }),
      });

      await POST(request, { params: {} });

      expect(mockHandleWebhookEvent).toHaveBeenCalledWith(request);
    });

    it('should log processing start', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'invoice.paid' }),
      });

      await POST(request, { params: {} });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'billing.webhook',
          provider: 'stripe',
        }),
        'Received billing webhook. Processing...',
      );
    });

    it('should log processing success', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'customer.subscription.updated' }),
      });

      await POST(request, { params: {} });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'billing.webhook',
          provider: 'stripe',
        }),
        'Successfully processed billing webhook',
      );
    });

    it('should create service with admin client provider', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'checkout.session.completed' }),
      });

      await POST(request, { params: {} });

      expect(mockGetBillingEventHandlerService).toHaveBeenCalledWith(
        expect.any(Function),
        'stripe',
        expect.any(Object),
      );
    });
  });

  describe('Error handling', () => {
    it('should return 500 when webhook processing fails', async () => {
      mockHandleWebhookEvent.mockRejectedValue(
        new Error('Webhook processing failed'),
      );

      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'checkout.session.completed' }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Failed to process billing webhook');
    });

    it('should log error when webhook processing fails', async () => {
      const error = new Error('Signature verification failed');
      mockHandleWebhookEvent.mockRejectedValue(error);

      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'checkout.session.completed' }),
      });

      await POST(request, { params: {} });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'billing.webhook',
          provider: 'stripe',
          error,
        }),
        'Failed to process billing webhook',
      );
    });

    it('should handle service creation errors', async () => {
      mockGetBillingEventHandlerService.mockRejectedValue(
        new Error('Service creation failed'),
      );

      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'checkout.session.completed' }),
      });

      // Service creation error will throw before try-catch
      await expect(POST(request, { params: {} })).rejects.toThrow(
        'Service creation failed',
      );
    });

    it('should handle different error types', async () => {
      const errorTypes = [
        new Error('Database connection failed'),
        new Error('Invalid webhook signature'),
        new Error('Unknown event type'),
        new Error('Stripe API error'),
      ];

      for (const error of errorTypes) {
        mockHandleWebhookEvent.mockRejectedValue(error);

        const request = new Request(
          'http://localhost:3000/api/billing/webhook',
          {
            method: 'POST',
            body: JSON.stringify({ type: 'checkout.session.completed' }),
          },
        );

        const response = await POST(request, { params: {} });

        expect(response.status).toBe(500);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ error }),
          'Failed to process billing webhook',
        );
      }

      vi.clearAllMocks();
    });
  });

  describe('Different webhook events', () => {
    it('should handle checkout.session.completed', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_123',
              payment_status: 'paid',
            },
          },
        }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
      expect(mockHandleWebhookEvent).toHaveBeenCalled();
    });

    it('should handle customer.subscription.created', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({
          type: 'customer.subscription.created',
          data: {
            object: {
              id: 'sub_test_123',
              status: 'active',
            },
          },
        }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle customer.subscription.updated', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_test_123',
              status: 'active',
            },
          },
        }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle customer.subscription.deleted', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({
          type: 'customer.subscription.deleted',
          data: {
            object: {
              id: 'sub_test_123',
              status: 'canceled',
            },
          },
        }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });
  });

  describe('Request handling', () => {
    it('should handle requests with headers', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'checkout.session.completed' }),
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 'test_signature',
        },
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
      expect(mockHandleWebhookEvent).toHaveBeenCalledWith(request);
    });

    it('should handle empty request body', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: '',
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle large webhook payloads', async () => {
      const largePayload = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            line_items: Array.from({ length: 100 }, (_, i) => ({
              id: `li_${i}`,
              amount: 1000,
            })),
          },
        },
      };

      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify(largePayload),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });
  });

  describe('Integration scenarios', () => {
    it('should process multiple webhooks sequentially', async () => {
      const events = [
        'checkout.session.completed',
        'customer.subscription.created',
        'invoice.paid',
      ];

      for (const eventType of events) {
        const request = new Request(
          'http://localhost:3000/api/billing/webhook',
          {
            method: 'POST',
            body: JSON.stringify({ type: eventType }),
          },
        );

        const response = await POST(request, { params: {} });

        expect(response.status).toBe(200);
      }

      expect(mockHandleWebhookEvent).toHaveBeenCalledTimes(3);
    });

    it('should handle webhook processing with retries', async () => {
      mockHandleWebhookEvent
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(undefined);

      const request1 = new Request(
        'http://localhost:3000/api/billing/webhook',
        {
          method: 'POST',
          body: JSON.stringify({ type: 'checkout.session.completed' }),
        },
      );

      const response1 = await POST(request1, { params: {} });
      expect(response1.status).toBe(500);

      const request2 = new Request(
        'http://localhost:3000/api/billing/webhook',
        {
          method: 'POST',
          body: JSON.stringify({ type: 'checkout.session.completed' }),
        },
      );

      const response2 = await POST(request2, { params: {} });
      expect(response2.status).toBe(200);
    });
  });

  describe('Edge cases', () => {
    it('should handle non-JSON request body', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: 'not-json-data',
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle concurrent webhook requests', async () => {
      const requests = Array.from({ length: 5 }, () =>
        POST(
          new Request('http://localhost:3000/api/billing/webhook', {
            method: 'POST',
            body: JSON.stringify({ type: 'checkout.session.completed' }),
          }),
          { params: {} },
        ),
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      expect(mockHandleWebhookEvent).toHaveBeenCalledTimes(5);
    });

    it('should handle webhook with special characters in data', async () => {
      const request = new Request('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({
          type: 'checkout.session.completed',
          data: {
            object: {
              customer_details: {
                name: 'John Doe <test@example.com>',
                address: '123 Main St & 5th Ave',
              },
            },
          },
        }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });
  });
});
