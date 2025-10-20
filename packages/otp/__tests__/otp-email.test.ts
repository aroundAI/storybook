import { beforeEach, describe, expect, it, vi } from 'vitest';

// Set required environment variables BEFORE any imports
process.env.EMAIL_SENDER = 'noreply@example.com';
process.env.NEXT_PUBLIC_PRODUCT_NAME = 'Test SaaS';

// Mock dependencies before imports
vi.mock('@kit/email-templates', () => ({
  renderOtpEmail: vi.fn(),
}));

vi.mock('@kit/mailers', () => ({
  getMailer: vi.fn(),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(),
}));

import { renderOtpEmail } from '@kit/email-templates';
import { getMailer } from '@kit/mailers';
import { getLogger } from '@kit/shared/logger';

import { createOtpEmailService } from '../src/server/otp-email.service';

describe('OtpEmailService', () => {
  // Store original env
  const originalEnv = process.env;

  let mockMailer: {
    sendEmail: ReturnType<typeof vi.fn>;
  };

  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    process.env.EMAIL_SENDER = 'noreply@example.com';
    process.env.NEXT_PUBLIC_PRODUCT_NAME = 'Test SaaS';

    // Reset mocks
    vi.clearAllMocks();

    // Setup mock mailer
    mockMailer = {
      sendEmail: vi.fn().mockResolvedValue({ id: 'email_123' }),
    };

    // Setup mock logger
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    // Setup mock return values
    vi.mocked(getMailer).mockResolvedValue(mockMailer as any);
    vi.mocked(getLogger).mockResolvedValue(mockLogger as any);
    vi.mocked(renderOtpEmail).mockResolvedValue({
      html: '<p>Your OTP: 123456</p>',
      subject: 'Your verification code',
    });
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
  });

  describe('sendOtpEmail', () => {
    describe('successful email sending', () => {
      it('should send OTP email with valid parameters', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '123456',
        });

        expect(mockMailer.sendEmail).toHaveBeenCalledWith({
          to: 'user@example.com',
          subject: 'Your verification code',
          html: '<p>Your OTP: 123456</p>',
          from: 'test@example.com',
        });
      });

      it('should call renderOtpEmail with correct parameters', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '654321',
        });

        expect(renderOtpEmail).toHaveBeenCalledWith({
          otp: '654321',
          productName: 'Test Product',
        });
      });

      it('should log info messages before and after sending', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '123456',
        });

        expect(mockLogger.info).toHaveBeenCalledTimes(2);
        expect(mockLogger.info).toHaveBeenNthCalledWith(
          1,
          { otp: '123456' },
          'Sending OTP email...',
        );
        expect(mockLogger.info).toHaveBeenNthCalledWith(
          2,
          { otp: '123456' },
          'OTP email sent',
        );
      });

      it('should use EMAIL_SENDER from environment', async () => {
        process.env.EMAIL_SENDER = 'custom@sender.com';

        // Need to reload module to pick up new env
        vi.resetModules();

        const { createOtpEmailService: createService } = await import(
          '../src/server/otp-email.service'
        );

        const service = createService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '123456',
        });

        expect(mockMailer.sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            from: 'custom@sender.com',
          }),
        );
      });

      it('should use NEXT_PUBLIC_PRODUCT_NAME from environment', async () => {
        process.env.NEXT_PUBLIC_PRODUCT_NAME = 'My Custom App';

        // Need to reload module to pick up new env
        vi.resetModules();

        const { createOtpEmailService: createService } = await import(
          '../src/server/otp-email.service'
        );

        const service = createService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '123456',
        });

        expect(renderOtpEmail).toHaveBeenCalledWith({
          otp: '123456',
          productName: 'My Custom App',
        });
      });
    });

    describe('email sending errors', () => {
      it('should log error and rethrow when sendEmail fails', async () => {
        const sendError = new Error('Failed to send email');
        mockMailer.sendEmail.mockRejectedValueOnce(sendError);

        const service = createOtpEmailService();

        await expect(
          service.sendOtpEmail({
            email: 'user@example.com',
            otp: '123456',
          }),
        ).rejects.toThrow('Failed to send email');

        expect(mockLogger.error).toHaveBeenCalledWith(
          { otp: '123456', error: sendError },
          'Error sending OTP email',
        );
      });

      it('should log error with OTP context', async () => {
        const sendError = new Error('Network timeout');
        mockMailer.sendEmail.mockRejectedValueOnce(sendError);

        const service = createOtpEmailService();

        await expect(
          service.sendOtpEmail({
            email: 'user@example.com',
            otp: '789012',
          }),
        ).rejects.toThrow();

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            otp: '789012',
            error: sendError,
          }),
          'Error sending OTP email',
        );
      });

      it('should not call success log when sendEmail fails', async () => {
        mockMailer.sendEmail.mockRejectedValueOnce(
          new Error('Failed to send'),
        );

        const service = createOtpEmailService();

        await expect(
          service.sendOtpEmail({
            email: 'user@example.com',
            otp: '123456',
          }),
        ).rejects.toThrow();

        // Should have 1 info log (sending...) but not 2 (sent)
        expect(mockLogger.info).toHaveBeenCalledTimes(1);
        expect(mockLogger.info).toHaveBeenCalledWith(
          { otp: '123456' },
          'Sending OTP email...',
        );
      });
    });

    describe('different email addresses', () => {
      it('should handle standard email format', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'test@example.com',
          otp: '123456',
        });

        expect(mockMailer.sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'test@example.com',
          }),
        );
      });

      it('should handle email with plus addressing', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user+test@example.com',
          otp: '123456',
        });

        expect(mockMailer.sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'user+test@example.com',
          }),
        );
      });

      it('should handle email with subdomain', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'admin@mail.example.com',
          otp: '123456',
        });

        expect(mockMailer.sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'admin@mail.example.com',
          }),
        );
      });
    });

    describe('different OTP formats', () => {
      it('should handle 6-digit numeric OTP', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '123456',
        });

        expect(renderOtpEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            otp: '123456',
          }),
        );
      });

      it('should handle 4-digit numeric OTP', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '1234',
        });

        expect(renderOtpEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            otp: '1234',
          }),
        );
      });

      it('should handle 8-digit numeric OTP', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '12345678',
        });

        expect(renderOtpEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            otp: '12345678',
          }),
        );
      });

      it('should handle alphanumeric OTP', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: 'ABC123',
        });

        expect(renderOtpEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            otp: 'ABC123',
          }),
        );
      });

      it('should handle OTP with leading zeros', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '001234',
        });

        expect(renderOtpEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            otp: '001234',
          }),
        );
      });
    });

    describe('service integration', () => {
      it('should call all services in correct order', async () => {
        const service = createOtpEmailService();
        const callOrder: string[] = [];

        vi.mocked(getLogger).mockImplementation(async () => {
          callOrder.push('getLogger');
          return mockLogger as any;
        });

        vi.mocked(getMailer).mockImplementation(async () => {
          callOrder.push('getMailer');
          return mockMailer as any;
        });

        vi.mocked(renderOtpEmail).mockImplementation(async () => {
          callOrder.push('renderOtpEmail');
          return {
            html: '<p>Test</p>',
            subject: 'Test',
          };
        });

        mockMailer.sendEmail.mockImplementation(async () => {
          callOrder.push('sendEmail');
          return { id: 'test' };
        });

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '123456',
        });

        expect(callOrder).toEqual([
          'getLogger',
          'getMailer',
          'renderOtpEmail',
          'sendEmail',
        ]);
      });

      it('should create multiple service instances independently', async () => {
        const service1 = createOtpEmailService();
        const service2 = createOtpEmailService();

        await service1.sendOtpEmail({
          email: 'user1@example.com',
          otp: '111111',
        });

        await service2.sendOtpEmail({
          email: 'user2@example.com',
          otp: '222222',
        });

        expect(mockMailer.sendEmail).toHaveBeenCalledTimes(2);
        expect(mockMailer.sendEmail).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            to: 'user1@example.com',
          }),
        );
        expect(mockMailer.sendEmail).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            to: 'user2@example.com',
          }),
        );
      });

      it('should handle concurrent email sends', async () => {
        const service = createOtpEmailService();

        await Promise.all([
          service.sendOtpEmail({
            email: 'user1@example.com',
            otp: '111111',
          }),
          service.sendOtpEmail({
            email: 'user2@example.com',
            otp: '222222',
          }),
          service.sendOtpEmail({
            email: 'user3@example.com',
            otp: '333333',
          }),
        ]);

        expect(mockMailer.sendEmail).toHaveBeenCalledTimes(3);
      });
    });

    describe('edge cases', () => {
      it('should handle empty OTP string', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: '',
        });

        expect(renderOtpEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            otp: '',
          }),
        );
      });

      it('should handle very long OTP', async () => {
        const service = createOtpEmailService();
        const longOtp = '1'.repeat(100);

        await service.sendOtpEmail({
          email: 'user@example.com',
          otp: longOtp,
        });

        expect(renderOtpEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            otp: longOtp,
          }),
        );
      });

      it('should handle special characters in email', async () => {
        const service = createOtpEmailService();

        await service.sendOtpEmail({
          email: 'user.name+tag@sub.example.co.uk',
          otp: '123456',
        });

        expect(mockMailer.sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'user.name+tag@sub.example.co.uk',
          }),
        );
      });
    });

    describe('environment variable validation', () => {
      it('should throw error when EMAIL_SENDER is missing', async () => {
        delete process.env.EMAIL_SENDER;

        expect(() => {
          // Need to dynamically import to trigger validation
          vi.resetModules();
          require('../src/server/otp-email.service');
        }).toThrow();
      });

      it('should throw error when EMAIL_SENDER is empty', async () => {
        process.env.EMAIL_SENDER = '';

        expect(() => {
          vi.resetModules();
          require('../src/server/otp-email.service');
        }).toThrow();
      });

      it('should throw error when NEXT_PUBLIC_PRODUCT_NAME is missing', async () => {
        delete process.env.NEXT_PUBLIC_PRODUCT_NAME;

        expect(() => {
          vi.resetModules();
          require('../src/server/otp-email.service');
        }).toThrow();
      });

      it('should throw error when NEXT_PUBLIC_PRODUCT_NAME is empty', async () => {
        process.env.NEXT_PUBLIC_PRODUCT_NAME = '';

        expect(() => {
          vi.resetModules();
          require('../src/server/otp-email.service');
        }).toThrow();
      });
    });
  });
});
