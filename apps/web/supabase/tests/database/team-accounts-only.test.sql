begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- A fixed count rather than no_plan(): a file that aborts partway reports a
-- plan mismatch instead of a nearly-passing suite.
select plan(21);

-- FILM-CC-04 KB-99. The product is team accounts only: someone working alone
-- is a team of one. A project, and every row of an account-scoped workspace
-- table, belongs to a team account.
--
-- On main before this, `projects_create` explicitly admitted a personal
-- account's owner, and a signed-in user could create a project and a platform
-- connection on their own personal account: rows no page shows.
--
-- The rule is one trigger, `kit.require_team_account`, which every writer
-- passes through, the service role included. Tables that legitimately hold
-- personal-account rows are named below; every other table with a foreign key
-- to `accounts` must carry the trigger, so a new one has to decide.
--
-- Actors
--   kb99_p   a signed-in user with only their personal account
--   kb99_t   owner of team T

select tests.create_supabase_user('kb99_p', 'kb99-p@storybook.dev');
select tests.create_supabase_user('kb99_t', 'kb99-t@storybook.dev');

select makerkit.authenticate_as('kb99_t');
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('99990000-0000-4000-8000-00000000000a', 'KB-99 team', false, tests.get_supabase_uid('kb99_t'));
insert into public.projects (id, account_id, name, status)
values ('99990000-0000-4000-8000-000000000001', '99990000-0000-4000-8000-00000000000a', 'KB-99 T', 'active');

-- ==================================
-- The catalogue: every account-scoped table is guarded, or named here
-- ==================================

-- Tables whose personal-account rows are legitimate: a person's own
-- notifications, audit trail and billing; Makerkit's membership tables, which
-- it keeps to teams itself; and LLM usage for calls that read no workspace,
-- which is recorded on the caller's personal account (`noTenantLlmJobTarget`)
-- and would be dropped silently if refused (`logLLMUsage` swallows errors).
create temp table kb99_allowed (tbl text primary key);
insert into kb99_allowed values
  ('accounts_memberships'), ('audit_logs'), ('billing_customers'),
  ('invitations'), ('llm_usage_analytics'), ('notifications'), ('orders'),
  ('subscriptions');

select is_empty(
  $$ select distinct c.conrelid::regclass::text
       from pg_constraint c
      where c.contype = 'f'
        and c.confrelid = 'public.accounts'::regclass
        and c.conrelid::regclass::text not in (select tbl from kb99_allowed)
        and not exists (
          select 1 from pg_trigger t
           where t.tgrelid = c.conrelid
             and t.tgname = 'require_team_account'
             and not t.tgisinternal) $$,
  'every table with a foreign key to accounts is guarded, or allowed personal rows by name'
);

select is(
  (select count(*)::int from pg_trigger t
    where t.tgname = 'require_team_account'
      and t.tgfoid::regprocedure::text = 'kit.require_team_account()'
      and pg_get_triggerdef(t.oid) ~ 'BEFORE INSERT OR UPDATE OF account_id ON public\.\w+ FOR EACH ROW'),
  27,
  'the guard is a row trigger before insert, and before any update of account_id, on 27 tables (FILM-1903 added generation_runs, content_revisions and account_ai_settings; FILM-1904 mcp_connections and mcp_tool_calls)'
);

select is_empty(
  $$ select tbl from kb99_allowed a
      where exists (select 1 from pg_trigger t
                     where t.tgrelid = ('public.' || a.tbl)::regclass
                       and t.tgname = 'require_team_account') $$,
  'no table allowed personal rows carries the guard'
);

select is(
  (select not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
     from pg_proc p
    where p.oid::regprocedure::text = 'kit.require_team_account()'),
  true,
  'the trigger function exists and cannot be called by a client'
);

select is(
  (select regexp_replace(with_check, '\s+', ' ', 'g') from pg_policies
    where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_create'),
  'has_role_on_account(account_id)',
  'projects_create no longer admits a personal account''s owner'
);

-- ==================================
-- A signed-in user on their own personal account
-- ==================================
select makerkit.authenticate_as('kb99_p');

select throws_ok(
  $$ insert into public.projects (account_id, name) values (tests.get_supabase_uid('kb99_p'), 'mine') $$,
  '23514', null,
  'a personal account''s owner cannot create a project on it'
);

select throws_ok(
  $$ insert into public.platform_connections (account_id, platform, platform_account_id)
     values (tests.get_supabase_uid('kb99_p'), 'youtube', 'kb99-yt') $$,
  '23514', null,
  'nor connect a platform to it'
);

select throws_ok(
  $$ insert into public.social_posts (account_id, raw_notes) values (tests.get_supabase_uid('kb99_p'), 'n') $$,
  '23514', null,
  'nor file a social post on it'
);

-- ==================================
-- The service role: RLS does not apply, and the rule still does
-- ==================================
set local role service_role;

select throws_ok(
  $$ insert into public.projects (account_id, name) values (tests.get_supabase_uid('kb99_p'), 'worker') $$,
  '23514', null,
  'the service role cannot create a project on a personal account'
);

select throws_ok(
  $$ insert into public.scheduled_reports (account_id, name, frequency, recipients, next_run_at)
     values (tests.get_supabase_uid('kb99_p'), 'r', 'weekly', '{a@b.c}', now()) $$,
  '23514', null,
  'nor schedule a report on one'
);

-- A signed-in caller is stopped first by KB-113's freeze (#395): a project
-- may not move to any other account (42501)
select throws_ok(
  $$ update public.projects set account_id = tests.get_supabase_uid('kb99_p')
      where id = '99990000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'nor move a team''s project onto a personal account'
);

-- The freeze covers signed-in callers only; with no user, this guard is what
-- refuses a personal account
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$ update public.projects set account_id = tests.get_supabase_uid('kb99_p')
      where id = '99990000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'and the service role cannot move one there either'
);

select lives_ok(
  $$ update public.projects set name = 'KB-99 T renamed'
      where id = '99990000-0000-4000-8000-000000000001' $$,
  'an update that leaves account_id alone is not checked'
);

select lives_ok(
  $$ insert into public.project_templates (name, category, is_system, account_id)
     values ('kb99 system', 'series', true, null) $$,
  'a system template, which has no account, is allowed'
);

select lives_ok(
  $$ insert into public.notifications (account_id, body) values (tests.get_supabase_uid('kb99_p'), 'hello') $$,
  'a notification for a person''s own account is allowed'
);

select lives_ok(
  $$ insert into public.audit_logs (account_id, action, object_type, object_id, description)
     values (tests.get_supabase_uid('kb99_p'), 'update', 'account', 'kb99', 'profile updated') $$,
  'an audit entry for a person''s own account is allowed'
);

select lives_ok(
  $$ insert into public.llm_usage_analytics (account_id, user_id, template_slug, llm_provider, llm_model, status)
     values (tests.get_supabase_uid('kb99_p'), tests.get_supabase_uid('kb99_p'), 'kb99-no-tenant', 'openai', 'gpt-4o-mini', 'success') $$,
  'usage of an LLM call that reads no workspace is still recorded on the caller''s account'
);

-- ==================================
-- A team, as before
-- ==================================
select makerkit.authenticate_as('kb99_t');

select lives_ok(
  $$ insert into public.projects (account_id, name, slug)
     values ('99990000-0000-4000-8000-00000000000a', 'KB-99 T2', 'kb99-t2') $$,
  'a team owner creates a project on their team'
);

select lives_ok(
  $$ insert into public.platform_connections (account_id, platform, platform_account_id)
     values ('99990000-0000-4000-8000-00000000000a', 'youtube', 'kb99-team-yt') $$,
  'and connects a platform to it'
);

set local role postgres;

select is(
  (select count(*)::int from public.projects p
     join public.accounts a on a.id = p.account_id
    where a.is_personal_account),
  0,
  'no project sits on a personal account'
);

select is(
  (select count(*)::int from public.platform_connections c
     join public.accounts a on a.id = c.account_id
    where a.is_personal_account),
  0,
  'no platform connection sits on a personal account'
);

select * from finish();

rollback;
