begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(21);

-- FILM-2006: the Edit record page's reads and the Studio delivery panel.
--   edit_session_device   the session's device name, to project members only
--   open after delivery   the next open_edit_session records previousStatus
--                         = published when the delivered episode was published
--   force-close           close_edit_session(..., 'admin'): project owner/admin
--                         only, restoring the previous status
--   delivery panel        admin_studio_delivery_stats: super admin at aal2 only;
--                         every figure computed by hand from the rows below
-- Fixture ids start with 20060000.
--
-- Actors (seeded team `storybook`: owner@ is an owner, member@ a member)
--   owner    creates project P, so add_project_owner makes them its project owner
--   e6_pm    team member, project member: opens the sessions
--   e6_view  team member, project viewer
--   member   team member, not on project_members
--   e6_out   a stranger with a team of one

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('e6_pm', 'e6-pm@storybook.dev');
select tests.create_supabase_user('e6_view', 'e6-view@storybook.dev');
select tests.create_supabase_user('e6_out', 'e6-out@storybook.dev');

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

-- ------------------------------------------------------------------
-- Fixtures, written as postgres
-- ------------------------------------------------------------------
select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('e6.team', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.accounts_memberships (user_id, account_id, account_role) values
  (tests.get_supabase_uid('e6_pm'), current_setting('e6.team')::uuid, 'member'),
  (tests.get_supabase_uid('e6_view'), current_setting('e6.team')::uuid, 'member');

-- inserted while signed in as owner@, so add_project_owner makes them
-- the project's owner
insert into public.projects (id, account_id, name, status) values
  ('20060000-0000-4000-8000-000000000001', current_setting('e6.team')::uuid, 'FILM-2006 record', 'active');

set local role postgres;
insert into public.project_members (project_id, user_id, role) values
  ('20060000-0000-4000-8000-000000000001', tests.get_supabase_uid('e6_pm'), 'member'),
  ('20060000-0000-4000-8000-000000000001', tests.get_supabase_uid('e6_view'), 'viewer');

insert into public.episodes (id, project_id, number, title, status) values
  ('20060000-0000-4000-8000-000000000011', '20060000-0000-4000-8000-000000000001', 1, 'Published after a delivery', 'published');

-- e6_pm's device
insert into public.mcp_connections (id, user_id, account_id, kind, name, scopes) values
  ('20060000-0000-4000-8000-0000000000c1', tests.get_supabase_uid('e6_pm'),
   current_setting('e6.team')::uuid, 'pat', 'Studio on e6''s MacBook', array['studio:write']);

-- the episode's earlier session, delivered (FILM-2003 sets ready; the
-- publish flow then published it)
insert into public.edit_sessions (id, episode_id, user_id, connection_id, package_etag, status,
  previous_status, started_at, closed_at, delivered_at, close_reason, summary) values
  ('20060000-0000-4000-8000-0000000000d1', '20060000-0000-4000-8000-000000000011',
   tests.get_supabase_uid('e6_pm'), '20060000-0000-4000-8000-0000000000c1', 'v1-abc', 'delivered',
   'ready', now() - interval '3 days', now() - interval '2 days', now() - interval '2 days',
   'delivered', '{"versions": 2}');

select makerkit.authenticate_as('e6_out');
set local role postgres;
select pg_temp.solo_team('e6_out');

-- ------------------------------------------------------------------
-- Re-open after a published delivery (AC3)
-- ------------------------------------------------------------------
select makerkit.authenticate_as('e6_pm');
select is(
  public.open_edit_session('20060000-0000-4000-8000-000000000011', 'v2-def',
    '20060000-0000-4000-8000-0000000000c1')->>'previousStatus',
  'published',
  'R1 the next session after a published delivery records previousStatus = published');

set local role postgres;
select is(
  (select status from public.episodes where id = '20060000-0000-4000-8000-000000000011'),
  'editing', 'R2 the episode is editing again');
select set_config('e6.open',
  (select id::text from public.edit_sessions
    where episode_id = '20060000-0000-4000-8000-000000000011' and status = 'open'), true);
select is(
  (select previous_status from public.edit_sessions where id = current_setting('e6.open')::uuid),
  'published', 'R3 the open row stores previous_status = published');

-- ------------------------------------------------------------------
-- The open session's device (edit_session_device)
-- ------------------------------------------------------------------
select makerkit.authenticate_as('owner');
select is(public.edit_session_device(current_setting('e6.open')::uuid),
  'Studio on e6''s MacBook',
  'D1 the project owner sees the device of a teammate''s session');

select makerkit.authenticate_as('e6_view');
select is(public.edit_session_device(current_setting('e6.open')::uuid),
  'Studio on e6''s MacBook', 'D2 a project viewer sees it too, as they see the session');

select makerkit.authenticate_as('member');
select is(public.edit_session_device(current_setting('e6.open')::uuid), null,
  'D3 a team member who is not on the project sees nothing');

select makerkit.authenticate_as('e6_out');
select is(public.edit_session_device(current_setting('e6.open')::uuid), null,
  'D4 a stranger sees nothing');

select makerkit.authenticate_as('owner');
select is(public.edit_session_device('00000000-0000-4000-8000-000000000999'), null,
  'D5 an unknown session is null, not an error');

select ok(
  not has_function_privilege('anon', 'public.edit_session_device(uuid)', 'EXECUTE'),
  'D6 anon cannot call it');

-- ------------------------------------------------------------------
-- Force-close from the web (AC2): close_edit_session(..., 'admin')
-- ------------------------------------------------------------------
select makerkit.authenticate_as('e6_view');
select is(
  public.close_edit_session(current_setting('e6.open')::uuid, '{}'::jsonb, 'admin')->>'code',
  'FORBIDDEN', 'F1 a project viewer cannot force-close');

select makerkit.authenticate_as('member');
select is(
  public.close_edit_session(current_setting('e6.open')::uuid, '{}'::jsonb, 'admin')->>'code',
  'NOT_FOUND', 'F2 a team member who is not on the project is told it does not exist');

-- e6_pm is a project member: the session is theirs, but 'admin' is not
select makerkit.authenticate_as('e6_pm');
select is(
  public.close_edit_session(current_setting('e6.open')::uuid, '{}'::jsonb, 'admin')->>'code',
  'FORBIDDEN', 'F3 a project member cannot force-close, even their own session, as admin');

select makerkit.authenticate_as('owner');
select is(
  public.close_edit_session(current_setting('e6.open')::uuid, '{"versions": 0}'::jsonb, 'admin')->>'restoredStatus',
  'published', 'F4 the project owner force-closes and the previous status comes back');

set local role postgres;
select is(
  (select status || '/' || close_reason from public.edit_sessions where id = current_setting('e6.open')::uuid),
  'closed/admin', 'F5 the session is closed with reason admin');
select is(
  (select status from public.episodes where id = '20060000-0000-4000-8000-000000000011'),
  'published', 'F6 the episode is published again');

-- ------------------------------------------------------------------
-- The Studio delivery panel (AC6)
-- ------------------------------------------------------------------
-- Tool calls. In the 7-day window: get_edit_package ok x2 and one
-- RATE_LIMITED (3), deliver_edit ok x1 and TARGET_CHANGED now and 2 days ago (3), and one
-- get_edit_package 30 days ago, outside it.
insert into public.mcp_tool_calls (account_id, tool, status, error_code, duration_ms, created_at) values
  (current_setting('e6.team')::uuid, 'get_edit_package', 'ok', null, 40, now()),
  (current_setting('e6.team')::uuid, 'get_edit_package', 'ok', null, 50, now()),
  (current_setting('e6.team')::uuid, 'get_edit_package', 'error', 'RATE_LIMITED', 1, now()),
  (current_setting('e6.team')::uuid, 'deliver_edit', 'ok', null, 900, now()),
  (current_setting('e6.team')::uuid, 'deliver_edit', 'error', 'TARGET_CHANGED', 30, now()),
  (current_setting('e6.team')::uuid, 'deliver_edit', 'error', 'TARGET_CHANGED', 31, now() - interval '2 days'),
  (current_setting('e6.team')::uuid, 'get_edit_package', 'ok', null, 40, now() - interval '30 days');

-- Renders: one uploading for 25 hours, one for 1 hour.
insert into public.episode_renders (id, episode_id, edit_session_id, preset, aspect, file_path, status, created_at) values
  ('20060000-0000-4000-8000-0000000000e1', '20060000-0000-4000-8000-000000000011',
   current_setting('e6.open')::uuid, 'youtube_16x9', '16:9',
   'projects/20060000-0000-4000-8000-000000000001/episodes/20060000-0000-4000-8000-000000000011/renders/20060000-0000-4000-8000-0000000000e1.mp4',
   'uploading', now() - interval '25 hours'),
  ('20060000-0000-4000-8000-0000000000e2', '20060000-0000-4000-8000-000000000011',
   current_setting('e6.open')::uuid, 'shorts_9x16', '9:16',
   'projects/20060000-0000-4000-8000-000000000001/episodes/20060000-0000-4000-8000-000000000011/renders/20060000-0000-4000-8000-0000000000e2.mp4',
   'uploading', now() - interval '1 hour');

select ok(
  not has_function_privilege('anon', 'public.admin_studio_delivery_stats(integer)', 'EXECUTE'),
  'P1 anon cannot read the panel');

select makerkit.authenticate_as('owner');
select throws_ok(
  $$ select * from public.admin_studio_delivery_stats(7) $$,
  '42501', 'refused: MCP monitoring is for super admins',
  'P2 a team owner is refused the panel');

select makerkit.authenticate_as('owner');
select makerkit.set_session_aal('aal2');
select makerkit.set_super_admin();

-- before the sweep: 3 get_edit_package, 3 deliver_edit, 2 TARGET_CHANGED,
-- 1 render uploading for over 24 h, none expired yet
select results_eq(
  $$ select get_edit_package_calls, deliver_edit_calls, target_changed_refusals,
            uploading_over_24h, expired_uploads
       from public.admin_studio_delivery_stats(7) $$,
  $$ values (3::bigint, 3::bigint, 2::bigint, 1::bigint, 0::bigint) $$,
  'P3 a super admin reads the counts, by hand: 3, 3, 2, 1, 0');

-- a one-day window drops the TARGET_CHANGED from two days ago
select results_eq(
  $$ select target_changed_refusals from public.admin_studio_delivery_stats(1) $$,
  $$ values (1::bigint) $$,
  'P4 the window bounds the tool counts');

-- FILM-2003's hourly sweep fails the 25-hour upload
set local role service_role;
select is(public.expire_stale_render_uploads(), 1, 'P5 the sweep fails one stale upload');

select makerkit.authenticate_as('owner');
select makerkit.set_session_aal('aal2');
select makerkit.set_super_admin();
select results_eq(
  $$ select uploading_over_24h, expired_uploads from public.admin_studio_delivery_stats(7) $$,
  $$ values (0::bigint, 1::bigint) $$,
  'P6 after the sweep the stale upload is counted as expired, not as uploading');

select * from finish();

rollback;
