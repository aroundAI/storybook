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

import { getLogger } from '@kit/shared/logger';
import { getStorageAdapter } from '@kit/storage';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const MAX_EXPIRES_IN = 3600; // 1 hour max
const DEFAULT_EXPIRES_IN = 900; // 15 minutes default

export async function POST(request: NextRequest) {
  const logger = await getLogger();

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
    // Expected pattern: 
    // 1. projects/{projectId}/assets/{type}/{filename}
    // 2. episodes/{episodeId}/{category}/{filename}
    const ALLOWED_ASSET_TYPES = [
      'master_video',
      'master_title_card',
      'thumbnail',
      'frame',
      'video',
      'audio',
      'image',
      'thumbnails', // Added for legacy/episode paths
      'videos',     // Added for legacy/episode paths
    ];

    // Regex explanation:
    // ^projects\/([a-f0-9-]+)\/assets\/ -> Matches projects/{uuid}/assets/
    // ^episodes\/([a-f0-9-]+)\/ -> Matches episodes/{uuid}/
    // ^projects\/([a-f0-9-]+)\/shots\/([a-f0-9-]+)\/ -> Matches projects/{uuid}/shots/{uuid}/
    // ([a-zA-Z0-9_-]+) -> Matches asset type / category
    // \/[a-zA-Z0-9-.]+$ -> Matches filename

    // We need to handle three main cases:
    // 1. Project Assets: projects/{projectId}/assets/{type}/{filename}
    // 2. Episode Assets: episodes/{episodeId}/{type}/{filename}
    // 3. Shot Assets: projects/{projectId}/shots/{shotId}/{type}/{filename}

    const pathPattern = new RegExp(
      `^(?:projects\\/([a-f0-9-]+)\\/(?:assets|shots\\/[a-f0-9-]+)|episodes\\/([a-f0-9-]+))\\/([a-zA-Z0-9_-]+)\\/[a-zA-Z0-9-.]+$`,
      'i'
    );

    const pathMatch = path.match(pathPattern);

    if (!pathMatch) {
      return NextResponse.json(
        { error: 'Invalid storage path format' },
        { status: 400 },
      );
    }

    // Security: Verify user has access to the project
    // pathMatch[1] is projectId (if projects/ path)
    // pathMatch[2] is episodeId (if episodes/ path)
    const projectIdFromPath = pathMatch[1];
    const episodeIdFromPath = pathMatch[2];

    let projectIdToCheck = projectIdFromPath;

    // If we have an episode ID, we need to find its project ID
    if (episodeIdFromPath) {
      const { data: episode, error: episodeError } = await client
        .from('episodes')
        .select('project_id')
        .eq('id', episodeIdFromPath)
        .single();

      if (episodeError || !episode) {
        return NextResponse.json(
          { error: 'Invalid episode ID or access denied' },
          { status: 403 },
        );
      }

      projectIdToCheck = episode.project_id;
    }

    if (!projectIdToCheck) {
      return NextResponse.json(
        { error: 'Could not determine project context' },
        { status: 400 },
      );
    }

    const { data: projectAccess, error: accessError } = await client
      .from('projects')
      .select('id')
      .eq('id', projectIdToCheck)
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
    logger.error({ error }, 'Presign URL error');

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
