begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(6);

-- FILM-CC-04 KB-132. Read policies under projects admitted a personal
-- account's owner. After KB-99 that branch can never match, and Postgres
-- planned it as a subplan over every personal account, read through the
-- accounts policy: seconds per read, growing with the user count.

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and tablename <> 'accounts'
        and coalesce(qual, '') || coalesce(with_check, '') ilike '%is_personal_account%' $$,
  'no policy outside accounts tests is_personal_account'
);

select tests.create_supabase_user('kb132_owner', 'kb132-owner@storybook.dev');
select tests.create_supabase_user('kb132_stranger', 'kb132-stranger@storybook.dev');

-- Signed in as the owner, so the project's creator trigger has a user
select makerkit.authenticate_as('kb132_owner');
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('13200000-0000-4000-8000-00000000000a', 'KB-132 team', false, tests.get_supabase_uid('kb132_owner'));
insert into public.accounts_memberships (user_id, account_id, account_role)
values (tests.get_supabase_uid('kb132_owner'), '13200000-0000-4000-8000-00000000000a', 'owner')
on conflict do nothing;
insert into public.projects (id, account_id, name, status)
values ('13200000-0000-4000-8000-000000000001', '13200000-0000-4000-8000-00000000000a', 'KB-132', 'active');
insert into public.episodes (id, project_id, number, title, slug)
values ('13200000-0000-4000-8000-0000000000e1', '13200000-0000-4000-8000-000000000001', 1, 'KB-132 1', 'kb132-1');

-- The plan of a signed-in project read, as the caller
create or replace function public.kb132_plan() returns text
  language plpgsql security invoker set search_path = '' as $fn$
declare
  line text;
  plan text := '';
begin
  for line in execute 'explain select id from public.projects' loop
    plan := plan || line || E'\n';
  end loop;
  return plan;
end
$fn$;
grant execute on function public.kb132_plan() to authenticated;

select makerkit.authenticate_as('kb132_owner');

select unalike(
  public.kb132_plan(),
  '%is_personal_account%',
  'a project read no longer plans a scan of personal accounts'
);

select results_eq(
  $$ select id from public.projects where id = '13200000-0000-4000-8000-000000000001' $$,
  $$ values ('13200000-0000-4000-8000-000000000001'::uuid) $$,
  'the team''s owner still reads its project'
);

select results_eq(
  $$ select id from public.episodes where id = '13200000-0000-4000-8000-0000000000e1' $$,
  $$ values ('13200000-0000-4000-8000-0000000000e1'::uuid) $$,
  'and its episode'
);

select makerkit.authenticate_as('kb132_stranger');

select is_empty(
  $$ select id from public.projects where id = '13200000-0000-4000-8000-000000000001' $$,
  'someone with no role on the team reads no project'
);

select is_empty(
  $$ select id from public.episodes where id = '13200000-0000-4000-8000-0000000000e1' $$,
  'nor its episode'
);

select * from finish();
rollback;
