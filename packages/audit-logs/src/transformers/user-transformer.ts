import type {
  AuditAction,
  AuditTransformer,
  ChangeDetail,
} from '../types';

/**
 * User transformer
 *
 * Handles user audit logs with special considerations:
 * - Redacts email addresses and phone numbers
 * - Excludes password hashes and tokens
 * - Only tracks safe fields (display_name, role, avatar_url)
 * - Provides human-readable descriptions
 */
export const userTransformer: AuditTransformer = {
  /**
   * Transform user data - only include safe fields
   */
  async transform(data: unknown, action: AuditAction): Promise<unknown> {
    if (typeof data !== 'object' || !data || data === null) {
      return data;
    }

    const user = data as Record<string, unknown>;

    return {
      id: user.id,
      display_name: user.display_name || user.full_name,
      email: user.email ? '***REDACTED***' : null,
      phone: user.phone ? '***REDACTED***' : null,
      avatar_url: user.avatar_url,
      role: user.role,
      is_active: user.is_active,
      // Exclude all password-related fields
      // Exclude raw metadata which may contain sensitive data
      // Exclude tokens
    };
  },

  /**
   * Generate human-readable description for user actions
   */
  getDescription(data: unknown, action: AuditAction): string {
    const user = data as Record<string, unknown>;
    const name =
      (user.display_name as string) ||
      (user.full_name as string) ||
      'Unknown user';

    switch (action) {
      case 'create':
        return `User "${name}" was created`;
      case 'update':
        return `User "${name}" was updated`;
      case 'delete':
        return `User "${name}" was deleted`;
      case 'login':
        return `User "${name}" logged in`;
      case 'logout':
        return `User "${name}" logged out`;
      default:
        return `User "${name}" action: ${action}`;
    }
  },

  /**
   * Calculate changes for user objects
   * Only track safe fields that are meaningful for audit
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
    const beforeUser = before as Record<string, unknown>;
    const afterUser = after as Record<string, unknown>;

    // Only track meaningful, safe fields
    const safeFields = [
      'display_name',
      'full_name',
      'role',
      'avatar_url',
      'bio',
      'is_active',
    ];

    for (const field of safeFields) {
      const beforeValue = beforeUser[field];
      const afterValue = afterUser[field];

      if (beforeValue !== afterValue) {
        changes[field] = {
          before: beforeValue,
          after: afterValue,
        };
      }
    }

    // Special handling for email changes (show change occurred but not values)
    if (beforeUser.email !== afterUser.email) {
      changes.email = {
        before: '***REDACTED***',
        after: '***REDACTED***',
      };
    }

    return changes;
  },
};
