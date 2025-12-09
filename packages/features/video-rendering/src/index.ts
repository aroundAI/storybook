/**
 * @kit/video-rendering
 *
 * Video rendering package for stitching shots into episodes using FFmpeg.
 *
 * This package provides:
 * - FFmpeg command generation for video concatenation, transitions, and audio mixing
 * - Provider abstraction for multiple rendering backends (FFmpeg, Remotion, cloud services)
 * - Timeline integration for the Edit Suite
 * - Quality presets for different platforms (YouTube, TikTok, Instagram, etc.)
 *
 * @example
 * ```typescript
 * import { createRenderService } from '@kit/video-rendering/server';
 * import type { RenderRequest } from '@kit/video-rendering/types';
 *
 * const service = createRenderService();
 *
 * const request: RenderRequest = {
 *   id: 'episode-1',
 *   shots: [
 *     { id: 'shot-1', sourceUrl: '/videos/shot1.mp4', duration: 5, startTime: 0 },
 *     { id: 'shot-2', sourceUrl: '/videos/shot2.mp4', duration: 5, startTime: 5 },
 *   ],
 *   transitions: [{ type: 'crossfade', duration: 0.5 }],
 *   outputFormat: 'mp4',
 *   resolution: '1080p',
 *   quality: 'standard',
 * };
 *
 * const result = await service.render(request, (progress) => {
 *   console.log(`Rendering: ${progress.percent}%`);
 * });
 *
 * console.log('Output:', result.outputUrl);
 * ```
 *
 * @packageDocumentation
 */

// Re-export all modules
export * from './lib';
export * from './providers';
export * from './server';
