/**
 * Smart Storage Routing
 *
 * Routes uploads to the appropriate storage provider based on asset type.
 * 
 * STRATEGY: ALL runtime uploads go to R2 (Cloudflare)
 * - Zero egress fees for video/audio streaming
 * - Fast edge delivery globally
 * - Consistent storage location for all user uploads
 * 
 * Static build assets (logos, icons in code) use S3/Supabase via CDN.
 */

import 'server-only';

import type { StorageProvider } from './factory';

/**
 * Asset types for routing decisions
 */
export type AssetType =
    | 'video'
    | 'audio'
    | 'thumbnail'
    | 'image'
    | 'avatar'
    | 'document';

/**
 * Route configuration: ALL runtime uploads go to R2
 *
 * R2 Benefits:
 * - Zero egress fees for streaming
 * - Fast edge delivery globally
 * - S3-compatible API
 * - Presigned URL support for large uploads
 */
const ASSET_ROUTE_CONFIG: Record<AssetType, StorageProvider> = {
    video: 'r2',        // Zero egress for large files
    audio: 'r2',        // Streamed frequently
    thumbnail: 'r2',    // Consistent with media storage
    image: 'r2',        // All runtime uploads to R2
    avatar: 'r2',       // All runtime uploads to R2
    document: 'r2',     // All runtime uploads to R2
};

/**
 * Determine asset type from MIME content type
 */
export function getAssetTypeFromContentType(contentType: string): AssetType {
    const type = contentType.toLowerCase();

    if (type.startsWith('video/')) {
        return 'video';
    }

    if (type.startsWith('audio/')) {
        return 'audio';
    }

    if (type.startsWith('image/')) {
        // Could be thumbnail or regular image - caller should specify
        return 'image';
    }

    return 'document';
}

/**
 * Determine asset type from file path patterns
 */
export function getAssetTypeFromPath(path: string): AssetType {
    const lowerPath = path.toLowerCase();

    // Video patterns
    if (
        lowerPath.includes('/final-video') ||
        lowerPath.includes('/shorts/') ||
        lowerPath.includes('/intro') ||
        lowerPath.endsWith('.mp4') ||
        lowerPath.endsWith('.webm') ||
        lowerPath.endsWith('.mov')
    ) {
        return 'video';
    }

    // Audio patterns
    if (
        lowerPath.includes('/dialogue/') ||
        lowerPath.includes('/audio/') ||
        lowerPath.includes('/sfx/') ||
        lowerPath.includes('/music/') ||
        lowerPath.endsWith('.mp3') ||
        lowerPath.endsWith('.wav') ||
        lowerPath.endsWith('.m4a')
    ) {
        return 'audio';
    }

    // Thumbnail patterns
    if (
        lowerPath.includes('/thumbnail') ||
        lowerPath.includes('-thumb.')
    ) {
        return 'thumbnail';
    }

    // Avatar patterns
    if (lowerPath.includes('/avatar') || lowerPath.includes('avatars/')) {
        return 'avatar';
    }

    // Default to image for common image extensions
    if (
        lowerPath.endsWith('.png') ||
        lowerPath.endsWith('.jpg') ||
        lowerPath.endsWith('.jpeg') ||
        lowerPath.endsWith('.webp') ||
        lowerPath.endsWith('.gif')
    ) {
        return 'image';
    }

    return 'document';
}

/**
 * Get the recommended storage provider for an asset type
 */
export function getProviderForAssetType(assetType: AssetType): StorageProvider {
    return ASSET_ROUTE_CONFIG[assetType];
}

/**
 * Get the recommended storage provider based on content type
 */
export function getProviderForContentType(contentType: string): StorageProvider {
    const assetType = getAssetTypeFromContentType(contentType);
    return getProviderForAssetType(assetType);
}

/**
 * Get the recommended storage provider based on file path
 */
export function getProviderForPath(path: string): StorageProvider {
    const assetType = getAssetTypeFromPath(path);
    return getProviderForAssetType(assetType);
}

/**
 * Check if smart routing is enabled
 */
export function isSmartRoutingEnabled(): boolean {
    const provider = process.env.STORAGE_PROVIDER?.toLowerCase();
    return provider === 'smart' || provider === 'auto';
}
