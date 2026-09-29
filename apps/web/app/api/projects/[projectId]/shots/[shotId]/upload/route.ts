import { NextResponse } from 'next/server';

import { z } from 'zod';

import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { readFailed, whyNoRow } from '@kit/shared/rows';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const ALLOWED_VIDEO_CONTENT_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

/**
 * Build a list of allowed URL prefixes for storage URLs.
 * This prevents SSRF by ensuring URLs come from known storage domains.
 */
function getAllowedStorageOrigins(): string[] {
  const origins: string[] = [];

  // Supabase storage
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    origins.push(`${supabaseUrl}/storage/`);
  }

  // R2 / B2 public URLs
  const r2PublicUrl = process.env.R2_PUBLIC_URL;
  if (r2PublicUrl) {
    origins.push(r2PublicUrl);
  }

  const b2PublicUrl = process.env.B2_PUBLIC_URL;
  if (b2PublicUrl) {
    origins.push(b2PublicUrl);
  }

  // Local storage (dev only)
  if (process.env.STORAGE_PROVIDER === 'local') {
    origins.push('/api/storage/');
    origins.push('http://localhost');
  }

  return origins;
}

function isAllowedStorageUrl(url: string): boolean {
  const origins = getAllowedStorageOrigins();

  // If no origins configured (shouldn't happen), reject all
  if (origins.length === 0) {
    return false;
  }

  return origins.some((origin) => url.startsWith(origin));
}

/**
 * Zod schema for the upload metadata request body.
 */
const UploadMetadataSchema = z.object({
  videoUrl: z.string().url(),
  thumbnailUrl: z.string().url(),
  duration: z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
  size: z.number().int().positive().optional(),
  contentType: z
    .string()
    .refine((ct) => ALLOWED_VIDEO_CONTENT_TYPES.includes(ct), {
      message: `Content type must be one of: ${ALLOWED_VIDEO_CONTENT_TYPES.join(', ')}`,
    })
    .optional(),
});

/**
 * POST /api/projects/[projectId]/shots/[shotId]/upload
 *
 * Update a shot record after video and thumbnail have been uploaded
 * directly to storage via presigned URLs.
 *
 * Request: application/json with:
 * - videoUrl: Public URL of the uploaded video (required, must be allowed domain)
 * - thumbnailUrl: Public URL of the uploaded thumbnail (required, must be allowed domain)
 * - duration: Video duration in seconds (optional)
 * - width: Video width in pixels (optional)
 * - height: Video height in pixels (optional)
 * - size: Video file size in bytes (optional)
 * - contentType: Video MIME type (optional, validated against allowlist)
 *
 * Response:
 * - 200: Success with videoUrl, thumbnailUrl
 * - 400: Missing/invalid fields or disallowed URL domain
 * - 403: Unauthorized (via enhanceRouteHandler)
 * - 404: Shot or project not found
 * - 500: Database update failure
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

    logger.info(ctx, 'Processing shot video upload metadata');

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

    if (readFailed(shotError)) {
      throw new Error(whyNoRow(shotError, 'Shot not found'));
    }

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

    // 2. Parse and validate JSON body with Zod
    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch (error) {
      logger.error({ ...ctx, error }, 'Failed to parse JSON body');
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = UploadMetadataSchema.safeParse(rawBody);

    if (!parsed.success) {
      logger.warn(
        { ...ctx, errors: parsed.error.flatten() },
        'Request validation failed',
      );

      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const {
      videoUrl,
      thumbnailUrl,
      duration,
      width,
      height,
      size,
      contentType,
    } = parsed.data;

    // 3. Validate URLs belong to allowed storage domains (prevent SSRF/XSS)
    if (!isAllowedStorageUrl(videoUrl)) {
      logger.warn(
        { ...ctx, videoUrl },
        'Video URL rejected: not from an allowed storage domain',
      );

      return NextResponse.json(
        { error: 'videoUrl is not from an allowed storage domain' },
        { status: 400 },
      );
    }

    if (!isAllowedStorageUrl(thumbnailUrl)) {
      logger.warn(
        { ...ctx, thumbnailUrl },
        'Thumbnail URL rejected: not from an allowed storage domain',
      );

      return NextResponse.json(
        { error: 'thumbnailUrl is not from an allowed storage domain' },
        { status: 400 },
      );
    }

    // 4. Update shot with video and thumbnail URLs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (client as any)
      .from('shots')
      .update({
        video_url: videoUrl,
        thumbnail_url: thumbnailUrl,
        status: 'completed',
        updated_at: new Date().toISOString(),
        generation_metadata: {
          video_duration: duration ? parseFloat(duration) : null,
          video_width: width ? parseInt(width, 10) : null,
          video_height: height ? parseInt(height, 10) : null,
          video_size: size ?? null,
          video_content_type: contentType ?? null,
          uploaded_at: new Date().toISOString(),
        },
      })
      .eq('id', shotId)
      .select('id');

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update shot');
      return NextResponse.json(
        { error: 'Failed to update shot record' },
        { status: 500 },
      );
    }

    // KB-105: RLS answers a refused update with no rows and no error.
    if (!updated?.length) {
      logger.warn(ctx, 'Shot update matched no row the caller may change');
      return NextResponse.json(
        { error: "You can't change this shot." },
        { status: 403 },
      );
    }

    logger.info(ctx, 'Shot video upload completed successfully');

    // 5. Return success response
    return NextResponse.json({
      success: true,
      videoUrl,
      thumbnailUrl,
    });
  },
  { auth: true },
);
