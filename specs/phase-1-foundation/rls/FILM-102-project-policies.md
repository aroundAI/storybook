---
spec_id: FILM-102b
status: ✅ DONE
audited: 2026-09-23
---

# FILM-102b Project-Based Access Policies

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** M
- **Status:** DONE
- **Dependencies:** FILM-101 (database tables), FILM-102-enable-rls.md
- **Blocks:** All project-scoped server actions

## Context
Project-based access policies control access to all resources that belong to a project (episodes, shots, assets, generations, etc.). These policies ensure that only users who are members of a project can access its data.

The core security model is:
1. A user must be a member of a project to access its resources
2. Project owners and admins have elevated privileges
3. Members can create and update resources within projects they belong to
4. Viewers have read-only access
5. Access to nested resources flows through the project membership via joins

This approach ensures consistent security across all project-scoped tables and prevents cross-tenant data leakage.

## Implementation Summary

All RLS policies are implemented in `apps/web/supabase/schemas/30-film-studio.sql` and deployed via migration `20251205125737_film-studio-tables.sql`.

### Tables Covered (14 tables)

| Table | Access Pattern |
|-------|----------------|
| `seasons` | Direct project_id FK |
| `episodes` | Direct project_id FK |
| `shots` | Via episode_id -> episodes.project_id |
| `assets` | Direct project_id FK |
| `dialogue_lines` | Via episode_id -> episodes.project_id |
| `audio_tracks` | Via episode_id -> episodes.project_id |
| `character_details` | Via asset_id -> assets.project_id |
| `voice_profiles` | Via asset_id -> assets.project_id |
| `generation_jobs` | Direct project_id + account_id FK |
| `platform_connections` | Direct account_id FK |
| `publishes` | Via episode_id -> episodes.project_id |
| `content_analytics` | Via publish_id -> publishes -> episodes.project_id |
| `shared_resources` | Direct account_id FK |
| `external_api_keys` | Direct account_id FK |

### Helper Functions (from 18-projects.sql)

```sql
-- Check if user has role on project
public.has_role_on_project(target_project_id uuid, target_role project_role default null)
  RETURNS boolean
  SECURITY INVOKER

-- Check if user is project owner (bypasses RLS)
public.is_project_owner(target_project_id uuid)
  RETURNS boolean
  SECURITY DEFINER

-- Check if user can perform action on project
public.can_perform_project_action(target_project_id uuid, action project_action)
  RETURNS boolean
  SECURITY INVOKER
```

### Access Control Hierarchy

```
Project Owner (role='owner')
  |-- Full CRUD on all project resources
  |-- Can add/remove members
  +-- Can delete project

Project Admin (role='admin')
  |-- Full CRUD on project resources
  |-- Can add/remove members
  +-- Cannot delete project

Project Member (role='member')
  |-- Read access to all project resources
  |-- Can create new resources
  +-- Can update resources

Project Viewer (role='viewer')
  +-- Read-only access to project resources
```

## RLS Policy Patterns

### Pattern 1: Direct Project FK (seasons, episodes, assets)

```sql
-- Read: Check account access (personal owner OR team membership)
create policy "table_read" on public.table for select
  to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = table.project_id
      and (
        exists(
          select 1 from public.accounts a
          where a.id = p.account_id
          and a.primary_owner_user_id = auth.uid()
          and a.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
      )
    )
  );

-- Create: Check project membership with appropriate role
create policy "table_create" on public.table for insert
  to authenticated with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = table.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

-- Update: Check project membership
create policy "table_update" on public.table for update
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = table.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

-- Delete: Owners and admins only
create policy "table_delete" on public.table for delete
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = table.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );
```

### Pattern 2: Nested via Episode (shots, dialogue_lines, audio_tracks, publishes)

```sql
-- Access through episode -> project
create policy "shots_read" on public.shots for select
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = shots.episode_id
      and (
        exists(
          select 1 from public.accounts a
          where a.id = p.account_id
          and a.primary_owner_user_id = auth.uid()
          and a.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
      )
    )
  );
```

### Pattern 3: Nested via Asset (character_details, voice_profiles)

```sql
-- Access through asset -> project
create policy "character_details_read" on public.character_details for select
  to authenticated using (
    exists (
      select 1 from public.assets a
      join public.projects p on p.id = a.project_id
      where a.id = character_details.asset_id
      and (
        exists(
          select 1 from public.accounts acc
          where acc.id = p.account_id
          and acc.primary_owner_user_id = auth.uid()
          and acc.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
      )
    )
  );
```

### Pattern 4: Account-Scoped Resources (platform_connections, shared_resources, external_api_keys)

```sql
-- Direct account access check
create policy "platform_connections_read" on public.platform_connections for select
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );
```

## Policy Matrix

### Project-Scoped Tables (via project_id)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| seasons | account access | owner/admin/member | owner/admin | owner/admin |
| episodes | account access | owner/admin/member | owner/admin/member | owner/admin |
| assets | account access | owner/admin/member | owner/admin/member | owner/admin |

### Episode-Nested Tables (via episode_id)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| shots | via episode | owner/admin/member | owner/admin/member | owner/admin |
| dialogue_lines | via episode | owner/admin/member | owner/admin/member | owner/admin |
| audio_tracks | via episode | owner/admin/member | owner/admin/member | owner/admin |
| publishes | via episode | owner/admin/member | owner/admin/member | owner/admin |

### Asset-Nested Tables (via asset_id)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| character_details | via asset | owner/admin/member | owner/admin/member | owner/admin |
| voice_profiles | via asset | owner/admin/member | owner/admin/member | owner/admin |

### Account-Scoped Tables (via account_id)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| generation_jobs | account access | project member | account access | - (no delete) |
| platform_connections | account access | account access | account access | account access |
| shared_resources | account access + system | account access | account access | account access |
| external_api_keys | account access | account access | account access | account access |
| content_analytics | via publish | project member | project member | - (no delete) |

## File Changes

| Action | Path | Status |
|--------|------|--------|
| IMPLEMENTED | `apps/web/supabase/schemas/30-film-studio.sql` | Lines 551-1310 |
| DEPLOYED | `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql` | Complete |

## Acceptance Criteria

- [x] All 14 film studio tables have RLS policies — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:597` — 12 remain; `voice_profiles` and `content_analytics` were dropped (`20260103075610`, `20260212080000`)
- [ ] Helper functions correctly identify user's project membership — *audit: unverified* — needs a pgTAP test; `has_role_on_project`/`can_perform_project_action` are only called through a mocked RPC (`packages/features/projects/__tests__/project-queries.test.ts:296`)
- [ ] Project owners and admins can perform elevated operations — *audit: unverified* — needs a pgTAP test; delete policies require owner/admin (`apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:635`) but nothing drives them
- [ ] Project members can read and create resources — *audit: unverified* — tested for `publishes` only (`apps/web/supabase/tests/database/publish-analytics-note-rls.test.sql:120`, `apps/web/supabase/tests/database/publish-asset-duration.test.sql:129`); the other 11 tables have no test
- [ ] ~~Non-members cannot access any project data~~ — *audit: retired* — superseded for public/unlisted projects and episodes by public sharing (PR #126): `apps/web/supabase/migrations/20260108120000_public_sharing_rls.sql:43`, `specs/PRD-public-sharing.md`
- [ ] Policies work correctly with nested resources (assets via projects, shots via episodes, etc.) — *audit: unverified* — only the episode-nested `publishes` policies are tested (`apps/web/supabase/tests/database/publish-analytics-note-rls.test.sql:143`); the asset-nested and other episode-nested tables are not
- [x] Account-scoped resources check account membership
- [x] All policies use consistent patterns avoiding circular dependencies

## Security Considerations

### Multi-Tenant Isolation
- All policies enforce project/account membership checks
- No shared data between different accounts/projects unless explicitly marked (is_system = true for shared_resources)
- READ policies check account access first, then project membership for writes

### Circular Dependency Avoidance
- READ policies check via projects table -> accounts table (not project_members)
- This avoids circular RLS dependencies between projects and project_members
- WRITE policies check project_members directly since user must already have read access

### Performance Considerations
- Indexes on `project_members(project_id, user_id, role)` for fast membership checks
- Nested resource policies use efficient EXISTS subqueries with JOINs
- Account access functions are marked STABLE for query optimization

## References
- PostgreSQL RLS Policies: https://www.postgresql.org/docs/current/sql-createpolicy.html
- Supabase RLS Guide: https://supabase.com/docs/guides/auth/row-level-security
- FILM-101: Database schema definition
- FILM-102-enable-rls.md: RLS enablement
- 18-projects.sql: Base projects schema with helper functions
