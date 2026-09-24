/*
 * KB-48: episode_facts, audio_cues, shot_transitions and audio_assets
 * tested an account membership row only (accounts_memberships, or
 * has_role_on_account). A personal account's owner has none, so they could not
 * read their own audio cues or assets, and could not write to any of the four.
 *
 * Each table now uses the rules its sibling studio tables use:
 *
 *   read   has_account_access(project.account_id)   the personal owner, or a role on the account
 *   write  can_write_project(project_id)            owner, admin or member in project_members
 *                                                   (KB-28's rule, the owner's decision for KB-27)
 *
 * Delete keeps its current parity with insert and update: audio regeneration
 * deletes cues as a project member today.
 *
 * Fixed with it:
 *   R7  episode_facts checked the episode and never the fact, so any writer
 *       could link a fact of any project, of any tenant. The LLM worker reads
 *       links on the service role, which put that fact into the writer's
 *       story. A link now needs the fact and the episode in one project.
 *   R9  audio_cues found the project through seasons; episodes.season_id is
 *       nullable, so a cue on an episode with no season was hidden from
 *       everyone. It now uses episodes.project_id.
 *   Every policy here, and verified_facts' four (the KB-18 leftover), names
 *   TO authenticated, so the policy-shape guard needs no allowlist.
 *
 * Tests: tests/database/studio-owner-access.test.sql, policy-shape.test.sql.
 */

-- ------------------------------------------------------------------
-- episode_facts
-- ------------------------------------------------------------------
drop policy if exists "Users can view episode facts" on public.episode_facts;
drop policy if exists "Users can link facts to episodes" on public.episode_facts;
drop policy if exists "Users can unlink facts from episodes" on public.episode_facts;

create policy "Users can view episode facts" on public.episode_facts
  for select to authenticated
  using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = episode_facts.episode_id
        and public.has_account_access(p.account_id)
    )
  );

-- No UPDATE policy: nothing edits a link. A re-link is
-- `on conflict do nothing` (R8), which needs none.
create policy "Users can link facts to episodes" on public.episode_facts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.episodes e
      join public.verified_facts f on f.project_id = e.project_id
      where e.id = episode_facts.episode_id
        and f.id = episode_facts.fact_id
        and public.can_write_project(e.project_id)
    )
  );

create policy "Users can unlink facts from episodes" on public.episode_facts
  for delete to authenticated
  using (
    exists (
      select 1 from public.episodes e
      where e.id = episode_facts.episode_id
        and public.can_write_project(e.project_id)
    )
  );

-- Links made before this migration are not checked here. Report, never delete
-- (Q3 in specs/plans/KB-48-71-edd.md).
do $$
declare
  cross_project integer;
begin
  select count(*) into cross_project
  from public.episode_facts ef
  join public.episodes e on e.id = ef.episode_id
  join public.verified_facts f on f.id = ef.fact_id
  where f.project_id <> e.project_id;

  raise notice 'KB-48: % episode_facts row(s) link a fact from another project', cross_project;
end;
$$;

-- ------------------------------------------------------------------
-- audio_cues
-- ------------------------------------------------------------------
drop policy if exists audio_cues_select_policy on public.audio_cues;
drop policy if exists audio_cues_insert_policy on public.audio_cues;
drop policy if exists audio_cues_update_policy on public.audio_cues;
drop policy if exists audio_cues_delete_policy on public.audio_cues;

create policy audio_cues_select_policy on public.audio_cues
  for select to authenticated
  using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = audio_cues.episode_id
        and public.has_account_access(p.account_id)
    )
  );

create policy audio_cues_insert_policy on public.audio_cues
  for insert to authenticated
  with check (
    exists (
      select 1 from public.episodes e
      where e.id = audio_cues.episode_id
        and public.can_write_project(e.project_id)
    )
  );

create policy audio_cues_update_policy on public.audio_cues
  for update to authenticated
  using (
    exists (
      select 1 from public.episodes e
      where e.id = audio_cues.episode_id
        and public.can_write_project(e.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.episodes e
      where e.id = audio_cues.episode_id
        and public.can_write_project(e.project_id)
    )
  );

create policy audio_cues_delete_policy on public.audio_cues
  for delete to authenticated
  using (
    exists (
      select 1 from public.episodes e
      where e.id = audio_cues.episode_id
        and public.can_write_project(e.project_id)
    )
  );

-- ------------------------------------------------------------------
-- shot_transitions
-- ------------------------------------------------------------------
drop policy if exists "Users can view transitions for accessible episodes" on public.shot_transitions;
drop policy if exists "Users can insert transitions for accessible episodes" on public.shot_transitions;
drop policy if exists "Users can update transitions for accessible episodes" on public.shot_transitions;
drop policy if exists "Users can delete transitions for accessible episodes" on public.shot_transitions;

create policy "Users can view transitions for accessible episodes" on public.shot_transitions
  for select to authenticated
  using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = shot_transitions.episode_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "Users can insert transitions for accessible episodes" on public.shot_transitions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.episodes e
      where e.id = shot_transitions.episode_id
        and public.can_write_project(e.project_id)
    )
  );

create policy "Users can update transitions for accessible episodes" on public.shot_transitions
  for update to authenticated
  using (
    exists (
      select 1 from public.episodes e
      where e.id = shot_transitions.episode_id
        and public.can_write_project(e.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.episodes e
      where e.id = shot_transitions.episode_id
        and public.can_write_project(e.project_id)
    )
  );

create policy "Users can delete transitions for accessible episodes" on public.shot_transitions
  for delete to authenticated
  using (
    exists (
      select 1 from public.episodes e
      where e.id = shot_transitions.episode_id
        and public.can_write_project(e.project_id)
    )
  );

-- ------------------------------------------------------------------
-- audio_assets
-- ------------------------------------------------------------------
drop policy if exists audio_assets_select_policy on public.audio_assets;
drop policy if exists audio_assets_insert_policy on public.audio_assets;
drop policy if exists audio_assets_update_policy on public.audio_assets;
drop policy if exists audio_assets_delete_policy on public.audio_assets;

create policy audio_assets_select_policy on public.audio_assets
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = audio_assets.project_id
        and public.has_account_access(p.account_id)
    )
  );

create policy audio_assets_insert_policy on public.audio_assets
  for insert to authenticated
  with check (public.can_write_project(audio_assets.project_id));

create policy audio_assets_update_policy on public.audio_assets
  for update to authenticated
  using (public.can_write_project(audio_assets.project_id))
  with check (public.can_write_project(audio_assets.project_id));

create policy audio_assets_delete_policy on public.audio_assets
  for delete to authenticated
  using (public.can_write_project(audio_assets.project_id));

-- ------------------------------------------------------------------
-- verified_facts: name the role; predicates unchanged (KB-18 owns them)
-- ------------------------------------------------------------------
alter policy "Users can view facts for their projects" on public.verified_facts to authenticated;
alter policy "Users can insert facts for their projects" on public.verified_facts to authenticated;
alter policy "Users can update facts for their projects" on public.verified_facts to authenticated;
alter policy "Users can delete facts for their projects" on public.verified_facts to authenticated;
