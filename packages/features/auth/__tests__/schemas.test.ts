import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { PasswordResetSchema } from '../src/schemas/password-reset.schema';
import { PasswordSignInSchema } from '../src/schemas/password-sign-in.schema';
import { PasswordSignUpSchema } from '../src/schemas/password-sign-up.schema';
import {
  PasswordSchema,
  RefinedPasswordSchema,
} from '../src/schemas/password.schema';

describe('Auth Schemas', () => {
  // Store original env values
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to default (no requirements)
    delete process.env.NEXT_PUBLIC_PASSWORD_REQUIRE_SPECIAL_CHARS;
    delete process.env.NEXT_PUBLIC_PASSWORD_REQUIRE_NUMBERS;
    delete process.env.NEXT_PUBLIC_PASSWORD_REQUIRE_UPPERCASE;
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  describe('PasswordSchema', () => {
    it('should validate password with minimum length of 8 characters', () => {
      const result = PasswordSchema.safeParse('password');

      expect(result.success).toBe(true);
    });

    it('should validate password with exactly 8 characters', () => {
      const result = PasswordSchema.safeParse('pass1234');

      expect(result.success).toBe(true);
    });

    it('should validate password with maximum length of 99 characters', () => {
      const longPassword = 'a'.repeat(99);
      const result = PasswordSchema.safeParse(longPassword);

      expect(result.success).toBe(true);
    });

    it('should reject password shorter than 8 characters', () => {
      const result = PasswordSchema.safeParse('short');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe('too_small');
      }
    });

    it('should reject password longer than 99 characters', () => {
      const longPassword = 'a'.repeat(100);
      const result = PasswordSchema.safeParse(longPassword);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe('too_big');
      }
    });

    it('should accept password with special characters', () => {
      const result = PasswordSchema.safeParse('P@ssw0rd!');

      expect(result.success).toBe(true);
    });

    it('should accept password with numbers', () => {
      const result = PasswordSchema.safeParse('password123');

      expect(result.success).toBe(true);
    });

    it('should accept password with uppercase letters', () => {
      const result = PasswordSchema.safeParse('Password');

      expect(result.success).toBe(true);
    });

    it('should accept password with only lowercase letters', () => {
      const result = PasswordSchema.safeParse('password');

      expect(result.success).toBe(true);
    });

    it('should accept password with spaces', () => {
      const result = PasswordSchema.safeParse('pass word 123');

      expect(result.success).toBe(true);
    });
  });

  describe('RefinedPasswordSchema - No Requirements', () => {
    it('should validate simple password when no requirements are set', () => {
      const result = RefinedPasswordSchema.safeParse('password');

      expect(result.success).toBe(true);
    });

    it('should validate password with only lowercase', () => {
      const result = RefinedPasswordSchema.safeParse('simplepass');

      expect(result.success).toBe(true);
    });
  });

  describe('RefinedPasswordSchema - Special Characters Required', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_PASSWORD_REQUIRE_SPECIAL_CHARS = 'true';
    });

    it('should accept password with special characters', async () => {
      // Re-import to get fresh module with new env
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('Pass@word1');

      expect(result.success).toBe(true);
    });

    it('should accept password with various special characters', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const specialChars = ['!', '@', '#', '$', '%', '^', '&', '*'];

      for (const char of specialChars) {
        const result = Schema.safeParse(`password${char}`);
        expect(result.success).toBe(true);
      }
    });

    it('should reject password without special characters', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('Password1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          'auth:errors.minPasswordSpecialChars',
        );
      }
    });
  });

  describe('RefinedPasswordSchema - Numbers Required', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_PASSWORD_REQUIRE_NUMBERS = 'true';
    });

    it('should accept password with numbers', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('Password123');

      expect(result.success).toBe(true);
    });

    it('should reject password without numbers', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('Password');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          'auth:errors.minPasswordNumbers',
        );
      }
    });
  });

  describe('RefinedPasswordSchema - Uppercase Required', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_PASSWORD_REQUIRE_UPPERCASE = 'true';
    });

    it('should accept password with uppercase letters', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('Password');

      expect(result.success).toBe(true);
    });

    it('should reject password without uppercase letters', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('password');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          'auth:errors.uppercasePassword',
        );
      }
    });
  });

  describe('RefinedPasswordSchema - All Requirements', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_PASSWORD_REQUIRE_SPECIAL_CHARS = 'true';
      process.env.NEXT_PUBLIC_PASSWORD_REQUIRE_NUMBERS = 'true';
      process.env.NEXT_PUBLIC_PASSWORD_REQUIRE_UPPERCASE = 'true';
    });

    it('should accept password meeting all requirements', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('P@ssw0rd');

      expect(result.success).toBe(true);
    });

    it('should reject password missing special characters', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('Password1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (issue) => issue.message === 'auth:errors.minPasswordSpecialChars',
          ),
        ).toBe(true);
      }
    });

    it('should reject password missing numbers', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('P@ssword');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (issue) => issue.message === 'auth:errors.minPasswordNumbers',
          ),
        ).toBe(true);
      }
    });

    it('should reject password missing uppercase', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('p@ssw0rd');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (issue) => issue.message === 'auth:errors.uppercasePassword',
          ),
        ).toBe(true);
      }
    });

    it('should collect multiple validation errors', async () => {
      const { RefinedPasswordSchema: Schema } = await import(
        '../src/schemas/password.schema'
      );

      const result = Schema.safeParse('password'); // Missing all requirements

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('PasswordSignInSchema', () => {
    it('should validate valid email and password', () => {
      const result = PasswordSignInSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('user@example.com');
        expect(result.data.password).toBe('password123');
      }
    });

    it('should accept various valid email formats', () => {
      const emails = [
        'user@example.com',
        'test.email@domain.co.uk',
        'user+tag@example.com',
        'user_name@test-domain.com',
      ];

      emails.forEach((email) => {
        const result = PasswordSignInSchema.safeParse({
          email,
          password: 'password123',
        });

        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid email format', () => {
      const result = PasswordSignInSchema.safeParse({
        email: 'invalid-email',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('email');
      }
    });

    it('should reject password shorter than 8 characters', () => {
      const result = PasswordSignInSchema.safeParse({
        email: 'user@example.com',
        password: 'short',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.code === 'too_small'),
        ).toBe(true);
      }
    });

    it('should reject missing fields', () => {
      const result = PasswordSignInSchema.safeParse({
        email: 'user@example.com',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('PasswordSignUpSchema', () => {
    it('should validate matching passwords', () => {
      const result = PasswordSignUpSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
        repeatPassword: 'password123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('user@example.com');
        expect(result.data.password).toBe('password123');
      }
    });

    it('should reject non-matching passwords', () => {
      const result = PasswordSignUpSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
        repeatPassword: 'differentpass',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('repeatPassword');
        expect(result.error.issues[0]?.message).toBe(
          'auth:errors.passwordsDoNotMatch',
        );
      }
    });

    it('should reject invalid email format', () => {
      const result = PasswordSignUpSchema.safeParse({
        email: 'invalid-email',
        password: 'password123',
        repeatPassword: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('email');
      }
    });

    it('should reject password shorter than 8 characters', () => {
      const result = PasswordSignUpSchema.safeParse({
        email: 'user@example.com',
        password: 'short',
        repeatPassword: 'short',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.code === 'too_small'),
        ).toBe(true);
      }
    });

    it('should reject password longer than 99 characters', () => {
      const longPassword = 'a'.repeat(100);

      const result = PasswordSignUpSchema.safeParse({
        email: 'user@example.com',
        password: longPassword,
        repeatPassword: longPassword,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.code === 'too_big'),
        ).toBe(true);
      }
    });

    it('should accept password with special characters', () => {
      const result = PasswordSignUpSchema.safeParse({
        email: 'user@example.com',
        password: 'P@ssw0rd!',
        repeatPassword: 'P@ssw0rd!',
      });

      expect(result.success).toBe(true);
    });

    it('should reject missing fields', () => {
      const result = PasswordSignUpSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('PasswordResetSchema', () => {
    it('should validate matching passwords', () => {
      const result = PasswordResetSchema.safeParse({
        password: 'newpassword123',
        repeatPassword: 'newpassword123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.password).toBe('newpassword123');
      }
    });

    it('should reject non-matching passwords', () => {
      const result = PasswordResetSchema.safeParse({
        password: 'password123',
        repeatPassword: 'differentpass',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('repeatPassword');
        expect(result.error.issues[0]?.message).toBe(
          'auth:errors.passwordsDoNotMatch',
        );
      }
    });

    it('should reject password shorter than 8 characters', () => {
      const result = PasswordResetSchema.safeParse({
        password: 'short',
        repeatPassword: 'short',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.code === 'too_small'),
        ).toBe(true);
      }
    });

    it('should reject password longer than 99 characters', () => {
      const longPassword = 'a'.repeat(100);

      const result = PasswordResetSchema.safeParse({
        password: longPassword,
        repeatPassword: longPassword,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.code === 'too_big'),
        ).toBe(true);
      }
    });

    it('should accept password with special characters', () => {
      const result = PasswordResetSchema.safeParse({
        password: 'P@ssw0rd!123',
        repeatPassword: 'P@ssw0rd!123',
      });

      expect(result.success).toBe(true);
    });

    it('should accept password with spaces', () => {
      const result = PasswordResetSchema.safeParse({
        password: 'pass word 123',
        repeatPassword: 'pass word 123',
      });

      expect(result.success).toBe(true);
    });

    it('should reject missing fields', () => {
      const result = PasswordResetSchema.safeParse({
        password: 'password123',
      });

      expect(result.success).toBe(false);
    });
  });
});
