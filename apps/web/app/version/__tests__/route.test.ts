import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import after mocking
import { GET } from '../route';

// Mock child_process
const mockExecSync = vi.fn();

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

describe('version/route', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('GET handler', () => {
    describe('environment variable detection', () => {
      it('should return CF_PAGES_COMMIT_SHA when available', async () => {
        process.env.CF_PAGES_COMMIT_SHA = 'cf-hash-123';

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('cf-hash-123');
      });

      it('should return VERCEL_GIT_COMMIT_SHA when available', async () => {
        process.env.VERCEL_GIT_COMMIT_SHA = 'vercel-hash-456';

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('vercel-hash-456');
      });

      it('should return GIT_HASH when available', async () => {
        process.env.GIT_HASH = 'git-hash-789';

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('git-hash-789');
      });

      it('should prioritize CF_PAGES_COMMIT_SHA over others', async () => {
        process.env.CF_PAGES_COMMIT_SHA = 'cf-hash';
        process.env.VERCEL_GIT_COMMIT_SHA = 'vercel-hash';
        process.env.GIT_HASH = 'git-hash';

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('cf-hash');
      });

      it('should prioritize VERCEL_GIT_COMMIT_SHA over GIT_HASH', async () => {
        process.env.VERCEL_GIT_COMMIT_SHA = 'vercel-hash';
        process.env.GIT_HASH = 'git-hash';

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('vercel-hash');
      });
    });

    describe('git command fallback', () => {
      it('should use git command when in nodejs runtime and no env vars', async () => {
        process.env.NEXT_RUNTIME = 'nodejs';
        process.env.NODE_ENV = 'production';
        mockExecSync.mockReturnValue(Buffer.from('abc1234'));

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('abc1234');
        expect(mockExecSync).toHaveBeenCalledWith(
          'git log --pretty=format:"%h" -n1',
        );
      });

      it('should trim whitespace from git command output', async () => {
        process.env.NEXT_RUNTIME = 'nodejs';
        mockExecSync.mockReturnValue(Buffer.from('  abc1234  \n'));

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('abc1234');
      });

      it('should not call git command when not in nodejs runtime', async () => {
        process.env.NEXT_RUNTIME = 'edge';

        const response = await GET();
        const text = await response.text();

        // Should return empty string (fallback)
        expect(text).toBe('');
        expect(mockExecSync).not.toHaveBeenCalled();
      });

      it('should return empty string when git command fails', async () => {
        process.env.NEXT_RUNTIME = 'nodejs';
        mockExecSync.mockImplementation(() => {
          throw new Error('git command not found');
        });

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('');
      });
    });

    describe('response format', () => {
      it('should return response with text/plain content type', async () => {
        process.env.GIT_HASH = 'test-hash';

        const response = await GET();

        expect(response.headers.get('content-type')).toBe('text/plain');
      });

      it('should return Response object', async () => {
        process.env.GIT_HASH = 'test-hash';

        const response = await GET();

        expect(response).toBeInstanceOf(Response);
      });

      it('should return 200 status code', async () => {
        process.env.GIT_HASH = 'test-hash';

        const response = await GET();

        expect(response.status).toBe(200);
      });
    });

    describe('edge cases', () => {
      it('should handle empty environment variable values', async () => {
        process.env.CF_PAGES_COMMIT_SHA = '';
        process.env.GIT_HASH = 'fallback-hash';

        const response = await GET();
        const text = await response.text();

        // Empty string is falsy, should fall through to GIT_HASH
        expect(text).toBe('fallback-hash');
      });

      it('should handle very long git hashes', async () => {
        const longHash = 'a'.repeat(1000);
        process.env.GIT_HASH = longHash;

        const response = await GET();
        const text = await response.text();

        expect(text).toBe(longHash);
      });

      it('should handle special characters in hash', async () => {
        process.env.GIT_HASH = 'abc-123_def';

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('abc-123_def');
      });

      it('should return empty string when all sources fail', async () => {
        process.env.NEXT_RUNTIME = 'edge';
        // No env vars set, edge runtime (can't call git)

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('');
      });

      it('should handle git command returning empty output', async () => {
        process.env.NEXT_RUNTIME = 'nodejs';
        mockExecSync.mockReturnValue(Buffer.from(''));

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('');
      });
    });

    describe('runtime detection', () => {
      it('should respect NEXT_RUNTIME environment variable', async () => {
        process.env.NEXT_RUNTIME = 'nodejs';
        process.env.NODE_ENV = 'production';
        mockExecSync.mockReturnValue(Buffer.from('hash-123'));

        await GET();

        expect(mockExecSync).toHaveBeenCalled();
      });

      it('should not execute git command in edge runtime', async () => {
        process.env.NEXT_RUNTIME = 'edge';

        await GET();

        expect(mockExecSync).not.toHaveBeenCalled();
      });

      it('should execute git command in development mode', async () => {
        process.env.NEXT_RUNTIME = 'nodejs';
        process.env.NODE_ENV = 'development';
        mockExecSync.mockReturnValue(Buffer.from('dev-hash'));

        const response = await GET();
        const text = await response.text();

        expect(text).toBe('dev-hash');
        expect(mockExecSync).toHaveBeenCalled();
      });
    });
  });
});
