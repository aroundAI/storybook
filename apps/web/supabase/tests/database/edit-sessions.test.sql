begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(53);

-- FILM-2002: edit sessions, edit events and the editing status. The RLS
-- matrix, every refusal of the three functions and the status machine are
-- exercised with real roles here, not read.
--
-- Actors (seeded team `storybook`: owner@ is an owner, member@ a member)
--   owner    creates project P, so add_project_owner makes them its project owner
--   e2_pm    team member and project member  -> opens, records, closes their own session
--   e2_view  team member and project viewer  -> reads, opens nothing
--   member   team member, not on project_members -> no edit-session rows at all
--   e2_out   a stranger with a team of one   -> nothing

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('e2_pm', 'e2-pm@storybook.dev');
select tests.create_supabase_user('e2_view', 'e2-view@storybook.dev');
select tests.create_supabase_user('e2_out', 'e2-out@storybook.dev');

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

-- 500 well-formed events, or 501
create function pg_temp.events(n integer, prefix text) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_event_id', prefix || i, 'ts', now(), 'type', 'qa_run',
    'data', jsonb_build_object('pass', true, 'issues', 0)
  )), '[]'::jsonb)
  from generate_series(1, n) i
$$;
grant execute on function pg_temp.events(integer, text) to authenticated;

-- ------------------------------------------------------------------
-- Fixtures, written as postgres
-- ------------------------------------------------------------------
select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('e2.team', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('e2.pm', tests.get_supabase_uid('e2_pm')::text, true);
select set_config('e2.owner', tests.get_supabase_uid('owner')::text, true);

insert into public.accounts_memberships (user_id, account_id, account_role) values
  (tests.get_supabase_uid('e2_pm'), current_setting('e2.team')::uuid, 'member'),
  (tests.get_supabase_uid('e2_view'), current_setting('e2.team')::uuid, 'member');

insert into public.projects (id, account_id, name, status) values
  ('20020000-0000-4000-8000-000000000001', current_setting('e2.team')::uuid, 'FILM-2002 sessions', 'active');

insert into public.project_members (project_id, user_id, role) values
  ('20020000-0000-4000-8000-000000000001', tests.get_supabase_uid('e2_pm'), 'member'),
  ('20020000-0000-4000-8000-000000000001', tests.get_supabase_uid('e2_view'), 'viewer');

insert into public.episodes (id, project_id, number, title, status) values
  ('20020000-0000-4000-8000-000000000011', '20020000-0000-4000-8000-000000000001', 1, 'Ready', 'ready'),
  ('20020000-0000-4000-8000-000000000012', '20020000-0000-4000-8000-000000000001', 2, 'Draft', 'draft'),
  ('20020000-0000-4000-8000-000000000013', '20020000-0000-4000-8000-000000000001', 3, 'Story', 'story'),
  ('20020000-0000-4000-8000-000000000014', '20020000-0000-4000-8000-000000000001', 4, 'Published', 'published'),
  ('20020000-0000-4000-8000-000000000015', '20020000-0000-4000-8000-000000000001', 5, 'Storyboard', 'storyboard');

-- a connection that belongs to the owner, not to e2_pm
insert into public.mcp_connections (id, user_id, account_id, kind, name, scopes) values
  ('20020000-0000-4000-8000-0000000000c1', current_setting('e2.owner')::uuid,
   current_setting('e2.team')::uuid, 'pat', 'owner laptop', array['studio:write']);

select makerkit.authenticate_as('e2_out');
set local role postgres;
select pg_temp.solo_team('e2_out');

-- ------------------------------------------------------------------
-- Shape
-- ------------------------------------------------------------------
select is(
  (select column_default::text from information_schema.columns
    where table_schema = 'public' and table_name = 'episodes' and column_name = 'edit_state'),
  '''{}''::jsonb', 'episodes.edit_state defaults to {}');

select is(
  (select array_agg(relname::text order by relname) from pg_class
    where relname in ('edit_sessions', 'edit_events') and relrowsecurity),
  array['edit_events', 'edit_sessions'],
  'RLS is on for edit_sessions and edit_events'
);

-- ------------------------------------------------------------------
-- open_edit_session refusals
-- ------------------------------------------------------------------
select makerkit.authenticate_as('e2_view');
select is(
  public.open_edit_session('20020000-0000-4000-8000-000000000011', 'ep@v1')->>'code',
  'FORBIDDEN', 'a project viewer cannot open a session');

select makerkit.authenticate_as('member');
select is(
  public.open_edit_session('20020000-0000-4000-8000-000000000011', 'ep@v1')->>'code',
  'FORBIDDEN', 'a team member who is not on the project cannot open a session');

select makerkit.authenticate_as('e2_out');
select is(
  public.open_edit_session('20020000-0000-4000-8000-000000000011', 'ep@v1')->>'code',
  'NOT_FOUND', 'a stranger is told the episode does not exist');

select makerkit.authenticate_as('e2_pm');
select is(
  public.open_edit_session('20020000-0000-4000-8000-000000000012', 'ep@v1')->>'code',
  'VALIDATION_FAILED', 'a draft episode has nothing to edit');
select is(
  public.open_edit_session('20020000-0000-4000-8000-000000000013', 'ep@v1')->>'code',
  'VALIDATION_FAILED', 'a story-stage episode has nothing to edit');
select is(
  public.open_edit_session('20020000-0000-4000-8000-000000000011', 'ep@v1',
    '20020000-0000-4000-8000-0000000000c1')->>'code',
  'FORBIDDEN', 'a connection that is not the caller''s is refused');
select is(
  public.open_edit_session('00000000-0000-4000-8000-000000000999', 'ep@v1')->>'code',
  'NOT_FOUND', 'an unknown episode is NOT_FOUND');

set local role postgres;
select is(
  (select array_agg(status::text order by number) from public.episodes
    where project_id = '20020000-0000-4000-8000-000000000001'),
  array['ready', 'draft', 'story', 'published', 'storyboard'],
  'no refused open moved any status');
select is((select count(*)::int from public.edit_sessions), 0, 'no refused open wrote a session');

-- ------------------------------------------------------------------
-- open: ready -> editing
-- ------------------------------------------------------------------
select makerkit.authenticate_as('e2_pm');
select set_config('e2.open1', public.open_edit_session('20020000-0000-4000-8000-000000000011', 'ep@v1')::text, true);

select is(current_setting('e2.open1')::jsonb->>'ok', 'true', 'a project member opens a session');
select is(current_setting('e2.open1')::jsonb->>'previousStatus', 'ready', 'previousStatus is the status it replaced');
select is(current_setting('e2.open1')::jsonb->>'existing', 'false', 'a first open is a new session');
select set_config('e2.s1', current_setting('e2.open1')::jsonb->'session'->>'id', true);

select is(
  (select status::text from public.episodes where id = '20020000-0000-4000-8000-000000000011'),
  'editing', 'the episode is editing');
select is(
  (select edit_state->>'sessionId' from public.episodes where id = '20020000-0000-4000-8000-000000000011'),
  current_setting('e2.s1'), 'edit_state names the session');
select is(
  (select edit_state->'editedBy'->>'userId' from public.episodes where id = '20020000-0000-4000-8000-000000000011'),
  current_setting('e2.pm'), 'edit_state names the editor');
select is(
  (select edit_state->>'editedIn' || '/' || (edit_state->>'versions')
     from public.episodes where id = '20020000-0000-4000-8000-000000000011'),
  'studio/0', 'edit_state says studio and no versions yet');
select is(
  (select (current_setting('e2.open1')::jsonb->>'episodeVersion')::int = version
     from public.episodes where id = '20020000-0000-4000-8000-000000000011'),
  true, 'episodeVersion is the episode version after the open');

select is(
  public.open_edit_session('20020000-0000-4000-8000-000000000011', 'ep@v2')->'session'->>'id',
  current_setting('e2.s1'), 'the same user opening again gets the open session');

select makerkit.authenticate_as('owner');
select is(
  public.open_edit_session('20020000-0000-4000-8000-000000000011', 'ep@v1')->>'code',
  'RUN_IN_PROGRESS', 'another user''s open is RUN_IN_PROGRESS');
select is(
  public.open_edit_session('20020000-0000-4000-8000-000000000011', 'ep@v1')->'holder'->>'userId',
  current_setting('e2.pm'), 'RUN_IN_PROGRESS says who holds the episode');

-- ------------------------------------------------------------------
-- Direct writes are refused; the functions are the only way in
-- ------------------------------------------------------------------
select makerkit.authenticate_as('e2_pm');
select throws_ok(
  format($$ insert into public.edit_sessions (episode_id, user_id, package_etag, previous_status)
            values ('20020000-0000-4000-8000-000000000015', %L, 'x', 'storyboard') $$, current_setting('e2.pm')),
  '42501', null, 'a direct insert into edit_sessions is refused');
select throws_ok(
  format($$ insert into public.edit_events (edit_session_id, client_event_id, ts, type)
            values (%L, 'direct', now(), 'qa_run') $$, current_setting('e2.s1')),
  '42501', null, 'a direct insert into edit_events is refused');
select throws_ok(
  format($$ update public.edit_sessions set status = 'closed' where id = %L $$, current_setting('e2.s1')),
  '42501', null, 'a direct update of edit_sessions is refused');

-- ------------------------------------------------------------------
-- record_edit_events
-- ------------------------------------------------------------------
select is(
  public.record_edit_events(current_setting('e2.s1')::uuid, pg_temp.events(2, 'a'))->>'accepted',
  '2', 'the session''s user records two events');
select is(
  public.record_edit_events(current_setting('e2.s1')::uuid, pg_temp.events(2, 'a')) - 'ok',
  '{"accepted": 0, "duplicates": 2}'::jsonb, 'a replayed batch inserts nothing (idempotent on client_event_id)');
select is(
  public.record_edit_events(current_setting('e2.s1')::uuid, pg_temp.events(501, 'b'))->>'code',
  'VALIDATION_FAILED', '501 events in one call are refused');
select is(
  public.record_edit_events(current_setting('e2.s1')::uuid, pg_temp.events(500, 'c'))->>'accepted',
  '500', '500 events in one call are accepted');

select makerkit.authenticate_as('owner');
select is(
  public.record_edit_events(current_setting('e2.s1')::uuid, pg_temp.events(1, 'o'))->>'code',
  'FORBIDDEN', 'another user cannot record into the session');
select makerkit.authenticate_as('e2_out');
select is(
  public.record_edit_events(current_setting('e2.s1')::uuid, pg_temp.events(1, 'x'))->>'code',
  'NOT_FOUND', 'a stranger is told the session does not exist');

-- ------------------------------------------------------------------
-- RLS read matrix
-- ------------------------------------------------------------------
select makerkit.authenticate_as('e2_view');
select is((select count(*)::int from public.edit_sessions), 1, 'a project viewer reads the session');
select is((select count(*)::int from public.edit_events), 502, 'a project viewer reads its events');
select makerkit.authenticate_as('e2_pm');
select is((select count(*)::int from public.edit_events), 502, 'the session''s user reads its events');
select makerkit.authenticate_as('member');
select is((select count(*)::int from public.edit_sessions), 0, 'a team member off the project reads no session');
select makerkit.authenticate_as('e2_out');
select is((select count(*)::int from public.edit_sessions), 0, 'a stranger reads no session');
select is((select count(*)::int from public.edit_events), 0, 'a stranger reads no event');

-- ------------------------------------------------------------------
-- close_edit_session
-- ------------------------------------------------------------------
select makerkit.authenticate_as('owner');
select is(
  public.close_edit_session(current_setting('e2.s1')::uuid, '{}', 'client')->>'code',
  'FORBIDDEN', 'another user cannot close it as the client');
select makerkit.authenticate_as('e2_view');
select is(
  public.close_edit_session(current_setting('e2.s1')::uuid, '{}', 'admin')->>'code',
  'FORBIDDEN', 'a viewer cannot force-close it');
select makerkit.authenticate_as('e2_pm');
select is(
  public.close_edit_session(current_setting('e2.s1')::uuid, '{}', 'stale')->>'code',
  'FORBIDDEN', 'only the service role closes a session as stale');

select is(
  public.close_edit_session(current_setting('e2.s1')::uuid, '{"versions": 1, "qaRuns": 502}', 'client')->>'restoredStatus',
  'ready', 'closing without a delivery restores the previous status');

set local role postgres;
select is(
  (select status || '/' || coalesce(edit_state->>'sessionId', 'null') from public.episodes
    where id = '20020000-0000-4000-8000-000000000011'),
  'ready/null', 'the episode is ready again and edit_state names no session');
select is(
  (select status || '/' || close_reason || '/' || (summary->>'qaRuns') || '/' || (closed_at is not null)::text
     from public.edit_sessions where id = current_setting('e2.s1')::uuid),
  'closed/client/502/true', 'the session is closed with its summary and reason');

select makerkit.authenticate_as('e2_pm');
select is(
  public.record_edit_events(current_setting('e2.s1')::uuid, pg_temp.events(1, 'late'))->>'code',
  'VALIDATION_FAILED', 'a closed session refuses events');
select is(
  public.close_edit_session(current_setting('e2.s1')::uuid, '{}', 'client')->>'code',
  'VALIDATION_FAILED', 'a closed session cannot be closed again');

-- ------------------------------------------------------------------
-- published -> editing -> published (admin force-close, FILM-2006)
-- ------------------------------------------------------------------
select set_config('e2.open4', public.open_edit_session('20020000-0000-4000-8000-000000000014', 'ep@v1')::text, true);
select is(current_setting('e2.open4')::jsonb->>'previousStatus', 'published', 'a published episode opens with previousStatus published');

select makerkit.authenticate_as('owner');
select is(
  public.close_edit_session((current_setting('e2.open4')::jsonb->'session'->>'id')::uuid, '{}', 'admin')->>'restoredStatus',
  'published', 'a project owner force-closes it and the episode is published again');

-- ------------------------------------------------------------------
-- Stale close by the service role (the hourly cron)
-- ------------------------------------------------------------------
select makerkit.authenticate_as('e2_pm');
select set_config('e2.open5', public.open_edit_session('20020000-0000-4000-8000-000000000015', 'ep@v1')::text, true);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  public.close_edit_session((current_setting('e2.open5')::jsonb->'session'->>'id')::uuid, '{}', 'stale')->>'restoredStatus',
  'storyboard', 'the service role closes a stale session and restores storyboard');

-- ------------------------------------------------------------------
-- kit.end_edit_session('delivered'): FILM-2003's seam
-- ------------------------------------------------------------------
select makerkit.authenticate_as('e2_pm');
select set_config('e2.open5b', public.open_edit_session('20020000-0000-4000-8000-000000000015', 'ep@v2')::text, true);
select throws_ok(
  format($$ select kit.end_edit_session(%L, 'delivered', '{}', 'delivered') $$,
    current_setting('e2.open5b')::jsonb->'session'->>'id'),
  '42501', null, 'authenticated cannot call kit.end_edit_session');

set local role postgres;
select kit.end_edit_session((current_setting('e2.open5b')::jsonb->'session'->>'id')::uuid, 'delivered', '{"versions": 3}', 'delivered');
select is(
  (select status || '/' || (edit_state->>'versions') || '/' || (edit_state->>'lastDeliveredAt' is not null)::text
          || '/' || coalesce(edit_state->>'sessionId', 'null')
     from public.episodes where id = '20020000-0000-4000-8000-000000000015'),
  'editing/3/true/null', 'a delivery leaves the status to the caller and stamps lastDeliveredAt and versions');

-- ------------------------------------------------------------------
-- Table guards
-- ------------------------------------------------------------------
insert into public.edit_sessions (episode_id, user_id, package_etag, previous_status)
values ('20020000-0000-4000-8000-000000000014', current_setting('e2.pm')::uuid, 'x', 'published');
select throws_ok(
  format($$ insert into public.edit_sessions (episode_id, user_id, package_etag, previous_status)
            values ('20020000-0000-4000-8000-000000000014', %L, 'y', 'published') $$, current_setting('e2.owner')),
  '23505', null, 'a second open session on one episode is refused (edit_sessions_one_open)');
select throws_ok(
  format($$ insert into public.edit_sessions (episode_id, user_id, package_etag, previous_status)
            values ('20020000-0000-4000-8000-000000000012', %L, 'z', 'draft') $$, current_setting('e2.pm')),
  '23514', null, 'previous_status cannot be draft');
select throws_ok(
  format($$ insert into public.edit_events (edit_session_id, client_event_id, ts, type)
            values (%L, 'bad-type', now(), 'session_opened') $$, current_setting('e2.s1')),
  '23514', null, 'an event type outside the enum is refused');

select * from finish();

rollback;
