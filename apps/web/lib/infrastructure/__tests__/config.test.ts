/**
 * Infrastructure Configuration Tests
 *
 * TODO: Install vitest and implement these tests
 * Run: pnpm add -D vitest @vitest/ui
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadInfrastructureConfig } from '../config';

describe('Infrastructure Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Database Provider Validation', () => {
    it('should accept valid database provider (supabase)', () => {
      process.env.DATABASE_PROVIDER = 'supabase';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

      // Should complete other required env vars
      setDefaultEnvVars();

      expect(() => loadInfrastructureConfig()).not.toThrow();
    });

    it('should accept valid database provider (postgresql)', () => {
      process.env.DATABASE_PROVIDER = 'postgresql';
      process.env.POSTGRES_HOST = 'localhost';
      process.env.POSTGRES_PORT = '5432';
      process.env.POSTGRES_DB = 'testdb';
      process.env.POSTGRES_USER = 'testuser';
      process.env.POSTGRES_PASSWORD = 'testpass';

      setDefaultEnvVars();

      expect(() => loadInfrastructureConfig()).not.toThrow();
    });

    it('should throw on invalid database provider', () => {
      process.env.DATABASE_PROVIDER = 'invalid-provider';
      setDefaultEnvVars();

      expect(() => loadInfrastructureConfig()).toThrow(/invalid_enum_value/i);
    });

    it('should throw on missing required Supabase fields', () => {
      process.env.DATABASE_PROVIDER = 'supabase';
      // Missing NEXT_PUBLIC_SUPABASE_URL
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';

      setDefaultEnvVars();

      // Clear the URL that setDefaultEnvVars() sets to test missing URL validation
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      expect(() => loadInfrastructureConfig()).toThrow(/Invalid Supabase URL/i);
    });

    it('should throw on missing required PostgreSQL fields', () => {
      process.env.DATABASE_PROVIDER = 'postgresql';
      process.env.POSTGRES_HOST = 'localhost';
      // Missing POSTGRES_PASSWORD
      process.env.POSTGRES_DB = 'testdb';
      process.env.POSTGRES_USER = 'testuser';

      setDefaultEnvVars();

      expect(() => loadInfrastructureConfig()).toThrow(/password.*required/i);
    });
  });

  describe('Auth Provider Validation', () => {
    it('should accept valid auth provider (cognito)', () => {
      process.env.AUTH_PROVIDER = 'cognito';
      process.env.AWS_REGION = 'us-east-1';
      process.env.COGNITO_USER_POOL_ID = 'us-east-1_test123';
      process.env.COGNITO_CLIENT_ID = 'test-client-id';
      process.env.COGNITO_CLIENT_SECRET = 'test-secret';

      setDefaultEnvVars();

      expect(() => loadInfrastructureConfig()).not.toThrow();
    });

    it('should throw on invalid auth provider', () => {
      process.env.AUTH_PROVIDER = 'invalid-auth';
      setDefaultEnvVars();

      expect(() => loadInfrastructureConfig()).toThrow(/auth/i);
    });
  });

  describe('Storage Provider Validation', () => {
    it('should accept valid storage provider (s3)', () => {
      process.env.STORAGE_PROVIDER = 's3';
      process.env.AWS_REGION = 'us-east-1';
      process.env.S3_BUCKET = 'test-bucket';
      process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';

      setDefaultEnvVars();

      expect(() => loadInfrastructureConfig()).not.toThrow();
    });

    it('should throw on missing S3 bucket name', () => {
      process.env.STORAGE_PROVIDER = 's3';
      process.env.AWS_REGION = 'us-east-1';
      // Missing S3_BUCKET
      process.env.AWS_ACCESS_KEY_ID = 'test-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

      setDefaultEnvVars();

      expect(() => loadInfrastructureConfig()).toThrow(/bucket.*required/i);
    });
  });

  describe('Email Provider Validation', () => {
    it('should accept valid email provider (ses)', () => {
      process.env.EMAIL_PROVIDER = 'ses';
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_ACCESS_KEY_ID = 'test-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

      setDefaultEnvVars();

      expect(() => loadInfrastructureConfig()).not.toThrow();
    });

    it('should default to resend when EMAIL_PROVIDER not set', () => {
      // Don't set EMAIL_PROVIDER
      delete process.env.EMAIL_PROVIDER;
      process.env.RESEND_API_KEY = 'test-api-key';

      setDefaultEnvVars();

      const config = loadInfrastructureConfig();
      expect(config.email.provider).toBe('resend');
    });
  });

  describe('Optional Providers', () => {
    it('should handle optional queue provider', () => {
      process.env.QUEUE_PROVIDER = 'sqs';
      process.env.SQS_QUEUE_URL =
        'https://sqs.us-east-1.amazonaws.com/123/test';
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_ACCESS_KEY_ID = 'test-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

      setDefaultEnvVars();

      const config = loadInfrastructureConfig();
      expect(config.queue).toBeDefined();
      expect(config.queue?.provider).toBe('sqs');
    });

    it('should work without optional providers', () => {
      // Don't set any optional providers
      delete process.env.QUEUE_PROVIDER;
      delete process.env.REALTIME_PROVIDER;
      delete process.env.CACHE_PROVIDER;

      setDefaultEnvVars();

      const config = loadInfrastructureConfig();
      expect(config.queue).toBeUndefined();
      expect(config.realtime).toBeUndefined();
      expect(config.cache).toBeUndefined();
    });
  });
});

/**
 * Helper function to set default environment variables for testing
 */
function setDefaultEnvVars() {
  // Set defaults for required providers if not already set
  if (!process.env.DATABASE_PROVIDER) {
    process.env.DATABASE_PROVIDER = 'supabase';
  }

  if (process.env.DATABASE_PROVIDER === 'supabase') {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';
  }

  if (!process.env.AUTH_PROVIDER) {
    process.env.AUTH_PROVIDER = 'supabase';
  }

  if (!process.env.STORAGE_PROVIDER) {
    process.env.STORAGE_PROVIDER = 'supabase';
  }

  // Set AWS credentials as defaults (required for SES, S3, Cognito, etc.)
  process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID =
    process.env.AWS_ACCESS_KEY_ID || 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY =
    process.env.AWS_SECRET_ACCESS_KEY || 'test-secret-key';

  if (!process.env.EMAIL_PROVIDER) {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 'test-api-key';
  }
}
