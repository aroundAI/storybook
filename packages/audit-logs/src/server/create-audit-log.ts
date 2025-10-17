import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import type { CreateAuditLogParams } from '../types';
import { shouldTrackObject, getTransformer } from '../config';
import { calculateChanges } from './calculate-changes';

/**
 * Create an audit log entry
 *
 * Features:
 * - Checks if object type should be tracked (via configuration)
 * - Applies object-specific transformers before saving
 * - Automatically calculates changes between before/after states
 * - Captures network information (IP, user agent)
 * - Flexible scoping for multi-level queries
 *
 * @param params - Audit log parameters
 * @returns Promise that resolves when audit log is created
 *
 * @example
 * ```typescript
 * await createAuditLog({
 *   accountId,
 *   userId,
 *   action: 'create',
 *   objectType: 'project',
 *   objectId: project.id,
 *   objectName: project.name,
 *   after: project,
 *   scopes: [
 *     { type: 'account', id: accountId },
 *     { type: 'project', id: project.id },
 *   ],
 * });
 * ```
 */
export async function createAuditLog(
  params: CreateAuditLogParams,
): Promise<void> {
  const logger = await getLogger();
  const ctx = {
    name: 'create-audit-log',
    objectType: params.objectType,
    action: params.action,
  };

  try {
    // Check if this object type should be tracked
    if (!shouldTrackObject(params.objectType, params.action)) {
      logger.debug(
        ctx,
        `Skipping audit log for ${params.objectType}:${params.action} (disabled in config)`,
      );
      return;
    }

    // Get transformer for this object type (always returns a transformer)
    const transformer = getTransformer(params.objectType);

    // Transform before/after data (transformer is guaranteed to exist)
    let transformedBefore = params.before;
    let transformedAfter = params.after;
    let description =
      params.objectName
        ? `${params.action} ${params.objectType} "${params.objectName}"`
        : `${params.action} ${params.objectType}`;

    // Apply transformation
    if (params.before) {
      transformedBefore = await transformer.transform(
        params.before,
        params.action,
      );
    }

    if (params.after) {
      transformedAfter = await transformer.transform(
        params.after,
        params.action,
      );
    }

    // Get custom description if provided
    if (transformer.getDescription) {
      description = transformer.getDescription(
        params.after || params.before,
        params.action,
      );
    }

    // Calculate changes
    let changes = null;

    if (transformedBefore && transformedAfter) {
      if (transformer.calculateChanges) {
        // Use custom change calculation
        changes = transformer.calculateChanges(
          transformedBefore,
          transformedAfter,
        );
      } else {
        // Use default change calculation
        changes = calculateChanges(transformedBefore, transformedAfter);
      }
    }

    // Get client and insert audit log
    const client = getSupabaseServerClient();

    const { error } = await client.from('audit_logs').insert({
      account_id: params.accountId,
      user_id: params.userId,
      action: params.action,
      object_type: params.objectType,
      object_id: params.objectId,
      object_name: params.objectName || null,
      description,
      changes: (changes as Json) || null,
      before_state: (transformedBefore as Json) || null,
      after_state: (transformedAfter as Json) || null,
      scopes: (params.scopes || [
        { type: 'account', id: params.accountId },
      ]) as Json,
      severity: params.severity || 'info',
      metadata: (params.metadata as Json) || null,
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
    });

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to create audit log');
      // Don't throw - audit logging should not break the main operation
      return;
    }

    logger.debug(ctx, 'Audit log created successfully');
  } catch (error) {
    logger.error({ ...ctx, error }, 'Error creating audit log');
    // Don't throw - audit logging should not break the main operation
  }
}

/**
 * Create multiple audit logs in a batch
 *
 * @param logs - Array of audit log parameters
 */
export async function createAuditLogsBatch(
  logs: CreateAuditLogParams[],
): Promise<void> {
  await Promise.all(logs.map((log) => createAuditLog(log)));
}
