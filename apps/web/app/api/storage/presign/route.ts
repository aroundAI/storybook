/**
 * Presigned URL API Route
 *
 * Generates presigned URLs for direct uploads, so large files bypass the
 * Lambda payload limit.
 *
 * POST /api/storage/presign
 * Body: { bucket, path, contentType, expiresIn? }
 *
 * Returns: { uploadUrl, publicUrl, expiresIn }
 *
 * This route is the write gate for every provider. On Supabase the bucket
 * policies check the same rule again when the URL is signed; on R2 nothing
 * else checks it, because an R2 presigned URL is signed with the app's own
 * credentials (KB-28). Binding the content length into the R2 signature is
 * KB-38.
 */
import { NextRequest, NextResponse } from 'next/server';

import { z } from 'zod';

import { PROJECT_ASSETS_BUCKET } from '@kit/assets/lib';
import { ALLOWED_PROJECT_ASSET_TYPES } from '@kit/assets/upload-validation';
import { EXPORT_UPLOAD_BUCKET } from '@kit/edit-suite/export-upload';
import { getLogger } from '@kit/shared/logger';
import { getStorageAdapter } from '@kit/storage';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const MAX_EXPIRES_IN = 3600; // 1 hour max
const DEFAULT_EXPIRES_IN = 900; // 15 minutes default

/**
 * The buckets the app's uploaders send. On R2 each is a key prefix inside
 * `R2_BUCKET_NAME`; on Supabase each is a bucket.
 */
const ALLOWED_BUCKETS: ReadonlySet<string> = new Set([
  PROJECT_ASSETS_BUCKET,
  EXPORT_UPLOAD_BUCKET,
]);

/**
 * The path shapes the uploaders write, each naming its project:
 *   projects/{projectId}/assets/{type}/{filename}
 *   projects/{projectId}/shots/{shotId}/{type}/{filename}
 *   episodes/{episodeId}/{type}/{filename}
 * A filename may hold `_`: `sanitizeFilename` emits it and the export dialog
 * names files `export_en_<ts>.mp4`. Before KB-28 it could not, so every
 * export and every underscore-named shot video was refused here. Traversal
 * stays impossible: no segment may contain `/` or be empty, and no `..`
 * may appear anywhere.
 */
const PATH_PATTERN =
  /^(?!.*\.\.)(?:projects\/[a-f0-9-]+\/(?:assets|shots\/[a-f0-9-]+)|episodes\/[a-f0-9-]+)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/i;

const PresignRequestSchema = z.object({
  bucket: z.string().min(1),
  path: z.string().min(1),
  contentType: z.string().min(1),
  expiresIn: z.number().optional(),
});

export async function POST(request: NextRequest) {
  const logger = await getLogger();

  try {
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = PresignRequestSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Missing required fields: bucket, path, contentType' },
        { status: 400 },
      );
    }

    const { bucket, path, contentType, expiresIn } = parsed.data;
    const refuse = (reason: string, error: string, status: number) => {
      logger.warn({ userId: user.id, bucket, path, reason }, 'Presign refused');
      return NextResponse.json({ error }, { status });
    };

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return refuse('bucket', `Bucket not allowed: ${bucket}`, 400);
    }

    if (!PATH_PATTERN.test(path)) {
      return refuse('path', 'Invalid storage path format', 400);
    }

    if (!ALLOWED_PROJECT_ASSET_TYPES.includes(contentType.toLowerCase())) {
      return refuse('type', `Content type not allowed: ${contentType}`, 400);
    }

    // The same rule the project-assets bucket policies apply: owner, admin
    // or member of the project the path names. Being able to read a public
    // project is not enough.
    const { data: canWrite, error: permissionError } = await client.rpc(
      'can_write_project_storage',
      { path },
    );

    if (permissionError) {
      throw permissionError;
    }

    if (!canWrite) {
      return refuse(
        'not-a-writer',
        'You do not have permission to upload to this project',
        403,
      );
    }

    const exp = Math.min(
      Math.max(60, expiresIn || DEFAULT_EXPIRES_IN),
      MAX_EXPIRES_IN,
    );

    const storage = getStorageAdapter(client);

    const result = await storage.getSignedUploadUrl(
      bucket,
      path,
      contentType,
      exp,
    );

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      publicUrl: result.publicUrl,
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    logger.error({ error }, 'Presign URL error');

    if (error instanceof Error && error.message.includes('presigned')) {
      return NextResponse.json(
        { error: 'Presigned URLs not supported by current storage provider' },
        { status: 501 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to generate presigned URL' },
      { status: 500 },
    );
  }
}
