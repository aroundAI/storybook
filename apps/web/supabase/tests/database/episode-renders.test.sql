begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(62);

-- FILM-2003: episode renders and deliver_edit. The RLS matrix, the CHECKs,
-- every refusal of deliver_edit and its one transaction are exercised with
-- real roles here, not read.
--
-- Actors (seeded team `storybook`: owner@ is an owner, member@ a member)
--   owner     creates project P, so add_project_owner makes them its project owner
--   r_pm      project member  -> opens a session, uploads, finalizes, delivers
--   r_admin   project admin   -> may deliver on a published episode
--   r_view    project viewer  -> reads renders, writes nothing, delivers nothing
--   member    team member, not on project_members -> sees no render
--   r_out     a stranger with a team of one -> nothing

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('r_pm', 'r-pm@storybook.dev');
select tests.create_supabase_user('r_admin', 'r-admin@storybook.dev');
select tests.create_supabase_user('r_view', 'r-view@storybook.dev');
select tests.create_supabase_user('r_out', 'r-out@storybook.dev');

create function pg_temp.solo_team(identifier text) returns uuid
language plpgsql security definer as $$
declare
  team uuid := md5('kb99-solo:' || identifier)::uuid;
begin
  insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
  values (team, identifier || ' (team of one)', false, tests.get_supabase_uid(identifier))
  on conflict (id) do nothing;

  insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid(identifier), team, 'owner')
  on conflict do nothing;

  return team;
end;
$$;
grant execute on function pg_temp.solo_team(text) to authenticated;

-- the key a render must have
create function pg_temp.render_key(episode uuid, render uuid) returns text
language sql as $$
  select 'projects/20030000-0000-4000-8000-000000000001/episodes/' || episode || '/renders/' || render || '.mp4'
$$;
grant execute on function pg_temp.render_key(uuid, uuid) to authenticated;

create function pg_temp.report() returns jsonb
language sql as $$
  select '{"versions":[{"id":"v1","label":"Rough cut","parentId":null,"createdAt":"2026-10-04T10:00:00Z","origin":"rough_cut"}],
           "finalDuration":91.2,"aiOps":4,"userOps":1,"explain":{"scenes":[]}}'::jsonb
$$;
grant execute on function pg_temp.report() to authenticated;

-- the renders list of a delivery
create function pg_temp.renders(primary_id uuid, others uuid[] default '{}') returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_build_object('renderId', primary_id, 'primary', true))
    || coalesce((select jsonb_agg(jsonb_build_object('renderId', o)) from unnest(others) o), '[]'::jsonb)
$$;
grant execute on function pg_temp.renders(uuid, uuid[]) to authenticated;

-- ------------------------------------------------------------------
-- Fixtures, written as postgres
-- ------------------------------------------------------------------
select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('r.team', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.accounts_memberships (user_id, account_id, account_role) values
  (tests.get_supabase_uid('r_pm'), current_setting('r.team')::uuid, 'member'),
  (tests.get_supabase_uid('r_admin'), current_setting('r.team')::uuid, 'member'),
  (tests.get_supabase_uid('r_view'), current_setting('r.team')::uuid, 'member');

insert into public.projects (id, account_id, name, status) values
  ('20030000-0000-4000-8000-000000000001', current_setting('r.team')::uuid, 'FILM-2003 renders', 'active');

insert into public.project_members (project_id, user_id, role) values
  ('20030000-0000-4000-8000-000000000001', tests.get_supabase_uid('r_pm'), 'member'),
  ('20030000-0000-4000-8000-000000000001', tests.get_supabase_uid('r_admin'), 'admin'),
  ('20030000-0000-4000-8000-000000000001', tests.get_supabase_uid('r_view'), 'viewer');

insert into public.episodes (id, project_id, number, title, status, localized_videos) values
  ('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-000000000001', 1, 'Ready', 'ready',
   '{"en": "https://cdn.test/old-primary.mp4", "hi": "https://cdn.test/manual-hi.mp4"}'),
  ('20030000-0000-4000-8000-000000000012', '20030000-0000-4000-8000-000000000001', 2, 'Published', 'published',
   '{"en": "https://cdn.test/manual-en.mp4"}');

-- the episode's earlier delivery: a ready render that this one supersedes
insert into public.episode_renders (id, episode_id, preset, aspect, file_path, file_url, file_size_bytes,
  duration_seconds, status, created_by) values
  ('20030000-0000-4000-8000-0000000000a0', '20030000-0000-4000-8000-000000000011', 'youtube_16x9', '16:9',
   pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000a0'),
   'https://cdn.test/old-primary.mp4', 100, 80, 'ready', tests.get_supabase_uid('owner'));

select makerkit.authenticate_as('r_out');
set local role postgres;
select pg_temp.solo_team('r_out');

-- ------------------------------------------------------------------
-- Shape and CHECKs
-- ------------------------------------------------------------------
select is(
  (select relrowsecurity from pg_class where oid = 'public.episode_renders'::regclass),
  true, 'RLS is on for episode_renders');
select has_index('public', 'episode_renders', 'episode_renders_episode_status_idx',
  'episode_renders has an index on (episode_id, status)');
select is(
  (select column_default::text from information_schema.columns
    where table_schema = 'public' and table_name = 'episode_renders' and column_name = 'language'),
  '''en''::text', 'language defaults to en');

select throws_ok(
  format($$ insert into public.episode_renders (episode_id, preset, aspect, file_path, status)
            values ('20030000-0000-4000-8000-000000000011', 'youtube_16x9', '16:9', %L, 'done') $$,
         'x'),
  '23514', null, 'status outside uploading|ready|failed|superseded is refused');
select throws_ok(
  $$ insert into public.episode_renders (id, episode_id, preset, aspect, file_path)
     values ('20030000-0000-4000-8000-0000000000f1', '20030000-0000-4000-8000-000000000011', 'instagram_4x5', '16:9',
             pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000f1')) $$,
  '23514', null, 'a preset outside the six is refused');
select throws_ok(
  $$ insert into public.episode_renders (id, episode_id, preset, aspect, file_path)
     values ('20030000-0000-4000-8000-0000000000f2', '20030000-0000-4000-8000-000000000011', 'tiktok_9x16', '16:9',
             pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000f2')) $$,
  '23514', null, 'a 9:16 preset with a 16:9 aspect is refused');
select throws_ok(
  $$ insert into public.episode_renders (id, episode_id, preset, aspect, file_path)
     values ('20030000-0000-4000-8000-0000000000f3', '20030000-0000-4000-8000-000000000011', 'master', '9:16',
             'projects/x/episodes/20030000-0000-4000-8000-000000000011/renders/other.mp4') $$,
  '23514', null, 'a key that is not the render''s own is refused');
select throws_ok(
  $$ insert into public.episode_renders (id, episode_id, preset, aspect, file_path, status)
     values ('20030000-0000-4000-8000-0000000000f4', '20030000-0000-4000-8000-000000000011', 'master', '9:16',
             pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000f4'), 'ready') $$,
  '23514', null, 'a ready render without its file is refused');
select throws_ok(
  $$ insert into public.episode_renders (id, episode_id, preset, aspect, file_path, status)
     values ('20030000-0000-4000-8000-0000000000f5', '20030000-0000-4000-8000-000000000011', 'master', '9:16',
             pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000f5'), 'failed') $$,
  '23514', null, 'a failed render without a reason is refused');

-- ------------------------------------------------------------------
-- r_pm opens a session on episode 1
-- ------------------------------------------------------------------
select makerkit.authenticate_as('r_pm');
select set_config('r.open1', public.open_edit_session('20030000-0000-4000-8000-000000000011', 'ep@v1')::text, true);
select set_config('r.s1', current_setting('r.open1')::jsonb->'session'->>'id', true);
select set_config('r.v1', current_setting('r.open1')::jsonb->>'episodeVersion', true);
select is(current_setting('r.open1')::jsonb->>'ok', 'true', 'the member opens a session');

-- ------------------------------------------------------------------
-- Inserts: only the session's user, member or above, for the row's own key
-- ------------------------------------------------------------------
select makerkit.authenticate_as('r_view');
select throws_ok(
  format($$ insert into public.episode_renders (id, episode_id, edit_session_id, preset, aspect, file_path, created_by)
            values ('20030000-0000-4000-8000-0000000000b9', '20030000-0000-4000-8000-000000000011', %L, 'master', '16:9',
                    pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000b9'), %L) $$,
         current_setting('r.s1'), tests.get_supabase_uid('r_view')),
  '42501', null, 'a viewer cannot insert a render');

select makerkit.authenticate_as('member');
select throws_ok(
  format($$ insert into public.episode_renders (id, episode_id, edit_session_id, preset, aspect, file_path, created_by)
            values ('20030000-0000-4000-8000-0000000000b8', '20030000-0000-4000-8000-000000000011', %L, 'master', '16:9',
                    pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000b8'), %L) $$,
         current_setting('r.s1'), tests.get_supabase_uid('member')),
  '42501', null, 'a team member who is not on the project cannot insert a render');

select makerkit.authenticate_as('owner');
select throws_ok(
  format($$ insert into public.episode_renders (id, episode_id, edit_session_id, preset, aspect, file_path, created_by)
            values ('20030000-0000-4000-8000-0000000000b7', '20030000-0000-4000-8000-000000000011', %L, 'master', '16:9',
                    pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000b7'), %L) $$,
         current_setting('r.s1'), tests.get_supabase_uid('owner')),
  '42501', null, 'the project owner cannot insert into another user''s session');

select makerkit.authenticate_as('r_pm');
select throws_ok(
  format($$ insert into public.episode_renders (id, episode_id, edit_session_id, preset, aspect, file_path, created_by)
            values ('20030000-0000-4000-8000-0000000000b6', '20030000-0000-4000-8000-000000000011', %L, 'master', '16:9',
                    'projects/20020000-0000-4000-8000-000000000001/episodes/20030000-0000-4000-8000-000000000011/renders/20030000-0000-4000-8000-0000000000b6.mp4', %L) $$,
         current_setting('r.s1'), tests.get_supabase_uid('r_pm')),
  '42501', null, 'a key under another project is refused');
select throws_ok(
  format($$ insert into public.episode_renders (id, episode_id, edit_session_id, preset, aspect, file_path, created_by, file_url)
            values ('20030000-0000-4000-8000-0000000000b5', '20030000-0000-4000-8000-000000000011', %L, 'master', '16:9',
                    pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000b5'), %L, 'https://x') $$,
         current_setting('r.s1'), tests.get_supabase_uid('r_pm')),
  '42501', null, 'an insert cannot set the file URL (finalize does)');

select lives_ok(
  format($$ insert into public.episode_renders (id, episode_id, edit_session_id, preset, language, aspect, file_path, file_size_bytes, created_by) values
            ('20030000-0000-4000-8000-0000000000a1', '20030000-0000-4000-8000-000000000011', %1$L, 'youtube_16x9', 'en', '16:9',
             pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000a1'), 48211, %2$L),
            ('20030000-0000-4000-8000-0000000000a2', '20030000-0000-4000-8000-000000000011', %1$L, 'shorts_9x16', 'en', '9:16',
             pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000a2'), 20000, %2$L),
            ('20030000-0000-4000-8000-0000000000a3', '20030000-0000-4000-8000-000000000011', %1$L, 'square_1x1', 'en', '1:1',
             pg_temp.render_key('20030000-0000-4000-8000-000000000011', '20030000-0000-4000-8000-0000000000a3'), 9000, %2$L) $$,
         current_setting('r.s1'), tests.get_supabase_uid('r_pm')),
  'the session''s user inserts three uploading renders');

-- ------------------------------------------------------------------
-- Read matrix
-- ------------------------------------------------------------------
select is((select count(*)::int from public.episode_renders), 4, 'the member reads the episode''s four renders');
select makerkit.authenticate_as('r_view');
select is((select count(*)::int from public.episode_renders), 4, 'a viewer reads them');
select makerkit.authenticate_as('owner');
select is((select count(*)::int from public.episode_renders), 4, 'the project owner reads them');
select makerkit.authenticate_as('member');
select is((select count(*)::int from public.episode_renders), 0, 'a team member off the project reads none');
select makerkit.authenticate_as('r_out');
select is((select count(*)::int from public.episode_renders), 0, 'a stranger reads none');

-- ------------------------------------------------------------------
-- Finalize: the creator, while uploading, to ready or failed only
-- ------------------------------------------------------------------
select makerkit.authenticate_as('r_view');
update public.episode_renders set status = 'failed', failure_reason = 'x'
 where id = '20030000-0000-4000-8000-0000000000a1';
select makerkit.authenticate_as('owner');
update public.episode_renders set status = 'failed', failure_reason = 'x'
 where id = '20030000-0000-4000-8000-0000000000a1';
set local role postgres;
select is((select status from public.episode_renders where id = '20030000-0000-4000-8000-0000000000a1'),
  'uploading', 'neither a viewer nor the project owner can change another user''s render');

select makerkit.authenticate_as('r_pm');
select throws_ok(
  $$ update public.episode_renders set file_path = 'projects/x/y.mp4' where id = '20030000-0000-4000-8000-0000000000a1' $$,
  '42501', null, 'the key cannot be changed');
select throws_ok(
  $$ update public.episode_renders set status = 'superseded' where id = '20030000-0000-4000-8000-0000000000a1' $$,
  '42501', null, 'the creator cannot supersede a render (only a delivery does)');
select lives_ok(
  $$ update public.episode_renders
        set status = 'ready', file_url = 'https://cdn.test/a1.mp4', file_size_bytes = 48211, duration_seconds = 91.2,
            qa = '{"pass": true, "issues": []}'
      where id in ('20030000-0000-4000-8000-0000000000a1') $$,
  'the creator finalizes the 16:9 render');
update public.episode_renders
   set status = 'ready', file_url = 'https://cdn.test/a2.mp4', duration_seconds = 30, qa = '{"pass": true, "issues": []}'
 where id = '20030000-0000-4000-8000-0000000000a2';
select is(
  (select array_agg(status order by id) from public.episode_renders where created_by = tests.get_supabase_uid('r_pm')),
  array['ready', 'ready', 'uploading'], 'two renders are ready, one still uploading');
-- a ready render is no longer the creator's to change
update public.episode_renders set file_url = 'https://evil.test/x.mp4'
 where id = '20030000-0000-4000-8000-0000000000a1';
select is((select file_url from public.episode_renders where id = '20030000-0000-4000-8000-0000000000a1'),
  'https://cdn.test/a1.mp4', 'a ready render cannot be rewritten');

-- ------------------------------------------------------------------
-- deliver_edit refusals change nothing
-- ------------------------------------------------------------------
set local role postgres;
select set_config('r.before', (
  select jsonb_build_object(
    'episode', (select to_jsonb(e) - 'updated_at' from public.episodes e where e.id = '20030000-0000-4000-8000-000000000011'),
    'renders', (select jsonb_agg(to_jsonb(r) order by r.id) from public.episode_renders r),
    'session', (select to_jsonb(s) from public.edit_sessions s where s.id = current_setting('r.s1')::uuid),
    'assets', (select count(*) from public.assets where project_id = '20030000-0000-4000-8000-000000000001'))
)::text, true);

select makerkit.authenticate_as('r_view');
select is(
  public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int,
    pg_temp.renders('20030000-0000-4000-8000-0000000000a1'), pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'code',
  'FORBIDDEN', 'a viewer cannot deliver');

select makerkit.authenticate_as('owner');
select is(
  public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int,
    pg_temp.renders('20030000-0000-4000-8000-0000000000a1'), pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'reason',
  'session', 'the project owner cannot deliver another user''s session');

select makerkit.authenticate_as('r_out');
select is(
  public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int,
    pg_temp.renders('20030000-0000-4000-8000-0000000000a1'), pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'code',
  'NOT_FOUND', 'a stranger is told the session does not exist');

select makerkit.authenticate_as('r_pm');
select set_config('r.changed', public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int - 1,
    pg_temp.renders('20030000-0000-4000-8000-0000000000a1'), pg_temp.report(), '{"pass":true,"issues":[]}', '{}')::text, true);
select is(current_setting('r.changed')::jsonb->>'code', 'TARGET_CHANGED',
  'a delivery against an older episode version is TARGET_CHANGED');
select is((current_setting('r.changed')::jsonb->>'currentVersion')::int, current_setting('r.v1')::int,
  'TARGET_CHANGED says the current version');

select is(
  public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int,
    pg_temp.renders('20030000-0000-4000-8000-0000000000a1', array['20030000-0000-4000-8000-0000000000a3'::uuid]),
    pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'reason',
  'not_ready', 'a render still uploading is refused');
select is(
  public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int,
    pg_temp.renders('20030000-0000-4000-8000-0000000000a1', array['20030000-0000-4000-8000-0000000000a0'::uuid]),
    pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'reason',
  'not_ready', 'a render someone else made is refused');
select is(
  public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int,
    '[{"renderId":"20030000-0000-4000-8000-0000000000a1","primary":true},{"renderId":"20030000-0000-4000-8000-0000000000a2","primary":true}]',
    pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'reason',
  'primary', 'two primary renders are refused');
select is(
  public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int,
    '[{"renderId":"20030000-0000-4000-8000-0000000000a1"}]',
    pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'reason',
  'primary', 'no primary render is refused');
select is(
  public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int,
    '[{"renderId":"not-a-uuid","primary":true}]',
    pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'reason',
  'renders', 'a malformed render id is refused');

set local role postgres;
select is(
  jsonb_build_object(
    'episode', (select to_jsonb(e) - 'updated_at' from public.episodes e where e.id = '20030000-0000-4000-8000-000000000011'),
    'renders', (select jsonb_agg(to_jsonb(r) order by r.id) from public.episode_renders r),
    'session', (select to_jsonb(s) from public.edit_sessions s where s.id = current_setting('r.s1')::uuid),
    'assets', (select count(*) from public.assets where project_id = '20030000-0000-4000-8000-000000000001')),
  current_setting('r.before')::jsonb,
  'no refused delivery changed the episode, a render, the session or the assets');

-- ------------------------------------------------------------------
-- deliver_edit: one transaction
-- ------------------------------------------------------------------
select makerkit.authenticate_as('r_pm');
select set_config('r.done', public.deliver_edit(current_setting('r.s1')::uuid, current_setting('r.v1')::int,
    pg_temp.renders('20030000-0000-4000-8000-0000000000a1', array['20030000-0000-4000-8000-0000000000a2'::uuid]),
    pg_temp.report(), '{"pass":true,"issues":[]}', '{"versions": 2, "plansProposed": 1}')::text, true);

select is(current_setting('r.done')::jsonb->>'ok', 'true', 'the member delivers');
select is((current_setting('r.done')::jsonb->>'superseded')::int, 1, 'one older render was superseded');

set local role postgres;
select is((select status from public.episodes where id = '20030000-0000-4000-8000-000000000011'),
  'ready', 'the episode is ready');
select is((select final_video_url from public.episodes where id = '20030000-0000-4000-8000-000000000011'),
  'https://cdn.test/a1.mp4', 'final_video_url is the primary render''s');
select is(
  (select a.type || ' ' || a.file_url || ' ' || a.project_id || ' ' || (a.metadata->>'renderId')
     from public.episodes e join public.assets a on a.id = e.master_video_asset_id
    where e.id = '20030000-0000-4000-8000-000000000011'),
  'master_video https://cdn.test/a1.mp4 20030000-0000-4000-8000-000000000001 20030000-0000-4000-8000-0000000000a1',
  'master_video_asset_id names a master_video asset of the primary render');
select is(
  (select master_video_asset_id::text from public.episodes where id = '20030000-0000-4000-8000-000000000011'),
  current_setting('r.done')::jsonb->>'masterVideoAssetId', 'the asset id is the one returned');
select is((select localized_videos from public.episodes where id = '20030000-0000-4000-8000-000000000011'),
  '{"en": "https://cdn.test/a1.mp4", "hi": "https://cdn.test/manual-hi.mp4"}'::jsonb,
  'the primary replaces the superseded render as the en publish target; the manual hi upload is kept');
select is(
  (select array_agg(status order by id) from public.episode_renders where episode_id = '20030000-0000-4000-8000-000000000011'),
  array['superseded', 'ready', 'ready', 'uploading'],
  'the older ready render is superseded; the delivered ones stay ready; the unfinished one is untouched');
select is(
  (select status || ' ' || close_reason from public.edit_sessions where id = current_setting('r.s1')::uuid),
  'delivered delivered', 'the session is delivered');
select is(
  (select (summary->'report'->>'finalDuration') || ' ' || (summary->>'versions') || ' ' || (summary->>'primaryRenderId')
     from public.edit_sessions where id = current_setting('r.s1')::uuid),
  '91.2 2 20030000-0000-4000-8000-0000000000a1', 'the session summary holds the report, the counts and the primary');
select is(
  (select (edit_state->>'sessionId') is null and (edit_state->>'lastDeliveredAt') is not null
          and (edit_state->>'versions')::int = 2
     from public.episodes where id = '20030000-0000-4000-8000-000000000011'),
  true, 'edit_state is released and stamped with the delivery');
select ok(
  (select version > current_setting('r.v1')::int from public.episodes where id = '20030000-0000-4000-8000-000000000011'),
  'episodes.version was incremented');
select is(
  (select version from public.episodes where id = '20030000-0000-4000-8000-000000000011'),
  (current_setting('r.done')::jsonb->>'episodeVersion')::int, 'the returned episodeVersion is the new version');

-- after the delivery the session is over: nothing more is finalized in it
select makerkit.authenticate_as('r_pm');
update public.episode_renders set status = 'failed', failure_reason = 'late'
 where id = '20030000-0000-4000-8000-0000000000a3';
select is((select status from public.episode_renders where id = '20030000-0000-4000-8000-0000000000a3'),
  'uploading', 'a render of a delivered session cannot be finalized');
select is(
  public.deliver_edit(current_setting('r.s1')::uuid, (current_setting('r.done')::jsonb->>'episodeVersion')::int,
    pg_temp.renders('20030000-0000-4000-8000-0000000000a1'), pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'status',
  'delivered', 'a delivered session cannot deliver again');

-- ------------------------------------------------------------------
-- A published episode: owner or admin only (README open question 5)
-- ------------------------------------------------------------------
select set_config('r.open2', public.open_edit_session('20030000-0000-4000-8000-000000000012', 'ep@v1')::text, true);
select set_config('r.s2', current_setting('r.open2')::jsonb->'session'->>'id', true);
insert into public.episode_renders (id, episode_id, edit_session_id, preset, aspect, file_path, created_by) values
  ('20030000-0000-4000-8000-0000000000c1', '20030000-0000-4000-8000-000000000012', current_setting('r.s2')::uuid,
   'youtube_16x9', '16:9', pg_temp.render_key('20030000-0000-4000-8000-000000000012', '20030000-0000-4000-8000-0000000000c1'),
   tests.get_supabase_uid('r_pm'));
update public.episode_renders set status = 'ready', file_url = 'https://cdn.test/c1.mp4', file_size_bytes = 1, duration_seconds = 1
 where id = '20030000-0000-4000-8000-0000000000c1';
select is(
  public.deliver_edit(current_setting('r.s2')::uuid, (current_setting('r.open2')::jsonb->>'episodeVersion')::int,
    pg_temp.renders('20030000-0000-4000-8000-0000000000c1'), pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'reason',
  'published', 'a member cannot deliver over a published episode');
select is(public.close_edit_session(current_setting('r.s2')::uuid, '{}')->>'restoredStatus', 'published',
  'the member closes the session and the episode is published again');

select makerkit.authenticate_as('r_admin');
select set_config('r.open3', public.open_edit_session('20030000-0000-4000-8000-000000000012', 'ep@v1')::text, true);
select set_config('r.s3', current_setting('r.open3')::jsonb->'session'->>'id', true);
insert into public.episode_renders (id, episode_id, edit_session_id, preset, aspect, file_path, created_by) values
  ('20030000-0000-4000-8000-0000000000c2', '20030000-0000-4000-8000-000000000012', current_setting('r.s3')::uuid,
   'youtube_16x9', '16:9', pg_temp.render_key('20030000-0000-4000-8000-000000000012', '20030000-0000-4000-8000-0000000000c2'),
   tests.get_supabase_uid('r_admin'));
update public.episode_renders set status = 'ready', file_url = 'https://cdn.test/c2.mp4', file_size_bytes = 1, duration_seconds = 1
 where id = '20030000-0000-4000-8000-0000000000c2';
select is(
  public.deliver_edit(current_setting('r.s3')::uuid, (current_setting('r.open3')::jsonb->>'episodeVersion')::int,
    pg_temp.renders('20030000-0000-4000-8000-0000000000c2'), pg_temp.report(), '{"pass":true,"issues":[]}', '{}')->>'ok',
  'true', 'a project admin delivers over a published episode');

set local role postgres;
select is(
  (select status || ' ' || final_video_url || ' ' || (localized_videos->>'en')
     from public.episodes where id = '20030000-0000-4000-8000-000000000012'),
  'ready https://cdn.test/c2.mp4 https://cdn.test/manual-en.mp4',
  'the re-delivered episode is ready with the new primary; the manual en upload stays the publish target');
select is(
  (select status from public.episode_renders where id = '20030000-0000-4000-8000-0000000000c1'),
  'superseded', 'the member''s earlier ready render of that episode is superseded');

-- ------------------------------------------------------------------
-- Stale uploads fail after 24 hours (the hourly cron)
-- ------------------------------------------------------------------
select makerkit.authenticate_as('r_pm');
select throws_ok($$ select public.expire_stale_render_uploads() $$, '42501', null,
  'a signed-in user cannot run the expiry');

set local role postgres;
update public.episode_renders set created_at = now() - interval '25 hours'
 where id = '20030000-0000-4000-8000-0000000000a3';
set local role service_role;
select is(public.expire_stale_render_uploads(), 1, 'the expiry fails the one stale upload');
set local role postgres;
select is(
  (select status || ': ' || failure_reason from public.episode_renders where id = '20030000-0000-4000-8000-0000000000a3'),
  'failed: The upload was not finalized within 24 hours', 'the stale render is failed with the reason');
select is(public.expire_stale_render_uploads(), 0, 'a second run finds nothing');

select * from finish();
rollback;
