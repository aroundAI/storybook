/**
 * Local Storage API Route
 *
 * Serves files from local storage when STORAGE_PROVIDER=local
 * This enables local-first development without cloud storage costs.
 *
 * Routes: GET /api/storage/[bucket]/[...path]
 */
import { NextResponse } from 'next/server';

import { existsSync, readFileSync } from 'fs';
import mime from 'mime-types';
import { join } from 'path';

import { homedir } from 'os';

// Default storage path - same as LocalStorageAdapter
// Expand ~ to home directory if present
const rawStoragePath = process.env.STORAGE_LOCAL_PATH || join(process.cwd(), '.storage');
const STORAGE_PATH = rawStoragePath.startsWith('~')
  ? rawStoragePath.replace('~', homedir())
  : rawStoragePath;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Check if local storage is enabled
  if (process.env.STORAGE_PROVIDER !== 'local') {
    return NextResponse.json(
      { error: 'Local storage is not enabled' },
      { status: 404 },
    );
  }

  const { path: pathSegments } = await params;

  if (!pathSegments || pathSegments.length < 2) {
    return NextResponse.json(
      { error: 'Invalid path. Expected: /api/storage/[bucket]/[...path]' },
      { status: 400 },
    );
  }

  // First segment is the bucket, rest is the file path
  const [bucket, ...filePath] = pathSegments;
  const fullPath = join(STORAGE_PATH, bucket!, filePath.join('/'));

  // Security: Prevent directory traversal
  const normalizedPath = join(STORAGE_PATH, bucket!, filePath.join('/'));
  if (!normalizedPath.startsWith(STORAGE_PATH)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Check if file exists
  if (!existsSync(fullPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  try {
    const file = readFileSync(fullPath);
    const mimeType = mime.lookup(fullPath) || 'application/octet-stream';

    return new NextResponse(file, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600, immutable',
      },
    });
  } catch (error) {
    console.error('Error reading file:', error);
    return NextResponse.json({ error: 'Error reading file' }, { status: 500 });
  }
}
