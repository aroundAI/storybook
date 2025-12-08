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
    const logger = await getLogger();
    const projectId = params.projectId as string;
    const ctx = { name: 'asset-upload', projectId, userId: user.id };

    logger.info(ctx, 'Processing asset upload request');

    const client = getSupabaseServerClient();

    // 1. Verify project exists and user has access
    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id, account_id')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      logger.warn({ ...ctx, error: projectError }, 'Project not found');
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 2. Parse form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      logger.error({ ...ctx, error }, 'Failed to parse form data');
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    const assetId = (formData.get('assetId') as string) || crypto.randomUUID();
    const fieldType = (formData.get('fieldType') as string) || 'reference';

    if (!file) {
      logger.warn(ctx, 'No file provided');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // 3. Validate file type, size, and magic bytes
    const validation = await validateUpload(file, 'image');

    if (!validation.valid) {
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

    // 4. Read file buffer
    let buffer: Buffer;
    try {
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      logger.error({ ...ctx, error }, 'Failed to read file buffer');
      return NextResponse.json(
        { error: 'Failed to read file' },
        { status: 500 },
      );
    }

    // 5. Validate image dimensions
    const dimensionValidation = await validateImageDimensions(buffer);

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

    // 6. Get image dimensions for response
    const dimensions = await getImageDimensions(buffer);

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

    // 8. Upload original image
    let originalResult: { url: string };
    try {
      logger.info({ ...ctx, path: originalPath }, 'Uploading original image');
      originalResult = await uploadToStorage(
        client,
        PROJECT_ASSETS_BUCKET,
        originalPath,
        buffer,
        { contentType: file.type },
      );
    } catch (error) {
      logger.error({ ...ctx, error }, 'Original image upload failed');
      return NextResponse.json(
        { error: 'Upload failed. Please try again.' },
        { status: 500 },
      );
    }

    // 9. Generate and upload thumbnail
    let thumbnailResult: { url: string };
    try {
      logger.info({ ...ctx, path: thumbnailPath }, 'Generating thumbnail');
      const thumbnailBuffer = await generateThumbnail(buffer);

      logger.info({ ...ctx, path: thumbnailPath }, 'Uploading thumbnail');
      thumbnailResult = await uploadToStorage(
        client,
        PROJECT_ASSETS_BUCKET,
        thumbnailPath,
        thumbnailBuffer,
        { contentType: getThumbnailContentType() },
      );
    } catch (error) {
      // Cleanup: delete the original image since thumbnail failed
      logger.warn(
        { ...ctx, path: originalPath },
        'Thumbnail upload failed, cleaning up original image',
      );
      try {
        await deleteFromStorage(client, PROJECT_ASSETS_BUCKET, originalPath);
      } catch (cleanupError) {
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
