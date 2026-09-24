/**
 * Client-only exports for @kit/storage
 *
 * This module is safe to import from client components.
 * It does NOT include server-only adapters.
 */

export {
  requestPresignedUpload,
  uploadWithPresignedUrl,
  uploadAvatar,
  uploadProjectCover,
  UploadRefusal,
} from './client/presigned-upload';
export type {
  PresignRequest,
  PresignedUpload,
} from './client/presigned-upload';
