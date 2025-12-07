# FILM-CC-02: Webhook Security

## Metadata
- **Phase:** Cross-Cutting Concern
- **Priority:** P0 (Critical)
- **Effort:** M (4-8 hours)
- **Dependencies:** None
- **Blocks:** FILM-407 (Kling Webhook), all provider webhooks
- **Status:** ✅ Complete
- **Implemented:** 2025-12-05
- **PR:** [#6](https://github.com/aroundAI/storybook/pull/6)

---

## Context

External providers (Kling, ElevenLabs, Suno) send webhooks to notify us when generation jobs complete. Without proper signature verification, attackers could forge webhook payloads to:
- Mark jobs as complete with malicious URLs
- Trigger incorrect cost calculations
- Bypass rate limits by faking completions

---

## Specification

### Requirements

1. **Signature Verification**: Verify HMAC signature before processing
2. **Constant-Time Comparison**: Prevent timing attacks
3. **Replay Protection**: Reject old/duplicate webhooks
4. **Request Logging**: Log all webhook attempts for debugging
5. **Provider-Specific Handlers**: Support different signature schemes

### Webhook Verifier Interface

```typescript
// packages/features/video-generation/src/webhooks/types.ts

export interface WebhookVerifier {
  /**
   * Verifies the webhook signature
   * @param payload Raw request body as string
   * @param signature Signature from request header
   * @returns true if signature is valid
   */
  verify(payload: string, signature: string): boolean;

  /**
   * Extracts timestamp from webhook for replay protection
   * @param payload Parsed webhook body
   * @returns Unix timestamp or null if not supported
   */
  extractTimestamp?(payload: unknown): number | null;
}

export interface WebhookConfig {
  secret: string;
  signatureHeader: string;
  timestampHeader?: string;
  maxAgeSeconds: number; // Reject webhooks older than this
}

export interface WebhookResult {
  verified: boolean;
  error?: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'EXPIRED' | 'REPLAY';
  payload?: unknown;
}
```

### Provider Implementations

```typescript
// packages/features/video-generation/src/webhooks/verifiers/kling.ts

import crypto from 'crypto';
import { WebhookVerifier, WebhookConfig } from '../types';

export class KlingWebhookVerifier implements WebhookVerifier {
  constructor(private config: WebhookConfig) {}

  verify(payload: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', this.config.secret)
      .update(payload)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  extractTimestamp(payload: { timestamp?: number }): number | null {
    return payload.timestamp ?? null;
  }
}
```

```typescript
// packages/features/audio-generation/src/webhooks/verifiers/elevenlabs.ts

import crypto from 'crypto';
import { WebhookVerifier, WebhookConfig } from '../types';

export class ElevenLabsWebhookVerifier implements WebhookVerifier {
  constructor(private config: WebhookConfig) {}

  verify(payload: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', this.config.secret)
      .update(payload)
      .digest('hex');

    // ElevenLabs uses 'sha256=' prefix
    const normalizedSignature = signature.replace(/^sha256=/, '');

    return crypto.timingSafeEqual(
      Buffer.from(normalizedSignature),
      Buffer.from(expectedSignature)
    );
  }
}
```

### Webhook Handler Utility

```typescript
// packages/features/video-generation/src/webhooks/handler.ts

import { NextRequest, NextResponse } from 'next/server';
import { WebhookVerifier, WebhookConfig, WebhookResult } from './types';

interface ProcessedWebhook<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

export async function processWebhook<T>(
  request: NextRequest,
  verifier: WebhookVerifier,
  config: WebhookConfig,
  handler: (payload: T) => Promise<void>
): Promise<ProcessedWebhook<T>> {
  const startTime = Date.now();

  // 1. Extract signature from headers
  const signature = request.headers.get(config.signatureHeader);
  if (!signature) {
    logWebhookAttempt(request, 'MISSING_SIGNATURE', startTime);
    return {
      success: false,
      error: 'Missing signature header',
      statusCode: 401,
    };
  }

  // 2. Get raw payload
  const payload = await request.text();

  // 3. Verify signature
  let isValid: boolean;
  try {
    isValid = verifier.verify(payload, signature);
  } catch (error) {
    logWebhookAttempt(request, 'VERIFICATION_ERROR', startTime, error);
    return {
      success: false,
      error: 'Signature verification failed',
      statusCode: 401,
    };
  }

  if (!isValid) {
    logWebhookAttempt(request, 'INVALID_SIGNATURE', startTime);
    return {
      success: false,
      error: 'Invalid signature',
      statusCode: 401,
    };
  }

  // 4. Parse payload
  let data: T;
  try {
    data = JSON.parse(payload);
  } catch (error) {
    logWebhookAttempt(request, 'INVALID_JSON', startTime);
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
        logWebhookAttempt(request, 'EXPIRED', startTime, { age, maxAge: config.maxAgeSeconds });
        return {
          success: false,
          error: `Webhook expired (${age}s old, max ${config.maxAgeSeconds}s)`,
          statusCode: 400,
        };
      }
    }
  }

  // 6. Process webhook
  try {
    await handler(data);
    logWebhookAttempt(request, 'SUCCESS', startTime);
    return {
      success: true,
      data,
      statusCode: 200,
    };
  } catch (error) {
    logWebhookAttempt(request, 'HANDLER_ERROR', startTime, error);
    return {
      success: false,
      error: 'Internal processing error',
      statusCode: 500,
    };
  }
}

function logWebhookAttempt(
  request: NextRequest,
  result: string,
  startTime: number,
  error?: unknown
) {
  const duration = Date.now() - startTime;
  const logEntry = {
    timestamp: new Date().toISOString(),
    path: request.nextUrl.pathname,
    method: request.method,
    result,
    durationMs: duration,
    ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
    error: error instanceof Error ? error.message : error,
  };

  if (result === 'SUCCESS') {
    console.log('[Webhook]', JSON.stringify(logEntry));
  } else {
    console.error('[Webhook]', JSON.stringify(logEntry));
  }
}
```

### Example Route Implementation

```typescript
// apps/web/app/api/generation/webhooks/kling/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { KlingWebhookVerifier } from '@kit/video-generation/webhooks';
import { processWebhook } from '@kit/video-generation/webhooks/handler';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

interface KlingWebhookPayload {
  task_id: string;
  status: 'completed' | 'failed';
  video_url?: string;
  thumbnail_url?: string;
  error_message?: string;
  timestamp: number;
}

const config = {
  secret: process.env.KLING_WEBHOOK_SECRET!,
  signatureHeader: 'x-kling-signature',
  maxAgeSeconds: 300, // 5 minutes
};

export async function POST(request: NextRequest) {
  const verifier = new KlingWebhookVerifier(config);

  const result = await processWebhook<KlingWebhookPayload>(
    request,
    verifier,
    config,
    async (payload) => {
      const client = getSupabaseServerClient();

      // Find and update job
      const { data: job } = await client
        .from('generation_jobs')
        .select('id, reference_id')
        .eq('provider_job_id', payload.task_id)
        .eq('provider', 'kling')
        .single();

      if (!job) {
        throw new Error(`Job not found: ${payload.task_id}`);
      }

      if (payload.status === 'completed') {
        await client
          .from('generation_jobs')
          .update({
            status: 'completed',
            output_data: {
              videoUrl: payload.video_url,
              thumbnailUrl: payload.thumbnail_url,
            },
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        await client
          .from('shots')
          .update({
            status: 'completed',
            video_url: payload.video_url,
            thumbnail_url: payload.thumbnail_url,
          })
          .eq('id', job.reference_id);
      } else {
        await client
          .from('generation_jobs')
          .update({
            status: 'failed',
            error_message: payload.error_message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        await client
          .from('shots')
          .update({ status: 'failed' })
          .eq('id', job.reference_id);
      }
    }
  );

  return NextResponse.json(
    { success: result.success, error: result.error },
    { status: result.statusCode }
  );
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/video-generation/src/webhooks/types.ts` |
| CREATE | `packages/features/video-generation/src/webhooks/handler.ts` |
| CREATE | `packages/features/video-generation/src/webhooks/verifiers/kling.ts` |
| CREATE | `packages/features/audio-generation/src/webhooks/verifiers/elevenlabs.ts` |

---

## Acceptance Criteria

- [x] Valid signatures are accepted
- [x] Invalid signatures return 401
- [x] Missing signatures return 401
- [x] Expired webhooks (>5 minutes old) are rejected
- [x] All webhook attempts are logged with timing
- [x] Constant-time comparison is used (no timing attacks)
- [x] Failed webhooks don't modify database state
- [x] Handler errors return 500 (not 200)

---

## Test Plan

### Unit Tests
- [x] Test valid signature verification
- [x] Test invalid signature rejection
- [x] Test signature with wrong secret
- [x] Test timestamp extraction
- [x] Test expired webhook detection
- [x] Test constant-time comparison (mock crypto)

### Integration Tests
- [ ] Test full webhook flow with mocked database
- [ ] Test concurrent webhook handling
- [ ] Test idempotency (same webhook twice)

---

## Security Considerations

- **Timing Attacks**: Use `crypto.timingSafeEqual` for all comparisons
- **Secret Management**: Secrets from environment variables only
- **Replay Attacks**: Reject webhooks older than 5 minutes
- **Logging**: Never log secrets or full payloads in production
- **Error Messages**: Generic errors to clients, detailed in logs

---

## Error Handling

| Scenario | Status | Response |
|----------|--------|----------|
| Missing signature | 401 | `{"error": "Missing signature header"}` |
| Invalid signature | 401 | `{"error": "Invalid signature"}` |
| Expired webhook | 400 | `{"error": "Webhook expired"}` |
| Invalid JSON | 400 | `{"error": "Invalid JSON payload"}` |
| Handler error | 500 | `{"error": "Internal processing error"}` |

---

## Open Questions

- [x] Should we implement idempotency keys for webhooks? **Yes, via task_id lookup**
- [ ] Should we queue webhook processing for reliability? (post-MVP, non-blocking)
