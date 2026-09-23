begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(11);

-- KB-41. `get_project_members` is SECURITY DEFINER, so row-level security
-- does not apply inside it, and it checked nothing: any signed-in user got
-- any project's members with their names and emails, public or private.
-- Reads follow account membership -- the rule `project_members_read`
-- already states -- and a project's visibility grants nothing.
--
-- Rows are compared as sorted (email, role) pairs: every row here is written
-- in one transaction, so `created_at` ties and the function's own order is
-- not something this file can observe.

select tests.create_supabase_user('kb41_owner', 'kb41-owner@storybook.dev');
select tests.create_supabase_user('kb41_mate', 'kb41-mate@storybook.dev');
select tests.create_supabase_user('kb41_pmem', 'kb41-pmem@storybook.dev');
select tests.create_supabase_user('kb41_stranger', 'kb41-stranger@storybook.dev');

select makerkit.authenticate_as('kb41_owner');
select public.create_team_account('KB41 Team');
select set_config('kb41.team', makerkit.get_account_id_by_slug('kb41-team')::text, true);

-- P1 public and P2 private on the team; P3 on the owner's personal account.
-- Created as the owner so the creator trigger gives them the owner row.
insert into public.projects (id, account_id, name, slug, status, visibility)
  values ('41410000-0000-4000-8000-000000000001', current_setting('kb41.team')::uuid, 'Public', 'kb41-public', 'active', 'public'),
         ('41410000-0000-4000-8000-000000000002', current_setting('kb41.team')::uuid, 'Private', 'kb41-private', 'active', 'private'),
         ('41410000-0000-4000-8000-000000000003', tests.get_supabase_uid('kb41_owner'), 'Personal', 'kb41-personal', 'active', 'private');

-- The stranger has a team and a project of their own, so "belongs to some
-- account" is not mistaken for "belongs to this one".
select makerkit.authenticate_as('kb41_stranger');
select public.create_team_account('KB41 Stranger Co');
insert into public.projects (id, account_id, name, slug, status)
  values ('41410000-0000-4000-8000-000000000004', makerkit.get_account_id_by_slug('kb41-stranger-co'), 'Own', 'kb41-own', 'active');

set local role postgres;

-- mate: a team member with no project row. pmem: a team member who is also
-- a `member` on both team projects.
insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('kb41_mate'), current_setting('kb41.team')::uuid, 'member'),
         (tests.get_supabase_uid('kb41_pmem'), current_setting('kb41.team')::uuid, 'member');
insert into public.project_members (project_id, user_id, role)
  values ('41410000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb41_pmem'), 'member'),
         ('41410000-0000-4000-8000-000000000002', tests.get_supabase_uid('kb41_pmem'), 'member');

-- Outsiders ---------------------------------------------------------------

select makerkit.authenticate_as('kb41_stranger');

select is_empty(
  $$ select * from public.get_project_members('41410000-0000-4000-8000-000000000001') $$,
  'A stranger gets nothing for a PUBLIC project: visibility grants no read of its members'
);

select is_empty(
  $$ select * from public.get_project_members('41410000-0000-4000-8000-000000000002') $$,
  'A stranger gets nothing for a private project'
);

select is_empty(
  $$ select * from public.get_project_members('41410000-0000-4000-8000-000000000003') $$,
  'A stranger gets nothing for another user''s personal-account project'
);

select results_eq(
  $$ select count(*)::int from public.get_project_members('41410000-0000-4000-8000-000000000001') $$,
  $$ select count(*)::int from public.get_project_members('41410000-0000-4000-8000-0000000000ff') $$,
  'A refused project looks exactly like one that does not exist'
);

select results_eq(
  $$ select user_email::text, role::text from public.get_project_members('41410000-0000-4000-8000-000000000004') $$,
  $$ values ('kb41-stranger@storybook.dev', 'owner') $$,
  'The stranger still lists the members of their own project'
);

set local role postgres;

select ok(
  not has_function_privilege('anon', 'public.get_project_members(uuid)', 'EXECUTE'),
  'Anonymous callers cannot execute it'
);

-- Account members ---------------------------------------------------------

select makerkit.authenticate_as('kb41_owner');

select results_eq(
  $$ select user_email::text, role::text from public.get_project_members('41410000-0000-4000-8000-000000000001') order by 1 $$,
  $$ values ('kb41-owner@storybook.dev', 'owner'), ('kb41-pmem@storybook.dev', 'member') $$,
  'The team owner lists every member, with emails'
);

select results_eq(
  $$ select user_email::text, role::text from public.get_project_members('41410000-0000-4000-8000-000000000003') $$,
  $$ values ('kb41-owner@storybook.dev', 'owner') $$,
  'A personal account''s owner lists the members of its project'
);

select makerkit.authenticate_as('kb41_mate');

select results_eq(
  $$ select user_email::text, role::text from public.get_project_members('41410000-0000-4000-8000-000000000001') order by 1 $$,
  $$ values ('kb41-owner@storybook.dev', 'owner'), ('kb41-pmem@storybook.dev', 'member') $$,
  'A team member with no project row lists every member: reads follow the account'
);

select makerkit.authenticate_as('kb41_pmem');

select results_eq(
  $$ select user_email::text, role::text from public.get_project_members('41410000-0000-4000-8000-000000000002') order by 1 $$,
  $$ values ('kb41-owner@storybook.dev', 'owner'), ('kb41-pmem@storybook.dev', 'member') $$,
  'A project member lists every member of a private project'
);

-- Leaving the team ends the read, even with a project row left behind.
set local role postgres;
delete from public.accounts_memberships
 where user_id = tests.get_supabase_uid('kb41_pmem')
   and account_id = current_setting('kb41.team')::uuid;

select makerkit.authenticate_as('kb41_pmem');

select is_empty(
  $$ select * from public.get_project_members('41410000-0000-4000-8000-000000000002') $$,
  'Someone removed from the team gets nothing, though their project row remains'
);

select * from finish();

rollback;
