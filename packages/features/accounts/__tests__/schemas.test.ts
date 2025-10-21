import { describe, expect, it } from 'vitest';

import { AccountDetailsSchema } from '../src/schema/account-details.schema';
import { DeletePersonalAccountSchema } from '../src/schema/delete-personal-account.schema';
import { LinkEmailPasswordSchema } from '../src/schema/link-email-password.schema';
import { UpdateEmailSchema } from '../src/schema/update-email.schema';
import { PasswordUpdateSchema } from '../src/schema/update-password.schema';

describe('Account Schemas', () => {
  describe('AccountDetailsSchema', () => {
    it('should validate valid display name', () => {
      const result = AccountDetailsSchema.safeParse({
        displayName: 'John Doe',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe('John Doe');
      }
    });

    it('should validate minimum length of 2 characters', () => {
      const result = AccountDetailsSchema.safeParse({
        displayName: 'Jo',
      });

      expect(result.success).toBe(true);
    });

    it('should validate maximum length of 100 characters', () => {
      const longName = 'a'.repeat(100);
      const result = AccountDetailsSchema.safeParse({
        displayName: longName,
      });

      expect(result.success).toBe(true);
    });

    it('should reject display name shorter than 2 characters', () => {
      const result = AccountDetailsSchema.safeParse({
        displayName: 'J',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe('too_small');
      }
    });

    it('should reject display name longer than 100 characters', () => {
      const longName = 'a'.repeat(101);
      const result = AccountDetailsSchema.safeParse({
        displayName: longName,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe('too_big');
      }
    });

    it('should reject empty display name', () => {
      const result = AccountDetailsSchema.safeParse({
        displayName: '',
      });

      expect(result.success).toBe(false);
    });

    it('should reject missing display name field', () => {
      const result = AccountDetailsSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('should accept display name with special characters', () => {
      const result = AccountDetailsSchema.safeParse({
        displayName: "O'Connor-Smith & Co.",
      });

      expect(result.success).toBe(true);
    });

    it('should accept display name with numbers', () => {
      const result = AccountDetailsSchema.safeParse({
        displayName: 'User123',
      });

      expect(result.success).toBe(true);
    });

    it('should accept display name with unicode characters', () => {
      const result = AccountDetailsSchema.safeParse({
        displayName: '用户名称',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('DeletePersonalAccountSchema', () => {
    it('should validate valid OTP', () => {
      const result = DeletePersonalAccountSchema.safeParse({
        otp: '123456',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.otp).toBe('123456');
      }
    });

    it('should validate 6-character OTP', () => {
      const result = DeletePersonalAccountSchema.safeParse({
        otp: 'ABCDEF',
      });

      expect(result.success).toBe(true);
    });

    it('should validate longer OTP codes', () => {
      const result = DeletePersonalAccountSchema.safeParse({
        otp: '12345678',
      });

      expect(result.success).toBe(true);
    });

    it('should reject OTP shorter than 6 characters', () => {
      const result = DeletePersonalAccountSchema.safeParse({
        otp: '12345',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe('too_small');
      }
    });

    it('should reject empty OTP', () => {
      const result = DeletePersonalAccountSchema.safeParse({
        otp: '',
      });

      expect(result.success).toBe(false);
    });

    it('should reject missing OTP field', () => {
      const result = DeletePersonalAccountSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('should accept alphanumeric OTP', () => {
      const result = DeletePersonalAccountSchema.safeParse({
        otp: 'ABC123',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('LinkEmailPasswordSchema', () => {
    it('should validate matching email and password', () => {
      const result = LinkEmailPasswordSchema.safeParse({
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

    it('should validate minimum password length of 8 characters', () => {
      const result = LinkEmailPasswordSchema.safeParse({
        email: 'user@example.com',
        password: 'pass1234',
        repeatPassword: 'pass1234',
      });

      expect(result.success).toBe(true);
    });

    it('should validate maximum password length of 99 characters', () => {
      const longPassword = 'a'.repeat(99);
      const result = LinkEmailPasswordSchema.safeParse({
        email: 'user@example.com',
        password: longPassword,
        repeatPassword: longPassword,
      });

      expect(result.success).toBe(true);
    });

    it('should reject password shorter than 8 characters', () => {
      const result = LinkEmailPasswordSchema.safeParse({
        email: 'user@example.com',
        password: 'pass123',
        repeatPassword: 'pass123',
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
      const result = LinkEmailPasswordSchema.safeParse({
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

    it('should reject non-matching passwords', () => {
      const result = LinkEmailPasswordSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
        repeatPassword: 'password456',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('repeatPassword');
        expect(result.error.issues[0]?.message).toContain(
          'passwordNotMatching',
        );
      }
    });

    it('should reject invalid email format', () => {
      const result = LinkEmailPasswordSchema.safeParse({
        email: 'invalid-email',
        password: 'password123',
        repeatPassword: 'password123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('email');
      }
    });

    it('should accept valid email formats', () => {
      const emails = [
        'user@example.com',
        'user.name@example.com',
        'user+tag@example.co.uk',
        'user123@test-domain.com',
      ];

      emails.forEach((email) => {
        const result = LinkEmailPasswordSchema.safeParse({
          email,
          password: 'password123',
          repeatPassword: 'password123',
        });

        expect(result.success).toBe(true);
      });
    });

    it('should reject missing fields', () => {
      const result = LinkEmailPasswordSchema.safeParse({
        email: 'user@example.com',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('UpdateEmailSchema', () => {
    it('should validate matching emails', () => {
      const schema = UpdateEmailSchema.withTranslation('Emails must match');

      const result = schema.safeParse({
        email: 'new@example.com',
        repeatEmail: 'new@example.com',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('new@example.com');
      }
    });

    it('should reject non-matching emails', () => {
      const schema = UpdateEmailSchema.withTranslation('Emails must match');

      const result = schema.safeParse({
        email: 'user@example.com',
        repeatEmail: 'different@example.com',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('repeatEmail');
        expect(result.error.issues[0]?.message).toBe('Emails must match');
      }
    });

    it('should reject invalid email format', () => {
      const schema = UpdateEmailSchema.withTranslation('Emails must match');

      const result = schema.safeParse({
        email: 'invalid-email',
        repeatEmail: 'invalid-email',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe('invalid_string');
      }
    });

    it('should accept various valid email formats', () => {
      const schema = UpdateEmailSchema.withTranslation('Emails must match');

      const emails = [
        'user@example.com',
        'test.email@domain.co.uk',
        'user+tag@example.com',
        'user_name@test-domain.com',
      ];

      emails.forEach((email) => {
        const result = schema.safeParse({
          email,
          repeatEmail: email,
        });

        expect(result.success).toBe(true);
      });
    });

    it('should use custom error message', () => {
      const customMessage = 'Custom error: Emails do not match';
      const schema = UpdateEmailSchema.withTranslation(customMessage);

      const result = schema.safeParse({
        email: 'user@example.com',
        repeatEmail: 'different@example.com',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(customMessage);
      }
    });

    it('should reject missing fields', () => {
      const schema = UpdateEmailSchema.withTranslation('Emails must match');

      const result = schema.safeParse({
        email: 'user@example.com',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('PasswordUpdateSchema', () => {
    it('should validate matching passwords', () => {
      const schema = PasswordUpdateSchema.withTranslation(
        'Passwords must match',
      );

      const result = schema.safeParse({
        newPassword: 'newpassword123',
        repeatPassword: 'newpassword123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.newPassword).toBe('newpassword123');
      }
    });

    it('should validate minimum password length of 8 characters', () => {
      const schema = PasswordUpdateSchema.withTranslation(
        'Passwords must match',
      );

      const result = schema.safeParse({
        newPassword: 'pass1234',
        repeatPassword: 'pass1234',
      });

      expect(result.success).toBe(true);
    });

    it('should validate maximum password length of 99 characters', () => {
      const schema = PasswordUpdateSchema.withTranslation(
        'Passwords must match',
      );
      const longPassword = 'a'.repeat(99);

      const result = schema.safeParse({
        newPassword: longPassword,
        repeatPassword: longPassword,
      });

      expect(result.success).toBe(true);
    });

    it('should reject password shorter than 8 characters', () => {
      const schema = PasswordUpdateSchema.withTranslation(
        'Passwords must match',
      );

      const result = schema.safeParse({
        newPassword: 'pass123',
        repeatPassword: 'pass123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.code === 'too_small'),
        ).toBe(true);
      }
    });

    it('should reject password longer than 99 characters', () => {
      const schema = PasswordUpdateSchema.withTranslation(
        'Passwords must match',
      );
      const longPassword = 'a'.repeat(100);

      const result = schema.safeParse({
        newPassword: longPassword,
        repeatPassword: longPassword,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.code === 'too_big'),
        ).toBe(true);
      }
    });

    it('should reject non-matching passwords', () => {
      const schema = PasswordUpdateSchema.withTranslation(
        'Passwords must match',
      );

      const result = schema.safeParse({
        newPassword: 'password123',
        repeatPassword: 'password456',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain('repeatPassword');
        expect(result.error.issues[0]?.message).toBe('Passwords must match');
      }
    });

    it('should use custom error message', () => {
      const customMessage = 'Custom: Passwords do not match';
      const schema = PasswordUpdateSchema.withTranslation(customMessage);

      const result = schema.safeParse({
        newPassword: 'password123',
        repeatPassword: 'password456',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(customMessage);
      }
    });

    it('should accept password with special characters', () => {
      const schema = PasswordUpdateSchema.withTranslation(
        'Passwords must match',
      );

      const result = schema.safeParse({
        newPassword: 'P@ssw0rd!123',
        repeatPassword: 'P@ssw0rd!123',
      });

      expect(result.success).toBe(true);
    });

    it('should accept password with spaces', () => {
      const schema = PasswordUpdateSchema.withTranslation(
        'Passwords must match',
      );

      const result = schema.safeParse({
        newPassword: 'pass word 123',
        repeatPassword: 'pass word 123',
      });

      expect(result.success).toBe(true);
    });

    it('should reject missing fields', () => {
      const schema = PasswordUpdateSchema.withTranslation(
        'Passwords must match',
      );

      const result = schema.safeParse({
        newPassword: 'password123',
      });

      expect(result.success).toBe(false);
    });
  });
});
