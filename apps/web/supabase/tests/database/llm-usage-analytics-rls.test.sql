begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- A fixed count rather than no_plan(): a file that aborts partway reports a
-- plan mismatch instead of a nearly-passing suite.
select plan(19);

-- KB-52. `llm_usage_analytics` holds one row per LLM call: the account, the
-- user, the model, the cost and, on failure, the provider's error text. Its
-- original "Service role can manage" policy had no FOR and no TO clause and
-- was `using (true) with check (true)` — so it applied FOR ALL TO public, and
-- any signed-in user could read, rewrite, forge and delete every account's
-- rows. service_role bypasses RLS and never needed that policy at all.
--
-- The rule now: reads on account access (owner or member —
-- `has_account_access`, so a personal account's owner, who has no membership
-- row, still sees their own usage); writes by the service role only, enforced
-- twice — no write policy, and no write privilege for anon or authenticated.
--
-- Account ids are stashed with set_config while still postgres:
-- `makerkit.get_account_id_by_slug` runs under the caller's RLS and would
-- return NULL for an account the caller cannot see.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select tests.create_supabase_user('kb52_solo', 'kb52-solo@storybook.dev');
select tests.create_supabase_user('kb52_outsider', 'kb52-outsider@storybook.dev');

select set_config('kb52.team', makerkit.get_account_id_by_slug('storybook')::text, true);
-- A personal account's id is its owner's user id.
select set_config('kb52.solo', tests.get_supabase_uid('kb52_solo')::text, true);

-- Rows are written as postgres, the way the service role writes them. Each
-- model call belongs to an open server run (FILM-1903 part C).
insert into public.generation_runs (id, account_id, target_type, target_id, stage, mode, created_by)
values
  ('52000000-0000-4000-8000-0000000000a1', current_setting('kb52.team')::uuid, 'project',
   '52000000-0000-4000-8000-0000000000b1', 'analytics_insights', 'server', tests.get_supabase_uid('member'));

insert into public.llm_usage_analytics
  (id, account_id, user_id, template_slug, llm_provider, llm_model, status, error_message, run_id)
values
  ('52000000-0000-4000-8000-000000000001', current_setting('kb52.team')::uuid,
   tests.get_supabase_uid('member'), 'kb52-team', 'openai', 'gpt-4o-mini', 'failure', 'team secret',
   '52000000-0000-4000-8000-0000000000a1');

-- A row on a personal account, or with no account, can only be one written
-- before part C (a run names its account, and runs belong to teams); replica
-- skips the trigger, as its absence did then.
set local session_replication_role = replica;
insert into public.llm_usage_analytics
  (id, account_id, user_id, template_slug, llm_provider, llm_model, status, error_message)
values
  ('52000000-0000-4000-8000-000000000002', current_setting('kb52.solo')::uuid,
   tests.get_supabase_uid('kb52_solo'), 'kb52-solo', 'openai', 'gpt-4o-mini', 'success', null),
  ('52000000-0000-4000-8000-000000000003', null,
   null, 'kb52-orphan', 'openai', 'gpt-4o-mini', 'success', null);
set local session_replication_role = origin;

-- ==================================
-- Shape: one read policy, to authenticated, and no write privilege
-- ==================================

select policies_are(
  'public', 'llm_usage_analytics', array['llm_usage_analytics_read'],
  'llm_usage_analytics has exactly one policy, and it is the read policy'
);

select policy_roles_are(
  'public', 'llm_usage_analytics', 'llm_usage_analytics_read', array['authenticated'],
  'The read policy applies to authenticated only, not to public'
);

select policy_cmd_is(
  'public', 'llm_usage_analytics', 'llm_usage_analytics_read', 'select',
  'The only policy is a SELECT policy'
);

select table_privs_are(
  'public', 'llm_usage_analytics', 'authenticated', array['SELECT'],
  'authenticated may only SELECT llm_usage_analytics'
);

select table_privs_are(
  'public', 'llm_usage_analytics', 'anon', array[]::text[],
  'anon holds no privilege on llm_usage_analytics'
);

-- ==================================
-- Reads
-- ==================================

select makerkit.authenticate_as('kb52_solo');

select is(
  (select count(*)::int from public.llm_usage_analytics
   where id = '52000000-0000-4000-8000-000000000002'),
  1,
  'A personal account owner, who has no membership row, reads their own usage'
);

select is(
  (select count(*)::int from public.llm_usage_analytics
   where id = '52000000-0000-4000-8000-000000000001'),
  0,
  'A personal account owner does not read a team they do not belong to'
);

select makerkit.authenticate_as('member');

select is(
  (select count(*)::int from public.llm_usage_analytics
   where id = '52000000-0000-4000-8000-000000000001'),
  1,
  'A team member reads the team''s usage'
);

select makerkit.authenticate_as('primary_owner');

select is(
  (select count(*)::int from public.llm_usage_analytics
   where id = '52000000-0000-4000-8000-000000000001'),
  1,
  'The team''s owner reads the team''s usage'
);

select is(
  (select count(*)::int from public.llm_usage_analytics
   where id = '52000000-0000-4000-8000-000000000003'),
  0,
  'A row with no account is visible to no signed-in user'
);

select makerkit.authenticate_as('kb52_outsider');

select is(
  (select count(*)::int from public.llm_usage_analytics
   where id in ('52000000-0000-4000-8000-000000000001',
                '52000000-0000-4000-8000-000000000002',
                '52000000-0000-4000-8000-000000000003')),
  0,
  'A signed-in user with no memberships reads no other account''s usage (KB-52)'
);

-- ==================================
-- Writes: refused for every signed-in user, own account or not
-- ==================================

select throws_ok(
  $$ insert into public.llm_usage_analytics (account_id, template_slug, llm_provider, llm_model, status, total_cost)
     values (current_setting('kb52.solo')::uuid, 'forged', 'x', 'x', 'success', 9999) $$,
  '42501', 'permission denied for table llm_usage_analytics',
  'An outsider cannot forge a usage row on another account (KB-52)'
);

select throws_ok(
  $$ update public.llm_usage_analytics set error_message = 'tampered'
     where id = '52000000-0000-4000-8000-000000000002' $$,
  '42501', 'permission denied for table llm_usage_analytics',
  'An outsider cannot rewrite another account''s usage row (KB-52)'
);

select throws_ok(
  $$ delete from public.llm_usage_analytics
     where id = '52000000-0000-4000-8000-000000000002' $$,
  '42501', 'permission denied for table llm_usage_analytics',
  'An outsider cannot delete another account''s usage row (KB-52)'
);

select makerkit.authenticate_as('kb52_solo');

-- The session-client write three callers used to rely on: refused now, which
-- is why executeLLM logs through the service role only.
select throws_ok(
  $$ insert into public.llm_usage_analytics (account_id, template_slug, llm_provider, llm_model, status)
     values (current_setting('kb52.solo')::uuid, 'session-writer', 'x', 'x', 'success') $$,
  '42501', 'permission denied for table llm_usage_analytics',
  'An owner cannot write usage rows through their own session, even on their own account'
);

select makerkit.authenticate_as('member');

select throws_ok(
  $$ update public.llm_usage_analytics set total_cost = 0
     where id = '52000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table llm_usage_analytics',
  'A member cannot rewrite their own team''s usage row'
);

select throws_ok(
  $$ delete from public.llm_usage_analytics
     where id = '52000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table llm_usage_analytics',
  'A member cannot delete their own team''s usage row'
);

set local role anon;

select throws_ok(
  $$ select count(*) from public.llm_usage_analytics $$,
  '42501', null,
  'anon cannot read llm_usage_analytics'
);

set local role postgres;

select is(
  (select count(*)::int from public.llm_usage_analytics
   where id in ('52000000-0000-4000-8000-000000000001',
                '52000000-0000-4000-8000-000000000002',
                '52000000-0000-4000-8000-000000000003')
     and error_message is distinct from 'tampered'),
  3,
  'Every refused write left the rows as they were'
);

select * from finish();

rollback;
