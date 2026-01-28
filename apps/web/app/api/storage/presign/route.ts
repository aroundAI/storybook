/**
 * Presigned URL API Route
 *
 * Generates presigned URLs for direct uploads to R2 storage.
 * This bypasses the Lambda 6MB payload limit by allowing clients
 * to upload directly to R2.
 *
 * POST /api/storage/presign
 * Body: { bucket, path, contentType, expiresIn? }
 *
 * Returns: { uploadUrl, publicUrl, expiresIn }
 */
import { NextRequest, NextResponse } from 'next/server';

import { getStorageAdapter } from '@kit/storage';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const MAX_EXPIRES_IN = 3600; // 1 hour max
const DEFAULT_EXPIRES_IN = 900; // 15 minutes default

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { bucket, path, contentType, expiresIn } = body;

    // Validate required fields
    if (!bucket || !path || !contentType) {
      return NextResponse.json(
        { error: 'Missing required fields: bucket, path, contentType' },
        { status: 400 },
      );
    }

    // Security: Validate path pattern to prevent path traversal
    // Expected pattern: projects/{projectId}/assets/{type}/{filename}
    const pathPattern = /^projects\/([a-f0-9-]+)\/assets\/(master_video|master_title_card|thumbnail|frame|video|audio|image)\/[a-f0-9-]+\.[a-z0-9]+$/i;
    const pathMatch = path.match(pathPattern);

    if (!pathMatch) {
      return NextResponse.json(
        { error: 'Invalid storage path format' },
        { status: 400 },
      );
    }

    // Security: Verify user has access to the project
    const projectId = pathMatch[1];
    const { data: projectAccess, error: accessError } = await client
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .single();

    if (accessError || !projectAccess) {
      return NextResponse.json(
        { error: 'Access denied to project' },
        { status: 403 },
      );
    }

    // Validate content type
    const allowedPrefixes = ['video/', 'audio/', 'image/', 'application/'];
    const isAllowed = allowedPrefixes.some((prefix) =>
      contentType.toLowerCase().startsWith(prefix),
    );

    if (!isAllowed) {
      return NextResponse.json(
        { error: `Content type not allowed: ${contentType}` },
        { status: 400 },
      );
    }

    // Validate expiresIn
    const exp = Math.min(
      Math.max(60, expiresIn || DEFAULT_EXPIRES_IN),
      MAX_EXPIRES_IN,
    );

    // Get storage adapter (will be R2 in production)
    const storage = getStorageAdapter(client);

    // Generate presigned URL
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
    console.error('[Presign URL] Error:', error);

    // Check if presigned URLs aren't supported
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
