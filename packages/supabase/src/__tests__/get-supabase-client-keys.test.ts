import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getSupabaseClientKeys } from '../get-supabase-client-keys';

describe('get-supabase-client-keys', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getSupabaseClientKeys', () => {
    describe('successful key retrieval', () => {
      it('should return URL and public key when both are set', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key-123';

        const result = getSupabaseClientKeys();

        expect(result).toEqual({
          url: 'https://example.supabase.co',
          publicKey: 'public-key-123',
        });
      });

      it('should use NEXT_PUBLIC_SUPABASE_ANON_KEY as fallback for publicKey', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-456';

        const result = getSupabaseClientKeys();

        expect(result).toEqual({
          url: 'https://example.supabase.co',
          publicKey: 'anon-key-456',
        });
      });

      it('should prioritize NEXT_PUBLIC_SUPABASE_PUBLIC_KEY over ANON_KEY', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key-123';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-456';

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe('public-key-123');
      });

      it('should return object with correct property names', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(result).toHaveProperty('url');
        expect(result).toHaveProperty('publicKey');
        expect(Object.keys(result)).toEqual(['url', 'publicKey']);
      });

      it('should handle URLs with trailing slashes', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co/';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('https://example.supabase.co/');
      });
    });

    describe('error handling', () => {
      it('should throw error when URL is missing', () => {
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        expect(() => getSupabaseClientKeys()).toThrow();
      });

      it('should throw error when public key is missing', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';

        expect(() => getSupabaseClientKeys()).toThrow();
      });

      it('should throw error with descriptive message for missing URL', () => {
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        expect(() => getSupabaseClientKeys()).toThrow(
          /NEXT_PUBLIC_SUPABASE_URL/,
        );
      });

      it('should throw error with descriptive message for missing public key', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';

        expect(() => getSupabaseClientKeys()).toThrow(
          /NEXT_PUBLIC_SUPABASE_PUBLIC_KEY/,
        );
      });

      it('should throw error when both keys are missing', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        expect(() => getSupabaseClientKeys()).toThrow();
      });

      it('should accept empty URL string (Zod string allows empty)', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = '';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        // Zod string schema without .min() allows empty strings
        expect(result.url).toBe('');
      });

      it('should throw error when public key is empty string', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = '';

        expect(() => getSupabaseClientKeys()).toThrow();
      });

      it('should throw error when both keys are empty strings', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = '';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = '';

        expect(() => getSupabaseClientKeys()).toThrow();
      });
    });

    describe('validation', () => {
      it('should validate that URL is a string', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(typeof result.url).toBe('string');
      });

      it('should validate that publicKey is a string', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(typeof result.publicKey).toBe('string');
      });

      it('should parse and validate using Zod schema', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        // Should not throw - Zod validation passes
        expect(() => getSupabaseClientKeys()).not.toThrow();
      });

      it('should validate object structure', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(result).toMatchObject({
          url: expect.any(String),
          publicKey: expect.any(String),
        });
      });
    });

    describe('URL formats', () => {
      it('should handle standard Supabase URL format', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL =
          'https://abcdefghijklmnop.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(result.url).toMatch(/^https:\/\/.*\.supabase\.co$/);
      });

      it('should handle custom domain URLs', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.com';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('https://db.example.com');
      });

      it('should handle localhost URLs', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('http://localhost:54321');
      });

      it('should handle URLs with ports', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL =
          'https://example.supabase.co:443';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('https://example.supabase.co:443');
      });

      it('should handle URLs with subdomains', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL =
          'https://api.staging.example.com';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('https://api.staging.example.com');
      });
    });

    describe('key formats', () => {
      it('should handle JWT-like public keys', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example.signature';

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toMatch(/^eyJ/);
      });

      it('should handle very long keys', () => {
        const longKey = 'a'.repeat(1000);
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = longKey;

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe(longKey);
        expect(result.publicKey.length).toBe(1000);
      });

      it('should handle keys with special characters', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY =
          'key-with-special-!@#$%^&*()';

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe('key-with-special-!@#$%^&*()');
      });
    });

    describe('edge cases', () => {
      it('should handle whitespace in URL', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL =
          '  https://example.supabase.co  ';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();

        // Zod doesn't trim by default, returns as-is
        expect(result.url).toBe('  https://example.supabase.co  ');
      });

      it('should handle whitespace in public key', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = '  public-key  ';

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe('  public-key  ');
      });

      it('should handle undefined environment variables', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = undefined;
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = undefined;

        expect(() => getSupabaseClientKeys()).toThrow();
      });

      it('should handle keys with newlines', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key-with\nnewline';

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toContain('\n');
      });
    });

    describe('integration scenarios', () => {
      it('should work with typical production setup', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefg.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.prod';

        const result = getSupabaseClientKeys();

        expect(result.url).toMatch(/^https:\/\/.*\.supabase\.co$/);
        expect(result.publicKey).toMatch(/^eyJ/);
      });

      it('should work with local development setup', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.local';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('http://localhost:54321');
        expect(result.publicKey).toBe(
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.local',
        );
      });

      it('should work with staging environment', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL =
          'https://staging.example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.staging';

        const result = getSupabaseClientKeys();

        expect(result.url).toContain('staging');
        expect(result.publicKey).toContain('staging');
      });

      it('should work when migrating from ANON_KEY to PUBLIC_KEY', () => {
        // Start with anon key
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'old-anon-key';
        expect(getSupabaseClientKeys().publicKey).toBe('old-anon-key');

        // Add public key (should take priority)
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'new-public-key';
        expect(getSupabaseClientKeys().publicKey).toBe('new-public-key');

        // Remove anon key (public key still works)
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        expect(getSupabaseClientKeys().publicKey).toBe('new-public-key');
      });
    });

    describe('return value immutability', () => {
      it('should return a new object on each call', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result1 = getSupabaseClientKeys();
        const result2 = getSupabaseClientKeys();

        expect(result1).toEqual(result2);
        expect(result1).not.toBe(result2); // Different object references
      });

      it('should not allow modification of returned values', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key';

        const result = getSupabaseClientKeys();
        const originalUrl = result.url;

        // Try to modify (TypeScript would prevent this, but test runtime behavior)
        (result as any).url = 'modified-url';

        // Next call should still return original value
        const newResult = getSupabaseClientKeys();
        expect(newResult.url).toBe(originalUrl);
      });
    });
  });
});
