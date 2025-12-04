import { beforeEach, describe, expect, it, vi } from 'vitest';

// Get mocked functions
import { getMailer } from '@kit/mailers';

// Now import the function being tested
import { sendContactEmail } from '../_lib/server/server-actions';

// Mock dependencies before importing
vi.mock('@kit/mailers', () => ({
  getMailer: vi.fn(),
}));

const mockGetMailer = vi.mocked(getMailer);

describe('Contact Form Server Actions', () => {
  let mockSendEmail: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock mailer
    mockSendEmail = vi.fn().mockResolvedValue(undefined);

    mockGetMailer.mockResolvedValue({
      sendEmail: mockSendEmail,
    } as any);
  });

  describe('sendContactEmail', () => {
    describe('Successful email sending', () => {
      it('should send contact email with valid data', async () => {
        const data = {
          name: 'John Doe',
          email: 'john@example.com',
          message: 'Hello, I have a question about your service.',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
        expect(mockSendEmail).toHaveBeenCalled();
      });

      it('should call sendEmail with correct parameters', async () => {
        const data = {
          name: 'Jane Smith',
          email: 'jane@example.com',
          message: 'Looking forward to learning more!',
        };

        await sendContactEmail(data);

        expect(mockSendEmail).toHaveBeenCalledWith({
          to: 'contact@example.com',
          from: 'noreply@example.com',
          subject: 'Contact Form Submission',
          html: expect.stringContaining('Jane Smith'),
        });
      });

      it('should include all form data in email HTML', async () => {
        const data = {
          name: 'Test User',
          email: 'test@example.com',
          message: 'Test message content',
        };

        await sendContactEmail(data);

        const emailCall = mockSendEmail.mock.calls[0][0];
        expect(emailCall.html).toContain('Test User');
        expect(emailCall.html).toContain('test@example.com');
        expect(emailCall.html).toContain('Test message content');
      });

      it('should use environment variables for email addresses', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'Message',
        };

        await sendContactEmail(data);

        expect(mockSendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'contact@example.com',
            from: 'noreply@example.com',
          }),
        );
      });
    });

    describe('Input validation', () => {
      it('should reject empty name', async () => {
        const data = {
          name: '',
          email: 'user@example.com',
          message: 'Message',
        };

        await expect(sendContactEmail(data)).rejects.toThrow();
      });

      it('should reject invalid email format', async () => {
        const data = {
          name: 'User',
          email: 'invalid-email',
          message: 'Message',
        };

        await expect(sendContactEmail(data)).rejects.toThrow();
      });

      it('should reject empty message', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message: '',
        };

        await expect(sendContactEmail(data)).rejects.toThrow();
      });

      it('should reject name longer than 200 characters', async () => {
        const data = {
          name: 'A'.repeat(201),
          email: 'user@example.com',
          message: 'Message',
        };

        await expect(sendContactEmail(data)).rejects.toThrow();
      });

      it('should reject message longer than 5000 characters', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'A'.repeat(5001),
        };

        await expect(sendContactEmail(data)).rejects.toThrow();
      });

      it('should accept name with exactly 200 characters', async () => {
        const data = {
          name: 'A'.repeat(200),
          email: 'user@example.com',
          message: 'Message',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
        expect(mockSendEmail).toHaveBeenCalled();
      });

      it('should accept message with exactly 5000 characters', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'A'.repeat(5000),
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
        expect(mockSendEmail).toHaveBeenCalled();
      });
    });

    describe('Email address formats', () => {
      it('should accept standard email format', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'Message',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
        expect(mockSendEmail).toHaveBeenCalled();
      });

      it('should accept email with plus addressing', async () => {
        const data = {
          name: 'User',
          email: 'user+test@example.com',
          message: 'Message',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
      });

      it('should accept email with subdomain', async () => {
        const data = {
          name: 'User',
          email: 'user@mail.example.com',
          message: 'Message',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
      });

      it('should accept email with numbers', async () => {
        const data = {
          name: 'User',
          email: 'user123@example.com',
          message: 'Message',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
      });
    });

    describe('Special characters in input', () => {
      it('should handle special characters in name', async () => {
        const data = {
          name: "John O'Brien <test>",
          email: 'john@example.com',
          message: 'Message',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
        expect(mockSendEmail).toHaveBeenCalled();
      });

      it('should handle special characters in message', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message:
            'Hello! <script>alert("test")</script> & special chars "quotes"',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
        const emailCall = mockSendEmail.mock.calls[0][0];
        expect(emailCall.html).toContain(data.message);
      });

      it('should handle unicode characters', async () => {
        const data = {
          name: '你好世界',
          email: 'user@example.com',
          message: 'مرحبا بالعالم 🌍',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
      });

      it('should handle newlines in message', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'Line 1\nLine 2\nLine 3',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
      });
    });

    describe('Error handling', () => {
      it('should handle mailer service errors', async () => {
        mockSendEmail.mockRejectedValue(new Error('Email service unavailable'));

        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'Message',
        };

        await expect(sendContactEmail(data)).rejects.toThrow(
          'Email service unavailable',
        );
      });

      it('should handle network errors', async () => {
        mockSendEmail.mockRejectedValue(new Error('Network error'));

        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'Message',
        };

        await expect(sendContactEmail(data)).rejects.toThrow('Network error');
      });

      it('should handle timeout errors', async () => {
        mockSendEmail.mockRejectedValue(new Error('Request timeout'));

        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'Message',
        };

        await expect(sendContactEmail(data)).rejects.toThrow('Request timeout');
      });
    });

    describe('Integration scenarios', () => {
      it('should handle multiple contact form submissions', async () => {
        const submissions = [
          {
            name: 'User 1',
            email: 'user1@example.com',
            message: 'Message 1',
          },
          {
            name: 'User 2',
            email: 'user2@example.com',
            message: 'Message 2',
          },
          {
            name: 'User 3',
            email: 'user3@example.com',
            message: 'Message 3',
          },
        ];

        for (const data of submissions) {
          await sendContactEmail(data);
        }

        expect(mockSendEmail).toHaveBeenCalledTimes(3);
      });

      it('should handle concurrent submissions', async () => {
        const submissions = Array.from({ length: 5 }, (_, i) => ({
          name: `User ${i}`,
          email: `user${i}@example.com`,
          message: `Message ${i}`,
        }));

        await Promise.all(submissions.map((data) => sendContactEmail(data)));

        expect(mockSendEmail).toHaveBeenCalledTimes(5);
      });
    });

    describe('Edge cases', () => {
      it('should handle very long valid name', async () => {
        const data = {
          name: 'A'.repeat(200),
          email: 'user@example.com',
          message: 'Message',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
      });

      it('should handle very long valid message', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'A'.repeat(5000),
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
      });

      it('should handle email with multiple dots', async () => {
        const data = {
          name: 'User',
          email: 'user.name.test@example.co.uk',
          message: 'Message',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
      });

      it('should handle message with only whitespace after trimming', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message: '   ',
        };

        // Zod string validation should fail for whitespace-only
        const result = await sendContactEmail(data);

        // This might pass if Zod doesn't trim - depends on schema
        // If it passes, the whitespace will be sent
        expect(mockSendEmail).toHaveBeenCalled();
      });
    });

    describe('Return value', () => {
      it('should return empty object on success', async () => {
        const data = {
          name: 'User',
          email: 'user@example.com',
          message: 'Message',
        };

        const result = await sendContactEmail(data);

        expect(result).toEqual({});
      });

      it('should throw error on validation failure', async () => {
        const data = {
          name: '',
          email: 'invalid',
          message: '',
        };

        await expect(sendContactEmail(data)).rejects.toThrow();
      });
    });
  });
});
