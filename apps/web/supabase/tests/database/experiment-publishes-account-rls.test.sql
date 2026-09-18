begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(5);

-- FILM-1610 review (B5). `experiment_publishes_create` checked access to the
-- experiment only, so any publish the caller could see could be linked to it
-- — including one from another account. The action now refuses that, but
-- PostgREST is reachable directly, so the table has to refuse it too (the
-- rule FILM-1608 set for channel_analytics_settings).
--
-- The case that matters is a user who belongs to *both* accounts: RLS lets
-- them see both publishes, so only the policy can tell the two apart.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('other_owner', 'other-owner@storybook.dev');
select makerkit.authenticate_as('other_owner');
select public.create_team_account('Other Co');

set local role postgres;

select set_config('ep.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('ep.other', makerkit.get_account_id_by_slug('other-co')::text, true);

-- `member` belongs to both teams.
insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('member'), current_setting('ep.other')::uuid, 'member');

-- One project, episode and publish per account. Projects are created by
-- their owners so the creator trigger has an auth.uid().
select makerkit.authenticate_as('primary_owner');
insert into public.projects (id, account_id, name, status)
  values ('f1f1f1f1-0000-4000-8000-000000000001', current_setting('ep.story')::uuid, 'Story project', 'active');

select makerkit.authenticate_as('other_owner');
insert into public.projects (id, account_id, name, status)
  values ('f1f1f1f1-0000-4000-8000-000000000002', current_setting('ep.other')::uuid, 'Other project', 'active');

set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
  values ('f1f1f1f1-0000-4000-8000-000000000011', 'f1f1f1f1-0000-4000-8000-000000000001', 1, 'S1', 'draft'),
         ('f1f1f1f1-0000-4000-8000-000000000012', 'f1f1f1f1-0000-4000-8000-000000000002', 1, 'O1', 'draft');

insert into public.publishes (id, episode_id, platform, content_type, status)
  values ('f1f1f1f1-0000-4000-8000-000000000021', 'f1f1f1f1-0000-4000-8000-000000000011', 'youtube', 'full', 'published'),
         ('f1f1f1f1-0000-4000-8000-000000000022', 'f1f1f1f1-0000-4000-8000-000000000012', 'youtube', 'full', 'published');

insert into public.analytics_experiments (id, account_id, title, change_description)
  values ('f1f1f1f1-0000-4000-8000-000000000031', current_setting('ep.story')::uuid, 'Story experiment', 'x');

select makerkit.authenticate_as('member');

select results_eq(
  $$ select count(*)::int from public.publishes
      where id in ('f1f1f1f1-0000-4000-8000-000000000021',
                   'f1f1f1f1-0000-4000-8000-000000000022') $$,
  array[2],
  'The member can see both publishes, so only the policy can refuse the foreign one'
);

select lives_ok(
  $$ insert into public.experiment_publishes (experiment_id, publish_id)
     values ('f1f1f1f1-0000-4000-8000-000000000031', 'f1f1f1f1-0000-4000-8000-000000000021') $$,
  'A publish from the experiment''s own account can be linked'
);

select throws_ok(
  $$ insert into public.experiment_publishes (experiment_id, publish_id)
     values ('f1f1f1f1-0000-4000-8000-000000000031', 'f1f1f1f1-0000-4000-8000-000000000022') $$,
  '42501',
  null,
  'A publish from another account cannot be linked, even by someone in both'
);

select results_eq(
  $$ select publish_id from public.experiment_publishes
      where experiment_id = 'f1f1f1f1-0000-4000-8000-000000000031' $$,
  array['f1f1f1f1-0000-4000-8000-000000000021'::uuid],
  'Only the own-account link exists'
);

-- An outsider to the experiment's account still cannot link anything.
select tests.create_supabase_user('stranger', 'stranger@storybook.dev');
select makerkit.authenticate_as('stranger');

select throws_ok(
  $$ insert into public.experiment_publishes (experiment_id, publish_id)
     values ('f1f1f1f1-0000-4000-8000-000000000031', 'f1f1f1f1-0000-4000-8000-000000000021') $$,
  '42501',
  null,
  'Someone outside the account cannot link to its experiment'
);

select * from finish();

rollback;
