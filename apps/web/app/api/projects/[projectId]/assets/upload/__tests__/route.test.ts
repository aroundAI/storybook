import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import after mocks are defined
import { POST } from '../route';

// Use vi.hoisted() to ensure mock functions are available during hoisting
const {
  mockLoggerInfo,
  mockLoggerError,
  mockLoggerWarn,
  mockLoggerDebug,
  mockValidateUpload,
  mockSanitizeFilename,
  mockGenerateStoragePath,
  mockValidateImageDimensions,
  mockGenerateThumbnail,
  mockGetThumbnailContentType,
  mockGetImageDimensions,
  mockUploadToStorage,
  mockDeleteFromStorage,
  mockSupabaseFrom,
  mockSupabaseClient,
} = vi.hoisted(() => {
  const mockLoggerInfo = vi.fn();
  const mockLoggerError = vi.fn();
  const mockLoggerWarn = vi.fn();
  const mockLoggerDebug = vi.fn();

  const mockValidateUpload = vi.fn();
  const mockSanitizeFilename = vi.fn((name: string) =>
    name.replace(/[^a-zA-Z0-9.-]/g, '_'),
  );
  const mockGenerateStoragePath = vi.fn(
    (projectId: string, assetId: string, fieldType: string, filename: string) =>
      `${projectId}/${assetId}/${fieldType}-${filename}`,
  );

  const mockValidateImageDimensions = vi.fn();
  const mockGenerateThumbnail = vi.fn();
  const mockGetThumbnailContentType = vi.fn(() => 'image/webp');
  const mockGetImageDimensions = vi.fn();
  const mockUploadToStorage = vi.fn();
  const mockDeleteFromStorage = vi.fn();

  const mockSupabaseFrom = vi.fn();
  const mockSupabaseClient = {
    from: mockSupabaseFrom,
    storage: {
      from: vi.fn(),
    },
  };

  return {
    mockLoggerInfo,
    mockLoggerError,
    mockLoggerWarn,
    mockLoggerDebug,
    mockValidateUpload,
    mockSanitizeFilename,
    mockGenerateStoragePath,
    mockValidateImageDimensions,
    mockGenerateThumbnail,
    mockGetThumbnailContentType,
    mockGetImageDimensions,
    mockUploadToStorage,
    mockDeleteFromStorage,
    mockSupabaseFrom,
    mockSupabaseClient,
  };
});

// Mock dependencies
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      info: mockLoggerInfo,
      error: mockLoggerError,
      warn: mockLoggerWarn,
      debug: mockLoggerDebug,
    }),
  ),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => mockSupabaseClient),
}));

vi.mock('@kit/next/routes', () => ({
  enhanceRouteHandler: vi.fn((handler, options) => {
    return async (request: Request, context: { params: Promise<any> }) => {
      const params = await context.params;
      if (options?.auth) {
        return handler({
          request,
          user: { id: 'test-user-id' },
          params,
        });
      }
      return handler({ request, params });
    };
  }),
}));

vi.mock('@kit/assets/upload-validation', () => ({
  validateUpload: mockValidateUpload,
  sanitizeFilename: mockSanitizeFilename,
  generateStoragePath: mockGenerateStoragePath,
}));

vi.mock('@kit/assets/upload', () => ({
  validateImageDimensions: mockValidateImageDimensions,
  generateThumbnail: mockGenerateThumbnail,
  getThumbnailContentType: mockGetThumbnailContentType,
  getImageDimensions: mockGetImageDimensions,
  uploadToStorage: mockUploadToStorage,
  deleteFromStorage: mockDeleteFromStorage,
  PROJECT_ASSETS_BUCKET: 'project-assets',
}));

describe('Asset Upload API Route', () => {
  const projectId = 'test-project-id';

  function createFormDataRequest(
    file: File | null,
    options: { assetId?: string; fieldType?: string } = {},
  ) {
    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    }
    if (options.assetId) {
      formData.append('assetId', options.assetId);
    }
    if (options.fieldType) {
      formData.append('fieldType', options.fieldType);
    }

    return new Request(
      `http://localhost:3000/api/projects/${projectId}/assets/upload`,
      {
        method: 'POST',
        body: formData,
      },
    );
  }

  function createTestFile(
    name = 'test.png',
    type = 'image/png',
    content = 'fake-image-data',
  ) {
    return new File([content], name, { type });
  }

  function setupSuccessfulProjectQuery() {
    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: projectId, account_id: 'test-account-id' },
        error: null,
      }),
    };
    mockSupabaseFrom.mockReturnValue(mockQuery);
  }

  function setupNotFoundProjectQuery() {
    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      }),
    };
    mockSupabaseFrom.mockReturnValue(mockQuery);
  }

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default successful mocks
    setupSuccessfulProjectQuery();
    mockValidateUpload.mockResolvedValue({ valid: true });
    mockValidateImageDimensions.mockResolvedValue({ valid: true });
    mockGetImageDimensions.mockResolvedValue({ width: 1024, height: 768 });
    mockGenerateThumbnail.mockResolvedValue(Buffer.from('thumbnail-data'));
    mockUploadToStorage.mockResolvedValue({
      url: 'https://storage.test/image.png',
    });
  });

  describe('Successful upload', () => {
    it('should upload file and return URLs', async () => {
      mockUploadToStorage
        .mockResolvedValueOnce({ url: 'https://storage.test/original.png' })
        .mockResolvedValueOnce({ url: 'https://storage.test/thumbnail.webp' });

      const file = createTestFile();
      const request = createFormDataRequest(file);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        success: true,
        imageUrl: 'https://storage.test/original.png',
        thumbnailUrl: 'https://storage.test/thumbnail.webp',
        width: 1024,
        height: 768,
      });
    });

    it('should use provided assetId', async () => {
      mockUploadToStorage.mockResolvedValue({
        url: 'https://storage.test/image.png',
      });

      const file = createTestFile();
      const request = createFormDataRequest(file, {
        assetId: 'custom-asset-id',
      });

      await POST(request, { params: Promise.resolve({ projectId }) });

      expect(mockGenerateStoragePath).toHaveBeenCalledWith(
        projectId,
        'custom-asset-id',
        'reference',
        expect.any(String),
      );
    });

    it('should use provided fieldType', async () => {
      mockUploadToStorage.mockResolvedValue({
        url: 'https://storage.test/image.png',
      });

      const file = createTestFile();
      const request = createFormDataRequest(file, { fieldType: 'thumbnail' });

      await POST(request, { params: Promise.resolve({ projectId }) });

      expect(mockGenerateStoragePath).toHaveBeenCalledWith(
        projectId,
        expect.any(String),
        'thumbnail',
        expect.any(String),
      );
    });

    it('should generate thumbnail and upload both files', async () => {
      const file = createTestFile();
      const request = createFormDataRequest(file);

      await POST(request, { params: Promise.resolve({ projectId }) });

      expect(mockGenerateThumbnail).toHaveBeenCalled();
      expect(mockUploadToStorage).toHaveBeenCalledTimes(2);
    });
  });

  describe('Validation errors', () => {
    it('should return 400 when no file provided', async () => {
      const request = createFormDataRequest(null);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('No file provided');
    });

    it('should return 400 for invalid file type', async () => {
      mockValidateUpload.mockResolvedValue({
        valid: false,
        error: {
          code: 'INVALID_TYPE',
          message: 'File type not allowed',
        },
      });

      const file = createTestFile('test.exe', 'application/x-msdownload');
      const request = createFormDataRequest(file);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.code).toBe('INVALID_TYPE');
    });

    it('should return 413 for file too large', async () => {
      mockValidateUpload.mockResolvedValue({
        valid: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds 10MB',
        },
      });

      const file = createTestFile();
      const request = createFormDataRequest(file);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(413);
      const data = await response.json();
      expect(data.code).toBe('FILE_TOO_LARGE');
    });

    it('should return 400 for invalid image dimensions', async () => {
      mockValidateImageDimensions.mockResolvedValue({
        valid: false,
        error: {
          code: 'DIMENSION_TOO_SMALL',
          message: 'Image dimensions must be at least 512px',
        },
      });

      const file = createTestFile();
      const request = createFormDataRequest(file);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.code).toBe('DIMENSION_TOO_SMALL');
    });
  });

  describe('Project access', () => {
    it('should return 404 when project not found', async () => {
      setupNotFoundProjectQuery();

      const file = createTestFile();
      const request = createFormDataRequest(file);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Project not found');
    });
  });

  describe('Storage errors', () => {
    it('should return 500 when original upload fails', async () => {
      mockUploadToStorage.mockRejectedValue(new Error('Storage error'));

      const file = createTestFile();
      const request = createFormDataRequest(file);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Upload failed. Please try again.');
    });

    it('should cleanup original when thumbnail upload fails', async () => {
      mockUploadToStorage
        .mockResolvedValueOnce({ url: 'https://storage.test/original.png' })
        .mockRejectedValueOnce(new Error('Thumbnail upload failed'));

      const file = createTestFile();
      const request = createFormDataRequest(file);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(500);
      expect(mockDeleteFromStorage).toHaveBeenCalledWith(
        expect.anything(),
        'project-assets',
        expect.stringContaining(projectId),
      );
    });

    it('should handle cleanup failure gracefully', async () => {
      mockUploadToStorage
        .mockResolvedValueOnce({ url: 'https://storage.test/original.png' })
        .mockRejectedValueOnce(new Error('Thumbnail upload failed'));
      mockDeleteFromStorage.mockRejectedValue(new Error('Cleanup failed'));

      const file = createTestFile();
      const request = createFormDataRequest(file);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(500);
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining(projectId),
        }),
        'Failed to cleanup original image after thumbnail failure',
      );
    });
  });

  describe('Logging', () => {
    it('should log upload start', async () => {
      mockUploadToStorage.mockResolvedValue({
        url: 'https://storage.test/image.png',
      });

      const file = createTestFile();
      const request = createFormDataRequest(file);

      await POST(request, { params: Promise.resolve({ projectId }) });

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'asset-upload',
          projectId,
          userId: 'test-user-id',
        }),
        'Processing asset upload request',
      );
    });

    it('should log upload completion', async () => {
      mockUploadToStorage.mockResolvedValue({
        url: 'https://storage.test/image.png',
      });

      const file = createTestFile();
      const request = createFormDataRequest(file);

      await POST(request, { params: Promise.resolve({ projectId }) });

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'asset-upload',
          projectId,
        }),
        'Asset upload completed successfully',
      );
    });

    it('should log validation failures', async () => {
      mockValidateUpload.mockResolvedValue({
        valid: false,
        error: { code: 'INVALID_TYPE', message: 'Not allowed' },
      });

      const file = createTestFile();
      const request = createFormDataRequest(file);

      await POST(request, { params: Promise.resolve({ projectId }) });

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_TYPE' }),
        'File validation failed',
      );
    });
  });

  describe('File sanitization', () => {
    it('should sanitize filename before storage', async () => {
      mockUploadToStorage.mockResolvedValue({
        url: 'https://storage.test/image.png',
      });

      const file = createTestFile('my image (1).png');
      const request = createFormDataRequest(file);

      await POST(request, { params: Promise.resolve({ projectId }) });

      expect(mockSanitizeFilename).toHaveBeenCalledWith('my image (1).png');
    });
  });

  describe('Different file types', () => {
    const fileTypes = [
      { name: 'test.png', type: 'image/png' },
      { name: 'test.jpg', type: 'image/jpeg' },
      { name: 'test.jpeg', type: 'image/jpeg' },
      { name: 'test.webp', type: 'image/webp' },
    ];

    for (const { name, type } of fileTypes) {
      it(`should accept ${type} files`, async () => {
        mockUploadToStorage.mockResolvedValue({
          url: 'https://storage.test/image.png',
        });

        const file = createTestFile(name, type);
        const request = createFormDataRequest(file);

        const response = await POST(request, {
          params: Promise.resolve({ projectId }),
        });

        expect(response.status).toBe(200);
      });
    }
  });

  describe('Response format', () => {
    it('should return all expected fields', async () => {
      mockUploadToStorage
        .mockResolvedValueOnce({ url: 'https://storage.test/original.png' })
        .mockResolvedValueOnce({ url: 'https://storage.test/thumb.webp' });
      mockGetImageDimensions.mockResolvedValue({ width: 2048, height: 1536 });

      const file = createTestFile('photo.png', 'image/png', 'x'.repeat(5000));
      const request = createFormDataRequest(file);

      const response = await POST(request, {
        params: Promise.resolve({ projectId }),
      });

      const data = await response.json();

      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('imageUrl');
      expect(data).toHaveProperty('thumbnailUrl');
      expect(data).toHaveProperty('width', 2048);
      expect(data).toHaveProperty('height', 1536);
      expect(data).toHaveProperty('size');
      expect(data).toHaveProperty('contentType', 'image/png');
      expect(data).toHaveProperty('path');
    });
  });
});
