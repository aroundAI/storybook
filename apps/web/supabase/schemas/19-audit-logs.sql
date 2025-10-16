-- ============================================================================
-- Audit Logs Schema
-- ============================================================================
--
-- Comprehensive audit logging system with configurable tracking and
-- pre-processing transformers for different object types.
--
-- Features:
-- - Polymorphic object associations (tracks any object type)
-- - Flexible scoping (account, project, or combined scopes)
-- - Before/after state tracking with changes
-- - User attribution and network info
-- - Performance-optimized with GIN indexes
--
-- ============================================================================

-- ============================================================================
-- ENUMS
-- ============================================================================

-- Audit actions
create type public.audit_action as enum (
  'create',
  'update',
  'delete',
  'archive',
  'restore',
  'login',
  'logout',
  'invite',
  'accept_invite',
  'reject_invite',
  'permission_change',
  'settings_change',
  'export',
  'import',
  'custom'
);

-- Audit severity levels
create type public.audit_severity as enum (
  'info',
  'warning',
  'critical'
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- Audit logs table
create table if not exists public.audit_logs (
  -- Primary identification
  id uuid unique not null default extensions.uuid_generate_v4(),

  -- Account association (for RLS and scoping)
  account_id uuid references public.accounts(id) on delete cascade not null,

  -- User who performed the action (nullable for system actions)
  user_id uuid references auth.users(id) on delete set null,

  -- Action details
  action public.audit_action not null,
  object_type varchar(100) not null, -- e.g., 'project', 'user', 'settings'
  object_id varchar(255) not null,   -- ID of the affected object
  object_name text,                  -- Human-readable name
  description text not null,         -- Human-readable description

  -- State tracking
  changes jsonb,          -- { field: { before: x, after: y } }
  before_state jsonb,     -- Full object state before action
  after_state jsonb,      -- Full object state after action

  -- Flexible scoping
  -- Allows queries like "all audit logs for project X" or "all logs for account Y"
  scopes jsonb not null default '[]'::jsonb,  -- [{ type: 'account', id: 'uuid' }, { type: 'project', id: 'uuid' }]

  -- Severity and metadata
  severity public.audit_severity not null default 'info',
  metadata jsonb,         -- Additional context-specific data

  -- Network/client information
  ip_address inet,
  user_agent text,

  -- Timestamps
  created_at timestamp with time zone default now() not null,

  -- Primary key
  primary key (id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Index on account_id for RLS and queries
create index if not exists ix_audit_logs_account_id
  on public.audit_logs (account_id);

-- Index on user_id for user activity queries
create index if not exists ix_audit_logs_user_id
  on public.audit_logs (user_id);

-- Index on object_type and object_id for object-specific queries
create index if not exists ix_audit_logs_object
  on public.audit_logs (object_type, object_id);

-- Index on action for filtering by action type
create index if not exists ix_audit_logs_action
  on public.audit_logs (action);

-- Index on created_at for time-based queries
create index if not exists ix_audit_logs_created_at
  on public.audit_logs (created_at desc);

-- GIN index on scopes for flexible scope queries
create index if not exists ix_audit_logs_scopes_gin
  on public.audit_logs using gin (scopes);

-- GIN index on changes for searching specific field changes
create index if not exists ix_audit_logs_changes_gin
  on public.audit_logs using gin (changes);

-- Composite index for common query pattern (account + time)
create index if not exists ix_audit_logs_account_created
  on public.audit_logs (account_id, created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS
alter table public.audit_logs enable row level security;

-- Revoke default permissions
revoke all on public.audit_logs from authenticated, service_role;

-- Grant specific permissions
grant select, insert on table public.audit_logs to authenticated;

-- Policy: Users can only read audit logs for their accounts
create policy "audit_logs_read" on public.audit_logs
  for select to authenticated
  using (
    account_id = (select auth.uid()) or
    public.has_role_on_account(account_id)
  );

-- Policy: Users can insert audit logs for their accounts
create policy "audit_logs_insert" on public.audit_logs
  for insert to authenticated
  with check (
    account_id = (select auth.uid()) or
    public.has_role_on_account(account_id)
  );

-- No update or delete policies - audit logs are immutable

-- Service role can read all audit logs (for admin)
grant select on table public.audit_logs to service_role;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function: Get audit logs for a specific object
create or replace function public.get_audit_logs_for_object(
  target_object_type text,
  target_object_id text,
  limit_count integer default 50
)
returns setof public.audit_logs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    select * from public.audit_logs
    where object_type = target_object_type
      and object_id = target_object_id
    order by created_at desc
    limit limit_count;
end;
$$;

grant execute on function public.get_audit_logs_for_object(text, text, integer) to authenticated;

-- Function: Get audit logs for a specific scope
-- Example: get_audit_logs_for_scope('project', 'uuid-here')
create or replace function public.get_audit_logs_for_scope(
  scope_type text,
  scope_id text,
  limit_count integer default 50
)
returns setof public.audit_logs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    select * from public.audit_logs
    where scopes @> jsonb_build_array(
      jsonb_build_object('type', scope_type, 'id', scope_id)
    )
    order by created_at desc
    limit limit_count;
end;
$$;

grant execute on function public.get_audit_logs_for_scope(text, text, integer) to authenticated;

-- Function: Get recent audit logs for an account
create or replace function public.get_recent_audit_logs(
  target_account_id uuid,
  limit_count integer default 100
)
returns setof public.audit_logs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    select * from public.audit_logs
    where account_id = target_account_id
    order by created_at desc
    limit limit_count;
end;
$$;

grant execute on function public.get_recent_audit_logs(uuid, integer) to authenticated;

-- Function: Get audit logs by user
create or replace function public.get_audit_logs_by_user(
  target_user_id uuid,
  target_account_id uuid,
  limit_count integer default 50
)
returns setof public.audit_logs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    select * from public.audit_logs
    where user_id = target_user_id
      and account_id = target_account_id
    order by created_at desc
    limit limit_count;
end;
$$;

grant execute on function public.get_audit_logs_by_user(uuid, uuid, integer) to authenticated;

-- Function: Get audit logs by action
create or replace function public.get_audit_logs_by_action(
  target_account_id uuid,
  target_action public.audit_action,
  limit_count integer default 50
)
returns setof public.audit_logs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    select * from public.audit_logs
    where account_id = target_account_id
      and action = target_action
    order by created_at desc
    limit limit_count;
end;
$$;

grant execute on function public.get_audit_logs_by_action(uuid, public.audit_action, integer) to authenticated;

-- Function: Calculate change summary (count of changes per field)
create or replace function public.get_change_summary(
  target_account_id uuid,
  target_object_type text,
  days_back integer default 30
)
returns table (
  field_name text,
  change_count bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    select
      key as field_name,
      count(*) as change_count
    from public.audit_logs,
    lateral jsonb_object_keys(changes) as key
    where account_id = target_account_id
      and object_type = target_object_type
      and created_at >= now() - (days_back || ' days')::interval
      and changes is not null
    group by key
    order by change_count desc;
end;
$$;

grant execute on function public.get_change_summary(uuid, text, integer) to authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================

comment on table public.audit_logs is
  'Audit logs for tracking all important actions across different object types';

comment on column public.audit_logs.scopes is
  'Flexible scoping array for queries. Example: [{"type": "account", "id": "uuid"}, {"type": "project", "id": "uuid"}]';

comment on column public.audit_logs.changes is
  'Field-level changes in format: {"field_name": {"before": value, "after": value}}';

comment on column public.audit_logs.before_state is
  'Complete object state before action (may be transformed/redacted)';

comment on column public.audit_logs.after_state is
  'Complete object state after action (may be transformed/redacted)';

comment on function public.get_audit_logs_for_scope(text, text, integer) is
  'Get audit logs for a specific scope (e.g., all logs for project X)';

comment on function public.get_change_summary(uuid, text, integer) is
  'Get summary of which fields changed most frequently for an object type';
