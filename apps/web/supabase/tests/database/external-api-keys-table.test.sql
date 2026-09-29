begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(14);

-- FILM-101n (external_api_keys). The table's own rules: the provider list,
-- one key per account and provider, the defaults, and the ways a key is
-- deactivated, reactivated and rotated. Who may read or write a row is
-- external-api-key-grants.test.sql's subject, not this file's. Fixture ids
-- start with 101d.

select tests.create_supabase_user('ak_owner_a', 'ak-owner-a@storybook.dev');
select tests.create_supabase_user('ak_owner_b', 'ak-owner-b@storybook.dev');

select makerkit.authenticate_as('ak_owner_a');
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id) values
  ('101d0000-0000-4000-8000-00000000000a', 'FILM-101n team A', false, tests.get_supabase_uid('ak_owner_a')),
  ('101d0000-0000-4000-8000-00000000000b', 'FILM-101n team B', false, tests.get_supabase_uid('ak_owner_b'));

select lives_ok(
  $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
     values ('101d0000-0000-4000-8000-00000000000a', 'elevenlabs', 'enc:aaa') $$,
  'a key for a listed provider is accepted'
);

select throws_ok(
  $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
     values ('101d0000-0000-4000-8000-00000000000a', 'midjourney', 'enc:bbb') $$,
  '23514', null,
  'a provider outside the list is refused'
);

select throws_ok(
  $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
     values ('101d0000-0000-4000-8000-00000000000a', 'elevenlabs', 'enc:ccc') $$,
  '23505', null,
  'a second key for the same account and provider is refused'
);

select lives_ok(
  $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
     values ('101d0000-0000-4000-8000-00000000000a', 'openai', 'enc:ddd') $$,
  'the same account may hold a key for another provider'
);

select lives_ok(
  $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
     values ('101d0000-0000-4000-8000-00000000000b', 'elevenlabs', 'enc:eee') $$,
  'another account may hold a key for the same provider'
);

select is(
  (select count(*)::int from public.external_api_keys where provider = 'elevenlabs'
     and account_id in ('101d0000-0000-4000-8000-00000000000a', '101d0000-0000-4000-8000-00000000000b')),
  2,
  'two accounts each hold their own elevenlabs key, with different values'
);

select ok(
  (select created_at between now() - interval '1 minute' and now() + interval '1 minute'
          and is_active
     from public.external_api_keys
    where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai'),
  'created_at fills itself in, and a new key is active'
);

select is(
  (select last_used_at from public.external_api_keys
    where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai'),
  null,
  'a key that was never used has no last_used_at'
);

update public.external_api_keys set last_used_at = now()
 where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai';

select isnt(
  (select last_used_at from public.external_api_keys
    where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai'),
  null,
  'using a key records last_used_at'
);

update public.external_api_keys set is_active = false
 where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai';

select is(
  (select is_active from public.external_api_keys
    where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai'),
  false,
  'a key can be deactivated'
);

update public.external_api_keys set is_active = true
 where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai';

select is(
  (select is_active from public.external_api_keys
    where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai'),
  true,
  'a deactivated key can be reactivated'
);

-- Rotation is an update in place: the unique (account_id, provider) means a
-- second row for the provider cannot be added beside the old key.
update public.external_api_keys
   set is_active = false
 where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai';
update public.external_api_keys
   set encrypted_key = 'enc:rotated', is_active = true, last_used_at = null
 where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai';

select results_eq(
  $$ select encrypted_key, is_active from public.external_api_keys
     where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'openai' $$,
  $$ values ('enc:rotated'::text, true) $$,
  'a key is rotated by replacing it on its row: deactivate, swap the key, reactivate'
);

select lives_ok(
  format(
    $$ insert into public.external_api_keys (account_id, provider, encrypted_key)
       values ('101d0000-0000-4000-8000-00000000000a', 'gemini', %L) $$,
    repeat('k', 2500)
  ),
  'a 2500-character encrypted key is accepted'
);

select is(
  (select length(encrypted_key) from public.external_api_keys
    where account_id = '101d0000-0000-4000-8000-00000000000a' and provider = 'gemini'),
  2500,
  'and comes back at full length'
);

select * from finish();
rollback;
