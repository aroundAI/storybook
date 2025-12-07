# Kling API Reference via PiAPI

> **SPIKE-01 Deliverable**: Complete API documentation for Kling video generation through PiAPI proxy.

## Overview

Kling AI is a state-of-the-art video generation model developed by Kuaishou. PiAPI provides a stable API proxy interface for accessing Kling's capabilities, including text-to-video, image-to-video, video extension, lipsync, and effects generation.

### Supported Kling Versions

| Version | Features | Pricing (5s) | Pricing (10s) |
|---------|----------|--------------|---------------|
| **1.5/1.6** | Full features, elements support | Standard | Standard |
| **2.0** | Enhanced quality | $0.96/gen | $1.92/gen |
| **2.1 Standard** | Improved prompt adherence | Same as 1.6 | Same as 1.6 |
| **2.1 Master** | Best quality, pro mode | $0.96/gen | $1.92/gen |
| **2.5** | Latest, cost-effective | $0.33/gen | $0.66/gen |

## Base URL

```
https://api.piapi.ai/api/v1/task
```

## Authentication

All requests require an API key in the header:

```bash
X-API-Key: your_api_key_here
```

---

## Endpoints

### 1. Create Task (Video Generation)

**POST** `/api/v1/task`

Creates a new video generation task. Supports text-to-video (t2v) and image-to-video (i2v).

#### Request Body

```json
{
  "model": "kling",
  "task_type": "video_generation",
  "input": {
    "prompt": "string",
    "negative_prompt": "string",
    "image_url": "string | null",
    "cfg_scale": 0.5,
    "duration": 5,
    "aspect_ratio": "16:9",
    "mode": "std",
    "version": "2.1",
    "camera_control": {
      "type": "simple",
      "config": {
        "horizontal": 0,
        "vertical": 0,
        "pan": 0,
        "tilt": 0,
        "roll": 0,
        "zoom": 0
      }
    },
    "elements": []
  },
  "config": {
    "service_mode": "public",
    "webhook_config": {
      "endpoint": "https://your-webhook.com/callback",
      "secret": "your_webhook_secret"
    }
  }
}
```

#### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the desired video (max ~500 chars recommended) |
| `negative_prompt` | string | No | Elements to avoid in generation |
| `image_url` | string | No | URL of input image for i2v. If null, creates t2v task |
| `cfg_scale` | number | No | Classifier-free guidance scale (0.0-1.0, default: 0.5) |
| `duration` | number | Yes | Video length in seconds: `5` or `10` |
| `aspect_ratio` | string | Yes | `"16:9"`, `"9:16"`, or `"1:1"` |
| `mode` | string | Yes | `"std"` (standard) or `"pro"` (professional) |
| `version` | string | No | Model version: `"1.5"`, `"1.6"`, `"2.0"`, `"2.1"`, `"2.1-master"`, `"2.5"` |
| `camera_control` | object | No | Camera movement settings |
| `elements` | array | No | Reference images for character/object consistency (1-4 items) |

#### Camera Control Configuration

```json
{
  "type": "simple",
  "config": {
    "horizontal": -10 to 10,  // Move left (-) or right (+)
    "vertical": -10 to 10,    // Move up (-) or down (+)
    "pan": -10 to 10,         // Tilt up (-) or down (+) - NOTE: Kling uses "pan" for vertical
    "tilt": -10 to 10,        // Rotate left (-) or right (+)
    "roll": -10 to 10,        // Roll left (-) or right (+)
    "zoom": -10 to 10         // Zoom out (-) or in (+)
  }
}
```

**Master Shots** (pre-defined camera movements):
- Move Left and Zoom In
- Move Right and Zoom In
- Move Forward and Zoom Up
- Move Down and Zoom Out

#### Response

```json
{
  "code": 200,
  "data": {
    "task_id": "6e269e8c-2091-46c4-b4a5-40a4704a766a",
    "model": "kling",
    "task_type": "video_generation",
    "status": "pending",
    "config": {},
    "input": {},
    "output": {
      "video_url": ""
    },
    "meta": {},
    "detail": null,
    "logs": [],
    "error": {
      "code": 0,
      "raw_message": "",
      "message": "",
      "detail": null
    }
  },
  "message": "success"
}
```

---

### 2. Create Task with Elements (Character Consistency)

**POST** `/api/v1/task`

Uses the Elements feature for maintaining character/object consistency across videos.

#### Request Body

```json
{
  "model": "kling",
  "task_type": "video_generation",
  "input": {
    "prompt": "Two toy figures fighting",
    "negative_prompt": "",
    "duration": 5,
    "elements": [
      { "image_url": "https://example.com/character1.png" },
      { "image_url": "https://example.com/character2.png" }
    ],
    "mode": "std",
    "aspect_ratio": "16:9",
    "version": "1.6"
  },
  "config": {
    "service_mode": "public",
    "webhook_config": {
      "endpoint": "",
      "secret": ""
    }
  }
}
```

#### Elements Requirements

- **Count**: 1-4 images per request
- **Formats**: JPG, PNG
- **Max file size**: 10MB per image
- **Minimum dimension**: 300px
- **Version requirement**: Must use `"version": "1.6"` or higher for elements

---

### 3. Get Task Status

**GET** `/api/v1/task/{task_id}`

Retrieves the current status and output of a video generation task.

#### Response (Completed)

```json
{
  "code": 200,
  "data": {
    "task_id": "6e269e8c-2091-46c4-b4a5-40a4704a766a",
    "model": "kling",
    "task_type": "video_generation",
    "status": "completed",
    "input": {},
    "output": {
      "video_url": "https://cdn.example.com/video.mp4",
      "video_url_no_watermark": "https://cdn.example.com/video_clean.mp4",
      "thumbnail_url": "https://cdn.example.com/thumb.jpg"
    },
    "meta": {
      "created_at": "2024-08-24T23:01:12.355Z",
      "started_at": "2024-08-24T23:01:36.743Z",
      "ended_at": "2024-08-24T23:04:13.530Z",
      "usage": {
        "type": "kling_quota",
        "frozen": 30,
        "consume": 30
      }
    },
    "error": {
      "code": 0,
      "message": ""
    }
  },
  "message": "success"
}
```

#### Task Status Values

| Status | Description |
|--------|-------------|
| `pending` | Task queued, waiting to start |
| `processing` | Video generation in progress |
| `completed` | Video successfully generated |
| `failed` | Generation failed (check error field) |

---

### 4. Cancel Task

**POST** `/api/v1/task/cancel`

Cancels a pending or processing task.

#### Request Body

```json
{
  "task_id": "6e269e8c-2091-46c4-b4a5-40a4704a766a"
}
```

---

### 5. Additional Task Types

#### Virtual Try-On

```json
{
  "model": "kling",
  "task_type": "virtual_try_on",
  "input": {
    "model_image_url": "https://example.com/model.jpg",
    "garment_image_url": "https://example.com/garment.jpg"
  }
}
```

#### Lipsync

```json
{
  "model": "kling",
  "task_type": "lipsync",
  "input": {
    "video_url": "https://example.com/video.mp4",
    "audio_url": "https://example.com/audio.mp3"
  }
}
```

#### Effects

```json
{
  "model": "kling",
  "task_type": "effects",
  "input": {
    "image_url": "https://example.com/image.jpg",
    "effect_type": "zoom_in"
  }
}
```

#### Sound Generation

```json
{
  "model": "kling",
  "task_type": "sound",
  "input": {
    "video_url": "https://example.com/video.mp4",
    "prompt": "ambient forest sounds"
  }
}
```

---

## Webhook Configuration

### Setup

Include `webhook_config` in the `config` object:

```json
{
  "config": {
    "webhook_config": {
      "endpoint": "https://your-server.com/webhook/kling",
      "secret": "your_webhook_secret_123"
    }
  }
}
```

### Webhook Payload

```json
{
  "timestamp": 1724511853,
  "data": {
    "task_id": "58cb41b7-556d-46c0-b82e-1e116aa1a31a",
    "model": "kling",
    "task_type": "video_generation",
    "status": "completed",
    "config": {
      "webhook_config": {
        "endpoint": "https://webhook.site/xxxxx",
        "secret": "123456"
      }
    },
    "input": {},
    "output": {
      "video_url": "https://cdn.example.com/video.mp4"
    },
    "meta": {
      "created_at": "2024-08-24T23:01:12.355Z",
      "started_at": "2024-08-24T23:01:36.743Z",
      "ended_at": "2024-08-24T23:04:13.530Z",
      "usage": {}
    },
    "error": {
      "code": 0,
      "message": ""
    }
  }
}
```

### Webhook Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `x-webhook-secret` | The secret you provided in `webhook_config` |

### Webhook Behavior

- **Triggered on**: Task creation, completion, or failure
- **Retries**: 3 attempts with 5-second intervals on failure
- **Timeout**: Your endpoint must respond with 2xx status quickly
- **Security**: Verify the `x-webhook-secret` header matches your secret

---

## Error Handling

### HTTP Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `400` | Bad Request - Invalid parameters |
| `401` | Unauthorized - Invalid API key |
| `403` | Forbidden - Insufficient permissions |
| `404` | Not Found - Task doesn't exist |
| `429` | Too Many Requests - Rate limit exceeded |
| `500` | Internal Server Error |

### Error Response Format

```json
{
  "code": 400,
  "data": null,
  "message": "Invalid prompt: content violates guidelines",
  "error": {
    "code": 1001,
    "raw_message": "Content moderation failed",
    "message": "Your prompt contains prohibited content",
    "detail": {
      "flagged_content": ["violence"]
    }
  }
}
```

### Common Error Codes

| Error Code | Description | Resolution |
|------------|-------------|------------|
| `1001` | Content moderation failure | Revise prompt to remove prohibited content |
| `1002` | Invalid image URL | Ensure image URL is accessible and valid |
| `1003` | Image too small | Use images >= 300px dimension |
| `1004` | Image too large | Keep images under 10MB |
| `1005` | Invalid duration | Use 5 or 10 seconds only |
| `1006` | Invalid aspect ratio | Use 16:9, 9:16, or 1:1 |
| `1007` | Quota exceeded | Add credits or wait for reset |
| `1008` | Rate limit exceeded | Reduce request frequency |

### Banned Words

Kling has content moderation that blocks certain words. Known blocked terms include:
- `chest`, `pig`, `exorcism`, `filthy`

**Workarounds**:
- Replace with synonyms: `pig` -> `piglet`, `filthy` -> `unclean`
- Use image-to-video to bypass text prompt restrictions
- Test prompts in Kling's image generator first (cheaper)

---

## Rate Limits & Quotas

### Pay-as-you-go

- No strict rate limits documented
- Credit consumption per generation
- Concurrent request handling via queue

### Host-Your-Account

- $10/seat monthly
- Dedicated account(s) for lower wait times
- Multiple account support for load balancing

### Best Practices

1. Implement client-side rate limiting
2. Use exponential backoff on 429 errors
3. Queue requests for high-volume applications
4. Monitor credit balance via Account Management API

---

## Performance Benchmarks

### Typical Generation Times

| Duration | Mode | Estimated Time |
|----------|------|----------------|
| 5 seconds | Standard | 60-120 seconds |
| 5 seconds | Pro | 90-180 seconds |
| 10 seconds | Standard | 120-240 seconds |
| 10 seconds | Pro | 180-360 seconds |

*Note: Times vary based on queue depth and complexity*

### Output Specifications

- **Resolution**: Up to 1080p
- **Format**: MP4
- **Frame rate**: ~24-30 fps
- **Watermark**: Present on standard output, removed version available

---

## Code Examples

### TypeScript - Create Video Task

```typescript
interface KlingVideoRequest {
  model: 'kling';
  task_type: 'video_generation';
  input: {
    prompt: string;
    negative_prompt?: string;
    image_url?: string;
    duration: 5 | 10;
    aspect_ratio: '16:9' | '9:16' | '1:1';
    mode: 'std' | 'pro';
    version?: string;
    elements?: Array<{ image_url: string }>;
    camera_control?: {
      type: 'simple';
      config: {
        horizontal?: number;
        vertical?: number;
        pan?: number;
        tilt?: number;
        roll?: number;
        zoom?: number;
      };
    };
  };
  config: {
    service_mode?: string;
    webhook_config?: {
      endpoint: string;
      secret: string;
    };
  };
}

async function createKlingVideo(request: KlingVideoRequest): Promise<string> {
  const response = await fetch('https://api.piapi.ai/api/v1/task', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.PIAPI_API_KEY!,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data.task_id;
}

// Example usage
const taskId = await createKlingVideo({
  model: 'kling',
  task_type: 'video_generation',
  input: {
    prompt: 'A majestic eagle soaring over mountains at sunset',
    duration: 5,
    aspect_ratio: '16:9',
    mode: 'pro',
    version: '2.1',
  },
  config: {
    webhook_config: {
      endpoint: 'https://your-app.com/api/webhooks/kling',
      secret: process.env.WEBHOOK_SECRET!,
    },
  },
});
```

### TypeScript - Poll for Completion

```typescript
async function pollTaskStatus(taskId: string, maxAttempts = 60): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
      headers: {
        'X-API-Key': process.env.PIAPI_API_KEY!,
      },
    });

    const data = await response.json();

    if (data.data.status === 'completed') {
      return data.data.output.video_url;
    }

    if (data.data.status === 'failed') {
      throw new Error(`Generation failed: ${data.data.error.message}`);
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Polling timeout exceeded');
}
```

### TypeScript - Webhook Handler (Next.js)

```typescript
import { NextRequest, NextResponse } from 'next/server';

interface KlingWebhookPayload {
  timestamp: number;
  data: {
    task_id: string;
    model: string;
    task_type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    output?: {
      video_url?: string;
    };
    error?: {
      code: number;
      message: string;
    };
  };
}

export async function POST(request: NextRequest) {
  // Verify webhook secret
  const secret = request.headers.get('x-webhook-secret');
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload: KlingWebhookPayload = await request.json();

  // Respond quickly to avoid timeout
  const responsePromise = NextResponse.json({ received: true });

  // Process asynchronously
  processWebhook(payload).catch(console.error);

  return responsePromise;
}

async function processWebhook(payload: KlingWebhookPayload) {
  const { task_id, status, output, error } = payload.data;

  if (status === 'completed' && output?.video_url) {
    // Save video URL to database
    await saveGeneratedVideo(task_id, output.video_url);
  } else if (status === 'failed') {
    // Log error and notify user
    console.error(`Task ${task_id} failed: ${error?.message}`);
    await notifyUserOfFailure(task_id, error?.message);
  }
}
```

---

## References

- **PiAPI Kling Documentation**: https://piapi.ai/docs/kling-api/create-task
- **PiAPI Workspace**: https://app.piapi.ai/
- **Kling AI Official**: https://kling.ai
- **PiAPI GitHub Examples**: https://github.com/PiAPI-1/KlingAPI
