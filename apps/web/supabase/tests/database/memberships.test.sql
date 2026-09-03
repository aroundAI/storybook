begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select no_plan();

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');
select makerkit.set_identifier('custom', 'custom@storybook.dev');

-- another user not in the team
select tests.create_supabase_user('test', 'test@supabase.com');

select makerkit.authenticate_as('owner');

-- Can check if an account is a team member

-- Primary owner
select is(
  (select public.is_team_member(
    makerkit.get_account_id_by_slug('storybook'),
    tests.get_supabase_uid('member')
  )),
  true,
  'The primary account owner can check if a member is a team member'
);

select makerkit.authenticate_as('member');

-- Member
select is(
  (select public.is_team_member(
    makerkit.get_account_id_by_slug('storybook'),
    tests.get_supabase_uid('owner')
  )),
  true,
  'The member can check if another member is a team member'
);

select is(
  (select public.has_role_on_account(
    makerkit.get_account_id_by_slug('storybook')
  )),
  true,
  'The member can check if they have a role on the account'
);

select isnt_empty(
  $$ select * from public.get_account_members('storybook') $$,
  'The member can query the team account memberships using the get_account_members function'
);

select makerkit.authenticate_as('test');

-- Foreigners
-- Cannot query the team account memberships
select is(
  (select public.is_team_member(
    makerkit.get_account_id_by_slug('storybook'),
    tests.get_supabase_uid('owner')
  )),
  false,
  'The foreigner cannot check if a member is a team member'
);

-- Does not have a role on the account
select is(
  (select public.has_role_on_account(
    makerkit.get_account_id_by_slug('storybook')
  )),
  false,
  'The foreigner does not have a role on the account'
);

select is_empty(
  $$ select * from public.accounts_memberships where account_id = makerkit.get_account_id_by_slug('storybook') $$,
  'The foreigner cannot query the team account memberships'
);

select is_empty(
  $$ select * from public.accounts where id = makerkit.get_account_id_by_slug('storybook') $$,
  'The foreigner cannot query the team account'
);

select is_empty(
  $$ select * from public.get_account_members('storybook') $$,
  'The foreigner cannot query the team members'
);

select * from finish();

rollback;
