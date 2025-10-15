/**
 * Email Worker Lambda Tests
 *
 * TODO: Install vitest and @types/aws-lambda to implement these tests
 * Run: pnpm add -D vitest @types/aws-lambda
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../index';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

// Mock AWS SDK
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: vi.fn(() => ({
    send: vi.fn(),
  })),
  SendEmailCommand: vi.fn(),
}));

describe('Email Worker Lambda', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up environment variables
    process.env.EMAIL_PROVIDER = 'ses';
    process.env.AWS_REGION = 'us-east-1';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  describe('Valid Email Jobs', () => {
    it('should process valid email successfully', async () => {
      const event: SQSEvent = {
        Records: [
          createSQSRecord({
            to: 'user@example.com',
            from: 'noreply@test.com',
            subject: 'Test Email',
            html: '<p>Test content</p>',
          }),
        ],
      };

      const result = await handler(event);

      expect(result).toEqual({
        statusCode: 200,
        body: JSON.stringify({
          successful: 1,
          failed: 0,
          total: 1,
        }),
      });
    });

    it('should process multiple emails in batch', async () => {
      const event: SQSEvent = {
        Records: [
          createSQSRecord({
            to: 'user1@example.com',
            from: 'noreply@test.com',
            subject: 'Test 1',
          }),
          createSQSRecord({
            to: 'user2@example.com',
            from: 'noreply@test.com',
            subject: 'Test 2',
          }),
          createSQSRecord({
            to: 'user3@example.com',
            from: 'noreply@test.com',
            subject: 'Test 3',
          }),
        ],
      };

      const result = await handler(event);

      expect(result).toEqual({
        statusCode: 200,
        body: JSON.stringify({
          successful: 3,
          failed: 0,
          total: 3,
        }),
      });
    });
  });

  describe('Invalid Email Data', () => {
    it('should handle invalid JSON in message body', async () => {
      const event: SQSEvent = {
        Records: [
          {
            ...createSQSRecord({ to: 'test@example.com' }),
            body: 'invalid-json{{{',
          },
        ],
      };

      const result = await handler(event);

      expect(result.batchItemFailures).toBeDefined();
      expect(result.batchItemFailures).toHaveLength(1);
    });

    it('should handle missing required fields (to)', async () => {
      const event: SQSEvent = {
        Records: [
          createSQSRecord({
            // Missing 'to' field
            from: 'noreply@test.com',
            subject: 'Test',
          } as Partial<{ to: string; from: string; subject: string }> as { to: string; from: string; subject?: string }),
        ],
      };

      const result = await handler(event);

      expect(result.batchItemFailures).toBeDefined();
      expect(result.batchItemFailures).toHaveLength(1);
    });

    it('should handle missing required fields (subject)', async () => {
      const event: SQSEvent = {
        Records: [
          createSQSRecord({
            to: 'user@example.com',
            from: 'noreply@test.com',
            // Missing subject
          } as Partial<{ to: string; from: string; subject: string }> as { to: string; from: string; subject?: string }),
        ],
      };

      const result = await handler(event);

      expect(result.batchItemFailures).toBeDefined();
      expect(result.batchItemFailures).toHaveLength(1);
    });
  });

  describe('Retry Logic', () => {
    it('should track retry count for first attempt', async () => {
      const event: SQSEvent = {
        Records: [
          createSQSRecord(
            {
              to: 'user@example.com',
              from: 'noreply@test.com',
              subject: 'Test',
            },
            1 // First attempt
          ),
        ],
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      // Should log retry count (check console.log in actual implementation)
    });

    it('should track retry count for second attempt', async () => {
      const event: SQSEvent = {
        Records: [
          createSQSRecord(
            {
              to: 'user@example.com',
              from: 'noreply@test.com',
              subject: 'Test',
            },
            2 // Second attempt
          ),
        ],
      };

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });

    it('should warn when approaching max retries (attempt 3)', async () => {
      const consoleSpy = vi.spyOn(console, 'error');

      const event: SQSEvent = {
        Records: [
          createSQSRecord(
            {
              to: 'fail@example.com', // This would fail in real implementation
              from: 'noreply@test.com',
              subject: 'Test',
            },
            3 // Third attempt - last retry before DLQ
          ),
        ],
      };

      // Mock SES to fail
      const { SESv2Client } = await import('@aws-sdk/client-sesv2');
      const mockClient = new SESv2Client({});
      vi.mocked(mockClient.send).mockRejectedValueOnce(new Error('SES send failed'));

      await handler(event);

      // Should log warning about max retries
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('MAX RETRIES REACHED'),
        expect.any(Object)
      );
    });
  });

  describe('Partial Batch Failures', () => {
    it('should return batch item failures for failed messages', async () => {
      // Mock SES to fail for specific email
      const { SESv2Client } = await import('@aws-sdk/client-sesv2');
      const mockSend = vi.fn()
        .mockResolvedValueOnce({ MessageId: 'msg-1' }) // First email succeeds
        .mockRejectedValueOnce(new Error('SES error')); // Second email fails

      const mockClient = new SESv2Client({});
      vi.mocked(mockClient.send).mockImplementation(mockSend);

      const event: SQSEvent = {
        Records: [
          createSQSRecord({
            to: 'success@example.com',
            from: 'noreply@test.com',
            subject: 'Should Succeed',
          }, 1, 'msg-success'),
          createSQSRecord({
            to: 'fail@example.com',
            from: 'noreply@test.com',
            subject: 'Should Fail',
          }, 1, 'msg-fail'),
        ],
      };

      const result = await handler(event);

      expect(result.batchItemFailures).toBeDefined();
      expect(result.batchItemFailures).toEqual([
        { itemIdentifier: 'msg-fail' },
      ]);
    });
  });

  describe('Provider Support', () => {
    it('should throw error for unsupported email provider', async () => {
      process.env.EMAIL_PROVIDER = 'unsupported-provider';

      const event: SQSEvent = {
        Records: [
          createSQSRecord({
            to: 'user@example.com',
            from: 'noreply@test.com',
            subject: 'Test',
          }),
        ],
      };

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(1);
    });
  });
});

/**
 * Helper function to create a mock SQS record
 */
function createSQSRecord(
  emailJob: {
    to: string;
    from: string;
    subject?: string;
    html?: string;
    text?: string;
  },
  approxReceiveCount: number = 1,
  messageId: string = 'test-message-id'
): SQSRecord {
  return {
    messageId,
    receiptHandle: 'test-receipt-handle-123456',
    body: JSON.stringify(emailJob),
    attributes: {
      ApproximateReceiveCount: approxReceiveCount.toString(),
      SentTimestamp: Date.now().toString(),
      SenderId: 'test-sender',
      ApproximateFirstReceiveTimestamp: Date.now().toString(),
    },
    messageAttributes: {},
    md5OfBody: 'test-md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test-queue',
    awsRegion: 'us-east-1',
  };
}
