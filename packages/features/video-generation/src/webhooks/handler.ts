import type { NextRequest } from 'next/server';

import { getLogger } from '@kit/shared/logger';

import type {
  ProcessedWebhook,
  WebhookConfig,
  WebhookLogEntry,
  WebhookVerifier,
} from './types';

/**
 * Processes an incoming webhook request with signature verification and logging.
 *
 * This function:
 * 1. Extracts and validates the signature from headers
 * 2. Verifies the signature using constant-time comparison
 * 3. Parses the JSON payload
 * 4. Checks for replay attacks using timestamp
 * 5. Invokes the handler with the verified payload
 *
 * @param request The incoming Next.js request
 * @param verifier The provider-specific webhook verifier
 * @param config Webhook configuration (secret, headers, etc.)
 * @param handler Async function to process the verified payload
 * @returns Processed webhook result with status code
 */
export async function processWebhook<T>(
  request: NextRequest,
  verifier: WebhookVerifier,
  config: WebhookConfig,
  handler: (payload: T) => Promise<void>,
): Promise<ProcessedWebhook<T>> {
  const startTime = Date.now();

  // 1. Extract signature from headers
  const signature = request.headers.get(config.signatureHeader);
  if (!signature) {
    await logWebhookAttempt(request, 'MISSING_SIGNATURE', startTime);
    return {
      success: false,
      error: 'Missing signature header',
      statusCode: 401,
    };
  }

  // 2. Get raw payload (must be read before verification)
  const payload = await request.text();

  // 3. Verify signature
  let isValid: boolean;
  try {
    isValid = verifier.verify(payload, signature);
  } catch (error) {
    await logWebhookAttempt(request, 'VERIFICATION_ERROR', startTime, error);
    return {
      success: false,
      error: 'Signature verification failed',
      statusCode: 401,
    };
  }

  if (!isValid) {
    await logWebhookAttempt(request, 'INVALID_SIGNATURE', startTime);
    return {
      success: false,
      error: 'Invalid signature',
      statusCode: 401,
    };
  }

  // 4. Parse payload
  let data: T;
  try {
    data = JSON.parse(payload) as T;
  } catch {
    await logWebhookAttempt(request, 'INVALID_JSON', startTime);
    return {
      success: false,
      error: 'Invalid JSON payload',
      statusCode: 400,
    };
  }

  // 5. Check for replay (if timestamp available)
  if (verifier.extractTimestamp) {
    const timestamp = verifier.extractTimestamp(data);
    if (timestamp) {
      const age = Math.floor(Date.now() / 1000) - timestamp;
      if (age > config.maxAgeSeconds) {
        await logWebhookAttempt(request, 'EXPIRED', startTime, {
          age,
          maxAge: config.maxAgeSeconds,
        });
        return {
          success: false,
          error: `Webhook expired (${age}s old, max ${config.maxAgeSeconds}s)`,
          statusCode: 400,
        };
      }

      // Reject webhooks from the future (clock skew protection)
      if (age < -60) {
        await logWebhookAttempt(request, 'FUTURE_TIMESTAMP', startTime, {
          age,
        });
        return {
          success: false,
          error: 'Webhook timestamp is in the future',
          statusCode: 400,
        };
      }
    }
  }

  // 6. Process webhook
  try {
    await handler(data);
    await logWebhookAttempt(request, 'SUCCESS', startTime);
    return {
      success: true,
      data,
      statusCode: 200,
    };
  } catch (error) {
    await logWebhookAttempt(request, 'HANDLER_ERROR', startTime, error);
    return {
      success: false,
      error: 'Internal processing error',
      statusCode: 500,
    };
  }
}

/**
 * Logs webhook attempts for debugging and security monitoring.
 * Successful webhooks log to info, failures log to error.
 */
async function logWebhookAttempt(
  request: NextRequest,
  result: string,
  startTime: number,
  error?: unknown,
): Promise<void> {
  const logger = await getLogger();
  const duration = Date.now() - startTime;
  const logEntry: WebhookLogEntry = {
    timestamp: new Date().toISOString(),
    path: request.nextUrl.pathname,
    method: request.method,
    result,
    durationMs: duration,
    ip:
      request.headers.get('x-forwarded-for') ??
      request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
    error: error instanceof Error ? error.message : String(error ?? ''),
  };

  // Remove empty error field
  if (!logEntry.error) {
    delete logEntry.error;
  }

  const ctx = { name: 'webhook.handler', ...logEntry };

  if (result === 'SUCCESS') {
    logger.info(ctx, 'Webhook processed successfully');
  } else {
    logger.error(ctx, 'Webhook processing failed');
  }
}

/**
 * Creates a webhook config with sensible defaults.
 *
 * @param secret The webhook secret
 * @param signatureHeader The header containing the signature
 * @param options Additional options
 */
export function createWebhookConfig(
  secret: string,
  signatureHeader: string,
  options: Partial<Omit<WebhookConfig, 'secret' | 'signatureHeader'>> = {},
): WebhookConfig {
  return {
    secret,
    signatureHeader,
    maxAgeSeconds: options.maxAgeSeconds ?? 300, // 5 minutes default
    timestampHeader: options.timestampHeader,
  };
}
