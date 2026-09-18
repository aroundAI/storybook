# Database Schema Management

This file contains guidance for working with database schemas, migrations, and database development workflows (Supabase or vendor-agnostic).

## Provider-Agnostic Database Patterns

This platform supports **multiple database providers** via environment variables:

```bash
# Option 1: Supabase (recommended for development)
DATABASE_PROVIDER=supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key

# Option 2: PostgreSQL (AWS RDS, self-hosted)
DATABASE_PROVIDER=postgresql
POSTGRES_HOST=your-rds-endpoint.amazonaws.com
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_USER=admin
POSTGRES_PASSWORD=secure-password

# Option 3: MySQL (for specific use cases)
DATABASE_PROVIDER=mysql
MYSQL_HOST=your-mysql-endpoint.amazonaws.com
# ... MySQL config
```

**Zero code changes required** - the `@kit/providers-database` package handles provider switching automatically.

**Migration Strategies**: See `SUPABASE_VENDOR_LOCKIN_REPORT.md` for detailed migration guides between providers.

## Schema Organization

Schemas are organized in numbered files in the `schemas/` directory. Numbers are used to sort dependencies.

**The database is built from `migrations/` alone.** Schema files are partial
documentation, mirrored by hand from each migration; nothing is generated
from them. You MUST write a migration for a database change to take effect.

### ⛔ `db diff` does not work here — write migrations by hand

The database is built from `migrations/`, not from `schemas/`. As of 2026-09-16
`schemas/` is missing **33 of the database's 99 tables**, so a `db diff` against
it would generate SQL to drop them. See the root `CLAUDE.md` for the full
measurement; the short version is that `schemas/` is partial documentation and
`migrations/` is the truth.

### Writing a migration

```bash
# 1. Write the migration by hand
timestamp=$(date -u +"%Y%m%d%H%M%S")
$EDITOR "apps/web/supabase/migrations/${timestamp}_my-feature.sql"

# 2. Apply it
pnpm --filter web supabase migration up

# 3. Mirror it into schemas/XX-my-feature.sql if that table has a schema file
#    (so the two do not drift further) — but never generate from it

# 4. Generate TypeScript types
pnpm supabase:web:typegen   # writes both copies; never hand-edit the result

# CI regenerates and diffs this. A hand-edited or stale database.types.ts
# fails the Supabase DB job. The CLI version in apps/web/package.json is
# pinned to the one CI installs so the two agree byte for byte.
```

⚠️ **CRITICAL**: Schema files are just documentation. Only a migration changes
the database.

**A migration that touches an RLS policy owes a pgTAP test** in
`tests/database/`, exercised with real roles via `makerkit.authenticate_as`.
Reading a policy is not testing it: a review of `revenue_records` read the
policies and reported a cross-tenant hole that does not exist, while missing two
that did. `revenue-records-rls.test.sql` is the worked example — including the
two traps, that `makerkit.get_account_id_by_slug` returns NULL for accounts the
caller cannot see, and that cases sharing a row must reset it between them.

## Security First Patterns

## Add permissions (if any)

```sql
ALTER TYPE public.app_permissions ADD VALUE 'notes.manage';
COMMIT;
```

### Table Creation with RLS

```sql
-- Create table
create table if not exists public.notes (
  id uuid unique not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  -- ...
  primary key (id)
);

-- CRITICAL: Always enable RLS
alter table "public"."notes" enable row level security;

-- Revoke default permissions
revoke all on public.notes from authenticated, service_role;

-- Grant specific permissions
grant select, insert, update, delete on table public.notes to authenticated;

-- Add RLS policies
create policy "notes_read" on public.notes for select
  to authenticated using (
    account_id = (select auth.uid()) or
    public.has_role_on_account(account_id)
  );

create policy "notes_write" on public.notes for insert
  to authenticated with check (
    public.has_permission(auth.uid(), account_id, 'notes.manage'::app_permissions)
  );

create policy "notes_update" on public.notes for update
  to authenticated using (
    public.has_permission(auth.uid(), account_id, 'notes.manage'::app_permissions)
  )
  with check (
    public.has_permission(auth.uid(), account_id, 'notes.manage'::app_permissions)
  );

create policy "notes_delete" on public.notes for delete
  to authenticated using (
    public.has_permission(auth.uid(), account_id, 'notes.manage'::app_permissions)
  );
```

### Storage Bucket Policies

```sql
-- Create storage bucket
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false);

-- RLS policy for storage
create policy documents_policy on storage.objects for all using (
  bucket_id = 'documents'
  and (
    -- File belongs to user's account
    kit.get_storage_filename_as_uuid(name) = auth.uid()
    or
    -- User has access to the account
    public.has_role_on_account(kit.get_storage_filename_as_uuid(name))
  )
)
with check (
  bucket_id = 'documents'
  and (
    kit.get_storage_filename_as_uuid(name) = auth.uid()
    or
    public.has_permission(
      auth.uid(),
      kit.get_storage_filename_as_uuid(name),
      'files.upload'::app_permissions
    )
  )
);
```

## Function Creation Patterns

### Safe Security Definer Functions

```sql
-- NEVER create security definer functions without explicit access controls
create or replace function public.create_team_account(account_name text)
returns public.accounts
language plpgsql
security definer  -- Elevated privileges
set search_path = '' -- Prevent SQL injection
as $$
declare
  new_account public.accounts;
begin
  -- CRITICAL: Validate permissions first
  if not public.is_set('enable_team_accounts') then
    raise exception 'Team accounts are not enabled';
  end if;

  -- Additional validation can go here
  if length(account_name) < 3 then
    raise exception 'Account name must be at least 3 characters';
  end if;

  -- Now safe to proceed with elevated privileges
  insert into public.accounts (name, is_personal_account)
  values (account_name, false)
  returning * into new_account;

  return new_account;
end;
$$;

-- Grant to authenticated users only
grant execute on function public.create_team_account(text) to authenticated;
```

### Security Invoker Functions (Safer)

```sql
-- Preferred: Functions that inherit RLS policies
create or replace function public.get_account_notes(target_account_id uuid)
returns setof public.notes
language plpgsql
security invoker  -- Inherits caller's permissions (RLS applies)
set search_path = ''
as $$
begin
  -- RLS policies will automatically restrict results
  return query
    select * from public.notes
    where account_id = target_account_id
    order by created_at desc;
end;
$$;

grant execute on function public.get_account_notes(uuid) to authenticated;
```

### Safe Column Additions

```sql
-- Safe: Add nullable columns
alter table public.accounts
add column if not exists description text;

-- Safe: Add columns with defaults
alter table public.accounts
add column if not exists is_verified boolean default false not null;

-- Unsafe: Adding non-null columns without defaults
-- alter table public.accounts add column required_field text not null; -- DON'T DO THIS
```

### Index Management

```sql
-- Create indexes concurrently for large tables
create index concurrently if not exists ix_accounts_created_at
on public.accounts (created_at desc);

-- Drop unused indexes
drop index if exists ix_old_unused_index;
```

## Testing Database Changes

### Local Testing

```bash
# Test with fresh database
pnpm supabase:web:reset

# Test your changes
pnpm run supabase:web:test
```

## Common Schema Patterns

### Audit Trail

Add triggers if the properties exist and are appropriate:

- `public.trigger_set_timestamps()` - for tables with `created_at` and `updated_at`
  columns
- `public.trigger_set_user_tracking()` - for tables with `created_by` and `updated_by`
  columns

### Useful Commands

```bash
# View migration status
pnpm --filter web supabase migration list

# Reset database completely
pnpm supabase:web:reset

# New migration: write it by hand (see "Writing a migration" above).
# There is deliberately no db-diff script — it was removed because it
# generated DROPs for the tables schemas/ is missing.

# Apply specific migration
pnpm --filter web supabase migration up --include-schemas public
```
