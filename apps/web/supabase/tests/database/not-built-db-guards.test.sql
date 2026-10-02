begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(14);

-- FILM-101e, FILM-101h, FILM-809, FILM-808, FILM-1003. Fixture ids start
-- with 9a1d.

select tests.create_supabase_user('nb_owner', 'nb-owner@storybook.dev');
select tests.create_supabase_user('nb_stranger', 'nb-stranger@storybook.dev');

set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('9a1d0000-0000-4000-8000-00000000000a', 'Not built team', false, tests.get_supabase_uid('nb_owner'));
insert into public.accounts_memberships (user_id, account_id, account_role)
values (tests.get_supabase_uid('nb_owner'), '9a1d0000-0000-4000-8000-00000000000a', 'owner')
on conflict do nothing;

select makerkit.authenticate_as('nb_owner');
insert into public.projects (id, account_id, name, status)
values ('9a1d0000-0000-4000-8000-000000000001', '9a1d0000-0000-4000-8000-00000000000a', 'NB', 'active');
set local role postgres;
insert into public.assets (id, project_id, type, name) values
  ('9a1d0000-0000-4000-8000-0000000000c1', '9a1d0000-0000-4000-8000-000000000001', 'character', 'Hero'),
  ('9a1d0000-0000-4000-8000-0000000000c2', '9a1d0000-0000-4000-8000-000000000001', 'location', 'Cave');

-- FILM-101e
select lives_ok(
  $$ insert into public.character_details (asset_id) values ('9a1d0000-0000-4000-8000-0000000000c1') $$,
  'character_details accepts an asset of type character'
);
select throws_ok(
  $$ insert into public.character_details (asset_id) values ('9a1d0000-0000-4000-8000-0000000000c2') $$,
  '23514', null,
  'character_details refuses a location asset'
);
select throws_ok(
  $$ update public.character_details set asset_id = '9a1d0000-0000-4000-8000-0000000000c2'
      where asset_id = '9a1d0000-0000-4000-8000-0000000000c1' $$,
  '23514', null,
  'and refuses to be repointed at one'
);

-- FILM-101h
insert into public.episodes (id, project_id, number, title)
values ('9a1d0000-0000-4000-8000-0000000000e1', '9a1d0000-0000-4000-8000-000000000001', 1, 'Ep');

select throws_ok(
  $$ insert into public.audio_tracks (episode_id, type, duration_seconds)
     values ('9a1d0000-0000-4000-8000-0000000000e1', 'music', 0) $$,
  '23514', null,
  'a zero-duration track is refused'
);
select lives_ok(
  $$ insert into public.audio_tracks (episode_id, type, duration_seconds)
     values ('9a1d0000-0000-4000-8000-0000000000e1', 'music', 12.5),
            ('9a1d0000-0000-4000-8000-0000000000e1', 'sfx', null) $$,
  'a positive duration and an unknown (null) one are both accepted'
);

-- FILM-809
select makerkit.authenticate_as('nb_owner');
select lives_ok(
  $$ insert into public.generated_reports
       (account_id, report_type, file_name, storage_path, date_range_start, date_range_end, record_count, created_by)
     values ('9a1d0000-0000-4000-8000-00000000000a', 'pdf', 'r.pdf', 'exports/x/r.pdf',
             '2026-09-01', '2026-09-30', 3, tests.get_supabase_uid('nb_owner')) $$,
  'a team member records a generated report'
);
select is(
  (select count(*)::int from public.generated_reports), 1,
  'and reads it back'
);

select makerkit.authenticate_as('nb_stranger');
select is(
  (select count(*)::int from public.generated_reports), 0,
  'a stranger reads no report of another team'
);
select throws_ok(
  $$ insert into public.generated_reports
       (account_id, report_type, file_name, storage_path, date_range_start, date_range_end, record_count)
     values ('9a1d0000-0000-4000-8000-00000000000a', 'pdf', 'x.pdf', 'exports/x/x.pdf',
             '2026-09-01', '2026-09-30', 1) $$,
  '42501', null,
  'and cannot write one into it'
);

-- FILM-808: no client role writes the cache. FILM-1906 granted members
-- SELECT so get_saved_insights can read it under RLS; the write grants stay
-- with the service role (analytics-insights-cache-rls.test.sql has the rest).
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'analytics_insights_cache'
      and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'),
  0,
  'the insights cache is written by the service role only'
);

-- FILM-1003
set local role postgres;
insert into public.validation_runs (project_id, episode_number, checkpoint, enforcement, passed, summary)
values ('9a1d0000-0000-4000-8000-000000000001', 1, 'STORY', 'strict', false, '{"errors": 1}'::jsonb);

select makerkit.authenticate_as('nb_owner');
select is(
  (select count(*)::int from public.validation_runs), 1,
  'a team member reads their project''s validation runs'
);
select throws_ok(
  $$ insert into public.validation_runs (project_id, checkpoint, enforcement, passed, summary)
     values ('9a1d0000-0000-4000-8000-000000000001', 'STORY', 'strict', true, '{}'::jsonb) $$,
  '42501', null,
  'but cannot write one from the client'
);

select makerkit.authenticate_as('nb_stranger');
select is(
  (select count(*)::int from public.validation_runs), 0,
  'a stranger reads none'
);

-- KB-99: generated_reports is team-only like every account-keyed table
set local role postgres;
select throws_ok(
  format($$ insert into public.generated_reports
      (account_id, report_type, file_name, storage_path, date_range_start, date_range_end, record_count)
    values (%L, 'csv', 'r.csv', 'p/r.csv', '2026-01-01', '2026-01-31', 0) $$,
    tests.get_supabase_uid('nb_owner')),
  '23514', null,
  'generated_reports refuses a row on a personal account'
);

select * from finish();
rollback;
