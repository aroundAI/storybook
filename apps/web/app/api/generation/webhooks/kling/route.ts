import { NextResponse } from 'next/server';

import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { processVideoWebhook } from '@kit/video-generation/lib';
import {
  KLING_WEBHOOK_CONFIG,
  createKlingWebhookVerifier,
  createWebhookConfig,
  processWebhook,
} from '@kit/video-generation/webhooks';
import type { KlingWebhookPayload } from '@kit/video-generation/webhooks';

/**
 * POST /api/generation/webhooks/kling
 *
 * Handles Kling video generation webhook callbacks.
 * Verifies HMAC-SHA256 signature, processes payload, updates database.
 *
 * Returns:
 * - 200: Webhook processed successfully
 * - 401: Missing or invalid signature
 * - 400: Invalid payload or expired webhook
 * - 404: Generation job not found
 * - 500: Internal processing error
 */
export const POST = enhanceRouteHandler(
  async ({ request }) => {
    const logger = await getLogger();
    const ctx = { name: 'kling-webhook' };

    logger.info(ctx, 'Received Kling webhook');

    // Create verifier and config
    const verifier = createKlingWebhookVerifier();
    const config = createWebhookConfig(
      process.env.KLING_WEBHOOK_SECRET!,
      KLING_WEBHOOK_CONFIG.signatureHeader,
      { maxAgeSeconds: KLING_WEBHOOK_CONFIG.maxAgeSeconds },
    );

    // Process webhook with signature verification
    const result = await processWebhook<KlingWebhookPayload>(
      request,
      verifier,
      config,
      async (payload) => {
        // Use admin client since webhooks don't have user context
        const client = getSupabaseServerAdminClient();

        // Process the webhook and update database
        const processResult = await processVideoWebhook(
          client,
          {
            provider: 'kling',
            providerJobId: payload.task_id,
          },
          payload,
        );

        // Only throw if there's an error and it's not idempotent
        if (processResult.error && !processResult.isIdempotent) {
          throw new Error(processResult.error);
        }

        logger.info({ ...ctx, ...processResult }, 'Kling webhook processed');
      },
    );

    return NextResponse.json(
      { success: result.success, error: result.error },
      { status: result.statusCode },
    );
  },
  {
    auth: false, // Webhooks don't use session auth
  },
);
