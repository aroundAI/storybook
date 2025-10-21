import { beforeEach, describe, expect, it, vi } from 'vitest';

// Get mocked functions
import { getDatabaseWebhookHandlerService } from '@kit/database-webhooks';
import { getServerMonitoringService } from '@kit/monitoring/server';

import { POST } from '../route';

// Mock dependencies before importing
vi.mock('@kit/database-webhooks', () => ({
  getDatabaseWebhookHandlerService: vi.fn(),
}));

vi.mock('@kit/monitoring/server', () => ({
  getServerMonitoringService: vi.fn(),
}));

const mockGetDatabaseWebhookHandlerService = vi.mocked(
  getDatabaseWebhookHandlerService,
);
const mockGetServerMonitoringService = vi.mocked(getServerMonitoringService);

describe('Database Webhook API Route', () => {
  let mockHandleWebhook: ReturnType<typeof vi.fn>;
  let mockCaptureException: ReturnType<typeof vi.fn>;
  let mockReady: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock database webhook handler
    mockHandleWebhook = vi.fn().mockResolvedValue(undefined);

    mockGetDatabaseWebhookHandlerService.mockReturnValue({
      handleWebhook: mockHandleWebhook,
    } as any);

    // Setup mock monitoring service
    mockCaptureException = vi.fn().mockResolvedValue(undefined);
    mockReady = vi.fn().mockResolvedValue(undefined);

    mockGetServerMonitoringService.mockResolvedValue({
      captureException: mockCaptureException,
      ready: mockReady,
    } as any);
  });

  describe('Successful webhook processing', () => {
    it('should process webhook and return 200', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'INSERT',
          table: 'accounts',
          record: { id: '123', name: 'Test Account' },
        }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should call handleWebhook with body and signature', async () => {
      const body = {
        type: 'UPDATE',
        table: 'users',
        record: { id: '456', email: 'test@example.com' },
      };

      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'valid-signature',
        },
        body: JSON.stringify(body),
      });

      await POST(request, { params: {} });

      expect(mockHandleWebhook).toHaveBeenCalledWith({
        body,
        signature: 'valid-signature',
      });
    });

    it('should not call monitoring service on success', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify({ type: 'DELETE', table: 'posts' }),
      });

      await POST(request, { params: {} });

      expect(mockCaptureException).not.toHaveBeenCalled();
    });
  });

  describe('Signature validation', () => {
    it('should return 400 when signature is missing', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'INSERT', table: 'accounts' }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Missing signature');
    });

    it('should not call handleWebhook when signature is missing', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        body: JSON.stringify({ type: 'INSERT' }),
      });

      await POST(request, { params: {} });

      expect(mockHandleWebhook).not.toHaveBeenCalled();
    });

    it('should return 400 for null signature', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': '',
        },
        body: JSON.stringify({ type: 'INSERT' }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(400);
    });

    it('should accept valid signature formats', async () => {
      const signatures = [
        'sha256=abc123',
        'test-signature-123',
        'very-long-signature-with-lots-of-characters',
      ];

      for (const signature of signatures) {
        const request = new Request('http://localhost:3000/api/db/webhook', {
          method: 'POST',
          headers: {
            'X-Supabase-Event-Signature': signature,
          },
          body: JSON.stringify({ type: 'INSERT' }),
        });

        const response = await POST(request, { params: {} });

        expect(response.status).toBe(200);
        expect(mockHandleWebhook).toHaveBeenCalledWith({
          body: { type: 'INSERT' },
          signature,
        });
      }

      vi.clearAllMocks();
    });
  });

  describe('Error handling', () => {
    it('should return 500 when webhook processing fails', async () => {
      mockHandleWebhook.mockRejectedValue(
        new Error('Webhook processing failed'),
      );

      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify({ type: 'INSERT' }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(500);
    });

    it('should capture exception in monitoring service', async () => {
      const error = new Error('Database connection failed');
      mockHandleWebhook.mockRejectedValue(error);

      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify({ type: 'INSERT' }),
      });

      await POST(request, { params: {} });

      expect(mockCaptureException).toHaveBeenCalledWith(error);
    });

    it('should call monitoring service ready before capturing exception', async () => {
      mockHandleWebhook.mockRejectedValue(new Error('Test error'));

      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify({ type: 'INSERT' }),
      });

      await POST(request, { params: {} });

      expect(mockReady).toHaveBeenCalled();
      expect(mockCaptureException).toHaveBeenCalled();
    });

    it('should handle different error types', async () => {
      const errorTypes = [
        new Error('Signature verification failed'),
        new Error('Invalid webhook payload'),
        new Error('Database error'),
        new TypeError('Type error occurred'),
      ];

      for (const error of errorTypes) {
        mockHandleWebhook.mockRejectedValue(error);

        const request = new Request('http://localhost:3000/api/db/webhook', {
          method: 'POST',
          headers: {
            'X-Supabase-Event-Signature': 'test-signature',
          },
          body: JSON.stringify({ type: 'INSERT' }),
        });

        const response = await POST(request, { params: {} });

        expect(response.status).toBe(500);
        expect(mockCaptureException).toHaveBeenCalledWith(error);
      }

      vi.clearAllMocks();
    });

    it('should handle JSON parsing errors', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: 'invalid-json',
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(500);
      expect(mockCaptureException).toHaveBeenCalled();
    });
  });

  describe('Different webhook event types', () => {
    it('should handle INSERT events', async () => {
      const body = {
        type: 'INSERT',
        table: 'accounts',
        record: { id: '123', name: 'New Account' },
        schema: 'public',
      };

      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify(body),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
      expect(mockHandleWebhook).toHaveBeenCalledWith({
        body,
        signature: 'test-signature',
      });
    });

    it('should handle UPDATE events', async () => {
      const body = {
        type: 'UPDATE',
        table: 'users',
        record: { id: '456', email: 'updated@example.com' },
        old_record: { id: '456', email: 'old@example.com' },
      };

      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify(body),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle DELETE events', async () => {
      const body = {
        type: 'DELETE',
        table: 'posts',
        old_record: { id: '789', title: 'Deleted Post' },
      };

      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify(body),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });
  });

  describe('Request handling', () => {
    it('should handle requests with different headers', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
          'Content-Type': 'application/json',
          'User-Agent': 'Supabase-Webhooks/1.0',
        },
        body: JSON.stringify({ type: 'INSERT' }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle large webhook payloads', async () => {
      const largePayload = {
        type: 'INSERT',
        table: 'events',
        record: {
          id: '123',
          data: Array.from({ length: 1000 }, (_, i) => ({
            id: i,
            value: `item-${i}`,
          })),
        },
      };

      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify(largePayload),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle empty request body', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: '',
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(500);
    });
  });

  describe('Integration scenarios', () => {
    it('should process multiple webhooks sequentially', async () => {
      const events = [
        { type: 'INSERT', table: 'accounts' },
        { type: 'UPDATE', table: 'users' },
        { type: 'DELETE', table: 'posts' },
      ];

      for (const event of events) {
        const request = new Request('http://localhost:3000/api/db/webhook', {
          method: 'POST',
          headers: {
            'X-Supabase-Event-Signature': 'test-signature',
          },
          body: JSON.stringify(event),
        });

        const response = await POST(request, { params: {} });

        expect(response.status).toBe(200);
      }

      expect(mockHandleWebhook).toHaveBeenCalledTimes(3);
    });

    it('should handle webhook processing with retries', async () => {
      mockHandleWebhook
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(undefined);

      const request1 = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify({ type: 'INSERT' }),
      });

      const response1 = await POST(request1, { params: {} });
      expect(response1.status).toBe(500);

      const request2 = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify({ type: 'INSERT' }),
      });

      const response2 = await POST(request2, { params: {} });
      expect(response2.status).toBe(200);
    });

    it('should handle concurrent webhook requests', async () => {
      const requests = Array.from({ length: 5 }, () =>
        POST(
          new Request('http://localhost:3000/api/db/webhook', {
            method: 'POST',
            headers: {
              'X-Supabase-Event-Signature': 'test-signature',
            },
            body: JSON.stringify({ type: 'INSERT' }),
          }),
          { params: {} },
        ),
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      expect(mockHandleWebhook).toHaveBeenCalledTimes(5);
    });
  });

  describe('Edge cases', () => {
    it('should handle webhook with special characters in data', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify({
          type: 'INSERT',
          table: 'users',
          record: {
            name: 'John Doe <test@example.com>',
            bio: 'Hello & welcome! "Testing" quotes',
          },
        }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle webhook with null values', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify({
          type: 'UPDATE',
          table: 'users',
          record: {
            id: '123',
            name: null,
            email: 'test@example.com',
          },
        }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle webhook with nested objects', async () => {
      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': 'test-signature',
        },
        body: JSON.stringify({
          type: 'INSERT',
          table: 'events',
          record: {
            id: '123',
            metadata: {
              user: {
                id: '456',
                preferences: {
                  theme: 'dark',
                  notifications: true,
                },
              },
            },
          },
        }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
    });

    it('should handle very long signature', async () => {
      const longSignature = 'sha256=' + 'a'.repeat(1000);

      const request = new Request('http://localhost:3000/api/db/webhook', {
        method: 'POST',
        headers: {
          'X-Supabase-Event-Signature': longSignature,
        },
        body: JSON.stringify({ type: 'INSERT' }),
      });

      const response = await POST(request, { params: {} });

      expect(response.status).toBe(200);
      expect(mockHandleWebhook).toHaveBeenCalledWith({
        body: { type: 'INSERT' },
        signature: longSignature,
      });
    });
  });
});
