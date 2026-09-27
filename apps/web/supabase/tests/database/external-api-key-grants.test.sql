begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-84. `external_api_keys_read` lets every role on an account read its
-- rows, and `authenticated` held SELECT on the whole table, so any member —
-- a project viewer included — could select `encrypted_key` through
-- PostgREST. Members now read every column but the ciphertext.
--
-- The owner's decision (2026-09-25): only account owners add, replace or
-- remove a key — the primary owner (a personal account has no membership
-- row) or a member with the `owner` role. Every other role still sees which
-- providers are configured.
--
-- Seed roles on `storybook`: test@ is its primary owner, owner@ holds the
-- owner role (not primary), member@ is a member, custom@ a custom role.
select plan(21);

select makerkit.set_identifier('member', 'member@storybook.dev');
select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('custom', 'custom@storybook.dev');
select makerkit.set_identifier('test', 'test@storybook.dev');
select tests.create_supabase_user('kb84_viewer', 'kb84-viewer@example.com');
select tests.create_supabase_user('kb84_stranger', 'kb84-stranger@example.com');

set local role postgres;

insert into public.external_api_keys (account_id, provider, encrypted_key)
values (makerkit.get_account_id_by_slug('storybook'), 'hailuo', 'enc-kb84');

-- A project viewer: a member of the account with the viewer role on one of
-- its projects (#337 stopped this role spending a key; it could still read it).
insert into public.accounts_memberships (user_id, account_id, account_role)
values (tests.get_supabase_uid('kb84_viewer'), makerkit.get_account_id_by_slug('storybook'), 'member');

select makerkit.authenticate_as('owner');
insert into public.projects (id, account_id, name, created_by)
values ('84848484-0000-4000-8000-000000000001', makerkit.get_account_id_by_slug('storybook'),
        'kb84', auth.uid());

set local role postgres;
insert into public.project_members (project_id, user_id, role)
values ('84848484-0000-4000-8000-000000000001', tests.get_supabase_uid('kb84_viewer'), 'viewer');

-- ==================================
-- Nobody on the account reads the ciphertext
-- ==================================

select makerkit.authenticate_as('member');

select throws_ok(
  $$ select encrypted_key from public.external_api_keys where provider = 'hailuo' $$,
  '42501', null,
  'KB-84: a member cannot select encrypted_key'
);

select throws_ok(
  $$ select * from public.external_api_keys where provider = 'hailuo' $$,
  '42501', null,
  'KB-84: select * is refused too, because it names encrypted_key'
);

select results_eq(
  $$ select provider::text, is_active from public.external_api_keys where provider = 'hailuo' $$,
  $$ values ('hailuo', true) $$,
  'KB-84: a member still sees which providers are configured'
);

select tests.authenticate_as('kb84_viewer');

select throws_ok(
  $$ select encrypted_key from public.external_api_keys where provider = 'hailuo' $$,
  '42501', null,
  'KB-84: a project viewer cannot select encrypted_key'
);

select makerkit.authenticate_as('owner');

select throws_ok(
  $$ select encrypted_key from public.external_api_keys where provider = 'hailuo' $$,
  '42501', null,
  'KB-84: an owner cannot select it through the API either (the server decrypts)'
);

set local role postgres;

-- Every column but the ciphertext is readable. Written as a rule, not a list:
-- a column added later that nobody granted fails here, and so does one
-- granted back by a blanket `grant select on ... to authenticated`.
select is(
  (select array_agg(column_name::text order by column_name)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'external_api_keys'
      and has_column_privilege('authenticated', 'public.external_api_keys', column_name, 'SELECT')
          = (column_name = 'encrypted_key')),
  null,
  'KB-84: authenticated reads every column except encrypted_key (lists the columns that break the rule)'
);

select ok(
  has_column_privilege('service_role', 'public.external_api_keys', 'encrypted_key', 'SELECT')
  and has_table_privilege('service_role', 'public.external_api_keys', 'SELECT, INSERT, UPDATE, DELETE'),
  'KB-84: the service role still reads and writes keys (the helper, the voice and llm workers)'
);

-- ==================================
-- Only owners write
-- ==================================

select makerkit.authenticate_as('member');

select throws_ok(
  $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
     values (makerkit.get_account_id_by_slug('storybook'), 'runway', 'enc-member') $$,
  '42501', null,
  'Owner decision: a member cannot add a key'
);

update public.external_api_keys set encrypted_key = 'enc-member' where provider = 'hailuo';
delete from public.external_api_keys where provider = 'hailuo';

-- Why the app's save goes through the admin client: an upsert reads
-- encrypted_key back through EXCLUDED. Refused even before the policy.
select throws_ok(
  $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
     values (makerkit.get_account_id_by_slug('storybook'), 'hailuo', 'enc-upsert')
     on conflict (account_id, provider)
     do update set encrypted_key = excluded.encrypted_key $$,
  '42501', null,
  'KB-84: a member cannot upsert a key directly (the app stores through the admin client)'
);

select makerkit.authenticate_as('custom');
update public.external_api_keys set encrypted_key = 'enc-custom' where provider = 'hailuo';

select tests.authenticate_as('kb84_viewer');
update public.external_api_keys set is_active = false where provider = 'hailuo';
delete from public.external_api_keys where provider = 'hailuo';

set local role postgres;

select results_eq(
  $$ select encrypted_key, is_active from public.external_api_keys
      where account_id = makerkit.get_account_id_by_slug('storybook') and provider = 'hailuo' $$,
  $$ values ('enc-kb84'::text, true) $$,
  'Owner decision: a member, a custom role and a project viewer changed and deleted nothing (UPDATE needs no SELECT, so the policy is the guard)'
);

-- The owner role (owner@ is not the primary owner) manages keys.
select makerkit.authenticate_as('owner');

select lives_ok(
  $$ update public.external_api_keys set encrypted_key = 'enc-owner' where provider = 'hailuo' $$,
  'Owner decision: a member with the owner role can replace a key'
);

select lives_ok(
  $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
     values (makerkit.get_account_id_by_slug('storybook'), 'runway', 'enc-owner-r') $$,
  'Owner decision: a member with the owner role can add a key'
);

select lives_ok(
  $$ delete from public.external_api_keys where provider = 'runway' $$,
  'Owner decision: a member with the owner role can remove a key'
);

set local role postgres;

select results_eq(
  $$ select provider::text, encrypted_key from public.external_api_keys
      where account_id = makerkit.get_account_id_by_slug('storybook') order by provider $$,
  $$ values ('hailuo', 'enc-owner'::text) $$,
  'Owner decision: the owner''s replace took effect and the removed key is gone'
);

-- Team accounts only (KB-99, owner decision 2026-09-25): a personal account
-- holds no workspace data, and so no key.
select makerkit.authenticate_as('member');

select throws_ok(
  $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
     values (auth.uid(), 'openai', 'enc-personal') $$,
  '23514', null,
  'Owner decision: a personal account holds no key (KB-99, team accounts only)'
);

-- An owner of one team cannot move its key onto another team they do not own.
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('84840000-0000-4000-8000-00000000000b', 'KB-84 other team', false,
        tests.get_supabase_uid('kb84_stranger'));

select makerkit.authenticate_as('owner');

select throws_ok(
  $$ update public.external_api_keys
        set account_id = '84840000-0000-4000-8000-00000000000b'
      where account_id = makerkit.get_account_id_by_slug('storybook')
        and provider = 'hailuo' $$,
  '42501', null,
  'Owner decision: an owner cannot move a key onto an account they do not own (WITH CHECK)'
);

-- ==================================
-- The rule, in one function
-- ==================================

select makerkit.authenticate_as('member');
select is(
  public.can_manage_account_api_keys(makerkit.get_account_id_by_slug('storybook')),
  false,
  'can_manage_account_api_keys: false for a member'
);

select makerkit.authenticate_as('owner');
select is(
  public.can_manage_account_api_keys(makerkit.get_account_id_by_slug('storybook')),
  true,
  'can_manage_account_api_keys: true for the owner role'
);

select makerkit.authenticate_as('test');
select is(
  public.can_manage_account_api_keys(makerkit.get_account_id_by_slug('storybook')),
  true,
  'can_manage_account_api_keys: true for the primary owner'
);

select tests.authenticate_as('kb84_stranger');
select is(
  public.can_manage_account_api_keys(makerkit.get_account_id_by_slug('storybook')),
  false,
  'can_manage_account_api_keys: false for someone with no role on the account'
);

set local role postgres;

select ok(
  not has_function_privilege('anon', 'public.can_manage_account_api_keys(uuid)', 'EXECUTE'),
  'can_manage_account_api_keys: anon cannot call it'
);

select * from finish();

rollback;
