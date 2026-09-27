-- FILM-CC-04 KB-132. Twenty-two policies admitted "the owner of a personal
-- account" alongside a role on the account. After KB-99 no project, and so
-- nothing under one, can sit on a personal account (kit.require_team_account),
-- so that branch never matches; but Postgres plans it as a hashed subplan over
-- every personal account, read through accounts' own RLS, which runs its
-- membership lookups per row. At ~330 personal accounts one revenue read took
-- 4.2 s of CPU (auto_explain, 2026-09-27). Each policy is recreated from its
-- live definition with that one branch removed and nothing else changed.

drop policy "assets_read" on public.assets;
create policy "assets_read" on public.assets
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM public.projects p WHERE ((p.id = assets.project_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "audio_tracks_read" on public.audio_tracks;
create policy "audio_tracks_read" on public.audio_tracks
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM (public.episodes e JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((e.id = audio_tracks.episode_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "caption_segments_read" on public.caption_segments;
create policy "caption_segments_read" on public.caption_segments
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM ((public.captions c JOIN public.episodes e ON ((e.id = c.episode_id))) JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((c.id = caption_segments.caption_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "captions_read" on public.captions;
create policy "captions_read" on public.captions
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM (public.episodes e JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((e.id = captions.episode_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "character_details_read" on public.character_details;
create policy "character_details_read" on public.character_details
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM (public.assets a JOIN public.projects p ON ((p.id = a.project_id))) WHERE ((a.id = character_details.asset_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "dialogue_lines_read" on public.dialogue_lines;
create policy "dialogue_lines_read" on public.dialogue_lines
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM (public.episodes e JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((e.id = dialogue_lines.episode_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "dubbed_dialogue_lines_read" on public.dubbed_dialogue_lines;
create policy "dubbed_dialogue_lines_read" on public.dubbed_dialogue_lines
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM ((public.dubbed_versions dv JOIN public.episodes e ON ((e.id = dv.episode_id))) JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((dv.id = dubbed_dialogue_lines.dubbed_version_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "dubbed_versions_read" on public.dubbed_versions;
create policy "dubbed_versions_read" on public.dubbed_versions
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM (public.episodes e JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((e.id = dubbed_versions.episode_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "episode_thumbnails_read" on public.episode_thumbnails;
create policy "episode_thumbnails_read" on public.episode_thumbnails
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM (public.episodes e JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((e.id = episode_thumbnails.episode_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "episodes_delete" on public.episodes;
create policy "episodes_delete" on public.episodes
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM public.projects p WHERE ((p.id = episodes.project_id) AND ((EXISTS ( SELECT 1 FROM public.project_members pm WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::project_role, 'admin'::project_role]))))))))));

drop policy "episodes_read" on public.episodes;
create policy "episodes_read" on public.episodes
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM public.projects p WHERE ((p.id = episodes.project_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "episodes_update" on public.episodes;
create policy "episodes_update" on public.episodes
  for update to authenticated
  using ((EXISTS ( SELECT 1 FROM public.projects p WHERE ((p.id = episodes.project_id) AND ((EXISTS ( SELECT 1 FROM public.project_members pm WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::project_role, 'admin'::project_role, 'member'::project_role]))))))))));

drop policy "project_intros_read" on public.project_intros;
create policy "project_intros_read" on public.project_intros
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM public.projects p WHERE ((p.id = project_intros.project_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "project_members_read" on public.project_members;
create policy "project_members_read" on public.project_members
  for select to authenticated
  using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM public.projects p WHERE ((p.id = project_members.project_id) AND (public.has_role_on_account(p.account_id)))))));

drop policy "projects_read" on public.projects;
create policy "projects_read" on public.projects
  for select to authenticated
  using ((public.has_role_on_account(account_id)));

drop policy "publishes_read" on public.publishes;
create policy "publishes_read" on public.publishes
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM (public.episodes e JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((e.id = publishes.episode_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "revenue_records_read" on public.revenue_records;
create policy "revenue_records_read" on public.revenue_records
  for select to authenticated
  using ((((account_id IS NOT NULL) AND public.has_account_access(account_id)) OR (publish_id IN ( SELECT pub.id FROM ((public.publishes pub JOIN public.episodes e ON ((e.id = pub.episode_id))) JOIN public.projects p ON ((p.id = e.project_id))) WHERE (public.has_role_on_account(p.account_id))))));

drop policy "seasons_read" on public.seasons;
create policy "seasons_read" on public.seasons
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM public.projects p WHERE ((p.id = seasons.project_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "shots_delete" on public.shots;
create policy "shots_delete" on public.shots
  for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM (public.episodes e JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((e.id = shots.episode_id) AND ((EXISTS ( SELECT 1 FROM public.project_members pm WHERE ((pm.project_id = p.id) AND (pm.user_id = auth.uid()) AND (pm.role = ANY (ARRAY['owner'::project_role, 'admin'::project_role]))))))))));

drop policy "shots_read" on public.shots;
create policy "shots_read" on public.shots
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM (public.episodes e JOIN public.projects p ON ((p.id = e.project_id))) WHERE ((e.id = shots.episode_id) AND (public.has_role_on_account(p.account_id))))));

drop policy "Users can insert facts for their projects" on public.verified_facts;
create policy "Users can insert facts for their projects" on public.verified_facts
  for insert to authenticated
  with check (((EXISTS ( SELECT 1 FROM public.projects p WHERE ((p.id = verified_facts.project_id) AND (public.has_role_on_account(p.account_id))))) AND (verification_status = 'unverified'::verification_status_enum) AND (verified_by IS NULL) AND (verified_at IS NULL) AND ((created_by IS NULL) OR (created_by = auth.uid())) AND ((updated_by IS NULL) OR (updated_by = auth.uid()))));

drop policy "Users can view facts for their projects" on public.verified_facts;
create policy "Users can view facts for their projects" on public.verified_facts
  for select to authenticated
  using ((EXISTS ( SELECT 1 FROM public.projects p WHERE ((p.id = verified_facts.project_id) AND (public.has_role_on_account(p.account_id))))));
