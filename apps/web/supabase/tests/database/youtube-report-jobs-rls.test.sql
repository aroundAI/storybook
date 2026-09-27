begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- A fixed count rather than no_plan(): a file that aborts partway reports a
-- plan mismatch instead of a nearly-passing suite.
select plan(18);

-- KB-99: the product is team accounts only; someone working alone is a team
-- of one. A fixture that used to sit on a user's personal account sits on a
-- team that user owns instead, with the owner membership a team always has.
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

-- KB-51. `youtube_report_jobs` is the YouTube Reporting API job registry, one
-- row per (connection, report type), with the ingest's watermark and last
-- error (FILM-1504). Only the service role writes it — the report-ingest
-- cron. Signed-in users may read the jobs of connections on accounts they can
-- access (`has_account_access`: owner or member, so a personal account's
-- owner, who has no membership row, reads their own). Nothing else.
--
-- Its migration revoked from `authenticated` and `service_role` and never
-- from `anon`, which kept Supabase's default grant of every privilege —
-- TRUNCATE included, which row-level security does not govern. Today only
-- the missing USAGE on schema `public` (revoked in the base schema) stands in
-- front of those grants, and KB-88 proposes restoring that USAGE so public
-- share pages work for logged-out visitors. KB-85 is the class; this table is
-- fixed with its test.
--
-- Account ids are stashed with set_config while still postgres:
-- `makerkit.get_account_id_by_slug` runs under the caller's RLS and would
-- return NULL for an account the caller cannot see.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('kb51_solo', 'kb51-solo@storybook.dev');
select tests.create_supabase_user('kb51_outsider', 'kb51-outsider@storybook.dev');

select set_config('kb51.team', makerkit.get_account_id_by_slug('storybook')::text, true);
-- kb51_solo works alone: a team of one (KB-99).
select set_config('kb51.solo', pg_temp.solo_team('kb51_solo')::text, true);

-- Written as postgres, the way the service role writes them.
insert into public.platform_connections (id, account_id, platform, platform_account_name)
values
  ('51000000-0000-4000-8000-00000000000a', current_setting('kb51.team')::uuid, 'youtube', 'Team Channel'),
  ('51000000-0000-4000-8000-00000000000b', current_setting('kb51.solo')::uuid, 'youtube', 'Solo Channel');

insert into public.youtube_report_jobs (id, platform_connection_id, report_type_id, youtube_job_id)
values
  ('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-00000000000a', 'channel_basic_a3', 'job-team'),
  ('51000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-00000000000b', 'channel_basic_a3', 'job-solo');

-- ==================================
-- Shape: one read policy, to authenticated; writes are the service role's
-- ==================================

select policies_are(
  'public', 'youtube_report_jobs', array['youtube_report_jobs_read'],
  'youtube_report_jobs has exactly one policy, and it is the read policy'
);

select policy_roles_are(
  'public', 'youtube_report_jobs', 'youtube_report_jobs_read', array['authenticated'],
  'The read policy applies to authenticated only'
);

select policy_cmd_is(
  'public', 'youtube_report_jobs', 'youtube_report_jobs_read', 'select',
  'The only policy is a SELECT policy'
);

select table_privs_are(
  'public', 'youtube_report_jobs', 'authenticated', array['SELECT'],
  'authenticated may only SELECT youtube_report_jobs'
);

select table_privs_are(
  'public', 'youtube_report_jobs', 'anon', array[]::text[],
  'anon holds no privilege on youtube_report_jobs (KB-51)'
);

select table_privs_are(
  'public', 'youtube_report_jobs', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role, which the report-ingest cron runs as, may read and write'
);

-- ==================================
-- Reads
-- ==================================

select makerkit.authenticate_as('kb51_solo');

select is(
  (select count(*)::int from public.youtube_report_jobs
   where id = '51000000-0000-4000-8000-000000000002'),
  1,
  'A team-of-one owner reads their own connection''s jobs'
);

select is(
  (select count(*)::int from public.youtube_report_jobs
   where id = '51000000-0000-4000-8000-000000000001'),
  0,
  'A team-of-one owner does not read a team''s jobs they do not belong to'
);

select makerkit.authenticate_as('member');

select is(
  (select count(*)::int from public.youtube_report_jobs
   where id = '51000000-0000-4000-8000-000000000001'),
  1,
  'A team member reads the team connection''s jobs'
);

select makerkit.authenticate_as('primary_owner');

select is(
  (select count(*)::int from public.youtube_report_jobs
   where id = '51000000-0000-4000-8000-000000000001'),
  1,
  'The team''s owner reads the team connection''s jobs'
);

select makerkit.authenticate_as('kb51_outsider');

select is(
  (select count(*)::int from public.youtube_report_jobs
   where id in ('51000000-0000-4000-8000-000000000001',
                '51000000-0000-4000-8000-000000000002')),
  0,
  'A signed-in user with no access reads no other account''s jobs'
);

-- ==================================
-- Writes: refused for every signed-in user, own account or not
-- ==================================

select throws_ok(
  $$ insert into public.youtube_report_jobs (platform_connection_id, report_type_id, youtube_job_id)
     values ('51000000-0000-4000-8000-00000000000b', 'channel_reach_combined_a1', 'forged') $$,
  '42501', 'permission denied for table youtube_report_jobs',
  'An outsider cannot register a job on another account''s connection'
);

select makerkit.authenticate_as('member');

-- The watermark is what decides which reports are skipped. A client that
-- could move it forward would make the ingest silently skip real data.
select throws_ok(
  $$ update public.youtube_report_jobs set last_report_created_after = now() + interval '1 year'
     where id = '51000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table youtube_report_jobs',
  'A member cannot move their own team''s watermark'
);

select throws_ok(
  $$ delete from public.youtube_report_jobs
     where id = '51000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table youtube_report_jobs',
  'A member cannot delete their own team''s job'
);

select makerkit.authenticate_as('kb51_solo');

select throws_ok(
  $$ insert into public.youtube_report_jobs (platform_connection_id, report_type_id, youtube_job_id)
     values ('51000000-0000-4000-8000-00000000000b', 'channel_reach_combined_a1', 'session-writer') $$,
  '42501', 'permission denied for table youtube_report_jobs',
  'An owner cannot write jobs through their own session, even on their own connection'
);

-- The anon cases must test the table grant, not the schema barrier in front
-- of it: without USAGE every anon statement fails with 42501 anyway, and they
-- would pass whatever the table grants. Granted inside this rolled-back
-- transaction only — the state KB-88's fix would leave.
set local role postgres;
grant usage on schema public to anon;

set local role anon;

select throws_ok(
  $$ select count(*) from public.youtube_report_jobs $$,
  '42501', 'permission denied for table youtube_report_jobs',
  'anon cannot read youtube_report_jobs, even with USAGE on the schema'
);

-- Row-level security does not apply to TRUNCATE: with the old grant and
-- USAGE on the schema, this empties the table for every account.
select throws_ok(
  $$ truncate public.youtube_report_jobs cascade $$,
  '42501', 'permission denied for table youtube_report_jobs',
  'anon cannot truncate youtube_report_jobs (KB-51)'
);

set local role postgres;

select is(
  (select count(*)::int from public.youtube_report_jobs
   where id in ('51000000-0000-4000-8000-000000000001',
                '51000000-0000-4000-8000-000000000002')
     and youtube_job_id in ('job-team', 'job-solo')
     and last_report_created_after is null),
  2,
  'Every refused write left the jobs as they were'
);

select * from finish();

rollback;
