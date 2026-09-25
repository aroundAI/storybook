begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-83: an account's usage counter moves only through the server.
--
-- `increment_account_usage` is the service role's alone: the voice actions
-- call it with the server's client for an account they have authorised, and
-- the voice worker with its own. It refuses a negative amount from anyone.
-- And no API role may write `current_usage_cents` directly; before this, an
-- account's primary owner could set it to -1000 over PostgREST. The owner
-- may still set their own `monthly_budget_cents` (owner decision).
select plan(13);

select tests.create_supabase_user('kb83_owner', 'kb83-owner@storybook.dev');
select tests.create_supabase_user('kb83_member', 'kb83-member@storybook.dev');

select makerkit.authenticate_as('kb83_owner');
select public.create_team_account('KB83 Team');

set local role postgres;

select set_config('kb83.team', makerkit.get_account_id_by_slug('kb83-team')::text, true);
select set_config('kb83.personal', tests.get_supabase_uid('kb83_owner')::text, true);

insert into public.accounts_memberships (user_id, account_id, account_role)
values (tests.get_supabase_uid('kb83_member'), current_setting('kb83.team')::uuid, 'member');

-- ==================================
-- Who may execute the increment
-- ==================================

select ok(
  not has_function_privilege('authenticated', 'public.increment_account_usage(uuid, integer)', 'EXECUTE'),
  'U1 authenticated cannot execute increment_account_usage'
);

select ok(
  not has_function_privilege('anon', 'public.increment_account_usage(uuid, integer)', 'EXECUTE'),
  'U2 anon cannot execute increment_account_usage'
);

select ok(
  has_function_privilege('service_role', 'public.increment_account_usage(uuid, integer)', 'EXECUTE'),
  'U3 the service role executes increment_account_usage'
);

-- ==================================
-- The service role counts spend, and only upwards
-- ==================================

set local role service_role;

select results_eq(
  format($$ select new_usage_cents from public.increment_account_usage(%L, 30) $$, current_setting('kb83.team')),
  $$ values (30) $$,
  'U4 the service role adds 30 cents to the team''s usage'
);

select throws_ok(
  format($$ select * from public.increment_account_usage(%L, -30) $$, current_setting('kb83.team')),
  '22023',
  null,
  'U5 a negative amount is refused, even for the service role'
);

select throws_ok(
  format($$ select * from public.increment_account_usage(%L, null) $$, current_setting('kb83.team')),
  '22023',
  null,
  'U6 a null amount is refused'
);

-- ==================================
-- API roles cannot move the counter
-- ==================================

select makerkit.authenticate_as('kb83_owner');

select throws_ok(
  format($$ select * from public.increment_account_usage(%L, 5) $$, current_setting('kb83.team')),
  '42501',
  null,
  'U7 the account owner cannot call increment_account_usage'
);

select throws_ok(
  format($$ update public.accounts set current_usage_cents = -1000 where id = %L $$, current_setting('kb83.personal')),
  'P0001',
  'You do not have permission to update this field',
  'U8 the owner cannot rewrite their personal account''s usage'
);

select throws_ok(
  format($$ update public.accounts set current_usage_cents = 0 where id = %L $$, current_setting('kb83.team')),
  'P0001',
  'You do not have permission to update this field',
  'U9 the primary owner cannot reset their team''s usage'
);

select lives_ok(
  format($$ update public.accounts set monthly_budget_cents = 5000 where id = %L $$, current_setting('kb83.team')),
  'U10 the owner may still set their own budget'
);

select lives_ok(
  format($$ update public.accounts set name = 'KB83 Team renamed' where id = %L $$, current_setting('kb83.team')),
  'U11 the owner may still rename the account'
);

select makerkit.authenticate_as('kb83_member');

-- RLS hides the row from a member's UPDATE: no error, and nothing changes (U13)
select lives_ok(
  format($$ update public.accounts set current_usage_cents = 0 where id = %L $$, current_setting('kb83.team')),
  'U12 a member''s update of the team''s usage touches no row'
);

set local role postgres;

select results_eq(
  format($$ select current_usage_cents, monthly_budget_cents from public.accounts where id = %L $$, current_setting('kb83.team')),
  $$ values (30, 5000) $$,
  'U13 usage is what the service role counted; the owner''s budget stands'
);

select * from finish();

rollback;
