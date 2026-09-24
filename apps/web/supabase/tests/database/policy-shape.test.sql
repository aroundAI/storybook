begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(8);

-- KB-52's class guard. The defect was one policy written with no FOR and no
-- TO clause and a constant-true expression: it read like a service-role
-- policy and applied to every role. service_role bypasses RLS, so a
-- "service role" policy is never needed, and writing one TO public is how
-- any signed-in user came to read, rewrite and delete every account's LLM
-- usage rows.
--
-- These checks read pg_policies for the whole public schema, so a new
-- migration that repeats the shape fails CI and the failure lists the policy.
--
-- To fix a failure: name the role (`to authenticated`), and never grant a
-- write with `using (true)` / `with check (true)`. If the table really is
-- world-readable reference data, add it to the allowlist in check 3 with the
-- reason.

-- 1. Every policy names its role. Allowlisted until their owners land:
--    verified_facts (KB-18 rewrites its policies) and audio_cues (KB-27 and
--    KB-48). Their predicates all test auth.uid(), so today the missing TO
--    clause exposes nothing; remove each entry when that ticket merges.
select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and roles = '{public}'
        and tablename not in ('verified_facts', 'audio_cues') $$,
  'No policy in public omits its TO clause (a missing TO applies it to every role)'
);

-- 2. No write policy for a client role is constant-true.
select is_empty(
  $$ select tablename || '.' || policyname || ' (' || cmd || ')'
       from pg_policies
      where schemaname = 'public'
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        and (roles && array['public', 'anon', 'authenticated']::name[])
        and (qual = 'true' or with_check = 'true') $$,
  'No INSERT/UPDATE/DELETE/ALL policy for public, anon or authenticated is using (true) or with check (true)'
);

-- 3. World-readable tables are the known reference data and nothing else.
--    external_content is KB-26's (a shared cache that also holds uploads).
select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and cmd = 'SELECT'
        and (roles && array['public', 'anon', 'authenticated']::name[])
        and qual = 'true'
        and tablename not in ('config', 'roles', 'role_permissions', 'external_content') $$,
  'Only config, roles, role_permissions and external_content have a SELECT policy using (true) for a client role'
);

-- 5. KB-76's class guard. A permissive FOR ALL policy with only USING lets
--    whoever passes USING write any row it can see, with nothing checked
--    about what the row becomes; five canon tables were written that way and
--    let project viewers write canon. Write one policy per verb, each write
--    with its own WITH CHECK. (Restrictive policies grant nothing, so
--    Makerkit's restrict_mfa_* gates are not this shape.)
select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and cmd = 'ALL'
        and permissive = 'PERMISSIVE'
        and (roles && array['public', 'anon', 'authenticated']::name[])
        and with_check is null $$,
  'No permissive FOR ALL policy for public, anon or authenticated lacks WITH CHECK'
);

-- 4. KB-52 moved five tables' policies from TO public to TO authenticated,
--    changing only the role list. Their predicates all test auth.uid(), so
--    nobody's visibility changes; these cases pin that for two of them.
--    They pass on the schema before the change as well as after — that is
--    the point: the change is a no-op for every signed-in user.
select tests.create_supabase_user('kb52_shape_owner', 'kb52-shape-owner@storybook.dev');
select tests.create_supabase_user('kb52_shape_outsider', 'kb52-shape-outsider@storybook.dev');
select set_config('kb52.shape_owner', tests.get_supabase_uid('kb52_shape_owner')::text, true);

insert into public.social_posts (id, account_id, raw_notes, created_by)
values ('52000000-0000-4000-8000-0000000000a1',
        current_setting('kb52.shape_owner')::uuid, 'kb52 shape probe',
        current_setting('kb52.shape_owner')::uuid);

insert into public.nonces (id, client_token, nonce, user_id, purpose, expires_at)
values ('52000000-0000-4000-8000-0000000000a2', 'kb52-token', 'kb52-nonce',
        current_setting('kb52.shape_owner')::uuid, 'kb52-probe', now() + interval '1 hour');

select makerkit.authenticate_as('kb52_shape_owner');

select is(
  (select count(*)::int from public.social_posts where id = '52000000-0000-4000-8000-0000000000a1'),
  1,
  'social_posts: the personal account owner still reads their own post'
);

select is(
  (select count(*)::int from public.nonces where id = '52000000-0000-4000-8000-0000000000a2'),
  1,
  'nonces: a user still reads their own nonce'
);

select makerkit.authenticate_as('kb52_shape_outsider');

select is(
  (select count(*)::int from public.social_posts where id = '52000000-0000-4000-8000-0000000000a1'),
  0,
  'social_posts: another signed-in user does not'
);

select is(
  (select count(*)::int from public.nonces where id = '52000000-0000-4000-8000-0000000000a2'),
  0,
  'nonces: another signed-in user does not'
);

select * from finish();

rollback;
