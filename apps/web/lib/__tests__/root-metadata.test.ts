import { headers } from 'next/headers';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateRootMetadata } from '../root-metdata';

// Mock Next.js headers - must define inline to avoid hoisting issues
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

// Mock app config - must define inline to avoid hoisting issues
vi.mock('~/config/app.config', () => ({
  default: {
    name: 'Test App',
    title: 'Test App Title',
    description: 'Test App Description',
    url: 'https://test-app.com',
  },
}));

describe('root-metadata', () => {
  const mockHeaders = vi.mocked(headers);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateRootMetadata', () => {
    it('should generate metadata with all required fields', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue('csrf-token-123'),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata).toEqual({
        title: 'Test App Title',
        description: 'Test App Description',
        metadataBase: new URL('https://test-app.com'),
        applicationName: 'Test App',
        other: {
          'csrf-token': 'csrf-token-123',
        },
        openGraph: {
          url: 'https://test-app.com',
          siteName: 'Test App',
          title: 'Test App Title',
          description: 'Test App Description',
        },
        twitter: {
          card: 'summary_large_image',
          title: 'Test App Title',
          description: 'Test App Description',
        },
        icons: {
          icon: '/images/favicon/favicon.ico',
          apple: '/images/favicon/apple-touch-icon.png',
        },
      });
    });

    it('should call headers() to get headers store', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue('csrf-token-123'),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      await generateRootMetadata();

      expect(mockHeaders).toHaveBeenCalledOnce();
    });

    it('should get csrf token from x-csrf-token header', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue('custom-csrf-token'),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      await generateRootMetadata();

      expect(mockHeadersStore.get).toHaveBeenCalledWith('x-csrf-token');
    });

    it('should use empty string when csrf token is not present', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue(null),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.other).toEqual({
        'csrf-token': '',
      });
    });

    it('should use empty string when csrf token is undefined', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue(undefined),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.other).toEqual({
        'csrf-token': '',
      });
    });

    it('should include csrf token in metadata.other', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue('my-csrf-token'),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.other).toBeDefined();
      expect(metadata.other?.['csrf-token']).toBe('my-csrf-token');
    });

    it('should use app config values for metadata', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue(''),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.title).toBe('Test App Title');
      expect(metadata.description).toBe('Test App Description');
      expect(metadata.applicationName).toBe('Test App');
    });

    it('should create metadataBase URL from app config url', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue(''),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.metadataBase).toBeInstanceOf(URL);
      expect(metadata.metadataBase?.toString()).toBe('https://test-app.com/');
    });

    it('should include OpenGraph metadata', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue(''),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.openGraph).toBeDefined();
      expect(metadata.openGraph?.url).toBe('https://test-app.com');
      expect(metadata.openGraph?.siteName).toBe('Test App');
      expect(metadata.openGraph?.title).toBe('Test App Title');
      expect(metadata.openGraph?.description).toBe('Test App Description');
    });

    it('should include Twitter card metadata', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue(''),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.twitter).toBeDefined();
      expect(metadata.twitter?.card).toBe('summary_large_image');
      expect(metadata.twitter?.title).toBe('Test App Title');
      expect(metadata.twitter?.description).toBe('Test App Description');
    });

    it('should include favicon icons', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue(''),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.icons).toBeDefined();
      expect(metadata.icons?.icon).toBe('/images/favicon/favicon.ico');
      expect(metadata.icons?.apple).toBe(
        '/images/favicon/apple-touch-icon.png',
      );
    });

    it('should handle very long csrf tokens', async () => {
      const longToken = 'a'.repeat(500);
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue(longToken),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.other?.['csrf-token']).toBe(longToken);
    });

    it('should handle special characters in csrf token', async () => {
      const specialToken = 'csrf!@#$%^&*()_+-=[]{}|;:,.<>?';
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue(specialToken),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata = await generateRootMetadata();

      expect(metadata.other?.['csrf-token']).toBe(specialToken);
    });

    it('should return consistent structure across multiple calls', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue('token-1'),
      };
      mockHeaders.mockResolvedValue(mockHeadersStore as any);

      const metadata1 = await generateRootMetadata();

      mockHeadersStore.get.mockReturnValue('token-2');

      const metadata2 = await generateRootMetadata();

      expect(Object.keys(metadata1).sort()).toEqual(
        Object.keys(metadata2).sort(),
      );
    });

    it('should handle async headers() call', async () => {
      const mockHeadersStore = {
        get: vi.fn().mockReturnValue('async-token'),
      };

      // Simulate async delay
      mockHeaders.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(mockHeadersStore), 10),
          ),
      );

      const metadata = await generateRootMetadata();

      expect(metadata.other?.['csrf-token']).toBe('async-token');
    });
  });
});
