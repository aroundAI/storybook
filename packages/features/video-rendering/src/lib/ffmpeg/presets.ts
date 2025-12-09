/**
 * FFmpeg Presets
 *
 * Pre-configured settings for common use cases.
 */

import type { Resolution, QualityPreset, OutputFormat } from '../types';

/**
 * Preset configuration
 */
export interface RenderPreset {
  name: string;
  description: string;
  resolution: Resolution;
  quality: QualityPreset;
  format: OutputFormat;
  framerate: number;
  additionalArgs?: string[];
}

/**
 * Social media platform presets
 */
export const SOCIAL_MEDIA_PRESETS: Record<string, RenderPreset> = {
  youtube: {
    name: 'YouTube',
    description: 'Optimized for YouTube uploads (1080p, high quality)',
    resolution: '1080p',
    quality: 'high',
    format: 'mp4',
    framerate: 30,
    additionalArgs: ['-bf 2', '-g 30', '-refs 4'],
  },
  youtubeShorts: {
    name: 'YouTube Shorts',
    description: 'Vertical format for YouTube Shorts (1080x1920)',
    resolution: '1080p',
    quality: 'high',
    format: 'mp4',
    framerate: 30,
    additionalArgs: ['-aspect 9:16'],
  },
  tiktok: {
    name: 'TikTok',
    description: 'Optimized for TikTok (1080p vertical, AAC audio)',
    resolution: '1080p',
    quality: 'standard',
    format: 'mp4',
    framerate: 30,
    additionalArgs: ['-aspect 9:16'],
  },
  instagram: {
    name: 'Instagram Reels',
    description: 'Optimized for Instagram Reels',
    resolution: '1080p',
    quality: 'standard',
    format: 'mp4',
    framerate: 30,
    additionalArgs: ['-aspect 9:16'],
  },
  instagramFeed: {
    name: 'Instagram Feed',
    description: 'Square format for Instagram feed',
    resolution: '1080p',
    quality: 'standard',
    format: 'mp4',
    framerate: 30,
    additionalArgs: ['-aspect 1:1'],
  },
  twitter: {
    name: 'Twitter/X',
    description: 'Optimized for Twitter video',
    resolution: '720p',
    quality: 'standard',
    format: 'mp4',
    framerate: 30,
  },
  linkedin: {
    name: 'LinkedIn',
    description: 'Professional format for LinkedIn',
    resolution: '1080p',
    quality: 'standard',
    format: 'mp4',
    framerate: 30,
  },
};

/**
 * Quality-focused presets
 */
export const QUALITY_PRESETS: Record<string, RenderPreset> = {
  preview: {
    name: 'Preview',
    description: 'Fast preview rendering (480p, draft quality)',
    resolution: '480p',
    quality: 'draft',
    format: 'mp4',
    framerate: 30,
  },
  standard: {
    name: 'Standard',
    description: 'Balanced quality and speed (1080p)',
    resolution: '1080p',
    quality: 'standard',
    format: 'mp4',
    framerate: 30,
  },
  highQuality: {
    name: 'High Quality',
    description: 'Maximum quality (1080p, slow encoding)',
    resolution: '1080p',
    quality: 'high',
    format: 'mp4',
    framerate: 30,
  },
  cinema4k: {
    name: '4K Cinema',
    description: 'Cinema quality 4K output',
    resolution: '4k',
    quality: 'high',
    format: 'mp4',
    framerate: 24,
    additionalArgs: ['-profile:v high10', '-pix_fmt yuv420p10le'],
  },
};

/**
 * Device-optimized presets
 */
export const DEVICE_PRESETS: Record<string, RenderPreset> = {
  mobile: {
    name: 'Mobile',
    description: 'Optimized for mobile devices (720p)',
    resolution: '720p',
    quality: 'standard',
    format: 'mp4',
    framerate: 30,
  },
  tablet: {
    name: 'Tablet',
    description: 'Optimized for tablets (1080p)',
    resolution: '1080p',
    quality: 'standard',
    format: 'mp4',
    framerate: 30,
  },
  desktop: {
    name: 'Desktop',
    description: 'Optimized for desktop viewing',
    resolution: '1080p',
    quality: 'high',
    format: 'mp4',
    framerate: 30,
  },
  tv: {
    name: 'TV/Smart Display',
    description: 'Optimized for large screens',
    resolution: '4k',
    quality: 'high',
    format: 'mp4',
    framerate: 30,
  },
};

/**
 * Web-optimized presets
 */
export const WEB_PRESETS: Record<string, RenderPreset> = {
  webOptimized: {
    name: 'Web Optimized',
    description: 'Fast-loading web video (720p, small file)',
    resolution: '720p',
    quality: 'standard',
    format: 'mp4',
    framerate: 30,
    additionalArgs: ['-movflags +faststart', '-maxrate 2M', '-bufsize 4M'],
  },
  webmHighQuality: {
    name: 'WebM High Quality',
    description: 'VP9 codec for modern browsers',
    resolution: '1080p',
    quality: 'high',
    format: 'webm',
    framerate: 30,
  },
};

/**
 * Get all available presets
 */
export function getAllPresets(): Record<string, RenderPreset> {
  return {
    ...SOCIAL_MEDIA_PRESETS,
    ...QUALITY_PRESETS,
    ...DEVICE_PRESETS,
    ...WEB_PRESETS,
  };
}

/**
 * Get preset by name
 */
export function getPreset(name: string): RenderPreset | undefined {
  const allPresets = getAllPresets();
  return allPresets[name];
}

/**
 * Get recommended preset for a platform
 */
export function getRecommendedPreset(platform: string): RenderPreset {
  const platformMap: Record<string, string> = {
    youtube: 'youtube',
    'youtube-shorts': 'youtubeShorts',
    tiktok: 'tiktok',
    instagram: 'instagram',
    'instagram-reels': 'instagram',
    'instagram-feed': 'instagramFeed',
    twitter: 'twitter',
    x: 'twitter',
    linkedin: 'linkedin',
    web: 'webOptimized',
    mobile: 'mobile',
    default: 'standard',
  };

  const presetName = platformMap[platform.toLowerCase()] || 'standard';
  return getAllPresets()[presetName] || QUALITY_PRESETS.standard;
}

/**
 * Get FFmpeg arguments for a preset
 */
export function getPresetFFmpegArgs(preset: RenderPreset): string[] {
  const args: string[] = [];

  // Frame rate
  args.push(`-r ${preset.framerate}`);

  // Additional args
  if (preset.additionalArgs) {
    args.push(...preset.additionalArgs);
  }

  return args;
}
