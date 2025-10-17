import type {
  AuditAction,
  AuditTransformer,
  ChangeDetail,
} from '../types';

/**
 * Team member transformer
 *
 * Handles team member (accounts_memberships and project_members) audit logs with:
 * - Role and permission tracking
 * - Membership status changes
 * - Human-readable descriptions
 */
export const teamMemberTransformer: AuditTransformer = {
  /**
   * Transform team member data - include only relevant membership fields
   */
  async transform(data: unknown, _action: AuditAction): Promise<unknown> {
    if (typeof data !== 'object' || !data || data === null) {
      return data;
    }

    const member = data as Record<string, unknown>;

    return {
      id: member.id,
      user_id: member.user_id,
      account_id: member.account_id,
      project_id: member.project_id, // For project members
      role: member.role,
      permissions: member.permissions, // For custom permissions
      // Format dates
      created_at: member.created_at
        ? new Date(member.created_at as string).toISOString()
        : null,
      updated_at: member.updated_at
        ? new Date(member.updated_at as string).toISOString()
        : null,
      // Exclude invitation tokens, metadata
    };
  },

  /**
   * Generate human-readable description for team member actions
   */
  getDescription(data: unknown, action: AuditAction): string {
    const member = data as Record<string, unknown>;
    const role = (member.role as string) || 'member';
    const isProjectMember = !!member.project_id;

    const memberType = isProjectMember ? 'Project member' : 'Team member';

    switch (action) {
      case 'create':
        return `${memberType} added with role "${role}"`;
      case 'update':
        return `${memberType} updated`;
      case 'permission_change':
        return `${memberType} role changed to "${role}"`;
      case 'delete':
        return `${memberType} removed`;
      default:
        return `${memberType} action: ${action}`;
    }
  },

  /**
   * Calculate changes for team member objects
   * Focus on role and permission changes
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
    const beforeMember = before as Record<string, unknown>;
    const afterMember = after as Record<string, unknown>;

    // Track membership-related fields
    const trackedFields = ['role', 'permissions', 'user_id'];

    for (const field of trackedFields) {
      const beforeValue = beforeMember[field];
      const afterValue = afterMember[field];

      if (beforeValue !== afterValue) {
        // Special handling for permissions (array comparison)
        if (field === 'permissions') {
          const beforePerms = JSON.stringify(beforeValue);
          const afterPerms = JSON.stringify(afterValue);

          if (beforePerms !== afterPerms) {
            changes[field] = {
              before: beforeValue,
              after: afterValue,
            };
          }
        } else {
          changes[field] = {
            before: beforeValue,
            after: afterValue,
          };
        }
      }
    }

    return changes;
  },
};
