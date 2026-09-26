begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- The account budget machinery is removed (owner, 2026-09-25). Its three
-- functions and two columns are gone, and `kit.protect_account_fields` is
-- back to its original list: the fields it still protects are refused, and
-- an ordinary edit still works. A fixed plan, so a truncated run fails.
select plan(8);

select hasnt_function('public', 'check_account_budget', 'B1 check_account_budget is dropped');
select hasnt_function('public', 'increment_account_usage', 'B2 increment_account_usage is dropped');
select hasnt_function('public', 'reset_monthly_usage', 'B3 reset_monthly_usage is dropped');

select hasnt_column('public', 'accounts', 'current_usage_cents', 'B4 accounts.current_usage_cents is dropped');
select hasnt_column('public', 'accounts', 'monthly_budget_cents', 'B5 accounts.monthly_budget_cents is dropped');

-- The trigger still does its original job
select tests.create_supabase_user('budget_owner', 'budget-owner@storybook.dev');
select makerkit.authenticate_as('budget_owner');

select throws_ok(
  $$ update public.accounts set email = 'elsewhere@storybook.dev'
      where id = tests.get_supabase_uid('budget_owner') $$,
  'P0001',
  'You do not have permission to update this field',
  'B6 the owner still cannot change the account email'
);

select lives_ok(
  $$ update public.accounts set name = 'Renamed'
      where id = tests.get_supabase_uid('budget_owner') $$,
  'B7 the owner can still rename their account'
);

select is(
  (select name from public.accounts where id = tests.get_supabase_uid('budget_owner')),
  'Renamed',
  'B8 and the rename is stored'
);

select * from finish();
rollback;
