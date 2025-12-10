/**
 * Mux Video Platform Evaluation
 *
 * Mux is primarily a video streaming and delivery platform.
 * It does NOT support video composition/stitching.
 *
 * This file documents why Mux is NOT suitable for our use case
 * and what it IS good for.
 *
 * @see https://mux.com/docs
 */

/**
 * What Mux IS good for:
 *
 * 1. Video Hosting & Streaming
 *    - Upload videos and get HLS/DASH streaming URLs
 *    - Automatic transcoding to multiple qualities
 *    - Global CDN delivery
 *
 * 2. Video Analytics
 *    - Detailed playback analytics
 *    - Quality of experience metrics
 *    - Real-time monitoring
 *
 * 3. Live Streaming
 *    - RTMP/SRT ingest
 *    - Low-latency streaming
 *    - Recording
 *
 * 4. Video Player
 *    - Mux Player (React, Web Components)
 *    - Customizable, accessible
 *
 * What Mux CANNOT do:
 *
 * 1. Video Composition/Stitching
 *    - No API for combining multiple videos
 *    - No transitions or effects
 *    - No timeline editing
 *
 * 2. Video Rendering
 *    - Cannot render new videos from compositions
 *    - Cannot add text overlays programmatically
 *    - Cannot mix audio tracks
 */

/**
 * Mux configuration (for reference)
 */
interface MuxConfig {
  tokenId: string;
  tokenSecret: string;
}

/**
 * Example: Upload a pre-rendered video to Mux for delivery
 *
 * This is how you would use Mux AFTER rendering with FFmpeg
 */
export async function uploadToMux(
  videoUrl: string,
  config: MuxConfig
): Promise<{
  assetId: string;
  playbackId: string;
  streamUrl: string;
}> {
  const auth = Buffer.from(`${config.tokenId}:${config.tokenSecret}`).toString(
    'base64'
  );

  // Create asset from URL
  const response = await fetch('https://api.mux.com/video/v1/assets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      input: videoUrl,
      playback_policy: ['public'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Mux upload failed: ${response.status}`);
  }

  const data = await response.json();
  const asset = data.data;

  return {
    assetId: asset.id,
    playbackId: asset.playback_ids[0].id,
    streamUrl: `https://stream.mux.com/${asset.playback_ids[0].id}.m3u8`,
  };
}

/**
 * Recommended workflow for our platform:
 *
 * 1. Use FFmpeg (or Remotion/Shotstack) to render the final video
 * 2. Upload the rendered video to Mux for delivery
 * 3. Use Mux's streaming URLs in the player
 *
 * This gives us:
 * - Full control over composition (FFmpeg)
 * - Professional streaming delivery (Mux)
 * - Analytics and monitoring (Mux)
 */

/**
 * Cost estimation for Mux (delivery only)
 *
 * Pricing:
 * - $0.007 per minute of video encoded
 * - $0.00015 per minute of video delivered
 * - Storage: $0.009 per GB/month
 */
export function estimateMuxCost(
  durationMinutes: number,
  estimatedViewsPerMonth: number,
  storageTB: number = 0.01
): {
  encoding: number;
  delivery: number;
  storage: number;
  total: number;
} {
  const encoding = durationMinutes * 0.007;
  const delivery = durationMinutes * estimatedViewsPerMonth * 0.00015;
  const storage = storageTB * 1024 * 0.009;

  return {
    encoding,
    delivery,
    storage,
    total: encoding + delivery + storage,
  };
}

/**
 * Conclusion for SPIKE-02:
 *
 * Mux is NOT a rendering solution and should NOT be compared with
 * FFmpeg, Remotion, or Shotstack for video composition.
 *
 * However, Mux IS a good choice for:
 * - Hosting and delivering our rendered videos
 * - Analytics on video playback
 * - Professional streaming infrastructure
 *
 * Recommendation: Use Mux as a delivery layer AFTER rendering with FFmpeg
 */

export const EVALUATION_SUMMARY = {
  provider: 'Mux',
  supportsComposition: false,
  supportsStitching: false,
  supportsTransitions: false,
  supportsAudioMixing: false,
  supportsTextOverlays: false,

  supportsVideoHosting: true,
  supportsStreaming: true,
  supportsAnalytics: true,
  supportsLiveStreaming: true,

  recommendation:
    'Use as delivery layer after rendering with FFmpeg, not as a rendering solution',
};
