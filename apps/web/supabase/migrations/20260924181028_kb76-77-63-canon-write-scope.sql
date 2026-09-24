/*
 * KB-76, KB-77, KB-63: the other seven canon tables follow the project-write
 * rule.
 *
 * Until now narrative_threads, world_states, episode_summaries,
 * act_context_bridges and sequel_parent_contexts each had one FOR ALL policy
 * on has_role_on_account with no WITH CHECK; character_states and
 * state_deltas took inserts on has_role_on_account, and character_states did
 * not pin its author. Measured as real users (FILM-CC-04 KB-76, KB-77):
 *   - a project viewer, or a team member with no project row, inserted,
 *     rewrote and deleted threads, world states, summaries, act bridges and
 *     sequel contexts, and inserted character states and state deltas;
 *   - a writer recorded a character state in the owner's name;
 *   - a sequel context could name a parent project in another account;
 *   - a personal-account owner (no membership row) could not write canon in
 *     their own project;
 *   - anon and authenticated held every table privilege, TRUNCATE included,
 *     on all seven, so the "append-only" logs were append-only only because
 *     no DELETE policy happened to exist.
 *
 * The rules (owner's decisions of 2026-09-23 for KB-17/KB-27, and of
 * 2026-09-24 for this fix):
 *   read    has_account_access on the project's account (personal owners
 *           included)
 *   write   can_write_project (KB-28): owner, admin or member in
 *           project_members; every episode a row names is in the same
 *           project, and a sequel's parent is a project the writer can read
 *   logs    character_states and state_deltas are insert-only for clients;
 *           a character state is authored by whoever inserts it
 *   delete  no client deletes threads, world states, summaries or logs.
 *           Resets do, inside bulk_reset_episodes_to_stage (SECURITY
 *           DEFINER, can_write_project; KB-27), which the single-episode
 *           reset actions now call too. Writers may delete the two caches.
 *
 * remove_episode_from_threads_touched (KB-63) is called only from that
 * reset, in definer context. It stays ungranted and now checks its caller
 * itself, so granting it by mistake would not open a write.
 *
 * Tests: tests/database/canon-write-scope.test.sql, and policy-shape's
 * "no permissive FOR ALL without WITH CHECK" check.
 */

-- ------------------------------------------------------------------
-- narrative_threads
-- ------------------------------------------------------------------
drop policy if exists "narrative_threads_project_access" on public.narrative_threads;
drop policy if exists "narrative_threads_read" on public.narrative_threads;
drop policy if exists "narrative_threads_insert" on public.narrative_threads;
drop policy if exists "narrative_threads_update" on public.narrative_threads;

create policy "narrative_threads_read" on public.narrative_threads
  for select to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = narrative_threads.project_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "narrative_threads_insert" on public.narrative_threads
  for insert to authenticated with check (
    public.can_write_project(project_id)
    and exists (
      select 1 from public.episodes e
      where e.id = narrative_threads.opened_at
        and e.project_id = narrative_threads.project_id
    )
    and (
      resolved_at is null
      or exists (
        select 1 from public.episodes e
        where e.id = narrative_threads.resolved_at
          and e.project_id = narrative_threads.project_id
      )
    )
  );

create policy "narrative_threads_update" on public.narrative_threads
  for update to authenticated
  using (public.can_write_project(project_id))
  with check (
    public.can_write_project(project_id)
    and exists (
      select 1 from public.episodes e
      where e.id = narrative_threads.opened_at
        and e.project_id = narrative_threads.project_id
    )
    and (
      resolved_at is null
      or exists (
        select 1 from public.episodes e
        where e.id = narrative_threads.resolved_at
          and e.project_id = narrative_threads.project_id
      )
    )
  );

-- ------------------------------------------------------------------
-- world_states
-- ------------------------------------------------------------------
drop policy if exists "world_states_project_access" on public.world_states;
drop policy if exists "world_states_read" on public.world_states;
drop policy if exists "world_states_insert" on public.world_states;
drop policy if exists "world_states_update" on public.world_states;

create policy "world_states_read" on public.world_states
  for select to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = world_states.project_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "world_states_insert" on public.world_states
  for insert to authenticated with check (
    public.can_write_project(project_id)
    and exists (
      select 1 from public.episodes e
      where e.id = world_states.episode_id
        and e.project_id = world_states.project_id
    )
  );

create policy "world_states_update" on public.world_states
  for update to authenticated
  using (public.can_write_project(project_id))
  with check (
    public.can_write_project(project_id)
    and exists (
      select 1 from public.episodes e
      where e.id = world_states.episode_id
        and e.project_id = world_states.project_id
    )
  );

-- ------------------------------------------------------------------
-- episode_summaries (keyed by episode)
-- ------------------------------------------------------------------
drop policy if exists "episode_summaries_access" on public.episode_summaries;
drop policy if exists "episode_summaries_read" on public.episode_summaries;
drop policy if exists "episode_summaries_insert" on public.episode_summaries;
drop policy if exists "episode_summaries_update" on public.episode_summaries;

create policy "episode_summaries_read" on public.episode_summaries
  for select to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = episode_summaries.episode_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "episode_summaries_insert" on public.episode_summaries
  for insert to authenticated with check (
    exists (
      select 1 from public.episodes e
      where e.id = episode_summaries.episode_id
        and public.can_write_project(e.project_id)
    )
  );

create policy "episode_summaries_update" on public.episode_summaries
  for update to authenticated
  using (
    exists (
      select 1 from public.episodes e
      where e.id = episode_summaries.episode_id
        and public.can_write_project(e.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.episodes e
      where e.id = episode_summaries.episode_id
        and public.can_write_project(e.project_id)
    )
  );

-- ------------------------------------------------------------------
-- act_context_bridges (keyed by episode; a cache, so writers may delete)
-- ------------------------------------------------------------------
drop policy if exists "act_context_bridges_project_access" on public.act_context_bridges;
drop policy if exists "act_context_bridges_read" on public.act_context_bridges;
drop policy if exists "act_context_bridges_insert" on public.act_context_bridges;
drop policy if exists "act_context_bridges_update" on public.act_context_bridges;
drop policy if exists "act_context_bridges_delete" on public.act_context_bridges;

create policy "act_context_bridges_read" on public.act_context_bridges
  for select to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = act_context_bridges.episode_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "act_context_bridges_insert" on public.act_context_bridges
  for insert to authenticated with check (
    exists (
      select 1 from public.episodes e
      where e.id = act_context_bridges.episode_id
        and public.can_write_project(e.project_id)
    )
  );

create policy "act_context_bridges_update" on public.act_context_bridges
  for update to authenticated
  using (
    exists (
      select 1 from public.episodes e
      where e.id = act_context_bridges.episode_id
        and public.can_write_project(e.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.episodes e
      where e.id = act_context_bridges.episode_id
        and public.can_write_project(e.project_id)
    )
  );

create policy "act_context_bridges_delete" on public.act_context_bridges
  for delete to authenticated using (
    exists (
      select 1 from public.episodes e
      where e.id = act_context_bridges.episode_id
        and public.can_write_project(e.project_id)
    )
  );

-- ------------------------------------------------------------------
-- sequel_parent_contexts (a cache of the parent's canon, written into the
-- sequel; the parent must be a project the writer can read)
-- ------------------------------------------------------------------
drop policy if exists "sequel_parent_contexts_project_access" on public.sequel_parent_contexts;
drop policy if exists "sequel_parent_contexts_read" on public.sequel_parent_contexts;
drop policy if exists "sequel_parent_contexts_insert" on public.sequel_parent_contexts;
drop policy if exists "sequel_parent_contexts_update" on public.sequel_parent_contexts;
drop policy if exists "sequel_parent_contexts_delete" on public.sequel_parent_contexts;

create policy "sequel_parent_contexts_read" on public.sequel_parent_contexts
  for select to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = sequel_parent_contexts.sequel_project_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "sequel_parent_contexts_insert" on public.sequel_parent_contexts
  for insert to authenticated with check (
    public.can_write_project(sequel_project_id)
    and exists (
      select 1 from public.projects p
      where p.id = sequel_parent_contexts.parent_project_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "sequel_parent_contexts_update" on public.sequel_parent_contexts
  for update to authenticated
  using (public.can_write_project(sequel_project_id))
  with check (
    public.can_write_project(sequel_project_id)
    and exists (
      select 1 from public.projects p
      where p.id = sequel_parent_contexts.parent_project_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "sequel_parent_contexts_delete" on public.sequel_parent_contexts
  for delete to authenticated using (
    public.can_write_project(sequel_project_id)
  );

-- ------------------------------------------------------------------
-- character_states: append-only, authored by the inserter
-- ------------------------------------------------------------------
drop policy if exists "character_states_read" on public.character_states;
drop policy if exists "character_states_insert" on public.character_states;

create policy "character_states_read" on public.character_states
  for select to authenticated using (
    exists (
      select 1 from public.assets a
      join public.projects p on p.id = a.project_id
      where a.id = character_states.character_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "character_states_insert" on public.character_states
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.assets a
      join public.episodes e on e.project_id = a.project_id
      where a.id = character_states.character_id
        and e.id = character_states.episode_id
        and public.can_write_project(a.project_id)
    )
  );

-- ------------------------------------------------------------------
-- state_deltas: append-only
-- ------------------------------------------------------------------
drop policy if exists "state_deltas_read" on public.state_deltas;
drop policy if exists "state_deltas_insert" on public.state_deltas;

create policy "state_deltas_read" on public.state_deltas
  for select to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = state_deltas.episode_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "state_deltas_insert" on public.state_deltas
  for insert to authenticated with check (
    exists (
      select 1 from public.episodes e
      where e.id = state_deltas.episode_id
        and public.can_write_project(e.project_id)
    )
  );

-- ------------------------------------------------------------------
-- Privileges: exactly the verbs above. No UPDATE or DELETE privilege where
-- there is no policy, so PostgREST refuses with 42501 instead of silently
-- matching no rows, and a permissive policy added later cannot open one.
-- ------------------------------------------------------------------
revoke all on table
  public.narrative_threads, public.world_states, public.episode_summaries,
  public.act_context_bridges, public.sequel_parent_contexts,
  public.character_states, public.state_deltas
from anon, authenticated;

grant select, insert on table public.character_states, public.state_deltas to authenticated;
grant select, insert, update on table
  public.narrative_threads, public.world_states, public.episode_summaries
to authenticated;
grant select, insert, update, delete on table
  public.act_context_bridges, public.sequel_parent_contexts
to authenticated;

-- ------------------------------------------------------------------
-- remove_episode_from_threads_touched (KB-63)
-- ------------------------------------------------------------------
-- Same signature and effect. It runs as definer, so it checks its caller:
-- signed in, a writer of the project, and the episode in that project. One
-- 42501 for every refusal. Its only caller, bulk_reset_episodes_to_stage,
-- has already checked the same thing, so the reset is unaffected.
create or replace function public.remove_episode_from_threads_touched(
  p_episode_id uuid,
  p_project_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.can_write_project(p_project_id)
     or not exists (
       select 1 from public.episodes e
       where e.id = p_episode_id and e.project_id = p_project_id
     ) then
    raise exception 'No access to this project''s canon' using errcode = '42501';
  end if;

  update public.narrative_threads
  set episodes_touched = array_remove(episodes_touched, p_episode_id),
      updated_at = now()
  where project_id = p_project_id
    and p_episode_id = any(episodes_touched);
end;
$$;

revoke all on function public.remove_episode_from_threads_touched(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_episode_from_threads_touched(uuid, uuid) to service_role;

comment on function public.remove_episode_from_threads_touched(uuid, uuid) is
  'Removes an episode from every thread''s episodes_touched in its project. Internal to bulk_reset_episodes_to_stage; not granted to clients, and refuses (42501) a caller who cannot write the project or an episode of another project.';
