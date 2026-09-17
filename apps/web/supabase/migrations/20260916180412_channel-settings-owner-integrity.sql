-- ==================================
-- A channel override must belong to the channel's own account (FILM-1608)
-- ==================================
-- `channel_analytics_settings.account_id` is denormalised so RLS can read it
-- without joining, and the policies authorise on that column alone. Nothing
-- tied it to the connection, and a foreign key check does not run RLS — so a
-- member of account A could insert:
--
--   { connection_id: <a channel belonging to account B>, account_id: A }
--
-- `with check (has_account_access(account_id))` passes, because A really is
-- their account. `connection_id` is the whole primary key, so that row then
-- squats the slot: account B's own upsert hits `on conflict (connection_id)
-- do update` against a row its SELECT and UPDATE policies refuse, and every
-- save for that channel fails with "Settings could not be saved" from then
-- on. There is deliberately no delete grant, so B cannot clear it either.
--
-- Reproduced before fixing: an attacker with no access whatsoever to the
-- victim's account inserted a row against the victim's connection.
--
-- Deriving `account_id` server-side in the action, which is what this PR did
-- first, only closes the path through that action. PostgREST is reachable
-- directly by any authenticated browser client, so the table has to be the
-- thing that refuses it.
--
-- A composite foreign key makes the pair consistent by construction: the
-- account written must be the account that owns the connection. It is
-- integrity rather than authorisation, so it holds for service_role, psql and
-- anything written later without going near a policy.

-- The referenced columns need a unique constraint of their own. `id` is
-- already the primary key, so this adds no meaningful index cost and cannot
-- fail: (id, account_id) is unique wherever id is.
alter table public.platform_connections
  add constraint platform_connections_id_account_key unique (id, account_id);

alter table public.channel_analytics_settings
  drop constraint channel_analytics_settings_connection_id_fkey;

alter table public.channel_analytics_settings
  add constraint channel_analytics_settings_connection_account_fkey
  foreign key (connection_id, account_id)
  references public.platform_connections (id, account_id)
  on delete cascade;
