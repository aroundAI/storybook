/**
 * Email Worker Lambda
 *
 * Processes email sending jobs from SQS queue
 * Features:
 * - Sends emails via AWS SES or configured provider
 * - Comprehensive CloudWatch logging for debugging
 * - Error handling with detailed error messages
 * - Supports batch processing with partial failure handling
 */
import { createClient } from '@supabase/supabase-js';

import type { SQSEvent, SQSRecord } from 'aws-lambda';

// Email job data structure
interface EmailJob {
  to: string;
  from: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  metadata?: Record<string, string>;
}

// Initialize Supabase admin client (reserved for future email logging/tracking)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const _supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Main Lambda handler
 * Processes batch of SQS messages containing email jobs
 */
export async function handler(event: SQSEvent) {
  console.log('[EMAIL_WORKER] Lambda invoked', {
    recordCount: event.Records.length,
    timestamp: new Date().toISOString(),
  });

  const results = {
    successful: 0,
    failed: 0,
    total: event.Records.length,
  };

  // Process each SQS message
  const failedMessageIds: string[] = [];

  for (const record of event.Records) {
    try {
      await processEmailJob(record);
      results.successful++;
    } catch (error) {
      console.error('[EMAIL_WORKER] Job processing failed', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      results.failed++;
      failedMessageIds.push(record.messageId);
    }
  }

  console.log('[EMAIL_WORKER] Batch processing complete', results);

  // Return partial batch failure response to retry only failed messages
  if (failedMessageIds.length > 0) {
    return {
      batchItemFailures: failedMessageIds.map((id) => ({
        itemIdentifier: id,
      })),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(results),
  };
}

/**
 * Process single email job from SQS message
 */
async function processEmailJob(record: SQSRecord) {
  const messageId = record.messageId;
  const retryCount = parseInt(record.attributes.ApproximateReceiveCount || '1');

  console.log('[EMAIL_WORKER] Processing job', {
    messageId,
    retryCount,
    receiptHandle: record.receiptHandle.substring(0, 20) + '...',
  });

  // Parse job data
  let job: EmailJob;
  try {
    job = JSON.parse(record.body);
    console.log('[EMAIL_WORKER] Job parsed', {
      messageId,
      to: job.to,
      from: job.from,
      subject: job.subject,
    });
  } catch (error) {
    console.error('[EMAIL_WORKER] Failed to parse job data', {
      messageId,
      body: record.body.substring(0, 200),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error('Invalid job data format');
  }

  // Validate job data
  if (!job.to || !job.from || !job.subject) {
    console.error('[EMAIL_WORKER] Missing required job fields', {
      messageId,
      hasTo: !!job.to,
      hasFrom: !!job.from,
      hasSubject: !!job.subject,
    });
    throw new Error('Missing required job fields');
  }

  try {
    // Send email
    console.log('[EMAIL_WORKER] Sending email', {
      messageId,
      to: job.to,
      from: job.from,
      subject: job.subject,
    });

    await sendEmail(job);

    console.log('[EMAIL_WORKER] ✅ Email sent successfully', {
      messageId,
      retryCount,
      to: job.to,
      wasRetried: retryCount > 1,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // Check if this is approaching max retries
    const maxRetries = 3; // Should match DLQ maxReceiveCount in sst.config.ts
    const isLastRetry = retryCount >= maxRetries;

    if (isLastRetry) {
      console.error('[EMAIL_WORKER] ⚠️  MAX RETRIES REACHED - Message will move to DLQ', {
        messageId,
        retryCount,
        maxRetries,
        to: job.to,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
    } else {
      console.error('[EMAIL_WORKER] Email sending failed - will retry', {
        messageId,
        retryCount,
        remainingRetries: maxRetries - retryCount,
        to: job.to,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    throw error; // Re-throw to mark SQS message for retry or DLQ
  }
}

/**
 * Send email using configured provider (AWS SES or Resend)
 */
async function sendEmail(job: EmailJob) {
  const provider = process.env.EMAIL_PROVIDER || 'ses';

  console.log('[EMAIL_WORKER] Sending email via provider:', provider);

  switch (provider) {
    case 'ses':
      await sendViaSES(job);
      break;
    case 'resend':
      await sendViaResend(job);
      break;
    default:
      throw new Error(`Unsupported email provider: ${provider}`);
  }
}

/**
 * Send email using AWS SES
 */
async function sendViaSES(job: EmailJob) {
  console.log('[EMAIL_WORKER] Initializing AWS SES client');

  // Import AWS SES client
  const { SESv2Client, SendEmailCommand } = await import(
    '@aws-sdk/client-sesv2'
  );

  const client = new SESv2Client({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  console.log('[EMAIL_WORKER] Sending email via AWS SES', {
    region: process.env.AWS_REGION || 'us-east-1',
  });

  const command = new SendEmailCommand({
    FromEmailAddress: job.from,
    Destination: {
      ToAddresses: [job.to],
      ...(job.cc && { CcAddresses: job.cc }),
      ...(job.bcc && { BccAddresses: job.bcc }),
    },
    Content: {
      Simple: {
        Subject: {
          Data: job.subject,
          Charset: 'UTF-8',
        },
        Body: {
          ...(job.html && {
            Html: {
              Data: job.html,
              Charset: 'UTF-8',
            },
          }),
          ...(job.text && {
            Text: {
              Data: job.text,
              Charset: 'UTF-8',
            },
          }),
        },
      },
    },
    ...(job.replyTo && { ReplyToAddresses: [job.replyTo] }),
    ...(process.env.AWS_SES_CONFIG_SET && {
      ConfigurationSetName: process.env.AWS_SES_CONFIG_SET,
    }),
  });

  try {
    const result = await client.send(command);
    console.log('[EMAIL_WORKER] Email sent successfully via AWS SES', {
      messageId: result.MessageId,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('[EMAIL_WORKER] AWS SES send failed', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw new Error(`Failed to send email via AWS SES: ${errorMessage}`);
  }
}

/**
 * Send email using Resend API
 */
async function sendViaResend(job: EmailJob) {
  console.log('[EMAIL_WORKER] Sending email via Resend API');

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY environment variable is required for Resend provider');
  }

  const contentObject =
    'text' in job && job.text
      ? { text: job.text }
      : { html: job.html || '' };

  const payload: Record<string, unknown> = {
    from: job.from,
    to: [job.to],
    subject: job.subject,
    ...contentObject,
  };

  // Add optional fields
  if (job.replyTo) {
    payload.reply_to = job.replyTo;
  }
  if (job.cc && job.cc.length > 0) {
    payload.cc = job.cc;
  }
  if (job.bcc && job.bcc.length > 0) {
    payload.bcc = job.bcc;
  }
  if (job.metadata) {
    payload.tags = Object.entries(job.metadata).map(([name, value]) => ({
      name,
      value,
    }));
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    // Handle rate limiting (429 Too Many Requests)
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || '60';
      const retryAfterSeconds = parseInt(retryAfter, 10);

      console.warn('[EMAIL_WORKER] ⚠️  Rate limited by Resend', {
        retryAfter: `${retryAfterSeconds}s`,
        to: job.to,
        subject: job.subject,
      });

      // Re-throw to trigger SQS retry with exponential backoff
      // SQS will automatically retry with delays: ~20s, ~40s, ~80s
      throw new Error(
        `Rate limited by Resend - retry after ${retryAfterSeconds}s`,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Resend API error: ${response.status} ${response.statusText} - ${errorBody}`,
      );
    }

    const result = await response.json();

    console.log('[EMAIL_WORKER] Email sent successfully via Resend', {
      messageId: result.id,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // Enhanced logging for rate limits
    const isRateLimit = errorMessage.includes('Rate limited');

    console.error('[EMAIL_WORKER] Resend send failed', {
      error: errorMessage,
      isRateLimit,
      to: job.to,
      stack: error instanceof Error ? error.stack : undefined,
    });

    throw new Error(`Failed to send email via Resend: ${errorMessage}`);
  }
}
