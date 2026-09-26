-- KB-84, and the owner's decision on who manages API keys (2026-09-25).
--
-- 1. Members may not read the ciphertext.
--
-- `external_api_keys_read` lets every role on an account read its rows, and
-- `authenticated` held SELECT on the whole table, so any member, a project
-- viewer included, could select `encrypted_key` through PostgREST. Nothing a
-- member does needs it: every decrypt happens on the server. Members now read
-- every other column, which is enough to see which providers are configured.
--
-- A column grant is only a restriction once the table-level SELECT is gone,
-- so the table grant is revoked and the columns granted back by name. A column
-- added later is unreadable to members until it is granted here too;
-- `external-api-key-grants.test.sql` fails until that decision is made.
--
-- What this refuses beyond the ciphertext: `select *` by a member (no app code
-- does it), and an upsert by a member, because ON CONFLICT DO UPDATE reads
-- `encrypted_key` back through EXCLUDED. The app reads and stores keys only
-- through `packages/supabase/src/external-api-keys.ts`, which checks the
-- caller on their own client and then uses the admin client.
--
-- 2. Only account owners add, replace or remove a key.
--
-- The write policies were `has_account_access`, so any role on the account
-- could overwrite or delete a key, and UPDATE needs no SELECT: a member could
-- replace `encrypted_key` without reading it. An owner is the account's
-- primary owner (a personal account has no membership row) or a member with
-- the `owner` role; `can_manage_account_api_keys` is that rule for the
-- policies, and `canManageExternalApiKeys` in the helper asks the same two
-- predicates.
--
-- Deploy order: ship the app code with this migration, or before it. Against
-- the old code every BYOK read and the settings save fail with 42501.

revoke select on public.external_api_keys from authenticated;

grant select (
  id,
  account_id,
  provider,
  is_active,
  last_used_at,
  created_at
) on public.external_api_keys to authenticated;

create or replace function public.can_manage_account_api_keys(p_account_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.accounts a
     where a.id = p_account_id
       and (
         a.primary_owner_user_id = (select auth.uid())
         or public.has_role_on_account(a.id, 'owner')
       )
  );
$$;

comment on function public.can_manage_account_api_keys(uuid) is
  'KB-84: true when the caller may add, replace or remove the account''s API keys: its primary owner, or a member with the owner role.';

revoke all on function public.can_manage_account_api_keys(uuid) from public, anon;
grant execute on function public.can_manage_account_api_keys(uuid) to authenticated, service_role;

drop policy if exists "external_api_keys_create" on public.external_api_keys;
drop policy if exists "external_api_keys_update" on public.external_api_keys;
drop policy if exists "external_api_keys_delete" on public.external_api_keys;

create policy "external_api_keys_create" on public.external_api_keys for insert
  to authenticated
  with check (public.can_manage_account_api_keys(account_id));

-- WITH CHECK as well as USING: an owner of one account must not move a key
-- row onto an account they do not own.
create policy "external_api_keys_update" on public.external_api_keys for update
  to authenticated
  using (public.can_manage_account_api_keys(account_id))
  with check (public.can_manage_account_api_keys(account_id));

create policy "external_api_keys_delete" on public.external_api_keys for delete
  to authenticated
  using (public.can_manage_account_api_keys(account_id));
