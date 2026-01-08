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

import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getStorageAdapter } from '@kit/storage';

const MAX_EXPIRES_IN = 3600; // 1 hour max
const DEFAULT_EXPIRES_IN = 900; // 15 minutes default

export async function POST(request: NextRequest) {
    try {
        // Auth check
        const client = getSupabaseServerClient();
        const { data: user, error: authError } = await requireUser(client);

        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Parse request body
        const body = await request.json();
        const { bucket, path, contentType, expiresIn } = body;

        // Validate required fields
        if (!bucket || !path || !contentType) {
            return NextResponse.json(
                { error: 'Missing required fields: bucket, path, contentType' },
                { status: 400 }
            );
        }

        // Validate content type
        const allowedPrefixes = ['video/', 'audio/', 'image/', 'application/'];
        const isAllowed = allowedPrefixes.some(prefix =>
            contentType.toLowerCase().startsWith(prefix)
        );

        if (!isAllowed) {
            return NextResponse.json(
                { error: `Content type not allowed: ${contentType}` },
                { status: 400 }
            );
        }

        // Validate expiresIn
        const exp = Math.min(
            Math.max(60, expiresIn || DEFAULT_EXPIRES_IN),
            MAX_EXPIRES_IN
        );

        // Get storage adapter (will be R2 in production)
        const storage = getStorageAdapter(client);

        // Generate presigned URL
        const result = await storage.getSignedUploadUrl(
            bucket,
            path,
            contentType,
            exp
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
                { status: 501 }
            );
        }

        return NextResponse.json(
            { error: 'Failed to generate presigned URL' },
            { status: 500 }
        );
    }
}
