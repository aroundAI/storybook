/**
 * AWS Lambda Worker for Email Queue Processing
 *
 * This function processes email jobs from SQS queue
 * Triggered automatically when messages are added to the queue
 */
import type { SQSEvent, SQSRecord } from 'aws-lambda';

interface EmailJob {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

/**
 * Lambda handler for processing email queue
 */
export async function handler(event: SQSEvent) {
  console.log('Processing email batch:', {
    messageCount: event.Records.length,
  });

  const results = await Promise.allSettled(
    event.Records.map((record) => processEmailRecord(record)),
  );

  // Check for failures
  const failures = results.filter((r) => r.status === 'rejected');

  if (failures.length > 0) {
    console.error('Some emails failed to send:', {
      total: results.length,
      failures: failures.length,
    });

    // Return partial batch failure for retry
    return {
      batchItemFailures: failures.map((_, index) => ({
        itemIdentifier: event.Records[index]?.messageId,
      })),
    };
  }

  console.log('All emails processed successfully');
  return { success: true };
}

/**
 * Process individual email record from SQS
 */
async function processEmailRecord(record: SQSRecord) {
  try {
    const job: EmailJob = JSON.parse(record.body);

    console.log('Sending email:', {
      to: job.to,
      subject: job.subject,
      messageId: record.messageId,
    });

    await sendEmail(job);

    console.log('Email sent successfully:', {
      messageId: record.messageId,
    });
  } catch (error) {
    console.error('Failed to process email:', {
      messageId: record.messageId,
      error,
    });

    throw error; // Trigger retry
  }
}

/**
 * Send email using configured provider
 */
async function sendEmail(job: EmailJob) {
  const provider = process.env.EMAIL_PROVIDER ?? 'resend';

  switch (provider) {
    case 'ses':
      return sendEmailViaSES(job);

    case 'sendgrid':
      return sendEmailViaSendGrid(job);

    case 'resend':
      return sendEmailViaResend(job);

    default:
      throw new Error(`Unsupported email provider: ${provider}`);
  }
}

/**
 * Send email via AWS SES
 */
async function sendEmailViaSES(job: EmailJob) {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');

  const client = new SESClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  const command = new SendEmailCommand({
    Source: job.from ?? process.env.EMAIL_SENDER,
    Destination: {
      ToAddresses: Array.isArray(job.to) ? job.to : [job.to],
    },
    Message: {
      Subject: {
        Data: job.subject,
      },
      Body: {
        Html: {
          Data: job.html,
        },
        ...(job.text && {
          Text: {
            Data: job.text,
          },
        }),
      },
    },
  });

  await client.send(command);
}

/**
 * Send email via SendGrid
 */
async function sendEmailViaSendGrid(job: EmailJob) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: (Array.isArray(job.to) ? job.to : [job.to]).map((email) => ({
            email,
          })),
        },
      ],
      from: {
        email: job.from ?? process.env.EMAIL_SENDER,
      },
      subject: job.subject,
      content: [
        {
          type: 'text/html',
          value: job.html,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`SendGrid API error: ${response.statusText}`);
  }
}

/**
 * Send email via Resend
 */
async function sendEmailViaResend(job: EmailJob) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: job.from ?? process.env.EMAIL_SENDER,
      to: job.to,
      subject: job.subject,
      html: job.html,
      ...(job.text && { text: job.text }),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }
}
