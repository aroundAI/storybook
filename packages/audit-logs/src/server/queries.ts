import 'server-only';

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { AuditAction, AuditLogEntry } from '../types';

/**
 * Get audit logs for a specific object
 *
 * @param objectType - Type of object (e.g., 'project', 'user')
 * @param objectId - ID of the object
 * @param limit - Maximum number of logs to return (default: 50)
 * @returns Array of audit log entries
 */
export async function getAuditLogsForObject(
  objectType: string,
  objectId: string,
  limit = 50,
): Promise<AuditLogEntry[]> {
  const logger = await getLogger();
  const ctx = { name: 'get-audit-logs-for-object', objectType, objectId };

  try {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('audit_logs')
      .select('*')
      .eq('object_type', objectType)
      .eq('object_id', objectId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch audit logs');
      throw error;
    }

    return data as AuditLogEntry[];
  } catch (error) {
    logger.error({ ...ctx, error }, 'Error fetching audit logs');
    throw error;
  }
}

/**
 * Get audit logs for a specific scope
 *
 * Example: Get all logs for a project (including project changes and related objects)
 *
 * @param scopeType - Type of scope (e.g., 'project', 'account')
 * @param scopeId - ID of the scope
 * @param limit - Maximum number of logs to return (default: 50)
 * @returns Array of audit log entries
 */
export async function getAuditLogsForScope(
  scopeType: string,
  scopeId: string,
  limit = 50,
): Promise<AuditLogEntry[]> {
  const logger = await getLogger();
  const ctx = { name: 'get-audit-logs-for-scope', scopeType, scopeId };

  try {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('get_audit_logs_for_scope', {
      scope_type: scopeType,
      scope_id: scopeId,
      limit_count: limit,
    });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch audit logs for scope');
      throw error;
    }

    return data as AuditLogEntry[];
  } catch (error) {
    logger.error({ ...ctx, error }, 'Error fetching audit logs for scope');
    throw error;
  }
}

/**
 * Get recent audit logs for an account
 *
 * @param accountId - Account ID
 * @param limit - Maximum number of logs to return (default: 100)
 * @returns Array of audit log entries
 */
export async function getRecentAuditLogs(
  accountId: string,
  limit = 100,
): Promise<AuditLogEntry[]> {
  const logger = await getLogger();
  const ctx = { name: 'get-recent-audit-logs', accountId };

  try {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('get_recent_audit_logs', {
      target_account_id: accountId,
      limit_count: limit,
    });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch recent audit logs');
      throw error;
    }

    return data as AuditLogEntry[];
  } catch (error) {
    logger.error({ ...ctx, error }, 'Error fetching recent audit logs');
    throw error;
  }
}

/**
 * Get audit logs by user
 *
 * @param userId - User ID
 * @param accountId - Account ID
 * @param limit - Maximum number of logs to return (default: 50)
 * @returns Array of audit log entries
 */
export async function getAuditLogsByUser(
  userId: string,
  accountId: string,
  limit = 50,
): Promise<AuditLogEntry[]> {
  const logger = await getLogger();
  const ctx = { name: 'get-audit-logs-by-user', userId, accountId };

  try {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('get_audit_logs_by_user', {
      target_user_id: userId,
      target_account_id: accountId,
      limit_count: limit,
    });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch audit logs by user');
      throw error;
    }

    return data as AuditLogEntry[];
  } catch (error) {
    logger.error({ ...ctx, error }, 'Error fetching audit logs by user');
    throw error;
  }
}

/**
 * Get audit logs by action
 *
 * @param accountId - Account ID
 * @param action - Action type
 * @param limit - Maximum number of logs to return (default: 50)
 * @returns Array of audit log entries
 */
export async function getAuditLogsByAction(
  accountId: string,
  action: AuditAction,
  limit = 50,
): Promise<AuditLogEntry[]> {
  const logger = await getLogger();
  const ctx = { name: 'get-audit-logs-by-action', accountId, action };

  try {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('get_audit_logs_by_action', {
      target_account_id: accountId,
      target_action: action,
      limit_count: limit,
    });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch audit logs by action');
      throw error;
    }

    return data as AuditLogEntry[];
  } catch (error) {
    logger.error({ ...ctx, error }, 'Error fetching audit logs by action');
    throw error;
  }
}

/**
 * Get change summary for an object type
 *
 * Returns statistics about which fields changed most frequently
 *
 * @param accountId - Account ID
 * @param objectType - Type of object
 * @param daysBack - Number of days to look back (default: 30)
 * @returns Array of field names with change counts
 */
export async function getChangeSummary(
  accountId: string,
  objectType: string,
  daysBack = 30,
): Promise<Array<{ field_name: string; change_count: number }>> {
  const logger = await getLogger();
  const ctx = { name: 'get-change-summary', accountId, objectType, daysBack };

  try {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('get_change_summary', {
      target_account_id: accountId,
      target_object_type: objectType,
      days_back: daysBack,
    });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch change summary');
      throw error;
    }

    return data || [];
  } catch (error) {
    logger.error({ ...ctx, error }, 'Error fetching change summary');
    throw error;
  }
}
