-- KB-60 and KB-42: what someone outside an account can read about it.
--
-- Tests: apps/web/supabase/tests/database/public-accounts-exposure.test.sql
--        apps/web/supabase/tests/database/account-budget-access.test.sql

-- ============================================================
-- KB-60. "Allow public read of public accounts" (20260108120000) let any
-- signed-in user read EVERY column of an account whose public_profile said
-- is_public: its email, its owner's user id, its budget and its usage.
-- Public pages need five of those columns. They now read this view, which
-- returns exactly those (plus updated_at, for the sitemap) for public team
-- accounts, and accounts itself is back to members only.
--
-- The view runs with its owner's rights, past accounts' RLS. So its select
-- list, its WHERE and the absence of any write privilege are the whole
-- contract; each is pinned by the test. security_barrier keeps a caller's
-- own functions in a WHERE from seeing rows the view filters out.
--
-- Personal accounts are excluded: no UI makes one public, their slug is
-- NULL so no public page can address one, and the API-only case is the one
-- that exposed an email.
-- ============================================================

drop policy if exists "Allow public read of public accounts" on public.accounts;

create view public.public_accounts
with (security_barrier = true) as
select
  id,
  name,
  slug,
  picture_url,
  public_profile,
  updated_at
from public.accounts
where not is_personal_account
  and coalesce((public_profile ->> 'is_public')::boolean, false);

-- A simple view is automatically updatable, and this one would update
-- accounts past its RLS: read only, for everyone.
revoke all on public.public_accounts from public, anon, authenticated, service_role;
grant select on public.public_accounts to anon, authenticated, service_role;

comment on view public.public_accounts is
  'KB-60: the public fields of public team accounts, for public pages. Owner-rights view: its columns and WHERE are the exposure. Read only.';

-- ============================================================
-- KB-42. check_account_budget is SECURITY DEFINER and checked nothing: any
-- signed-in user could ask about any account, and an unknown id raised
-- "Account not found: <id>", an existence oracle.
--
-- Now the caller must have access to the account, or be the service role.
-- Everyone else gets FALSE, the same for "not yours" as for "no such
-- account". FALSE, not an error, because the caller
-- (packages/features/audio-generation/src/server/voice-queries.ts) lets
-- generation through when the RPC errors.
--
-- create or replace keeps the existing grants (authenticated, service_role).
-- ============================================================

create or replace function public.check_account_budget(
  p_account_id uuid,
  p_estimated_cost_cents integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_usage integer;
  v_budget integer;
begin
  -- coalesce: auth.role() is NULL when the claims carry no role, and
  -- `false or NULL` is NULL, which `if not` would let through.
  if not (
    public.has_account_access(p_account_id)
    or coalesce((select auth.role()), '') = 'service_role'
  ) then
    return false;
  end if;

  select current_usage_cents, monthly_budget_cents
    into v_current_usage, v_budget
    from public.accounts
   where id = p_account_id;

  if not found then
    return false;
  end if;

  -- No budget limit set = unlimited
  if v_budget is null then
    return true;
  end if;

  return (v_current_usage + p_estimated_cost_cents) <= v_budget;
end;
$$;
