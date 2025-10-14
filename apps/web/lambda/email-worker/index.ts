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

// Initialize Supabase admin client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
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

  console.log('[EMAIL_WORKER] Processing job', {
    messageId,
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

    console.log('[EMAIL_WORKER] Email sent successfully', {
      messageId,
      to: job.to,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    console.error('[EMAIL_WORKER] Email sending failed', {
      messageId,
      to: job.to,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    throw error; // Re-throw to mark SQS message for retry or DLQ
  }
}

/**
 * Send email using configured provider (AWS SES by default)
 */
async function sendEmail(job: EmailJob) {
  const provider = process.env.EMAIL_PROVIDER || 'ses';

  console.log('[EMAIL_WORKER] Sending email via provider:', provider);

  switch (provider) {
    case 'ses':
      await sendViaSES(job);
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
