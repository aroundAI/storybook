import { NextResponse } from 'next/server';

import {
  PROJECT_ASSETS_BUCKET,
  deleteFromStorage,
  uploadToStorage,
} from '@kit/assets/upload';
import {
  sanitizeFilename,
  validateUpload,
} from '@kit/assets/upload-validation';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * POST /api/projects/[projectId]/shots/[shotId]/upload
 *
 * Upload a video file for a shot with browser-extracted thumbnail.
 *
 * Request: multipart/form-data with:
 * - video: The video file (required)
 * - thumbnail: The thumbnail image blob (required, extracted client-side)
 * - duration: Video duration in seconds (optional)
 * - width: Video width in pixels (optional)
 * - height: Video height in pixels (optional)
 *
 * Response:
 * - 200: Success with videoUrl, thumbnailUrl
 * - 400: Invalid file type or missing file
 * - 403: Unauthorized (via enhanceRouteHandler)
 * - 404: Shot or project not found
 * - 413: File too large
 * - 500: Storage failure
 */
export const POST = enhanceRouteHandler(
  async ({ request, user, params }) => {
    const logger = await getLogger();
    const projectId = params.projectId as string;
    const shotId = params.shotId as string;
    const ctx = {
      name: 'shot-video-upload',
      projectId,
      shotId,
      userId: user.id,
    };

    logger.info(ctx, 'Processing shot video upload request');

    const client = getSupabaseServerClient();

    // 1. Verify shot exists and user has access via project
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shot, error: shotError } = await (client as any)
      .from('shots')
      .select(
        `
        id,
        episode_id,
        episodes!inner (
          project_id,
          projects!inner (
            id,
            account_id
          )
        )
      `,
      )
      .eq('id', shotId)
      .is('deleted_at', null)
      .single();

    if (shotError || !shot) {
      logger.warn({ ...ctx, error: shotError }, 'Shot not found');
      return NextResponse.json({ error: 'Shot not found' }, { status: 404 });
    }

    // Verify project matches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shotProjectId = (shot.episodes as any)?.project_id;
    if (shotProjectId !== projectId) {
      logger.warn(ctx, 'Shot does not belong to project');
      return NextResponse.json(
        { error: 'Shot not found in project' },
        { status: 404 },
      );
    }

    // 2. Parse form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      logger.error({ ...ctx, error }, 'Failed to parse form data');
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    }

    const videoFile = formData.get('video') as File | null;
    const thumbnailBlob = formData.get('thumbnail') as File | null;
    const duration = formData.get('duration') as string | null;
    const width = formData.get('width') as string | null;
    const height = formData.get('height') as string | null;

    if (!videoFile) {
      logger.warn(ctx, 'No video file provided');
      return NextResponse.json(
        { error: 'No video file provided' },
        { status: 400 },
      );
    }

    if (!thumbnailBlob) {
      logger.warn(ctx, 'No thumbnail provided');
      return NextResponse.json(
        { error: 'No thumbnail provided' },
        { status: 400 },
      );
    }

    // 3. Validate video file
    const validation = await validateUpload(videoFile, 'video');

    if (!validation.valid) {
      logger.warn(
        { ...ctx, code: validation.error?.code },
        'Video validation failed',
      );

      const status = validation.error?.code === 'FILE_TOO_LARGE' ? 413 : 400;
      return NextResponse.json(
        {
          error: validation.error?.message,
          code: validation.error?.code,
          details: validation.error?.details,
        },
        { status },
      );
    }

    // 4. Read file buffers
    let videoBuffer: Buffer;
    let thumbnailBuffer: Buffer;
    try {
      const [videoArrayBuffer, thumbnailArrayBuffer] = await Promise.all([
        videoFile.arrayBuffer(),
        thumbnailBlob.arrayBuffer(),
      ]);
      videoBuffer = Buffer.from(videoArrayBuffer);
      thumbnailBuffer = Buffer.from(thumbnailArrayBuffer);
    } catch (error) {
      logger.error({ ...ctx, error }, 'Failed to read file buffers');
      return NextResponse.json(
        { error: 'Failed to read files' },
        { status: 500 },
      );
    }

    // 5. Generate storage paths
    const sanitizedVideoName = sanitizeFilename(videoFile.name);
    const timestamp = Date.now();

    // Path format: {projectId}/shots/{shotId}/video-{timestamp}-{name}
    const videoPath = `${projectId}/shots/${shotId}/video-${timestamp}-${sanitizedVideoName}`;
    const thumbnailPath = `${projectId}/shots/${shotId}/thumbnail-${timestamp}.webp`;

    // 6. Upload video
    let videoResult: { url: string };
    try {
      logger.info({ ...ctx, path: videoPath }, 'Uploading video');
      videoResult = await uploadToStorage(
        client,
        PROJECT_ASSETS_BUCKET,
        videoPath,
        videoBuffer,
        { contentType: videoFile.type },
      );
    } catch (error) {
      logger.error({ ...ctx, error }, 'Video upload failed');
      return NextResponse.json(
        { error: 'Video upload failed. Please try again.' },
        { status: 500 },
      );
    }

    // 7. Upload thumbnail
    let thumbnailResult: { url: string };
    try {
      logger.info({ ...ctx, path: thumbnailPath }, 'Uploading thumbnail');
      thumbnailResult = await uploadToStorage(
        client,
        PROJECT_ASSETS_BUCKET,
        thumbnailPath,
        thumbnailBuffer,
        { contentType: 'image/webp' },
      );
    } catch (error) {
      // Cleanup: delete the video since thumbnail failed
      logger.warn(
        { ...ctx, path: videoPath },
        'Thumbnail upload failed, cleaning up video',
      );
      try {
        await deleteFromStorage(client, PROJECT_ASSETS_BUCKET, videoPath);
      } catch (cleanupError) {
        logger.error(
          { ...ctx, error: cleanupError, path: videoPath },
          'Failed to cleanup video after thumbnail failure',
        );
      }

      logger.error({ ...ctx, error }, 'Thumbnail upload failed');
      return NextResponse.json(
        { error: 'Upload failed. Please try again.' },
        { status: 500 },
      );
    }

    // 8. Update shot with video and thumbnail URLs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (client as any)
      .from('shots')
      .update({
        video_url: videoResult.url,
        thumbnail_url: thumbnailResult.url,
        status: 'completed',
        updated_at: new Date().toISOString(),
        generation_metadata: {
          video_duration: duration ? parseFloat(duration) : null,
          video_width: width ? parseInt(width, 10) : null,
          video_height: height ? parseInt(height, 10) : null,
          video_size: videoFile.size,
          video_content_type: videoFile.type,
          uploaded_at: new Date().toISOString(),
        },
      })
      .eq('id', shotId);

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update shot');
      // Don't delete uploaded files - they can be recovered
      return NextResponse.json(
        { error: 'Failed to update shot record' },
        { status: 500 },
      );
    }

    logger.info(ctx, 'Shot video upload completed successfully');

    // 9. Return success response
    return NextResponse.json({
      success: true,
      videoUrl: videoResult.url,
      thumbnailUrl: thumbnailResult.url,
    });
  },
  { auth: true },
);
