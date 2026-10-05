/**
 * Upload checksum route (KB-189)
 *
 * POST /api/storage/checksum
 * Body: { bucket, path, sha256, size }
 *
 * A browser upload goes straight to storage on a presigned URL, so the server
 * never holds its bytes. The browser hashes the file it just PUT and reports
 * it here; this records it for the edit package (FILM-2001), so StorybookStudio
 * can verify the download. Before recording, the route checks what it can
 * cheaply: the caller may write the key (the presign route's own rule,
 * KB-28), and the stored object exists with exactly the size reported (one
 * HEAD). Re-hashing the object would mean downloading it.
 *
 * The hash is the uploader's claim. Only a writer of the project can make
 * it, about a key that writer could already fill with any bytes, so a false
 * hash gives them nothing they did not have: a Studio download that fails
 * verification.
 */
import { NextResponse } from 'next/server';

import { z } from 'zod';

import { enhanceRouteHandler } from '@kit/next/routes';
import { getLogger } from '@kit/shared/logger';
import { canWriteProjectKey, getStorageAdapter } from '@kit/storage';
import { SHA256_HEX, recordMediaChecksum } from '@kit/storage/media-checksum';
import { PROJECT_ASSETS_BUCKET, isUploadPath } from '@kit/storage/upload-paths';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const ChecksumRequestSchema = z.object({
  bucket: z.literal(PROJECT_ASSETS_BUCKET),
  path: z.string().min(1),
  sha256: z.string().regex(SHA256_HEX),
  size: z.number().int().nonnegative(),
});

export const POST = enhanceRouteHandler(
  async ({ request, user }) => {
    const logger = await getLogger();
    const parsed = ChecksumRequestSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Expected bucket, path, sha256 and size' },
        { status: 400 },
      );
    }

    const { bucket, path, sha256, size } = parsed.data;
    const ctx = { name: 'upload-checksum', userId: user.id, bucket, path };
    const client = getSupabaseServerClient();

    if (!isUploadPath(bucket, path)) {
      return NextResponse.json(
        { error: 'Invalid storage path' },
        { status: 400 },
      );
    }

    if (!(await canWriteProjectKey(client, path))) {
      logger.warn(ctx, 'Upload checksum refused: not a writer of the key');
      return NextResponse.json(
        { error: 'You do not have permission to upload to this project' },
        { status: 403 },
      );
    }

    const stored = await getStorageAdapter(client).stat(bucket, path);

    if (!stored) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    if (stored.bytes !== size) {
      logger.warn(
        { ...ctx, size, stored: stored.bytes },
        'Upload checksum refused: the stored object is another size',
      );
      return NextResponse.json(
        { error: 'The stored file is not the file that was hashed' },
        { status: 409 },
      );
    }

    const recorded = await recordMediaChecksum(getSupabaseServerAdminClient(), {
      bucket,
      key: path,
      sha256: sha256.toLowerCase(),
      bytes: stored.bytes,
    });

    if (!recorded) {
      return NextResponse.json(
        { error: 'Could not record the checksum' },
        { status: 500 },
      );
    }

    return NextResponse.json({ recorded: true });
  },
  { auth: true },
);
