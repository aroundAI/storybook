import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Mailer } from '@kit/mailers-shared';

// Mock modules before imports
vi.mock('@kit/nodemailer', () => ({
  createNodemailerService: vi.fn(() => {
    return new (class extends Mailer {
      async sendEmail() {
        return { messageId: 'nodemailer-123' };
      }
    })();
  }),
}));

vi.mock('@kit/resend', () => ({
  createResendMailer: vi.fn(() => {
    return new (class extends Mailer {
      async sendEmail() {
        return { id: 'resend-456' };
      }
    })();
  }),
}));

describe('Mailer Factory', () => {
  // Store original env
  const originalEnv = process.env;
  const originalNextRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    // Reset modules and environment before each test
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.NEXT_RUNTIME = originalNextRuntime;
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
  });

  describe('getMailer', () => {
    describe('nodemailer provider', () => {
      it('should return nodemailer instance when MAILER_PROVIDER=nodemailer', async () => {
        process.env.MAILER_PROVIDER = 'nodemailer';
        process.env.NEXT_RUNTIME = 'nodejs';

        // Re-import to get fresh module with new env
        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        expect(mailer).toBeDefined();
        expect(mailer).toBeInstanceOf(Mailer);

        // Test that it can send email
        const result = await mailer.sendEmail({
          to: 'test@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test email',
        });

        expect(result).toHaveProperty('messageId');
        expect(result).toEqual({ messageId: 'nodemailer-123' });
      });

      it('should use nodemailer as default when MAILER_PROVIDER is not set', async () => {
        delete process.env.MAILER_PROVIDER;
        process.env.NEXT_RUNTIME = 'nodejs';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        expect(mailer).toBeDefined();
        expect(mailer).toBeInstanceOf(Mailer);
      });

      it('should throw error when nodemailer used on edge runtime', async () => {
        process.env.MAILER_PROVIDER = 'nodemailer';
        process.env.NEXT_RUNTIME = 'edge';

        const { getMailer } = await import('../src/index');

        await expect(getMailer()).rejects.toThrow(
          'Nodemailer is not available on the edge runtime',
        );
      });

      it('should handle multiple concurrent getMailer calls for nodemailer', async () => {
        process.env.MAILER_PROVIDER = 'nodemailer';
        process.env.NEXT_RUNTIME = 'nodejs';

        const { getMailer } = await import('../src/index');

        // Call getMailer multiple times concurrently
        const [mailer1, mailer2, mailer3] = await Promise.all([
          getMailer(),
          getMailer(),
          getMailer(),
        ]);

        expect(mailer1).toBeDefined();
        expect(mailer2).toBeDefined();
        expect(mailer3).toBeDefined();
      });
    });

    describe('resend provider', () => {
      it('should return resend instance when MAILER_PROVIDER=resend', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        expect(mailer).toBeDefined();
        expect(mailer).toBeInstanceOf(Mailer);

        // Test that it can send email
        const result = await mailer.sendEmail({
          to: 'test@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test email',
        });

        expect(result).toHaveProperty('id');
        expect(result).toEqual({ id: 'resend-456' });
      });

      it('should work on edge runtime', async () => {
        process.env.MAILER_PROVIDER = 'resend';
        process.env.NEXT_RUNTIME = 'edge';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        expect(mailer).toBeDefined();
        expect(mailer).toBeInstanceOf(Mailer);
      });

      it('should handle multiple concurrent getMailer calls for resend', async () => {
        process.env.MAILER_PROVIDER = 'resend';
        process.env.RESEND_API_KEY = 're_test_key';

        const { getMailer } = await import('../src/index');

        const [mailer1, mailer2, mailer3] = await Promise.all([
          getMailer(),
          getMailer(),
          getMailer(),
        ]);

        expect(mailer1).toBeDefined();
        expect(mailer2).toBeDefined();
        expect(mailer3).toBeDefined();

        delete process.env.RESEND_API_KEY;
      });
    });

    describe('provider switching', () => {
      it('should switch from nodemailer to resend', async () => {
        // First use nodemailer
        process.env.MAILER_PROVIDER = 'nodemailer';
        process.env.NEXT_RUNTIME = 'nodejs';

        const { getMailer: getMailer1 } = await import('../src/index');
        const mailer1 = await getMailer1();

        const result1 = await mailer1.sendEmail({
          to: 'test@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test',
        });

        expect(result1).toHaveProperty('messageId');

        // Reset and switch to resend
        vi.resetModules();
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer: getMailer2 } = await import('../src/index');
        const mailer2 = await getMailer2();

        const result2 = await mailer2.sendEmail({
          to: 'test@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Test',
        });

        expect(result2).toHaveProperty('id');
      });
    });

    describe('email sending functionality', () => {
      it('should successfully send email with text content', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const result = await mailer.sendEmail({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: 'Welcome!',
          text: 'Welcome to our service!',
        });

        expect(result).toBeDefined();
      });

      it('should successfully send email with HTML content', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const result = await mailer.sendEmail({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: 'Welcome!',
          html: '<h1>Welcome!</h1><p>Welcome to our service!</p>',
        });

        expect(result).toBeDefined();
      });

      it('should successfully send email with both text and HTML', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const result = await mailer.sendEmail({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: 'Welcome!',
          text: 'Welcome to our service!',
          html: '<h1>Welcome!</h1><p>Welcome to our service!</p>',
        });

        expect(result).toBeDefined();
      });

      it('should handle from field with display name', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const result = await mailer.sendEmail({
          to: 'user@example.com',
          from: 'My SaaS App <noreply@example.com>',
          subject: 'Welcome!',
          text: 'Welcome!',
        });

        expect(result).toBeDefined();
      });

      it('should handle empty subject', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const result = await mailer.sendEmail({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: '',
          text: 'Email with no subject',
        });

        expect(result).toBeDefined();
      });

      it('should handle special characters in subject', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const result = await mailer.sendEmail({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: 'Re: [URGENT] 🔥 Action Required!',
          text: 'Important message',
        });

        expect(result).toBeDefined();
      });

      it('should handle complex HTML email with inline CSS', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; }
                .container { max-width: 600px; margin: 0 auto; }
                .button { background-color: #007bff; color: white; padding: 10px 20px; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Welcome to Our Service!</h1>
                <p>Thank you for signing up.</p>
                <a href="https://example.com" class="button">Get Started</a>
              </div>
            </body>
          </html>
        `;

        const result = await mailer.sendEmail({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: 'Welcome!',
          html,
        });

        expect(result).toBeDefined();
      });

      it('should handle multiline text content', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const text = `Line 1
Line 2
Line 3

Line 5 after blank line`;

        const result = await mailer.sendEmail({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: 'Multiline email',
          text,
        });

        expect(result).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should throw error for invalid MAILER_PROVIDER values', async () => {
        process.env.MAILER_PROVIDER = 'RESEND' as any;

        // Importing should throw since MAILER_PROVIDER is validated on module load
        await expect(async () => {
          await import('../src/index');
        }).rejects.toThrow();
      });

      it('should throw error when NEXT_RUNTIME not set for nodemailer', async () => {
        process.env.MAILER_PROVIDER = 'nodemailer';
        delete process.env.NEXT_RUNTIME;

        const { getMailer } = await import('../src/index');

        // NEXT_RUNTIME must be explicitly 'nodejs' for nodemailer
        await expect(getMailer()).rejects.toThrow(
          'Nodemailer is not available on the edge runtime',
        );
      });

      it('should throw error when NEXT_RUNTIME is empty for nodemailer', async () => {
        process.env.MAILER_PROVIDER = 'nodemailer';
        process.env.NEXT_RUNTIME = '';

        const { getMailer } = await import('../src/index');

        // Empty string is not 'nodejs', so it throws
        await expect(getMailer()).rejects.toThrow(
          'Nodemailer is not available on the edge runtime',
        );
      });
    });

    describe('integration scenarios', () => {
      it('should handle rapid sequential email sends', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const emails = Array.from({ length: 5 }, (_, i) => ({
          to: `user${i}@example.com`,
          from: 'noreply@example.com',
          subject: `Email ${i}`,
          text: `This is email number ${i}`,
        }));

        const results = await Promise.all(
          emails.map((email) => mailer.sendEmail(email)),
        );

        expect(results).toHaveLength(5);
        results.forEach((result) => {
          expect(result).toHaveProperty('id');
        });
      });

      it('should maintain consistent mailer instance across calls', async () => {
        process.env.MAILER_PROVIDER = 'resend';

        const { getMailer } = await import('../src/index');

        const mailer1 = await getMailer();
        const mailer2 = await getMailer();

        // Send with first instance
        const result1 = await mailer1.sendEmail({
          to: 'user1@example.com',
          from: 'noreply@example.com',
          subject: 'Test 1',
          text: 'First email',
        });

        // Send with second instance
        const result2 = await mailer2.sendEmail({
          to: 'user2@example.com',
          from: 'noreply@example.com',
          subject: 'Test 2',
          text: 'Second email',
        });

        expect(result1).toBeDefined();
        expect(result2).toBeDefined();
      });

      it('should work in serverless/lambda environment', async () => {
        process.env.MAILER_PROVIDER = 'resend';
        process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-function';
        process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs20.x';

        const { getMailer } = await import('../src/index');
        const mailer = await getMailer();

        const result = await mailer.sendEmail({
          to: 'user@example.com',
          from: 'lambda@example.com',
          subject: 'Lambda email',
          text: 'Sent from Lambda',
        });

        expect(result).toBeDefined();

        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        delete process.env.AWS_EXECUTION_ENV;
      });
    });
  });

  describe('MAILER_PROVIDER constant', () => {
    it('should export MAILER_PROVIDER constant', async () => {
      process.env.MAILER_PROVIDER = 'resend';

      const { MAILER_PROVIDER } = await import('../src/index');

      expect(MAILER_PROVIDER).toBe('resend');
    });

    it('should default to nodemailer when not set', async () => {
      delete process.env.MAILER_PROVIDER;

      const { MAILER_PROVIDER } = await import('../src/index');

      expect(MAILER_PROVIDER).toBe('nodemailer');
    });
  });
});
