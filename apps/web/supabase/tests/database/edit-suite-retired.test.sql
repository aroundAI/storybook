begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- FILM-607 and FILM-608. The Edit Suite is retired and its code removed.
-- FILM-607 dropped its five database functions (the first of them was KB-40:
-- a SECURITY DEFINER function any signed-in user could use to replace any
-- episode's edit project). FILM-608 dropped its six tables and
-- compilations.edit_project_id. Nothing the rest of the product uses went
-- with them.
--
-- A fixed plan, so a run that aborts early fails as a plan mismatch.
select plan(25);

-- ==================================
-- R1: the functions are gone (FILM-607)
-- ==================================

select hasnt_function('public', 'batch_assemble_edit_project', 'R1: batch_assemble_edit_project is dropped');
select hasnt_function('public', 'batch_save_edit_project', 'R1: batch_save_edit_project is dropped');
select hasnt_function('public', 'create_edit_project_with_tracks', 'R1: create_edit_project_with_tracks is dropped');
select hasnt_function('public', 'split_edit_clip', 'R1: split_edit_clip is dropped');
select hasnt_function('public', 'get_project_id_for_edit_project', 'R1: get_project_id_for_edit_project is dropped');

-- ==================================
-- D1–D2: the tables and the column pointing into them are gone (FILM-608)
-- ==================================

select hasnt_table('public', 'edit_projects', 'D1: edit_projects is dropped');
select hasnt_table('public', 'edit_tracks', 'D1: edit_tracks is dropped');
select hasnt_table('public', 'edit_clips', 'D1: edit_clips is dropped');
select hasnt_table('public', 'edit_keyframes', 'D1: edit_keyframes is dropped');
select hasnt_table('public', 'edit_transitions', 'D1: edit_transitions is dropped');
select hasnt_table('public', 'dialogue_sync_groups', 'D1: dialogue_sync_groups is dropped');

select hasnt_column('public', 'compilations', 'edit_project_id', 'D2: compilations.edit_project_id is dropped');

-- ==================================
-- D3: no policy, index or trigger of theirs survives. Exact names, not a
-- LIKE pattern: `_` is a wildcard there, so '%edit_%' would match 'credit…'.
-- ==================================

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public'
        and tablename in ('edit_projects', 'edit_tracks', 'edit_clips', 'edit_keyframes',
                          'edit_transitions', 'dialogue_sync_groups') $$,
  'D3: no policy remains on an Edit Suite table'
);

select is_empty(
  $$ select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'idx_edit_projects_episode', 'idx_edit_tracks_project', 'idx_edit_tracks_project_sort',
          'idx_dialogue_sync_groups_project', 'idx_dialogue_sync_groups_anchor',
          'idx_edit_clips_track', 'idx_edit_clips_sync_group', 'idx_edit_clips_source_shot',
          'idx_edit_clips_source_dialogue', 'idx_edit_clips_track_position', 'idx_edit_clips_language',
          'idx_edit_transitions_from', 'idx_edit_transitions_to',
          'idx_edit_keyframes_clip', 'idx_edit_keyframes_clip_property') $$,
  'D3: no Edit Suite index remains'
);

select is_empty(
  $$ select tgname from pg_trigger
      where tgname in ('edit_projects_set_timestamps', 'edit_tracks_set_timestamps',
                       'edit_clips_set_timestamps') $$,
  'D3: no Edit Suite trigger remains'
);

-- ==================================
-- D4: the neighbours they referenced, or that referenced them, are kept
-- ==================================

select has_table('public', 'compilations', 'D4: compilations is kept');
select has_column('public', 'compilations', 'chapters', 'D4: compilations keeps its other columns');
select has_table('public', 'episodes', 'D4: episodes is kept');
select has_table('public', 'shots', 'D4: shots is kept');
select has_table('public', 'dialogue_lines', 'D4: dialogue_lines is kept');
select has_table('public', 'dubbed_dialogue_lines', 'D4: dubbed_dialogue_lines is kept');
select has_table('public', 'audio_tracks', 'D4: audio_tracks is kept');
select has_function('public', 'trigger_set_timestamps', 'D4: the shared trigger_set_timestamps() is kept');

-- ==================================
-- R7: master_video is untouched (shared with the Publish page)
-- ==================================

select tests.create_supabase_user('f608_owner', 'f608-owner@storybook.dev');

-- The project's creator comes from auth.uid(), so sign in before inserting.
select makerkit.authenticate_as('f608_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('60800000-0000-4000-8000-00000000000a', 'FILM-608 team', false, tests.get_supabase_uid('f608_owner'));

insert into public.projects (id, account_id, name, status, visibility)
values ('60800000-0000-4000-8000-000000000001', '60800000-0000-4000-8000-00000000000a', 'FILM-608 P', 'active', 'public');

insert into public.episodes (id, project_id, number, title)
values ('60800000-0000-4000-8000-000000000002', '60800000-0000-4000-8000-000000000001', 1, 'E');

select lives_ok(
  $$ insert into public.assets (project_id, episode_id, type, name)
     values ('60800000-0000-4000-8000-000000000001', '60800000-0000-4000-8000-000000000002',
             'master_video', 'Master') $$,
  'R7: an asset of type master_video is still accepted'
);

select has_column('public', 'episodes', 'master_video_asset_id', 'R7: episodes.master_video_asset_id is kept');

select * from finish();
rollback;
