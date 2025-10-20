import { describe, expect, it } from 'vitest';

import { MailerSchema } from '../src/schema/mailer.schema';
import { SmtpConfigSchema } from '../src/schema/smtp-config.schema';

describe('Mailer Schemas', () => {
  describe('MailerSchema', () => {
    describe('basic validation', () => {
      it('should validate email with text content', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Test Email',
          text: 'Hello, this is a test email.',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.to).toBe('user@example.com');
          expect(result.data.from).toBe('sender@example.com');
          expect(result.data.subject).toBe('Test Email');
          expect(result.data.text).toBe('Hello, this is a test email.');
        }
      });

      it('should validate email with HTML content', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'HTML Email',
          html: '<h1>Hello</h1><p>This is a test.</p>',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.html).toBe('<h1>Hello</h1><p>This is a test.</p>');
        }
      });

      it('should accept both text and HTML content', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Multi-format Email',
          text: 'Plain text version',
          html: '<p>HTML version</p>',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('email validation', () => {
      it('should validate correct email format', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'noreply@yourdomain.com',
          subject: 'Test',
          text: 'Content',
        });

        expect(result.success).toBe(true);
      });

      it('should reject invalid to email', () => {
        const result = MailerSchema.safeParse({
          to: 'invalid-email',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Content',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.path).toContain('to');
        }
      });

      it('should accept various valid email formats for to field', () => {
        const emails = [
          'user@example.com',
          'user.name@example.co.uk',
          'user+tag@example.com',
          'user_name@test-domain.com',
        ];

        emails.forEach((email) => {
          const result = MailerSchema.safeParse({
            to: email,
            from: 'sender@example.com',
            subject: 'Test',
            text: 'Content',
          });

          expect(result.success).toBe(true);
        });
      });
    });

    describe('from field validation', () => {
      it('should accept email format for from field', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: 'Test',
          text: 'Content',
        });

        expect(result.success).toBe(true);
      });

      it('should accept name with email format for from field', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'My SaaS App <noreply@example.com>',
          subject: 'Test',
          text: 'Content',
        });

        expect(result.success).toBe(true);
      });

      it('should accept from field with just a name', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'Support Team',
          subject: 'Test',
          text: 'Content',
        });

        expect(result.success).toBe(true);
      });

      it('should reject empty from field', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: '',
          subject: 'Test',
          text: 'Content',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.path).toContain('from');
        }
      });
    });

    describe('subject validation', () => {
      it('should accept empty subject', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: '',
          text: 'Content',
        });

        expect(result.success).toBe(true);
      });

      it('should accept subject with special characters', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Re: [URGENT] 🔥 Action Required!',
          text: 'Content',
        });

        expect(result.success).toBe(true);
      });

      it('should accept long subject lines', () => {
        const longSubject = 'A'.repeat(200);
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: longSubject,
          text: 'Content',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('content validation', () => {
      it('should require either text or HTML', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Test',
        });

        expect(result.success).toBe(false);
      });

      it('should accept empty text content', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          text: '',
        });

        expect(result.success).toBe(true);
      });

      it('should accept empty HTML content', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          html: '',
        });

        expect(result.success).toBe(true);
      });

      it('should accept multiline text content', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Line 1\nLine 2\nLine 3',
        });

        expect(result.success).toBe(true);
      });

      it('should accept complex HTML content', () => {
        const html = `
          <!DOCTYPE html>
          <html>
            <head><style>body { font-family: Arial; }</style></head>
            <body>
              <h1>Welcome!</h1>
              <p>This is a <strong>test</strong> email.</p>
              <a href="https://example.com">Click here</a>
            </body>
          </html>
        `;

        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          html,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('missing fields', () => {
      it('should reject missing to field', () => {
        const result = MailerSchema.safeParse({
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Content',
        });

        expect(result.success).toBe(false);
      });

      it('should reject missing from field', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Content',
        });

        expect(result.success).toBe(false);
      });

      it('should reject missing subject field', () => {
        const result = MailerSchema.safeParse({
          to: 'user@example.com',
          from: 'sender@example.com',
          text: 'Content',
        });

        expect(result.success).toBe(false);
      });
    });
  });

  describe('SmtpConfigSchema', () => {
    describe('valid configuration', () => {
      it('should validate complete SMTP configuration', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'noreply@example.com',
          pass: 'secret-password',
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.user).toBe('noreply@example.com');
          expect(result.data.pass).toBe('secret-password');
          expect(result.data.host).toBe('smtp.gmail.com');
          expect(result.data.port).toBe(587);
          expect(result.data.secure).toBe(false);
        }
      });

      it('should validate secure SMTP configuration (port 465)', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'smtp-user@example.com',
          pass: 'password123',
          host: 'smtp.example.com',
          port: 465,
          secure: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.port).toBe(465);
          expect(result.data.secure).toBe(true);
        }
      });

      it('should validate Gmail SMTP configuration', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'myemail@gmail.com',
          pass: 'app-specific-password',
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
        });

        expect(result.success).toBe(true);
      });

      it('should validate Office365 SMTP configuration', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'user@company.com',
          pass: 'office-password',
          host: 'smtp.office365.com',
          port: 587,
          secure: false,
        });

        expect(result.success).toBe(true);
      });

      it('should validate custom SMTP server', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'noreply',
          pass: 'custom-pass',
          host: 'mail.mydomain.com',
          port: 25,
          secure: false,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.port).toBe(25);
        }
      });
    });

    describe('field validation', () => {
      it('should accept various user formats', () => {
        const users = [
          'user@example.com',
          'username',
          'user@domain',
          'smtp-user-123',
        ];

        users.forEach((user) => {
          const result = SmtpConfigSchema.safeParse({
            user,
            pass: 'password',
            host: 'smtp.example.com',
            port: 587,
            secure: false,
          });

          expect(result.success).toBe(true);
        });
      });

      it('should accept various host formats', () => {
        const hosts = [
          'smtp.gmail.com',
          'smtp-relay.sendinblue.com',
          'mail.example.com',
          '192.168.1.1',
        ];

        hosts.forEach((host) => {
          const result = SmtpConfigSchema.safeParse({
            user: 'user',
            pass: 'password',
            host,
            port: 587,
            secure: false,
          });

          expect(result.success).toBe(true);
        });
      });

      it('should accept common SMTP ports', () => {
        const ports = [25, 465, 587, 2525];

        ports.forEach((port) => {
          const result = SmtpConfigSchema.safeParse({
            user: 'user',
            pass: 'password',
            host: 'smtp.example.com',
            port,
            secure: port === 465,
          });

          expect(result.success).toBe(true);
        });
      });
    });

    describe('missing fields with custom error messages', () => {
      it('should show custom error for missing user', () => {
        const result = SmtpConfigSchema.safeParse({
          pass: 'password',
          host: 'smtp.example.com',
          port: 587,
          secure: false,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          const userError = result.error.issues.find((i) =>
            i.path.includes('user'),
          );
          expect(userError?.message).toContain('Please provide the variable EMAIL_USER');
        }
      });

      it('should show custom error for missing pass', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'user',
          host: 'smtp.example.com',
          port: 587,
          secure: false,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          const passError = result.error.issues.find((i) =>
            i.path.includes('pass'),
          );
          expect(passError?.message).toContain('Please provide the variable EMAIL_PASSWORD');
        }
      });

      it('should show custom error for missing host', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'user',
          pass: 'password',
          port: 587,
          secure: false,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          const hostError = result.error.issues.find((i) =>
            i.path.includes('host'),
          );
          expect(hostError?.message).toContain('Please provide the variable EMAIL_HOST');
        }
      });

      it('should show custom error for missing port', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'user',
          pass: 'password',
          host: 'smtp.example.com',
          secure: false,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          const portError = result.error.issues.find((i) =>
            i.path.includes('port'),
          );
          expect(portError?.message).toContain('Please provide the variable EMAIL_PORT');
        }
      });

      it('should show custom error for missing secure', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'user',
          pass: 'password',
          host: 'smtp.example.com',
          port: 587,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          const secureError = result.error.issues.find((i) =>
            i.path.includes('secure'),
          );
          expect(secureError?.message).toContain('Please provide the variable EMAIL_TLS');
        }
      });
    });

    describe('type validation', () => {
      it('should reject non-number port', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'user',
          pass: 'password',
          host: 'smtp.example.com',
          port: '587', // String instead of number
          secure: false,
        });

        expect(result.success).toBe(false);
      });

      it('should reject non-boolean secure', () => {
        const result = SmtpConfigSchema.safeParse({
          user: 'user',
          pass: 'password',
          host: 'smtp.example.com',
          port: 587,
          secure: 'false', // String instead of boolean
        });

        expect(result.success).toBe(false);
      });
    });
  });
});
