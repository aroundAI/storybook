-- Performance Indexes Migration
-- Creates composite indexes for common query patterns

-- Composite index for project lookup by account + slug (most common pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_projects_account_slug_active 
  ON public.projects (account_id, slug) 
  WHERE status = 'active';

-- Composite index for project members with role (permission checks)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_project_members_project_user_role
  ON public.project_members (project_id, user_id, role);

-- Index for episode count queries (frequently accessed in layouts)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_episodes_project_active
  ON public.episodes (project_id) 
  WHERE deleted_at IS NULL;

-- Index for assets by project and type (characters/locations counts)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_assets_project_type_active_v2
  ON public.assets (project_id, type)
  WHERE deleted_at IS NULL;
