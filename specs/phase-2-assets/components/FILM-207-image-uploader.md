---
spec_id: FILM-207
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-207: Image Uploader Component

**Status**: 🟡 PARTIAL (audit 2026-09-23; was ✅ Completed 2025-12-09)
**Phase**: 2
**Priority**: P0
**Effort**: S (1-2 days)
**Dependencies**: FILM-203 (upload route)
**Blocks**: FILM-205 (CharacterEditor integration)

---

## Context

The Image Uploader provides a drag-and-drop interface for uploading reference images for assets (characters, locations, voices). It validates file types and sizes client-side before uploading, displays upload progress, shows image previews, and handles errors gracefully.

This is a reusable component that can be used in CharacterEditor, LocationEditor, and any other form requiring image uploads.

---

## Requirements

### Functional Requirements

1. **Upload Interface**
   - Drag and drop zone
   - Click to browse file picker
   - Display upload zone with dashed border
   - Accept PNG, JPG, JPEG, WebP only
   - Max file size: 10MB

2. **File Validation**
   - Client-side validation before upload
   - Check file type (MIME type)
   - Check file size
   - Display validation errors inline

3. **Upload Process**
   - Upload to server route (FILM-203)
   - Display progress bar (0-100%)
   - Show loading spinner
   - Disable zone during upload
   - Handle upload errors

4. **Image Preview**
   - Display uploaded image thumbnail
   - Show image dimensions
   - Show file size
   - Remove/replace image button
   - Zoom preview on click (optional)

5. **States**
   - Empty: Drag/drop zone with icon
   - Dragging: Highlighted drop zone
   - Uploading: Progress bar
   - Uploaded: Image preview with actions
   - Error: Error message with retry option

### Non-Functional Requirements

- Upload completes within 10 seconds (5MB file)
- Smooth animations and transitions
- Responsive design (mobile to desktop)
- Accessible (keyboard, screen reader)
- Prevent multiple simultaneous uploads

---

## Interface

### Component Props

```typescript
interface ImageUploaderProps {
  projectId: string;
  assetType: 'character' | 'location' | 'voice';
  assetId?: string;                    // Optional for updating existing asset
  initialImageUrl?: string;            // Existing image URL
  onUploadComplete?: (url: string, thumbnailUrl: string) => void;
  onRemove?: () => void;
  maxSize?: number;                    // Max file size in bytes (default: 10MB)
  acceptedTypes?: string[];            // Accepted MIME types
  className?: string;
}
```

### Upload State

```typescript
type UploadState =
  | { status: 'idle' }
  | { status: 'dragging' }
  | { status: 'validating' }
  | { status: 'uploading'; progress: number }
  | { status: 'success'; url: string; thumbnailUrl: string }
  | { status: 'error'; message: string };
```

---

## Implementation

### Component Structure

```
packages/features/assets/src/components/
├── ImageUploader.tsx                # Main uploader (CREATE THIS)
├── ImageDropzone.tsx                # Drag/drop zone (CREATE THIS)
├── ImagePreview.tsx                 # Preview with actions (CREATE THIS)
└── ImageUploadProgress.tsx          # Progress indicator (CREATE THIS)
```

### Main Uploader Component

**File**: `packages/features/assets/src/components/ImageUploader.tsx`

```typescript
'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from '@kit/ui/sonner';
import { ImageDropzone } from './ImageDropzone';
import { ImagePreview } from './ImagePreview';
import { ImageUploadProgress } from './ImageUploadProgress';

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface ImageUploaderProps {
  projectId: string;
  assetType: 'character' | 'location' | 'voice';
  assetId?: string;
  initialImageUrl?: string;
  onUploadComplete?: (url: string, thumbnailUrl: string) => void;
  onRemove?: () => void;
  maxSize?: number;
  acceptedTypes?: string[];
  className?: string;
}

type UploadState =
  | { status: 'idle' }
  | { status: 'dragging' }
  | { status: 'validating' }
  | { status: 'uploading'; progress: number }
  | { status: 'success'; url: string; thumbnailUrl: string }
  | { status: 'error'; message: string };

export function ImageUploader({
  projectId,
  assetType,
  assetId,
  initialImageUrl,
  onUploadComplete,
  onRemove,
  maxSize = DEFAULT_MAX_SIZE,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
  className,
}: ImageUploaderProps) {
  const [uploadState, setUploadState] = useState<UploadState>(
    initialImageUrl
      ? { status: 'success', url: initialImageUrl, thumbnailUrl: initialImageUrl }
      : { status: 'idle' }
  );

  // Validate file
  const validateFile = useCallback(
    (file: File): string | null => {
      // Check file type
      if (!acceptedTypes.includes(file.type)) {
        return `Invalid file type. Only ${acceptedTypes.join(', ')} are allowed.`;
      }

      // Check file size
      if (file.size > maxSize) {
        const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
        return `File size exceeds ${maxSizeMB}MB limit.`;
      }

      return null;
    },
    [acceptedTypes, maxSize]
  );

  // Upload file
  const uploadFile = useCallback(
    async (file: File) => {
      setUploadState({ status: 'validating' });

      // Validate
      const validationError = validateFile(file);
      if (validationError) {
        setUploadState({ status: 'error', message: validationError });
        toast.error(validationError);
        return;
      }

      // Prepare form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('assetType', assetType);
      if (assetId) {
        formData.append('assetId', assetId);
      }

      try {
        setUploadState({ status: 'uploading', progress: 0 });

        // Upload with progress tracking
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setUploadState({ status: 'uploading', progress });
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            setUploadState({
              status: 'success',
              url: response.url,
              thumbnailUrl: response.thumbnailUrl,
            });

            toast.success('Image uploaded successfully');

            if (onUploadComplete) {
              onUploadComplete(response.url, response.thumbnailUrl);
            }
          } else {
            const error = JSON.parse(xhr.responseText);
            setUploadState({
              status: 'error',
              message: error.error.message || 'Upload failed',
            });
            toast.error(error.error.message || 'Upload failed');
          }
        });

        xhr.addEventListener('error', () => {
          setUploadState({ status: 'error', message: 'Network error' });
          toast.error('Network error during upload');
        });

        xhr.open('POST', `/api/projects/${projectId}/assets/upload`);
        xhr.send(formData);
      } catch (error) {
        setUploadState({ status: 'error', message: 'Upload failed' });
        toast.error('Failed to upload image');
        console.error('Upload error:', error);
      }
    },
    [projectId, assetType, assetId, validateFile, onUploadComplete]
  );

  // Handle file drop
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        uploadFile(acceptedFiles[0]);
      }
    },
    [uploadFile]
  );

  // Dropzone hook
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptedTypes.reduce((acc, type) => ({ ...acc, [type]: [] }), {}),
    maxSize,
    multiple: false,
    disabled: uploadState.status === 'uploading',
  });

  // Handle remove
  const handleRemove = useCallback(() => {
    setUploadState({ status: 'idle' });
    if (onRemove) {
      onRemove();
    }
  }, [onRemove]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setUploadState({ status: 'idle' });
  }, []);

  return (
    <div className={className}>
      {uploadState.status === 'success' ? (
        <ImagePreview
          url={uploadState.url}
          thumbnailUrl={uploadState.thumbnailUrl}
          onRemove={handleRemove}
        />
      ) : uploadState.status === 'uploading' ? (
        <ImageUploadProgress progress={uploadState.progress} />
      ) : (
        <ImageDropzone
          getRootProps={getRootProps}
          getInputProps={getInputProps}
          isDragActive={isDragActive}
          error={uploadState.status === 'error' ? uploadState.message : undefined}
          onRetry={uploadState.status === 'error' ? handleRetry : undefined}
        />
      )}
    </div>
  );
}
```

### Dropzone Component

**File**: `packages/features/assets/src/components/ImageDropzone.tsx`

```typescript
'use client';

import { DropzoneRootProps, DropzoneInputProps } from 'react-dropzone';
import { Upload, AlertCircle } from 'lucide-react';
import { Button } from '@kit/ui/button';

interface ImageDropzoneProps {
  getRootProps: () => DropzoneRootProps;
  getInputProps: () => DropzoneInputProps;
  isDragActive: boolean;
  error?: string;
  onRetry?: () => void;
}

export function ImageDropzone({
  getRootProps,
  getInputProps,
  isDragActive,
  error,
  onRetry,
}: ImageDropzoneProps) {
  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-8
        flex flex-col items-center justify-center
        cursor-pointer transition-colors
        ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
        ${error ? 'border-destructive bg-destructive/5' : ''}
        hover:border-primary hover:bg-primary/5
      `}
    >
      <input {...getInputProps()} />

      {error ? (
        <>
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-sm font-medium text-destructive mb-2">{error}</p>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Try Again
            </Button>
          )}
        </>
      ) : (
        <>
          <Upload
            className={`h-12 w-12 mb-4 ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`}
          />
          <p className="text-sm font-medium mb-1">
            {isDragActive ? 'Drop image here' : 'Drag and drop an image'}
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            or click to browse
          </p>
          <p className="text-xs text-muted-foreground">
            PNG, JPG, JPEG, WebP (max 10MB)
          </p>
        </>
      )}
    </div>
  );
}
```

### Preview Component

**File**: `packages/features/assets/src/components/ImagePreview.tsx`

```typescript
'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@kit/ui/button';
import { X, ZoomIn } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@kit/ui/dialog';

interface ImagePreviewProps {
  url: string;
  thumbnailUrl: string;
  onRemove: () => void;
}

export function ImagePreview({ url, thumbnailUrl, onRemove }: ImagePreviewProps) {
  return (
    <div className="relative border-2 border-muted rounded-lg overflow-hidden">
      {/* Preview Image */}
      <div className="relative aspect-video bg-muted">
        <Image
          src={thumbnailUrl}
          alt="Uploaded image"
          fill
          className="object-contain"
          sizes="(max-width: 640px) 100vw, 640px"
        />
      </div>

      {/* Actions Overlay */}
      <div className="absolute top-2 right-2 flex gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8"
            >
              <ZoomIn className="h-4 w-4" />
              <span className="sr-only">View full size</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl">
            <div className="relative aspect-video">
              <Image
                src={url}
                alt="Uploaded image"
                fill
                className="object-contain"
                sizes="100vw"
              />
            </div>
          </DialogContent>
        </Dialog>

        <Button
          type="button"
          variant="destructive"
          size="icon"
          className="h-8 w-8"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Remove image</span>
        </Button>
      </div>

      {/* Image Info */}
      <div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs">
        Click to view full size
      </div>
    </div>
  );
}
```

### Progress Component

**File**: `packages/features/assets/src/components/ImageUploadProgress.tsx`

```typescript
'use client';

import { Progress } from '@kit/ui/progress';
import { Loader2 } from 'lucide-react';

interface ImageUploadProgressProps {
  progress: number;
}

export function ImageUploadProgress({ progress }: ImageUploadProgressProps) {
  return (
    <div className="border-2 border-dashed border-primary rounded-lg p-8 flex flex-col items-center justify-center">
      <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
      <p className="text-sm font-medium mb-4">Uploading image...</p>
      <Progress value={progress} className="w-full max-w-xs" />
      <p className="text-xs text-muted-foreground mt-2">{progress}%</p>
    </div>
  );
}
```

---

## File Changes

### New Files

1. **packages/features/assets/src/components/ImageUploader.tsx**
   - Main uploader with state management

2. **packages/features/assets/src/components/ImageDropzone.tsx**
   - Drag/drop zone UI

3. **packages/features/assets/src/components/ImagePreview.tsx**
   - Image preview with actions

4. **packages/features/assets/src/components/ImageUploadProgress.tsx**
   - Upload progress indicator

### Modified Files

None (new feature)

### New Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "react-dropzone": "^14.2.3"
  }
}
```

---

## Acceptance Criteria

### Functional

- [x] Drag and drop zone renders with upload icon — *audit:* `packages/features/assets/src/components/image-uploader/ImageDropzone.tsx:76-118`
- [x] Click opens file picker — *audit:* react-dropzone root and input (`packages/features/assets/src/components/image-uploader/ImageDropzone.tsx:58-71`, `:97`)
- [x] Accepts PNG, JPG, JPEG, WebP only — *audit:* `packages/features/assets/src/components/image-uploader/ImageDropzone.tsx:40`
- [x] Rejects files larger than 10MB — *audit:* `packages/features/assets/src/components/image-uploader/ImageDropzone.tsx:65`; `packages/features/assets/__tests__/upload-validation.test.ts:90`
- [ ] Displays validation errors inline — *audit: not met* — type and size rejections are dropped silently: `onDrop` ignores them, no `onDropRejected` (`packages/features/assets/src/components/image-uploader/ImageDropzone.tsx:48-56`)
- [x] Shows progress bar during upload (0-100%) — *audit:* `packages/features/assets/src/components/image-uploader/use-image-upload.ts:154-163`, `packages/features/assets/src/components/image-uploader/ImageUploadProgress.tsx:70-73`
- [x] Displays image preview after upload — *audit:* `packages/features/assets/src/components/image-uploader/ImageUploader.tsx:95-107`
- [x] Preview shows remove button — *audit:* `packages/features/assets/src/components/image-uploader/ImagePreview.tsx:88-97`
- [x] Preview shows zoom button — *audit:* `packages/features/assets/src/components/image-uploader/ImagePreview.tsx:78-87`
- [x] Zoom opens modal with full-size image — *audit:* `packages/features/assets/src/components/image-uploader/ImagePreview.tsx:115-128`
- [x] Remove button resets to dropzone — *audit:* `packages/features/assets/src/components/image-uploader/ImageUploader.tsx:51-54`, `:69` (the editors clear `fileUrl` on remove)
- [x] onUploadComplete callback fires with URLs — *audit:* `packages/features/assets/src/components/image-uploader/use-image-upload.ts:202` (thumbnail URL equals the image URL since c17efd37)
- [x] onRemove callback fires on remove — *audit:* `packages/features/assets/src/components/image-uploader/ImageUploader.tsx:53`
- [x] Prevents multiple simultaneous uploads — *audit:* dropzone hidden and disabled while uploading (`packages/features/assets/src/components/image-uploader/ImageUploader.tsx:69`, `:83`)
- [x] Handles network errors gracefully — *audit:* `packages/features/assets/src/components/image-uploader/use-image-upload.ts:174-176`, `:203-211`
- [x] Retry button appears on error — *audit:* `packages/features/assets/src/components/image-uploader/ImageDropzone.tsx:140-152`

### Non-Functional

- [ ] Upload completes within 10 seconds (5MB file) — *audit: unverified* — runtime timing; nothing measures it
- [ ] Smooth drag/drop animations — *audit: unverified* — transitions exist (`packages/features/assets/src/components/image-uploader/ImageDropzone.tsx:79`, `:111`); smoothness is visual
- [ ] Responsive on mobile, tablet, desktop — *audit: unverified* — needs viewport screenshots; preview actions appear only on hover
- [x] Keyboard accessible (Tab, Enter, Space) — *audit:* focusable `role="button"` root with react-dropzone key handling (`packages/features/assets/src/components/image-uploader/ImageDropzone.tsx:77`, `:91-94`)
- [ ] Screen reader announces upload status — *audit: unverified* — live region while uploading (`packages/features/assets/src/components/image-uploader/ImageUploadProgress.tsx:43-44`), alert on error; success unannounced
- [ ] Focus visible on interactive elements — *audit: not met* — zoom and remove sit in an `opacity-0` overlay shown only on hover (`packages/features/assets/src/components/image-uploader/ImagePreview.tsx:77`)
- [x] TypeScript compiles without errors — *audit:* main CI run 35779959194 (6dfa35a4; code unchanged since): `@kit/assets:typecheck` ran uncached, no errors
- [x] No ESLint warnings — *audit:* main CI run 35779959194: `@kit/assets:lint` ran uncached, printed nothing

---

## Test Plan

### Unit Tests

**File**: `packages/features/assets/src/components/__tests__/ImageUploader.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageUploader } from '../ImageUploader';

describe('ImageUploader', () => {
  it('should render dropzone', () => {
    render(<ImageUploader projectId="project-1" assetType="character" />);

    expect(screen.getByText('Drag and drop an image')).toBeInTheDocument();
  });

  it('should accept valid file', async () => {
    const onUploadComplete = vi.fn();
    render(
      <ImageUploader
        projectId="project-1"
        assetType="character"
        onUploadComplete={onUploadComplete}
      />
    );

    const file = new File(['test'], 'test.png', { type: 'image/png' });
    const input = screen.getByRole('presentation').querySelector('input');

    // Simulate file drop
    // Verify upload progress
    // Verify onUploadComplete called
  });

  it('should reject invalid file type', async () => {
    render(<ImageUploader projectId="project-1" assetType="character" />);

    const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
    // Drop file
    // Verify error message
  });

  it('should reject oversized file', async () => {
    render(<ImageUploader projectId="project-1" assetType="character" />);

    const largeFile = new File(['x'.repeat(11 * 1024 * 1024)], 'large.png', {
      type: 'image/png',
    });
    // Drop file
    // Verify error message
  });

  it('should display preview after upload', async () => {
    render(<ImageUploader projectId="project-1" assetType="character" />);

    // Upload file
    await waitFor(() => {
      expect(screen.getByAlt('Uploaded image')).toBeInTheDocument();
    });
  });

  it('should remove image on remove button click', async () => {
    const onRemove = vi.fn();
    render(
      <ImageUploader
        projectId="project-1"
        assetType="character"
        initialImageUrl="https://example.com/image.png"
        onRemove={onRemove}
      />
    );
    const user = userEvent.setup();

    const removeButton = screen.getByLabelText('Remove image');
    await user.click(removeButton);

    expect(onRemove).toHaveBeenCalled();
    expect(screen.getByText('Drag and drop an image')).toBeInTheDocument();
  });
});
```

### Manual Testing

1. **Drag and Drop**
   - Drag PNG file onto dropzone
   - Verify highlight on drag over
   - Verify upload starts on drop

2. **File Picker**
   - Click dropzone
   - Select image from file picker
   - Verify upload starts

3. **Validation**
   - Drop PDF file → Error message
   - Drop 15MB image → Error message
   - Drop 500KB PNG → Success

4. **Progress**
   - Upload 5MB image
   - Verify progress bar updates (0% → 100%)
   - Verify preview displays after completion

5. **Preview**
   - Click zoom button → Modal opens
   - Click remove button → Returns to dropzone
   - Verify callbacks fire

---

## Accessibility

### Keyboard Navigation

- Tab: Focus dropzone
- Enter/Space: Open file picker
- Tab: Focus zoom/remove buttons in preview
- Esc: Close zoom modal

### ARIA Attributes

```typescript
<div
  {...getRootProps()}
  role="button"
  tabIndex={0}
  aria-label="Upload image"
  aria-describedby="upload-instructions"
>
  <input {...getInputProps()} aria-label="File input" />
  <p id="upload-instructions">
    Drag and drop an image or click to browse
  </p>
</div>

<Button aria-label="Remove image">
  <X />
</Button>

<Progress
  value={progress}
  aria-label={`Upload progress: ${progress}%`}
/>
```

### Screen Reader Announcements

- "Upload zone focused"
- "File selected: image.png, 2.5MB"
- "Uploading: 25%"
- "Upload complete"
- "Image preview displayed"

---

## Security Considerations

### Client-Side Validation

- Validate file type (MIME type, not extension)
- Validate file size before upload
- Display clear error messages

### Server-Side Validation

- Server route (FILM-203) performs full validation
- Magic number verification
- Dimension checks
- Rate limiting

### Preview Safety

- Use Next.js Image component for optimization
- Sanitize URLs before rendering
- No XSS via image tags

---

## Performance Considerations

### Upload Optimization

- Use XMLHttpRequest for progress tracking
- Cancel upload on component unmount
- Prevent multiple simultaneous uploads

### Image Preview

- Display thumbnail for preview (256x256)
- Load full-size only in zoom modal
- Use Next.js Image optimization

### Memory Management

- Revoke object URLs after use
- Cancel pending uploads on unmount
- Limit file size to prevent browser crashes

---

## Future Enhancements

1. **Image Editing**
   - Crop before upload
   - Rotate/flip
   - Apply filters

2. **Multi-Upload**
   - Upload multiple images at once
   - Batch progress tracking

3. **Advanced Validation**
   - Check image dimensions
   - Detect inappropriate content

4. **Compression**
   - Auto-compress large images
   - Convert to WebP for smaller size

5. **Cloud Storage Direct Upload**
   - Presigned URLs for direct S3 upload
   - Reduce server bandwidth

---

## References

- **FILM-203**: Upload route API
- **FILM-205**: CharacterEditor (uses this component)
- **react-dropzone**: https://react-dropzone.js.org/
- **Next.js Image**: https://nextjs.org/docs/app/api-reference/components/image
- **Constitution**: Section 2.3 (Component Pattern)

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Validation errors inline | Files react-dropzone rejects (over 10 MB, wrong type) never reach `upload()`: `onDrop` ignores rejections and there is no `onDropRejected` (`packages/features/assets/src/components/image-uploader/ImageDropzone.tsx:48-56`), so nothing is shown | unassigned |
| Focus visible | Zoom and remove are inside an `opacity-0` overlay revealed only by `group-hover` (`packages/features/assets/src/components/image-uploader/ImagePreview.tsx:77`) | unassigned |
