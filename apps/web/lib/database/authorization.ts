import 'server-only';

import { createCacheClient } from '@kit/cache';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Cache TTL for authorization checks (5 minutes)
const AUTH_CACHE_TTL = 300;

// Lazy-initialize cache client
let cacheClient: ReturnType<typeof createCacheClient> | null = null;

function getCache() {
  if (!cacheClient) {
    cacheClient = createCacheClient();
  }
  return cacheClient;
}

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
  const cacheKey = `auth:role:${userId}:${accountId}`;

  try {
    const cache = getCache();

    // Try cache first
    const cached = await cache.get<boolean>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - query database
    const client = getSupabaseServerClient();

    // Query account_memberships table
    const { data, error } = await client
      .from('accounts_memberships')
      .select('account_id')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .single();

    const hasRole = !error && !!data;

    // Cache result
    await cache.set(cacheKey, hasRole, AUTH_CACHE_TTL);

    return hasRole;
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
  const cacheKey = `auth:perm:${userId}:${accountId}:${table}:${operation}`;

  try {
    const cache = getCache();

    // Try cache first
    const cached = await cache.get<AuthorizationResult>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - query database
    const client = getSupabaseServerClient();

    // Get user's role on the account
    const { data: membershipData, error: membershipError } = await client
      .from('accounts_memberships')
      .select('account_role')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .single();

    if (membershipError || !membershipData) {
      const result = {
        allowed: false,
        reason: 'User is not a member of this account',
      };
      await cache.set(cacheKey, result, AUTH_CACHE_TTL);
      return result;
    }

    const role = membershipData.account_role;

    let result: AuthorizationResult;

    // Role-based permissions
    // owners and admins can do everything
    if (role === 'owner' || role === 'admin') {
      result = { allowed: true };
    }
    // members can write but not delete
    else if (role === 'member' && operation === 'write') {
      result = { allowed: true };
    }
    // readonly members can only read (handled elsewhere)
    else if (role === 'readonly') {
      result = {
        allowed: false,
        reason: 'Read-only member cannot modify data',
      };
    } else {
      result = {
        allowed: false,
        reason: `Insufficient permissions for ${operation} operation`,
      };
    }

    // Cache result
    await cache.set(cacheKey, result, AUTH_CACHE_TTL);

    return result;
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
  const cacheKey = `auth:custom:${userId}:${accountId}:${permission}`;

  try {
    const cache = getCache();

    // Try cache first
    const cached = await cache.get<boolean>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // For now, map permissions to roles
    // In a more advanced setup, you'd have a permissions table

    const result = await checkIsAccountOwner(userId, accountId);

    // Owners have all permissions
    if (result.allowed) {
      await cache.set(cacheKey, true, AUTH_CACHE_TTL);
      return true;
    }

    // Check if user has the required role
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('accounts_memberships')
      .select('account_role')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .single();

    if (error || !data) {
      await cache.set(cacheKey, false, AUTH_CACHE_TTL);
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
    const hasAccess = allowedRoles.includes(role);

    // Cache result
    await cache.set(cacheKey, hasAccess, AUTH_CACHE_TTL);

    return hasAccess;
  } catch (error) {
    console.error('[Authorization] Error checking permission:', error);
    return false;
  }
}

/**
 * Invalidate authorization cache for a user
 *
 * Call this when user's roles or permissions change (e.g., role updated, removed from account)
 *
 * @example
 * ```typescript
 * // After updating user's role
 * await invalidateAuthCache(userId, accountId);
 * ```
 */
export async function invalidateAuthCache(
  userId: string,
  accountId: string,
): Promise<void> {
  try {
    const cache = getCache();

    // Delete all auth cache entries for this user+account combination
    await cache.del(`auth:role:${userId}:${accountId}`);
    await cache.del(`auth:perm:${userId}:${accountId}:*`);
    await cache.del(`auth:custom:${userId}:${accountId}:*`);

    console.log('[Authorization] Cache invalidated for user:', {
      userId: userId.substring(0, 8) + '...',
      accountId: accountId.substring(0, 8) + '...',
    });
  } catch (error) {
    console.error('[Authorization] Error invalidating cache:', error);
  }
}
