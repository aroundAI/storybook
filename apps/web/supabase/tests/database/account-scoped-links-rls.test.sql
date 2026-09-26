begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(15);

-- KB-113. The rest of KB-98's class: a row naming another account's
-- publish, episode or project, and a row moved into another account.
-- Reproduced through RLS on 2026-09-25. `member` belongs to both accounts
-- and has a role in both projects, so RLS lets every write through and only
-- these rules can refuse it.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('al_other_owner', 'al-other-owner@storybook.dev');
select makerkit.authenticate_as('al_other_owner');
select public.create_team_account('AL Other Co');

select makerkit.authenticate_as('primary_owner');
set local role postgres;

select set_config('al.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('al.other', makerkit.get_account_id_by_slug('al-other-co')::text, true);

insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('member'), current_setting('al.other')::uuid, 'member');

insert into public.projects (id, account_id, name, slug)
  values ('b1b1b1b1-0000-4000-8000-000000000011', current_setting('al.story')::uuid, 'Links own', 'links-own'),
         ('b1b1b1b1-0000-4000-8000-000000000021', current_setting('al.story')::uuid, 'Links own 2', 'links-own-2'),
         ('b1b1b1b1-0000-4000-8000-000000000031', current_setting('al.other')::uuid, 'Links other', 'links-other');
insert into public.project_members (project_id, user_id, role)
  values ('b1b1b1b1-0000-4000-8000-000000000011', tests.get_supabase_uid('member'), 'admin'),
         ('b1b1b1b1-0000-4000-8000-000000000021', tests.get_supabase_uid('member'), 'member'),
         ('b1b1b1b1-0000-4000-8000-000000000031', tests.get_supabase_uid('member'), 'member');
insert into public.episodes (id, project_id, number, title)
  values ('b1b1b1b1-0000-4000-8000-000000000012', 'b1b1b1b1-0000-4000-8000-000000000011', 1, 'Own'),
         ('b1b1b1b1-0000-4000-8000-000000000022', 'b1b1b1b1-0000-4000-8000-000000000021', 1, 'Own 2'),
         ('b1b1b1b1-0000-4000-8000-000000000032', 'b1b1b1b1-0000-4000-8000-000000000031', 1, 'Other');
insert into public.publishes (id, episode_id, platform, status)
  values ('b1b1b1b1-0000-4000-8000-000000000013', 'b1b1b1b1-0000-4000-8000-000000000012', 'youtube', 'draft'),
         ('b1b1b1b1-0000-4000-8000-000000000033', 'b1b1b1b1-0000-4000-8000-000000000032', 'youtube', 'draft');
insert into public.manual_tasks (id, account_id, task_type, title, publish_id, episode_id)
  values ('b1b1b1b1-0000-4000-8000-000000000014', current_setting('al.story')::uuid, 'other', 'Own task',
          'b1b1b1b1-0000-4000-8000-000000000013', 'b1b1b1b1-0000-4000-8000-000000000012');
insert into public.analytics_experiments (id, account_id, title, change_description, project_id)
  values ('b1b1b1b1-0000-4000-8000-000000000015', current_setting('al.story')::uuid, 'Own change', 'x',
          'b1b1b1b1-0000-4000-8000-000000000011');

select makerkit.authenticate_as('member');

select results_eq(
  $$ select count(*)::int from public.projects
      where id in ('b1b1b1b1-0000-4000-8000-000000000011', 'b1b1b1b1-0000-4000-8000-000000000031') $$,
  array[2],
  'The member can see both projects, so only the rules can refuse'
);

-- manual_tasks
select lives_ok(
  $$ insert into public.manual_tasks (account_id, task_type, title, publish_id, episode_id)
     values (current_setting('al.story')::uuid, 'other', 't',
             'b1b1b1b1-0000-4000-8000-000000000013', 'b1b1b1b1-0000-4000-8000-000000000012') $$,
  'A task may name its own account''s video and episode'
);

select throws_ok(
  $$ insert into public.manual_tasks (account_id, task_type, title, publish_id)
     values (current_setting('al.story')::uuid, 'other', 't', 'b1b1b1b1-0000-4000-8000-000000000033') $$,
  '42501',
  null,
  'A task cannot name another account''s video'
);

select throws_ok(
  $$ insert into public.manual_tasks (account_id, task_type, title, episode_id)
     values (current_setting('al.story')::uuid, 'other', 't', 'b1b1b1b1-0000-4000-8000-000000000032') $$,
  '42501',
  null,
  'A task cannot name another account''s episode'
);

select throws_ok(
  $$ update public.manual_tasks
        set publish_id = 'b1b1b1b1-0000-4000-8000-000000000033'
      where id = 'b1b1b1b1-0000-4000-8000-000000000014' $$,
  '42501',
  null,
  'A task cannot be repointed at another account''s video'
);

-- analytics_experiments
select lives_ok(
  $$ insert into public.analytics_experiments (account_id, title, change_description, project_id)
     values (current_setting('al.story')::uuid, 'c', 'x', 'b1b1b1b1-0000-4000-8000-000000000021') $$,
  'A change may name its own account''s project'
);

select throws_ok(
  $$ insert into public.analytics_experiments (account_id, title, change_description, project_id)
     values (current_setting('al.story')::uuid, 'c', 'x', 'b1b1b1b1-0000-4000-8000-000000000031') $$,
  '42501',
  null,
  'A change cannot name another account''s project'
);

select throws_ok(
  $$ update public.analytics_experiments
        set project_id = 'b1b1b1b1-0000-4000-8000-000000000031'
      where id = 'b1b1b1b1-0000-4000-8000-000000000015' $$,
  '42501',
  null,
  'A change cannot be repointed at another account''s project'
);

select throws_ok(
  $$ update public.analytics_experiments
        set account_id = current_setting('al.other')::uuid, project_id = null
      where id = 'b1b1b1b1-0000-4000-8000-000000000015' $$,
  '42501',
  null,
  'A change cannot move to another account, leaving its links behind'
);

-- moving rows between accounts
select throws_ok(
  $$ update public.projects set account_id = current_setting('al.other')::uuid
      where id = 'b1b1b1b1-0000-4000-8000-000000000011' $$,
  '42501',
  null,
  'A project cannot move to another account, taking its videos with it'
);

select throws_ok(
  $$ update public.publishes set episode_id = 'b1b1b1b1-0000-4000-8000-000000000032'
      where id = 'b1b1b1b1-0000-4000-8000-000000000013' $$,
  '42501',
  null,
  'A publish cannot move to another account''s episode'
);

select throws_ok(
  $$ update public.episodes set project_id = 'b1b1b1b1-0000-4000-8000-000000000031'
      where id = 'b1b1b1b1-0000-4000-8000-000000000012' $$,
  '42501',
  null,
  'An episode cannot move to another account''s project'
);

select lives_ok(
  $$ update public.publishes set episode_id = 'b1b1b1b1-0000-4000-8000-000000000022'
      where id = 'b1b1b1b1-0000-4000-8000-000000000013' $$,
  'A publish can move to another episode of the same account'
);

select lives_ok(
  $$ update public.episodes set project_id = 'b1b1b1b1-0000-4000-8000-000000000021'
      where id = 'b1b1b1b1-0000-4000-8000-000000000012' $$,
  'An episode can move to another project of the same account'
);

select lives_ok(
  $$ update public.projects set name = 'Links own, renamed'
      where id = 'b1b1b1b1-0000-4000-8000-000000000011' $$,
  'A project can still be edited'
);

select * from finish();

rollback;
