/**
 * Cache key patterns for projects
 *
 * All cache keys follow a consistent pattern:
 * - Prefix: 'projects:'
 * - Entity: account/project/members/permissions
 * - ID: unique identifier
 */

export const projectCacheKeys = {
    /**
     * All projects for an account
     */
    accountProjects: (accountId: string) => `projects:account:${accountId}`,

    /**
     * Single project by ID
     */
    project: (projectId: string) => `projects:${projectId}`,

    /**
     * Project lookup by slug (within account)
     */
    projectBySlug: (accountId: string, slug: string) =>
        `projects:slug:${accountId}:${slug}`,

    /**
     * Project members list
     */
    projectMembers: (projectId: string) => `projects:${projectId}:members`,

    /**
     * User permissions for a project
     */
    projectPermissions: (projectId: string, userId: string) =>
        `projects:${projectId}:perms:${userId}`,
} as const;

/**
 * Cache TTL in seconds
 *
 * Long TTLs are safe because we have proper cache invalidation
 * on all mutations (create, update, delete, member changes)
 */
export const projectCacheTTL = {
    /** Projects list - 1 hour */
    projects: 3600,
    /** Single project - 24 hours */
    project: 86400,
    /** Members list - 1 hour */
    members: 3600,
    /** User permissions - 24 hours (invalidated on role change) */
    permissions: 86400,
} as const;
