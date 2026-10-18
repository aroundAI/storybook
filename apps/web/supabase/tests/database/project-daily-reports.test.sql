begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(14);

-- FILM-1735. A project's morning report, one per project and day. The team
-- reads its reports; a member saves one for the team's own project, as
-- themself; nobody on the team rewrites or deletes one.
--
-- Foreign ids are stashed with set_config while still postgres, because
-- makerkit.get_account_id_by_slug answers NULL for an account the caller
-- cannot see (revenue-records-rls.test.sql).

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('dr_outsider', 'dr-outsider@storybook.dev');
select makerkit.authenticate_as('dr_outsider');
select public.create_team_account('Reports Other Co');

set local role postgres;

select set_config('dr.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('dr.other', makerkit.get_account_id_by_slug('reports-other-co')::text, true);
select set_config('dr.member', tests.get_supabase_uid('member')::text, true);
select set_config('dr.outsider', tests.get_supabase_uid('dr_outsider')::text, true);

insert into public.projects (id, account_id, name, slug)
values
  ('17350000-0000-4000-8000-0000000000a1', current_setting('dr.story')::uuid, 'Reports probe', 'reports-probe'),
  ('17350000-0000-4000-8000-0000000000a2', current_setting('dr.other')::uuid, 'Other reports probe', 'other-reports-probe');

insert into public.project_daily_reports
  (id, account_id, project_id, report_date, timezone, digest_hash, body_md, model, created_by)
values
  ('17350000-0000-4000-8000-000000000201', current_setting('dr.other')::uuid,
   '17350000-0000-4000-8000-0000000000a2', '2026-10-17', 'UTC', repeat('b', 64),
   'Another team''s report', 'claude-opus-5-5', current_setting('dr.outsider')::uuid);

-- ==================================
-- A member saves and reads
-- ==================================

select makerkit.authenticate_as('member');

select lives_ok(
  $$ insert into public.project_daily_reports
       (id, account_id, project_id, report_date, timezone, digest_hash, body_md, model)
     values ('17350000-0000-4000-8000-000000000101', current_setting('dr.story')::uuid,
             '17350000-0000-4000-8000-0000000000a1', '2026-10-17', 'Asia/Kolkata',
             repeat('a', 64), '# Morning report', 'claude-opus-5-5') $$,
  'a member saves a report for the team''s project'
);

select is(
  (select created_by from public.project_daily_reports
    where id = '17350000-0000-4000-8000-000000000101'),
  current_setting('dr.member')::uuid,
  'the report records who saved it'
);

select throws_ok(
  $$ insert into public.project_daily_reports
       (account_id, project_id, report_date, timezone, digest_hash, body_md, model)
     values (current_setting('dr.story')::uuid, '17350000-0000-4000-8000-0000000000a1',
             '2026-10-17', 'UTC', repeat('c', 64), 'A second text', 'other-model') $$,
  '23505', null,
  'a project''s day has one report: a second save is refused'
);

select results_eq(
  $$ select body_md from public.project_daily_reports order by report_date $$,
  $$ values ('# Morning report'::text) $$,
  'a member reads the team''s reports, and no other team''s'
);

select throws_ok(
  $$ insert into public.project_daily_reports
       (account_id, project_id, report_date, timezone, digest_hash, body_md, model)
     values (current_setting('dr.story')::uuid, '17350000-0000-4000-8000-0000000000a2',
             '2026-10-18', 'UTC', repeat('a', 64), 'Planted', 'm') $$,
  '42501', null,
  'a report cannot name the team and another team''s project'
);

select throws_ok(
  $$ insert into public.project_daily_reports
       (account_id, project_id, report_date, timezone, digest_hash, body_md, model)
     values (current_setting('dr.other')::uuid, '17350000-0000-4000-8000-0000000000a2',
             '2026-10-18', 'UTC', repeat('a', 64), 'Planted', 'm') $$,
  '42501', null,
  'nor be saved into another team'
);

select throws_ok(
  $$ insert into public.project_daily_reports
       (account_id, project_id, report_date, timezone, digest_hash, body_md, model, created_by)
     values (current_setting('dr.story')::uuid, '17350000-0000-4000-8000-0000000000a1',
             '2026-10-19', 'UTC', repeat('a', 64), 'In someone else''s name', 'm',
             current_setting('dr.outsider')::uuid) $$,
  '42501', null,
  'nor in someone else''s name'
);

select throws_ok(
  $$ update public.project_daily_reports set body_md = 'Rewritten' $$,
  '42501', null,
  'nobody on the team rewrites a saved report'
);

select throws_ok(
  $$ delete from public.project_daily_reports $$,
  '42501', null,
  'nor deletes one'
);

-- ==================================
-- What a report may hold
-- ==================================

set local role postgres;

select throws_ok(
  $$ insert into public.project_daily_reports
       (account_id, project_id, report_date, timezone, digest_hash, body_md, model)
     values (current_setting('dr.story')::uuid, '17350000-0000-4000-8000-0000000000a1',
             '2026-10-20', 'UTC', repeat('a', 64), repeat('x', 40001), 'm') $$,
  '23514', null,
  'a report is at most 40,000 characters'
);

select throws_ok(
  $$ insert into public.project_daily_reports
       (account_id, project_id, report_date, timezone, digest_hash, body_md, model)
     values (current_setting('dr.story')::uuid, '17350000-0000-4000-8000-0000000000a1',
             '2026-10-20', 'UTC', 'not-a-hash', 'Text', 'm') $$,
  '23514', null,
  'the digest hash is a sha256'
);

select throws_ok(
  $$ insert into public.project_daily_reports
       (account_id, project_id, report_date, timezone, digest_hash, body_md, model)
     values (current_setting('dr.story')::uuid, '17350000-0000-4000-8000-0000000000a1',
             '2026-10-20', 'Asia/Kolkata; drop', repeat('a', 64), 'Text', 'm') $$,
  '23514', null,
  'the timezone is a zone name'
);

-- ==================================
-- KB-99: a team account's table
-- ==================================

-- As the service role, which RLS does not stop: the rule still does
set local role service_role;

select throws_ok(
  $$ insert into public.project_daily_reports
       (account_id, project_id, report_date, timezone, digest_hash, body_md, model)
     values (current_setting('dr.outsider')::uuid, '17350000-0000-4000-8000-0000000000a1',
             '2026-10-21', 'UTC', repeat('a', 64), 'Text', 'm') $$,
  '23514', null,
  'a report cannot sit on a personal account'
);

select results_eq(
  $$ select count(*)::int from public.project_daily_reports
      where id = '17350000-0000-4000-8000-000000000101' and body_md = '# Morning report' $$,
  $$ values (1) $$,
  'the saved report is unchanged after the refused rewrite and delete'
);

select * from finish();
rollback;
