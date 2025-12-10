/**
 * Shotstack Cloud Rendering Integration
 *
 * Shotstack is a cloud-based video rendering API.
 * This file demonstrates integration patterns.
 *
 * Pricing (as of 2024):
 * - $0.10 per render (basic)
 * - $0.05 per minute of output video
 * - Free tier: 25 renders/month
 *
 * Features:
 * - Video concatenation
 * - Transitions (fade, slide, wipe, etc.)
 * - Text overlays
 * - Audio mixing
 * - Template-based rendering
 *
 * @see https://shotstack.io/docs/guide/
 */

/**
 * Shotstack API configuration
 */
interface ShotstackConfig {
  apiKey: string;
  environment?: 'stage' | 'v1'; // stage for testing, v1 for production
}

/**
 * Timeline clip for Shotstack
 */
interface ShotstackClip {
  asset: {
    type: 'video' | 'audio' | 'image' | 'title' | 'html';
    src?: string;
    text?: string;
    volume?: number;
  };
  start: number;
  length?: number;
  transition?: {
    in?: string;
    out?: string;
  };
  effect?: string;
  fit?: 'cover' | 'contain' | 'none';
}

/**
 * Track definition
 */
interface ShotstackTrack {
  clips: ShotstackClip[];
}

/**
 * Timeline definition
 */
interface ShotstackTimeline {
  soundtrack?: {
    src: string;
    effect?: 'fadeIn' | 'fadeOut' | 'fadeInFadeOut';
    volume?: number;
  };
  background?: string;
  tracks: ShotstackTrack[];
}

/**
 * Output configuration
 */
interface ShotstackOutput {
  format: 'mp4' | 'gif' | 'mp3';
  resolution: 'sd' | 'hd' | '1080' | '4k';
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5' | '4:3';
  fps?: number;
  quality?: 'low' | 'medium' | 'high';
}

/**
 * Render request
 */
interface ShotstackRenderRequest {
  timeline: ShotstackTimeline;
  output: ShotstackOutput;
  callback?: string;
}

/**
 * Render response
 */
interface ShotstackRenderResponse {
  success: boolean;
  message: string;
  response: {
    id: string;
    message: string;
  };
}

/**
 * Render status response
 */
interface ShotstackStatusResponse {
  success: boolean;
  response: {
    id: string;
    status: 'queued' | 'fetching' | 'rendering' | 'saving' | 'done' | 'failed';
    url?: string;
    error?: string;
    created: string;
    updated: string;
  };
}

/**
 * Shotstack API client
 */
export class ShotstackClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ShotstackConfig) {
    this.apiKey = config.apiKey;
    const env = config.environment || 'stage';
    this.baseUrl = `https://api.shotstack.io/${env}`;
  }

  /**
   * Submit a render job
   */
  async render(request: ShotstackRenderRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shotstack render failed: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as ShotstackRenderResponse;

    if (!data.success) {
      throw new Error(`Shotstack render failed: ${data.message}`);
    }

    return data.response.id;
  }

  /**
   * Get render status
   */
  async getStatus(renderId: string): Promise<ShotstackStatusResponse['response']> {
    const response = await fetch(`${this.baseUrl}/render/${renderId}`, {
      headers: {
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.status}`);
    }

    const data = (await response.json()) as ShotstackStatusResponse;
    return data.response;
  }

  /**
   * Wait for render to complete
   */
  async waitForCompletion(
    renderId: string,
    options: { maxWaitMs?: number; pollIntervalMs?: number } = {}
  ): Promise<string> {
    const { maxWaitMs = 300000, pollIntervalMs = 3000 } = options; // 5 min max, 3s poll
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getStatus(renderId);

      if (status.status === 'done' && status.url) {
        return status.url;
      }

      if (status.status === 'failed') {
        throw new Error(`Render failed: ${status.error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('Render timed out');
  }
}

/**
 * Helper: Build a simple concatenation timeline
 */
export function buildConcatTimeline(
  videoUrls: string[],
  options: {
    transitionType?: string;
    transitionDuration?: number;
  } = {}
): ShotstackTimeline {
  const { transitionType = 'fade', transitionDuration: _transitionDuration = 0.5 } = options;

  const clips: ShotstackClip[] = videoUrls.map((url, index) => ({
    asset: {
      type: 'video',
      src: url,
    },
    start: index * 5, // 5 second clips
    length: 5,
    transition:
      index > 0
        ? {
            in: transitionType,
          }
        : undefined,
  }));

  return {
    tracks: [{ clips }],
  };
}

/**
 * Example usage
 */
export async function exampleUsage(): Promise<void> {
  const client = new ShotstackClient({
    apiKey: process.env.SHOTSTACK_API_KEY!,
    environment: 'stage',
  });

  const timeline = buildConcatTimeline(
    [
      'https://example.com/video1.mp4',
      'https://example.com/video2.mp4',
      'https://example.com/video3.mp4',
    ],
    { transitionType: 'fade', transitionDuration: 0.5 }
  );

  const renderId = await client.render({
    timeline,
    output: {
      format: 'mp4',
      resolution: '1080',
    },
  });

  console.log('Render started:', renderId);

  const url = await client.waitForCompletion(renderId);
  console.log('Render complete:', url);
}

/**
 * Cost estimation
 */
export function estimateCost(
  outputDurationSeconds: number,
  resolution: '720p' | '1080p' | '4k'
): number {
  // Base render cost
  let cost = 0.1;

  // Per-minute cost
  const minutes = outputDurationSeconds / 60;
  cost += minutes * 0.05;

  // Resolution multiplier
  if (resolution === '4k') {
    cost *= 2;
  }

  return cost;
}
