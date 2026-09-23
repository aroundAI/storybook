-- ==================================
-- FILM-607 part B: the Edit Suite is removed
-- ==================================
-- Part A revoked the Edit Suite's functions from the API roles. The code
-- that called them is now deleted, so the functions go.
--
-- The six edit tables and their rows are kept, read-only, under the owner's
-- keep-until-asked rule (KB-20; owner decision D3, 2026-09-23). No code reads
-- or writes them any more. Their read policies stay, so a member can still
-- read their own account's rows; every write privilege and write policy
-- goes. Referential actions (an episode, shot or dialogue line deleted)
-- still run, because they run as the table owner. FILM-608 drops the tables
-- once the owner has read the production counts.

-- 1. The five functions, every overload.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'batch_assemble_edit_project',
        'batch_save_edit_project',
        'create_edit_project_with_tracks',
        'split_edit_clip',
        'get_project_id_for_edit_project'
      )
  loop
    execute format('drop function %s', f);
  end loop;
end;
$$;

-- 2. The tables become read-only.
revoke insert, update, delete, truncate, references, trigger
  on public.edit_projects, public.edit_tracks, public.edit_clips,
     public.edit_keyframes, public.edit_transitions, public.dialogue_sync_groups
  from public, anon, authenticated;

revoke select
  on public.edit_projects, public.edit_tracks, public.edit_clips,
     public.edit_keyframes, public.edit_transitions, public.dialogue_sync_groups
  from public, anon;

drop policy "edit_projects_create" on public.edit_projects;
drop policy "edit_projects_update" on public.edit_projects;
drop policy "edit_projects_delete" on public.edit_projects;
drop policy "edit_tracks_create" on public.edit_tracks;
drop policy "edit_tracks_update" on public.edit_tracks;
drop policy "edit_tracks_delete" on public.edit_tracks;
drop policy "dialogue_sync_groups_create" on public.dialogue_sync_groups;
drop policy "dialogue_sync_groups_update" on public.dialogue_sync_groups;
drop policy "dialogue_sync_groups_delete" on public.dialogue_sync_groups;
drop policy "edit_clips_create" on public.edit_clips;
drop policy "edit_clips_update" on public.edit_clips;
drop policy "edit_clips_delete" on public.edit_clips;
drop policy "edit_transitions_create" on public.edit_transitions;
drop policy "edit_transitions_update" on public.edit_transitions;
drop policy "edit_transitions_delete" on public.edit_transitions;
drop policy "edit_keyframes_create" on public.edit_keyframes;
drop policy "edit_keyframes_update" on public.edit_keyframes;
drop policy "edit_keyframes_delete" on public.edit_keyframes;

comment on table public.edit_projects is
  'Retired with the Edit Suite (FILM-607, 2026-09-23). Read-only; dropped by FILM-608 once the owner decides.';
comment on table public.edit_tracks is
  'Retired with the Edit Suite (FILM-607, 2026-09-23). Read-only; dropped by FILM-608 once the owner decides.';
comment on table public.edit_clips is
  'Retired with the Edit Suite (FILM-607, 2026-09-23). Read-only; dropped by FILM-608 once the owner decides.';
comment on table public.edit_keyframes is
  'Retired with the Edit Suite (FILM-607, 2026-09-23). Read-only; dropped by FILM-608 once the owner decides.';
comment on table public.edit_transitions is
  'Retired with the Edit Suite (FILM-607, 2026-09-23). Read-only; dropped by FILM-608 once the owner decides.';
comment on table public.dialogue_sync_groups is
  'Retired with the Edit Suite (FILM-607, 2026-09-23). Read-only; dropped by FILM-608 once the owner decides.';
