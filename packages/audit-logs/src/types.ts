import { z } from 'zod';

// Audit action enum
export const AuditAction = z.enum([
  'create',
  'update',
  'delete',
  'archive',
  'restore',
  'login',
  'logout',
  'invite',
  'accept_invite',
  'reject_invite',
  'permission_change',
  'settings_change',
  'export',
  'import',
  'custom',
]);

export type AuditAction = z.infer<typeof AuditAction>;

// Audit severity enum
export const AuditSeverity = z.enum(['info', 'warning', 'critical']);

export type AuditSeverity = z.infer<typeof AuditSeverity>;

// Audit scope
export const AuditScope = z.object({
  type: z.string(),
  id: z.string(),
});

export type AuditScope = z.infer<typeof AuditScope>;

// Change detail (before/after)
export const ChangeDetail = z.object({
  before: z.unknown(),
  after: z.unknown(),
});

export type ChangeDetail = z.infer<typeof ChangeDetail>;

// Audit log entry
export const AuditLogEntry = z.object({
  id: z.string().uuid(),
  account_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  action: AuditAction,
  object_type: z.string(),
  object_id: z.string(),
  object_name: z.string().nullable(),
  description: z.string(),
  changes: z.record(ChangeDetail).nullable(),
  before_state: z.unknown().nullable(),
  after_state: z.unknown().nullable(),
  scopes: z.array(AuditScope),
  severity: AuditSeverity,
  metadata: z.record(z.unknown()).nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: z.string().datetime(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

// Audit transformer interface
export interface AuditTransformer {
  /**
   * Transform object data before saving to audit log
   * @param data - Raw object data
   * @param action - The action being performed
   * @returns Transformed data safe for logging
   */
  transform(data: unknown, action: AuditAction): Promise<unknown>;

  /**
   * Extract human-readable description
   * @param data - Object data
   * @param action - The action performed
   * @returns Human-readable description
   */
  getDescription?(data: unknown, action: AuditAction): string;

  /**
   * Custom change calculation
   * @param before - Object state before change
   * @param after - Object state after change
   * @returns Changes object
   */
  calculateChanges?(
    before: unknown,
    after: unknown,
  ): Record<string, ChangeDetail>;
}

// Audit object configuration
export interface AuditObjectConfig {
  /** Enable/disable tracking for this object type */
  enabled: boolean;

  /** Which actions to track (default: all) */
  actions?: AuditAction[];

  /** Which fields to include (default: all) */
  includeFields?: string[];

  /** Which fields to exclude (takes precedence over includeFields) */
  excludeFields?: string[];

  /** Sensitive fields to redact (shows ***REDACTED***) */
  sensitiveFields?: string[];

  /** Custom transformer for this object type */
  transformer?: AuditTransformer;
}

// Create audit log parameters
export interface CreateAuditLogParams {
  accountId: string;
  userId: string;
  action: AuditAction;
  objectType: string;
  objectId: string;
  objectName?: string;
  before?: unknown;
  after?: unknown;
  scopes?: AuditScope[];
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// Cache statistics
export interface CacheStatistics {
  totalEntries: number;
  totalHits: number;
  totalCostSaved: number;
  hitRate: number;
}
