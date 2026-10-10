begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(30);

-- FILM-1904. An MCP connection is one user's grant inside one team. The user
-- reads and revokes their own connections and nothing else about them; token
-- hashes are reachable by the service role only; a team's owners read what
-- connected apps did (mcp_tool_calls); and the one door a user has to create
-- a personal access token checks that they belong to the team it is bound
-- to. Fixture ids start with 19040000.

select tests.create_supabase_user('mcp_alice', 'mcp-alice@storybook.dev');
select tests.create_supabase_user('mcp_bob', 'mcp-bob@storybook.dev');
select tests.create_supabase_user('mcp_member', 'mcp-member@storybook.dev');

set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id) values
  ('19040000-0000-4000-8000-00000000000a', 'FILM-1904 team A', false, tests.get_supabase_uid('mcp_alice')),
  ('19040000-0000-4000-8000-00000000000b', 'FILM-1904 team B', false, tests.get_supabase_uid('mcp_bob'));

insert into public.accounts_memberships (user_id, account_id, account_role) values
  (tests.get_supabase_uid('mcp_alice'), '19040000-0000-4000-8000-00000000000a', 'owner'),
  (tests.get_supabase_uid('mcp_member'), '19040000-0000-4000-8000-00000000000a', 'member'),
  (tests.get_supabase_uid('mcp_bob'), '19040000-0000-4000-8000-00000000000b', 'owner')
on conflict do nothing;

insert into public.mcp_connections (id, user_id, account_id, kind, name, scopes) values
  ('19040000-0000-4000-8000-000000000001', tests.get_supabase_uid('mcp_alice'),
   '19040000-0000-4000-8000-00000000000a', 'pat', 'alice laptop', array['studio:read']),
  ('19040000-0000-4000-8000-000000000002', tests.get_supabase_uid('mcp_bob'),
   '19040000-0000-4000-8000-00000000000b', 'pat', 'bob laptop', array['studio:read', 'studio:write']);

insert into public.mcp_tokens (token_hash, connection_id, kind) values
  (repeat('a', 64), '19040000-0000-4000-8000-000000000001', 'pat'),
  (repeat('b', 64), '19040000-0000-4000-8000-000000000002', 'pat');

insert into public.mcp_tool_calls (connection_id, user_id, account_id, tool, status, duration_ms) values
  ('19040000-0000-4000-8000-000000000001', tests.get_supabase_uid('mcp_alice'),
   '19040000-0000-4000-8000-00000000000a', 'whoami', 'ok', 12),
  ('19040000-0000-4000-8000-000000000002', tests.get_supabase_uid('mcp_bob'),
   '19040000-0000-4000-8000-00000000000b', 'whoami', 'ok', 9);

-- ==================================
-- Shape
-- ==================================

select policies_are(
  'public', 'mcp_connections', array['mcp_connections_read', 'mcp_connections_revoke'],
  'mcp_connections has a read policy and a revoke policy, nothing else'
);

select policy_cmd_is(
  'public', 'mcp_connections', 'mcp_connections_revoke', 'update',
  'the revoke policy is an UPDATE policy'
);

select policies_are(
  'public', 'mcp_tokens', array[]::text[],
  'mcp_tokens has no policy: the service role alone reaches it'
);

select table_privs_are(
  'public', 'mcp_tokens', 'authenticated', array[]::text[],
  'authenticated holds no privilege on mcp_tokens'
);

select policies_are(
  'public', 'mcp_tool_calls', array['mcp_tool_calls_read'],
  'mcp_tool_calls has one read policy'
);

select column_privs_are(
  'public', 'mcp_connections', 'revoked_at', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated may update revoked_at'
);

select column_privs_are(
  'public', 'mcp_connections', 'name', 'authenticated', array['SELECT'],
  'authenticated may not update a connection''s name'
);

select column_privs_are(
  'public', 'mcp_connections', 'scopes', 'authenticated', array['SELECT'],
  'authenticated may not update a connection''s scopes'
);

-- ==================================
-- A user reads and revokes their own connections
-- ==================================

select makerkit.authenticate_as('mcp_alice');

select results_eq(
  $$ select id from public.mcp_connections order by id $$,
  $$ values ('19040000-0000-4000-8000-000000000001'::uuid) $$,
  'alice reads her own connection and not bob''s'
);

select results_eq(
  $$ update public.mcp_connections set revoked_at = now()
      where id = '19040000-0000-4000-8000-000000000001'
      returning revoked_at is not null $$,
  $$ values (true) $$,
  'alice revokes her own connection'
);

-- Alice's revoke of bob's connection: RLS hides the row, so the update
-- touches nothing (asserted as postgres below, once her session is over).
update public.mcp_connections set revoked_at = now()
 where id = '19040000-0000-4000-8000-000000000002';

select throws_ok(
  $$ update public.mcp_connections set name = 'renamed'
      where id = '19040000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'alice cannot rename her connection: only revoked_at is updatable'
);

select throws_ok(
  $$ insert into public.mcp_connections (user_id, account_id, kind, name, scopes)
     values (auth.uid(), '19040000-0000-4000-8000-00000000000a', 'pat', 'direct', '{}') $$,
  '42501', null,
  'a user cannot insert a connection directly'
);

select throws_ok(
  $$ delete from public.mcp_connections where id = '19040000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a user cannot delete a connection'
);

select throws_ok(
  $$ select token_hash from public.mcp_tokens $$,
  '42501', null,
  'a user cannot read token hashes'
);

select throws_ok(
  $$ insert into public.mcp_tokens (token_hash, connection_id, kind)
     values (repeat('c', 64), '19040000-0000-4000-8000-000000000001', 'pat') $$,
  '42501', null,
  'a user cannot insert a token'
);

select throws_ok(
  $$ insert into public.mcp_tool_calls (account_id, tool, status, duration_ms)
     values ('19040000-0000-4000-8000-00000000000a', 'whoami', 'ok', 1) $$,
  '42501', null,
  'a user cannot write an audit row'
);

-- A member of the same team who did not create the connection does not see it
select makerkit.authenticate_as('mcp_member');

select is(
  (select count(*)::int from public.mcp_connections),
  0,
  'a teammate who is not the connection''s user does not see it'
);

-- ==================================
-- Team owners read the audit log
-- ==================================

select makerkit.authenticate_as('mcp_alice');

select results_eq(
  $$ select account_id from public.mcp_tool_calls $$,
  $$ values ('19040000-0000-4000-8000-00000000000a'::uuid) $$,
  'an owner reads their team''s tool calls and no other team''s'
);

select makerkit.authenticate_as('mcp_member');

select is(
  (select count(*)::int from public.mcp_tool_calls),
  0,
  'a member who is not an owner reads no tool calls'
);

-- ==================================
-- create_mcp_personal_access_token
-- ==================================

select makerkit.authenticate_as('mcp_member');

select results_eq(
  $$ select kind, user_id = auth.uid(), account_id, scopes
       from public.create_mcp_personal_access_token(
         '19040000-0000-4000-8000-00000000000a', 'member cli',
         array['studio:read', 'studio:write'], repeat('d', 64)) $$,
  $$ values ('pat'::text, true, '19040000-0000-4000-8000-00000000000a'::uuid,
             array['studio:read', 'studio:write']) $$,
  'a member creates a personal access token for their team, bound to themselves'
);

select throws_ok(
  $$ select public.create_mcp_personal_access_token(
       '19040000-0000-4000-8000-00000000000b', 'not my team', array['studio:read'], repeat('e', 64)) $$,
  '42501', null,
  'a token for a team the caller does not belong to is refused'
);

set local role postgres;

select is(
  (select revoked_at is null from public.mcp_connections
    where id = '19040000-0000-4000-8000-000000000002'),
  true,
  'alice''s revoke of bob''s connection changed nothing'
);

select results_eq(
  $$ select t.kind, t.expires_at is null, c.name
       from public.mcp_tokens t join public.mcp_connections c on c.id = t.connection_id
      where t.token_hash = repeat('d', 64) $$,
  $$ values ('pat'::text, true, 'member cli'::text) $$,
  'the function stored the hash against the new connection, with no expiry'
);

select is(
  (select count(*)::int from public.mcp_tokens where token_hash = repeat('e', 64)),
  0,
  'the refused call left no token behind'
);

-- ==================================
-- CHECK constraints
-- ==================================

select throws_ok(
  $$ insert into public.mcp_connections (user_id, account_id, kind, name, scopes)
     values (tests.get_supabase_uid('mcp_alice'), '19040000-0000-4000-8000-00000000000a',
             'pat', 'bad scope', array['studio:admin']) $$,
  '23514', null,
  'a scope outside studio:read, studio:write, studio:render, studio:publish is refused'
);

select lives_ok(
  $$ insert into public.mcp_connections (user_id, account_id, kind, name, scopes)
     values (tests.get_supabase_uid('mcp_alice'), '19040000-0000-4000-8000-00000000000a',
             'pat', 'publish scope', array['studio:read', 'studio:publish']) $$,
  'studio:publish may be granted (owner, 2026-10-10)'
);

select throws_ok(
  $$ insert into public.mcp_tokens (token_hash, connection_id, kind)
     values ('not-a-sha256', '19040000-0000-4000-8000-000000000001', 'pat') $$,
  '23514', null,
  'a token hash that is not 64 hex characters is refused'
);

select throws_ok(
  $$ insert into public.mcp_tool_calls (account_id, tool, status, error_code, duration_ms)
     values ('19040000-0000-4000-8000-00000000000a', 'whoami', 'ok', 'INTERNAL', 1) $$,
  '23514', null,
  'an ok call cannot carry an error code'
);

-- ==================================
-- Team accounts only (KB-99): no connection or audit row on a personal account
-- ==================================

select throws_ok(
  $$ insert into public.mcp_connections (user_id, account_id, kind, name, scopes)
     values (tests.get_supabase_uid('mcp_alice'), tests.get_supabase_uid('mcp_alice'),
             'pat', 'personal', array['studio:read']) $$,
  '23514', null,
  'a connection cannot be bound to a personal account, even by the service role'
);

select throws_ok(
  $$ insert into public.mcp_tool_calls (account_id, tool, status, duration_ms)
     values (tests.get_supabase_uid('mcp_alice'), 'whoami', 'ok', 1) $$,
  '23514', null,
  'an audit row cannot name a personal account'
);

select * from finish();

rollback;
