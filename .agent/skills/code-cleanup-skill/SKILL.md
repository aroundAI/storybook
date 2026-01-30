---
name: code-cleanup-dead-code-removal
description: Identifies and safely removes dead code, deprecated features, unused imports, orphaned database tables, and dangling references from Makerkit NextJS + Supabase codebases. Use this when cleaning up deprecated features, removing unused code, or performing codebase maintenance.
---

# Code Cleanup & Dead Code Removal Skill

This skill provides a systematic, senior-engineer approach to identifying and safely removing dead code from Makerkit NextJS + Supabase applications.

## Scope

This skill handles:
- **Dead Code Detection**: Unused functions, components, hooks, and utilities
- **Deprecated Features**: Code marked for removal but still referenced
- **Import Cleanup**: Unused imports and dependencies
- **Database Cleanup**: Orphaned SQL tables, unused migrations, and deprecated schemas
- **Reference Analysis**: Cross-file dependencies and impact analysis
- **Safe Removal**: Multi-phase validation before deletion

## Architecture Understanding

### Makerkit NextJS Structure
- **App Router** (`/app`): Server components, route handlers, layouts
- **Components** (`/components`): React components (client/server)
- **Lib** (`/lib`): Utilities, hooks, types, configurations
- **Supabase** (`/supabase`): SQL migrations, types, RPC functions
- **Config** (`/config`): Application configurations

### Critical Safety Rules

1. **NEVER delete code without validation**
2. **ALWAYS check database dependencies**
3. **ALWAYS verify no runtime references exist**
4. **ALWAYS backup before major changes**
5. **ALWAYS run tests after cleanup**

## Execution Workflow

### Phase 1: Discovery & Analysis

**Step 1.1: Use the Analysis Script**
```bash
python scripts/analyze_codebase.py --target /path/to/codebase
```

This generates:
- `reports/dead_code_analysis.json` - Detected dead code
- `reports/import_analysis.json` - Unused imports
- `reports/database_analysis.json` - Orphaned DB objects
- `reports/dependency_graph.json` - Cross-file dependencies

**Step 1.2: Review the Impact Report**

The script identifies:
- Functions/components with zero call sites
- Imports that are never used
- Database tables with no application references
- Deprecated markers (`@deprecated`, `// TODO: Remove`)

### Phase 2: Validation & Confirmation

**Step 2.1: Verify with the User**

Present findings in a structured report:

```
🔍 Dead Code Analysis Report
━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 COMPONENTS (12 unused)
  ❌ /components/deprecated/OldAuthForm.tsx
     Last modified: 6 months ago
     References: 0
     Database deps: users.legacy_auth_method (unused)

📄 FUNCTIONS (8 unused)
  ❌ /lib/utils/legacyParser.ts::parseLegacyData()
     References: 0
     Imports: lodash (can be removed)

🗄️ DATABASE TABLES (3 orphaned)
  ❌ supabase/migrations/20230615_legacy_sessions.sql
     Table: legacy_sessions
     References in code: 0
     Last migration: 8 months ago

⚠️  WARNINGS
  ⚡ Some functions are exported but never imported
  ⚡ Database tables may have foreign key constraints
```

**Step 2.2: Get Explicit User Confirmation**

CRITICAL: Do not proceed without user approval for each category.

Ask:
- "Shall I remove these 12 unused components?"
- "These database tables appear orphaned. Have you verified they're not used by external services?"
- "Do you want to create a rollback branch first?"

### Phase 3: Safe Removal

**Step 3.1: Create Safety Checkpoint**
```bash
python scripts/create_checkpoint.py --name "pre-cleanup-$(date +%Y%m%d)"
```

This creates:
- Git branch: `cleanup/checkpoint-YYYYMMDD`
- Backup of SQL files in `backups/`
- Snapshot of current dependency tree

**Step 3.2: Execute Removal**

Run the cleanup with the approved items:
```bash
python scripts/remove_dead_code.py \
  --components reports/approved_components.json \
  --functions reports/approved_functions.json \
  --database reports/approved_database.json \
  --dry-run  # First pass: simulate only
```

Review the dry-run output, then:
```bash
python scripts/remove_dead_code.py \
  --components reports/approved_components.json \
  --functions reports/approved_functions.json \
  --database reports/approved_database.json \
  --execute
```

**Step 3.3: Clean Up Imports**
```bash
python scripts/cleanup_imports.py --auto-fix
```

This uses AST parsing to:
- Remove unused imports
- Sort imports (built-in → external → internal)
- Remove duplicate imports
- Update package.json if dependencies are orphaned

### Phase 4: Verification

**Step 4.1: Run Validation Suite**
```bash
python scripts/validate_cleanup.py
```

Checks:
- ✅ TypeScript compilation succeeds
- ✅ No runtime import errors
- ✅ Database migrations are reversible
- ✅ No broken foreign key constraints
- ✅ Test suite passes

**Step 4.2: Database Integrity Check**

For each removed SQL object:
```sql
-- Check foreign key constraints
SELECT constraint_name, table_name 
FROM information_schema.table_constraints 
WHERE constraint_type = 'FOREIGN KEY' 
  AND referenced_table_name = 'removed_table';

-- Verify no RPC functions reference the table
SELECT proname 
FROM pg_proc 
WHERE prosrc LIKE '%removed_table%';
```

**Step 4.3: Generate Removal Report**

Create a detailed changelog:
```
📝 Code Cleanup Summary
━━━━━━━━━━━━━━━━━━━━━

Removed:
  • 12 components (3,450 LOC)
  • 8 utility functions (890 LOC)
  • 3 database tables (removed via migration)
  • 47 unused imports
  
Impact:
  • Bundle size: -124 KB (gzipped)
  • Dependencies removed: lodash-es, moment (superseded by date-fns)
  • Database size: -2.3 MB
  
Safety:
  • All tests passing ✅
  • No TypeScript errors ✅
  • Database constraints validated ✅
  • Rollback available: cleanup/checkpoint-20260130
```

### Phase 5: Post-Cleanup Actions

**Step 5.1: Update Documentation**

Remove references in:
- README.md
- API documentation
- Internal wikis
- Storybook stories

**Step 5.2: Notify the Team**

If this is a team project:
```bash
python scripts/generate_cleanup_pr.py \
  --title "chore: remove deprecated authentication features" \
  --body reports/cleanup_summary.md
```

**Step 5.3: Monitor Production**

Add the following to monitoring:
```
Watch for:
  - Unexpected 404s on removed routes
  - Database errors related to removed tables
  - Client-side errors from removed components
```

## Special Handling: Makerkit Patterns

### 1. Server vs. Client Components

When removing a component, check its directive:
```typescript
// If it has "use client" but is never imported in client code,
// it might still be server-rendered. Check app router usage.
'use client'
```

Validate:
```bash
grep -r "ComponentName" app/ --include="*.tsx"
```

### 2. Supabase RPC Functions

For database cleanup:
```sql
-- List all RPC functions
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_type = 'FUNCTION'
  AND routine_schema = 'public';
```

Check if functions reference the table:
```bash
grep -r "table_name" supabase/functions/ --include="*.sql"
```

### 3. Middleware & Route Handlers

Before removing route handlers:
```bash
# Check for dynamic imports or lazy loading
grep -r "import.*ComponentName" . --include="*.ts" --include="*.tsx"
grep -r "dynamic.*ComponentName" . --include="*.ts" --include="*.tsx"
```

### 4. Environment Variables

When removing features, also remove:
```bash
# Check .env files
grep "LEGACY_FEATURE" .env .env.local .env.example

# Update .env.example
python scripts/cleanup_env_vars.py --feature "legacy_auth"
```

## Handling Edge Cases

### Case 1: Exported but Never Imported

```typescript
// Function is exported but never imported elsewhere
export function oldHelper() { ... }
```

**Action**: 
1. Search entire codebase for string "oldHelper"
2. Check if dynamically imported (`import(...)`)
3. Verify not called via eval or reflection
4. If truly unused, remove export first, then function

### Case 2: Database Table with Foreign Keys

**Action**:
```sql
-- Generate safe removal migration
CREATE MIGRATION remove_legacy_sessions AS $$
  -- Step 1: Drop dependent constraints
  ALTER TABLE user_devices DROP CONSTRAINT fk_session_id;
  
  -- Step 2: Drop the table
  DROP TABLE legacy_sessions;
  
  -- Step 3: Clean up any triggers
  DROP TRIGGER IF EXISTS legacy_sessions_updated ON legacy_sessions;
$$;
```

### Case 3: Type-Only Imports

```typescript
import type { OldType } from './deprecated'
```

**Action**: 
- Safe to remove if OldType is not referenced
- Check for `as OldType` type assertions
- Validate with TypeScript compiler

### Case 4: Code Behind Feature Flags

```typescript
if (featureFlags.useLegacyAuth) {
  // Old code
}
```

**Action**:
1. Confirm feature flag is permanently disabled
2. Remove the conditional AND the flag definition
3. Update feature flag documentation

## Output Requirements

Always produce:

1. **Before State Snapshot**
   - List of files to be modified
   - Current LOC count
   - Current bundle size

2. **After State Report**
   - Files removed/modified
   - LOC reduction
   - Bundle size reduction
   - Test results

3. **Rollback Instructions**
   ```bash
   # If cleanup causes issues:
   git checkout cleanup/checkpoint-20260130
   
   # Restore database:
   psql < backups/pre-cleanup-20260130.sql
   ```

## Integration with Makerkit Conventions

Follow these Makerkit patterns:

1. **File Organization**
   - Keep barrel exports (`index.ts`) updated
   - Remove from `components/index.ts` when deleting components

2. **Testing**
   - Remove corresponding `.test.tsx` files
   - Remove mocks from `__mocks__/` directory
   - Update test coverage reports

3. **Supabase Conventions**
   - Create down migrations for every up migration
   - Update Supabase type definitions (`supabase/types.ts`)
   - Reset local Supabase: `supabase db reset` (after backup)

## Troubleshooting

### "Cannot find module" after cleanup

**Cause**: Barrel export not updated
**Fix**: 
```bash
python scripts/update_barrel_exports.py --scan components/
```

### Tests failing after cleanup

**Cause**: Mock still references removed function
**Fix**:
```bash
# Find all mocks
find . -name "*.mock.ts" -o -name "__mocks__"
# Remove references manually
```

### TypeScript errors after cleanup

**Cause**: Cached types
**Fix**:
```bash
rm -rf .next
rm -rf node_modules/.cache
npm run type-check
```

## Success Criteria

A successful cleanup achieves:
- ✅ Zero TypeScript errors
- ✅ All tests passing
- ✅ No runtime errors in dev mode
- ✅ Database migrations reversible
- ✅ Bundle size reduced
- ✅ Code coverage maintained or improved
- ✅ No dead code remaining (validated by scripts)

## Examples

See the `examples/` directory for:
- `before_after_component.md` - Component removal example
- `database_cleanup_example.md` - SQL table removal example
- `import_cleanup_example.md` - Import statement cleanup

## Resources

Reference files in `resources/`:
- `makerkit_structure.md` - Detailed Makerkit directory structure
- `supabase_patterns.md` - Supabase best practices
- `safe_removal_checklist.md` - Step-by-step safety checklist

---

**Remember**: The goal is not just to delete code, but to leave the codebase in a better, cleaner, more maintainable state with zero regression. When in doubt, validate. When validating is unclear, ask the user.
