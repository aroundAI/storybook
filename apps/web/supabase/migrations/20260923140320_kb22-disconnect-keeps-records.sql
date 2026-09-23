-- KB-22: disconnecting a platform deletes the creator's own records.
--
-- Every disconnect path ended in `delete from platform_connections`, and the
-- schema cascaded that delete into the channel's publishes and, from them,
-- into manual revenue, tags, experiment membership and manual tasks — plus the
-- channel's YPP targets and publishing defaults. Reproduced 2026-09-23 against
-- the local database (specs/plans/KB-22-edd.md §8).
--
-- After this migration a disconnect is an UPDATE: the tokens are wiped, the
-- row is marked `disconnected_at`, and everything that points at it stays.
-- Reconnecting the same platform account re-attaches to the same row, because
-- every OAuth callback upserts on (account_id, platform, platform_account_id).

-- ==================================
-- 1. The disconnected state
-- ==================================

alter table public.platform_connections
  add column if not exists disconnected_at timestamptz;

comment on column public.platform_connections.disconnected_at is
  'Set when the creator disconnected this channel in the app (KB-22). Tokens are wiped; the row and its history stay. Cleared when a token is written again (reconnect).';

-- A disconnected row holds no credential and is not active. Enforced here so
-- it holds for every writer, not only the function below.
alter table public.platform_connections
  add constraint platform_connections_disconnected_holds_no_token check (
    disconnected_at is null
    or (
      access_token_encrypted is null
      and refresh_token_encrypted is null
      and not is_active
    )
  );

-- Writing a token is reconnecting. Six OAuth callbacks upsert this table;
-- clearing the flag here means none of them — nor a seventh — can forget to.
-- Only a token being *written* counts: an update that leaves a live token in
-- place and sets disconnected_at is refused by the CHECK above, not quietly
-- undone here.
create or replace function public.platform_connections_clear_disconnected()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.access_token_encrypted is not null
     and (tg_op = 'INSERT'
          or new.access_token_encrypted is distinct from old.access_token_encrypted) then
    new.disconnected_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists platform_connections_reconnect on public.platform_connections;

create trigger platform_connections_reconnect
before insert or update on public.platform_connections
for each row execute function public.platform_connections_clear_disconnected();

-- ==================================
-- 2. A credential going away must never take user data with it
-- ==================================
-- A connection row disappears only together with its account. The foreign
-- keys stay as they are — CASCADE from publishes, settings and publishing
-- defaults — because account deletion needs exactly those cascades; what
-- changes is that nothing else may start one.
--
-- Two designs were tried first, and both failed a test:
--
-- * Foreign keys `NO ACTION`: a cascade checks each referential step as it
--   runs, and deleting an account reaches platform_connections while the
--   publishes (reached through projects and episodes) are still there, so
--   every account deletion was refused — the KB-1 shape.
-- * The same, `DEFERRABLE INITIALLY DEFERRED`: account deletion then works,
--   but channel_analytics_settings' composite key — which stops a member
--   filing an override under another account's channel — stopped firing at
--   insert time.
--
-- The check: is the account still there? During an account deletion the
-- account row is already gone by the time the cascade reaches its
-- connections, so the delete is allowed. Anything else — a member through
-- PostgREST, the service role, an operator in the SQL editor — is refused,
-- whether or not anything yet points at the row: an empty connection is
-- still the row a reconnect should re-attach to.

create or replace function public.platform_connections_refuse_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.accounts a where a.id = old.account_id) then
    raise exception using
      errcode = 'restrict_violation',
      message = 'A platform connection is not deleted on its own; disconnect it with disconnect_platform_connection() (KB-22).',
      hint = 'Deleting the account removes its connections.';
  end if;

  return old;
end;
$$;

drop trigger if exists platform_connections_refuse_delete on public.platform_connections;

create trigger platform_connections_refuse_delete
before delete on public.platform_connections
for each row execute function public.platform_connections_refuse_delete();

-- Nothing in the app deletes a connection any more. Any member could, through
-- PostgREST, skipping both the vendor revoke and the dialog. Account deletion
-- is unaffected: a cascade does not consult RLS.
drop policy if exists "platform_connections_delete" on public.platform_connections;

-- ==================================
-- 3. The one definition of "disconnect"
-- ==================================
-- security invoker: the caller's RLS update policy (has_account_access) is the
-- authorisation, exactly as it was for the row delete this replaces.
--
-- Returns one row per connection it disconnected. A connection that was
-- already disconnected comes back once with already_disconnected = true; one
-- the caller cannot see (or that does not exist) returns nothing.
--
-- Meta: an Instagram account is reached through its Facebook Page and both
-- share one Facebook login, whose permissions the app revokes as a whole. The
-- linked row goes with it, as it did when disconnect deleted both.
create or replace function public.disconnect_platform_connection(
  p_connection_id uuid
)
returns table (id uuid, already_disconnected boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target public.platform_connections%rowtype;
  v_changed boolean := false;
begin
  select pc.* into v_target
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
