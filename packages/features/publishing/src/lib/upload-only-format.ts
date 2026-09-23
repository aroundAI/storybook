import type { Platform } from './export-package-types';

/*
 * Pure formatting for the upload-only export package. Out of
 * `upload-only-actions.ts` because that is a `'use server'` module, where
 * every export is an endpoint (KB-58).
 */

/**
 * Regex patterns for extracting content IDs from platform URLs
 */
const CONTENT_ID_PATTERNS: Record<Platform, RegExp> = {
  youtube: /(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  tiktok: /video\/(\d+)/,
  instagram: /(?:reel|p)\/([a-zA-Z0-9_-]+)/,
  facebook: /videos\/(\d+)/,
};

/**
 * Extract platform-specific content ID from URL
 * @returns The extracted content ID, or null if the URL format is not recognized
 */
export function extractContentId(
  url: string,
  platform: Platform,
  logger?: { warn: (ctx: Record<string, unknown>, msg: string) => void },
): string | null {
  const pattern = CONTENT_ID_PATTERNS[platform];
  const match = url.match(pattern);
  const contentId = match?.[1] ?? null;

  if (!contentId && logger) {
    logger.warn(
      { url, platform },
      'Could not extract content ID from URL. Analytics tracking may be limited.',
    );
  }

  return contentId;
}

/**
 * Sanitize filename for safe download
 */
export function sanitizeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .toLowerCase()
    .slice(0, 100); // Limit length
}

/**
 * Format description for specific platform requirements
 */
export function formatDescriptionForPlatform(
  description: string,
  platform: Platform,
): string {
  switch (platform) {
    case 'tiktok':
    case 'instagram':
      // These platforms have shorter character limits and prefer hashtags
      return description.slice(0, 2200);
    case 'youtube':
      // YouTube allows longer descriptions
      return description.slice(0, 5000);
    case 'facebook':
      return description.slice(0, 63206);
    default:
      return description;
  }
}

/**
 * Generate default tags from episode data
 */
export function generateDefaultTags(
  episode: {
    title?: string | null;
    description?: string | null;
    metadata?: unknown;
  },
  _platform: Platform,
): string[] {
  const tags: string[] = [];

  // Extract potential tags from title
  if (episode.title) {
    const titleWords = episode.title
      .split(/\s+/)
      .filter((word) => word.length > 3)
      .slice(0, 5);
    tags.push(...titleWords);
  }

  // Check for existing tags in metadata
  const metadata = episode.metadata as Record<string, unknown> | undefined;
  if (metadata?.tags && Array.isArray(metadata.tags)) {
    tags.push(...(metadata.tags as string[]));
  }

  // Return unique tags
  return [...new Set(tags)].slice(0, 30);
}
