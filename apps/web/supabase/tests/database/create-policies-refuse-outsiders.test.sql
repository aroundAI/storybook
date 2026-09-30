begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(19);

-- FILM-201, FILM-301, FILM-303, FILM-810, FILM-1507. The insert policies that
-- decide who may create an asset, an episode, a shot, a revenue report or
-- alert, and a content tag: a member of the project or account may, someone
-- outside it may not, and what the outsider tries leaves nothing behind.
-- Fixture ids start with 1a1b.

select tests.create_supabase_user('pol_owner', 'pol-owner@storybook.dev');
select tests.create_supabase_user('pol_stranger', 'pol-stranger@storybook.dev');

select makerkit.authenticate_as('pol_owner');
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('1a1b0000-0000-4000-8000-00000000000a', 'policy team', false, tests.get_supabase_uid('pol_owner'));

-- The creator trigger on `projects` reads auth.uid(), so the owner creates it.
select makerkit.authenticate_as('pol_owner');
insert into public.projects (id, account_id, name, status) values
  ('1a1b0000-0000-4000-8000-000000000001', '1a1b0000-0000-4000-8000-00000000000a', 'policies', 'active');

set local role postgres;
insert into public.episodes (id, project_id, number, title) values
  ('1a1b0000-0000-4000-8000-000000000011', '1a1b0000-0000-4000-8000-000000000001', 1, 'Existing');

-- ---------------------------------------------------------------------------
-- The owner may create each
-- ---------------------------------------------------------------------------
select makerkit.authenticate_as('pol_owner');

select lives_ok(
  $$ insert into public.assets (project_id, type, name)
     values ('1a1b0000-0000-4000-8000-000000000001', 'character', 'Mine') $$,
  'a project member can create an asset (FILM-201)'
);

select lives_ok(
  $$ insert into public.episodes (project_id, number, title)
     values ('1a1b0000-0000-4000-8000-000000000001', 2, 'Second') $$,
  'a project member can create an episode (FILM-301)'
);

select lives_ok(
  $$ insert into public.shots (episode_id, sequence_number, prompt)
     values ('1a1b0000-0000-4000-8000-000000000011', 1, 'mine') $$,
  'a project member can create a shot (FILM-303)'
);

select lives_ok(
  $$ insert into public.revenue_reports (account_id, period_type, start_date, end_date, summary_data)
     values ('1a1b0000-0000-4000-8000-00000000000a', 'custom', '2026-01-01', '2026-01-31', '{}') $$,
  'an account member can create a revenue report (FILM-810)'
);

select lives_ok(
  $$ insert into public.revenue_alerts (account_id, alert_type, title)
     values ('1a1b0000-0000-4000-8000-00000000000a', 'policy_change', 'Mine') $$,
  'an account member can create a revenue alert (FILM-810)'
);

select lives_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values ('1a1b0000-0000-4000-8000-00000000000a', 'topic', 'mine', 'Mine') $$,
  'an account member can create a content tag (FILM-1507)'
);

-- ---------------------------------------------------------------------------
-- Someone outside the project and account may not
-- ---------------------------------------------------------------------------
select makerkit.authenticate_as('pol_stranger');

select throws_ok(
  $$ insert into public.assets (project_id, type, name)
     values ('1a1b0000-0000-4000-8000-000000000001', 'character', 'Theirs') $$,
  '42501', null,
  'an outsider cannot create an asset in the project (FILM-201)'
);

select throws_ok(
  $$ insert into public.episodes (project_id, number, title)
     values ('1a1b0000-0000-4000-8000-000000000001', 3, 'Theirs') $$,
  '42501', null,
  'an outsider cannot create an episode in the project (FILM-301)'
);

select throws_ok(
  $$ insert into public.shots (episode_id, sequence_number, prompt)
     values ('1a1b0000-0000-4000-8000-000000000011', 2, 'theirs') $$,
  '42501', null,
  'an outsider cannot create a shot in the episode (FILM-303)'
);

select throws_ok(
  $$ insert into public.revenue_reports (account_id, period_type, start_date, end_date, summary_data)
     values ('1a1b0000-0000-4000-8000-00000000000a', 'custom', '2026-02-01', '2026-02-28', '{}') $$,
  '42501', null,
  'an outsider cannot create a revenue report on the account (FILM-810)'
);

select throws_ok(
  $$ insert into public.revenue_alerts (account_id, alert_type, title)
     values ('1a1b0000-0000-4000-8000-00000000000a', 'policy_change', 'Theirs') $$,
  '42501', null,
  'an outsider cannot create a revenue alert on the account (FILM-810)'
);

select throws_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values ('1a1b0000-0000-4000-8000-00000000000a', 'topic', 'theirs', 'Theirs') $$,
  '42501', null,
  'an outsider cannot create a content tag on the account (FILM-1507)'
);

-- Reads, updates and deletes see nothing of the account's rows.
select is(
  (select count(*)::int from public.revenue_reports
    where account_id = '1a1b0000-0000-4000-8000-00000000000a'),
  0,
  'an outsider reads none of the account''s revenue reports (FILM-810)'
);

select is(
  (select count(*)::int from public.revenue_alerts
    where account_id = '1a1b0000-0000-4000-8000-00000000000a'),
  0,
  'and none of its revenue alerts (FILM-810)'
);

select is(
  (select count(*)::int from public.content_tags
    where account_id = '1a1b0000-0000-4000-8000-00000000000a'),
  0,
  'and none of its content tags (FILM-1507)'
);

with changed as (
  update public.content_tags set label = 'Hijacked'
   where account_id = '1a1b0000-0000-4000-8000-00000000000a' returning 1
)
select is((select count(*)::int from changed), 0,
  'an outsider''s update of the account''s tags matches no row (FILM-1507)');

with removed as (
  delete from public.content_tags
   where account_id = '1a1b0000-0000-4000-8000-00000000000a' returning 1
)
select is((select count(*)::int from removed), 0,
  'and its delete removes none (FILM-1507)');

-- The tag is unique per (account, dimension, slug), for the owner too.
select makerkit.authenticate_as('pol_owner');

select throws_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values ('1a1b0000-0000-4000-8000-00000000000a', 'topic', 'mine', 'Again') $$,
  '23505', null,
  'a second tag with the same account, dimension and slug is refused (FILM-1507)'
);

-- Nothing the outsider tried was written.
set local role postgres;
select is(
  (select count(*)::int from (
     select 1 from public.assets where name = 'Theirs'
     union all select 1 from public.episodes where title = 'Theirs'
     union all select 1 from public.shots where prompt = 'theirs'
     union all select 1 from public.revenue_alerts where title = 'Theirs'
     union all select 1 from public.content_tags where slug = 'theirs'
   ) x),
  0,
  'none of the outsider''s attempts left a row behind'
);

select * from finish();
rollback;
