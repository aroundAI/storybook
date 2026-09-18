# Database Table Removal Example

## Scenario
Remove a deprecated `legacy_sessions` table that was replaced by Supabase's built-in auth.sessions.

## Before State

### Table Definition
```sql
-- supabase/migrations/20230301_legacy_sessions.sql
CREATE TABLE legacy_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_legacy_sessions_user_id ON legacy_sessions(user_id);
CREATE INDEX idx_legacy_sessions_token ON legacy_sessions(token);

-- RLS Policies
ALTER TABLE legacy_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON legacy_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
  ON legacy_sessions FOR DELETE
  USING (auth.uid() = user_id);
```

### Application Code Reference
```typescript
// lib/auth/sessions.ts (deprecated file)
import { createServerClient } from '@/lib/supabase/server'

// DEPRECATED: Use Supabase's built-in sessions
export async function getUserSessions(userId: string) {
  const supabase = createServerClient()
  
  const { data } = await supabase
    .from('legacy_sessions')  // <- References deprecated table
    .select('*')
    .eq('user_id', userId)
  
  return data
}

export async function deleteSession(sessionId: string) {
  const supabase = createServerClient()
  
  await supabase
    .from('legacy_sessions')
    .delete()
    .eq('id', sessionId)
}
```

### Type Definitions
```typescript
// lib/types/database.ts (generated)
export interface Database {
  public: {
    Tables: {
      legacy_sessions: {
        Row: {
          id: string
          user_id: string
          token: string
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          token: string
          expires_at: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          token?: string
          expires_at?: string
          created_at?: string
        }
      }
      // ... other tables
    }
  }
}
```

## Analysis Results

### Database Analysis
```json
{
  "table_name": "legacy_sessions",
  "definition_files": [
    "supabase/migrations/20230301_legacy_sessions.sql"
  ],
  "confidence": "high",
  "warnings": [],
  "has_foreign_keys": true,
  "has_rls_policies": true,
  "code_references": 1
}
```

### Dependency Check

#### Foreign Key Constraints
```sql
SELECT
    tc.table_name, 
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'legacy_sessions'
  AND tc.constraint_type = 'FOREIGN KEY';

-- Result:
-- table_name       | constraint_name           | column_name | foreign_table_name
-- legacy_sessions | legacy_sessions_user_id_fkey | user_id   | users
```

#### RLS Policies
```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'legacy_sessions';

-- Result:
-- policyname                    | cmd    | qual
-- Users can view own sessions  | SELECT | (auth.uid() = user_id)
-- Users can delete own sessions| DELETE | (auth.uid() = user_id)
```

#### Triggers
```sql
SELECT trigger_name
FROM information_schema.triggers
WHERE event_object_table = 'legacy_sessions';

-- Result: No triggers
```

## Removal Process

### Step 1: Create Checkpoint
```bash
python scripts/create_checkpoint.py --name "remove-legacy-sessions"

# Output:
# ✅ Created git branch: cleanup/checkpoint-remove-legacy-sessions
# ✅ Database backup created
```

### Step 2: Remove Application Code
```bash
# Remove the deprecated file
rm lib/auth/sessions.ts

# Search for any other references
grep -r "legacy_sessions" . --include="*.ts" --include="*.tsx"

# Results:
# supabase/migrations/20230301_legacy_sessions.sql
# lib/types/database.ts (auto-generated, will update later)
# No code references found ✅
```

### Step 3: Create Drop Migration

Create file: `supabase/migrations/20260130120000_remove_legacy_sessions.sql`

```sql
-- Migration: Remove legacy_sessions table
-- Date: 2026-01-30
-- Reason: Replaced by Supabase's built-in auth.sessions

-- Step 1: Drop RLS policies
DROP POLICY IF EXISTS "Users can view own sessions" ON legacy_sessions;
DROP POLICY IF EXISTS "Users can delete own sessions" ON legacy_sessions;

-- Step 2: Drop indexes (will cascade with table, but being explicit)
DROP INDEX IF EXISTS idx_legacy_sessions_user_id;
DROP INDEX IF EXISTS idx_legacy_sessions_token;

-- Step 3: Drop the table
-- CASCADE will drop the foreign key constraint
DROP TABLE IF EXISTS legacy_sessions CASCADE;

-- Verification comment
COMMENT ON SCHEMA public IS 'Removed legacy_sessions table - see migration 20260130120000';
```

### Step 4: Create Rollback Migration

Create file: `supabase/migrations/20260130120001_rollback_remove_legacy_sessions.sql`

```sql
-- Rollback Migration: Restore legacy_sessions table
-- NOTE: This will recreate the structure but NOT the data
-- For data restoration, use database backup

-- Recreate table
CREATE TABLE legacy_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recreate indexes
CREATE INDEX idx_legacy_sessions_user_id ON legacy_sessions(user_id);
CREATE INDEX idx_legacy_sessions_token ON legacy_sessions(token);

-- Recreate RLS
ALTER TABLE legacy_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON legacy_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
  ON legacy_sessions FOR DELETE
  USING (auth.uid() = user_id);
```

### Step 5: Test Migration Locally

```bash
# Reset local database
supabase db reset

# Apply migrations
supabase migration up

# Verify table is gone (not `supabase db diff` — in this repo it diffs
# against an incomplete schemas/ and proposes dropping live tables)
psql "$SUPABASE_DB_URL" -c '\dt public.legacy_sessions'

# Test application
npm run dev
# Check that app works without the table
```

### Step 6: Update TypeScript Types

```bash
# Regenerate types from database
supabase gen types typescript --local > lib/types/database.ts

# The legacy_sessions type is now removed from database.ts ✅
```

### Step 7: Remove Type References

Search for type usage:
```bash
grep -r "legacy_sessions" lib/ --include="*.ts" --include="*.tsx"

# If found, remove those references
```

### Step 8: Validate

```bash
python scripts/validate_cleanup.py

# Output:
# ✅ TypeScript compilation: PASSED
# ✅ Import resolution: PASSED
# ✅ Database schema: PASSED
# ✅ Test suite: PASSED
# ✅ Build process: PASSED
```

## After State

### Removed
- ❌ Table `legacy_sessions` (dropped from database)
- ❌ File `lib/auth/sessions.ts` (deleted)
- ❌ RLS policies on legacy_sessions (dropped)
- ❌ Indexes on legacy_sessions (dropped)
- ❌ Type definitions for legacy_sessions (removed from database.ts)

### Added
- ✅ Migration `20260130120000_remove_legacy_sessions.sql`
- ✅ Rollback migration `20260130120001_rollback_remove_legacy_sessions.sql`

### Modified
- ✏️ `lib/types/database.ts` (regenerated without legacy_sessions)

### Metrics
- **Database tables removed**: 1
- **Database size reduced**: 2.3 MB
- **Code files removed**: 1
- **Lines of code removed**: 45
- **Foreign key constraints removed**: 1
- **RLS policies removed**: 2
- **Indexes removed**: 2

## Verification

### Database Verification
```sql
-- Verify table is gone
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'legacy_sessions';
-- Result: 0 rows ✅

-- Verify no orphaned policies
SELECT * FROM pg_policies WHERE tablename = 'legacy_sessions';
-- Result: 0 rows ✅

-- Verify no orphaned triggers
SELECT * FROM information_schema.triggers 
WHERE event_object_table = 'legacy_sessions';
-- Result: 0 rows ✅
```

### Application Verification
```bash
# TypeScript check
npx tsc --noEmit
# No errors ✅

# Build
npm run build
# Success ✅

# Tests
npm test
# All passing ✅

# Start dev server
npm run dev
# No errors, app works correctly ✅
```

## Rollback Instructions

If issues arise:

### Code Rollback
```bash
git checkout cleanup/checkpoint-remove-legacy-sessions
```

### Database Rollback
```bash
# Apply the rollback migration
supabase migration up 20260130120001_rollback_remove_legacy_sessions.sql

# Or restore from backup
psql -U postgres -d your_db < backups/pre-cleanup-remove-legacy-sessions/migrations/backup.sql
```

## Deployment Plan

### Staging
1. Deploy migration to staging
2. Test application thoroughly
3. Monitor for errors
4. Verify data integrity

### Production
1. Schedule deployment during low-traffic period
2. Notify team of deployment
3. Deploy migration
4. Monitor error logs
5. Have rollback ready

### Monitoring
```bash
# Watch for errors related to legacy_sessions
grep -i "legacy_sessions" /var/log/application.log

# Monitor database errors
SELECT * FROM pg_stat_database WHERE datname = 'your_database';
```

## Lessons Learned

1. **Always check foreign keys**: The user_id foreign key was important to document
2. **Test rollback migration**: Make sure it actually works
3. **Regenerate types**: Critical for TypeScript projects
4. **Document the reason**: Future developers will thank you
5. **Check for RLS policies**: Easy to forget these

## Success Criteria

✅ Table successfully removed from database
✅ No foreign key constraint violations
✅ All RLS policies removed
✅ Type definitions updated
✅ Application works without the table
✅ Tests passing
✅ Rollback migration tested and ready
✅ Documentation updated
