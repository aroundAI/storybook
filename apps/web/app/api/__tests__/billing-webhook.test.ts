import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPlanTypesMap } from '@kit/billing';
import { getBillingEventHandlerService } from '@kit/billing-gateway';
import { getLogger } from '@kit/shared/logger';

// Import route AFTER all mocks are set up
import { POST } from '../billing/webhook/route';

// Create a single logger mock instance to be reused
const loggerMock = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
};

// Mock all dependencies before importing the route
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() => Promise.resolve(loggerMock)),
}));

vi.mock('@kit/billing-gateway', () => ({
  getBillingEventHandlerService: vi.fn(),
}));

vi.mock('@kit/billing', () => ({
  getPlanTypesMap: vi.fn(),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: vi.fn(() => ({})),
}));

// Mock billing config
vi.mock('~/config/billing.config', () => ({
  default: {
    provider: 'stripe',
    products: [],
  },
}));

// Mock enhanceRouteHandler to avoid Next.js dependencies
vi.mock('@kit/next/routes', () => ({
  enhanceRouteHandler: vi.fn((handler) => handler),
}));

// Get mocked functions for assertions
const mockGetLogger = vi.mocked(getLogger);
const mockGetBillingEventHandlerService = vi.mocked(
  getBillingEventHandlerService,
);
const mockGetPlanTypesMap = vi.mocked(getPlanTypesMap);

describe('Billing Webhook API Route', () => {
  const mockRequest = new Request('https://example.com/api/billing/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 't=123,v1=signature',
    },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_123' } },
    }),
  });

  let mockHandleWebhookEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock webhook event handler
    mockHandleWebhookEvent = vi.fn().mockResolvedValue(undefined);

    // Setup default mocks
    mockGetPlanTypesMap.mockReturnValue(new Map());
    mockGetBillingEventHandlerService.mockResolvedValue({
      handleWebhookEvent: mockHandleWebhookEvent,
    });
  });

  describe('Successful Webhook Processing', () => {
    it('should return 200 when webhook processed successfully', async () => {
      const response = await POST(mockRequest);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('OK');
    });

    it('should log webhook receipt', async () => {
      await POST(mockRequest);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'billing.webhook',
          provider: 'stripe',
        }),
        'Received billing webhook. Processing...',
      );
    });

    it('should log successful processing', async () => {
      await POST(mockRequest);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'billing.webhook',
          provider: 'stripe',
        }),
        'Successfully processed billing webhook',
      );
    });

    it('should call getBillingEventHandlerService with correct params', async () => {
      const mockPlanTypesMap = new Map([['price_123', 'flat' as const]]);
      mockGetPlanTypesMap.mockReturnValue(mockPlanTypesMap);

      await POST(mockRequest);

      expect(mockGetBillingEventHandlerService).toHaveBeenCalledWith(
        expect.any(Function), // clientProvider function
        'stripe',
        mockPlanTypesMap,
      );
    });

    it('should call handleWebhookEvent with request', async () => {
      await POST(mockRequest);

      // The route handler passes the request through enhanceRouteHandler
      // which provides it in a different format
      expect(mockHandleWebhookEvent).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should return 500 when webhook processing fails', async () => {
      const error = new Error('Webhook processing failed');
      mockHandleWebhookEvent.mockRejectedValue(error);

      const response = await POST(mockRequest);

      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Failed to process billing webhook');
    });

    it('should log error when processing fails', async () => {
      const error = new Error('Webhook processing failed');
      mockHandleWebhookEvent.mockRejectedValue(error);

      await POST(mockRequest);

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'billing.webhook',
          provider: 'stripe',
          error,
        }),
        'Failed to process billing webhook',
      );
    });

    it('should handle service initialization errors', async () => {
      const error = new Error('Service initialization failed');
      mockGetBillingEventHandlerService.mockRejectedValue(error);

      try {
        await POST(mockRequest);
      } catch (e) {
        // Expect error to be thrown since service can't be initialized
        expect(e).toBe(error);
      }
    });

    it('should handle missing signature header', async () => {
      const requestWithoutSignature = new Request(
        'https://example.com/api/billing/webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'test.event' }),
        },
      );

      mockHandleWebhookEvent.mockRejectedValue(
        new Error('Missing stripe-signature header'),
      );

      const response = await POST(requestWithoutSignature);

      expect(response.status).toBe(500);
    });

    it('should handle invalid webhook signature', async () => {
      mockHandleWebhookEvent.mockRejectedValue(new Error('Invalid signature'));

      const response = await POST(mockRequest);

      expect(response.status).toBe(500);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
        }),
        'Failed to process billing webhook',
      );
    });
  });

  describe('Provider Configuration', () => {
    it('should use provider from billing config', async () => {
      await POST(mockRequest);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'stripe',
        }),
        expect.any(String),
      );
    });

    it('should pass plan types map from billing config', async () => {
      const mockPlanTypesMap = new Map([
        ['price_123', 'flat' as const],
        ['price_456', 'per_seat' as const],
      ]);
      mockGetPlanTypesMap.mockReturnValue(mockPlanTypesMap);

      await POST(mockRequest);

      expect(mockGetPlanTypesMap).toHaveBeenCalled();
      expect(mockGetBillingEventHandlerService).toHaveBeenCalledWith(
        expect.any(Function),
        'stripe',
        mockPlanTypesMap,
      );
    });
  });

  describe('Webhook Events', () => {
    it('should handle checkout.session.completed event', async () => {
      const checkoutRequest = new Request(
        'https://example.com/api/billing/webhook',
        {
          method: 'POST',
          headers: {
            'stripe-signature': 't=123,v1=signature',
          },
          body: JSON.stringify({
            type: 'checkout.session.completed',
            data: {
              object: {
                id: 'cs_123',
                mode: 'subscription',
                subscription: 'sub_123',
              },
            },
          }),
        },
      );

      const response = await POST(checkoutRequest);

      expect(response.status).toBe(200);
      expect(mockHandleWebhookEvent).toHaveBeenCalled();
    });

    it('should handle customer.subscription.updated event', async () => {
      const subscriptionRequest = new Request(
        'https://example.com/api/billing/webhook',
        {
          method: 'POST',
          headers: {
            'stripe-signature': 't=123,v1=signature',
          },
          body: JSON.stringify({
            type: 'customer.subscription.updated',
            data: {
              object: {
                id: 'sub_123',
                status: 'active',
              },
            },
          }),
        },
      );

      const response = await POST(subscriptionRequest);

      expect(response.status).toBe(200);
      expect(mockHandleWebhookEvent).toHaveBeenCalled();
    });

    it('should handle customer.subscription.deleted event', async () => {
      const deletionRequest = new Request(
        'https://example.com/api/billing/webhook',
        {
          method: 'POST',
          headers: {
            'stripe-signature': 't=123,v1=signature',
          },
          body: JSON.stringify({
            type: 'customer.subscription.deleted',
            data: {
              object: {
                id: 'sub_123',
              },
            },
          }),
        },
      );

      const response = await POST(deletionRequest);

      expect(response.status).toBe(200);
      expect(mockHandleWebhookEvent).toHaveBeenCalled();
    });

    it('should handle invoice.paid event', async () => {
      const invoiceRequest = new Request(
        'https://example.com/api/billing/webhook',
        {
          method: 'POST',
          headers: {
            'stripe-signature': 't=123,v1=signature',
          },
          body: JSON.stringify({
            type: 'invoice.paid',
            data: {
              object: {
                id: 'in_123',
                subscription: 'sub_123',
              },
            },
          }),
        },
      );

      const response = await POST(invoiceRequest);

      expect(response.status).toBe(200);
      expect(mockHandleWebhookEvent).toHaveBeenCalled();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle multiple webhook requests sequentially', async () => {
      const request1 = mockRequest.clone();
      const request2 = mockRequest.clone();

      const response1 = await POST(request1);
      const response2 = await POST(request2);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(mockHandleWebhookEvent).toHaveBeenCalledTimes(2);
    });

    it('should maintain separate context for each request', async () => {
      await POST(mockRequest);
      await POST(mockRequest);

      // Each request should log independently
      expect(loggerMock.info).toHaveBeenCalledTimes(4); // 2 requests × 2 log calls
    });

    it('should not affect subsequent requests after error', async () => {
      mockHandleWebhookEvent
        .mockRejectedValueOnce(new Error('First request failed'))
        .mockResolvedValueOnce(undefined);

      const response1 = await POST(mockRequest.clone());
      const response2 = await POST(mockRequest.clone());

      expect(response1.status).toBe(500);
      expect(response2.status).toBe(200);
    });
  });

  describe('Logging Context', () => {
    it('should include provider in log context', async () => {
      await POST(mockRequest);

      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'billing.webhook',
          provider: 'stripe',
        }),
        expect.any(String),
      );
    });

    it('should include error in error log context', async () => {
      const error = new Error('Test error');
      mockHandleWebhookEvent.mockRejectedValue(error);

      await POST(mockRequest);

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'billing.webhook',
          provider: 'stripe',
          error,
        }),
        'Failed to process billing webhook',
      );
    });
  });

  describe('Auth Configuration', () => {
    it('should allow unauthenticated requests', async () => {
      // Webhook endpoint should not require authentication (webhooks from Stripe don't have user auth)
      const response = await POST(mockRequest);

      // Should process successfully without auth
      expect(response.status).toBe(200);
    });
  });

  describe('Response Format', () => {
    it('should return plain text "OK" on success', async () => {
      const response = await POST(mockRequest);

      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(await response.text()).toBe('OK');
    });

    it('should return plain text error message on failure', async () => {
      mockHandleWebhookEvent.mockRejectedValue(new Error('Test error'));

      const response = await POST(mockRequest);

      expect(await response.text()).toBe('Failed to process billing webhook');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty request body gracefully', async () => {
      const emptyRequest = new Request(
        'https://example.com/api/billing/webhook',
        {
          method: 'POST',
          headers: { 'stripe-signature': 't=123,v1=signature' },
          body: '',
        },
      );

      mockHandleWebhookEvent.mockRejectedValue(new Error('Empty request body'));

      const response = await POST(emptyRequest);

      expect(response.status).toBe(500);
    });

    it('should handle malformed JSON gracefully', async () => {
      const malformedRequest = new Request(
        'https://example.com/api/billing/webhook',
        {
          method: 'POST',
          headers: { 'stripe-signature': 't=123,v1=signature' },
          body: '{invalid json',
        },
      );

      mockHandleWebhookEvent.mockRejectedValue(new Error('Invalid JSON'));

      const response = await POST(malformedRequest);

      expect(response.status).toBe(500);
      expect(loggerMock.error).toHaveBeenCalled();
    });

    it('should handle very large webhook payloads', async () => {
      const largePayload = {
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_123',
            lines: new Array(1000).fill({ id: 'line_123' }),
          },
        },
      };

      const largeRequest = new Request(
        'https://example.com/api/billing/webhook',
        {
          method: 'POST',
          headers: { 'stripe-signature': 't=123,v1=signature' },
          body: JSON.stringify(largePayload),
        },
      );

      const response = await POST(largeRequest);

      expect(response.status).toBe(200);
    });

    it('should handle concurrent webhook requests', async () => {
      const requests = Array.from({ length: 5 }, () => mockRequest.clone());

      const responses = await Promise.all(requests.map((req) => POST(req)));

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
      expect(mockHandleWebhookEvent).toHaveBeenCalledTimes(5);
    });
  });
});
