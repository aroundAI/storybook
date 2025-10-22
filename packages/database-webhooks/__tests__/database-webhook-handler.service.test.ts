import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDatabaseWebhookHandlerService } from '../src/server/services/database-webhook-handler.service';

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

// Mock verifier
const mockVerifySignatureOrThrow = vi.fn();

vi.mock('../src/server/services/verifier', () => ({
  getDatabaseWebhookVerifier: vi.fn(() =>
    Promise.resolve({
      verifySignatureOrThrow: mockVerifySignatureOrThrow,
    }),
  ),
}));

// Mock admin client
const mockAdminClient = {
  from: vi.fn(),
  rpc: vi.fn(),
} as any;

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: vi.fn(() => mockAdminClient),
}));

// Mock router service
const mockHandleWebhook = vi.fn();

vi.mock('../src/server/services/database-webhook-router.service', () => ({
  createDatabaseWebhookRouterService: vi.fn(() => ({
    handleWebhook: mockHandleWebhook,
  })),
}));

describe('DatabaseWebhookHandlerService', () => {
  let service: ReturnType<typeof getDatabaseWebhookHandlerService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifySignatureOrThrow.mockResolvedValue(true);
    mockHandleWebhook.mockResolvedValue(undefined);
    service = getDatabaseWebhookHandlerService();
  });

  describe('handleWebhook - signature verification', () => {
    it('should verify webhook signature before processing', async () => {
      const payload = {
        body: {
          table: 'invitations' as const,
          type: 'INSERT' as const,
          record: { id: 1, email: 'test@example.com' },
          old_record: null,
          schema: 'public',
        },
        signature: 'valid-signature-123',
      };

      await service.handleWebhook(payload);

      expect(mockVerifySignatureOrThrow).toHaveBeenCalledWith(
        'valid-signature-123',
      );
    });

    it('should throw error when signature verification fails', async () => {
      mockVerifySignatureOrThrow.mockRejectedValue(
        new Error('Invalid signature'),
      );

      const payload = {
        body: {
          table: 'invitations' as const,
          type: 'INSERT' as const,
          record: { id: 1 },
          old_record: null,
          schema: 'public',
        },
        signature: 'invalid-signature',
      };

      await expect(service.handleWebhook(payload)).rejects.toThrow(
        'Invalid signature',
      );

      expect(mockHandleWebhook).not.toHaveBeenCalled();
    });

    it('should not process webhook when verification throws', async () => {
      mockVerifySignatureOrThrow.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      const payload = {
        body: {
          table: 'invitations' as const,
          type: 'INSERT' as const,
          record: { id: 1 },
          old_record: null,
          schema: 'public',
        },
        signature: 'bad-signature',
      };

      await expect(service.handleWebhook(payload)).rejects.toThrow();
      expect(mockHandleWebhook).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook - logging', () => {
    it('should log webhook received message', async () => {
      const payload = {
        body: {
          table: 'invitations' as const,
          type: 'INSERT' as const,
          record: { id: 1 },
          old_record: null,
          schema: 'public',
        },
        signature: 'valid-signature',
      };

      await service.handleWebhook(payload);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'database-webhook-handler',
          table: 'invitations',
          type: 'INSERT',
        }),
        'Received webhook from DB. Processing...',
      );
    });

    it('should log successful processing', async () => {
      const payload = {
        body: {
          table: 'subscriptions' as const,
          type: 'DELETE' as const,
          record: null,
          old_record: { id: 'sub-123' },
          schema: 'public',
        },
        signature: 'valid-signature',
      };

      await service.handleWebhook(payload);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'subscriptions',
          type: 'DELETE',
        }),
        'Webhook processed successfully',
      );
    });

    it('should log error when processing fails', async () => {
      mockHandleWebhook.mockRejectedValue(new Error('Processing failed'));

      const payload = {
        body: {
          table: 'invitations' as const,
          type: 'UPDATE' as const,
          record: { id: 1 },
          old_record: { id: 1 },
          schema: 'public',
        },
        signature: 'valid-signature',
      };

      await expect(service.handleWebhook(payload)).rejects.toThrow(
        'Processing failed',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'database-webhook-handler',
          table: 'invitations',
          type: 'UPDATE',
          error: expect.any(Error),
        }),
        'Failed to process webhook',
      );
    });
  });

  describe('handleWebhook - router integration', () => {
    it('should pass webhook body to router service', async () => {
      const payload = {
        body: {
          table: 'accounts' as const,
          type: 'DELETE' as const,
          record: null,
          old_record: { id: 'acc-123' },
          schema: 'public',
        },
        signature: 'valid-signature',
      };

      await service.handleWebhook(payload);

      expect(mockHandleWebhook).toHaveBeenCalledWith(payload.body);
    });

    it('should handle different table types', async () => {
      const tables = ['invitations', 'subscriptions', 'accounts'] as const;

      for (const table of tables) {
        vi.clearAllMocks();

        const payload = {
          body: {
            table,
            type: 'INSERT' as const,
            record: { id: 1 },
            old_record: null,
            schema: 'public',
          },
          signature: 'valid-signature',
        };

        await service.handleWebhook(payload);

        expect(mockHandleWebhook).toHaveBeenCalledWith(payload.body);
      }
    });
  });

  describe('handleWebhook - custom event handler', () => {
    it('should call custom handleEvent when provided', async () => {
      const customHandler = vi.fn().mockResolvedValue(undefined);

      const payload = {
        body: {
          table: 'invitations' as const,
          type: 'INSERT' as const,
          record: { id: 1, email: 'test@example.com' },
          old_record: null,
          schema: 'public',
        },
        signature: 'valid-signature',
        handleEvent: customHandler,
      };

      await service.handleWebhook(payload);

      expect(customHandler).toHaveBeenCalledWith(payload.body);
    });

    it('should call custom handler after router processing', async () => {
      const customHandler = vi.fn().mockResolvedValue(undefined);
      let routerCallTime: number;
      let customHandlerCallTime: number;

      mockHandleWebhook.mockImplementation(() => {
        routerCallTime = Date.now();
        return Promise.resolve();
      });

      const payload = {
        body: {
          table: 'subscriptions' as const,
          type: 'DELETE' as const,
          record: null,
          old_record: { id: 'sub-123' },
          schema: 'public',
        },
        signature: 'valid-signature',
        handleEvent: vi.fn().mockImplementation(() => {
          customHandlerCallTime = Date.now();
          return Promise.resolve();
        }),
      };

      await service.handleWebhook(payload);

      expect(payload.handleEvent).toHaveBeenCalledWith(payload.body);
      expect(mockHandleWebhook).toHaveBeenCalled();
    });

    it('should not fail when custom handler is not provided', async () => {
      const payload = {
        body: {
          table: 'invitations' as const,
          type: 'INSERT' as const,
          record: { id: 1 },
          old_record: null,
          schema: 'public',
        },
        signature: 'valid-signature',
      };

      await expect(service.handleWebhook(payload)).resolves.not.toThrow();
    });

    it('should propagate custom handler errors', async () => {
      const customHandler = vi
        .fn()
        .mockRejectedValue(new Error('Custom handler failed'));

      const payload = {
        body: {
          table: 'accounts' as const,
          type: 'UPDATE' as const,
          record: { id: 'acc-123' },
          old_record: { id: 'acc-123' },
          schema: 'public',
        },
        signature: 'valid-signature',
        handleEvent: customHandler,
      };

      await expect(service.handleWebhook(payload)).rejects.toThrow(
        'Custom handler failed',
      );
    });
  });

  describe('error handling', () => {
    it('should throw error when router processing fails', async () => {
      mockHandleWebhook.mockRejectedValue(new Error('Router error'));

      const payload = {
        body: {
          table: 'invitations' as const,
          type: 'DELETE' as const,
          record: null,
          old_record: { id: 1 },
          schema: 'public',
        },
        signature: 'valid-signature',
      };

      await expect(service.handleWebhook(payload)).rejects.toThrow(
        'Router error',
      );
    });

    it('should log and throw error on processing failure', async () => {
      const error = new Error('Database error');
      mockHandleWebhook.mockRejectedValue(error);

      const payload = {
        body: {
          table: 'subscriptions' as const,
          type: 'INSERT' as const,
          record: { id: 'sub-123' },
          old_record: null,
          schema: 'public',
        },
        signature: 'valid-signature',
      };

      await expect(service.handleWebhook(payload)).rejects.toThrow(
        'Database error',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error,
        }),
        'Failed to process webhook',
      );
    });
  });

  describe('service initialization', () => {
    it('should create service instance', () => {
      const newService = getDatabaseWebhookHandlerService();

      expect(newService).toBeDefined();
      expect(typeof newService.handleWebhook).toBe('function');
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete invitation webhook flow', async () => {
      const payload = {
        body: {
          table: 'invitations' as const,
          type: 'INSERT' as const,
          record: {
            id: 1,
            email: 'newuser@example.com',
            role: 'member',
            account_id: 'acc-123',
          },
          old_record: null,
          schema: 'public',
        },
        signature: 'valid-signature-abc',
      };

      await service.handleWebhook(payload);

      // Verify signature was checked
      expect(mockVerifySignatureOrThrow).toHaveBeenCalledWith(
        'valid-signature-abc',
      );

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'invitations',
          type: 'INSERT',
        }),
        'Received webhook from DB. Processing...',
      );

      // Verify router was called
      expect(mockHandleWebhook).toHaveBeenCalledWith(payload.body);

      // Verify success logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.anything(),
        'Webhook processed successfully',
      );
    });

    it('should handle subscription deletion with custom handler', async () => {
      const customHandler = vi.fn().mockResolvedValue(undefined);

      const payload = {
        body: {
          table: 'subscriptions' as const,
          type: 'DELETE' as const,
          record: null,
          old_record: {
            id: 'sub-123',
            account_id: 'acc-123',
            status: 'canceled',
          },
          schema: 'public',
        },
        signature: 'secure-signature-xyz',
        handleEvent: customHandler,
      };

      await service.handleWebhook(payload);

      // All steps should complete
      expect(mockVerifySignatureOrThrow).toHaveBeenCalled();
      expect(mockHandleWebhook).toHaveBeenCalled();
      expect(customHandler).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });
});
