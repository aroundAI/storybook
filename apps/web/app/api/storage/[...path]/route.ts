/**
 * Local Storage API Route
 *
 * Serves files from local storage when STORAGE_PROVIDER=local
 * This enables local-first development without cloud storage costs.
 *
 * Routes: GET/HEAD /api/storage/[bucket]/[...path]
 */
import { NextResponse } from 'next/server';

import { existsSync, readFileSync, statSync } from 'fs';
import mime from 'mime-types';
import { homedir } from 'os';
import { join } from 'path';

// Default storage path - same as LocalStorageAdapter
// Expand ~ to home directory if present
const rawStoragePath =
  process.env.STORAGE_LOCAL_PATH || join(process.cwd(), '.storage');
const STORAGE_PATH = rawStoragePath.startsWith('~')
  ? rawStoragePath.replace('~', homedir())
  : rawStoragePath;

function getFilePath(pathSegments: string[]): {
  fullPath: string;
  error?: string;
} {
  if (!pathSegments || pathSegments.length < 2) {
    return {
      fullPath: '',
      error: 'Invalid path. Expected: /api/storage/[bucket]/[...path]',
    };
  }

  const [bucket, ...filePath] = pathSegments;
  const fullPath = join(STORAGE_PATH, bucket!, filePath.join('/'));

  // Security: Prevent directory traversal
  const normalizedPath = join(STORAGE_PATH, bucket!, filePath.join('/'));
  if (!normalizedPath.startsWith(STORAGE_PATH)) {
    return { fullPath: '', error: 'Invalid path' };
  }

  return { fullPath };
}

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
  const { fullPath, error } = getFilePath(pathSegments);

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  // Check if file exists
  if (!existsSync(fullPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  try {
    const file = readFileSync(fullPath);
    const stats = statSync(fullPath);
    const mimeType = mime.lookup(fullPath) || 'application/octet-stream';

    return new NextResponse(file, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=3600, immutable',
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error) {
    console.error('Error reading file:', error);
    return NextResponse.json({ error: 'Error reading file' }, { status: 500 });
  }
}

// HEAD handler for platforms that check file size before download
export async function HEAD(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (process.env.STORAGE_PROVIDER !== 'local') {
    return new NextResponse(null, { status: 404 });
  }

  const { path: pathSegments } = await params;
  const { fullPath, error } = getFilePath(pathSegments);

  if (error) {
    return new NextResponse(null, { status: 400 });
  }

  if (!existsSync(fullPath)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const stats = statSync(fullPath);
    const mimeType = mime.lookup(fullPath) || 'application/octet-stream';

    return new NextResponse(null, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': stats.size.toString(),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
