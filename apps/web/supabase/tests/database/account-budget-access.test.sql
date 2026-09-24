begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(11);

-- KB-42. check_account_budget is SECURITY DEFINER, so RLS on accounts does
-- not apply inside it, and it checked nothing: any signed-in user could ask
-- whether any account was within its budget, and an unknown id raised
-- "Account not found: <id>", which told them whether the account existed.
--
-- The rule now: the caller must have access to the account (or be the
-- service role). Anyone else gets FALSE, for "not yours" and "no such
-- account" alike. FALSE rather than an error because the one caller,
-- voice-queries.ts, lets generation through when the RPC errors.

select tests.create_supabase_user('kb42_owner', 'kb42-owner@storybook.dev');
select tests.create_supabase_user('kb42_stranger', 'kb42-stranger@storybook.dev');

select set_config('kb42.owner', tests.get_supabase_uid('kb42_owner')::text, true);

-- 900 of 1000 cents used: 50 more fits, 200 more does not.
update public.accounts
   set monthly_budget_cents = 1000, current_usage_cents = 900
 where id = current_setting('kb42.owner')::uuid;

-- ==================================
-- A stranger learns nothing
-- ==================================

select makerkit.authenticate_as('kb42_stranger');

-- The helper's claims carry no `role`, so auth.role() is NULL here. That is
-- the case that once fell through: `false or NULL` is NULL, and `if not NULL`
-- does not refuse.
select is(
  public.check_account_budget(current_setting('kb42.owner')::uuid, 50),
  false,
  'FR-8: a stranger gets false for another account that is within budget'
);

select set_config(
  'request.jwt.claims',
  (current_setting('request.jwt.claims')::jsonb || '{"role": "authenticated"}')::text,
  true
);

select is(
  public.check_account_budget(current_setting('kb42.owner')::uuid, 50),
  false,
  'FR-8: a stranger gets false with PostgREST''s role claim too'
);

select lives_ok(
  $$ select public.check_account_budget('42000000-0000-4000-8000-0000000000ff'::uuid, 0) $$,
  'FR-8: an unknown id does not raise (no existence oracle)'
);

select is(
  public.check_account_budget('42000000-0000-4000-8000-0000000000ff'::uuid, 0),
  false,
  'FR-8: an unknown id gets the same false as another account'
);

-- ==================================
-- A member gets the real answer
-- ==================================

select makerkit.authenticate_as('kb42_owner');

select is(
  public.check_account_budget(current_setting('kb42.owner')::uuid, 50),
  true,
  'FR-9: the owner is told 50 more cents fits'
);

select is(
  public.check_account_budget(current_setting('kb42.owner')::uuid, 200),
  false,
  'FR-9: the owner is told 200 more cents does not fit'
);

-- ==================================
-- The service role still gets the real answer
-- ==================================

set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

select is(
  public.check_account_budget(current_setting('kb42.owner')::uuid, 50),
  true,
  'FR-9: the service role is told 50 more cents fits'
);

select is(
  public.check_account_budget(current_setting('kb42.owner')::uuid, 200),
  false,
  'FR-9: the service role is told 200 more cents does not fit'
);

set local role postgres;

-- ==================================
-- Grants unchanged
-- ==================================

select ok(
  has_function_privilege('authenticated', 'public.check_account_budget(uuid, integer)', 'EXECUTE'),
  'authenticated can still execute check_account_budget (voice generation calls it with the session client)'
);

select ok(
  not has_function_privilege('anon', 'public.check_account_budget(uuid, integer)', 'EXECUTE'),
  'anon cannot execute check_account_budget'
);

select ok(
  (select p.prosecdef and 'search_path=""' = any(p.proconfig)
     from pg_proc p where p.oid = 'public.check_account_budget(uuid, integer)'::regprocedure),
  'check_account_budget is still SECURITY DEFINER with an empty search_path'
);

select * from finish();

rollback;
