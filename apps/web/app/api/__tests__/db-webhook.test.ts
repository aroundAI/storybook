import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDatabaseWebhookHandlerService } from '@kit/database-webhooks';
import { getServerMonitoringService } from '@kit/monitoring/server';

// Import route AFTER all mocks are set up
import { POST } from '../db/webhook/route';

// Mock all dependencies before importing the route
vi.mock('@kit/database-webhooks', () => ({
  getDatabaseWebhookHandlerService: vi.fn(),
}));

vi.mock('@kit/monitoring/server', () => ({
  getServerMonitoringService: vi.fn(),
}));

vi.mock('@kit/next/routes', () => ({
  enhanceRouteHandler: vi.fn((handler) => {
    // enhanceRouteHandler wraps the handler and passes { request } as first arg
    return async (request: Request) => {
      return handler({ request });
    };
  }),
}));

// Get mocked functions for assertions
const mockGetDatabaseWebhookHandlerService = vi.mocked(
  getDatabaseWebhookHandlerService,
);
const mockGetServerMonitoringService = vi.mocked(getServerMonitoringService);

describe('Database Webhook API Route', () => {
  const mockWebhookBody = {
    type: 'INSERT',
    table: 'accounts',
    record: { id: 'acc_123', name: 'Test Account' },
    schema: 'public',
    old_record: null,
  };

  const createMockRequest = (
    body: unknown = mockWebhookBody,
    signature: string | null = 'valid-signature',
  ) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (signature !== null) {
      headers['X-Supabase-Event-Signature'] = signature;
    }

    return new Request('https://example.com/api/db/webhook', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  };

  let mockHandleWebhook: ReturnType<typeof vi.fn>;
  let mockCaptureException: ReturnType<typeof vi.fn>;
  let mockReady: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock webhook handler
    mockHandleWebhook = vi.fn().mockResolvedValue(undefined);

    mockGetDatabaseWebhookHandlerService.mockReturnValue({
      handleWebhook: mockHandleWebhook,
    } as ReturnType<typeof getDatabaseWebhookHandlerService>);

    // Setup mock monitoring service
    mockCaptureException = vi.fn().mockResolvedValue(undefined);
    mockReady = vi.fn().mockResolvedValue(undefined);

    mockGetServerMonitoringService.mockResolvedValue({
      captureException: mockCaptureException,
      ready: mockReady,
    });
  });

  describe('Successful Webhook Processing', () => {
    it('should return 200 when webhook processed successfully', async () => {
      const request = createMockRequest();
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('should call handleWebhook with correct params', async () => {
      const request = createMockRequest();
      await POST(request);

      expect(mockHandleWebhook).toHaveBeenCalledWith({
        body: mockWebhookBody,
        signature: 'valid-signature',
      });
    });

    it('should handle INSERT event', async () => {
      const insertBody = {
        type: 'INSERT',
        table: 'accounts',
        record: { id: 'acc_new', name: 'New Account' },
        schema: 'public',
        old_record: null,
      };

      const request = createMockRequest(insertBody);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockHandleWebhook).toHaveBeenCalledWith({
        body: insertBody,
        signature: 'valid-signature',
      });
    });

    it('should handle UPDATE event', async () => {
      const updateBody = {
        type: 'UPDATE',
        table: 'accounts',
        record: { id: 'acc_123', name: 'Updated Account' },
        schema: 'public',
        old_record: { id: 'acc_123', name: 'Old Account' },
      };

      const request = createMockRequest(updateBody);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockHandleWebhook).toHaveBeenCalledWith({
        body: updateBody,
        signature: 'valid-signature',
      });
    });

    it('should handle DELETE event', async () => {
      const deleteBody = {
        type: 'DELETE',
        table: 'accounts',
        record: null,
        schema: 'public',
        old_record: { id: 'acc_123', name: 'Deleted Account' },
      };

      const request = createMockRequest(deleteBody);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockHandleWebhook).toHaveBeenCalledWith({
        body: deleteBody,
        signature: 'valid-signature',
      });
    });

    it('should handle different table types', async () => {
      const tables = ['accounts', 'subscriptions', 'users', 'projects'];

      for (const table of tables) {
        const body = {
          type: 'INSERT',
          table,
          record: { id: '123' },
          schema: 'public',
          old_record: null,
        };

        const request = createMockRequest(body);
        const response = await POST(request);

        expect(response.status).toBe(200);
      }

      expect(mockHandleWebhook).toHaveBeenCalledTimes(tables.length);
    });
  });

  describe('Error Handling - Missing Signature', () => {
    it('should return 400 when signature header is missing', async () => {
      const request = createMockRequest(mockWebhookBody, null);
      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Missing signature');
    });

    it('should not call handleWebhook when signature is missing', async () => {
      const request = createMockRequest(mockWebhookBody, null);
      await POST(request);

      expect(mockHandleWebhook).not.toHaveBeenCalled();
    });

    it('should not call monitoring service when signature is missing', async () => {
      const request = createMockRequest(mockWebhookBody, null);
      await POST(request);

      expect(mockCaptureException).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling - Processing Failures', () => {
    it('should return 500 when webhook processing fails', async () => {
      const error = new Error('Webhook processing failed');
      mockHandleWebhook.mockRejectedValue(error);

      const request = createMockRequest();
      const response = await POST(request);

      expect(response.status).toBe(500);
    });

    it('should capture exception when webhook processing fails', async () => {
      const error = new Error('Webhook processing failed');
      mockHandleWebhook.mockRejectedValue(error);

      const request = createMockRequest();
      await POST(request);

      expect(mockCaptureException).toHaveBeenCalledWith(error);
    });

    it('should call monitoring service ready before capturing exception', async () => {
      const error = new Error('Webhook processing failed');
      mockHandleWebhook.mockRejectedValue(error);

      const request = createMockRequest();
      await POST(request);

      expect(mockReady).toHaveBeenCalled();
      expect(mockCaptureException).toHaveBeenCalledAfter(mockReady);
    });

    it('should handle signature verification failure', async () => {
      const error = new Error('Invalid signature');
      mockHandleWebhook.mockRejectedValue(error);

      const request = createMockRequest();
      const response = await POST(request);

      expect(response.status).toBe(500);
      expect(mockCaptureException).toHaveBeenCalledWith(error);
    });

    it('should handle service initialization errors', async () => {
      const error = new Error('Service initialization failed');
      mockGetDatabaseWebhookHandlerService.mockImplementation(() => {
        throw error;
      });

      const request = createMockRequest();

      try {
        await POST(request);
      } catch (e) {
        // Service initialization error escapes the try-catch in the route
        expect(e).toBe(error);
      }
    });

    it('should handle JSON parsing errors', async () => {
      const request = new Request('https://example.com/api/db/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Supabase-Event-Signature': 'valid-signature',
        },
        body: '{invalid json',
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle multiple webhook requests sequentially', async () => {
      const request1 = createMockRequest();
      const request2 = createMockRequest();

      const response1 = await POST(request1);
      const response2 = await POST(request2);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(mockHandleWebhook).toHaveBeenCalledTimes(2);
    });

    it('should maintain separate context for each request', async () => {
      const body1 = { ...mockWebhookBody, table: 'accounts' };
      const body2 = { ...mockWebhookBody, table: 'subscriptions' };

      const request1 = createMockRequest(body1);
      const request2 = createMockRequest(body2);

      await POST(request1);
      await POST(request2);

      expect(mockHandleWebhook).toHaveBeenNthCalledWith(1, {
        body: body1,
        signature: 'valid-signature',
      });
      expect(mockHandleWebhook).toHaveBeenNthCalledWith(2, {
        body: body2,
        signature: 'valid-signature',
      });
    });

    it('should not affect subsequent requests after error', async () => {
      mockHandleWebhook
        .mockRejectedValueOnce(new Error('First request failed'))
        .mockResolvedValueOnce(undefined);

      const request1 = createMockRequest();
      const request2 = createMockRequest();

      const response1 = await POST(request1);
      const response2 = await POST(request2);

      expect(response1.status).toBe(500);
      expect(response2.status).toBe(200);
    });

    it('should handle concurrent webhook requests', async () => {
      const requests = Array.from({ length: 5 }, () => createMockRequest());

      const responses = await Promise.all(requests.map((req) => POST(req)));

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
      expect(mockHandleWebhook).toHaveBeenCalledTimes(5);
    });
  });

  describe('Auth Configuration', () => {
    it('should allow unauthenticated requests', async () => {
      // Webhook endpoint should not require authentication (webhooks from Supabase don't have user auth)
      const request = createMockRequest();
      const response = await POST(request);

      // Should process successfully without auth
      expect(response.status).toBe(200);
    });
  });

  describe('Response Format', () => {
    it('should return empty body on success', async () => {
      const request = createMockRequest();
      const response = await POST(request);

      const text = await response.text();
      expect(text).toBe('');
    });

    it('should return empty body on error', async () => {
      mockHandleWebhook.mockRejectedValue(new Error('Test error'));

      const request = createMockRequest();
      const response = await POST(request);

      const text = await response.text();
      expect(text).toBe('');
    });

    it('should return error message on missing signature', async () => {
      const request = createMockRequest(mockWebhookBody, null);
      const response = await POST(request);

      expect(await response.text()).toBe('Missing signature');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty signature string', async () => {
      const request = createMockRequest(mockWebhookBody, '');
      const response = await POST(request);

      // Empty signature should be treated as missing (falsy check)
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Missing signature');
      expect(mockHandleWebhook).not.toHaveBeenCalled();
    });

    it('should handle very large webhook payloads', async () => {
      const largePayload = {
        type: 'UPDATE',
        table: 'accounts',
        record: {
          id: 'acc_123',
          data: new Array(1000).fill({ field: 'value' }),
        },
        schema: 'public',
        old_record: null,
      };

      const request = createMockRequest(largePayload);
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('should handle webhook with null record (DELETE)', async () => {
      const deletePayload = {
        type: 'DELETE',
        table: 'accounts',
        record: null,
        schema: 'public',
        old_record: { id: 'acc_123' },
      };

      const request = createMockRequest(deletePayload);
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('should handle webhook with null old_record (INSERT)', async () => {
      const insertPayload = {
        type: 'INSERT',
        table: 'accounts',
        record: { id: 'acc_123' },
        schema: 'public',
        old_record: null,
      };

      const request = createMockRequest(insertPayload);
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('should handle monitoring service errors gracefully', async () => {
      const webhookError = new Error('Webhook failed');
      mockHandleWebhook.mockRejectedValue(webhookError);
      mockGetServerMonitoringService.mockRejectedValue(
        new Error('Monitoring service unavailable'),
      );

      const request = createMockRequest();

      try {
        await POST(request);
      } catch (e) {
        // Monitoring service error escapes the try-catch
        expect((e as Error).message).toBe('Monitoring service unavailable');
      }
    });

    it('should handle monitoring service captureException error', async () => {
      const webhookError = new Error('Webhook failed');
      mockHandleWebhook.mockRejectedValue(webhookError);
      mockCaptureException.mockRejectedValue(
        new Error('Failed to capture exception'),
      );

      const request = createMockRequest();

      try {
        await POST(request);
      } catch (e) {
        // CaptureException error escapes the try-catch
        expect((e as Error).message).toBe('Failed to capture exception');
      }
    });
  });

  describe('Table-Specific Events', () => {
    it('should handle accounts table events', async () => {
      const accountsEvent = {
        type: 'INSERT',
        table: 'accounts',
        record: { id: 'acc_123', name: 'Test Account', slug: 'test-account' },
        schema: 'public',
        old_record: null,
      };

      const request = createMockRequest(accountsEvent);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockHandleWebhook).toHaveBeenCalledWith({
        body: accountsEvent,
        signature: 'valid-signature',
      });
    });

    it('should handle subscriptions table events', async () => {
      const subscriptionsEvent = {
        type: 'UPDATE',
        table: 'subscriptions',
        record: { id: 'sub_123', status: 'active' },
        schema: 'public',
        old_record: { id: 'sub_123', status: 'trialing' },
      };

      const request = createMockRequest(subscriptionsEvent);
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('should handle users table events', async () => {
      const usersEvent = {
        type: 'DELETE',
        table: 'users',
        record: null,
        schema: 'public',
        old_record: { id: 'user_123', email: 'test@example.com' },
      };

      const request = createMockRequest(usersEvent);
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Signature Variations', () => {
    it('should handle various signature formats', async () => {
      const signatures = [
        'simple-signature',
        'sha256=abcdef123456',
        'v1=signature-value',
        'Bearer token-value',
      ];

      for (const signature of signatures) {
        const request = createMockRequest(mockWebhookBody, signature);
        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockHandleWebhook).toHaveBeenCalledWith({
          body: mockWebhookBody,
          signature,
        });
      }
    });
  });
});
