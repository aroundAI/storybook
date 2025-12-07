import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import functions after mocking
import {
  getSupabaseSecretKey,
  warnServiceRoleKeyUsage,
} from '../get-secret-key';

describe('get-secret-key', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    process.env = { ...originalEnv };
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getSupabaseSecretKey', () => {
    describe('successful key retrieval', () => {
      it('should return SUPABASE_SECRET_KEY when available', () => {
        process.env.SUPABASE_SECRET_KEY = 'secret-key-123';

        const result = getSupabaseSecretKey();

        expect(result).toBe('secret-key-123');
      });

      it('should return SUPABASE_SERVICE_ROLE_KEY when SUPABASE_SECRET_KEY is not set', () => {
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-456';

        const result = getSupabaseSecretKey();

        expect(result).toBe('service-role-key-456');
      });

      it('should prioritize SUPABASE_SECRET_KEY over SUPABASE_SERVICE_ROLE_KEY', () => {
        process.env.SUPABASE_SECRET_KEY = 'secret-key-123';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-456';

        const result = getSupabaseSecretKey();

        expect(result).toBe('secret-key-123');
      });

      it('should handle very long secret keys', () => {
        const longKey = 'a'.repeat(1000);
        process.env.SUPABASE_SECRET_KEY = longKey;

        const result = getSupabaseSecretKey();

        expect(result).toBe(longKey);
        expect(result.length).toBe(1000);
      });

      it('should handle keys with special characters', () => {
        process.env.SUPABASE_SECRET_KEY = 'key-with-special-!@#$%^&*()';

        const result = getSupabaseSecretKey();

        expect(result).toBe('key-with-special-!@#$%^&*()');
      });
    });

    describe('error handling', () => {
      it('should throw error when both keys are missing', () => {
        delete process.env.SUPABASE_SECRET_KEY;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        expect(() => getSupabaseSecretKey()).toThrow();
      });

      it('should throw error with descriptive message when keys are missing', () => {
        delete process.env.SUPABASE_SECRET_KEY;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        expect(() => getSupabaseSecretKey()).toThrow(
          'Invalid Supabase Secret Key',
        );
      });

      it('should throw error when SUPABASE_SECRET_KEY is empty string', () => {
        process.env.SUPABASE_SECRET_KEY = '';

        expect(() => getSupabaseSecretKey()).toThrow();
      });

      it('should throw error when SUPABASE_SERVICE_ROLE_KEY is empty string', () => {
        process.env.SUPABASE_SERVICE_ROLE_KEY = '';

        expect(() => getSupabaseSecretKey()).toThrow();
      });

      it('should throw error when both keys are empty strings', () => {
        process.env.SUPABASE_SECRET_KEY = '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = '';

        expect(() => getSupabaseSecretKey()).toThrow();
      });
    });

    describe('validation', () => {
      it('should validate that key is a string', () => {
        process.env.SUPABASE_SECRET_KEY = 'valid-key';

        const result = getSupabaseSecretKey();

        expect(typeof result).toBe('string');
      });

      it('should validate that key is non-empty', () => {
        process.env.SUPABASE_SECRET_KEY = 'valid-key';

        const result = getSupabaseSecretKey();

        expect(result.length).toBeGreaterThan(0);
      });

      it('should parse and validate using Zod schema', () => {
        process.env.SUPABASE_SECRET_KEY = 'valid-key';

        // Should not throw - Zod validation passes
        expect(() => getSupabaseSecretKey()).not.toThrow();
      });
    });

    describe('edge cases', () => {
      it('should handle whitespace in keys', () => {
        process.env.SUPABASE_SECRET_KEY = '  key-with-spaces  ';

        const result = getSupabaseSecretKey();

        // Zod doesn't trim by default, returns as-is
        expect(result).toBe('  key-with-spaces  ');
      });

      it('should handle keys with newlines', () => {
        process.env.SUPABASE_SECRET_KEY = 'key-with\nnewline';

        const result = getSupabaseSecretKey();

        expect(result).toContain('\n');
      });

      it('should handle undefined environment variable', () => {
        process.env.SUPABASE_SECRET_KEY = undefined;
        process.env.SUPABASE_SERVICE_ROLE_KEY = undefined;

        expect(() => getSupabaseSecretKey()).toThrow();
      });
    });
  });

  describe('warnServiceRoleKeyUsage', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    describe('development environment', () => {
      it('should log warning in development mode', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalled();
      });

      it('should log correct warning message', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Supabase Secret Key'),
        );
      });

      it('should mention RLS bypass in warning', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('bypasses RLS'),
        );
      });

      it('should mention server-side usage in warning', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('server-side code'),
        );
      });

      it('should log warning without NODE_ENV set', () => {
        delete process.env.NODE_ENV;

        warnServiceRoleKeyUsage();

        // No NODE_ENV means not production, so warning should appear
        expect(consoleWarnSpy).toHaveBeenCalled();
      });
    });

    describe('production environment', () => {
      it('should not log warning in production mode', () => {
        process.env.NODE_ENV = 'production';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should not log any console output in production', () => {
        process.env.NODE_ENV = 'production';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledTimes(0);
      });
    });

    describe('test environment', () => {
      it('should log warning in test mode', () => {
        process.env.NODE_ENV = 'test';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalled();
      });
    });

    describe('multiple calls', () => {
      it('should log warning on each call in development', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();
        warnServiceRoleKeyUsage();
        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
      });

      it('should never log in production regardless of calls', () => {
        process.env.NODE_ENV = 'production';

        warnServiceRoleKeyUsage();
        warnServiceRoleKeyUsage();
        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledTimes(0);
      });
    });
  });

  describe('integration scenarios', () => {
    it('should work with typical Supabase setup', () => {
      process.env.SUPABASE_SECRET_KEY =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example';

      const key = getSupabaseSecretKey();

      expect(key).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example');
      expect(key).toMatch(/^eyJ/); // JWT-like format
    });

    it('should work with legacy service role key', () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-service-role-key';

      const key = getSupabaseSecretKey();

      expect(key).toBe('legacy-service-role-key');
    });

    it('should handle migration from service role to secret key', () => {
      // Start with service role key
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'old-key';
      expect(getSupabaseSecretKey()).toBe('old-key');

      // Add secret key (should take priority)
      process.env.SUPABASE_SECRET_KEY = 'new-key';
      expect(getSupabaseSecretKey()).toBe('new-key');

      // Remove service role key (secret key still works)
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(getSupabaseSecretKey()).toBe('new-key');
    });
  });
});
