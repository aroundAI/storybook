import { NextResponse } from 'next/server';

import {
  PROJECT_ASSETS_BUCKET,
  deleteFromStorage,
  generateThumbnail,
  getImageDimensions,
  getThumbnailContentType,
  uploadToStorage,
  validateImageDimensions,
} from '@kit/assets/upload';
import {
  generateStoragePath,
  sanitizeFilename,
  validateUpload,
} from '@kit/assets/upload-validation';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * POST /api/projects/[projectId]/assets/upload
 *
 * Upload an image file for a project asset.
 * Validates file type, size, dimensions, and generates a thumbnail.
 *
 * Request: multipart/form-data with:
 * - file: The image file (required)
 * - assetId: Optional asset ID to associate with (for path generation)
 * - fieldType: Type of field (thumbnail, file, reference) - defaults to 'reference'
 *
 * Response:
 * - 200: Success with imageUrl, thumbnailUrl, dimensions, size
 * - 400: Invalid file type, dimensions, or missing file
 * - 403: Unauthorized (via enhanceRouteHandler)
 * - 404: Project not found
 * - 413: File too large
 * - 500: Storage failure
 */
export const POST = enhanceRouteHandler(
  async ({ request, user, params }) => {
    // FORCE CONSOLE LOG to ensure it hits stdout immediately
    console.log('[Upload Debug] Route handler entered');
    const logger = await getLogger();
    const projectId = params.projectId as string;
    const ctx = { name: 'asset-upload', projectId, userId: user.id };

    logger.info(ctx, 'Processing asset upload request');
    console.log('[Upload Debug] Context initialized', ctx);

    const client = getSupabaseServerClient();

    // 1. Verify project exists and user has access
    console.log('[Upload Debug] Verifying project access');
    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id, account_id')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      console.log('[Upload Debug] Project verification failed', projectError);
      logger.warn({ ...ctx, error: projectError }, 'Project not found');
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    console.log('[Upload Debug] Project verified');

    // 2. Parse form data
    let formData: FormData;
    try {
      console.log('[Upload Debug] Parsing form data');
      formData = await request.formData();
      console.log('[Upload Debug] Form data parsed');
    } catch (error) {
      console.log('[Upload Debug] Form data parse error', error);
      logger.error({ ...ctx, error }, 'Failed to parse form data');
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    const assetId = (formData.get('assetId') as string) || crypto.randomUUID();
    const fieldType = (formData.get('fieldType') as string) || 'reference';

    console.log('[Upload Debug] File extracted', {
      fileName: file?.name,
      fileSize: file?.size,
      fileType: file?.type,
      assetId,
      fieldType
    });

    if (!file) {
      logger.warn(ctx, 'No file provided');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // 3. Validate file type, size, and magic bytes
    console.log('[Upload Debug] Validating upload constraints');
    const validation = await validateUpload(file, 'image');

    if (!validation.valid) {
      console.log('[Upload Debug] Validation failed', validation.error);
      logger.warn(
        { ...ctx, code: validation.error?.code },
        'File validation failed',
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
    console.log('[Upload Debug] Validation passed');

    // 4. Read file buffer
    let buffer: Buffer;
    try {
      console.log('[Upload Debug] Reading file buffer');
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      console.log('[Upload Debug] Buffer read complete, size:', buffer.length);
    } catch (error) {
      console.log('[Upload Debug] Buffer read error', error);
      logger.error({ ...ctx, error }, 'Failed to read file buffer');
      return NextResponse.json(
        { error: 'Failed to read file' },
        { status: 500 },
      );
    }

    // 5. Validate image dimensions
    // NOTE: This uses sharp, may crash here
    console.log('[Upload Debug] Validating image dimensions (calling sharp)');
    try {
      const dimensionValidation = await validateImageDimensions(buffer);
      console.log('[Upload Debug] Dimension validation result:', dimensionValidation);

      if (!dimensionValidation.valid) {
        logger.warn(
          { ...ctx, code: dimensionValidation.error?.code },
          'Dimension validation failed',
        );
        return NextResponse.json(
          {
            error: dimensionValidation.error?.message,
            code: dimensionValidation.error?.code,
            details: dimensionValidation.error?.details,
          },
          { status: 400 },
        );
      }
    } catch (error) {
      console.error('[Upload Debug] CRITICAL: Error during dimension validation (sharp?)', error);
      // Rethrowing or handling? Let's log and rethrow to see 500
      throw error;
    }

    // 6. Get image dimensions for response
    console.log('[Upload Debug] Getting image dimensions (calling sharp again)');
    const dimensions = await getImageDimensions(buffer);
    console.log('[Upload Debug] Dimensions obtained:', dimensions);

    // 7. Generate storage paths
    const sanitizedFilename = sanitizeFilename(file.name);
    const originalPath = generateStoragePath(
      projectId,
      assetId,
      fieldType as 'thumbnail' | 'file' | 'reference',
      sanitizedFilename,
    );
    const thumbnailPath = generateStoragePath(
      projectId,
      assetId,
      'thumbnail',
      sanitizedFilename.replace(/\.[^.]+$/, '.webp'),
    );
    console.log('[Upload Debug] Storage paths generated', { originalPath, thumbnailPath });

    // 8. Upload original image
    let originalResult: { url: string };
    try {
      console.log('[Upload Debug] Uploading original image to S3');
      logger.info({ ...ctx, path: originalPath }, 'Uploading original image');
      originalResult = await uploadToStorage(
        client,
        PROJECT_ASSETS_BUCKET,
        originalPath,
        buffer,
        { contentType: file.type },
      );
      console.log('[Upload Debug] Original upload successful', originalResult);
    } catch (error) {
      console.log('[Upload Debug] Original upload failed', error);
      logger.error({ ...ctx, error }, 'Original image upload failed');
      return NextResponse.json(
        { error: 'Upload failed. Please try again.' },
        { status: 500 },
      );
    }

    // 9. Generate and upload thumbnail
    let thumbnailResult: { url: string };
    try {
      console.log('[Upload Debug] Generating thumbnail (sharp resize)');
      logger.info({ ...ctx, path: thumbnailPath }, 'Generating thumbnail');
      const thumbnailBuffer = await generateThumbnail(buffer);
      console.log('[Upload Debug] Thumbnail generated, size:', thumbnailBuffer.length);

      console.log('[Upload Debug] Uploading thumbnail to S3');
      logger.info({ ...ctx, path: thumbnailPath }, 'Uploading thumbnail');
      thumbnailResult = await uploadToStorage(
        client,
        PROJECT_ASSETS_BUCKET,
        thumbnailPath,
        thumbnailBuffer,
        { contentType: getThumbnailContentType() },
      );
      console.log('[Upload Debug] Thumbnail upload successful');
    } catch (error) {
      console.log('[Upload Debug] Thumbnail generation/upload failed', error);
      // Cleanup: delete the original image since thumbnail failed
      logger.warn(
        { ...ctx, path: originalPath },
        'Thumbnail upload failed, cleaning up original image',
      );
      try {
        await deleteFromStorage(client, PROJECT_ASSETS_BUCKET, originalPath);
        console.log('[Upload Debug] Cleanup successful');
      } catch (cleanupError) {
        console.log('[Upload Debug] Cleanup failed', cleanupError);
        logger.error(
          { ...ctx, error: cleanupError, path: originalPath },
          'Failed to cleanup original image after thumbnail failure',
        );
      }

      logger.error({ ...ctx, error }, 'Thumbnail upload failed');
      return NextResponse.json(
        { error: 'Upload failed. Please try again.' },
        { status: 500 },
      );
    }

    logger.info(ctx, 'Asset upload completed successfully');
    console.log('[Upload Debug] All Done - returning success');

    // 10. Return success response
    return NextResponse.json({
      success: true,
      imageUrl: originalResult.url,
      thumbnailUrl: thumbnailResult.url,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      size: file.size,
      contentType: file.type,
      path: originalPath,
    });
  },
  { auth: true },
);
