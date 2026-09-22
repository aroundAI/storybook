---
spec_id: FILM-102a
status: ✅ DONE
audited: 2026-09-23
---

# FILM-102 Enable RLS on All Tables

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
- **Status:** COMPLETE
- **Completed:** 2025-12-07
- **Dependencies:** FILM-101 (database tables)
- **Blocks:** All server actions

## Context
Row Level Security (RLS) must be enabled on all 14 tables created in FILM-101 to prevent unauthorized access to tenant data. This is the foundation of our multi-tenant security model. Without RLS enabled, PostgreSQL policies will not be enforced, and all data would be accessible to any authenticated user.

**Note:** Base platform tables (`accounts`, `projects`, `project_members`) already have RLS enabled in their respective schema files (`03-accounts.sql`, `18-projects.sql`). This spec covers only the 14 FILM-101 tables.

## Specification

### SQL Implementation

RLS is enabled in `apps/web/supabase/schemas/30-film-studio.sql`:

```sql
-- =====================================================
-- Enable RLS on all FILM-101 tables
-- =====================================================

-- Project-scoped tables
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shots ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE dialogue_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_analytics ENABLE ROW LEVEL SECURITY;

-- Account-scoped tables
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_api_keys ENABLE ROW LEVEL SECURITY;
```

### Permission Configuration

After enabling RLS, default permissions are revoked and explicitly granted:

```sql
-- Revoke all default permissions
REVOKE ALL ON seasons FROM authenticated, service_role;
REVOKE ALL ON episodes FROM authenticated, service_role;
-- ... (all 14 tables)

-- Grant explicit permissions (RLS policies control actual access)
GRANT SELECT, INSERT, UPDATE, DELETE ON seasons TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON episodes TO authenticated;
-- ... (all 14 tables)

-- Service role bypasses RLS for admin/webhook operations
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
```

### Policy Matrix

| Table | RLS Enabled | Policies | Access Model |
|-------|-------------|----------|--------------|
| seasons | Yes | 4 (CRUD) | Project membership |
| episodes | Yes | 4 (CRUD) | Project membership |
| shots | Yes | 4 (CRUD) | Project membership via episode |
| assets | Yes | 4 (CRUD) | Project membership |
| dialogue_lines | Yes | 4 (CRUD) | Project membership via episode |
| audio_tracks | Yes | 4 (CRUD) | Project membership via episode |
| character_details | Yes | 4 (CRUD) | Project membership via asset |
| voice_profiles | Yes | 4 (CRUD) | Project membership via asset |
| generation_jobs | Yes | 3 (CRU) | Account ownership |
| platform_connections | Yes | 4 (CRUD) | Account ownership |
| publishes | Yes | 4 (CRUD) | Project membership via episode |
| content_analytics | Yes | 3 (CRU) | Project membership via publish |
| shared_resources | Yes | 4 (CRUD) | Account ownership + system access |
| external_api_keys | Yes | 4 (CRUD) | Account ownership |

**Total: 55 RLS policies** covering all CRUD operations.

## File Changes
| Action | Path |
|--------|------|
| EXISTS | `apps/web/supabase/schemas/30-film-studio.sql` (lines 545-590) |
| EXISTS | `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql` |

## Acceptance Criteria
- [x] RLS is enabled on all 14 FILM-101 tables — *audit:* `apps/web/supabase/tests/database/schema-conditions.test.sql:18` — 12 remain; `voice_profiles` and `content_analytics` were dropped (`20260103075610`, `20260212080000`)
- [x] Default permissions revoked from authenticated users
- [x] Explicit CRUD permissions granted (controlled by RLS policies)
- [x] Service role can bypass RLS for admin operations
- [x] Migration runs successfully without errors

## Test Plan

### Verification Query
```sql
-- Verify RLS is enabled on all 14 tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
    'seasons', 'episodes', 'shots', 'assets',
    'dialogue_lines', 'audio_tracks', 'character_details', 'voice_profiles',
    'generation_jobs', 'platform_connections', 'publishes', 'content_analytics',
    'shared_resources', 'external_api_keys'
)
ORDER BY tablename;
-- Expected: All 14 tables with rowsecurity = true
```

### Unit Tests
- [x] All 14 tables have `rowsecurity = true` in pg_tables
- [ ] Service role can query all tables (bypasses RLS) — *audit: not met* — only `publishes` is exercised as service role (`apps/web/supabase/tests/database/publish-asset-duration.test.sql:59`)
- [x] Authenticated users without policies see 0 rows

### Security Tests
- [x] Direct database connections respect RLS settings
- [ ] API requests through PostgREST respect RLS settings — *audit: not met* — no test found; `@kit/supabase verify` covers `content_tags` only

## Security Considerations

### Defense in Depth
- RLS is the first layer of security; application-level checks also exist
- Even if application code has bugs, RLS prevents unauthorized data access
- Service role key must be kept secret and never exposed to clients

### Performance Impact
- Enabling RLS has minimal performance overhead
- Policy evaluation happens at query planning time
- Indexes are created to support common policy conditions

## References
- PostgreSQL RLS Documentation: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Supabase RLS Guide: https://supabase.com/docs/guides/auth/row-level-security
- FILM-101: Database schema definition (14 tables)
- FILM-102-project-policies.md: Project-based access policies (10 tables)
- FILM-102-account-policies.md: Account-based access policies (4 tables)
