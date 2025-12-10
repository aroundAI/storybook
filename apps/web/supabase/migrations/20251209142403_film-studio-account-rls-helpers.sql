-- FILM-102c: Account-Based RLS Helper Functions
-- Utility functions for account-scoped authorization checks
-- These functions provide a clean API for account ownership checks

-- =============================================================================
-- Helper Functions for Account-Based Access Control
-- =============================================================================

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
    return exists (
        select 1
        from public.accounts a
        where a.id = p_account_id
        and a.primary_owner_user_id = auth.uid()
    );
end;
$$;

comment on function public.user_owns_account(uuid) is
  'Returns TRUE if the current authenticated user is the primary owner of the specified account.';

-- Grant execute permissions to authenticated users
grant execute on function public.user_owns_account(uuid) to authenticated;

-- Function to get current user's personal account_id
-- For personal accounts, the account.id equals the user's auth.uid()
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
    -- For personal accounts, the account_id equals the user_id (auth.uid())
    -- This is how the platform handles personal accounts
    select a.id into v_account_id
    from public.accounts a
    where a.primary_owner_user_id = auth.uid()
    and a.is_personal_account = true
    limit 1;

    return v_account_id;
end;
$$;

comment on function public.get_current_account_id() is
  'Returns the personal account ID for the current authenticated user.';

-- Grant execute permissions to authenticated users
grant execute on function public.get_current_account_id() to authenticated;

-- =============================================================================
-- Verification
-- =============================================================================

do $$
begin
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

    raise notice 'All account RLS helper functions verified successfully';
end $$;
