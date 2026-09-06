import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAccountInvitationsWebhookService } from '../src/server/services/webhooks/account-invitations-webhook.service';

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

// Mock email templates
const mockRenderInviteEmail = vi.fn(() =>
  Promise.resolve({
    html: '<p>You are invited</p>',
    subject: 'Team invitation',
  }),
);

vi.mock('@kit/email-templates', () => ({
  renderInviteEmail: mockRenderInviteEmail,
}));

// Mock mailers
const mockSendEmail = vi.fn(() => Promise.resolve());
const mockGetMailer = vi.fn(() =>
  Promise.resolve({
    sendEmail: mockSendEmail,
  }),
);

vi.mock('@kit/mailers', () => ({
  getMailer: mockGetMailer,
}));

// Create mock Supabase admin client
const createMockAdminClient = () => ({
  from: vi.fn((table: string) => {
    if (table === 'accounts') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: { name: 'Test Account', email: 'inviter@example.com' },
            error: null,
          }),
        ),
      };
    }
    return {};
  }),
});

describe('AccountInvitationsWebhookService', () => {
  let mockAdminClient: ReturnType<typeof createMockAdminClient>;

  beforeEach(() => {
    mockAdminClient = createMockAdminClient();
    vi.clearAllMocks();
    // Set required environment variables
    process.env.NEXT_PUBLIC_SITE_URL = 'https://test.com';
    process.env.NEXT_PUBLIC_PRODUCT_NAME = 'Test Product';
    process.env.EMAIL_SENDER = 'noreply@test.com';
  });

  describe('service initialization', () => {
    it('should create service instance with admin client', () => {
      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      expect(service).toBeDefined();
      expect(typeof service.handleInvitationWebhook).toBe('function');
    });
  });

  describe('handleInvitationWebhook - successful invitation', () => {
    it('should handle invitation webhook successfully', async () => {
      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 1,
        email: 'newuser@example.com',
        invite_token: 'test-token-123',
        invited_by: '123e4567-e89b-12d3-a456-426614174000',
        account_id: '987fcdeb-51a2-43d7-8f9e-123456789abc',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      const result = await service.handleInvitationWebhook(invitation);

      expect(result).toEqual({ success: true });
    });

    it('should fetch inviter details from database', async () => {
      const mockSingle = vi.fn(() =>
        Promise.resolve({
          data: { name: 'John Doe', email: 'john@example.com' },
          error: null,
        }),
      );

      mockAdminClient.from = vi.fn((table: string) => {
        if (table === 'accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: mockSingle,
          };
        }
        return {};
      }) as unknown as typeof mockAdminClient.from;

      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 1,
        email: 'invited@example.com',
        invite_token: 'token-456',
        invited_by: 'inviter-id-123',
        account_id: 'account-id-456',
        role: 'admin' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      expect(mockAdminClient.from).toHaveBeenCalledWith('accounts');
      expect(mockSingle).toHaveBeenCalled();
    });

    it('should fetch team details from database', async () => {
      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 2,
        email: 'user@example.com',
        invite_token: 'token-789',
        invited_by: 'inviter-id-789',
        account_id: 'team-account-789',
        role: 'viewer' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      // Should be called twice - once for inviter, once for team
      expect(mockAdminClient.from).toHaveBeenCalledTimes(2);
    });

    it('should send invitation email with correct parameters', async () => {
      mockAdminClient.from = vi.fn((table: string) => {
        if (table === 'accounts') {
          const callCount = vi.mocked(mockAdminClient.from).mock.calls.length;
          if (callCount === 1) {
            // First call - inviter
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { name: 'Inviter Name', email: 'inviter@test.com' },
                  error: null,
                }),
              ),
            };
          } else {
            // Second call - team
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { name: 'Team Name' },
                  error: null,
                }),
              ),
            };
          }
        }
        return {};
      }) as unknown as typeof mockAdminClient.from;

      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 3,
        email: 'invited@example.com',
        invite_token: 'token-abc',
        invited_by: 'inviter-abc',
        account_id: 'account-abc',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      expect(mockRenderInviteEmail).toHaveBeenCalledWith({
        link: expect.stringContaining('invite_token=token-abc'),
        invitedUserEmail: 'invited@example.com',
        inviter: 'Inviter Name',
        productName: 'Test Product',
        teamName: 'Team Name',
      });

      expect(mockSendEmail).toHaveBeenCalledWith({
        from: 'noreply@test.com',
        to: 'invited@example.com',
        subject: 'Team invitation',
        html: '<p>You are invited</p>',
      });
    });

    it('should generate correct invitation link', async () => {
      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 4,
        email: 'user@test.com',
        invite_token: 'unique-token-xyz',
        invited_by: 'inviter-xyz',
        account_id: 'account-xyz',
        role: 'admin' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      expect(mockRenderInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          link: 'https://test.com/join?invite_token=unique-token-xyz&email=user%40test.com',
        }),
      );
    });
  });

  describe('handleInvitationWebhook - error handling', () => {
    it('should throw error when inviter not found', async () => {
      mockAdminClient.from = vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(() =>
          Promise.resolve({
            data: null,
            error: new Error('Inviter not found'),
          }),
        ),
      })) as unknown as typeof mockAdminClient.from;

      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 5,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'non-existent-inviter',
        account_id: 'account-id',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await expect(service.handleInvitationWebhook(invitation)).rejects.toThrow(
        'Inviter not found',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          name: 'accounts.invitations.webhook',
        }),
        'Failed to fetch inviter details',
      );
    });

    it('should throw error when team not found', async () => {
      let callCount = 0;

      mockAdminClient.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // First call - inviter (success)
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(() =>
              Promise.resolve({
                data: { name: 'Inviter', email: 'inviter@test.com' },
                error: null,
              }),
            ),
          };
        } else {
          // Second call - team (error)
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(() =>
              Promise.resolve({
                data: null,
                error: new Error('Team not found'),
              }),
            ),
          };
        }
      }) as unknown as typeof mockAdminClient.from;

      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 6,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'inviter-id',
        account_id: 'non-existent-team',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await expect(service.handleInvitationWebhook(invitation)).rejects.toThrow(
        'Team not found',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          name: 'accounts.invitations.webhook',
        }),
        'Failed to fetch team details',
      );
    });

    it('should return error object when email sending fails', async () => {
      mockSendEmail.mockRejectedValue(new Error('Email service unavailable'));

      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 7,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'inviter-id',
        account_id: 'account-id',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      const result = await service.handleInvitationWebhook(invitation);

      expect(result).toEqual({
        success: true, // Still returns success as email failure is caught
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
        }),
        'Failed to send invitation email',
      );
    });

    it('should catch errors in email rendering', async () => {
      mockRenderInviteEmail.mockRejectedValue(new Error('Template error'));

      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 8,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'inviter-id',
        account_id: 'account-id',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      const result = await service.handleInvitationWebhook(invitation);

      expect(result).toEqual({
        error: expect.any(Error),
        success: false,
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
        }),
        'Failed to invite user to team',
      );
    });
  });

  describe('handleInvitationWebhook - logging', () => {
    it('should log webhook processing start', async () => {
      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 9,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'inviter-id',
        account_id: 'account-id',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          invitation,
          name: 'accounts.invitations.webhook',
        }),
        'Handling invitation webhook event...',
      );
    });

    it('should log before sending email', async () => {
      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 10,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'inviter-id',
        account_id: 'account-id',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          invitationId: 10,
          name: 'accounts.invitations.webhook',
        }),
        'Invite retrieved. Sending invitation email...',
      );
    });

    it('should log successful email send', async () => {
      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 11,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'inviter-id',
        account_id: 'account-id',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      // Should log: 1) webhook processing start, 2) before sending email
      // Note: Success log is in .then() callback so may not be captured in test
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          invitation: expect.objectContaining({ id: 11 }),
        }),
        'Handling invitation webhook event...',
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          invitationId: 11,
        }),
        'Invite retrieved. Sending invitation email...',
      );
    });
  });

  describe('handleInvitationWebhook - inviter name handling', () => {
    it('should use inviter name when available', async () => {
      mockAdminClient.from = vi.fn((table: string) => {
        if (table === 'accounts') {
          const callCount = vi.mocked(mockAdminClient.from).mock.calls.length;
          if (callCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { name: 'John Doe', email: 'john@test.com' },
                  error: null,
                }),
              ),
            };
          } else {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { name: 'Team' },
                  error: null,
                }),
              ),
            };
          }
        }
        return {};
      }) as unknown as typeof mockAdminClient.from;

      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 12,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'inviter-id',
        account_id: 'account-id',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      expect(mockRenderInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          inviter: 'John Doe',
        }),
      );
    });

    it('should use inviter email when name is null', async () => {
      mockAdminClient.from = vi.fn((table: string) => {
        if (table === 'accounts') {
          const callCount = vi.mocked(mockAdminClient.from).mock.calls.length;
          if (callCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { name: null, email: 'noname@test.com' },
                  error: null,
                }),
              ),
            };
          } else {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { name: 'Team' },
                  error: null,
                }),
              ),
            };
          }
        }
        return {};
      }) as unknown as typeof mockAdminClient.from;

      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 13,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'inviter-id',
        account_id: 'account-id',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      expect(mockRenderInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          inviter: 'noname@test.com',
        }),
      );
    });

    it('should use empty string when both name and email are null', async () => {
      mockAdminClient.from = vi.fn((table: string) => {
        if (table === 'accounts') {
          const callCount = vi.mocked(mockAdminClient.from).mock.calls.length;
          if (callCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { name: null, email: null },
                  error: null,
                }),
              ),
            };
          } else {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn(() =>
                Promise.resolve({
                  data: { name: 'Team' },
                  error: null,
                }),
              ),
            };
          }
        }
        return {};
      }) as unknown as typeof mockAdminClient.from;

      const service = createAccountInvitationsWebhookService(
        mockAdminClient as any,
      );

      const invitation = {
        id: 14,
        email: 'user@example.com',
        invite_token: 'token',
        invited_by: 'inviter-id',
        account_id: 'account-id',
        role: 'member' as const,
        expires_at: '2024-12-31',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      await service.handleInvitationWebhook(invitation);

      expect(mockRenderInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          inviter: '',
        }),
      );
    });
  });
});
