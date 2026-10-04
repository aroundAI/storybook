begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(11);

-- FILM-2007: what regenerate_shots and localize_episode write as the caller,
-- and the one column the dub adds.
--
-- regenerate_shots queues the listed shots and clears their video through
-- the caller's RLS client, because a stage commit may not write a shot's
-- status or media (kit.generation_commit_allowlist, FILM-1909); that stays
-- true. localize_episode upserts one dubbed_versions row per language as
-- the caller. Both need write access to the project: a member can, a viewer
-- cannot. The voice worker writes dubbed_dialogue_lines.timeline_start_seconds,
-- which is never negative.

select tests.create_supabase_user('f2007_owner', 'f2007-owner@storybook.dev');
select tests.create_supabase_user('f2007_member', 'f2007-member@storybook.dev');
select tests.create_supabase_user('f2007_viewer', 'f2007-viewer@storybook.dev');

select makerkit.authenticate_as('f2007_owner');
select public.create_team_account('F2007 Team');
select set_config('f2007.team', makerkit.get_account_id_by_slug('f2007-team')::text, true);

insert into public.projects (id, account_id, name, slug, status)
  values ('20070000-0000-4000-8000-000000000001', current_setting('f2007.team')::uuid,
          'Regenerate and localize', 'f2007-project', 'active');

set local role postgres;

insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('f2007_member'), current_setting('f2007.team')::uuid, 'member'),
         (tests.get_supabase_uid('f2007_viewer'), current_setting('f2007.team')::uuid, 'member');
insert into public.project_members (project_id, user_id, role)
  values ('20070000-0000-4000-8000-000000000001', tests.get_supabase_uid('f2007_member'), 'member'),
         ('20070000-0000-4000-8000-000000000001', tests.get_supabase_uid('f2007_viewer'), 'viewer');

insert into public.episodes (id, project_id, number, title, status, version)
  values ('20070000-0000-4000-8000-0000000000e1', '20070000-0000-4000-8000-000000000001',
          1, 'Pilot', 'editing', 1);
insert into public.shots (id, episode_id, sequence_number, duration_seconds, prompt, status, video_url)
  values ('20070000-0000-4000-8000-0000000000a1', '20070000-0000-4000-8000-0000000000e1', 1, 5, 'p', 'completed',
          'https://cdn.test/episodes/20070000-0000-4000-8000-0000000000e1/shot-1.mp4');
insert into public.dialogue_lines (id, episode_id, sequence_number, text, language, status, timeline_start_seconds)
  values ('20070000-0000-4000-8000-0000000000d1', '20070000-0000-4000-8000-0000000000e1', 1, 'Hello.', 'en', 'completed', 2.5);
insert into public.dubbed_versions (id, episode_id, language)
  values ('20070000-0000-4000-8000-0000000000f1', '20070000-0000-4000-8000-0000000000e1', 'hi');

-- 1-4: the column, its type and its CHECK
select col_type_is('public', 'dubbed_dialogue_lines', 'timeline_start_seconds', 'numeric(10,2)',
  'dubbed_dialogue_lines.timeline_start_seconds is decimal(10,2), as dialogue_lines'' own');

select throws_ok(
  $$ insert into public.dubbed_dialogue_lines (dubbed_version_id, original_dialogue_id, translated_text, timeline_start_seconds)
     values ('20070000-0000-4000-8000-0000000000f1', '20070000-0000-4000-8000-0000000000d1', 'नमस्ते।', -0.5) $$,
  '23514', null,
  'a dubbed line cannot start before the timeline does');

select lives_ok(
  $$ insert into public.dubbed_dialogue_lines (dubbed_version_id, original_dialogue_id, translated_text, timeline_start_seconds)
     values ('20070000-0000-4000-8000-0000000000f1', '20070000-0000-4000-8000-0000000000d1', 'नमस्ते।', 2.5) $$,
  'a dubbed line is written at its source line''s start');

select lives_ok(
  $$ update public.dubbed_dialogue_lines set timeline_start_seconds = null
      where dubbed_version_id = '20070000-0000-4000-8000-0000000000f1' $$,
  'a dub of a line with no position has none either');

-- 5: the stage allowlist still keeps shot status and media from a commit
select is(
  (kit.generation_commit_allowlist() -> 'shots' -> 'update') ?| array['status', 'video_url', 'thumbnail_url'],
  false,
  'a stage commit still cannot write a shot''s status or media: the opener resets them as the caller');

-- 6-7: the opener's reset, as a member and as a viewer
select makerkit.authenticate_as('f2007_viewer');

select is_empty(
  $$ update public.shots set status = 'queued', video_url = null
      where id = '20070000-0000-4000-8000-0000000000a1' returning id $$,
  'a project viewer cannot queue a shot for regeneration');

select makerkit.authenticate_as('f2007_member');

select results_eq(
  $$ update public.shots set status = 'queued', video_url = null
      where id = '20070000-0000-4000-8000-0000000000a1'
        and episode_id = '20070000-0000-4000-8000-0000000000e1'
        and status <> 'generating'
     returning status::text, video_url $$,
  $$ values ('queued'::text, null::text) $$,
  'a project member queues a shot for regeneration and clears its video');

-- 8-9: localize_episode's upsert, as a member and as a viewer
select lives_ok(
  $$ insert into public.dubbed_versions (episode_id, language, status, translation_status, metadata)
     values ('20070000-0000-4000-8000-0000000000e1', 'hi', 'translating', 'processing', '{"localization": {}}'),
            ('20070000-0000-4000-8000-0000000000e1', 'es', 'voicing', 'completed', '{"localization": {}}')
     on conflict (episode_id, language) do update
       set status = excluded.status, translation_status = excluded.translation_status,
           metadata = excluded.metadata $$,
  'a project member starts (or restarts) a dub per language');

select results_eq(
  $$ select language::text, status::text from public.dubbed_versions
      where episode_id = '20070000-0000-4000-8000-0000000000e1' order by language $$,
  $$ values ('es'::text, 'voicing'::text), ('hi'::text, 'translating'::text) $$,
  'the existing Hindi version was restarted in place, Spanish added');

select makerkit.authenticate_as('f2007_viewer');

select throws_ok(
  $$ insert into public.dubbed_versions (episode_id, language)
     values ('20070000-0000-4000-8000-0000000000e1', 'fr') $$,
  '42501', null,
  'a project viewer cannot start a dub');

-- 11: and a viewer sees the dubs (get_render_progress reads them as the caller)
select results_eq(
  $$ select count(*)::int from public.dubbed_versions
      where episode_id = '20070000-0000-4000-8000-0000000000e1' $$,
  $$ values (2) $$,
  'a project viewer reads the dubbed versions');

select * from finish();
rollback;
