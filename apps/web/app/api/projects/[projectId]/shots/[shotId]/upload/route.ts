import { NextResponse } from 'next/server';

import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * POST /api/projects/[projectId]/shots/[shotId]/upload
 *
 * Update a shot record after video and thumbnail have been uploaded
 * directly to storage via presigned URLs.
 *
 * Request: application/json with:
 * - videoUrl: Public URL of the uploaded video (required)
 * - thumbnailUrl: Public URL of the uploaded thumbnail (required)
 * - duration: Video duration in seconds (optional)
 * - width: Video width in pixels (optional)
 * - height: Video height in pixels (optional)
 * - size: Video file size in bytes (optional)
 * - contentType: Video MIME type (optional)
 *
 * Response:
 * - 200: Success with videoUrl, thumbnailUrl
 * - 400: Missing required fields
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

    // 2. Parse JSON body
    let body: {
      videoUrl?: string;
      thumbnailUrl?: string;
      duration?: string;
      width?: string;
      height?: string;
      size?: number;
      contentType?: string;
    };

    try {
      body = (await request.json()) as typeof body;
    } catch (error) {
      logger.error({ ...ctx, error }, 'Failed to parse JSON body');
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const { videoUrl, thumbnailUrl, duration, width, height, size, contentType } = body;

    if (!videoUrl) {
      return NextResponse.json(
        { error: 'videoUrl is required' },
        { status: 400 },
      );
    }

    if (!thumbnailUrl) {
      return NextResponse.json(
        { error: 'thumbnailUrl is required' },
        { status: 400 },
      );
    }

    // 3. Update shot with video and thumbnail URLs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (client as any)
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
      .eq('id', shotId);

    if (updateError) {
      logger.error({ ...ctx, error: updateError }, 'Failed to update shot');
      return NextResponse.json(
        { error: 'Failed to update shot record' },
        { status: 500 },
      );
    }

    logger.info(ctx, 'Shot video upload completed successfully');

    // 4. Return success response
    return NextResponse.json({
      success: true,
      videoUrl,
      thumbnailUrl,
    });
  },
  { auth: true },
);
