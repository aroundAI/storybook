import type {
  AuditAction,
  AuditTransformer,
  ChangeDetail,
} from '../types';

/**
 * Project transformer
 *
 * Handles project audit logs with:
 * - Date formatting
 * - Metadata exclusion (can be large)
 * - Human-readable descriptions
 */
export const projectTransformer: AuditTransformer = {
  /**
   * Transform project data
   * - Format dates to ISO strings
   * - Exclude large metadata blobs
   * - Include essential fields only
   */
  async transform(data: unknown, action: AuditAction): Promise<unknown> {
    if (typeof data !== 'object' || !data || data === null) {
      return data;
    }

    const project = data as Record<string, unknown>;

    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      account_id: project.account_id,
      // Format dates to ISO strings
      created_at: project.created_at
        ? new Date(project.created_at as string).toISOString()
        : null,
      updated_at: project.updated_at
        ? new Date(project.updated_at as string).toISOString()
        : null,
      // Exclude large metadata field if present
      // Include only summary of metadata if needed
    };
  },

  /**
   * Generate human-readable description for project actions
   */
  getDescription(data: unknown, action: AuditAction): string {
    const project = data as Record<string, unknown>;
    const name = (project.name as string) || 'Unnamed project';

    switch (action) {
      case 'create':
        return `Project "${name}" was created`;
      case 'update':
        return `Project "${name}" was updated`;
      case 'delete':
        return `Project "${name}" was deleted`;
      case 'archive':
        return `Project "${name}" was archived`;
      case 'restore':
        return `Project "${name}" was restored`;
      default:
        return `Project "${name}" action: ${action}`;
    }
  },

  /**
   * Calculate changes for project objects
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
    const beforeProject = before as Record<string, unknown>;
    const afterProject = after as Record<string, unknown>;

    // Track meaningful fields
    const trackedFields = ['name', 'slug', 'description', 'status'];

    for (const field of trackedFields) {
      const beforeValue = beforeProject[field];
      const afterValue = afterProject[field];

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
