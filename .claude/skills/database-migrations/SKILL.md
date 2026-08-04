---
name: database-migrations
description: The exact sequence for adding or changing database features in this repo — schema file, migration generation, apply, typegen, verify. Use whenever creating or modifying tables, columns, RLS policies, or functions in apps/web/supabase, or when database types are missing or stale.
---

# Database Workflow - CRITICAL SEQUENCE ⚠️

When adding new database features, ALWAYS follow this exact order.

## Method 1: Using db diff (Recommended for modifications)

1. **Create/modify schema file** in `apps/web/supabase/schemas/XX-feature.sql`
2. **Generate migration**: `pnpm --filter web supabase db diff -f <migration_name>`
3. **Apply migration**: `pnpm --filter web supabase migration up`
4. **Generate types**: `supabase gen types typescript --local > lib/database.types.ts && cp lib/database.types.ts /path/to/packages/supabase/src/database.types.ts`
5. **Verify types exist** before using in code

## Method 2: Manual migration from schema (For new features)

1. **Create schema file** in `apps/web/supabase/schemas/XX-feature.sql`
2. **Create timestamped migration**:
   ```bash
   timestamp=$(date -u +"%Y%m%d%H%M%S")
   cp apps/web/supabase/schemas/XX-feature.sql "apps/web/supabase/migrations/${timestamp}_feature-name.sql"
   ```
3. **Reset database**: `pnpm --filter web supabase db reset`
4. **Generate types**: `supabase gen types typescript --local > lib/database.types.ts && cp lib/database.types.ts /path/to/packages/supabase/src/database.types.ts`
5. **Verify types exist** before using in code

⚠️ **IMPORTANT**: Schema files alone don't create tables! You MUST either:
- Generate a migration with `db diff`, OR
- Manually copy the schema to migrations folder with timestamp

## Migration vs Reset

- Use `migration up` for normal development (applies only new migrations)
- Use `reset` when you need a clean database state or have schema conflicts

## Related commands

```bash
pnpm supabase:web:start     # Start Supabase locally
pnpm supabase:web:reset     # Reset with latest schema (clean rebuild)
pnpm supabase:web:typegen   # Generate TypeScript types
```

The typegen command must be run after applying migrations or resetting the database.

See `apps/web/supabase/CLAUDE.md` for further database workflow guidance.
