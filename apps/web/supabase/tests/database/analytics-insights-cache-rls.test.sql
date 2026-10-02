begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(8);

-- FILM-1906. analytics_insights_cache (FILM-808) is written by the service
-- role only. Members of the project's account may read it, so the MCP
-- get_saved_insights tool can answer under RLS with the caller's client; no
-- client role may write it. Fixture ids start with 19a6.
--
--   ic_owner    owns the team; ic_member has the seeded member role on it;
--   ic_stranger belongs to nothing.

select tests.create_supabase_user('ic_owner', 'ic-owner@storybook.dev');
select tests.create_supabase_user('ic_member', 'ic-member@storybook.dev');
select tests.create_supabase_user('ic_stranger', 'ic-stranger@storybook.dev');

set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('19a60000-0000-4000-8000-00000000000a', 'Insights cache team', false, tests.get_supabase_uid('ic_owner'));
insert into public.accounts_memberships (user_id, account_id, account_role)
values
  (tests.get_supabase_uid('ic_owner'), '19a60000-0000-4000-8000-00000000000a', 'owner'),
  (tests.get_supabase_uid('ic_member'), '19a60000-0000-4000-8000-00000000000a', 'member')
on conflict do nothing;

-- As the owner: the project trigger records auth.uid() as the first member.
select makerkit.authenticate_as('ic_owner');
insert into public.projects (id, account_id, name, status)
values ('19a60000-0000-4000-8000-000000000001', '19a60000-0000-4000-8000-00000000000a', 'IC', 'active');

-- Written as the service role would write it.
set local role postgres;
insert into public.analytics_insights_cache (project_id, input_hash, insights)
values ('19a60000-0000-4000-8000-000000000001', 'hash-1', '{"summary": "saved"}'::jsonb);

-- ==================================
-- The grant: SELECT, and nothing else, for authenticated; nothing for anon
-- ==================================

select is(
  (select coalesce(array_agg(privilege_type::text order by privilege_type), '{}'::text[])
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'analytics_insights_cache'
      and grantee = 'authenticated'),
  array['SELECT'],
  'authenticated holds SELECT on the insights cache, and no other privilege'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'analytics_insights_cache'
      and grantee = 'anon'),
  0,
  'anon holds no grant on the insights cache'
);

-- ==================================
-- Reads
-- ==================================

select makerkit.authenticate_as('ic_owner');
select is(
  (select count(*)::int from public.analytics_insights_cache
    where project_id = '19a60000-0000-4000-8000-000000000001'),
  1,
  'the account owner reads the project''s saved insights'
);

select makerkit.authenticate_as('ic_member');
select is(
  (select count(*)::int from public.analytics_insights_cache
    where project_id = '19a60000-0000-4000-8000-000000000001'),
  1,
  'a member of the account reads the project''s saved insights'
);

select makerkit.authenticate_as('ic_stranger');
select is(
  (select count(*)::int from public.analytics_insights_cache),
  0,
  'a user outside the account sees no saved insights at all'
);

-- ==================================
-- Writes: refused at the grant, for a member as for anyone
-- ==================================

select makerkit.authenticate_as('ic_member');

select throws_ok(
  $$ insert into public.analytics_insights_cache (project_id, input_hash, insights)
     values ('19a60000-0000-4000-8000-000000000001', 'hash-2', '{}'::jsonb) $$,
  '42501', null,
  'a member cannot insert a saved insight'
);

select throws_ok(
  $$ update public.analytics_insights_cache set insights = '{"summary": "forged"}'::jsonb
      where project_id = '19a60000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a member cannot update a saved insight'
);

select throws_ok(
  $$ delete from public.analytics_insights_cache
      where project_id = '19a60000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a member cannot delete a saved insight'
);

select * from finish();
rollback;
