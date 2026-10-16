begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(29);

-- FILM-1907. The OAuth server's two tables are reachable by the service role
-- only; a consent connection names a registered client; a code carries a
-- well-formed PKCE challenge and only known scopes; a password change ends
-- every MCP grant of that user and nothing of anyone else's; deleting the
-- user takes their codes and connections with them. Fixture ids start with
-- 19070000.

select tests.create_supabase_user('oauth_alice', 'oauth-alice@storybook.dev');
select tests.create_supabase_user('oauth_bob', 'oauth-bob@storybook.dev');

set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id) values
  ('19070000-0000-4000-8000-00000000000a', 'FILM-1907 team A', false, tests.get_supabase_uid('oauth_alice'));

insert into public.accounts_memberships (user_id, account_id, account_role) values
  (tests.get_supabase_uid('oauth_alice'), '19070000-0000-4000-8000-00000000000a', 'owner'),
  (tests.get_supabase_uid('oauth_bob'), '19070000-0000-4000-8000-00000000000a', 'member')
on conflict do nothing;

insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris) values
  ('client-registered', 'Claude', array['https://claude.ai/api/mcp/auth_callback']);

insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris, metadata_url) values
  ('https://claude.ai/.well-known/oauth-client', 'Claude (metadata document)',
   array['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/.well-known/oauth-client');

-- ==================================
-- Shape and access
-- ==================================

select policies_are(
  'public', 'mcp_oauth_clients', array[]::text[],
  'mcp_oauth_clients has no policy: the service role alone reaches it'
);

select policies_are(
  'public', 'mcp_authorization_codes', array[]::text[],
  'mcp_authorization_codes has no policy: the service role alone reaches it'
);

select table_privs_are(
  'public', 'mcp_oauth_clients', 'authenticated', array[]::text[],
  'authenticated holds no privilege on mcp_oauth_clients'
);

select table_privs_are(
  'public', 'mcp_authorization_codes', 'authenticated', array[]::text[],
  'authenticated holds no privilege on mcp_authorization_codes'
);

select table_privs_are(
  'public', 'mcp_oauth_clients', 'anon', array[]::text[],
  'anon holds no privilege on mcp_oauth_clients'
);

select has_column(
  'public', 'mcp_tokens', 'audience',
  'mcp_tokens records the resource a token is bound to'
);

select fk_ok(
  'public', 'mcp_connections', 'client_id',
  'public', 'mcp_oauth_clients', 'client_id',
  'a connection''s client_id references a registered client'
);

select fk_ok(
  'public', 'mcp_authorization_codes', 'user_id',
  'auth', 'users', 'id',
  'a code''s user_id references auth.users'
);

select function_privs_are(
  'kit', 'revoke_mcp_grants_on_password_change', array[]::text[], 'authenticated', array[]::text[],
  'authenticated cannot execute the password-change trigger function'
);

select function_privs_are(
  'kit', 'revoke_mcp_tokens_of_connection', array[]::text[], 'authenticated', array[]::text[],
  'authenticated cannot execute the connection-revoked trigger function'
);

-- ==================================
-- Constraints
-- ==================================

select throws_ok(
  $$ insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris)
     values ('no-redirects', 'Bad', array[]::text[]) $$,
  '23514', null,
  'a client needs at least one redirect URI'
);

select throws_ok(
  $$ insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris, metadata_url)
     values ('http://plain.example/client', 'Plain', array['http://plain.example/cb'], 'http://plain.example/client') $$,
  '23514', null,
  'a client metadata document URL must be https'
);

select throws_ok(
  $$ insert into public.mcp_connections (user_id, account_id, client_id, kind, name, scopes)
     values (tests.get_supabase_uid('oauth_alice'), '19070000-0000-4000-8000-00000000000a',
             'never-registered', 'oauth', 'Claude', array['studio:read']) $$,
  '23503', null,
  'a consent connection for an unregistered client is refused'
);

select throws_ok(
  $$ insert into public.mcp_connections (user_id, account_id, kind, name, scopes)
     values (tests.get_supabase_uid('oauth_alice'), '19070000-0000-4000-8000-00000000000a',
             'oauth', 'Claude', array['studio:read']) $$,
  '23514', null,
  'a consent connection without a client is refused'
);

select lives_ok(
  $$ insert into public.mcp_authorization_codes
       (code_hash, client_id, user_id, account_id, scopes, code_challenge, redirect_uri, resource, expires_at)
     values (repeat('1', 64), 'client-registered', tests.get_supabase_uid('oauth_alice'),
             '19070000-0000-4000-8000-00000000000a', array['studio:read'],
             repeat('E', 43), 'https://claude.ai/api/mcp/auth_callback',
             'http://localhost:3000/api/mcp', now() + interval '60 seconds') $$,
  'a well-formed code is stored'
);

select throws_ok(
  $$ insert into public.mcp_authorization_codes
       (code_hash, client_id, user_id, account_id, scopes, code_challenge, redirect_uri, resource, expires_at)
     values (repeat('2', 64), 'client-registered', tests.get_supabase_uid('oauth_alice'),
             '19070000-0000-4000-8000-00000000000a', array['studio:read'],
             'short', 'https://claude.ai/api/mcp/auth_callback',
             'http://localhost:3000/api/mcp', now() + interval '60 seconds') $$,
  '23514', null,
  'a PKCE challenge that is not 43 base64url characters is refused'
);

select throws_ok(
  $$ insert into public.mcp_authorization_codes
       (code_hash, client_id, user_id, account_id, scopes, code_challenge, redirect_uri, resource, expires_at)
     values (repeat('3', 64), 'client-registered', tests.get_supabase_uid('oauth_alice'),
             '19070000-0000-4000-8000-00000000000a', array['studio:admin'],
             repeat('E', 43), 'https://claude.ai/api/mcp/auth_callback',
             'http://localhost:3000/api/mcp', now() + interval '60 seconds') $$,
  '23514', null,
  'a code with a scope outside studio:read, studio:write, studio:render, studio:publish is refused'
);

-- A grant is to a team: a code for the user's personal account is refused (KB-99)
select throws_ok(
  $$ insert into public.mcp_authorization_codes
       (code_hash, client_id, user_id, account_id, scopes, code_challenge, redirect_uri, resource, expires_at)
     values (repeat('4', 64), 'client-registered', tests.get_supabase_uid('oauth_alice'),
             tests.get_supabase_uid('oauth_alice'), array['studio:read'],
             repeat('E', 43), 'https://claude.ai/api/mcp/auth_callback',
             'http://localhost:3000/api/mcp', now() + interval '60 seconds') $$,
  '23514', null,
  'a code bound to a personal account is refused'
);

select throws_ok(
  $$ insert into public.mcp_authorization_codes
       (code_hash, client_id, user_id, account_id, scopes, code_challenge, redirect_uri, resource, expires_at)
     values ('not-a-hash', 'client-registered', tests.get_supabase_uid('oauth_alice'),
             '19070000-0000-4000-8000-00000000000a', array['studio:read'],
             repeat('E', 43), 'https://claude.ai/api/mcp/auth_callback',
             'http://localhost:3000/api/mcp', now() + interval '60 seconds') $$,
  '23514', null,
  'a code hash that is not 64 hex characters is refused'
);

-- ==================================
-- A password change revokes the user's grants
-- ==================================

insert into public.mcp_connections (id, user_id, account_id, client_id, kind, name, scopes) values
  ('19070000-0000-4000-8000-000000000001', tests.get_supabase_uid('oauth_alice'),
   '19070000-0000-4000-8000-00000000000a', 'client-registered', 'oauth', 'Claude', array['studio:read']),
  ('19070000-0000-4000-8000-000000000002', tests.get_supabase_uid('oauth_alice'),
   '19070000-0000-4000-8000-00000000000a', null, 'pat', 'alice laptop', array['studio:read']),
  ('19070000-0000-4000-8000-000000000003', tests.get_supabase_uid('oauth_bob'),
   '19070000-0000-4000-8000-00000000000a', 'client-registered', 'oauth', 'Claude', array['studio:read']);

insert into public.mcp_tokens (token_hash, connection_id, kind, expires_at, audience) values
  (repeat('a', 64), '19070000-0000-4000-8000-000000000001', 'access', now() + interval '1 hour', 'http://localhost:3000/api/mcp'),
  (repeat('b', 64), '19070000-0000-4000-8000-000000000001', 'refresh', now() + interval '30 days', 'http://localhost:3000/api/mcp'),
  (repeat('c', 64), '19070000-0000-4000-8000-000000000002', 'pat', null, null),
  (repeat('d', 64), '19070000-0000-4000-8000-000000000003', 'access', now() + interval '1 hour', 'http://localhost:3000/api/mcp');

-- An update that does not change the password changes nothing
update auth.users set email = 'oauth-alice-renamed@storybook.dev'
 where id = tests.get_supabase_uid('oauth_alice');

update auth.users set encrypted_password = encrypted_password
 where id = tests.get_supabase_uid('oauth_alice');

select is(
  (select count(*)::int from public.mcp_connections
    where user_id = tests.get_supabase_uid('oauth_alice') and revoked_at is not null),
  0,
  'an email change, or a password write with the same value, revokes nothing'
);

update auth.users set encrypted_password = 'a-new-hash'
 where id = tests.get_supabase_uid('oauth_alice');

select is(
  (select count(*)::int from public.mcp_connections
    where user_id = tests.get_supabase_uid('oauth_alice') and revoked_at is null),
  0,
  'a password change revokes every connection of that user, consent and personal access token alike'
);

select is(
  (select count(*)::int from public.mcp_tokens t
     join public.mcp_connections c on c.id = t.connection_id
    where c.user_id = tests.get_supabase_uid('oauth_alice') and t.revoked_at is null),
  0,
  'a password change revokes every token of that user'
);

select is(
  (select revoked_at is null from public.mcp_connections
    where id = '19070000-0000-4000-8000-000000000003'),
  true,
  'bob''s connection is untouched by alice''s password change'
);

select is(
  (select revoked_at is null from public.mcp_tokens where token_hash = repeat('d', 64)),
  true,
  'bob''s token is untouched by alice''s password change'
);

-- ==================================
-- Revoking a connection, as the user does from Connected apps, revokes its tokens
-- ==================================

select makerkit.authenticate_as('oauth_bob');

update public.mcp_connections set revoked_at = now()
 where id = '19070000-0000-4000-8000-000000000003';

select is(
  (select revoked_at is not null from public.mcp_connections
    where id = '19070000-0000-4000-8000-000000000003'),
  true,
  'bob revokes his own consent connection'
);

set local role postgres;

select is(
  (select revoked_at is not null from public.mcp_tokens where token_hash = repeat('d', 64)),
  true,
  'revoking the connection revoked its token, which bob himself may not touch'
);

-- ==================================
-- Deleting the user removes their codes and connections
-- ==================================

insert into public.mcp_authorization_codes
  (code_hash, client_id, user_id, account_id, scopes, code_challenge, redirect_uri, resource, expires_at)
values (repeat('9', 64), 'client-registered', tests.get_supabase_uid('oauth_bob'),
        '19070000-0000-4000-8000-00000000000a', array['studio:read'],
        repeat('E', 43), 'https://claude.ai/api/mcp/auth_callback',
        'http://localhost:3000/api/mcp', now() + interval '60 seconds');

-- An uncorrelated subquery: evaluated once, before the row is gone
delete from auth.users where id = (select tests.get_supabase_uid('oauth_bob'));

select is(
  (select count(*)::int from public.mcp_authorization_codes where code_hash = repeat('9', 64)),
  0,
  'deleting the user deletes their authorization codes'
);

select is(
  (select count(*)::int from public.mcp_connections
    where id = '19070000-0000-4000-8000-000000000003'),
  0,
  'deleting the user deletes their connections'
);

select is(
  (select count(*)::int from public.mcp_tokens where token_hash = repeat('d', 64)),
  0,
  'deleting the user deletes their tokens through the connection'
);

select * from finish();

rollback;
