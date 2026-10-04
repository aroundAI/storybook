begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(11);

-- FILM-1903 / FILM-1904 leftovers: generation_runs.connection_id references
-- mcp_connections and is nulled when the connection is deleted, and
-- trim_mcp_tool_calls() deletes tool-call rows older than 90 days in bounded
-- batches, for the service role only. Fixture ids start with 19031000.

select tests.create_supabase_user('rc_owner', 'rc-owner@storybook.dev');

select tests.authenticate_as('rc_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id) values
  ('19031000-0000-4000-8000-00000000000a', 'FILM-1903 rc team', false, tests.get_supabase_uid('rc_owner'));

insert into public.accounts_memberships (user_id, account_id, account_role) values
  (tests.get_supabase_uid('rc_owner'), '19031000-0000-4000-8000-00000000000a', 'owner')
on conflict do nothing;

insert into public.projects (id, account_id, name, status) values
  ('19031000-0000-4000-8000-000000000001', '19031000-0000-4000-8000-00000000000a', 'rc project', 'active');

insert into public.episodes (id, project_id, number, title) values
  ('19031000-0000-4000-8000-000000000011', '19031000-0000-4000-8000-000000000001', 1, 'Ep 1');

insert into public.mcp_connections (id, user_id, account_id, kind, name, scopes) values
  ('19031000-0000-4000-8000-0000000000c1', tests.get_supabase_uid('rc_owner'),
   '19031000-0000-4000-8000-00000000000a', 'pat', 'rc laptop', array['studio:read']);

-- ------------------------------------------------------------------
-- The foreign key
-- ------------------------------------------------------------------
select throws_ok(
  $$ insert into public.generation_runs (account_id, project_id, target_type, target_id, stage, mode, created_by, connection_id)
     values ('19031000-0000-4000-8000-00000000000a', '19031000-0000-4000-8000-000000000001', 'episode',
             '19031000-0000-4000-8000-000000000011', 'story', 'external',
             tests.get_supabase_uid('rc_owner'), '19031000-0000-4000-8000-0000000000ff') $$,
  '23503', null,
  'FK1 a run naming a connection that does not exist is refused'
);

select lives_ok(
  $$ insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, created_by, connection_id)
     values ('19031000-0000-4000-8000-0000000000e1', '19031000-0000-4000-8000-00000000000a',
             '19031000-0000-4000-8000-000000000001', 'episode', '19031000-0000-4000-8000-000000000011',
             'story', 'external', tests.get_supabase_uid('rc_owner'), '19031000-0000-4000-8000-0000000000c1') $$,
  'FK2 a run naming a real connection opens'
);

delete from public.mcp_connections where id = '19031000-0000-4000-8000-0000000000c1';

select is(
  (select connection_id from public.generation_runs where id = '19031000-0000-4000-8000-0000000000e1'),
  null,
  'FK3 deleting a connection nulls the connection_id of its runs'
);

select is(
  (select count(*)::int from public.generation_runs where id = '19031000-0000-4000-8000-0000000000e1'),
  1,
  'FK3 and keeps the run'
);

-- ------------------------------------------------------------------
-- The 90-day trim
-- ------------------------------------------------------------------
insert into public.mcp_tool_calls (account_id, tool, status, duration_ms, created_at) values
  ('19031000-0000-4000-8000-00000000000a', 'old-1', 'ok', 1, now() - interval '91 days'),
  ('19031000-0000-4000-8000-00000000000a', 'old-2', 'ok', 1, now() - interval '120 days'),
  ('19031000-0000-4000-8000-00000000000a', 'old-3', 'ok', 1, now() - interval '200 days'),
  ('19031000-0000-4000-8000-00000000000a', 'edge', 'ok', 1, now() - interval '89 days'),
  ('19031000-0000-4000-8000-00000000000a', 'new', 'ok', 1, now());

set local role service_role;

select is(
  public.trim_mcp_tool_calls(2),
  2,
  'T1 one call deletes at most the batch size'
);

select is(
  (select array_agg(tool order by tool) from public.mcp_tool_calls where tool like 'old-%'),
  array['old-1'],
  'T1 oldest first: the two oldest of the three old rows are gone'
);

select is(public.trim_mcp_tool_calls(2), 1, 'T2 the next call deletes the remainder and returns less than the batch');

select is(
  (select array_agg(tool order by tool) from public.mcp_tool_calls),
  array['edge', 'new'],
  'T2 a row 89 days old and a new one are kept'
);

select throws_ok(
  $$ select public.trim_mcp_tool_calls(0) $$,
  'P0001', 'p_batch must be at least 1',
  'T3 a batch of 0 is refused rather than looping the cron for ever'
);

set local role authenticated;

select throws_ok(
  $$ select public.trim_mcp_tool_calls(10) $$,
  '42501', null,
  'T4 a signed-in user cannot trim the log'
);

set local role anon;

select throws_ok(
  $$ select public.trim_mcp_tool_calls(10) $$,
  '42501', null,
  'T4 nor can anon'
);

select * from finish();
rollback;
