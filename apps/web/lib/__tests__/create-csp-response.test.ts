import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('create-csp-response', () => {
  const originalEnv = process.env;

  // Mock nosecone module
  const mockMiddleware = vi.fn();
  const mockCreateMiddleware = vi.fn(() => mockMiddleware);
  const mockWithVercelToolbar = vi.fn((config) => config);
  const mockDefaults = {
    contentSecurityPolicy: {
      directives: {
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    // Set test environment variables
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NODE_ENV = 'test';

    // Reset mock implementations
    mockMiddleware.mockResolvedValue({
      headers: new Map([
        [
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self' 'nonce-abc123def456';",
        ],
      ]),
    });

    // Mock the dynamic import
    vi.doMock('@nosecone/next', () => ({
      createMiddleware: mockCreateMiddleware,
      withVercelToolbar: mockWithVercelToolbar,
      defaults: mockDefaults,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock('@nosecone/next');
    process.env = originalEnv;
  });

  describe('createCspResponse', () => {
    it('should import nosecone dynamically', async () => {
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      // The import should have been called (we can't easily test dynamic imports directly)
      expect(mockCreateMiddleware).toHaveBeenCalled();
    });

    it('should create middleware with nosecone config', async () => {
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      expect(mockCreateMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({
          contentSecurityPolicy: expect.objectContaining({
            directives: expect.any(Object),
          }),
        }),
      );
    });

    it('should add Supabase URL to connectSrc', async () => {
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      const config = mockCreateMiddleware.mock.calls[0][0];

      expect(config.contentSecurityPolicy.directives.connectSrc).toContain(
        'https://test.supabase.co',
      );
    });

    it('should add WebSocket URL to connectSrc', async () => {
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      const config = mockCreateMiddleware.mock.calls[0][0];

      expect(config.contentSecurityPolicy.directives.connectSrc).toContain(
        'ws://test.supabase.co',
      );
    });

    it('should add Supabase URL to imgSrc', async () => {
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      const config = mockCreateMiddleware.mock.calls[0][0];

      expect(config.contentSecurityPolicy.directives.imgSrc).toContain(
        'https://test.supabase.co',
      );
    });

    it('should preserve default connectSrc directives', async () => {
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      const config = mockCreateMiddleware.mock.calls[0][0];

      expect(config.contentSecurityPolicy.directives.connectSrc).toContain(
        "'self'",
      );
    });

    it('should preserve default imgSrc directives', async () => {
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      const config = mockCreateMiddleware.mock.calls[0][0];

      expect(config.contentSecurityPolicy.directives.imgSrc).toContain(
        "'self'",
      );
      expect(config.contentSecurityPolicy.directives.imgSrc).toContain('data:');
    });

    it('should set crossOriginEmbedderPolicy to false', async () => {
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      const config = mockCreateMiddleware.mock.calls[0][0];

      expect(config.crossOriginEmbedderPolicy).toBe(false);
    });

    it('should set upgradeInsecureRequests to false in non-production', async () => {
      process.env.NODE_ENV = 'development';
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      const config = mockCreateMiddleware.mock.calls[0][0];

      expect(
        config.contentSecurityPolicy.directives.upgradeInsecureRequests,
      ).toBe(false);
    });

    it('should set upgradeInsecureRequests to true in production', async () => {
      process.env.NODE_ENV = 'production';

      // Re-import to get new module instance
      vi.resetModules();
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      const config = mockCreateMiddleware.mock.calls[0][0];

      expect(
        config.contentSecurityPolicy.directives.upgradeInsecureRequests,
      ).toBe(true);
    });

    it('should call middleware function', async () => {
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      expect(mockMiddleware).toHaveBeenCalledOnce();
    });

    it('should return response from middleware', async () => {
      const mockResponse = {
        headers: new Map([['Content-Security-Policy', 'test-policy']]),
      };
      mockMiddleware.mockResolvedValue(mockResponse);

      const { createCspResponse } = await import('../create-csp-response');

      const response = await createCspResponse();

      expect(response).toBe(mockResponse);
    });

    it('should extract nonce from CSP header', async () => {
      const mockResponse = {
        headers: new Map([
          [
            'Content-Security-Policy',
            "script-src 'self' 'nonce-test-nonce-123';",
          ],
        ]),
      };
      mockMiddleware.mockResolvedValue(mockResponse);

      const { createCspResponse } = await import('../create-csp-response');

      const response = await createCspResponse();

      expect(response?.headers.get('x-nonce')).toBe('test-nonce-123');
    });

    it('should set x-nonce header when nonce is found', async () => {
      const mockHeaders = new Map([
        ['Content-Security-Policy', 'nonce-abc123 other-stuff'],
      ]);
      const mockResponse = {
        headers: mockHeaders,
      };
      mockMiddleware.mockResolvedValue(mockResponse);

      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      expect(mockHeaders.has('x-nonce')).toBe(true);
      expect(mockHeaders.get('x-nonce')).toBe('abc123');
    });

    it('should handle CSP header without nonce', async () => {
      const mockResponse = {
        headers: new Map([
          ['Content-Security-Policy', "script-src 'self' 'unsafe-inline';"],
        ]),
      };
      mockMiddleware.mockResolvedValue(mockResponse);

      const { createCspResponse } = await import('../create-csp-response');

      const response = await createCspResponse();

      expect(response?.headers.has('x-nonce')).toBe(false);
    });

    it('should handle missing CSP header', async () => {
      const mockResponse = {
        headers: new Map(),
      };
      mockMiddleware.mockResolvedValue(mockResponse);

      const { createCspResponse } = await import('../create-csp-response');

      const response = await createCspResponse();

      expect(response?.headers.has('x-nonce')).toBe(false);
    });

    it('should handle null response from middleware', async () => {
      mockMiddleware.mockResolvedValue(null);

      const { createCspResponse } = await import('../create-csp-response');

      const response = await createCspResponse();

      expect(response).toBeNull();
    });

    it('should handle undefined response from middleware', async () => {
      mockMiddleware.mockResolvedValue(undefined);

      const { createCspResponse } = await import('../create-csp-response');

      const response = await createCspResponse();

      expect(response).toBeUndefined();
    });

    it('should use withVercelToolbar in preview environment', async () => {
      process.env.VERCEL_ENV = 'preview';

      vi.resetModules();
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      expect(mockWithVercelToolbar).toHaveBeenCalled();
    });

    it('should not use withVercelToolbar in production', async () => {
      process.env.VERCEL_ENV = 'production';

      vi.resetModules();
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      expect(mockWithVercelToolbar).not.toHaveBeenCalled();
    });

    it('should not use withVercelToolbar when VERCEL_ENV is not set', async () => {
      delete process.env.VERCEL_ENV;

      vi.resetModules();
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      expect(mockWithVercelToolbar).not.toHaveBeenCalled();
    });

    it('should handle http Supabase URL', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';

      vi.resetModules();
      const { createCspResponse } = await import('../create-csp-response');

      await createCspResponse();

      const config = mockCreateMiddleware.mock.calls[0][0];

      expect(config.contentSecurityPolicy.directives.connectSrc).toContain(
        'http://localhost:54321',
      );
      expect(config.contentSecurityPolicy.directives.connectSrc).toContain(
        'ws://localhost:54321',
      );
    });

    it('should handle complex nonce values', async () => {
      const complexNonce = 'nonce-AbC123-XyZ_789';
      const mockResponse = {
        headers: new Map([
          ['Content-Security-Policy', `script-src 'self' '${complexNonce}';`],
        ]),
      };
      mockMiddleware.mockResolvedValue(mockResponse);

      const { createCspResponse } = await import('../create-csp-response');

      const response = await createCspResponse();

      expect(response?.headers.get('x-nonce')).toBe('AbC123-XyZ_789');
    });

    it('should extract first nonce if multiple found', async () => {
      const mockResponse = {
        headers: new Map([
          [
            'Content-Security-Policy',
            "script-src 'nonce-first-123' 'nonce-second-456';",
          ],
        ]),
      };
      mockMiddleware.mockResolvedValue(mockResponse);

      const { createCspResponse } = await import('../create-csp-response');

      const response = await createCspResponse();

      expect(response?.headers.get('x-nonce')).toBe('first-123');
    });
  });
});
