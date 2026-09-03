-- Enable RLS on the embedding tables and scope reads to the parent row.
--
-- Both tables were created without RLS. Every table in `public` grants
-- `authenticated` full DML by default, so RLS is the only thing that scopes
-- a table to its tenant: with it off, any signed-in user of any account
-- could select, update, delete or truncate every account's embeddings.
-- Verified locally before this change — `set role authenticated; select
-- from public.episode_embeddings` returned rows unfiltered.
--
-- Writes stay service-role only. The embedding worker runs in a Lambda with
-- no user session and now uses the admin client, which bypasses RLS; no
-- user-facing path writes these.

alter table public.episode_embeddings enable row level security;
alter table public.character_embeddings enable row level security;

drop policy if exists "episode_embeddings_read" on public.episode_embeddings;
drop policy if exists "character_embeddings_read" on public.character_embeddings;

-- Delegates to the parent instead of restating the account check: Postgres
-- applies episodes'/assets' own RLS inside the subquery, so an embedding is
-- visible exactly when its parent is, and the rule cannot drift out of sync.
create policy "episode_embeddings_read" on public.episode_embeddings
  for select
  to authenticated using (
    exists (
      select 1 from public.episodes e
      where e.id = episode_embeddings.episode_id
    )
  );

create policy "character_embeddings_read" on public.character_embeddings
  for select
  to authenticated using (
    exists (
      select 1 from public.assets a
      where a.id = character_embeddings.character_id
    )
  );

revoke all on public.episode_embeddings from authenticated, anon;
revoke all on public.character_embeddings from authenticated, anon;

grant select on public.episode_embeddings to authenticated;
grant select on public.character_embeddings to authenticated;
