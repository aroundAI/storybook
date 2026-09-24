-- KB-43 and KB-44.
--
-- KB-43. `platform_connections_read` lets any member of an account read its
-- connections, and `authenticated` held SELECT on the whole table, so any
-- member could select `access_token_encrypted` and `refresh_token_encrypted`
-- through PostgREST. Nothing a member does needs them: every decrypt happens
-- on the server with the service role. Members now read every other column.
--
-- A column grant is only a restriction once the table-level SELECT is gone,
-- so the table grant is revoked and the columns granted back by name. A
-- column added later is unreadable to members until it is granted here too;
-- `platform-connection-token-grants.test.sql` fails until that decision is
-- made.
--
-- What this refuses beyond the tokens, all moved in the same change:
--   * `select *` by a member (no app code does it);
--   * an upsert by a member: ON CONFLICT DO UPDATE reads the token columns
--     back through EXCLUDED. The OAuth callbacks now write through the admin
--     client after an explicit has_account_access check
--     (apps/web/lib/platforms/store-connection.ts);
--   * `disconnect_platform_connection`'s `select pc.*`, rewritten below.
--
-- Deploy order: ship the app code with this migration or before it. Against
-- the old callbacks, connecting a platform fails with `storage_failed`.

revoke select on public.platform_connections from authenticated;

grant select (
  id,
  account_id,
  platform,
  platform_account_id,
  platform_account_name,
  token_expires_at,
  scopes,
  is_active,
  created_at,
  updated_at,
  language,
  metadata,
  disconnected_at
) on public.platform_connections to authenticated;

-- `disconnect_platform_connection` is security invoker (the member's RLS
-- update policy is its authorisation, KB-22) and read `select pc.*` into a
-- rowtype, which now names columns members may not read. It selects the six
-- it uses into a record instead; the body is otherwise unchanged, and so are
-- its grants.
create or replace function public.disconnect_platform_connection(
  p_connection_id uuid
)
returns table (id uuid, already_disconnected boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target record;
  v_changed boolean := false;
begin
  -- Named columns, not pc.*: members may not read the token columns (KB-43).
  select pc.id, pc.account_id, pc.platform, pc.platform_account_id,
         pc.metadata, pc.disconnected_at
    into v_target
  from public.platform_connections pc
  where pc.id = p_connection_id;

  if not found then
    return;
  end if;

  if v_target.disconnected_at is null then
    return query
    update public.platform_connections pc
       set access_token_encrypted = null,
           refresh_token_encrypted = null,
           token_expires_at = null,
           is_active = false,
           disconnected_at = now()
     where pc.disconnected_at is null
       and (
         pc.id = v_target.id
         or (
           pc.account_id = v_target.account_id
           and (
             (v_target.platform = 'instagram'
               and pc.platform = 'facebook'
               and pc.platform_account_id = v_target.metadata ->> 'linked_page_id')
             or (v_target.platform = 'facebook'
               and pc.platform = 'instagram'
               and pc.metadata ->> 'linked_page_id' = v_target.platform_account_id)
           )
         )
       )
    returning pc.id, false;

    v_changed := found;
  end if;

  -- Already disconnected, or a concurrent call got there first.
  if not v_changed then
    return query select v_target.id, true;
  end if;
end;
$$;

revoke all on function public.disconnect_platform_connection(uuid) from public, anon;
grant execute on function public.disconnect_platform_connection(uuid) to authenticated, service_role;

-- KB-44. `anon` held every privilege on the table, TRUNCATE included, which
-- row-level security does not apply to. Nothing anonymous touches a
-- connection.
revoke all on public.platform_connections from anon;

-- KB-44, the class. Supabase's default grants hand anon and authenticated
-- TRUNCATE, TRIGGER and REFERENCES on every table: measured 2026-09-24, anon
-- on 75 public tables and authenticated on 29. PostgREST cannot issue any of
-- them and no function or app code relies on them, and TRUNCATE skips RLS.
-- The ordinary grants stay: RLS governs those.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- And for tables created from here on, by migrations (which run as postgres).
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
