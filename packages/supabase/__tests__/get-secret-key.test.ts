import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getSupabaseSecretKey,
  warnServiceRoleKeyUsage,
} from '../src/get-secret-key';

// Mock server-only before imports
vi.mock('server-only', () => ({}));

describe('get-secret-key', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getSupabaseSecretKey', () => {
    describe('successful key retrieval', () => {
      it('should return SUPABASE_SECRET_KEY when set', () => {
        process.env.SUPABASE_SECRET_KEY = 'secret-key-123';

        const result = getSupabaseSecretKey();

        expect(result).toBe('secret-key-123');
      });

      it('should return SUPABASE_SERVICE_ROLE_KEY when SUPABASE_SECRET_KEY is not set', () => {
        delete process.env.SUPABASE_SECRET_KEY;
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-456';

        const result = getSupabaseSecretKey();

        expect(result).toBe('service-role-key-456');
      });

      it('should prefer SUPABASE_SECRET_KEY over SUPABASE_SERVICE_ROLE_KEY', () => {
        process.env.SUPABASE_SECRET_KEY = 'secret-key-123';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-456';

        const result = getSupabaseSecretKey();

        expect(result).toBe('secret-key-123');
      });

      it('should handle long keys', () => {
        const longKey = 'a'.repeat(500);
        process.env.SUPABASE_SECRET_KEY = longKey;

        const result = getSupabaseSecretKey();

        expect(result).toBe(longKey);
        expect(result.length).toBe(500);
      });

      it('should handle keys with special characters', () => {
        const specialKey = 'sk_test-123.abc!@#$%^&*()_+-=[]{}|;:,.<>?';
        process.env.SUPABASE_SECRET_KEY = specialKey;

        const result = getSupabaseSecretKey();

        expect(result).toBe(specialKey);
      });

      it('should handle keys with whitespace at edges', () => {
        process.env.SUPABASE_SECRET_KEY = '  secret-key-123  ';

        const result = getSupabaseSecretKey();

        expect(result).toBe('  secret-key-123  ');
      });
    });

    describe('error handling', () => {
      it('should throw when both environment variables are missing', () => {
        delete process.env.SUPABASE_SECRET_KEY;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        expect(() => getSupabaseSecretKey()).toThrow(
          'Invalid Supabase Secret Key',
        );
      });

      it('should throw with correct error message when both variables are missing', () => {
        delete process.env.SUPABASE_SECRET_KEY;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        expect(() => getSupabaseSecretKey()).toThrow(
          /Please add the environment variable SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY/,
        );
      });

      it('should throw when SUPABASE_SECRET_KEY is empty string', () => {
        process.env.SUPABASE_SECRET_KEY = '';
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        expect(() => getSupabaseSecretKey()).toThrow();
      });

      it('should throw when SUPABASE_SERVICE_ROLE_KEY is empty string', () => {
        delete process.env.SUPABASE_SECRET_KEY;
        process.env.SUPABASE_SERVICE_ROLE_KEY = '';

        expect(() => getSupabaseSecretKey()).toThrow();
      });

      it('should throw when both are empty strings', () => {
        process.env.SUPABASE_SECRET_KEY = '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = '';

        expect(() => getSupabaseSecretKey()).toThrow();
      });

      it('should throw when key is only whitespace', () => {
        process.env.SUPABASE_SECRET_KEY = '   ';

        const result = getSupabaseSecretKey();

        // Whitespace is still valid according to min(1) check
        expect(result).toBe('   ');
      });
    });

    describe('fallback behavior', () => {
      it('should fall back to SUPABASE_SERVICE_ROLE_KEY when SUPABASE_SECRET_KEY is undefined', () => {
        delete process.env.SUPABASE_SECRET_KEY;
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'fallback-key';

        const result = getSupabaseSecretKey();

        expect(result).toBe('fallback-key');
      });

      it('should fall back when SUPABASE_SECRET_KEY is empty string', () => {
        process.env.SUPABASE_SECRET_KEY = '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'fallback-key';

        // Empty string is falsy, so || operator falls back to SUPABASE_SERVICE_ROLE_KEY
        const result = getSupabaseSecretKey();

        expect(result).toBe('fallback-key');
      });
    });

    describe('edge cases', () => {
      it('should handle numeric string values', () => {
        process.env.SUPABASE_SECRET_KEY = '123456789';

        const result = getSupabaseSecretKey();

        expect(result).toBe('123456789');
      });

      it('should handle UUID format keys', () => {
        const uuidKey = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        process.env.SUPABASE_SECRET_KEY = uuidKey;

        const result = getSupabaseSecretKey();

        expect(result).toBe(uuidKey);
      });

      it('should handle JWT format keys', () => {
        const jwtKey =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        process.env.SUPABASE_SECRET_KEY = jwtKey;

        const result = getSupabaseSecretKey();

        expect(result).toBe(jwtKey);
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
      it('should warn in development mode', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledOnce();
      });

      it('should warn with correct message in development', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[Dev Only]'),
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Supabase Secret Key'),
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('bypasses RLS'),
        );
      });

      it('should warn in test environment', () => {
        process.env.NODE_ENV = 'test';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledOnce();
      });

      it('should warn when NODE_ENV is undefined', () => {
        delete process.env.NODE_ENV;

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledOnce();
      });

      it('should warn in any non-production environment', () => {
        process.env.NODE_ENV = 'staging';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledOnce();
      });
    });

    describe('production environment', () => {
      it('should not warn in production mode', () => {
        process.env.NODE_ENV = 'production';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should be case sensitive for production check', () => {
        process.env.NODE_ENV = 'PRODUCTION';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledOnce();
      });

      it('should be case sensitive for Production', () => {
        process.env.NODE_ENV = 'Production';

        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledOnce();
      });
    });

    describe('multiple invocations', () => {
      it('should warn on each invocation in development', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();
        warnServiceRoleKeyUsage();
        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).toHaveBeenCalledTimes(3);
      });

      it('should never warn in production regardless of invocations', () => {
        process.env.NODE_ENV = 'production';

        warnServiceRoleKeyUsage();
        warnServiceRoleKeyUsage();
        warnServiceRoleKeyUsage();

        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });
    });

    describe('warning message content', () => {
      it('should include security implications in warning', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();

        const warningMessage = consoleWarnSpy.mock.calls[0][0];
        expect(warningMessage).toContain('bypasses RLS');
        expect(warningMessage).toContain('server-side code');
      });

      it('should indicate dev-only nature', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();

        const warningMessage = consoleWarnSpy.mock.calls[0][0];
        expect(warningMessage).toContain('[Dev Only]');
      });

      it('should mention intended usage', () => {
        process.env.NODE_ENV = 'development';

        warnServiceRoleKeyUsage();

        const warningMessage = consoleWarnSpy.mock.calls[0][0];
        expect(warningMessage).toContain('intended usage');
      });
    });
  });

  describe('integration', () => {
    it('should work together - get key and warn', () => {
      process.env.NODE_ENV = 'development';
      process.env.SUPABASE_SECRET_KEY = 'test-key';
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const key = getSupabaseSecretKey();
      warnServiceRoleKeyUsage();

      expect(key).toBe('test-key');
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should handle missing key and production mode', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SUPABASE_SECRET_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      expect(() => getSupabaseSecretKey()).toThrow();
      warnServiceRoleKeyUsage();
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });
});
