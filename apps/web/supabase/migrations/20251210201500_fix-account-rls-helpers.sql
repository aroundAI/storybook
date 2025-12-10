-- FILM-102c Fix: Add explicit auth validation and refactor RLS policies to use helper functions
-- This migration addresses code review feedback:
-- 1. Add explicit authentication checks to security definer functions
-- 2. Refactor RLS policies to use the helper functions (reducing code duplication)

-- =============================================================================
-- Drop and recreate helper functions with explicit auth validation
-- =============================================================================

-- Drop existing functions first
drop function if exists public.user_owns_account(uuid);
drop function if exists public.get_current_account_id();

-- Function to check if current user owns an account
-- Returns TRUE if the account belongs to the current authenticated user
create or replace function public.user_owns_account(p_account_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
    -- CRITICAL: Validate authentication first
    if auth.uid() is null then
        return false;
    end if;

    -- Validate input parameter
    if p_account_id is null then
        return false;
    end if;

    return exists (
        select 1
        from public.accounts a
        where a.id = p_account_id
        and a.primary_owner_user_id = auth.uid()
    );
end;
$$;

comment on function public.user_owns_account(uuid) is
  'Returns TRUE if the current authenticated user is the primary owner of the specified account. Returns FALSE if not authenticated or account_id is null.';

grant execute on function public.user_owns_account(uuid) to authenticated;

-- Function to get current user's personal account_id
create or replace function public.get_current_account_id()
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
    v_account_id uuid;
begin
    -- CRITICAL: Validate authentication first
    if auth.uid() is null then
        return null;
    end if;

    select a.id into v_account_id
    from public.accounts a
    where a.primary_owner_user_id = auth.uid()
    and a.is_personal_account = true
    limit 1;

    return v_account_id;
end;
$$;

comment on function public.get_current_account_id() is
  'Returns the personal account ID for the current authenticated user. Returns NULL if not authenticated.';

grant execute on function public.get_current_account_id() to authenticated;

-- =============================================================================
-- Helper function to check account access (ownership OR team membership)
-- =============================================================================

create or replace function public.has_account_access(p_account_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
    -- CRITICAL: Validate authentication first
    if auth.uid() is null then
        return false;
    end if;

    -- Validate input parameter
    if p_account_id is null then
        return false;
    end if;

    -- Check if user is owner OR has a role on the account
    return exists (
        select 1
        from public.accounts a
        where a.id = p_account_id
        and (
            a.primary_owner_user_id = auth.uid()
            or public.has_role_on_account(a.id)
        )
    );
end;
$$;

comment on function public.has_account_access(uuid) is
  'Returns TRUE if the current user has access to the account (either as owner or team member). Returns FALSE if not authenticated or account_id is null.';

grant execute on function public.has_account_access(uuid) to authenticated;

-- =============================================================================
-- Refactor RLS policies to use helper functions
-- =============================================================================

-- Drop existing policies
drop policy if exists "generation_jobs_read" on public.generation_jobs;
drop policy if exists "generation_jobs_update" on public.generation_jobs;

drop policy if exists "platform_connections_read" on public.platform_connections;
drop policy if exists "platform_connections_create" on public.platform_connections;
drop policy if exists "platform_connections_update" on public.platform_connections;
drop policy if exists "platform_connections_delete" on public.platform_connections;

drop policy if exists "shared_resources_read" on public.shared_resources;
drop policy if exists "shared_resources_create" on public.shared_resources;
drop policy if exists "shared_resources_update" on public.shared_resources;
drop policy if exists "shared_resources_delete" on public.shared_resources;

drop policy if exists "external_api_keys_read" on public.external_api_keys;
drop policy if exists "external_api_keys_create" on public.external_api_keys;
drop policy if exists "external_api_keys_update" on public.external_api_keys;
drop policy if exists "external_api_keys_delete" on public.external_api_keys;

-- =============================================================================
-- Generation Jobs RLS Policies (using helper function)
-- =============================================================================

create policy "generation_jobs_read" on public.generation_jobs for select
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "generation_jobs_update" on public.generation_jobs for update
  to authenticated using (
    public.has_account_access(account_id)
  );

-- Note: generation_jobs_create uses project_members check (unchanged)
-- Note: No delete policy - jobs should not be deleted

-- =============================================================================
-- Platform Connections RLS Policies (using helper function)
-- =============================================================================

create policy "platform_connections_read" on public.platform_connections for select
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "platform_connections_create" on public.platform_connections for insert
  to authenticated with check (
    public.has_account_access(account_id)
  );

create policy "platform_connections_update" on public.platform_connections for update
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "platform_connections_delete" on public.platform_connections for delete
  to authenticated using (
    public.has_account_access(account_id)
  );

-- =============================================================================
-- Shared Resources RLS Policies (using helper function)
-- =============================================================================

create policy "shared_resources_read" on public.shared_resources for select
  to authenticated using (
    public.has_account_access(account_id)
    or is_system = true
  );

create policy "shared_resources_create" on public.shared_resources for insert
  to authenticated with check (
    public.has_account_access(account_id)
    and is_system = false
  );

create policy "shared_resources_update" on public.shared_resources for update
  to authenticated using (
    public.has_account_access(account_id)
    and is_system = false
  );

create policy "shared_resources_delete" on public.shared_resources for delete
  to authenticated using (
    public.has_account_access(account_id)
    and is_system = false
  );

-- =============================================================================
-- External API Keys RLS Policies (using helper function)
-- =============================================================================

create policy "external_api_keys_read" on public.external_api_keys for select
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "external_api_keys_create" on public.external_api_keys for insert
  to authenticated with check (
    public.has_account_access(account_id)
  );

create policy "external_api_keys_update" on public.external_api_keys for update
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "external_api_keys_delete" on public.external_api_keys for delete
  to authenticated using (
    public.has_account_access(account_id)
  );

-- =============================================================================
-- Verification
-- =============================================================================

do $$
begin
    -- Verify helper functions exist with proper signatures
    if not exists (
        select 1 from pg_proc where proname = 'user_owns_account'
    ) then
        raise exception 'Helper function user_owns_account not created';
    end if;

    if not exists (
        select 1 from pg_proc where proname = 'get_current_account_id'
    ) then
        raise exception 'Helper function get_current_account_id not created';
    end if;

    if not exists (
        select 1 from pg_proc where proname = 'has_account_access'
    ) then
        raise exception 'Helper function has_account_access not created';
    end if;

    -- Verify policies were recreated
    if not exists (
        select 1 from pg_policies
        where tablename = 'platform_connections'
        and policyname = 'platform_connections_read'
    ) then
        raise exception 'Policy platform_connections_read not created';
    end if;

    raise notice 'All account RLS helper functions and policies verified successfully';
end $$;
