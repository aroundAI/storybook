# Supabase Best Practices for Dead Code Removal

## Database Schema Cleanup

### Safe Table Removal Process

1. **Check Dependencies First**
```sql
-- Find all foreign key constraints
SELECT
    tc.table_name, 
    tc.constraint_name, 
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'your_table_name';

-- Check for views referencing the table
SELECT DISTINCT view_name
FROM information_schema.view_table_usage
WHERE table_name = 'your_table_name';

-- Check for RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'your_table_name';

-- Check for triggers
SELECT trigger_name, event_manipulation, event_object_table, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'your_table_name';
```

2. **Create a Reversible Migration**
```sql
-- Migration: 20240130_remove_deprecated_table.sql

-- Step 1: Document the table structure
COMMENT ON TABLE deprecated_table IS 'REMOVED: See backup in migrations/backups/';

-- Step 2: Drop dependent objects first
DROP TRIGGER IF EXISTS deprecated_table_updated ON deprecated_table;
DROP POLICY IF EXISTS "Users can view own data" ON deprecated_table;

-- Step 3: Drop foreign key constraints
ALTER TABLE other_table 
  DROP CONSTRAINT IF EXISTS fk_deprecated_table;

-- Step 4: Drop the table
DROP TABLE IF EXISTS deprecated_table CASCADE;
```

3. **Create Down Migration**
```sql
-- Migration: 20240130_rollback_remove_deprecated_table.sql

-- Restore table (fill in from backup)
CREATE TABLE deprecated_table (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- ... other columns from backup
);

-- Restore RLS
ALTER TABLE deprecated_table ENABLE ROW LEVEL SECURITY;

-- Restore policies (from backup)
CREATE POLICY "Users can view own data"
  ON deprecated_table FOR SELECT
  USING (auth.uid() = user_id);
```

### Common Database Orphans

#### Orphaned RLS Policies
```sql
-- Find policies for tables that don't exist
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = pg_policies.tablename
    AND table_schema = pg_policies.schemaname
);
```

#### Orphaned Triggers
```sql
-- Find triggers for tables that don't exist
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = event_object_table
);
```

#### Orphaned Functions
```sql
-- Find functions that are never called
SELECT n.nspname as schema, p.proname as function
FROM pg_proc p
LEFT JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND NOT EXISTS (
    -- Check if function is used in triggers
    SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid
  );
```

## Supabase Client Code Patterns

### Identifying Dead Client Code

1. **Unused Table References**
```typescript
// Dead code pattern 1: Direct table queries
const { data } = await supabase
  .from('deprecated_table')  // If table removed, this breaks
  .select('*')

// Dead code pattern 2: Type references
import { Database } from '@/lib/types/database'
type DeprecatedRow = Database['public']['Tables']['deprecated_table']['Row']
```

2. **Unused RPC Functions**
```typescript
// Check if RPC function exists in database
const { data } = await supabase.rpc('deprecated_function')
```

### Safe Removal Checklist

- [ ] Search entire codebase for table name (case-insensitive)
- [ ] Check for SQL string literals containing table name
- [ ] Check generated TypeScript types (database.ts)
- [ ] Verify no RPC functions reference the table
- [ ] Check middleware for database queries
- [ ] Check edge functions for references
- [ ] Verify webhooks don't interact with table

## Type Generation

After removing database tables, regenerate types:

```bash
# Regenerate Supabase types
supabase gen types typescript --project-id your-project-id > lib/types/database.ts

# Or if using local development
supabase gen types typescript --local > lib/types/database.ts
```

### Type Cleanup

Remove type references:
```typescript
// Before
import type { Database } from '@/lib/types/database'
type User = Database['public']['Tables']['users']['Row']
type DeprecatedSession = Database['public']['Tables']['deprecated_sessions']['Row']  // Remove this

// After
import type { Database } from '@/lib/types/database'
type User = Database['public']['Tables']['users']['Row']
```

## Row Level Security (RLS) Considerations

### When Removing Tables with RLS

1. **Document the security model**
```sql
-- Before removal, document why this was secure
-- deprecated_table had RLS with:
-- - SELECT: Users can only see their own rows
-- - INSERT: Users can only insert with their own user_id
-- - UPDATE: Users can only update their own rows
-- - DELETE: Users can only delete their own rows
```

2. **Check for policy dependencies**
```sql
-- Some policies might reference other tables
CREATE POLICY "Team members can view"
  ON projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members  -- If this table is removed
      WHERE team_id = projects.team_id
        AND user_id = auth.uid()
    )
  );
```

## Edge Functions Cleanup

### Checking Edge Functions

```bash
# List all edge functions
supabase functions list

# Check function code for table references
grep -r "deprecated_table" supabase/functions/
```

### Example Edge Function Pattern
```typescript
// supabase/functions/process-data/index.ts
import { createClient } from '@supabase/supabase-js'

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  
  // Check for references to removed tables
  const { data } = await supabase
    .from('deprecated_table')  // Remove this
    .select('*')
  
  return new Response(JSON.stringify(data))
})
```

## Migration Best Practices

### Migration Naming
```
YYYYMMDDHHMMSS_descriptive_name.sql

Examples:
20240130120000_remove_deprecated_sessions.sql
20240130120001_drop_legacy_auth_tables.sql
```

### Reversible Migrations

Always make migrations reversible:

```sql
-- Up migration
ALTER TABLE users DROP COLUMN deprecated_field;

-- Down migration (separate file or documented)
-- 20240130_rollback_remove_deprecated_field.sql
ALTER TABLE users ADD COLUMN deprecated_field TEXT;
```

### Testing Migrations

```bash
# Local testing
supabase db reset
supabase migration up
supabase migration down

# Verify data integrity
supabase db diff
```

## Common Gotchas

### 1. Cascade Effects
```sql
-- This will cascade delete!
DROP TABLE parent_table CASCADE;

-- Better: Explicitly drop constraints first
ALTER TABLE child_table DROP CONSTRAINT fk_parent;
DROP TABLE parent_table;
```

### 2. Service Role vs Anon Key
```typescript
// Service role can bypass RLS
const supabase = createClient(url, SERVICE_ROLE_KEY)

// Anon key respects RLS
const supabase = createClient(url, ANON_KEY)
```

### 3. Real-time Subscriptions
```typescript
// Check for active subscriptions to removed tables
const channel = supabase
  .channel('deprecated-table-changes')
  .on('postgres_changes', 
    { event: '*', schema: 'public', table: 'deprecated_table' },
    (payload) => console.log(payload)
  )
```

## Checklist for Supabase Cleanup

- [ ] Run SQL queries to check dependencies
- [ ] Create backup of table schema
- [ ] Create reversible migration
- [ ] Test migration locally
- [ ] Update generated TypeScript types
- [ ] Remove code references to table
- [ ] Remove RPC functions if any
- [ ] Check edge functions
- [ ] Update database documentation
- [ ] Test application thoroughly
- [ ] Deploy migration to staging
- [ ] Verify in staging
- [ ] Deploy to production
