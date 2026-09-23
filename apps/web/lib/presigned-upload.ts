/**
 * Presigned Upload Utility
 *
 * Path helpers over the shared `uploadWithPresignedUrl` from
 * `@kit/storage/client`, the one browser caller of the presign route.
 * This file used to hold a copy of it; a copy is how an uploader ends up
 * sending a request the route has since stopped accepting (KB-38).
 */
import { uploadWithPresignedUrl } from '@kit/storage/client';

export { uploadWithPresignedUrl };

type PresignedUploadResult = Awaited<ReturnType<typeof uploadWithPresignedUrl>>;

/**
 * Upload a video file for publishing
 *
 * @param file - Video file
 * @param episodeId - Episode ID
 * @param language - Language code
 * @returns Upload result
 */
export async function uploadPublishVideo(
  file: File,
  episodeId: string,
  language: string,
): Promise<PresignedUploadResult> {
  const ext = file.name.split('.').pop() || 'mp4';
  const timestamp = Date.now();
  const filename = `${language}-${timestamp}.${ext}`;
  const path = `episodes/${episodeId}/videos/${filename}`;

  return uploadWithPresignedUrl(file, 'project-assets', path);
}

/**
 * Upload a shot video
 *
 * @param file - Video file
 * @param projectId - Project ID
 * @param shotId - Shot ID
 * @returns Upload result
 */
export async function uploadShotVideo(
  file: File,
  projectId: string,
  shotId: string,
): Promise<PresignedUploadResult> {
  const ext = file.name.split('.').pop() || 'mp4';
  const timestamp = Date.now();
  const filename = `shot-${shotId}-${timestamp}.${ext}`;
  const path = `projects/${projectId}/shots/${shotId}/video/${filename}`;

  return uploadWithPresignedUrl(file, 'project-assets', path);
}

/**
 * Upload an image file (thumbnails, frames, etc.)
 *
 * @param file - Image file
 * @param projectId - Project ID
 * @param category - Image category (e.g., 'thumbnails', 'frames')
 * @returns Upload result
 */
export async function uploadImage(
  file: File,
  projectId: string,
  category: string,
): Promise<PresignedUploadResult> {
  const ext = file.name.split('.').pop() || 'jpg';
  const timestamp = Date.now();
  const filename = `${category}-${timestamp}.${ext}`;
  const path = `projects/${projectId}/${category}/${filename}`;

  return uploadWithPresignedUrl(file, 'project-assets', path);
}
