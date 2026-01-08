/**
 * Client-only exports for @kit/storage
 *
 * This module is safe to import from client components.
 * It does NOT include server-only adapters.
 */

export {
    uploadWithPresignedUrl,
    uploadAvatar,
    uploadProjectCover,
} from './client/presigned-upload';
