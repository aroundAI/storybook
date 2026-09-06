import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNotificationsService } from '../src/server/notifications.service';

describe('NotificationsService', () => {
  let mockSupabaseClient: {
    from: ReturnType<typeof vi.fn>;
  };

  let service: ReturnType<typeof createNotificationsService>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock Supabase client
    mockSupabaseClient = {
      from: vi.fn().mockReturnThis(),
    };

    // Add insert method to the chain
    (mockSupabaseClient.from as any).mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    // Create service instance
    service = createNotificationsService(mockSupabaseClient as any);
  });

  describe('createNotification', () => {
    describe('successful notification creation', () => {
      it('should create notification with required fields', async () => {
        const notification = {
          account_id: 'account-123',
          body: 'Test notification',
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from).toHaveBeenCalledWith('notifications');
        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should create notification with all fields', async () => {
        const notification = {
          account_id: 'account-456',
          body: 'Complete notification',
          channel: 'in_app' as const,
          type: 'info' as const,
          link: '/dashboard',
          dismissed: false,
          expires_at: new Date('2025-12-31').toISOString(),
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should create notification with channel', async () => {
        const notification = {
          account_id: 'account-789',
          body: 'Email notification',
          channel: 'email' as const,
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should create notification with type', async () => {
        const notification = {
          account_id: 'account-101',
          body: 'Warning message',
          type: 'warning' as const,
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should create notification with link', async () => {
        const notification = {
          account_id: 'account-102',
          body: 'Click to view',
          link: '/notifications/123',
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should create notification with expiration date', async () => {
        const expiresAt = new Date('2025-06-15').toISOString();
        const notification = {
          account_id: 'account-103',
          body: 'Temporary notification',
          expires_at: expiresAt,
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });
    });

    describe('notification channels', () => {
      it('should create in_app notification', async () => {
        await service.createNotification({
          account_id: 'acc-1',
          body: 'In-app message',
          channel: 'in_app',
        });

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          expect.objectContaining({ channel: 'in_app' }),
        );
      });

      it('should create email notification', async () => {
        await service.createNotification({
          account_id: 'acc-2',
          body: 'Email message',
          channel: 'email',
        });

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          expect.objectContaining({ channel: 'email' }),
        );
      });
    });

    describe('notification types', () => {
      it('should create info notification', async () => {
        await service.createNotification({
          account_id: 'acc-3',
          body: 'Info message',
          type: 'info',
        });

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'info' }),
        );
      });

      it('should create warning notification', async () => {
        await service.createNotification({
          account_id: 'acc-4',
          body: 'Warning message',
          type: 'warning',
        });

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'warning' }),
        );
      });

      it('should create error notification', async () => {
        await service.createNotification({
          account_id: 'acc-6',
          body: 'Error message',
          type: 'error',
        });

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });
    });

    describe('error handling', () => {
      it('should throw error when insert fails', async () => {
        const insertError = {
          message: 'Insert failed',
          code: 'PGRST116',
          details: 'Foreign key violation',
        };

        mockSupabaseClient.from = vi.fn().mockReturnValue({
          insert: vi.fn().mockResolvedValue({ error: insertError }),
        });

        const notification = {
          account_id: 'invalid-account',
          body: 'Test notification',
        };

        await expect(service.createNotification(notification)).rejects.toEqual(
          insertError,
        );
      });

      it('should throw error with proper error object', async () => {
        const dbError = {
          message: 'Database constraint violation',
          code: '23503',
          details: 'account_id does not exist',
        };

        mockSupabaseClient.from = vi.fn().mockReturnValue({
          insert: vi.fn().mockResolvedValue({ error: dbError }),
        });

        await expect(
          service.createNotification({
            account_id: 'non-existent',
            body: 'Test',
          }),
        ).rejects.toEqual(dbError);
      });

      it('should throw network error', async () => {
        const networkError = {
          message: 'Network request failed',
          code: 'NETWORK_ERROR',
        };

        mockSupabaseClient.from = vi.fn().mockReturnValue({
          insert: vi.fn().mockResolvedValue({ error: networkError }),
        });

        await expect(
          service.createNotification({
            account_id: 'acc-1',
            body: 'Test',
          }),
        ).rejects.toEqual(networkError);
      });
    });

    describe('notification content', () => {
      it('should handle long notification body', async () => {
        const longBody = 'A'.repeat(1000);
        const notification = {
          account_id: 'acc-7',
          body: longBody,
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should handle notification with special characters', async () => {
        const notification = {
          account_id: 'acc-8',
          body: 'Special chars: !@#$%^&*() <> "quotes" \'apostrophe\'',
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should handle notification with Unicode characters', async () => {
        const notification = {
          account_id: 'acc-9',
          body: '你好世界 🌍 مرحبا',
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should handle notification with newlines', async () => {
        const notification = {
          account_id: 'acc-10',
          body: 'Line 1\nLine 2\nLine 3',
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });
    });

    describe('notification links', () => {
      it('should handle absolute URL links', async () => {
        const notification = {
          account_id: 'acc-11',
          body: 'External link',
          link: 'https://example.com/page',
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should handle relative path links', async () => {
        const notification = {
          account_id: 'acc-12',
          body: 'Internal link',
          link: '/dashboard/settings',
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should handle link with query params', async () => {
        const notification = {
          account_id: 'acc-13',
          body: 'Link with params',
          link: '/notifications?filter=unread&page=2',
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should handle null link', async () => {
        const notification = {
          account_id: 'acc-14',
          body: 'No link',
          link: null,
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });
    });

    describe('expiration dates', () => {
      it('should handle future expiration date', async () => {
        const futureDate = new Date('2030-01-01').toISOString();
        const notification = {
          account_id: 'acc-15',
          body: 'Expires in future',
          expires_at: futureDate,
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should handle past expiration date', async () => {
        const pastDate = new Date('2020-01-01').toISOString();
        const notification = {
          account_id: 'acc-16',
          body: 'Already expired',
          expires_at: pastDate,
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });

      it('should handle null expiration date', async () => {
        const notification = {
          account_id: 'acc-17',
          body: 'Never expires',
          expires_at: null,
        };

        await service.createNotification(notification);

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(
          notification,
        );
      });
    });

    describe('service creation', () => {
      it('should create service instance with client', () => {
        const newService = createNotificationsService(
          mockSupabaseClient as any,
        );

        expect(newService).toBeDefined();
        expect(typeof newService.createNotification).toBe('function');
      });

      it('should create multiple service instances', () => {
        const service1 = createNotificationsService(mockSupabaseClient as any);
        const service2 = createNotificationsService(mockSupabaseClient as any);

        expect(service1).toBeDefined();
        expect(service2).toBeDefined();
        // Instances are different
        expect(service1).not.toBe(service2);
      });
    });

    describe('concurrent operations', () => {
      it('should handle concurrent notification creation', async () => {
        const notifications = Array(5)
          .fill(0)
          .map((_, i) => ({
            account_id: `acc-${i}`,
            body: `Notification ${i}`,
          }));

        await Promise.all(
          notifications.map((notif) => service.createNotification(notif)),
        );

        expect(mockSupabaseClient.from().insert).toHaveBeenCalledTimes(5);
        notifications.forEach((notif) => {
          expect(mockSupabaseClient.from().insert).toHaveBeenCalledWith(notif);
        });
      });
    });
  });
});
