# FILM-102 Project-Based Access Policies

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** M
- **Dependencies:** FILM-101 (database tables), FILM-102-enable-rls.md
- **Blocks:** All project-scoped server actions

## Context
Project-based access policies control access to all resources that belong to a project (episodes, shots, assets, generations, etc.). These policies ensure that only users who are members of a project can access its data.

The core security model is:
1. A user must be a member of a project to access its resources
2. Project owners have full CRUD access
3. Project members have read access and can create/update their own resources
4. The helper function `user_has_project_access()` centralizes the access check logic

This approach ensures consistent security across all project-scoped tables and prevents cross-tenant data leakage.

## Specification

### SQL Implementation
```sql
-- =====================================================
-- Film Studio: Project-Based RLS Policies
-- =====================================================
-- Description: Row Level Security policies for project-scoped tables
-- Dependencies: 11-film-studio-tables.sql, 031-film-studio-enable-rls.sql
-- Author: Film Studio Team
-- Date: 2025-12-04
-- =====================================================

-- =====================================================
-- Helper Functions
-- =====================================================

-- Function to check if current user has access to a project
CREATE OR REPLACE FUNCTION user_has_project_access(project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    user_account_id UUID;
BEGIN
    -- Get the account_id for the current authenticated user
    SELECT account_id INTO user_account_id
    FROM accounts
    WHERE user_id = auth.uid();

    -- Return false if user has no account
    IF user_account_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check if user is a member of the project
    RETURN EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = user_has_project_access.project_id
        AND pm.account_id = user_account_id
        AND pm.status = 'active'
    );
END;
$$;

-- Function to check if current user is owner of a project
CREATE OR REPLACE FUNCTION user_is_project_owner(project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    user_account_id UUID;
BEGIN
    -- Get the account_id for the current authenticated user
    SELECT account_id INTO user_account_id
    FROM accounts
    WHERE user_id = auth.uid();

    -- Return false if user has no account
    IF user_account_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check if user is owner of the project
    RETURN EXISTS (
        SELECT 1
        FROM project_members pm
        WHERE pm.project_id = user_is_project_owner.project_id
        AND pm.account_id = user_account_id
        AND pm.role = 'owner'
        AND pm.status = 'active'
    );
END;
$$;

-- Function to get current user's account_id
CREATE OR REPLACE FUNCTION current_user_account_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    user_account_id UUID;
BEGIN
    SELECT account_id INTO user_account_id
    FROM accounts
    WHERE user_id = auth.uid();

    RETURN user_account_id;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION user_has_project_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_is_project_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_account_id() TO authenticated;

-- =====================================================
-- Projects Table Policies
-- =====================================================

-- Projects: SELECT - User must be project member
CREATE POLICY "Users can view projects they are members of"
ON projects
FOR SELECT
TO authenticated
USING (user_has_project_access(id));

-- Projects: INSERT - User must have an account and will be made owner
CREATE POLICY "Users can create projects"
ON projects
FOR INSERT
TO authenticated
WITH CHECK (
    current_user_account_id() IS NOT NULL
    AND account_id = current_user_account_id()
);

-- Projects: UPDATE - User must be project owner
CREATE POLICY "Project owners can update projects"
ON projects
FOR UPDATE
TO authenticated
USING (user_is_project_owner(id))
WITH CHECK (user_is_project_owner(id));

-- Projects: DELETE - User must be project owner
CREATE POLICY "Project owners can delete projects"
ON projects
FOR DELETE
TO authenticated
USING (user_is_project_owner(id));

-- =====================================================
-- Project Members Table Policies
-- =====================================================

-- Project Members: SELECT - User must be project member
CREATE POLICY "Users can view members of their projects"
ON project_members
FOR SELECT
TO authenticated
USING (user_has_project_access(project_id));

-- Project Members: INSERT - User must be project owner
CREATE POLICY "Project owners can add members"
ON project_members
FOR INSERT
TO authenticated
WITH CHECK (user_is_project_owner(project_id));

-- Project Members: UPDATE - User must be project owner
CREATE POLICY "Project owners can update members"
ON project_members
FOR UPDATE
TO authenticated
USING (user_is_project_owner(project_id))
WITH CHECK (user_is_project_owner(project_id));

-- Project Members: DELETE - User must be project owner or removing themselves
CREATE POLICY "Project owners can remove members, members can leave"
ON project_members
FOR DELETE
TO authenticated
USING (
    user_is_project_owner(project_id)
    OR account_id = current_user_account_id()
);

-- =====================================================
-- Episodes Table Policies
-- =====================================================

-- Episodes: SELECT - User must be project member
CREATE POLICY "Users can view episodes in their projects"
ON episodes
FOR SELECT
TO authenticated
USING (user_has_project_access(project_id));

-- Episodes: INSERT - User must be project member
CREATE POLICY "Project members can create episodes"
ON episodes
FOR INSERT
TO authenticated
WITH CHECK (
    user_has_project_access(project_id)
    AND created_by = current_user_account_id()
);

-- Episodes: UPDATE - User must be project owner or creator
CREATE POLICY "Project owners and creators can update episodes"
ON episodes
FOR UPDATE
TO authenticated
USING (
    user_is_project_owner(project_id)
    OR created_by = current_user_account_id()
)
WITH CHECK (
    user_is_project_owner(project_id)
    OR created_by = current_user_account_id()
);

-- Episodes: DELETE - User must be project owner
CREATE POLICY "Project owners can delete episodes"
ON episodes
FOR DELETE
TO authenticated
USING (user_is_project_owner(project_id));

-- =====================================================
-- Shots Table Policies
-- =====================================================

-- Shots: SELECT - User must be project member
CREATE POLICY "Users can view shots in their projects"
ON shots
FOR SELECT
TO authenticated
USING (user_has_project_access(project_id));

-- Shots: INSERT - User must be project member
CREATE POLICY "Project members can create shots"
ON shots
FOR INSERT
TO authenticated
WITH CHECK (
    user_has_project_access(project_id)
    AND created_by = current_user_account_id()
);

-- Shots: UPDATE - User must be project owner or creator
CREATE POLICY "Project owners and creators can update shots"
ON shots
FOR UPDATE
TO authenticated
USING (
    user_is_project_owner(project_id)
    OR created_by = current_user_account_id()
)
WITH CHECK (
    user_is_project_owner(project_id)
    OR created_by = current_user_account_id()
);

-- Shots: DELETE - User must be project owner
CREATE POLICY "Project owners can delete shots"
ON shots
FOR DELETE
TO authenticated
USING (user_is_project_owner(project_id));

-- =====================================================
-- Assets Table Policies
-- =====================================================

-- Assets: SELECT - User must be project member (via shots join)
CREATE POLICY "Users can view assets in their projects"
ON assets
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = assets.shot_id
        AND user_has_project_access(s.project_id)
    )
);

-- Assets: INSERT - User must be project member (via shots join)
CREATE POLICY "Project members can create assets"
ON assets
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = assets.shot_id
        AND user_has_project_access(s.project_id)
    )
    AND created_by = current_user_account_id()
);

-- Assets: UPDATE - User must be project owner or creator (via shots join)
CREATE POLICY "Project owners and creators can update assets"
ON assets
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = assets.shot_id
        AND (
            user_is_project_owner(s.project_id)
            OR assets.created_by = current_user_account_id()
        )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = assets.shot_id
        AND (
            user_is_project_owner(s.project_id)
            OR assets.created_by = current_user_account_id()
        )
    )
);

-- Assets: DELETE - User must be project owner (via shots join)
CREATE POLICY "Project owners can delete assets"
ON assets
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = assets.shot_id
        AND user_is_project_owner(s.project_id)
    )
);

-- =====================================================
-- Asset Versions Table Policies
-- =====================================================

-- Asset Versions: SELECT - User must be project member (via assets and shots join)
CREATE POLICY "Users can view asset versions in their projects"
ON asset_versions
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM assets a
        JOIN shots s ON s.id = a.shot_id
        WHERE a.id = asset_versions.asset_id
        AND user_has_project_access(s.project_id)
    )
);

-- Asset Versions: INSERT - User must be project member (via assets and shots join)
CREATE POLICY "Project members can create asset versions"
ON asset_versions
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM assets a
        JOIN shots s ON s.id = a.shot_id
        WHERE a.id = asset_versions.asset_id
        AND user_has_project_access(s.project_id)
    )
    AND created_by = current_user_account_id()
);

-- Asset Versions: UPDATE - User must be project owner or creator (via assets and shots join)
CREATE POLICY "Project owners and creators can update asset versions"
ON asset_versions
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM assets a
        JOIN shots s ON s.id = a.shot_id
        WHERE a.id = asset_versions.asset_id
        AND (
            user_is_project_owner(s.project_id)
            OR asset_versions.created_by = current_user_account_id()
        )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM assets a
        JOIN shots s ON s.id = a.shot_id
        WHERE a.id = asset_versions.asset_id
        AND (
            user_is_project_owner(s.project_id)
            OR asset_versions.created_by = current_user_account_id()
        )
    )
);

-- Asset Versions: DELETE - User must be project owner (via assets and shots join)
CREATE POLICY "Project owners can delete asset versions"
ON asset_versions
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM assets a
        JOIN shots s ON s.id = a.shot_id
        WHERE a.id = asset_versions.asset_id
        AND user_is_project_owner(s.project_id)
    )
);

-- =====================================================
-- Generation Jobs Table Policies
-- =====================================================

-- Generation Jobs: SELECT - User must be project member (via shots join)
CREATE POLICY "Users can view generation jobs in their projects"
ON generation_jobs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = generation_jobs.shot_id
        AND user_has_project_access(s.project_id)
    )
);

-- Generation Jobs: INSERT - User must be project member (via shots join)
CREATE POLICY "Project members can create generation jobs"
ON generation_jobs
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = generation_jobs.shot_id
        AND user_has_project_access(s.project_id)
    )
    AND initiated_by = current_user_account_id()
);

-- Generation Jobs: UPDATE - User must be project member (via shots join) or system
CREATE POLICY "Project members can update their generation jobs"
ON generation_jobs
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = generation_jobs.shot_id
        AND user_has_project_access(s.project_id)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = generation_jobs.shot_id
        AND user_has_project_access(s.project_id)
    )
);

-- Generation Jobs: DELETE - User must be project owner (via shots join)
CREATE POLICY "Project owners can delete generation jobs"
ON generation_jobs
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM shots s
        WHERE s.id = generation_jobs.shot_id
        AND user_is_project_owner(s.project_id)
    )
);

-- =====================================================
-- Generation Job Logs Table Policies
-- =====================================================

-- Generation Job Logs: SELECT - User must be project member (via generation_jobs and shots join)
CREATE POLICY "Users can view generation logs in their projects"
ON generation_job_logs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = generation_job_logs.job_id
        AND user_has_project_access(s.project_id)
    )
);

-- Generation Job Logs: INSERT - System only (logs are created by background jobs)
CREATE POLICY "System can create generation logs"
ON generation_job_logs
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = generation_job_logs.job_id
        AND user_has_project_access(s.project_id)
    )
);

-- Generation Job Logs: UPDATE - No updates allowed (logs are immutable)
-- No UPDATE policy - logs should not be modified

-- Generation Job Logs: DELETE - User must be project owner (via generation_jobs and shots join)
CREATE POLICY "Project owners can delete generation logs"
ON generation_job_logs
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = generation_job_logs.job_id
        AND user_is_project_owner(s.project_id)
    )
);

-- =====================================================
-- Video Generations Table Policies
-- =====================================================

-- Video Generations: SELECT - User must be project member (via generation_jobs and shots join)
CREATE POLICY "Users can view video generations in their projects"
ON video_generations
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = video_generations.job_id
        AND user_has_project_access(s.project_id)
    )
);

-- Video Generations: INSERT - User must be project member (via generation_jobs and shots join)
CREATE POLICY "System can create video generations"
ON video_generations
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = video_generations.job_id
        AND user_has_project_access(s.project_id)
    )
);

-- Video Generations: UPDATE - User must be project member (via generation_jobs and shots join)
CREATE POLICY "Project members can update video generations"
ON video_generations
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = video_generations.job_id
        AND user_has_project_access(s.project_id)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = video_generations.job_id
        AND user_has_project_access(s.project_id)
    )
);

-- Video Generations: DELETE - User must be project owner (via generation_jobs and shots join)
CREATE POLICY "Project owners can delete video generations"
ON video_generations
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = video_generations.job_id
        AND user_is_project_owner(s.project_id)
    )
);

-- =====================================================
-- Audio Generations Table Policies
-- =====================================================

-- Audio Generations: SELECT - User must be project member (via generation_jobs and shots join)
CREATE POLICY "Users can view audio generations in their projects"
ON audio_generations
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = audio_generations.job_id
        AND user_has_project_access(s.project_id)
    )
);

-- Audio Generations: INSERT - User must be project member (via generation_jobs and shots join)
CREATE POLICY "System can create audio generations"
ON audio_generations
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = audio_generations.job_id
        AND user_has_project_access(s.project_id)
    )
);

-- Audio Generations: UPDATE - User must be project member (via generation_jobs and shots join)
CREATE POLICY "Project members can update audio generations"
ON audio_generations
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = audio_generations.job_id
        AND user_has_project_access(s.project_id)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = audio_generations.job_id
        AND user_has_project_access(s.project_id)
    )
);

-- Audio Generations: DELETE - User must be project owner (via generation_jobs and shots join)
CREATE POLICY "Project owners can delete audio generations"
ON audio_generations
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM generation_jobs gj
        JOIN shots s ON s.id = gj.shot_id
        WHERE gj.id = audio_generations.job_id
        AND user_is_project_owner(s.project_id)
    )
);

-- =====================================================
-- Indexes for RLS Performance
-- =====================================================

-- Index on project_members for fast access checks
CREATE INDEX IF NOT EXISTS idx_project_members_project_account
ON project_members(project_id, account_id, status)
WHERE status = 'active';

-- Index on accounts for user_id lookup
CREATE INDEX IF NOT EXISTS idx_accounts_user_id
ON accounts(user_id);

-- Index on project_members for role checks
CREATE INDEX IF NOT EXISTS idx_project_members_role
ON project_members(project_id, role, status)
WHERE role = 'owner' AND status = 'active';

-- =====================================================
-- Verification
-- =====================================================

-- Verify all policies are created
DO $$
DECLARE
    expected_policies INTEGER := 40; -- 4 policies per table * 10 tables
    actual_policies INTEGER;
BEGIN
    SELECT COUNT(*) INTO actual_policies
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename IN (
        'projects', 'project_members', 'episodes', 'shots',
        'assets', 'asset_versions', 'generation_jobs', 'generation_job_logs',
        'video_generations', 'audio_generations'
    );

    IF actual_policies < expected_policies THEN
        RAISE WARNING 'Expected at least % policies, found %', expected_policies, actual_policies;
    ELSE
        RAISE NOTICE 'Successfully created % project-based RLS policies', actual_policies;
    END IF;
END $$;
```

### Policy Matrix

#### Projects Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view projects they are members of | User is project member | Read access for members |
| INSERT | Users can create projects | User has account | User becomes owner automatically |
| UPDATE | Project owners can update projects | User is project owner | Only owners can modify |
| DELETE | Project owners can delete projects | User is project owner | Only owners can delete |

#### Project Members Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view members of their projects | User is project member | Can see other members |
| INSERT | Project owners can add members | User is project owner | Only owners can invite |
| UPDATE | Project owners can update members | User is project owner | Only owners can change roles |
| DELETE | Project owners can remove members, members can leave | User is owner OR removing self | Self-service leave allowed |

#### Episodes Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view episodes in their projects | User is project member | Read access for members |
| INSERT | Project members can create episodes | User is project member | All members can create |
| UPDATE | Project owners and creators can update episodes | User is owner OR creator | Collaborative editing |
| DELETE | Project owners can delete episodes | User is project owner | Only owners can delete |

#### Shots Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view shots in their projects | User is project member | Read access for members |
| INSERT | Project members can create shots | User is project member | All members can create |
| UPDATE | Project owners and creators can update shots | User is owner OR creator | Collaborative editing |
| DELETE | Project owners can delete shots | User is project owner | Only owners can delete |

#### Assets Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view assets in their projects | User is project member (via shot) | Inherits from shot access |
| INSERT | Project members can create assets | User is project member (via shot) | All members can create |
| UPDATE | Project owners and creators can update assets | User is owner OR creator (via shot) | Collaborative editing |
| DELETE | Project owners can delete assets | User is project owner (via shot) | Only owners can delete |

#### Asset Versions Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view asset versions in their projects | User is project member (via asset) | Inherits from asset access |
| INSERT | Project members can create asset versions | User is project member (via asset) | All members can version |
| UPDATE | Project owners and creators can update asset versions | User is owner OR creator (via asset) | Collaborative editing |
| DELETE | Project owners can delete asset versions | User is project owner (via asset) | Only owners can delete |

#### Generation Jobs Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view generation jobs in their projects | User is project member (via shot) | Inherits from shot access |
| INSERT | Project members can create generation jobs | User is project member (via shot) | All members can generate |
| UPDATE | Project members can update their generation jobs | User is project member (via shot) | Status updates allowed |
| DELETE | Project owners can delete generation jobs | User is project owner (via shot) | Only owners can delete |

#### Generation Job Logs Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view generation logs in their projects | User is project member (via job) | Inherits from job access |
| INSERT | System can create generation logs | User is project member (via job) | System-generated logs |
| UPDATE | - | - | Logs are immutable |
| DELETE | Project owners can delete generation logs | User is project owner (via job) | Cleanup by owners |

#### Video Generations Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view video generations in their projects | User is project member (via job) | Inherits from job access |
| INSERT | System can create video generations | User is project member (via job) | System-generated results |
| UPDATE | Project members can update video generations | User is project member (via job) | Metadata updates allowed |
| DELETE | Project owners can delete video generations | User is project owner (via job) | Only owners can delete |

#### Audio Generations Table
| Operation | Policy Name | Condition | Notes |
|-----------|------------|-----------|-------|
| SELECT | Users can view audio generations in their projects | User is project member (via job) | Inherits from job access |
| INSERT | System can create audio generations | User is project member (via job) | System-generated results |
| UPDATE | Project members can update audio generations | User is project member (via job) | Metadata updates allowed |
| DELETE | Project owners can delete audio generations | User is project owner (via job) | Only owners can delete |

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/migrations/032-film-studio-project-rls.sql` |

## Acceptance Criteria
- [ ] All 10 project-scoped tables have RLS policies
- [ ] Helper functions correctly identify user's account and project membership
- [ ] Project owners can perform all CRUD operations
- [ ] Project members can read and create resources
- [ ] Non-members cannot access any project data
- [ ] Policies work correctly with nested resources (assets via shots, etc.)
- [ ] Performance indexes are created for policy checks
- [ ] All policies are verified by the migration script

## Test Plan

### Unit Tests
```sql
-- Test 1: Helper function - current_user_account_id()
SET ROLE authenticated;
SET request.jwt.claims.sub TO 'user-uuid-123';
SELECT current_user_account_id();
-- Expected: Returns the account_id for the user

-- Test 2: Helper function - user_has_project_access()
SELECT user_has_project_access('project-uuid-456');
-- Expected: TRUE if user is member, FALSE otherwise

-- Test 3: Helper function - user_is_project_owner()
SELECT user_is_project_owner('project-uuid-456');
-- Expected: TRUE if user is owner, FALSE otherwise

-- Test 4: Projects - SELECT policy
SELECT * FROM projects;
-- Expected: Only returns projects where user is a member

-- Test 5: Projects - INSERT policy
INSERT INTO projects (name, account_id) VALUES ('Test Project', current_user_account_id());
-- Expected: Succeeds if user has an account

-- Test 6: Episodes - SELECT policy (cross-tenant protection)
SELECT * FROM episodes WHERE project_id = 'other-user-project-uuid';
-- Expected: Returns 0 rows

-- Test 7: Assets - Nested access (via shots)
SELECT * FROM assets WHERE shot_id IN (
    SELECT id FROM shots WHERE project_id = 'accessible-project-uuid'
);
-- Expected: Returns assets only from user's projects
```

### Integration Tests

#### Test Case 1: Project Creation Flow
```sql
-- Setup: Create user and account
INSERT INTO accounts (user_id, email) VALUES ('user-1', 'user1@example.com');

-- Act: Create project
INSERT INTO projects (name, account_id)
VALUES ('My Project', (SELECT account_id FROM accounts WHERE user_id = 'user-1'));

-- Assert: Project is created and accessible
SELECT COUNT(*) FROM projects WHERE name = 'My Project';
-- Expected: 1

-- Assert: Creator is automatically added as owner in project_members trigger
SELECT role FROM project_members WHERE project_id = (
    SELECT id FROM projects WHERE name = 'My Project'
) AND account_id = (SELECT account_id FROM accounts WHERE user_id = 'user-1');
-- Expected: 'owner'
```

#### Test Case 2: Cross-Tenant Access Prevention
```sql
-- Setup: Two users, two projects
INSERT INTO accounts (user_id, email) VALUES ('user-1', 'user1@example.com');
INSERT INTO accounts (user_id, email) VALUES ('user-2', 'user2@example.com');

INSERT INTO projects (name, account_id)
VALUES ('Project A', (SELECT account_id FROM accounts WHERE user_id = 'user-1'));

-- Act: User 2 tries to access User 1's project
SET request.jwt.claims.sub TO 'user-2';
SELECT * FROM projects WHERE name = 'Project A';
-- Expected: 0 rows

-- Act: User 2 tries to create episode in User 1's project
INSERT INTO episodes (project_id, title, created_by)
VALUES (
    (SELECT id FROM projects WHERE name = 'Project A'),
    'Unauthorized Episode',
    (SELECT account_id FROM accounts WHERE user_id = 'user-2')
);
-- Expected: Error - policy violation
```

#### Test Case 3: Project Member Access
```sql
-- Setup: Owner adds member
SET request.jwt.claims.sub TO 'user-1';
INSERT INTO project_members (project_id, account_id, role)
VALUES (
    (SELECT id FROM projects WHERE name = 'My Project'),
    (SELECT account_id FROM accounts WHERE user_id = 'user-2'),
    'member'
);

-- Act: Member can read project
SET request.jwt.claims.sub TO 'user-2';
SELECT * FROM projects WHERE name = 'My Project';
-- Expected: 1 row

-- Act: Member can create episode
INSERT INTO episodes (project_id, title, created_by)
VALUES (
    (SELECT id FROM projects WHERE name = 'My Project'),
    'Episode 1',
    (SELECT account_id FROM accounts WHERE user_id = 'user-2')
);
-- Expected: Success

-- Act: Member cannot delete project
DELETE FROM projects WHERE name = 'My Project';
-- Expected: Error - policy violation
```

#### Test Case 4: Nested Resource Access
```sql
-- Setup: Create project → episode → shot → asset hierarchy
SET request.jwt.claims.sub TO 'user-1';

-- Create episode
INSERT INTO episodes (project_id, title, created_by)
VALUES (
    (SELECT id FROM projects WHERE name = 'My Project'),
    'Episode 1',
    current_user_account_id()
);

-- Create shot
INSERT INTO shots (project_id, episode_id, name, created_by)
VALUES (
    (SELECT id FROM projects WHERE name = 'My Project'),
    (SELECT id FROM episodes WHERE title = 'Episode 1'),
    'Shot 1',
    current_user_account_id()
);

-- Create asset
INSERT INTO assets (shot_id, name, type, created_by)
VALUES (
    (SELECT id FROM shots WHERE name = 'Shot 1'),
    'Character Model',
    'character',
    current_user_account_id()
);

-- Act: User 2 (member) can access nested asset
SET request.jwt.claims.sub TO 'user-2';
SELECT * FROM assets WHERE name = 'Character Model';
-- Expected: 1 row (access flows through shot → project membership)

-- Act: User 3 (non-member) cannot access asset
SET request.jwt.claims.sub TO 'user-3';
SELECT * FROM assets WHERE name = 'Character Model';
-- Expected: 0 rows
```

#### Test Case 5: Owner vs Member Permissions
```sql
-- Setup: Owner and member exist
SET request.jwt.claims.sub TO 'user-1'; -- Owner

-- Act: Owner can update episode
UPDATE episodes
SET title = 'Updated Episode'
WHERE title = 'Episode 1';
-- Expected: Success

-- Act: Member can update their own episode
SET request.jwt.claims.sub TO 'user-2'; -- Member
UPDATE episodes
SET title = 'Member Updated'
WHERE title = 'Member Episode' AND created_by = current_user_account_id();
-- Expected: Success

-- Act: Member cannot update owner's episode
UPDATE episodes
SET title = 'Unauthorized Update'
WHERE created_by != current_user_account_id();
-- Expected: 0 rows updated (policy prevents access)

-- Act: Member cannot delete any episode
DELETE FROM episodes WHERE title = 'Episode 1';
-- Expected: Error - policy violation
```

### Performance Tests
```sql
-- Test 1: Policy function performance
EXPLAIN ANALYZE
SELECT * FROM projects WHERE user_has_project_access(id);
-- Expected: Index scan on project_members

-- Test 2: Nested resource query performance
EXPLAIN ANALYZE
SELECT a.* FROM assets a
JOIN shots s ON s.id = a.shot_id
WHERE user_has_project_access(s.project_id);
-- Expected: Efficient join with index usage

-- Test 3: Large dataset performance (1000+ projects)
-- Insert test data, then:
EXPLAIN ANALYZE
SELECT COUNT(*) FROM projects;
-- Expected: Execution time < 100ms
```

### Security Tests
- [ ] User A cannot SELECT user B's projects
- [ ] User A cannot INSERT episodes into user B's project
- [ ] User A cannot UPDATE user B's shots
- [ ] User A cannot DELETE user B's assets
- [ ] SQL injection attempts in helper functions fail safely
- [ ] Attempting to bypass policies via direct column updates fails
- [ ] Removed members immediately lose access
- [ ] Inactive members cannot access project data

## Security Considerations

### Multi-Tenant Isolation
- All policies enforce project membership checks
- No shared data between different accounts/projects
- Helper functions use SECURITY DEFINER carefully to prevent privilege escalation

### Access Hierarchy
```
Project Owner (role='owner')
  ├─ Full CRUD on all project resources
  ├─ Can add/remove members
  └─ Can delete project

Project Member (role='member')
  ├─ Read access to all project resources
  ├─ Can create new resources
  ├─ Can update own resources
  └─ Cannot delete resources
```

### Performance Considerations
- Helper functions marked as STABLE for query optimization
- Indexes created on foreign keys used in policy checks
- Policy checks execute at query planning time
- Consider caching user's project list in application layer for high-traffic scenarios

### Edge Cases
- **Orphaned resources**: If project is deleted, cascading deletes should clean up
- **Concurrent updates**: USING and WITH CHECK clauses prevent TOCTOU issues
- **Member removal**: Access is revoked immediately when status changes to 'inactive'
- **Circular dependencies**: Assets→Shots→Projects uses JOIN strategy to avoid recursion

### Future Enhancements
- Add audit logging for sensitive operations (DELETE, member changes)
- Implement rate limiting for generation job creation
- Add resource quotas per project tier
- Support project archival (soft delete) with continued read-only access

## Rollback Plan
```sql
-- Drop all policies
DROP POLICY IF EXISTS "Users can view projects they are members of" ON projects;
DROP POLICY IF EXISTS "Users can create projects" ON projects;
DROP POLICY IF EXISTS "Project owners can update projects" ON projects;
DROP POLICY IF EXISTS "Project owners can delete projects" ON projects;

-- (Continue for all policies on all tables...)

-- Drop helper functions
DROP FUNCTION IF EXISTS user_has_project_access(UUID);
DROP FUNCTION IF EXISTS user_is_project_owner(UUID);
DROP FUNCTION IF EXISTS current_user_account_id();

-- Drop performance indexes
DROP INDEX IF EXISTS idx_project_members_project_account;
DROP INDEX IF EXISTS idx_accounts_user_id;
DROP INDEX IF EXISTS idx_project_members_role;
```

## References
- PostgreSQL RLS Policies: https://www.postgresql.org/docs/current/sql-createpolicy.html
- Supabase RLS Guide: https://supabase.com/docs/guides/auth/row-level-security
- FILM-101: Database schema definition
- FILM-102-enable-rls.md: RLS enablement
- FILM-102-account-policies.md: Account-based policies
