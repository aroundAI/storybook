import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAccountWebhooksService } from '../src/server/services/webhooks/account-webhooks.service';

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
const mockRenderAccountDeleteEmail = vi.fn(() =>
  Promise.resolve({
    html: '<p>Account deleted</p>',
    subject: 'Your account has been deleted',
  }),
);

vi.mock('@kit/email-templates', () => ({
  renderAccountDeleteEmail: mockRenderAccountDeleteEmail,
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

describe('AccountWebhooksService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set required environment variables
    process.env.NEXT_PUBLIC_PRODUCT_NAME = 'Test Product';
    process.env.EMAIL_SENDER = 'noreply@test.com';
  });

  describe('service initialization', () => {
    it('should create service instance', () => {
      const service = createAccountWebhooksService();

      expect(service).toBeDefined();
      expect(typeof service.handleAccountDeletedWebhook).toBe('function');
    });

    it('should not require dependencies in constructor', () => {
      const service = createAccountWebhooksService();

      expect(service).toBeDefined();
    });
  });

  describe('handleAccountDeletedWebhook - personal accounts', () => {
    it('should handle personal account deletion webhook', async () => {
      const service = createAccountWebhooksService();

      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'John Doe',
        email: 'john@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '123',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(account);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: account.id,
          namespace: 'accounts.webhooks',
        }),
        'Received account deleted webhook. Processing...',
      );
    });

    it('should send deletion email for personal accounts', async () => {
      const service = createAccountWebhooksService();

      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Jane Smith',
        email: 'jane@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '456',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(account);

      expect(mockRenderAccountDeleteEmail).toHaveBeenCalledWith({
        userDisplayName: 'Jane Smith',
        productName: 'Test Product',
      });

      expect(mockSendEmail).toHaveBeenCalledWith({
        to: 'jane@example.com',
        from: 'noreply@test.com',
        subject: 'Your account has been deleted',
        html: '<p>Account deleted</p>',
      });
    });

    it('should use email as display name when name is null', async () => {
      const service = createAccountWebhooksService();

      // `accounts.name` is NOT NULL, so this case is unreachable through the
      // type — but the service still falls back to the email, and that
      // fallback is what this test covers.
      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: null as unknown as string,
        email: 'user@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '789',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(account);

      expect(mockRenderAccountDeleteEmail).toHaveBeenCalledWith({
        userDisplayName: 'user@example.com',
        productName: 'Test Product',
      });
    });

    it('should log when sending email to personal account', async () => {
      const service = createAccountWebhooksService();

      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test User',
        email: 'test@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '101',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(account);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: account.id,
        }),
        'Account is personal. We send an email to the user.',
      );
    });
  });

  describe('handleAccountDeletedWebhook - team accounts', () => {
    it('should not send email for team accounts', async () => {
      const service = createAccountWebhooksService();

      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Team Account',
        email: null,
        is_personal_account: false,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: 'team-account',
        public_data: null,
        primary_owner_user_id: '202',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(account);

      expect(mockRenderAccountDeleteEmail).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('should only log webhook receipt for team accounts', async () => {
      const service = createAccountWebhooksService();

      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Company Team',
        email: null,
        is_personal_account: false,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: 'company-team',
        public_data: null,
        primary_owner_user_id: '303',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(account);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: account.id,
          namespace: 'accounts.webhooks',
        }),
        'Received account deleted webhook. Processing...',
      );

      // Should not log personal account message
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('personal'),
      );
    });
  });

  describe('handleAccountDeletedWebhook - email sending', () => {
    it('should not send email when account has no email', async () => {
      const service = createAccountWebhooksService();

      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'No Email User',
        email: null,
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '404',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(account);

      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('should use environment variables for email settings', async () => {
      process.env.EMAIL_SENDER = 'custom@sender.com';
      process.env.NEXT_PUBLIC_PRODUCT_NAME = 'Custom Product';

      const service = createAccountWebhooksService();

      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'User',
        email: 'user@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '505',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(account);

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@sender.com',
        }),
      );

      expect(mockRenderAccountDeleteEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          productName: 'Custom Product',
        }),
      );
    });
  });

  describe('handleAccountDeletedWebhook - environment validation', () => {
    it('should throw error when EMAIL_SENDER is missing', async () => {
      delete process.env.EMAIL_SENDER;

      const service = createAccountWebhooksService();

      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'User',
        email: 'user@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '606',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await expect(
        service.handleAccountDeletedWebhook(account),
      ).rejects.toThrow();
    });

    it('should throw error when NEXT_PUBLIC_PRODUCT_NAME is missing', async () => {
      delete process.env.NEXT_PUBLIC_PRODUCT_NAME;

      const service = createAccountWebhooksService();

      const account = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'User',
        email: 'user@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '707',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await expect(
        service.handleAccountDeletedWebhook(account),
      ).rejects.toThrow();
    });
  });

  describe('handleAccountDeletedWebhook - integration scenarios', () => {
    it('should handle multiple sequential webhook calls', async () => {
      const service = createAccountWebhooksService();

      const account1 = {
        id: '123e4567-e89b-12d3-a456-111111111111',
        name: 'User One',
        email: 'user1@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '801',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      const account2 = {
        id: '123e4567-e89b-12d3-a456-222222222222',
        name: 'User Two',
        email: 'user2@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '802',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(account1);
      await service.handleAccountDeletedWebhook(account2);

      expect(mockSendEmail).toHaveBeenCalledTimes(2);
    });

    it('should handle mix of personal and team account deletions', async () => {
      const service = createAccountWebhooksService();

      const personalAccount = {
        id: '123e4567-e89b-12d3-a456-111111111111',
        name: 'Personal User',
        email: 'personal@example.com',
        is_personal_account: true,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: null,
        public_data: null,
        primary_owner_user_id: '901',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      const teamAccount = {
        id: '123e4567-e89b-12d3-a456-222222222222',
        name: 'Team',
        email: null,
        is_personal_account: false,
        picture_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        slug: 'team',
        public_data: null,
        primary_owner_user_id: '902',
        created_by: null,
        updated_by: null,
        current_usage_cents: 0,
        monthly_budget_cents: null,
        public_profile: null,
      };

      await service.handleAccountDeletedWebhook(personalAccount);
      await service.handleAccountDeletedWebhook(teamAccount);

      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledTimes(3); // 2 webhook receipt + 1 personal log
    });
  });
});
