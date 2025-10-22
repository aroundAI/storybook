import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDatabaseWebhookRouterService } from '../src/server/services/database-webhook-router.service';

// Mock team accounts webhook service
const mockHandleInvitationWebhook = vi.fn();
const mockCreateAccountInvitationsWebhookService = vi.fn(() => ({
  handleInvitationWebhook: mockHandleInvitationWebhook,
}));

vi.mock('@kit/team-accounts/webhooks', () => ({
  createAccountInvitationsWebhookService:
    mockCreateAccountInvitationsWebhookService,
  createAccountWebhooksService: vi.fn(() => ({
    handleAccountDeletedWebhook: vi.fn(),
  })),
}));

// Mock billing webhook service
const mockHandleSubscriptionDeletedWebhook = vi.fn();
const mockCreateBillingWebhooksService = vi.fn(() => ({
  handleSubscriptionDeletedWebhook: mockHandleSubscriptionDeletedWebhook,
}));

vi.mock('@kit/billing-gateway', () => ({
  createBillingWebhooksService: mockCreateBillingWebhooksService,
}));

// Mock Supabase admin client
const mockAdminClient = {
  from: vi.fn(),
  rpc: vi.fn(),
} as any;

describe('DatabaseWebhookRouterService', () => {
  let service: ReturnType<typeof createDatabaseWebhookRouterService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createDatabaseWebhookRouterService(mockAdminClient);
  });

  describe('handleWebhook - invitations table', () => {
    it('should route invitation INSERT event to invitations webhook service', async () => {
      const payload = {
        table: 'invitations' as const,
        type: 'INSERT' as const,
        record: {
          id: 1,
          email: 'test@example.com',
          role: 'member',
          account_id: 'acc-123',
        },
        old_record: null,
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockCreateAccountInvitationsWebhookService).toHaveBeenCalledWith(
        mockAdminClient,
      );
      expect(mockHandleInvitationWebhook).toHaveBeenCalledWith(payload.record);
    });

    it('should route invitation UPDATE event to invitations webhook service', async () => {
      const payload = {
        table: 'invitations' as const,
        type: 'UPDATE' as const,
        record: {
          id: 1,
          email: 'test@example.com',
          role: 'admin',
          account_id: 'acc-123',
        },
        old_record: {
          id: 1,
          email: 'test@example.com',
          role: 'member',
          account_id: 'acc-123',
        },
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockHandleInvitationWebhook).toHaveBeenCalledWith(payload.record);
    });

    it('should route invitation DELETE event to invitations webhook service', async () => {
      const payload = {
        table: 'invitations' as const,
        type: 'DELETE' as const,
        record: {
          id: 1,
          email: 'test@example.com',
          role: 'member',
          account_id: 'acc-123',
        },
        old_record: {
          id: 1,
          email: 'test@example.com',
          role: 'member',
          account_id: 'acc-123',
        },
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockHandleInvitationWebhook).toHaveBeenCalledWith(payload.record);
    });
  });

  describe('handleWebhook - subscriptions table', () => {
    it('should route subscription DELETE event to billing webhook service', async () => {
      const payload = {
        table: 'subscriptions' as const,
        type: 'DELETE' as const,
        record: null,
        old_record: {
          id: 'sub-123',
          account_id: 'acc-123',
          status: 'active',
        },
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockCreateBillingWebhooksService).toHaveBeenCalled();
      expect(mockHandleSubscriptionDeletedWebhook).toHaveBeenCalledWith(
        payload.old_record,
      );
    });

    it('should not call billing service for subscription INSERT event', async () => {
      const payload = {
        table: 'subscriptions' as const,
        type: 'INSERT' as const,
        record: {
          id: 'sub-123',
          account_id: 'acc-123',
          status: 'active',
        },
        old_record: null,
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockHandleSubscriptionDeletedWebhook).not.toHaveBeenCalled();
    });

    it('should not call billing service for subscription UPDATE event', async () => {
      const payload = {
        table: 'subscriptions' as const,
        type: 'UPDATE' as const,
        record: {
          id: 'sub-123',
          account_id: 'acc-123',
          status: 'canceled',
        },
        old_record: {
          id: 'sub-123',
          account_id: 'acc-123',
          status: 'active',
        },
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockHandleSubscriptionDeletedWebhook).not.toHaveBeenCalled();
    });

    it('should not call billing service when DELETE has no old_record', async () => {
      const payload = {
        table: 'subscriptions' as const,
        type: 'DELETE' as const,
        record: null,
        old_record: null,
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockHandleSubscriptionDeletedWebhook).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook - accounts table', () => {
    it('should route account DELETE event to account webhook service', async () => {
      const mockHandleAccountDeletedWebhook = vi.fn();

      vi.mocked(
        await import('@kit/team-accounts/webhooks'),
      ).createAccountWebhooksService = vi.fn(() => ({
        handleAccountDeletedWebhook: mockHandleAccountDeletedWebhook,
      }));

      const payload = {
        table: 'accounts' as const,
        type: 'DELETE' as const,
        record: null,
        old_record: {
          id: 'acc-123',
          name: 'Test Account',
        },
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockHandleAccountDeletedWebhook).toHaveBeenCalledWith(
        payload.old_record,
      );
    });

    it('should not call account service for INSERT event', async () => {
      const mockHandleAccountDeletedWebhook = vi.fn();

      vi.mocked(
        await import('@kit/team-accounts/webhooks'),
      ).createAccountWebhooksService = vi.fn(() => ({
        handleAccountDeletedWebhook: mockHandleAccountDeletedWebhook,
      }));

      const payload = {
        table: 'accounts' as const,
        type: 'INSERT' as const,
        record: {
          id: 'acc-123',
          name: 'Test Account',
        },
        old_record: null,
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockHandleAccountDeletedWebhook).not.toHaveBeenCalled();
    });

    it('should not call account service for UPDATE event', async () => {
      const mockHandleAccountDeletedWebhook = vi.fn();

      vi.mocked(
        await import('@kit/team-accounts/webhooks'),
      ).createAccountWebhooksService = vi.fn(() => ({
        handleAccountDeletedWebhook: mockHandleAccountDeletedWebhook,
      }));

      const payload = {
        table: 'accounts' as const,
        type: 'UPDATE' as const,
        record: {
          id: 'acc-123',
          name: 'Updated Account',
        },
        old_record: {
          id: 'acc-123',
          name: 'Test Account',
        },
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockHandleAccountDeletedWebhook).not.toHaveBeenCalled();
    });

    it('should not call account service when DELETE has no old_record', async () => {
      const mockHandleAccountDeletedWebhook = vi.fn();

      vi.mocked(
        await import('@kit/team-accounts/webhooks'),
      ).createAccountWebhooksService = vi.fn(() => ({
        handleAccountDeletedWebhook: mockHandleAccountDeletedWebhook,
      }));

      const payload = {
        table: 'accounts' as const,
        type: 'DELETE' as const,
        record: null,
        old_record: null,
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockHandleAccountDeletedWebhook).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook - unknown tables', () => {
    it('should handle unknown table gracefully', async () => {
      const payload = {
        table: 'unknown_table' as any,
        type: 'INSERT' as const,
        record: { id: 1 },
        old_record: null,
        schema: 'public',
      };

      // Should not throw
      await expect(service.handleWebhook(payload)).resolves.toBeUndefined();

      // Should not call any webhook services
      expect(mockHandleInvitationWebhook).not.toHaveBeenCalled();
      expect(mockHandleSubscriptionDeletedWebhook).not.toHaveBeenCalled();
    });

    it('should return undefined for unhandled tables', async () => {
      const payload = {
        table: 'users' as any,
        type: 'UPDATE' as const,
        record: { id: 1 },
        old_record: { id: 1 },
        schema: 'public',
      };

      const result = await service.handleWebhook(payload);

      expect(result).toBeUndefined();
    });
  });

  describe('service initialization', () => {
    it('should create service with admin client', () => {
      const newService = createDatabaseWebhookRouterService(mockAdminClient);

      expect(newService).toBeDefined();
      expect(typeof newService.handleWebhook).toBe('function');
    });

    it('should pass admin client to invitation webhook service', async () => {
      const payload = {
        table: 'invitations' as const,
        type: 'INSERT' as const,
        record: {
          id: 1,
          email: 'test@example.com',
          role: 'member',
          account_id: 'acc-123',
        },
        old_record: null,
        schema: 'public',
      };

      await service.handleWebhook(payload);

      expect(mockCreateAccountInvitationsWebhookService).toHaveBeenCalledWith(
        mockAdminClient,
      );
    });
  });

  describe('error handling', () => {
    it('should propagate errors from invitation webhook service', async () => {
      mockHandleInvitationWebhook.mockRejectedValue(
        new Error('Invitation processing failed'),
      );

      const payload = {
        table: 'invitations' as const,
        type: 'INSERT' as const,
        record: {
          id: 1,
          email: 'test@example.com',
          role: 'member',
          account_id: 'acc-123',
        },
        old_record: null,
        schema: 'public',
      };

      await expect(service.handleWebhook(payload)).rejects.toThrow(
        'Invitation processing failed',
      );
    });

    it('should propagate errors from billing webhook service', async () => {
      mockHandleSubscriptionDeletedWebhook.mockRejectedValue(
        new Error('Billing processing failed'),
      );

      const payload = {
        table: 'subscriptions' as const,
        type: 'DELETE' as const,
        record: null,
        old_record: {
          id: 'sub-123',
          account_id: 'acc-123',
          status: 'active',
        },
        schema: 'public',
      };

      await expect(service.handleWebhook(payload)).rejects.toThrow(
        'Billing processing failed',
      );
    });
  });
});
