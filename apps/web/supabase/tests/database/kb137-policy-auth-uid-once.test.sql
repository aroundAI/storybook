begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(4);

-- KB-137. A policy that filters through a subquery on accounts or
-- accounts_memberships with a bare auth.uid() scans every account and runs
-- that table's own policies on each one: 4.0 s to read one social post with
-- 592 accounts, then a statement timeout reported as "not found". Wrapped as
-- `(select auth.uid())` it is one indexed row.

select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'from accounts'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(?<!SELECT )auth\.uid\(\)'),
  0,
  'no policy filters through accounts or accounts_memberships with a bare auth.uid()'
);

-- The rewrite changes how the rule is evaluated, not the rule: a member
-- still reads the team's post and a stranger still does not.
select tests.create_supabase_user('kb137-member', 'kb137-member@storybook.dev');
select tests.create_supabase_user('kb137-stranger', 'kb137-stranger@storybook.dev');

set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
  values ('13713713-0000-4000-8000-000000000001', 'KB-137 team', false,
          tests.get_supabase_uid('kb137-member'));

insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('kb137-member'), '13713713-0000-4000-8000-000000000001', 'owner')
  on conflict do nothing;

insert into public.social_posts (id, account_id, raw_notes, status, created_by)
  values ('13713713-0000-4000-8000-000000000002', '13713713-0000-4000-8000-000000000001',
          'Notes', 'draft', tests.get_supabase_uid('kb137-member'));

select makerkit.authenticate_as('kb137-member');

select is(
  (select count(*)::int from public.social_posts
    where id = '13713713-0000-4000-8000-000000000002'),
  1,
  'a member of the team reads its post'
);

select results_eq(
  $$ update public.social_posts set raw_notes = 'Edited'
      where id = '13713713-0000-4000-8000-000000000002' returning raw_notes $$,
  $$ values ('Edited'::text) $$,
  'a member of the team edits its post'
);

select makerkit.authenticate_as('kb137-stranger');

select is(
  (select count(*)::int from public.social_posts
    where id = '13713713-0000-4000-8000-000000000002'),
  0,
  'someone outside the team does not'
);

select * from finish();
rollback;
