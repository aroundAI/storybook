import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeaveTeamAccountSchema } from '../../../schema/leave-team-account.schema';

describe('leaveTeamAccountAction', () => {
  describe('schema validation', () => {
    it('should validate accountId as UUID', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: 'not-a-uuid',
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty accountId', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: '',
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(false);
    });

    it('should reject missing accountId', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(false);
    });

    it('should require confirmation field', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.success).toBe(false);
    });

    it('should require exact confirmation text LEAVE', () => {
      const validResult = LeaveTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        confirmation: 'LEAVE',
      });

      expect(validResult.success).toBe(true);

      const invalidResult = LeaveTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        confirmation: 'leave',
      });

      expect(invalidResult.success).toBe(false);
    });

    it('should reject wrong confirmation text', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        confirmation: 'CONFIRM',
      });

      expect(result.success).toBe(false);
    });

    it('should accept UUID with uppercase letters', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: '550E8400-E29B-12D3-A456-426614174000',
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(true);
    });

    it('should accept UUID with mixed case', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: '550e8400-E29B-12d3-A456-426614174000',
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(true);
    });

    it('should reject UUID with invalid format', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-12d3-a456-42661417400', // Missing digit
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(false);
    });

    it('should reject non-string accountId', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: 12345,
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(false);
    });

    it('should reject null accountId', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: null,
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(false);
    });

    it('should reject undefined accountId', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: undefined,
        confirmation: 'LEAVE',
      });

      expect(result.success).toBe(false);
    });

    it('should strip extra fields', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
        confirmation: 'LEAVE',
        extraField: 'should be ignored',
        anotherField: 123,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          accountId: '550e8400-e29b-41d4-a716-446655440000',
          confirmation: 'LEAVE',
        });
      }
    });
  });

  describe('schema error messages', () => {
    it('should provide clear error for invalid UUID', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: 'not-a-uuid',
        confirmation: 'LEAVE',
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

    it('should provide error for missing confirmation', () => {
      const result = LeaveTeamAccountSchema.safeParse({
        accountId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const confirmationError = result.error.errors.find(
          (e) => e.path[0] === 'confirmation',
        );
        expect(confirmationError).toBeDefined();
      }
    });
  });
});
