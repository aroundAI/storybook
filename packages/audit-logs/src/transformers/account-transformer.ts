import type {
  AuditAction,
  AuditTransformer,
  ChangeDetail,
} from '../types';

/**
 * Account transformer
 *
 * Handles account (both personal and team) audit logs with:
 * - Safe field selection (no sensitive billing/payment data)
 * - Date formatting
 * - Human-readable descriptions
 */
export const accountTransformer: AuditTransformer = {
  /**
   * Transform account data - only include safe fields
   */
  async transform(data: unknown, _action: AuditAction): Promise<unknown> {
    if (typeof data !== 'object' || !data || data === null) {
      return data;
    }

    const account = data as Record<string, unknown>;

    return {
      id: account.id,
      name: account.name,
      slug: account.slug,
      picture_url: account.picture_url,
      is_personal_account: account.is_personal_account,
      email: account.email, // Accounts table email is for business contact, not PII
      primary_owner_user_id: account.primary_owner_user_id,
      // Format dates
      created_at: account.created_at
        ? new Date(account.created_at as string).toISOString()
        : null,
      updated_at: account.updated_at
        ? new Date(account.updated_at as string).toISOString()
        : null,
      // Exclude billing/subscription details
      // Exclude large public_data field
    };
  },

  /**
   * Generate human-readable description for account actions
   */
  getDescription(data: unknown, action: AuditAction): string {
    const account = data as Record<string, unknown>;
    const name = (account.name as string) || 'Unnamed account';
    const isPersonal = account.is_personal_account;
    const accountType = isPersonal ? 'Personal account' : 'Team account';

    switch (action) {
      case 'create':
        return `${accountType} "${name}" was created`;
      case 'update':
        return `${accountType} "${name}" was updated`;
      case 'delete':
        return `${accountType} "${name}" was deleted`;
      default:
        return `${accountType} "${name}" action: ${action}`;
    }
  },

  /**
   * Calculate changes for account objects
   * Only track meaningful, safe fields
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
    const beforeAccount = before as Record<string, unknown>;
    const afterAccount = after as Record<string, unknown>;

    // Track meaningful fields only
    const trackedFields = [
      'name',
      'slug',
      'email',
      'picture_url',
      'is_personal_account',
      'primary_owner_user_id',
    ];

    for (const field of trackedFields) {
      const beforeValue = beforeAccount[field];
      const afterValue = afterAccount[field];

      if (beforeValue !== afterValue) {
        changes[field] = {
          before: beforeValue,
          after: afterValue,
        };
      }
    }

    return changes;
  },
};
