begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(16);

-- KB-60. "Allow public read of public accounts" let anyone signed in read
-- EVERY column of an account whose public_profile said is_public: the email,
-- the owner's user id, the budget and the usage. Public pages need five
-- columns, so they now read `public.public_accounts`, a view that returns
-- exactly those (plus updated_at, for the sitemap) for public TEAM accounts,
-- and `accounts` itself is back to members only.
--
-- The view runs as its owner, past `accounts`' RLS. That makes its column
-- list, its WHERE and its lack of write privileges the whole contract, so
-- each is pinned below.
--
-- Ids are stashed while still postgres: once a stranger is authenticated,
-- these rows are exactly what they must not be able to look up.

select tests.create_supabase_user('kb60_team_owner', 'kb60-team-owner@storybook.dev');
select tests.create_supabase_user('kb60_solo', 'kb60-solo@storybook.dev');
select tests.create_supabase_user('kb60_stranger', 'kb60-stranger@storybook.dev');

insert into public.accounts
  (id, name, slug, email, is_personal_account, primary_owner_user_id,
   monthly_budget_cents, public_profile)
values
  ('60000000-0000-4000-8000-000000000001', 'KB-60 Public Co', 'kb60-public-co',
   'press@kb60-public.dev', false, tests.get_supabase_uid('kb60_team_owner'),
   5000, '{"is_public": true, "display_name": "Public Co"}'),
  ('60000000-0000-4000-8000-000000000002', 'KB-60 Private Co', 'kb60-private-co',
   'private@kb60-private.dev', false, tests.get_supabase_uid('kb60_team_owner'),
   null, '{"is_public": false}');

insert into public.accounts_memberships (user_id, account_id, account_role)
values (tests.get_supabase_uid('kb60_team_owner'), '60000000-0000-4000-8000-000000000001', 'owner'),
       (tests.get_supabase_uid('kb60_team_owner'), '60000000-0000-4000-8000-000000000002', 'owner');

-- A personal account made public. No UI does this, but the API accepts it
-- from the owner, and it is the case that exposed an email (KB-41 S-1).
update public.accounts set public_profile = '{"is_public": true}'
 where id = tests.get_supabase_uid('kb60_solo');

select set_config('kb60.solo', tests.get_supabase_uid('kb60_solo')::text, true);

-- ==================================
-- A stranger reads nothing of anyone else's account from `accounts`
-- ==================================

select makerkit.authenticate_as('kb60_stranger');

select is_empty(
  $$ select id, email from public.accounts
      where id in ('60000000-0000-4000-8000-000000000001',
                   '60000000-0000-4000-8000-000000000002',
                   current_setting('kb60.solo')::uuid) $$,
  'FR-1: a stranger reads no row of a public team, a private team or a public personal account from accounts'
);

select is_empty(
  $$ select email from public.accounts
      where email is not null and (public_profile->>'is_public')::boolean $$,
  'FR-1: a stranger cannot list the emails of public accounts'
);

-- ==================================
-- Members still read their own account in full
-- ==================================

select makerkit.authenticate_as('kb60_team_owner');

select is(
  (select email::text from public.accounts where id = '60000000-0000-4000-8000-000000000001'),
  'press@kb60-public.dev',
  'FR-7: a team member still reads the team''s email from accounts'
);

select makerkit.authenticate_as('kb60_solo');

select is(
  (select email::text from public.accounts where id = current_setting('kb60.solo')::uuid),
  'kb60-solo@storybook.dev',
  'FR-7: a personal owner still reads their own email from accounts'
);

set local role postgres;

select policies_are(
  'public', 'accounts',
  array['accounts_read', 'accounts_self_update', 'create_org_account',
        'delete_team_account', 'restrict_mfa_accounts', 'super_admins_access_accounts'],
  'FR-1: accounts has no policy that opens rows to non-members'
);

-- ==================================
-- The view: exact columns, exact rows, read only
-- ==================================

select has_view('public', 'public_accounts', 'FR-2: public.public_accounts exists');

select columns_are(
  'public', 'public_accounts',
  array['id', 'name', 'slug', 'picture_url', 'public_profile', 'updated_at'],
  'FR-2: public_accounts exposes exactly the public fields and nothing else'
);

select ok(
  (select 'security_barrier=true' = any(coalesce(c.reloptions, '{}'))
     from pg_class c where c.oid = 'public.public_accounts'::regclass),
  'FR-2: public_accounts is a security_barrier view, so a caller''s function cannot see filtered rows'
);

select table_privs_are(
  'public', 'public_accounts', 'authenticated', array['SELECT'],
  'FR-4: authenticated may only SELECT public_accounts'
);

select table_privs_are(
  'public', 'public_accounts', 'anon', array['SELECT'],
  'FR-4: anon may only SELECT public_accounts'
);

select makerkit.authenticate_as('kb60_stranger');

select results_eq(
  $$ select id, name::text, slug from public.public_accounts
      where id in ('60000000-0000-4000-8000-000000000001',
                   '60000000-0000-4000-8000-000000000002',
                   current_setting('kb60.solo')::uuid) $$,
  $$ values ('60000000-0000-4000-8000-000000000001'::uuid, 'KB-60 Public Co', 'kb60-public-co') $$,
  'FR-2/3: a stranger sees the public team through the view, and not the private team or the public personal account'
);

select is(
  (select public_profile->>'display_name' from public.public_accounts
    where slug = 'kb60-public-co'),
  'Public Co',
  'FR-2: the public profile the company page renders is readable through the view'
);

select throws_ok(
  $$ update public.public_accounts set name = 'hijacked'
      where id = '60000000-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'FR-4: a stranger cannot write through the view'
);

select throws_ok(
  $$ delete from public.public_accounts
      where id = '60000000-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'FR-4: a stranger cannot delete through the view'
);

select makerkit.authenticate_as('kb60_team_owner');

select throws_ok(
  $$ update public.public_accounts set name = 'renamed'
      where id = '60000000-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'FR-4: even a member cannot write through the view (it would skip accounts'' RLS)'
);

set local role postgres;

select is(
  (select name::text from public.accounts where id = '60000000-0000-4000-8000-000000000001'),
  'KB-60 Public Co',
  'FR-4: the public account is unchanged after the refused writes'
);

select * from finish();

rollback;
