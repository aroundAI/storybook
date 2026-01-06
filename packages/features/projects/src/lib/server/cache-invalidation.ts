import 'server-only';

import { createCacheClient } from '@kit/cache';

import { projectCacheKeys } from '../cache-keys';

/**
 * Invalidate all project-related cache for a project
 * Call this on project update/delete operations
 */
export async function invalidateProjectCache(
    projectId: string,
    accountId: string,
) {
    const cache = createCacheClient();

    await cache.mdel([
        projectCacheKeys.project(projectId),
        projectCacheKeys.projectMembers(projectId),
        projectCacheKeys.accountProjects(accountId),
    ]);
}

/**
 * Invalidate the account projects list
 * Call this when projects are created/deleted
 */
export async function invalidateAccountProjectsCache(accountId: string) {
    const cache = createCacheClient();
    await cache.del(projectCacheKeys.accountProjects(accountId));
}

/**
 * Invalidate project members cache
 * Call this when members are added/removed/updated
 */
export async function invalidateProjectMembersCache(projectId: string) {
    const cache = createCacheClient();
    await cache.del(projectCacheKeys.projectMembers(projectId));
}
