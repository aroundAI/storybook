# FILM-407: Video Provider Webhooks

**Phase**: 4
**Priority**: P0
**Effort**: M (3-4 days)
**Dependencies**: FILM-405 (generate-video-action), FILM-402 (provider-factory)
**Blocks**: None

---

## Context

Video generation providers send webhook callbacks when video generation completes. This spec covers webhook handlers for all supported video providers (Kling, Runway, Hailuo), using a unified architecture with provider-specific adapters.

**Provider Webhook Support:**

| Provider | Webhook Support | Callback Parameter | Signature Verification |
|----------|----------------|-------------------|------------------------|
| **Kling** | Yes (native) | `callback_url` | HMAC-SHA256 |
| **Runway** | Polling only* | N/A | N/A |
| **Hailuo** | Yes (via PiAPI) | `callback_url` | HMAC-SHA256 |

*Note: Runway's official API requires polling via `GET /v1/tasks/{id}`. Third-party wrappers (KIE API) may provide webhook support.

---

## Requirements

### Functional Requirements

1. **Signature Verification**
   - Verify HMAC-SHA256 signature
   - Use constant-time comparison
   - Reject invalid signatures
   - Log verification failures

2. **Status Processing**
   - Parse provider-specific callback payloads (Kling, Hailuo)
   - Map provider status to internal status
   - Extract video URL and metadata
   - Handle error states
   - Route to correct handler based on provider

3. **Runway Polling Fallback**
   - Since Runway doesn't support webhooks, use polling
   - Poll via background job every 30 seconds
   - Integrate with job queue (FILM-404)

4. **Database Updates**
   - Update generation_jobs record
   - Update shots table with video_url
   - Record actual cost
   - Set completion timestamp

5. **Client Notifications**
   - Trigger Supabase Realtime event
   - Send push notification if enabled
   - Update job queue status

### Non-Functional Requirements

- Process webhooks within 1 second
- Idempotent (handle duplicate webhooks)
- Log all webhook requests
- Return 200 OK for valid webhooks
- Return 400/401 for invalid webhooks

---

## Interface

### API Route

```typescript
// POST /api/generation/webhooks/kling

export async function POST(request: Request) {
  // Implementation
}
```

### Kling Webhook Payload

```typescript
interface KlingWebhookPayload {
  task_id: string;
  task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
  task_status_msg: string;
  updated_at: number;
  progress: number;
  task_result?: {
    videos: Array<{
      id: string;
      url: string;
      duration: number;
    }>;
  };
  error?: {
    code: string;
    message: string;
  };
}
```

### Hailuo (MiniMax) Webhook Payload

```typescript
interface HailuoWebhookPayload {
  task_id: string;
  status: 'Queueing' | 'Processing' | 'Success' | 'Fail';
  progress?: number;
  video_url?: string;
  cover_url?: string;  // Thumbnail
  duration?: number;
  error?: {
    code: number;
    message: string;
  };
  created_at: number;
  finished_at?: number;
}
```

### Runway Status Response (Polling)

```typescript
// Runway requires polling GET /v1/tasks/{id}
interface RunwayStatusResponse {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress?: number;
  output?: {
    url: string;
    duration: number;
  }[];
  failure?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Implementation

```typescript
import { NextResponse } from 'next/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { recordJobCost } from '@kit/video-generation/lib/cost-tracking';
import { verifyWebhookSignature } from '@kit/video-generation/lib/webhook-security';
import { logger } from '@kit/monitoring';

export const POST = enhanceRouteHandler(
  async ({ request }) => {
    // Get raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('x-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 401 }
      );
    }

    // Verify webhook signature
    const secret = process.env.KLING_WEBHOOK_SECRET || '';
    const isValid = verifyWebhookSignature(body, signature, secret);

    if (!isValid) {
      logger.warn('Invalid webhook signature', { signature });
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Parse payload
    const payload: KlingWebhookPayload = JSON.parse(body);
    const providerJobId = payload.task_id;

    logger.info('Kling webhook received', {
      providerJobId,
      status: payload.task_status,
    });

    const client = getSupabaseServerClient();

    // Find generation job by provider_job_id
    const { data: job, error: jobError } = await client
      .from('generation_jobs')
      .select('*, shots(id, episodes(project_id))')
      .eq('provider_job_id', providerJobId)
      .single();

    if (jobError || !job) {
      logger.error('Generation job not found', { providerJobId });
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Map status
    const statusMap = {
      submitted: 'queued',
      processing: 'processing',
      succeed: 'completed',
      failed: 'failed',
    };

    const newStatus = statusMap[payload.task_status] || 'failed';

    // Prepare updates
    const jobUpdates: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (newStatus === 'completed' && payload.task_result?.videos[0]) {
      const video = payload.task_result.videos[0];
      jobUpdates.output_data = {
        videoUrl: video.url,
        duration: video.duration,
      };
      jobUpdates.completed_at = new Date().toISOString();

      // Calculate actual cost (same as estimated for now)
      const actualCost = job.estimated_cost_cents;
      jobUpdates.cost_cents = actualCost;

      // Record cost
      await recordJobCost(job.account_id, actualCost, job.id);

      // Update shot with video URL
      await client
        .from('shots')
        .update({
          video_url: video.url,
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.reference_id);
    } else if (newStatus === 'failed') {
      jobUpdates.error_message = payload.error?.message || payload.task_status_msg;
      jobUpdates.error_code = payload.error?.code || 'PROVIDER_ERROR';
      jobUpdates.completed_at = new Date().toISOString();

      // Update shot status to failed
      await client
        .from('shots')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.reference_id);
    }

    // Update generation job
    await client
      .from('generation_jobs')
      .update(jobUpdates)
      .eq('id', job.id);

    logger.info('Generation job updated', {
      jobId: job.id,
      status: newStatus,
    });

    return NextResponse.json({ success: true });
  },
  {
    auth: false, // Webhooks don't use session auth
  }
);
```

---

## Implementation Details

### File Structure

```
apps/web/app/api/generation/webhooks/
├── kling/
│   └── route.ts                      # Kling webhook handler (CREATE)
├── hailuo/
│   └── route.ts                      # Hailuo webhook handler (CREATE)
└── __tests__/
    ├── kling-webhook.test.ts         # Kling tests (CREATE)
    └── hailuo-webhook.test.ts        # Hailuo tests (CREATE)

packages/features/video-generation/src/
├── lib/
│   ├── webhook-security.ts           # Signature verification (CREATE)
│   ├── webhook-processor.ts          # Unified status processing (CREATE)
│   └── runway-poller.ts              # Runway polling logic (CREATE)
└── webhooks/
    ├── types.ts                       # Webhook payload types (CREATE)
    └── index.ts                       # Exports (CREATE)
```

### Signature Verification

```typescript
import crypto from 'crypto';

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Use constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

### Idempotency

Handle duplicate webhooks by checking current job status:

```typescript
if (job.status === 'completed' || job.status === 'failed') {
  // Already processed, return success
  return NextResponse.json({ success: true });
}
```

---

## File Changes

### New Files

| File | Description |
|------|-------------|
| `apps/web/app/api/generation/webhooks/kling/route.ts` | Kling webhook handler |
| `apps/web/app/api/generation/webhooks/hailuo/route.ts` | Hailuo webhook handler |
| `packages/features/video-generation/src/lib/webhook-security.ts` | Signature verification |
| `packages/features/video-generation/src/lib/webhook-processor.ts` | Unified status processor |
| `packages/features/video-generation/src/lib/runway-poller.ts` | Runway polling fallback |
| `packages/features/video-generation/src/webhooks/types.ts` | TypeScript types |
| `apps/web/app/api/generation/webhooks/__tests__/kling-webhook.test.ts` | Kling tests |
| `apps/web/app/api/generation/webhooks/__tests__/hailuo-webhook.test.ts` | Hailuo tests |

---

## Acceptance Criteria

### Kling Webhook
- [x] Verifies HMAC-SHA256 signature
- [x] Rejects invalid signatures with 401
- [x] Updates generation_jobs with correct status mapping
- [x] Updates shots with video URL on success
- [x] Records actual cost via cost-tracking
- [x] Handles duplicate calls idempotently
- [x] Logs all webhook requests

### Hailuo Webhook
- [x] Verifies HMAC-SHA256 signature (PiAPI format)
- [x] Maps Hailuo status (Queueing/Processing/Success/Fail) to internal status
- [x] Extracts video_url and cover_url
- [x] Handles Hailuo-specific error codes

### Runway Polling (No Webhook)
- [x] Polling job runs every 30 seconds for active Runway jobs
- [x] Correctly maps Runway status (PENDING/RUNNING/SUCCEEDED/FAILED)
- [x] Updates job on completion without webhook
- [ ] Integrates with job queue (FILM-404) - *Poller created; scheduled job invocation is infrastructure concern*

### Common
- [x] All handlers return 200 for valid requests
- [x] All handlers return 400/401 for invalid requests
- [x] TypeScript types exported for all payloads

---

## Test Plan

### Unit Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

describe('Kling Webhook', () => {
  it('should reject requests without signature', async () => {
    const request = new Request('http://localhost/api/webhooks/kling', {
      method: 'POST',
      body: JSON.stringify({ task_id: '123' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('should reject invalid signatures', async () => {
    const request = new Request('http://localhost/api/webhooks/kling', {
      method: 'POST',
      headers: { 'x-signature': 'invalid' },
      body: JSON.stringify({ task_id: '123' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('should process successful completion', async () => {
    const payload = {
      task_id: 'provider-job-123',
      task_status: 'succeed',
      task_status_msg: 'Completed',
      updated_at: Date.now() / 1000,
      progress: 100,
      task_result: {
        videos: [{
          id: 'video-123',
          url: 'https://cdn.example.com/video.mp4',
          duration: 5,
        }],
      },
    };

    const body = JSON.stringify(payload);
    const signature = generateSignature(body, process.env.KLING_WEBHOOK_SECRET!);

    const request = new Request('http://localhost/api/webhooks/kling', {
      method: 'POST',
      headers: { 'x-signature': signature },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});
```

---

## Security Considerations

### Webhook Security Checklist

- [x] Verify HMAC signature
- [x] Use constant-time comparison
- [x] Log verification failures
- [x] Rate limit webhook endpoint
- [x] Validate payload structure
- [x] Check job ownership

### Secret Management

Store webhook secrets in environment variables:

```env
# Kling (via PiAPI)
KLING_WEBHOOK_SECRET=your-kling-secret-key

# Hailuo (via PiAPI)
HAILUO_WEBHOOK_SECRET=your-hailuo-secret-key

# Runway - No webhook secret needed (polling only)
# RUNWAY_WEBHOOK_SECRET=not-applicable
```

Rotate secrets periodically via provider dashboard.

---

## Error Handling

| Error | Status | Response |
|-------|--------|----------|
| Missing signature | 401 | `{ error: 'Missing signature' }` |
| Invalid signature | 401 | `{ error: 'Invalid signature' }` |
| Job not found | 404 | `{ error: 'Job not found' }` |
| Database error | 500 | `{ error: 'Internal error' }` |

---

## Performance Considerations

- Process webhooks asynchronously if heavy operations needed
- Use database indexes on provider_job_id
- Cache webhook secrets in memory
- Implement request timeout (5 seconds)

---

## Future Enhancements

1. **Retry Failed Webhooks** - Automatically retry processing
2. **Webhook Logs** - Store all webhook payloads for debugging
3. **Multi-Provider Support** - Unified webhook interface
4. **Webhook Testing** - UI to test webhook handlers

---

## References

- **FILM-401**: Kling provider
- **FILM-401b**: Runway provider
- **FILM-401c**: Hailuo provider
- **FILM-402**: Provider factory
- **FILM-404**: Job queue (for Runway polling)
- **FILM-405**: Generate video action
- **FILM-412**: Cost tracking
- **Constitution**: Section 4.3 (Webhook Security)
- **Kling Webhook Docs**: https://docs.piapi.ai/kling/webhooks
- **Hailuo (MiniMax) API**: https://platform.minimaxi.com/document/Video%20Generation
- **Runway API Docs**: https://docs.runwayml.com (polling via GET /v1/tasks/{id})
