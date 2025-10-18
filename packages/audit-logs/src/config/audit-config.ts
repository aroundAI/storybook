import type { AuditAction, AuditObjectConfig } from '../types';

/**
 * Audit configuration for different object types
 *
 * This configuration determines:
 * - Which object types to track
 * - Which actions to log
 * - Which fields to include/exclude
 * - Which fields contain sensitive data
 * - Custom transformers for data preprocessing
 */
export const AUDIT_CONFIG: Record<string, AuditObjectConfig> = {
  // Track projects - full tracking with all actions
  project: {
    enabled: true,
    actions: ['create', 'update', 'delete', 'archive', 'restore'],
    sensitiveFields: [], // No sensitive fields in projects
    // Transformer will format dates and exclude large metadata
  },

  // Track users - redact sensitive data
  user: {
    enabled: true,
    actions: ['create', 'update', 'delete'],
    excludeFields: [
      'password_hash',
      'encrypted_password',
      'raw_app_meta_data',
      'raw_user_meta_data',
    ],
    sensitiveFields: ['email', 'phone', 'phone_number'],
    // Transformer will handle email redaction and safe field selection
  },

  // Track account/team accounts
  account: {
    enabled: true,
    actions: ['create', 'update', 'delete'],
    sensitiveFields: [],
  },

  // Track account settings - redact API keys and secrets
  account_settings: {
    enabled: true,
    actions: ['settings_change'],
    sensitiveFields: [
      'api_key',
      'secret_key',
      'webhook_secret',
      'private_key',
      'access_token',
      'refresh_token',
    ],
    // Transformer will auto-detect and redact fields matching sensitive patterns
  },

  // Track invitations
  invitation: {
    enabled: true,
    actions: ['create', 'accept_invite', 'reject_invite', 'delete'],
    sensitiveFields: ['token'], // Redact invitation tokens
  },

  // Track team membership changes
  team_member: {
    enabled: true,
    actions: ['create', 'update', 'delete', 'permission_change'],
    includeFields: ['user_id', 'account_id', 'role', 'permissions'],
  },

  // Track subscription changes (billing)
  subscription: {
    enabled: true,
    actions: ['create', 'update', 'delete'],
    sensitiveFields: ['payment_method_id', 'card_last4'], // Redact payment details
  },

  // Track authentication events
  auth_event: {
    enabled: true,
    actions: ['login', 'logout'],
    excludeFields: ['session_token', 'access_token', 'refresh_token'],
  },

  // Track file uploads/deletions
  file: {
    enabled: true,
    actions: ['create', 'delete'],
    includeFields: ['id', 'name', 'size', 'mime_type', 'bucket_id'],
  },

  // DON'T track sessions (too noisy, happens every request)
  session: {
    enabled: false,
  },

  // DON'T track notifications (too frequent, low value)
  notification: {
    enabled: false,
  },

  // DON'T track analytics events (handled separately)
  analytics_event: {
    enabled: false,
  },

  // DON'T track cache operations (too frequent)
  cache_entry: {
    enabled: false,
  },
};

/**
 * Check if an object type and action should be tracked
 *
 * @param objectType - The type of object (e.g., 'project', 'user')
 * @param action - The action being performed
 * @returns true if this combination should be logged
 */
export function shouldTrackObject(
  objectType: string,
  action: AuditAction,
): boolean {
  const config = AUDIT_CONFIG[objectType];

  // If no config or disabled, don't track
  if (!config || !config.enabled) {
    return false;
  }

  // If no specific actions defined, track all actions
  if (!config.actions || config.actions.length === 0) {
    return true;
  }

  // Check if this specific action should be tracked
  return config.actions.includes(action);
}

/**
 * Get configuration for a specific object type
 *
 * @param objectType - The type of object
 * @returns Configuration object or null if not found
 */
export function getObjectConfig(objectType: string): AuditObjectConfig | null {
  return AUDIT_CONFIG[objectType] || null;
}

/**
 * Get all enabled object types
 *
 * @returns Array of object type names that have tracking enabled
 */
export function getEnabledObjectTypes(): string[] {
  return Object.entries(AUDIT_CONFIG)
    .filter(([, config]) => config.enabled)
    .map(([objectType]) => objectType);
}

/**
 * Check if a field is sensitive for a given object type
 *
 * @param objectType - The type of object
 * @param fieldName - The field name to check
 * @returns true if the field should be redacted
 */
export function isSensitiveField(
  objectType: string,
  fieldName: string,
): boolean {
  const config = AUDIT_CONFIG[objectType];

  if (!config || !config.sensitiveFields) {
    return false;
  }

  return config.sensitiveFields.includes(fieldName);
}
