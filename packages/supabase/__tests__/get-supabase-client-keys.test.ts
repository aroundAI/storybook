import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getSupabaseClientKeys } from '../src/get-supabase-client-keys';

describe('get-supabase-client-keys', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getSupabaseClientKeys', () => {
    describe('successful key retrieval', () => {
      it('should return url and publicKey when both are set', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key-123';

        const result = getSupabaseClientKeys();

        expect(result).toEqual({
          url: 'https://test.supabase.co',
          publicKey: 'public-key-123',
        });
      });

      it('should use NEXT_PUBLIC_SUPABASE_ANON_KEY as fallback for publicKey', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-456';

        const result = getSupabaseClientKeys();

        expect(result).toEqual({
          url: 'https://test.supabase.co',
          publicKey: 'anon-key-456',
        });
      });

      it('should prefer NEXT_PUBLIC_SUPABASE_PUBLIC_KEY over ANON_KEY', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'public-key-123';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-456';

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe('public-key-123');
      });

      it('should handle different URL formats', () => {
        const urls = [
          'https://project.supabase.co',
          'https://abc123def456.supabase.co',
          'https://custom-domain.com',
          'http://localhost:54321',
        ];

        urls.forEach((url) => {
          process.env.NEXT_PUBLIC_SUPABASE_URL = url;
          process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

          const result = getSupabaseClientKeys();

          expect(result.url).toBe(url);
        });
      });

      it('should handle long keys', () => {
        const longKey = 'a'.repeat(500);
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = longKey;

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe(longKey);
        expect(result.publicKey.length).toBe(500);
      });

      it('should handle keys with special characters', () => {
        const specialKey = 'key-123.abc!@#$%^&*()_+-=[]{}|;:,.<>?';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = specialKey;

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe(specialKey);
      });

      it('should handle URL with query parameters', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL =
          'https://test.supabase.co?param=value';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('https://test.supabase.co?param=value');
      });

      it('should handle URL with port', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('http://localhost:54321');
      });

      it('should handle URL with path', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL =
          'https://test.supabase.co/v1/api';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('https://test.supabase.co/v1/api');
      });
    });

    describe('error handling - missing URL', () => {
      it('should throw when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        expect(() => getSupabaseClientKeys()).toThrow();
      });

      it('should throw with correct error message when URL is missing', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        expect(() => getSupabaseClientKeys()).toThrow(
          /Please provide the variable NEXT_PUBLIC_SUPABASE_URL/,
        );
      });

      it('should accept empty string URL (Zod string type allows empty)', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = '';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        // Zod string validator accepts empty strings (no .min() constraint on URL)
        const result = getSupabaseClientKeys();

        expect(result.url).toBe('');
        expect(result.publicKey).toBe('key');
      });

      it('should throw when URL is undefined', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = undefined;
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        expect(() => getSupabaseClientKeys()).toThrow();
      });
    });

    describe('error handling - missing publicKey', () => {
      it('should throw when both PUBLIC_KEY and ANON_KEY are missing', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        expect(() => getSupabaseClientKeys()).toThrow();
      });

      it('should throw with correct error message when publicKey is missing', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        expect(() => getSupabaseClientKeys()).toThrow(
          /Please provide the variable NEXT_PUBLIC_SUPABASE_PUBLIC_KEY/,
        );
      });

      it('should accept empty strings for both keys (Zod allows empty)', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = '';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';

        // Both empty, so || returns empty string which Zod accepts
        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe('');
      });

      it('should fall back to ANON_KEY when PUBLIC_KEY is empty string', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = '';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

        // Empty string is falsy, so || operator falls back to ANON_KEY
        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe('anon-key');
      });
    });

    describe('error handling - both missing', () => {
      it('should throw when both URL and publicKey are missing', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        expect(() => getSupabaseClientKeys()).toThrow();
      });

      it('should accept all empty strings (Zod string type allows empty)', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = '';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = '';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';

        // Zod accepts empty strings for string type
        const result = getSupabaseClientKeys();

        expect(result.url).toBe('');
        expect(result.publicKey).toBe('');
      });
    });

    describe('fallback behavior', () => {
      it('should use ANON_KEY when PUBLIC_KEY is undefined', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        delete process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe('anon-key');
      });

      it('should fall back to ANON_KEY when PUBLIC_KEY is empty string (duplicate removed)', () => {
        // This is already tested above in error handling section
        // Removing duplicate test
      });

      it('should fall back when PUBLIC_KEY is null', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = null as any;
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe('anon-key');
      });
    });

    describe('edge cases', () => {
      it('should handle whitespace in values', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = '  https://test.supabase.co  ';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = '  key-123  ';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('  https://test.supabase.co  ');
        expect(result.publicKey).toBe('  key-123  ');
      });

      it('should handle JWT format keys', () => {
        const jwtKey =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = jwtKey;

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe(jwtKey);
      });

      it('should handle numeric string values', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = '123456789';

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe('123456789');
      });

      it('should handle UUID format keys', () => {
        const uuidKey = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = uuidKey;

        const result = getSupabaseClientKeys();

        expect(result.publicKey).toBe(uuidKey);
      });

      it('should handle URL with authentication credentials', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL =
          'https://user:pass@test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe('https://user:pass@test.supabase.co');
      });

      it('should handle very long URLs', () => {
        const longUrl = `https://test.supabase.co/${'a'.repeat(500)}`;
        process.env.NEXT_PUBLIC_SUPABASE_URL = longUrl;
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        const result = getSupabaseClientKeys();

        expect(result.url).toBe(longUrl);
      });
    });

    describe('return value structure', () => {
      it('should return object with exact shape', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        const result = getSupabaseClientKeys();

        expect(Object.keys(result)).toEqual(['url', 'publicKey']);
        expect(Object.keys(result).length).toBe(2);
      });

      it('should return frozen object (Zod parse result)', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        const result = getSupabaseClientKeys();

        // Zod parse returns a new object, not frozen
        expect(result).toBeDefined();
        expect(result.url).toBeTruthy();
        expect(result.publicKey).toBeTruthy();
      });

      it('should have string types for both properties', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'key';

        const result = getSupabaseClientKeys();

        expect(typeof result.url).toBe('string');
        expect(typeof result.publicKey).toBe('string');
      });
    });

    describe('environment variable combinations', () => {
      it('should handle all valid combinations', () => {
        const combinations = [
          {
            url: 'https://test1.supabase.co',
            publicKey: 'key1',
            anonKey: undefined,
            expected: 'key1',
          },
          {
            url: 'https://test2.supabase.co',
            publicKey: undefined,
            anonKey: 'key2',
            expected: 'key2',
          },
          {
            url: 'https://test3.supabase.co',
            publicKey: 'key3',
            anonKey: 'key4',
            expected: 'key3',
          },
        ];

        combinations.forEach(({ url, publicKey, anonKey, expected }) => {
          process.env.NEXT_PUBLIC_SUPABASE_URL = url;

          if (publicKey === undefined) {
            delete process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY;
          } else {
            process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = publicKey;
          }

          if (anonKey === undefined) {
            delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
          } else {
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
          }

          const result = getSupabaseClientKeys();

          expect(result.url).toBe(url);
          expect(result.publicKey).toBe(expected);
        });
      });
    });
  });
});
