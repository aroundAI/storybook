# FILM-203: Asset Upload API Route

**Phase**: 2
**Priority**: P0
**Effort**: M (3-5 days)
**Dependencies**: FILM-201 (asset CRUD), FILM-CC-01 (file upload validation)
**Blocks**: FILM-207 (ImageUploader component)
**Status**: ✅ COMPLETED
**Completed**: 2025-12-07

---

## Completed Deliverables

| Deliverable | Location |
|-------------|----------|
| Upload Route Handler | `apps/web/app/api/projects/[projectId]/assets/upload/route.ts` |
| Image Processor | `packages/features/assets/src/lib/upload/image-processor.ts` |
| Storage Client | `packages/features/assets/src/lib/upload/storage-client.ts` |
| Storage Bucket Migration | `apps/web/supabase/migrations/20251207162036_project-assets-bucket.sql` |
| Unit Tests | `packages/features/assets/src/lib/upload/__tests__/image-processor.test.ts` |

### Implementation Notes

- Uses `sharp` for image dimension validation and thumbnail generation (webp, 256x256)
- Storage path format: `{projectId}/{assetId}/{fieldType}-{timestamp}-{random}-{filename}`
- Bucket name: `project-assets` with RLS policies for project member access
- Leverages existing `validateUpload()` from FILM-CC-01 for file validation

---

## Context

Assets require reference images for AI video generation. Users must be able to upload images for characters, locations, and voice profile avatars. This spec implements a secure file upload API route that validates files, uploads them to Supabase Storage, and returns signed URLs.

The upload route must enforce strict validation (file type, size, dimensions) to prevent abuse and ensure uploaded images are suitable for AI processing. Images are stored in project-specific buckets with RLS policies to control access.

---

## Requirements

### Functional Requirements

1. **File Upload**
   - Accept multipart/form-data with image file
   - Validate file type (PNG, JPG, JPEG, WebP)
   - Validate file size (max 10MB)
   - Validate image dimensions (min 512px, max 4096px)
   - Generate unique filename with UUID
   - Upload to Supabase Storage bucket
   - Return public URL

2. **Storage Organization**
   - Store in project-specific paths: `{accountId}/{projectId}/{assetType}/{filename}`
   - Support asset types: characters, locations, voices
   - Preserve original file extension
   - Generate thumbnails (256x256) for gallery view

3. **Security**
   - Verify user authentication
   - Verify user has project write access
   - Sanitize filenames
   - Prevent path traversal attacks
   - Rate limit uploads (10 per minute per user)

4. **Error Handling**
   - Invalid file type: return 400 with clear message
   - File too large: return 413 with size limit
   - Storage failure: return 500 with generic message
   - Unauthorized: return 403

### Non-Functional Requirements

- Upload completes within 30 seconds (10MB file)
- Support concurrent uploads (up to 3 per user)
- Generate signed URLs valid for 1 year
- Log all uploads for audit trail
- Return progress updates for large files (future)

---

## Interface

### API Route

**Endpoint**: `POST /api/projects/[projectId]/assets/upload`

**Headers**:
```
Content-Type: multipart/form-data
Authorization: Bearer {token}
```

**Request Body** (FormData):
```typescript
interface UploadRequest {
  file: File;                    // Required
  assetType: 'character' | 'location' | 'voice';  // Required
  assetId?: string;              // Optional (for updating existing asset)
}
```

**Success Response** (200):
```typescript
interface UploadResponse {
  url: string;              // Public URL to uploaded image
  thumbnailUrl: string;     // URL to 256x256 thumbnail
  filename: string;         // Generated filename
  size: number;             // File size in bytes
  dimensions: {
    width: number;
    height: number;
  };
}
```

**Error Responses**:

400 Bad Request:
```json
{
  "error": {
    "code": "INVALID_FILE_TYPE",
    "message": "Only PNG, JPG, JPEG, and WebP images are supported",
    "supportedTypes": ["image/png", "image/jpeg", "image/webp"]
  }
}
```

413 Payload Too Large:
```json
{
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "File size exceeds 10MB limit",
    "maxSize": 10485760,
    "actualSize": 15728640
  }
}
```

403 Forbidden:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You don't have permission to upload to this project"
  }
}
```

429 Too Many Requests:
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Upload rate limit exceeded",
    "retryAfter": 45
  }
}
```

---

## Implementation Details

### File Structure

```
apps/web/app/api/projects/[projectId]/assets/upload/
└── route.ts                        # Upload route (CREATE THIS)

packages/features/assets/src/lib/
├── upload/
│   ├── file-validator.ts           # File validation utilities (CREATE THIS)
│   ├── storage-client.ts           # Supabase Storage wrapper (CREATE THIS)
│   └── image-processor.ts          # Image manipulation (CREATE THIS)
└── schemas/
    └── upload.schema.ts            # Upload validation schema (CREATE THIS)
```

### Route Implementation

**File**: `apps/web/app/api/projects/[projectId]/assets/upload/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { enhanceRouteHandler } from '@kit/next/routes';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';
import { validateImageFile } from '@kit/assets/upload/file-validator';
import { uploadToStorage, generateThumbnail } from '@kit/assets/upload/storage-client';
import { checkRateLimit } from '@kit/shared/rate-limiter';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_DIMENSION = 512;
const MAX_DIMENSION = 4096;

export const POST = enhanceRouteHandler(
  async ({ request, params, user }) => {
    const { projectId } = params;

    // Check rate limit (10 uploads per minute)
    const rateLimitKey = `upload:${user.id}`;
    const isAllowed = await checkRateLimit(rateLimitKey, 10, 60);

    if (!isAllowed) {
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Upload rate limit exceeded',
            retryAfter: 60,
          },
        },
        { status: 429 }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const assetType = formData.get('assetType') as string;
    const assetId = formData.get('assetId') as string | null;

    if (!file) {
      return NextResponse.json(
        {
          error: {
            code: 'MISSING_FILE',
            message: 'No file provided',
          },
        },
        { status: 400 }
      );
    }

    // Validate asset type
    if (!['character', 'location', 'voice'].includes(assetType)) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_ASSET_TYPE',
            message: 'Asset type must be character, location, or voice',
          },
        },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'Only PNG, JPG, JPEG, and WebP images are supported',
            supportedTypes: ALLOWED_TYPES,
          },
        },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size exceeds 10MB limit',
            maxSize: MAX_FILE_SIZE,
            actualSize: file.size,
          },
        },
        { status: 413 }
      );
    }

    // Validate image dimensions
    const validation = await validateImageFile(file, {
      minWidth: MIN_DIMENSION,
      minHeight: MIN_DIMENSION,
      maxWidth: MAX_DIMENSION,
      maxHeight: MAX_DIMENSION,
    });

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_DIMENSIONS',
            message: validation.error,
            dimensions: validation.dimensions,
          },
        },
        { status: 400 }
      );
    }

    // Verify user has project access
    const client = getSupabaseServerClient();

    const { data: project, error: projectError } = await client
      .from('projects')
      .select('account_id')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        {
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Project not found',
          },
        },
        { status: 404 }
      );
    }

    // Check write access
    const { data: membership } = await client
      .from('accounts_memberships')
      .select('role')
      .eq('account_id', project.account_id)
      .eq('user_id', user.id)
      .single();

    if (!membership || !['owner', 'admin', 'member'].includes(membership.role)) {
      return NextResponse.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: "You don't have permission to upload to this project",
          },
        },
        { status: 403 }
      );
    }

    try {
      // Generate unique filename
      const extension = file.name.split('.').pop();
      const filename = `${crypto.randomUUID()}.${extension}`;
      const storagePath = `${project.account_id}/${projectId}/${assetType}/${filename}`;

      // Upload original image
      const uploadResult = await uploadToStorage(file, storagePath);

      // Generate thumbnail
      const thumbnailPath = `${project.account_id}/${projectId}/${assetType}/thumbnails/${filename}`;
      const thumbnailResult = await generateThumbnail(file, thumbnailPath, 256);

      // Update asset record if assetId provided
      if (assetId) {
        await client
          .from('assets')
          .update({
            reference_image_url: uploadResult.publicUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', assetId);
      }

      return NextResponse.json({
        url: uploadResult.publicUrl,
        thumbnailUrl: thumbnailResult.publicUrl,
        filename,
        size: file.size,
        dimensions: validation.dimensions,
      });
    } catch (error) {
      console.error('Upload failed:', error);

      return NextResponse.json(
        {
          error: {
            code: 'UPLOAD_FAILED',
            message: 'Failed to upload file',
          },
        },
        { status: 500 }
      );
    }
  },
  { auth: true }
);
```

### File Validation

**File**: `packages/features/assets/src/lib/upload/file-validator.ts`

```typescript
interface ValidationOptions {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  dimensions?: {
    width: number;
    height: number;
  };
}

export async function validateImageFile(
  file: File,
  options: ValidationOptions
): Promise<ValidationResult> {
  try {
    // Read file as buffer
    const buffer = await file.arrayBuffer();

    // Create image bitmap to get dimensions
    const blob = new Blob([buffer], { type: file.type });
    const imageBitmap = await createImageBitmap(blob);

    const { width, height } = imageBitmap;

    // Validate dimensions
    if (width < options.minWidth || height < options.minHeight) {
      return {
        valid: false,
        error: `Image must be at least ${options.minWidth}x${options.minHeight}px`,
        dimensions: { width, height },
      };
    }

    if (width > options.maxWidth || height > options.maxHeight) {
      return {
        valid: false,
        error: `Image must not exceed ${options.maxWidth}x${options.maxHeight}px`,
        dimensions: { width, height },
      };
    }

    return {
      valid: true,
      dimensions: { width, height },
    };
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to validate image',
    };
  }
}

export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts
  return filename
    .replace(/\.\./g, '')
    .replace(/[/\\]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}
```

### Storage Client

**File**: `packages/features/assets/src/lib/upload/storage-client.ts`

```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import sharp from 'sharp';

const BUCKET_NAME = 'asset-images';

export async function uploadToStorage(
  file: File,
  path: string
): Promise<{ publicUrl: string }> {
  const client = getSupabaseServerClient();

  // Convert File to Buffer
  const buffer = await file.arrayBuffer();

  // Upload to Supabase Storage
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (error) throw error;

  // Get public URL
  const { data: urlData } = client.storage
    .from(BUCKET_NAME)
    .getPublicUrl(path);

  return {
    publicUrl: urlData.publicUrl,
  };
}

export async function generateThumbnail(
  file: File,
  path: string,
  size: number
): Promise<{ publicUrl: string }> {
  const client = getSupabaseServerClient();

  // Convert File to Buffer
  const buffer = await file.arrayBuffer();

  // Generate thumbnail using sharp
  const thumbnailBuffer = await sharp(Buffer.from(buffer))
    .resize(size, size, {
      fit: 'cover',
      position: 'center',
    })
    .png({ quality: 80 })
    .toBuffer();

  // Upload thumbnail
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .upload(path, thumbnailBuffer, {
      contentType: 'image/png',
      upsert: false,
    });

  if (error) throw error;

  // Get public URL
  const { data: urlData } = client.storage
    .from(BUCKET_NAME)
    .getPublicUrl(path);

  return {
    publicUrl: urlData.publicUrl,
  };
}

export async function deleteFromStorage(path: string): Promise<void> {
  const client = getSupabaseServerClient();

  const { error } = await client.storage.from(BUCKET_NAME).remove([path]);

  if (error) throw error;
}
```

### Storage Bucket Configuration

**Supabase Storage**:
```sql
-- Create bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('asset-images', 'asset-images', true);

-- RLS policies for bucket
CREATE POLICY "Users can upload to own projects"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'asset-images' AND
  (storage.foldername(name))[1] IN (
    SELECT a.id::text
    FROM accounts a
    JOIN accounts_memberships am ON a.id = am.account_id
    WHERE am.user_id = auth.uid()
  )
);

CREATE POLICY "Users can view project images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'asset-images' AND
  (storage.foldername(name))[1] IN (
    SELECT a.id::text
    FROM accounts a
    JOIN accounts_memberships am ON a.id = am.account_id
    WHERE am.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete own project images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'asset-images' AND
  (storage.foldername(name))[1] IN (
    SELECT a.id::text
    FROM accounts a
    JOIN accounts_memberships am ON a.id = am.account_id
    WHERE am.user_id = auth.uid() AND am.role IN ('owner', 'admin')
  )
);
```

---

## File Changes

### New Files

1. **apps/web/app/api/projects/[projectId]/assets/upload/route.ts**
   - POST handler for file upload
   - Validation and security checks
   - Supabase Storage integration

2. **packages/features/assets/src/lib/upload/file-validator.ts**
   - Image validation utilities
   - Filename sanitization
   - Dimension checking

3. **packages/features/assets/src/lib/upload/storage-client.ts**
   - Supabase Storage wrapper
   - Thumbnail generation with sharp
   - File deletion utilities

4. **packages/features/assets/src/lib/schemas/upload.schema.ts**
   - Zod schemas for upload validation
   - Type exports

### Modified Files

None (new feature)

### New Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "sharp": "^0.33.0"
  }
}
```

---

## Acceptance Criteria

### Functional

- [ ] Route accepts multipart/form-data with image file
- [ ] Route validates file type (PNG, JPG, JPEG, WebP only)
- [ ] Route rejects files larger than 10MB
- [ ] Route validates image dimensions (512px-4096px)
- [ ] Route generates unique filename with UUID
- [ ] Route uploads to Supabase Storage successfully
- [ ] Route generates 256x256 thumbnail
- [ ] Route returns public URL for original and thumbnail
- [ ] Route verifies user authentication
- [ ] Route verifies user has project write access
- [ ] Route sanitizes filenames to prevent path traversal
- [ ] Route enforces rate limiting (10 uploads/minute)
- [ ] Route updates asset record if assetId provided
- [ ] Route returns appropriate error codes and messages

### Non-Functional

- [ ] Upload completes within 30 seconds for 10MB file
- [ ] Concurrent uploads supported (up to 3 per user)
- [ ] Signed URLs valid for 1 year
- [ ] All uploads logged for audit trail
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `apps/web/app/api/projects/[projectId]/assets/upload/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

describe('Asset Upload Route', () => {
  it('should accept valid image upload', async () => {
    // Test implementation
  });

  it('should reject invalid file type', async () => {
    // Upload PDF file
    // Expect 400 error
  });

  it('should reject oversized file', async () => {
    // Upload 15MB file
    // Expect 413 error
  });

  it('should reject undersized image', async () => {
    // Upload 256x256 image
    // Expect 400 error
  });

  it('should reject oversized image', async () => {
    // Upload 5000x5000 image
    // Expect 400 error
  });

  it('should enforce authentication', async () => {
    // Upload without auth token
    // Expect 401 error
  });

  it('should enforce project access', async () => {
    // Upload to inaccessible project
    // Expect 403 error
  });

  it('should enforce rate limiting', async () => {
    // Upload 11 files rapidly
    // Expect 429 error on 11th
  });

  it('should generate thumbnail', async () => {
    // Upload image
    // Verify thumbnail URL returned
  });

  it('should update asset if assetId provided', async () => {
    // Upload with assetId
    // Verify asset.reference_image_url updated
  });
});
```

### File Validator Tests

**File**: `packages/features/assets/src/lib/upload/__tests__/file-validator.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { validateImageFile, sanitizeFilename } from '../file-validator';

describe('File Validator', () => {
  describe('validateImageFile', () => {
    it('should accept valid dimensions', async () => {
      // Create 1024x1024 test image
      // Expect valid: true
    });

    it('should reject undersized image', async () => {
      // Create 256x256 test image
      // Expect valid: false
    });

    it('should reject oversized image', async () => {
      // Create 5000x5000 test image
      // Expect valid: false
    });

    it('should return dimensions', async () => {
      // Upload image
      // Verify dimensions returned
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove path traversal', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('___etc_passwd');
    });

    it('should remove special characters', () => {
      expect(sanitizeFilename('file<>:"|?*.jpg')).toBe('file________.jpg');
    });

    it('should preserve valid characters', () => {
      expect(sanitizeFilename('my-file_123.jpg')).toBe('my-file_123.jpg');
    });
  });
});
```

### Integration Tests

**File**: `apps/web/__tests__/integration/asset-upload.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import FormData from 'form-data';

describe('Asset Upload Integration', () => {
  it('should upload image and return URL', async () => {
    // Create test image
    // Upload via API route
    // Verify response contains URL
    // Verify file exists in storage
  });

  it('should generate thumbnail', async () => {
    // Upload image
    // Verify thumbnail URL in response
    // Verify thumbnail exists in storage
    // Verify thumbnail size is 256x256
  });

  it('should update asset record', async () => {
    // Create asset
    // Upload image with assetId
    // Verify asset.reference_image_url updated
  });
});
```

### Manual Testing

1. **Valid Upload**
   - Use Postman/Insomnia to POST to `/api/projects/{projectId}/assets/upload`
   - Include auth token in header
   - Attach PNG file (1024x1024, 2MB)
   - Verify 200 response with URL
   - Open URL in browser, verify image displays

2. **Invalid File Type**
   - Upload PDF file
   - Verify 400 error with clear message

3. **Oversized File**
   - Upload 15MB image
   - Verify 413 error with size details

4. **Rate Limiting**
   - Upload 11 files rapidly
   - Verify 429 error on 11th request

5. **Thumbnail Generation**
   - Upload large image (2048x2048)
   - Verify thumbnail URL in response
   - Open thumbnail, verify size is 256x256

---

## Security Considerations

### Authentication & Authorization

- All requests require valid JWT token
- User must be authenticated team member
- Write access verified via accounts_memberships

### File Validation

- Strict MIME type checking (no .jpg.exe tricks)
- Magic number validation (verify file signature)
- Dimension validation prevents memory exhaustion
- Size limit prevents storage abuse

### Storage Security

- RLS policies enforce project-level access
- Filenames sanitized to prevent path traversal
- UUIDs prevent filename collisions
- Bucket not directly writable by client

### Rate Limiting

```typescript
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  return count <= limit;
}
```

### Input Sanitization

- Filenames sanitized to remove special characters
- Path traversal attempts blocked (../, ..\)
- Asset type validated against enum
- Project ID validated as UUID

---

## Error Handling

### Client-Side Usage

```typescript
'use client';

import { toast } from '@kit/ui/sonner';

async function uploadImage(file: File, projectId: string, assetType: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('assetType', assetType);

  try {
    const response = await fetch(
      `/api/projects/${projectId}/assets/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!response.ok) {
      const error = await response.json();

      if (error.error.code === 'FILE_TOO_LARGE') {
        toast.error('File is too large. Maximum size is 10MB.');
      } else if (error.error.code === 'INVALID_FILE_TYPE') {
        toast.error('Only PNG, JPG, JPEG, and WebP images are supported.');
      } else if (error.error.code === 'INVALID_DIMENSIONS') {
        toast.error(error.error.message);
      } else if (error.error.code === 'RATE_LIMITED') {
        toast.error('Too many uploads. Please wait a minute and try again.');
      } else {
        toast.error('Failed to upload image. Please try again.');
      }

      throw error;
    }

    const data = await response.json();
    toast.success('Image uploaded successfully');
    return data;
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
}
```

---

## Performance Considerations

### Upload Optimization

- Use streaming upload for large files
- Compress images client-side before upload (future)
- Implement resumable uploads (future)

### Thumbnail Generation

- Generate thumbnails asynchronously in background worker (future)
- Cache thumbnail dimensions
- Use CDN for serving images

### Storage Costs

- Monitor storage usage per account
- Implement storage quotas (10GB free, $1/10GB after)
- Clean up orphaned files periodically

---

## Future Enhancements

1. **Progress Tracking**
   - Real-time upload progress via WebSocket
   - Pause/resume uploads

2. **Image Editing**
   - Crop/rotate before upload
   - Apply filters
   - Remove background

3. **Batch Upload**
   - Upload multiple images at once
   - Drag and drop folder support

4. **CDN Integration**
   - CloudFront/Cloudflare for faster delivery
   - Image optimization on-the-fly

5. **Compression**
   - Automatic compression for large files
   - WebP conversion for smaller file sizes

---

## References

- **FILM-201**: Asset CRUD actions
- **FILM-207**: ImageUploader component (uses this route)
- **Supabase Storage**: https://supabase.com/docs/guides/storage
- **Sharp**: https://sharp.pixelplumbing.com/
- **Next.js Route Handlers**: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- **Constitution**: Section 5.1 (Error Categories)
