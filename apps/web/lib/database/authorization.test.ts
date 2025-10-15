/**
 * Authorization Middleware Tests
 *
 * Tests the application-level Row Level Security (RLS) equivalent
 * for non-Supabase databases.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enforceRowLevelSecurity,
  hasPermission,
  type AuthorizationContext,
  type DatabaseOperation,
} from './authorization';

// Mock Supabase client
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn((_table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => mockSupabaseResponse),
          })),
          single: vi.fn(() => mockSupabaseResponse),
        })),
        single: vi.fn(() => mockSupabaseResponse),
      })),
    })),
  })),
}));

let mockSupabaseResponse: { data: unknown; error: unknown };

describe('Authorization Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseResponse = { data: null, error: null };

    // Default to non-Supabase provider for testing middleware
    process.env.DATABASE_PROVIDER = 'postgresql';
  });

  describe('enforceRowLevelSecurity', () => {
    it('should skip authorization when using Supabase RLS', async () => {
      process.env.DATABASE_PROVIDER = 'supabase';

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'notes',
        operation: 'read',
      };

      // Should not throw
      await expect(enforceRowLevelSecurity(context)).resolves.not.toThrow();
    });

    it('should allow personal account access (userId === accountId)', async () => {
      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'user-123', // Same as userId
        table: 'notes',
        operation: 'read',
      };

      await expect(enforceRowLevelSecurity(context)).resolves.not.toThrow();
    });

    it('should allow team member to read data', async () => {
      // Mock user is member of account
      mockSupabaseResponse = {
        data: { account_id: 'account-456' },
        error: null,
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'notes',
        operation: 'read',
      };

      await expect(enforceRowLevelSecurity(context)).resolves.not.toThrow();
    });

    it('should deny access to non-member', async () => {
      // Mock user is NOT a member
      mockSupabaseResponse = {
        data: null,
        error: { message: 'Not found' },
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'notes',
        operation: 'read',
      };

      await expect(enforceRowLevelSecurity(context)).rejects.toThrow(
        /Access denied/,
      );
    });

    it('should allow owner to manage resources', async () => {
      // Mock user is primary owner
      mockSupabaseResponse = {
        data: { primary_owner_user_id: 'user-123' },
        error: null,
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'accounts',
        operation: 'manage',
      };

      await expect(enforceRowLevelSecurity(context)).resolves.not.toThrow();
    });

    it('should deny non-owner from manage operations', async () => {
      // Mock: user is member but not owner
      mockSupabaseResponse = {
        data: { primary_owner_user_id: 'other-user' },
        error: null,
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'accounts',
        operation: 'manage',
      };

      await expect(enforceRowLevelSecurity(context)).rejects.toThrow(
        /Access denied/,
      );
    });
  });

  describe('hasPermission', () => {
    it('should grant all permissions to account owner', async () => {
      // Mock user is primary owner
      mockSupabaseResponse = {
        data: { primary_owner_user_id: 'user-123' },
        error: null,
      };

      const result = await hasPermission(
        'user-123',
        'account-456',
        'settings.manage',
      );

      expect(result).toBe(true);
    });

    it('should grant settings.manage to admin', async () => {
      // Mock user is admin but not primary owner
      mockSupabaseResponse = {
        data: { account_role: 'admin' },
        error: null,
      };

      const result = await hasPermission(
        'user-123',
        'account-456',
        'settings.manage',
      );

      expect(result).toBe(true);
    });

    it('should deny settings.manage to regular member', async () => {
      // Mock user is regular member
      mockSupabaseResponse = {
        data: { account_role: 'member' },
        error: null,
      };

      const result = await hasPermission(
        'user-123',
        'account-456',
        'settings.manage',
      );

      expect(result).toBe(false);
    });

    it('should grant billing.manage only to owner', async () => {
      // Mock user is admin (not owner)
      mockSupabaseResponse = {
        data: { account_role: 'admin' },
        error: null,
      };

      const result = await hasPermission(
        'user-123',
        'account-456',
        'billing.manage',
      );

      expect(result).toBe(false);
    });

    it('should grant notes.manage to member', async () => {
      // Mock user is regular member
      mockSupabaseResponse = {
        data: { account_role: 'member' },
        error: null,
      };

      const result = await hasPermission(
        'user-123',
        'account-456',
        'notes.manage',
      );

      expect(result).toBe(true);
    });

    it('should deny permission when user is not a member', async () => {
      // Mock user is not a member
      mockSupabaseResponse = {
        data: null,
        error: { message: 'Not found' },
      };

      const result = await hasPermission(
        'user-123',
        'account-456',
        'settings.manage',
      );

      expect(result).toBe(false);
    });
  });

  describe('Role-based Operations', () => {
    it('should allow write operations for member role', async () => {
      // Mock: user is a member, checking write permission
      mockSupabaseResponse = {
        data: { account_role: 'member' },
        error: null,
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'notes',
        operation: 'write',
      };

      await expect(enforceRowLevelSecurity(context)).resolves.not.toThrow();
    });

    it('should deny delete operations for member role', async () => {
      // Mock: user is a member, but members cannot delete
      mockSupabaseResponse = {
        data: { account_role: 'member' },
        error: null,
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'notes',
        operation: 'delete',
      };

      await expect(enforceRowLevelSecurity(context)).rejects.toThrow(
        /Access denied/,
      );
    });

    it('should deny all write operations for readonly role', async () => {
      // Mock: user has readonly role
      mockSupabaseResponse = {
        data: { account_role: 'readonly' },
        error: null,
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'notes',
        operation: 'write',
      };

      await expect(enforceRowLevelSecurity(context)).rejects.toThrow(
        /Read-only member/,
      );
    });

    it('should allow admin to delete resources', async () => {
      // Mock: user is admin
      mockSupabaseResponse = {
        data: { account_role: 'admin' },
        error: null,
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'notes',
        operation: 'delete',
      };

      await expect(enforceRowLevelSecurity(context)).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Mock database error
      mockSupabaseResponse = {
        data: null,
        error: { message: 'Database connection failed' },
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'notes',
        operation: 'read',
      };

      await expect(enforceRowLevelSecurity(context)).rejects.toThrow(
        /Access denied/,
      );
    });

    it('should deny access on unknown operation', async () => {
      // Mock: user is a valid member
      mockSupabaseResponse = {
        data: { account_id: 'account-456' },
        error: null,
      };

      const context: AuthorizationContext = {
        userId: 'user-123',
        accountId: 'account-456',
        table: 'notes',
        operation: 'unknown' as DatabaseOperation,
      };

      await expect(enforceRowLevelSecurity(context)).rejects.toThrow(
        /Access denied/,
      );
    });
  });
});
