/**
 * Video Upload API Route
 *
 * Handles video file uploads for the Publishing Studio.
 * Uses the configured storage adapter (local or cloud).
 */
import { NextRequest, NextResponse } from 'next/server';

import { getStorageAdapter } from '@kit/storage';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const episodeId = formData.get('episodeId') as string | null;
    const language = formData.get('language') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!episodeId || !language) {
      return NextResponse.json(
        { error: 'Missing episodeId or language' },
        { status: 400 },
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        },
        { status: 400 },
      );
    }

    // Get storage adapter (respects STORAGE_PROVIDER env var)
    const storage = getStorageAdapter(client);

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'mp4';
    const timestamp = Date.now();
    const filename = `${language}-${timestamp}.${ext}`;
    const path = `episodes/${episodeId}/videos/${filename}`;

    // Read file as buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to storage (using project-assets bucket which exists)
    const result = await storage.upload('project-assets', path, buffer, {
      contentType: file.type,
      upsert: true,
    });

    return NextResponse.json({
      success: true,
      url: result.url,
      path: result.path,
    });
  } catch (error) {
    console.error('[Video Upload] Error:', error);
    return NextResponse.json(
      { error: 'Failed to upload video' },
      { status: 500 },
    );
  }
}
