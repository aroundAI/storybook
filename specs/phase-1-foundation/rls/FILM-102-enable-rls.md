# FILM-102 Enable RLS on All Tables

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
- **Dependencies:** FILM-101 (database tables)
- **Blocks:** All server actions

## Context
Row Level Security (RLS) must be enabled on all 14 tables created in FILM-101 to prevent unauthorized access to tenant data. This is the foundation of our multi-tenant security model. Without RLS enabled, PostgreSQL policies will not be enforced, and all data would be accessible to any authenticated user.

This task enables RLS on all tables but does not create any policies. The actual access policies will be defined in FILM-102-project-policies.md and FILM-102-account-policies.md.

## Specification

### SQL Implementation
```sql
-- =====================================================
-- Film Studio: Enable Row Level Security
-- =====================================================
-- Description: Enable RLS on all film studio tables
-- Dependencies: 11-film-studio-tables.sql
-- Author: Film Studio Team
-- Date: 2025-12-04
-- =====================================================

-- Enable RLS on account-scoped tables
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;

-- Enable RLS on project-scoped tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_versions ENABLE ROW LEVEL SECURITY;

-- Enable RLS on generation/job tables
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_job_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_generations ENABLE ROW LEVEL SECURITY;

-- Verification: Check that RLS is enabled on all tables
DO $$
DECLARE
    table_record RECORD;
    missing_rls TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOR table_record IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename IN (
            'accounts', 'platform_connections', 'external_api_keys', 'usage_metrics',
            'projects', 'project_members', 'episodes', 'shots',
            'assets', 'asset_versions', 'generation_jobs', 'generation_job_logs',
            'video_generations', 'audio_generations'
        )
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_tables
            WHERE schemaname = 'public'
            AND tablename = table_record.tablename
            AND rowsecurity = true
        ) THEN
            missing_rls := array_append(missing_rls, table_record.tablename);
        END IF;
    END LOOP;

    IF array_length(missing_rls, 1) > 0 THEN
        RAISE EXCEPTION 'RLS not enabled on tables: %', array_to_string(missing_rls, ', ');
    ELSE
        RAISE NOTICE 'RLS successfully enabled on all 14 tables';
    END IF;
END $$;
```

### Policy Matrix
| Table | RLS Enabled | Policies Defined | Notes |
|-------|-------------|------------------|-------|
| accounts | ✓ | See FILM-102-account-policies.md | Account owner access |
| platform_connections | ✓ | See FILM-102-account-policies.md | Account owner access |
| external_api_keys | ✓ | See FILM-102-account-policies.md | Account owner access |
| usage_metrics | ✓ | See FILM-102-account-policies.md | Account owner access |
| projects | ✓ | See FILM-102-project-policies.md | Project member access |
| project_members | ✓ | See FILM-102-project-policies.md | Project member access |
| episodes | ✓ | See FILM-102-project-policies.md | Project member access |
| shots | ✓ | See FILM-102-project-policies.md | Project member access |
| assets | ✓ | See FILM-102-project-policies.md | Project member access |
| asset_versions | ✓ | See FILM-102-project-policies.md | Project member access |
| generation_jobs | ✓ | See FILM-102-project-policies.md | Project member access |
| generation_job_logs | ✓ | See FILM-102-project-policies.md | Project member access |
| video_generations | ✓ | See FILM-102-project-policies.md | Project member access |
| audio_generations | ✓ | See FILM-102-project-policies.md | Project member access |

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/migrations/031-film-studio-enable-rls.sql` |

## Acceptance Criteria
- [ ] RLS is enabled on all 14 film studio tables
- [ ] Verification query confirms RLS is active on all tables
- [ ] Migration runs successfully without errors
- [ ] No existing data is affected by enabling RLS
- [ ] Tables are still queryable by service role (bypasses RLS)

## Test Plan

### Unit Tests
```sql
-- Test 1: Verify RLS is enabled on all tables
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
    'accounts', 'platform_connections', 'external_api_keys', 'usage_metrics',
    'projects', 'project_members', 'episodes', 'shots',
    'assets', 'asset_versions', 'generation_jobs', 'generation_job_logs',
    'video_generations', 'audio_generations'
)
ORDER BY tablename;
-- Expected: All 14 tables with rowsecurity = true

-- Test 2: Verify service role can still query tables
SET ROLE service_role;
SELECT COUNT(*) FROM accounts;
SELECT COUNT(*) FROM projects;
-- Expected: Queries succeed (service role bypasses RLS)

-- Test 3: Verify authenticated user cannot query without policies
SET ROLE authenticated;
SELECT COUNT(*) FROM accounts;
-- Expected: Returns 0 rows (no policies defined yet)
```

### Integration Tests
- [ ] Enable RLS migration runs successfully on empty database
- [ ] Enable RLS migration runs successfully on database with existing data
- [ ] Service role can perform all CRUD operations after RLS is enabled
- [ ] Authenticated users cannot access any data (no policies exist yet)
- [ ] Supabase dashboard shows RLS as enabled for all tables

### Security Tests
- [ ] Attempting to disable RLS via SQL injection fails
- [ ] Direct database connections respect RLS settings
- [ ] API requests through PostgREST respect RLS settings

## Security Considerations

### Defense in Depth
- RLS is the first layer of security; application-level checks should also exist
- Even if application code has bugs, RLS prevents unauthorized data access
- Service role key must be kept secret and never exposed to clients

### Performance Impact
- Enabling RLS has minimal performance overhead
- Policy evaluation happens at query planning time
- Indexes should be created to support common policy conditions

### Monitoring
- Monitor for RLS bypass attempts in logs
- Alert if RLS is disabled on any table
- Track query performance impact after policies are added

## Rollback Plan
```sql
-- If needed, disable RLS on all tables
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE platform_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE external_api_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE usage_metrics DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE project_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE episodes DISABLE ROW LEVEL SECURITY;
ALTER TABLE shots DISABLE ROW LEVEL SECURITY;
ALTER TABLE assets DISABLE ROW LEVEL SECURITY;
ALTER TABLE asset_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE generation_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE generation_job_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE video_generations DISABLE ROW LEVEL SECURITY;
ALTER TABLE audio_generations DISABLE ROW LEVEL SECURITY;
```

## References
- PostgreSQL RLS Documentation: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Supabase RLS Guide: https://supabase.com/docs/guides/auth/row-level-security
- FILM-101: Database schema definition
- FILM-102-project-policies.md: Project-based access policies
- FILM-102-account-policies.md: Account-based access policies
