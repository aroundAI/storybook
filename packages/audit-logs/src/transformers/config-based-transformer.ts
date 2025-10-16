import type {
  AuditAction,
  AuditObjectConfig,
  AuditTransformer,
  ChangeDetail,
} from '../types';

/**
 * Built-in transformer that applies configuration-based filtering
 *
 * This transformer uses the audit configuration to:
 * - Exclude specific fields
 * - Include only specific fields
 * - Redact sensitive fields
 *
 * Used as fallback when no custom transformer is provided
 */
export class ConfigBasedTransformer implements AuditTransformer {
  constructor(private config: AuditObjectConfig) {}

  /**
   * Transform data according to configuration rules
   */
  async transform(data: unknown, action: AuditAction): Promise<unknown> {
    if (typeof data !== 'object' || !data || data === null) {
      return data;
    }

    const obj = { ...data } as Record<string, unknown>;

    // Apply field exclusions first
    if (this.config.excludeFields && this.config.excludeFields.length > 0) {
      for (const field of this.config.excludeFields) {
        delete obj[field];
      }
    }

    // Apply field inclusions (if specified, this filters to only these fields)
    if (this.config.includeFields && this.config.includeFields.length > 0) {
      const filtered: Record<string, unknown> = {};

      for (const field of this.config.includeFields) {
        if (field in obj) {
          filtered[field] = obj[field];
        }
      }

      return this.redactSensitiveFields(filtered);
    }

    // Redact sensitive fields
    return this.redactSensitiveFields(obj);
  }

  /**
   * Redact sensitive fields in the data object
   */
  private redactSensitiveFields(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!this.config.sensitiveFields || this.config.sensitiveFields.length === 0) {
      return obj;
    }

    const result = { ...obj };

    for (const field of this.config.sensitiveFields) {
      if (field in result) {
        result[field] = '***REDACTED***';
      }
    }

    return result;
  }

  /**
   * Default change calculation (can be overridden by custom transformers)
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

    // Get all unique keys from both objects
    const allKeys = new Set([
      ...Object.keys(beforeObj),
      ...Object.keys(afterObj),
    ]);

    for (const key of allKeys) {
      // Skip excluded fields
      if (this.config.excludeFields?.includes(key)) {
        continue;
      }

      // Skip if only including specific fields and this isn't one of them
      if (
        this.config.includeFields &&
        this.config.includeFields.length > 0 &&
        !this.config.includeFields.includes(key)
      ) {
        continue;
      }

      const beforeValue = beforeObj[key];
      const afterValue = afterObj[key];

      // Only record if values actually changed
      if (beforeValue !== afterValue) {
        changes[key] = {
          before: this.config.sensitiveFields?.includes(key)
            ? '***REDACTED***'
            : beforeValue,
          after: this.config.sensitiveFields?.includes(key)
            ? '***REDACTED***'
            : afterValue,
        };
      }
    }

    return changes;
  }
}
