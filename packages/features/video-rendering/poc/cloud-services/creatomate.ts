/**
 * Creatomate Cloud Rendering Integration
 *
 * Creatomate is a template-based video rendering API.
 * This file demonstrates integration patterns.
 *
 * Pricing (as of 2024):
 * - $0.08 per render (basic)
 * - $0.04 per minute of output video
 * - Free tier: 50 renders/month
 *
 * Features:
 * - Template-based rendering
 * - Dynamic content replacement
 * - Video concatenation
 * - Text animations
 * - Real-time preview
 *
 * @see https://creatomate.com/docs
 */

/**
 * Creatomate API configuration
 */
interface CreatomateConfig {
  apiKey: string;
}

/**
 * Element in the composition
 */
interface CreatomateElement {
  type: 'video' | 'audio' | 'image' | 'text' | 'shape';
  source?: string;
  text?: string;
  track?: number;
  time?: number | string; // Can be number or expression like "start"
  duration?: number | string;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  animations?: CreatomateAnimation[];
  [key: string]: unknown; // Additional properties
}

/**
 * Animation definition
 */
interface CreatomateAnimation {
  type: string;
  time?: string;
  duration?: number;
  easing?: string;
  [key: string]: unknown;
}

/**
 * Render source (composition definition)
 */
interface CreatomateSource {
  output_format: 'mp4' | 'gif' | 'png' | 'jpg';
  width: number;
  height: number;
  frame_rate?: number;
  duration?: number;
  elements: CreatomateElement[];
}

/**
 * Render request
 */
interface CreatomateRenderRequest {
  source: CreatomateSource;
  modifications?: Record<string, unknown>;
  webhook_url?: string;
}

/**
 * Template render request (uses pre-defined template)
 */
interface CreatomateTemplateRenderRequest {
  template_id: string;
  modifications: Record<string, unknown>;
  webhook_url?: string;
}

/**
 * Render response
 */
interface CreatomateRenderResponse {
  id: string;
  status: 'planned' | 'rendering' | 'succeeded' | 'failed';
  url?: string;
  error_message?: string;
}

/**
 * Creatomate API client
 */
export class CreatomateClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.creatomate.com/v1';

  constructor(config: CreatomateConfig) {
    this.apiKey = config.apiKey;
  }

  /**
   * Render from source definition
   */
  async render(request: CreatomateRenderRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/renders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Creatomate render failed: ${response.status} - ${error}`,
      );
    }

    const data = (await response.json()) as CreatomateRenderResponse[];
    return data[0].id;
  }

  /**
   * Render from template
   */
  async renderTemplate(
    request: CreatomateTemplateRenderRequest,
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/renders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Creatomate render failed: ${response.status} - ${error}`,
      );
    }

    const data = (await response.json()) as CreatomateRenderResponse[];
    return data[0].id;
  }

  /**
   * Get render status
   */
  async getStatus(renderId: string): Promise<CreatomateRenderResponse> {
    const response = await fetch(`${this.baseUrl}/renders/${renderId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.status}`);
    }

    return (await response.json()) as CreatomateRenderResponse;
  }

  /**
   * Wait for render to complete
   */
  async waitForCompletion(
    renderId: string,
    options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
  ): Promise<string> {
    const { maxWaitMs = 300000, pollIntervalMs = 2000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getStatus(renderId);

      if (status.status === 'succeeded' && status.url) {
        return status.url;
      }

      if (status.status === 'failed') {
        throw new Error(`Render failed: ${status.error_message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('Render timed out');
  }
}

/**
 * Helper: Build a concatenation composition
 */
export function buildConcatSource(
  videoUrls: string[],
  options: {
    width?: number;
    height?: number;
    transitionDuration?: number;
  } = {},
): CreatomateSource {
  const { width = 1920, height = 1080, transitionDuration = 0.5 } = options;

  const clipDuration = 5; // 5 seconds per clip
  const totalDuration = videoUrls.length * clipDuration;

  const elements: CreatomateElement[] = videoUrls.map((url, index) => ({
    type: 'video',
    source: url,
    track: 1,
    time: index * clipDuration,
    duration: clipDuration,
    animations:
      index > 0
        ? [
            {
              type: 'fade',
              time: 'start',
              duration: transitionDuration,
            },
          ]
        : undefined,
  }));

  return {
    output_format: 'mp4',
    width,
    height,
    frame_rate: 30,
    duration: totalDuration,
    elements,
  };
}

/**
 * Example usage
 */
export async function exampleUsage(): Promise<void> {
  const client = new CreatomateClient({
    apiKey: process.env.CREATOMATE_API_KEY!,
  });

  const source = buildConcatSource([
    'https://example.com/video1.mp4',
    'https://example.com/video2.mp4',
    'https://example.com/video3.mp4',
  ]);

  const renderId = await client.render({ source });
  console.log('Render started:', renderId);

  const url = await client.waitForCompletion(renderId);
  console.log('Render complete:', url);
}

/**
 * Cost estimation
 */
export function estimateCost(
  outputDurationSeconds: number,
  resolution: '720p' | '1080p' | '4k',
): number {
  // Base render cost
  let cost = 0.08;

  // Per-minute cost
  const minutes = outputDurationSeconds / 60;
  cost += minutes * 0.04;

  // Resolution multiplier
  if (resolution === '4k') {
    cost *= 1.5;
  }

  return cost;
}
