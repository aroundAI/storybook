begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(4);

-- FILM-2001: get_edit_package reads with the caller's RLS client only (the
-- MCP principal's JWT; no service role under studio-mcp/tools). So what a
-- caller may build a package from is exactly what these policies give them.
-- A viewer-role project member reads every table the builder reads; a
-- stranger with a team and project of their own reads none of it.
--
-- The rows are the builder's own query shapes
-- (desktop-integration/src/server/load-edit-package.ts), one row per table.

select tests.create_supabase_user('f2001_owner', 'f2001-owner@storybook.dev');
select tests.create_supabase_user('f2001_viewer', 'f2001-viewer@storybook.dev');
select tests.create_supabase_user('f2001_stranger', 'f2001-stranger@storybook.dev');

select makerkit.authenticate_as('f2001_owner');
select public.create_team_account('F2001 Team');
select set_config('f2001.team', makerkit.get_account_id_by_slug('f2001-team')::text, true);

insert into public.projects (id, account_id, name, slug, status, brand, edit_policy)
  values ('20010000-0000-4000-8000-000000000001', current_setting('f2001.team')::uuid,
          'Edit package', 'f2001-edit-package', 'active',
          '{"transitionStyle": "dip"}', '{"minShotLength": 2}');

select makerkit.authenticate_as('f2001_stranger');
select public.create_team_account('F2001 Stranger Co');
insert into public.projects (id, account_id, name, slug, status)
  values ('20010000-0000-4000-8000-000000000002', makerkit.get_account_id_by_slug('f2001-stranger-co'),
          'Own', 'f2001-own', 'active');

set local role postgres;

insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('f2001_viewer'), current_setting('f2001.team')::uuid, 'member');
insert into public.project_members (project_id, user_id, role)
  values ('20010000-0000-4000-8000-000000000001', tests.get_supabase_uid('f2001_viewer'), 'viewer');

insert into public.episodes (id, project_id, number, title, status, version, metadata)
  values ('20010000-0000-4000-8000-0000000000e1', '20010000-0000-4000-8000-000000000001',
          1, 'Pilot', 'storyboard', 1,
          '{"character_ids": ["20010000-0000-4000-8000-0000000000c1"]}');
insert into public.shots (id, episode_id, sequence_number, duration_seconds, prompt, status)
  values ('20010000-0000-4000-8000-0000000000a1', '20010000-0000-4000-8000-0000000000e1', 1, 5, 'p', 'completed');
insert into public.dialogue_lines (id, episode_id, sequence_number, text, language, status)
  values ('20010000-0000-4000-8000-0000000000d1', '20010000-0000-4000-8000-0000000000e1', 1, 'Hello.', 'en', 'completed');
insert into public.audio_assets (id, project_id, audio_type, prompt, prompt_hash, source, status)
  values ('20010000-0000-4000-8000-0000000000b1', '20010000-0000-4000-8000-000000000001',
          'music', 'bed', 'f2001', 'generated', 'completed');
insert into public.audio_tracks (id, episode_id, type, audio_asset_id)
  values ('20010000-0000-4000-8000-0000000000b2', '20010000-0000-4000-8000-0000000000e1',
          'music', '20010000-0000-4000-8000-0000000000b1');
insert into public.captions (id, episode_id, language)
  values ('20010000-0000-4000-8000-0000000000f1', '20010000-0000-4000-8000-0000000000e1', 'en');
insert into public.caption_segments (caption_id, sequence_number, start_time, end_time, text)
  values ('20010000-0000-4000-8000-0000000000f1', 1, 0, 1.5, 'Hello.');
insert into public.assets (id, project_id, type, name, file_hash)
  values ('20010000-0000-4000-8000-0000000000c1', '20010000-0000-4000-8000-000000000001',
          'character', 'MAYA', repeat('a', 64));
insert into public.character_details (asset_id, elevenlabs_voice_id)
  values ('20010000-0000-4000-8000-0000000000c1', 'voice-maya');
insert into public.shorts (episode_id, start_seconds, end_seconds)
  values ('20010000-0000-4000-8000-0000000000e1', 1, 4);
insert into public.dubbed_versions (id, episode_id, language)
  values ('20010000-0000-4000-8000-0000000000a9', '20010000-0000-4000-8000-0000000000e1', 'hi');
insert into public.dubbed_dialogue_lines (dubbed_version_id, original_dialogue_id, translated_text)
  values ('20010000-0000-4000-8000-0000000000a9', '20010000-0000-4000-8000-0000000000d1', 'नमस्ते।');

-- What the builder reads, one count per table, in the builder's filters.
create function pg_temp.edit_package_reads() returns table (source text, rows bigint)
language sql as $$
  select 'episodes+project', count(*) from public.episodes e
    join public.projects p on p.id = e.project_id
   where e.id = '20010000-0000-4000-8000-0000000000e1' and e.deleted_at is null
     and p.account_id = current_setting('f2001.team')::uuid
  union all select 'brand+edit_policy', count(*) from public.projects
   where id = '20010000-0000-4000-8000-000000000001' and brand ? 'transitionStyle' and edit_policy ? 'minShotLength'
  union all select 'shots', count(*) from public.shots
   where episode_id = '20010000-0000-4000-8000-0000000000e1' and deleted_at is null
  union all select 'dialogue_lines', count(*) from public.dialogue_lines
   where episode_id = '20010000-0000-4000-8000-0000000000e1'
  union all select 'audio_tracks', count(*) from public.audio_tracks
   where episode_id = '20010000-0000-4000-8000-0000000000e1'
  union all select 'audio_assets', count(*) from public.audio_assets
   where id = '20010000-0000-4000-8000-0000000000b1' and project_id = '20010000-0000-4000-8000-000000000001'
  union all select 'captions', count(*) from public.captions
   where episode_id = '20010000-0000-4000-8000-0000000000e1'
  union all select 'caption_segments', count(*) from public.caption_segments
   where caption_id = '20010000-0000-4000-8000-0000000000f1'
  union all select 'character assets', count(*) from public.assets
   where id = '20010000-0000-4000-8000-0000000000c1' and type = 'character' and deleted_at is null
  union all select 'character_details', count(*) from public.character_details
   where asset_id = '20010000-0000-4000-8000-0000000000c1'
  union all select 'recorded hashes', count(*) from public.assets
   where project_id = '20010000-0000-4000-8000-000000000001' and file_hash is not null and deleted_at is null
  union all select 'shorts', count(*) from public.shorts
   where episode_id = '20010000-0000-4000-8000-0000000000e1'
  union all select 'dubbed_versions', count(*) from public.dubbed_versions
   where episode_id = '20010000-0000-4000-8000-0000000000e1'
  union all select 'dubbed_dialogue_lines', count(*) from public.dubbed_dialogue_lines
   where dubbed_version_id = '20010000-0000-4000-8000-0000000000a9'
$$;
grant execute on function pg_temp.edit_package_reads() to authenticated;

select makerkit.authenticate_as('f2001_viewer');

select is(
  (select role::text from public.project_members
    where project_id = '20010000-0000-4000-8000-000000000001'
      and user_id = tests.get_supabase_uid('f2001_viewer')),
  'viewer',
  'R0 the reader is a viewer on the project, no more'
);

select results_eq(
  $$ select source, rows from pg_temp.edit_package_reads() $$,
  $$ values ('episodes+project', 1::bigint), ('brand+edit_policy', 1), ('shots', 1),
            ('dialogue_lines', 1), ('audio_tracks', 1), ('audio_assets', 1),
            ('captions', 1), ('caption_segments', 1), ('character assets', 1),
            ('character_details', 1), ('recorded hashes', 1), ('shorts', 1),
            ('dubbed_versions', 1), ('dubbed_dialogue_lines', 1) $$,
  'R1 a viewer-role project member reads every row the edit package is built from'
);

select makerkit.authenticate_as('f2001_stranger');

select results_eq(
  $$ select source, rows from pg_temp.edit_package_reads() $$,
  $$ values ('episodes+project', 0::bigint), ('brand+edit_policy', 0), ('shots', 0),
            ('dialogue_lines', 0), ('audio_tracks', 0), ('audio_assets', 0),
            ('captions', 0), ('caption_segments', 0), ('character assets', 0),
            ('character_details', 0), ('recorded hashes', 0), ('shorts', 0),
            ('dubbed_versions', 0), ('dubbed_dialogue_lines', 0) $$,
  'R2 a stranger with a team of their own reads none of it: NOT_FOUND, never a partial package'
);

select is(
  (select count(*) from public.projects where id = '20010000-0000-4000-8000-000000000002'),
  1::bigint,
  'R3 the stranger reads their own project, so R2 is RLS refusing, not a broken session'
);

select * from finish();
rollback;
