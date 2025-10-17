import type {
  AuditAction,
  AuditTransformer,
  ChangeDetail,
} from '../types';

/**
 * Default transformer for unknown object types
 *
 * This is a fallback transformer that applies sensible security defaults:
 * - Auto-detects and redacts common sensitive field patterns
 * - Excludes large metadata fields
 * - Excludes authentication/encryption fields
 * - Only includes safe, known field types
 *
 * WARNING: If this transformer is used, it indicates that the object type
 * doesn't have a proper configuration in AUDIT_CONFIG or a custom transformer.
 * You should add proper configuration for production use.
 */
export const defaultTransformer: AuditTransformer = {
  /**
   * Transform unknown object data with security-first defaults
   */
  async transform(data: unknown, _action: AuditAction): Promise<unknown> {
    if (typeof data !== 'object' || !data || data === null) {
      return data;
    }

    const obj = data as Record<string, unknown>;
    const transformed: Record<string, unknown> = {};

    // Sensitive field patterns to auto-redact
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /api[_-]?key/i,
      /access[_-]?key/i,
      /private[_-]?key/i,
      /credential/i,
      /auth/i,
      /session/i,
      /cookie/i,
      /ssn/i,
      /social[_-]?security/i,
      /card[_-]?number/i,
      /cvv/i,
      /pin/i,
    ];

    // Fields to always exclude (too large or always sensitive)
    const excludePatterns = [
      /^raw_/i,
      /^encrypted_/i,
      /^hashed_/i,
      /metadata$/i,
      /^meta$/i,
      /_meta$/i,
    ];

    // PII fields that should be redacted
    const piiPatterns = [/email/i, /phone/i, /address/i, /ip[_-]?address/i];

    for (const [key, value] of Object.entries(obj)) {
      // Skip excluded fields entirely
      if (excludePatterns.some((pattern) => pattern.test(key))) {
        continue;
      }

      // Redact sensitive fields
      if (sensitivePatterns.some((pattern) => pattern.test(key))) {
        transformed[key] = '***REDACTED***';
        continue;
      }

      // Redact PII
      if (piiPatterns.some((pattern) => pattern.test(key))) {
        transformed[key] = value ? '***REDACTED***' : null;
        continue;
      }

      // Include safe fields
      // Only include primitive types and simple arrays
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        transformed[key] = value;
      } else if (Array.isArray(value)) {
        // Only include simple arrays (not nested objects)
        const isSimpleArray = value.every(
          (item) =>
            typeof item === 'string' ||
            typeof item === 'number' ||
            typeof item === 'boolean',
        );
        if (isSimpleArray) {
          transformed[key] = value;
        }
      }
      // Skip complex objects and nested structures
    }

    // Always include ID fields if present
    if (obj.id !== undefined) transformed.id = obj.id;
    if (obj.uuid !== undefined) transformed.uuid = obj.uuid;
    if (obj.created_at !== undefined) transformed.created_at = obj.created_at;
    if (obj.updated_at !== undefined) transformed.updated_at = obj.updated_at;

    return transformed;
  },

  /**
   * Generate generic description for unknown object types
   */
  getDescription(data: unknown, action: AuditAction): string {
    const obj = data as Record<string, unknown>;
    const name = (obj.name as string) || (obj.title as string) || 'Unknown';

    return `${action} unknown object "${name}"`;
  },

  /**
   * Calculate changes with redaction for unknown objects
   */
  calculateChanges(
    before: unknown,
    after: unknown,
  ): Record<string, ChangeDetail> {
    if (
      typeof before !== 'object' ||
      typeof after !== 'object' ||
      !before ||
      !after
    ) {
      return {};
    }

    const changes: Record<string, ChangeDetail> = {};
    const beforeObj = before as Record<string, unknown>;
    const afterObj = after as Record<string, unknown>;

    // Sensitive patterns
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /key/i,
      /email/i,
      /phone/i,
    ];

    // Get all unique keys
    const allKeys = new Set([
      ...Object.keys(beforeObj),
      ...Object.keys(afterObj),
    ]);

    for (const key of allKeys) {
      // Skip metadata and raw fields
      if (/metadata|raw_|encrypted_|hashed_/i.test(key)) {
        continue;
      }

      const beforeValue = beforeObj[key];
      const afterValue = afterObj[key];

      if (beforeValue !== afterValue) {
        // Check if field is sensitive
        const isSensitive = sensitivePatterns.some((pattern) =>
          pattern.test(key),
        );

        changes[key] = {
          before: isSensitive ? '***REDACTED***' : beforeValue,
          after: isSensitive ? '***REDACTED***' : afterValue,
        };
      }
    }

    return changes;
  },
};
