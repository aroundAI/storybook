import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Application-Level Authorization Middleware
 *
 * This module provides Row Level Security (RLS) equivalent authorization
 * for non-Supabase databases (PostgreSQL, MySQL).
 *
 * When using Supabase, RLS is enforced at the database level.
 * When using other databases, this middleware must be called before queries.
 */

export type DatabaseOperation = 'read' | 'write' | 'delete' | 'manage';

export interface AuthorizationContext {
  userId: string;
  accountId: string;
  table: string;
  operation: DatabaseOperation;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if the current database provider is Supabase
 * If true, RLS is enforced at database level - no middleware needed
 */
function isUsingSupabaseRLS(): boolean {
  const provider = process.env.DATABASE_PROVIDER || 'supabase';
  return provider === 'supabase';
}

/**
 * Enforce row-level security for non-Supabase databases
 *
 * @throws {Error} If authorization fails
 *
 * @example
 * ```typescript
 * await enforceRowLevelSecurity({
 *   userId: currentUser.id,
 *   accountId: accountId,
 *   table: 'notes',
 *   operation: 'read'
 * });
 *
 * // Now safe to query
 * const notes = await db.from('notes').select('*').where('account_id', accountId);
 * ```
 */
export async function enforceRowLevelSecurity(
  context: AuthorizationContext,
): Promise<void> {
  // If using Supabase, RLS is enforced at database level
  if (isUsingSupabaseRLS()) {
    console.log('[Authorization] Supabase RLS active - skipping middleware');
    return;
  }

  console.log('[Authorization] Enforcing application-level authorization', {
    table: context.table,
    operation: context.operation,
    userId: context.userId.substring(0, 8) + '...',
    accountId: context.accountId.substring(0, 8) + '...',
  });

  // Check authorization
  const result = await checkAuthorization(context);

  if (!result.allowed) {
    console.error('[Authorization] Access denied', {
      table: context.table,
      operation: context.operation,
      reason: result.reason,
    });

    throw new Error(
      `Access denied: ${result.reason || 'Insufficient permissions'}`,
    );
  }

  console.log('[Authorization] Access granted', {
    table: context.table,
    operation: context.operation,
  });
}

/**
 * Check if user has authorization for the requested operation
 */
async function checkAuthorization(
  context: AuthorizationContext,
): Promise<AuthorizationResult> {
  // Personal account access - user can access their own data
  if (context.accountId === context.userId) {
    return { allowed: true };
  }

  // Team account access - check role-based permissions
  const hasAccess = await hasRoleOnAccount(context.userId, context.accountId);

  if (!hasAccess) {
    return {
      allowed: false,
      reason: 'User is not a member of this account',
    };
  }

  // Check operation-specific permissions
  switch (context.operation) {
    case 'read':
      // All team members can read
      return { allowed: true };

    case 'write':
      // Check if user has write permissions for this table
      return await checkTablePermission(
        context.userId,
        context.accountId,
        context.table,
        'write',
      );

    case 'delete':
      // Check if user has delete permissions
      return await checkTablePermission(
        context.userId,
        context.accountId,
        context.table,
        'delete',
      );

    case 'manage':
      // Only owners and admins can manage
      return await checkIsAccountOwner(context.userId, context.accountId);

    default:
      return { allowed: false, reason: 'Unknown operation' };
  }
}

/**
 * Check if user has a role on the account (equivalent to Supabase's has_role_on_account)
 */
async function hasRoleOnAccount(
  userId: string,
  accountId: string,
): Promise<boolean> {
  try {
    const client = getSupabaseServerClient();

    // Query account_memberships table
    const { data, error } = await client
      .from('accounts_memberships')
      .select('account_id')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .single();

    if (error || !data) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Authorization] Error checking account membership:', error);
    return false;
  }
}

/**
 * Check if user is account owner (equivalent to Supabase's is_account_owner)
 */
async function checkIsAccountOwner(
  userId: string,
  accountId: string,
): Promise<AuthorizationResult> {
  try {
    const client = getSupabaseServerClient();

    // Check if user is primary owner
    const { data, error } = await client
      .from('accounts')
      .select('primary_owner_user_id')
      .eq('id', accountId)
      .single();

    if (error || !data) {
      return { allowed: false, reason: 'Account not found' };
    }

    const isOwner = data.primary_owner_user_id === userId;

    if (!isOwner) {
      // Also check for 'owner' role in memberships
      const { data: membershipData, error: membershipError } = await client
        .from('accounts_memberships')
        .select('account_role')
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .single();

      if (membershipError || !membershipData) {
        return { allowed: false, reason: 'User is not an owner' };
      }

      const hasOwnerRole = membershipData.account_role === 'owner';

      return {
        allowed: hasOwnerRole,
        reason: hasOwnerRole ? undefined : 'User is not an owner',
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('[Authorization] Error checking account ownership:', error);
    return { allowed: false, reason: 'Authorization check failed' };
  }
}

/**
 * Check table-specific permissions (equivalent to Supabase's has_permission)
 */
async function checkTablePermission(
  userId: string,
  accountId: string,
  table: string,
  operation: 'write' | 'delete',
): Promise<AuthorizationResult> {
  try {
    const client = getSupabaseServerClient();

    // Get user's role on the account
    const { data: membershipData, error: membershipError } = await client
      .from('accounts_memberships')
      .select('account_role')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .single();

    if (membershipError || !membershipData) {
      return { allowed: false, reason: 'User is not a member of this account' };
    }

    const role = membershipData.account_role;

    // Role-based permissions
    // owners and admins can do everything
    if (role === 'owner' || role === 'admin') {
      return { allowed: true };
    }

    // members can write but not delete
    if (role === 'member' && operation === 'write') {
      return { allowed: true };
    }

    // readonly members can only read (handled elsewhere)
    if (role === 'readonly') {
      return { allowed: false, reason: 'Read-only member cannot modify data' };
    }

    return {
      allowed: false,
      reason: `Insufficient permissions for ${operation} operation`,
    };
  } catch (error) {
    console.error('[Authorization] Error checking table permission:', error);
    return { allowed: false, reason: 'Authorization check failed' };
  }
}

/**
 * Check if user has specific permission (for custom permissions)
 *
 * @example
 * ```typescript
 * const canManageSettings = await hasPermission(
 *   userId,
 *   accountId,
 *   'settings.manage'
 * );
 * ```
 */
export async function hasPermission(
  userId: string,
  accountId: string,
  permission: string,
): Promise<boolean> {
  // For now, map permissions to roles
  // In a more advanced setup, you'd have a permissions table

  const result = await checkIsAccountOwner(userId, accountId);

  // Owners have all permissions
  if (result.allowed) {
    return true;
  }

  // Check if user has the required role
  try {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('accounts_memberships')
      .select('account_role')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .single();

    if (error || !data) {
      return false;
    }

    const role = data.account_role;

    // Permission mapping (extend as needed)
    const permissionMap: Record<string, string[]> = {
      'settings.manage': ['owner', 'admin'],
      'members.manage': ['owner', 'admin'],
      'billing.manage': ['owner'],
      'notes.manage': ['owner', 'admin', 'member'],
    };

    const allowedRoles = permissionMap[permission] || [];

    return allowedRoles.includes(role);
  } catch (error) {
    console.error('[Authorization] Error checking permission:', error);
    return false;
  }
}
