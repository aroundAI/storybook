import type {
  AuditAction,
  AuditTransformer,
  ChangeDetail,
} from '../types';

/**
 * Settings transformer
 *
 * Handles account settings audit logs with:
 * - Auto-detection of sensitive fields (API keys, secrets, tokens)
 * - Pattern-based redaction
 * - Safe field tracking
 */
export const settingsTransformer: AuditTransformer = {
  /**
   * Transform settings data
   * - Automatically detects and redacts sensitive fields
   * - Uses pattern matching for keys, secrets, tokens
   */
  async transform(data: unknown, _action: AuditAction): Promise<unknown> {
    if (typeof data !== 'object' || !data || data === null) {
      return data;
    }

    const settings = { ...(data as Record<string, unknown>) };

    // Patterns that identify sensitive fields
    const sensitivePatterns = [
      /api[_-]?key/i,
      /secret/i,
      /token/i,
      /password/i,
      /webhook/i,
      /private[_-]?key/i,
      /access[_-]?key/i,
      /auth[_-]?token/i,
      /bearer/i,
      /credential/i,
    ];

    // Redact any field matching sensitive patterns
    for (const key of Object.keys(settings)) {
      const isSensitive = sensitivePatterns.some((pattern) =>
        pattern.test(key),
      );

      if (isSensitive && typeof settings[key] === 'string') {
        settings[key] = '***REDACTED***';
      }
    }

    return settings;
  },

  /**
   * Generate human-readable description for settings actions
   */
  getDescription(data: unknown, action: AuditAction): string {
    return `Account settings were ${action === 'update' ? 'updated' : action}`;
  },

  /**
   * Calculate changes for settings objects
   * Automatically redacts sensitive field values
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
    const beforeSettings = before as Record<string, unknown>;
    const afterSettings = after as Record<string, unknown>;

    // Patterns for sensitive fields
    const sensitivePatterns = [
      /api[_-]?key/i,
      /secret/i,
      /token/i,
      /password/i,
      /webhook/i,
      /private[_-]?key/i,
    ];

    // Get all unique keys
    const allKeys = new Set([
      ...Object.keys(beforeSettings),
      ...Object.keys(afterSettings),
    ]);

    for (const key of allKeys) {
      const beforeValue = beforeSettings[key];
      const afterValue = afterSettings[key];

      // Only record if values changed
      if (beforeValue !== afterValue) {
        // Check if field is sensitive
        const isSensitive = sensitivePatterns.some((pattern) =>
          pattern.test(key),
        );

        if (isSensitive) {
          // Show that it changed but don't show values
          changes[key] = {
            before: '***REDACTED***',
            after: '***REDACTED***',
          };
        } else {
          // Show actual values for non-sensitive fields
          changes[key] = {
            before: beforeValue,
            after: afterValue,
          };
        }
      }
    }

    return changes;
  },
};
