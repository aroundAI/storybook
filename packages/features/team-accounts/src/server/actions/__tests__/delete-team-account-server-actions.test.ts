import { describe, expect, it } from 'vitest';
import { DeleteTeamAccountSchema } from '../../../schema/delete-team-account.schema';

describe('deleteTeamAccountAction', () => {
  describe('schema validation', () => {
    it('should validate accountId as UUID', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        otp: '123456',
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: 'not-a-uuid',
        otp: '123456',
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty accountId', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '',
        otp: '123456',
      });

      expect(result.success).toBe(false);
    });

    it('should reject missing accountId', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        otp: '123456',
      });

      expect(result.success).toBe(false);
    });

    it('should require otp field', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.success).toBe(false);
    });

    it('should accept any non-empty otp string', () => {
      const validResult = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        otp: '123456',
      });

      expect(validResult.success).toBe(true);
    });

    it('should reject empty otp', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        otp: '',
      });

      expect(result.success).toBe(false);
    });

    it('should accept UUID with uppercase letters', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550E8400-E29B-12D3-A456-426614174000',
        otp: '123456',
      });

      expect(result.success).toBe(true);
    });

    it('should accept UUID with mixed case', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-E29B-12d3-A456-426614174000',
        otp: '123456',
      });

      expect(result.success).toBe(true);
    });

    it('should reject UUID with invalid format', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-12d3-a456-42661417400', // Missing digit
        otp: '123456',
      });

      expect(result.success).toBe(false);
    });

    it('should reject non-string accountId', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: 12345,
        otp: '123456',
      });

      expect(result.success).toBe(false);
    });

    it('should reject null accountId', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: null,
        otp: '123456',
      });

      expect(result.success).toBe(false);
    });

    it('should reject undefined accountId', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: undefined,
        otp: '123456',
      });

      expect(result.success).toBe(false);
    });

    it('should accept numeric otp', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        otp: '999999',
      });

      expect(result.success).toBe(true);
    });

    it('should accept alphanumeric otp', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        otp: 'ABC123',
      });

      expect(result.success).toBe(true);
    });

    it('should accept long otp', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        otp: '123456789012345678901234567890',
      });

      expect(result.success).toBe(true);
    });

    it('should strip extra fields', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        otp: '123456',
        extraField: 'should be ignored',
        anotherField: 123,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          accountId: '550e8400-e29b-41d4-a716-446655440000',
          otp: '123456',
        });
      }
    });
  });

  describe('schema error messages', () => {
    it('should provide clear error for invalid UUID', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: 'not-a-uuid',
        otp: '123456',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const accountIdError = result.error.errors.find(
          (e) => e.path[0] === 'accountId',
        );
        expect(accountIdError).toBeDefined();
        expect(accountIdError?.code).toBe('invalid_string');
      }
    });

    it('should provide error for missing otp', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const otpError = result.error.errors.find((e) => e.path[0] === 'otp');
        expect(otpError).toBeDefined();
      }
    });

    it('should provide error for empty otp', () => {
      const result = DeleteTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        otp: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const otpError = result.error.errors.find((e) => e.path[0] === 'otp');
        expect(otpError).toBeDefined();
        expect(otpError?.code).toBe('too_small');
      }
    });
  });
});
