/**
 * Presigned Upload Utility
 *
 * Path helpers over the shared `uploadWithPresignedUrl` from
 * `@kit/storage/client`, the one browser caller of the presign route.
 * This file used to hold a copy of it; a copy is how an uploader ends up
 * sending a request the route has since stopped accepting (KB-38).
 */
import { uploadWithPresignedUrl } from '@kit/storage/client';
import {
  PROJECT_ASSETS_BUCKET,
  fileExtension,
  publishVideoPath,
  shotVideoPath,
} from '@kit/storage/upload-paths';

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
  const path = publishVideoPath(
    episodeId,
    language,
    fileExtension(file.name, 'mp4'),
  );

  return uploadWithPresignedUrl(file, PROJECT_ASSETS_BUCKET, path);
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
  const path = shotVideoPath(
    projectId,
    shotId,
    fileExtension(file.name, 'mp4'),
  );

  return uploadWithPresignedUrl(file, PROJECT_ASSETS_BUCKET, path);
}
