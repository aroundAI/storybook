/**
 * Presigned URL API Route
 *
 * Generates presigned URLs for direct uploads, so large files bypass the
 * Lambda payload limit.
 *
 * POST /api/storage/presign
 * Body: { bucket, path, contentType, size, expiresIn? }
 *
 * Returns: { uploadUrl, publicUrl, expiresIn, headers }
 *
 * This route is the write gate for every provider. On Supabase the bucket
 * policies check the same rule again when the URL is signed; on R2 nothing
 * else checks it, because an R2 presigned URL is signed with the app's own
 * credentials (KB-28).
 *
 * Two buckets are signed: `project-assets` for project writers (KB-28) and
 * `account_image` for an account's own picture (KB-53).
 *
 * On R2 the URL is signed for the declared type and exact byte count
 * (KB-38), so the storage refuses a PUT that sends anything else. The PUT
 * must carry `headers` exactly; the browser sets Content-Length from the
 * body, which must be `size` bytes. On Supabase the bucket's own type and
 * size limits apply to the PUT instead.
 */
import { NextRequest, NextResponse } from 'next/server';

import { z } from 'zod';

import {
  ALLOWED_PROJECT_ASSET_TYPES,
  UPLOAD_CONSTRAINTS,
  type UploadCategory,
  uploadCategoryForType,
} from '@kit/assets/upload-validation';
import { getLogger } from '@kit/shared/logger';
import { canWriteProjectKey, getStorageAdapter } from '@kit/storage';
import {
  ACCOUNT_IMAGE_BUCKET,
  PROJECT_ASSETS_BUCKET,
  type UploadBucket,
  isUploadBucket,
  isUploadPath,
} from '@kit/storage/upload-paths';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { Database } from '~/lib/database.types';

const MAX_EXPIRES_IN = 3600; // 1 hour max
const DEFAULT_EXPIRES_IN = 900; // 15 minutes default

type ServerClient = ReturnType<typeof getSupabaseServerClient<Database>>;

async function canWriteAccountImage(client: ServerClient, path: string) {
  const { data, error } = await client.rpc('can_write_account_image', {
    path,
  });

  if (error) {
    throw error;
  }

  return data === true;
}

/**
 * The buckets the app's uploaders send, and what each admits. On R2 each
 * bucket is a key prefix inside `R2_BUCKET_NAME`; on Supabase, a bucket.
 * The path shapes live in `@kit/storage/upload-paths`, beside the builders
 * that produce them (KB-39, KB-53).
 *
 * `canWrite` is the SQL rule the bucket's own policy applies, asked as the
 * caller: project writers for project-assets (KB-28, through the one check
 * every server-side write uses, KB-57); for account_image, the
 * account itself or a member with `settings.manage` (KB-53). `upsert` lets
 * the URL replace an existing object: only avatars, which keep one key per
 * account.
 */
const BUCKET_RULES: Record<
  UploadBucket,
  {
    types: readonly string[];
    canWrite: (client: ServerClient, path: string) => Promise<boolean>;
    upsert: boolean;
  }
> = {
  [PROJECT_ASSETS_BUCKET]: {
    types: ALLOWED_PROJECT_ASSET_TYPES,
    canWrite: canWriteProjectKey,
    upsert: false,
  },
  [ACCOUNT_IMAGE_BUCKET]: {
    types: UPLOAD_CONSTRAINTS.image.allowedTypes,
    canWrite: canWriteAccountImage,
    upsert: true,
  },
};

const PresignRequestSchema = z.object({
  bucket: z.string().min(1),
  path: z.string().min(1),
  contentType: z.string().min(1),
  /** Exact byte length of the body the PUT will send (KB-38) */
  size: z.number().int().positive(),
  expiresIn: z.number().optional(),
});

const CATEGORY_NOUN: Record<UploadCategory, string> = {
  image: 'images',
  video: 'videos',
  audio: 'audio files',
  captions: 'caption files',
};

function megabytes(bytes: number) {
  const mb = bytes / (1024 * 1024);

  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
}

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
        { error: 'Missing required fields: bucket, path, contentType, size' },
        { status: 400 },
      );
    }

    const { bucket, path, size, expiresIn } = parsed.data;
    const contentType = parsed.data.contentType.toLowerCase();
    const refuse = (reason: string, error: string, status: number) => {
      logger.warn(
        { userId: user.id, bucket, path, contentType, size, reason },
        'Presign refused',
      );
      return NextResponse.json({ error }, { status });
    };

    if (!isUploadBucket(bucket)) {
      return refuse('bucket', `Bucket not allowed: ${bucket}`, 400);
    }

    const rule = BUCKET_RULES[bucket];

    if (!isUploadPath(bucket, path)) {
      return refuse('path', 'Invalid storage path format', 400);
    }

    const category = uploadCategoryForType(contentType);

    if (!rule.types.includes(contentType) || !category) {
      return refuse('type', `Content type not allowed: ${contentType}`, 400);
    }

    const maxSize = UPLOAD_CONSTRAINTS[category].maxSize;

    if (size > maxSize) {
      return refuse(
        'size',
        `File is ${megabytes(size)} MB; ${CATEGORY_NOUN[category]} may be at most ${megabytes(maxSize)} MB`,
        400,
      );
    }

    // The same rule the bucket's policies apply. For a project: owner, admin
    // or member of the project the path names; being able to read a public
    // project is not enough.
    if (!(await rule.canWrite(client, path))) {
      return bucket === ACCOUNT_IMAGE_BUCKET
        ? refuse(
            'account-image-not-owner',
            'You do not have permission to change this picture',
            403,
          )
        : refuse(
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

    const result = await storage.getSignedUploadUrl(bucket, path, {
      contentType,
      contentLength: size,
      expiresIn: exp,
      ...(rule.upsert && { upsert: true }),
    });

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      publicUrl: result.publicUrl,
      expiresIn: result.expiresIn,
      headers: result.headers,
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
