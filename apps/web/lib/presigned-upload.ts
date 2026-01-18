/**
 * Presigned Upload Utility
 * 
 * Uploads files directly to R2 storage using presigned URLs,
 * bypassing the Lambda 6MB payload limit.
 */

interface PresignedUploadResult {
    url: string;
    path: string;
}

interface PresignedUrlResponse {
    uploadUrl: string;
    publicUrl: string;
    expiresIn: number;
    error?: string;
}

/**
 * Upload a file to R2 storage using presigned URLs
 * 
 * Flow:
 * 1. Request presigned URL from server (small request)
 * 2. Upload file directly to R2 using presigned URL (no Lambda)
 * 3. Return public URL
 * 
 * @param file - File to upload
 * @param bucket - Storage bucket name
 * @param path - File path within bucket
 * @returns Upload result with URL and path
 */
export async function uploadWithPresignedUrl(
    file: File,
    bucket: string,
    path: string,
): Promise<PresignedUploadResult> {
    // Step 1: Get presigned URL from our API
    const presignResponse = await fetch('/api/storage/presign', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            bucket,
            path,
            contentType: file.type,
            expiresIn: 900, // 15 minutes
        }),
    });

    const presignData: PresignedUrlResponse = await presignResponse.json();

    if (!presignResponse.ok || presignData.error) {
        throw new Error(presignData.error || 'Failed to get presigned URL');
    }

    // Step 2: Upload file directly to R2 using presigned URL
    const uploadResponse = await fetch(presignData.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
            'Content-Type': file.type,
        },
    });

    if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
    }

    // Step 3: Return public URL
    return {
        url: presignData.publicUrl,
        path,
    };
}

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
