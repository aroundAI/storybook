begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(16);

-- FILM-1911. The super admin's MCP panels read across teams through four
-- SECURITY DEFINER functions that refuse anyone but public.is_super_admin()
-- (an aal2 session with the super-admin role); the guard check behind the
-- alert is the service role's alone and finds a model-usage row whose run is
-- external. Every expected figure below is computed by hand from the rows
-- this file inserts. Fixture ids start with 19110000.

select makerkit.set_identifier('owner', 'owner@storybook.dev');

select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('mm.team', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('mm.owner', tests.get_supabase_uid('owner')::text, true);

insert into public.projects (id, account_id, name, status) values
  ('19110000-0000-4000-8000-000000000001', current_setting('mm.team')::uuid, 'FILM-1911 monitoring', 'active');

-- Tool calls. In the 7-day window:
--   whoami        ok 10, 20, 30, 40, 100 -> 5 calls, 0 errors, p95 = 40 + 0.8 * 60 = 88
--   list_projects ok 5, VALIDATION_FAILED 7, RATE_LIMITED 1 -> 3 calls, 2 errors,
--                 p95 over (1, 5, 7) = 5 + 0.9 * 2 = 6.8
-- and one whoami call 30 days ago, outside it. 8 calls in the window.
insert into public.mcp_tool_calls (account_id, tool, status, error_code, duration_ms, created_at) values
  (current_setting('mm.team')::uuid, 'whoami', 'ok', null, 10, now()),
  (current_setting('mm.team')::uuid, 'whoami', 'ok', null, 20, now()),
  (current_setting('mm.team')::uuid, 'whoami', 'ok', null, 30, now()),
  (current_setting('mm.team')::uuid, 'whoami', 'ok', null, 40, now()),
  (current_setting('mm.team')::uuid, 'whoami', 'ok', null, 100, now()),
  (current_setting('mm.team')::uuid, 'list_projects', 'ok', null, 5, now()),
  (current_setting('mm.team')::uuid, 'list_projects', 'error', 'VALIDATION_FAILED', 7, now()),
  (current_setting('mm.team')::uuid, 'list_projects', 'error', 'RATE_LIMITED', 1, now()),
  (current_setting('mm.team')::uuid, 'whoami', 'ok', null, 999, now() - interval '30 days');

-- Runs: two committed server runs, one open external run, two expired
-- external runs (one expired today, one two days ago).
insert into public.generation_runs (id, account_id, project_id, target_type, target_id, stage, mode, status, created_by, created_at, finalized_at) values
  ('19110000-0000-4000-8000-0000000000a1', current_setting('mm.team')::uuid, '19110000-0000-4000-8000-000000000001',
   'episode', '19110000-0000-4000-8000-000000000011', 'story', 'server', 'committed', current_setting('mm.owner')::uuid, now(), now()),
  ('19110000-0000-4000-8000-0000000000a2', current_setting('mm.team')::uuid, '19110000-0000-4000-8000-000000000001',
   'episode', '19110000-0000-4000-8000-000000000012', 'story', 'server', 'committed', current_setting('mm.owner')::uuid, now(), now()),
  ('19110000-0000-4000-8000-0000000000e1', current_setting('mm.team')::uuid, '19110000-0000-4000-8000-000000000001',
   'episode', '19110000-0000-4000-8000-000000000013', 'story', 'external', 'briefed', current_setting('mm.owner')::uuid, now(), null),
  ('19110000-0000-4000-8000-0000000000e2', current_setting('mm.team')::uuid, '19110000-0000-4000-8000-000000000001',
   'episode', '19110000-0000-4000-8000-000000000014', 'story', 'external', 'expired', current_setting('mm.owner')::uuid, now(), now()),
  ('19110000-0000-4000-8000-0000000000e3', current_setting('mm.team')::uuid, '19110000-0000-4000-8000-000000000001',
   'episode', '19110000-0000-4000-8000-000000000015', 'story', 'external', 'expired', current_setting('mm.owner')::uuid,
   now() - interval '2 days', now() - interval '2 days');

-- ==================================
-- Who may read the panels
-- ==================================

select ok(
  not has_function_privilege('anon', 'public.admin_mcp_tool_stats(integer)', 'EXECUTE'),
  'P1 anon cannot execute the panel functions'
);

select ok(
  not has_function_privilege('authenticated', 'public.admin_mcp_check_window(integer)', 'EXECUTE'),
  'P2 the shared window check is not callable over RPC'
);

-- a team owner, signed in without MFA
select makerkit.authenticate_as('owner');

select throws_ok(
  $$ select * from public.admin_mcp_tool_stats(7) $$,
  '42501', 'refused: MCP monitoring is for super admins',
  'P3 a team owner is refused the tool panel'
);

select throws_ok(
  $$ select * from public.admin_generation_run_stats(7) $$,
  '42501', 'refused: MCP monitoring is for super admins',
  'P4 a team owner is refused the runs panel'
);

-- the super-admin role without an aal2 session is not a super admin
select makerkit.set_super_admin();

select throws_ok(
  $$ select * from public.admin_expired_leases_per_day(7) $$,
  '42501', 'refused: MCP monitoring is for super admins',
  'P5 the super-admin role at aal1 is refused'
);

-- a real super admin: MFA factor, aal2, the role
select makerkit.authenticate_as('owner');
select makerkit.set_mfa_factor();
select makerkit.set_session_aal('aal2');
select makerkit.set_super_admin();

select ok(public.is_super_admin(), 'P6 the fixture is a super admin');

-- ==================================
-- What the panels say
-- ==================================

select results_eq(
  $$ select tool, calls, errors, round(p95_ms::numeric, 2) from public.admin_mcp_tool_stats(7) $$,
  $$ values ('whoami'::text, 5::bigint, 0::bigint, 88.00::numeric),
            ('list_projects'::text, 3::bigint, 2::bigint, 6.80::numeric) $$,
  'V1 calls, errors and p95 per tool over the window; the 30-day-old call is outside it'
);

select results_eq(
  $$ select tool, calls from public.admin_mcp_tool_stats(31) where tool = 'whoami' $$,
  $$ values ('whoami'::text, 6::bigint) $$,
  'V2 a 31-day window includes the old call'
);

select results_eq(
  $$ select error_code, calls, total_calls, rate from public.admin_mcp_error_codes(7) $$,
  $$ values ('RATE_LIMITED'::text, 1::bigint, 8::bigint, 0.125::double precision),
            ('VALIDATION_FAILED'::text, 1::bigint, 8::bigint, 0.125::double precision) $$,
  'V3 error rate by code is that code''s calls over every call in the window'
);

select results_eq(
  $$ select mode, status, runs from public.admin_generation_run_stats(7) $$,
  $$ values ('external'::text, 'briefed'::text, 1::bigint),
            ('external'::text, 'expired'::text, 2::bigint),
            ('server'::text, 'committed'::text, 2::bigint) $$,
  'V4 runs by mode and status'
);

select results_eq(
  $$ select expired from public.admin_expired_leases_per_day(3) $$,
  $$ values (0::bigint), (1::bigint), (0::bigint), (1::bigint) $$,
  'V5 expired leases per UTC day, oldest first, a day with none is 0'
);

select throws_ok(
  $$ select * from public.admin_mcp_tool_stats(0) $$,
  '22023', 'the window must be 1 to 90 days, not 0',
  'V6 a window outside 1 to 90 days is refused'
);

-- ==================================
-- The guard check behind the alert
-- ==================================

select ok(
  not has_function_privilege('authenticated', 'public.external_run_model_calls(integer)', 'EXECUTE'),
  'G1 a signed-in user cannot run the guard check'
);

set local role service_role;

select is_empty(
  $$ select * from public.external_run_model_calls() $$,
  'G2 with the FILM-1903 lock in place there is nothing to report'
);

select throws_ok(
  $$ insert into public.llm_usage_analytics (account_id, template_slug, llm_provider, llm_model, status, run_id)
     values (current_setting('mm.team')::uuid, 'story-generation', 'gemini', 'gemini-2.5-pro', 'success',
             '19110000-0000-4000-8000-0000000000e1') $$,
  'P0001', null,
  'G3 the lock refuses a usage row on an external run'
);

-- What the alert exists for: the lock gone, a usage row lands on an
-- external run (and one on a server run, which is not a finding).
set local role postgres;
alter table public.llm_usage_analytics disable trigger llm_usage_analytics_server_run_only;

insert into public.llm_usage_analytics (id, account_id, template_slug, llm_provider, llm_model, status, run_id) values
  ('19110000-0000-4000-8000-0000000000f1', current_setting('mm.team')::uuid, 'story-generation', 'gemini',
   'gemini-2.5-pro', 'success', '19110000-0000-4000-8000-0000000000e1'),
  ('19110000-0000-4000-8000-0000000000f2', current_setting('mm.team')::uuid, 'story-generation', 'gemini',
   'gemini-2.5-pro', 'success', '19110000-0000-4000-8000-0000000000a1');

alter table public.llm_usage_analytics enable trigger llm_usage_analytics_server_run_only;

set local role service_role;

select results_eq(
  $$ select usage_id, run_id, account_id, total from public.external_run_model_calls() $$,
  $$ values ('19110000-0000-4000-8000-0000000000f1'::uuid, '19110000-0000-4000-8000-0000000000e1'::uuid,
             current_setting('mm.team')::uuid, 1::bigint) $$,
  'G4 the check reports the usage row on the external run, and only that one'
);

select * from finish();

rollback;
