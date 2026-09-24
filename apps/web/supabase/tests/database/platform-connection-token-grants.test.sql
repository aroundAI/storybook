begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-43. `platform_connections_read` lets any member of an account read the
-- account's connections, and `authenticated` held SELECT on the whole table,
-- so any member could select the encrypted OAuth tokens through PostgREST.
-- Nothing a member does needs them: every decrypt happens on the server,
-- which uses the service role. Members now read every column but the two
-- token columns.
--
-- KB-44. `anon` held every privilege on `platform_connections`, including
-- TRUNCATE, which row-level security does not apply to. It now holds none.
-- The class: no API role holds TRUNCATE, TRIGGER or REFERENCES on any public
-- table, and tables created later do not get them by default either.
select plan(16);

select makerkit.set_identifier('member', 'member@storybook.dev');

set local role postgres;

insert into public.platform_connections
  (id, account_id, platform, platform_account_id, platform_account_name,
   access_token_encrypted, refresh_token_encrypted, token_expires_at, metadata)
values
  ('43434343-0000-4000-8000-00000000000a', makerkit.get_account_id_by_slug('storybook'), 'youtube',
   'UC-kb43-A', 'Channel A', 'enc-access-a', 'enc-refresh-a', now() + interval '1 hour', '{}');

-- ==================================
-- KB-43: a member cannot read the tokens
-- ==================================

select makerkit.authenticate_as('member');

select throws_ok(
  $$ select access_token_encrypted from public.platform_connections
      where id = '43434343-0000-4000-8000-00000000000a' $$,
  '42501', null,
  'KB-43: a member cannot select access_token_encrypted'
);

select throws_ok(
  $$ select refresh_token_encrypted from public.platform_connections
      where id = '43434343-0000-4000-8000-00000000000a' $$,
  '42501', null,
  'KB-43: a member cannot select refresh_token_encrypted'
);

select throws_ok(
  $$ select * from public.platform_connections
      where id = '43434343-0000-4000-8000-00000000000a' $$,
  '42501', null,
  'KB-43: select * is refused too, because it names the token columns'
);

select results_eq(
  $$ select id, platform::text, platform_account_name::text, is_active
       from public.platform_connections
      where id = '43434343-0000-4000-8000-00000000000a' $$,
  $$ values ('43434343-0000-4000-8000-00000000000a'::uuid, 'youtube', 'Channel A', true) $$,
  'KB-43: a member still reads the connection''s other columns'
);

select lives_ok(
  $$ update public.platform_connections set language = 'en'
      where id = '43434343-0000-4000-8000-00000000000a' $$,
  'KB-43: a member can still set a connection''s language'
);

-- Why the OAuth callbacks write through the admin client after an explicit
-- has_account_access check: an upsert reads the token columns back through
-- EXCLUDED, which needs SELECT on them.
select throws_ok(
  $$ insert into public.platform_connections
       (account_id, platform, platform_account_id, platform_account_name,
        access_token_encrypted, metadata)
     values (makerkit.get_account_id_by_slug('storybook'), 'youtube', 'UC-kb43-A',
             'Channel A', 'enc-new', '{}')
     on conflict (account_id, platform, platform_account_id)
     do update set access_token_encrypted = excluded.access_token_encrypted $$,
  '42501', null,
  'KB-43: a member cannot upsert tokens directly (the callbacks use the admin client)'
);

set local role postgres;

-- Every column but the two tokens is readable. Written as a rule, not a list:
-- a column added later that nobody granted fails here, and so does one
-- granted by a blanket `grant select on ... to authenticated`.
select is(
  (select array_agg(column_name::text order by column_name)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_connections'
      and has_column_privilege('authenticated', 'public.platform_connections', column_name, 'SELECT')
          = (column_name in ('access_token_encrypted', 'refresh_token_encrypted'))),
  null,
  'KB-43: authenticated reads every column except the two token columns (lists the columns that break the rule)'
);

select ok(
  has_column_privilege('service_role', 'public.platform_connections', 'access_token_encrypted', 'SELECT')
  and has_column_privilege('service_role', 'public.platform_connections', 'refresh_token_encrypted', 'SELECT')
  and has_table_privilege('service_role', 'public.platform_connections', 'SELECT, INSERT, UPDATE'),
  'KB-43: the service role still reads and writes the tokens (refresh, publish worker, revoke)'
);

-- ==================================
-- KB-44: anon holds nothing on the table
-- ==================================

select is(
  (select array_agg(privilege_type::text order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'platform_connections'
      and grantee = 'anon'),
  null,
  'KB-44: anon holds no privilege on platform_connections'
);

select is(
  (select count(*)::int
     from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'platform_connections'
      and has_column_privilege('anon', 'public.platform_connections', c.column_name,
                               'SELECT, INSERT, UPDATE, REFERENCES')),
  0,
  'KB-44: anon holds no column privilege on platform_connections'
);

select ok(
  not has_table_privilege('anon', 'public.platform_connections', 'TRUNCATE'),
  'KB-44: anon cannot truncate platform_connections'
);

-- ==================================
-- KB-44, the class: TRUNCATE, TRIGGER and REFERENCES
-- ==================================
-- No client reaches these through PostgREST, and TRUNCATE skips row-level
-- security entirely. Tables, views and every other relation kind in public.

select is(
  (select array_agg(format('%s %s %s', r.role, p.privilege, c.relname) order by c.relname, r.role, p.privilege)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['anon', 'authenticated']) r(role)
     cross join unnest(array['TRUNCATE', 'TRIGGER', 'REFERENCES']) p(privilege)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege(r.role, c.oid, p.privilege)),
  null,
  'KB-44: anon and authenticated hold no TRUNCATE, TRIGGER or REFERENCES on any public relation (lists offenders)'
);

select is(
  (select count(*)::int
     from pg_default_acl d
     cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole = 'postgres'::regrole
      and d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'r'
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
      and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')),
  0,
  'KB-44: postgres''s default privileges in public no longer grant TRUNCATE, TRIGGER or REFERENCES to anon or authenticated'
);

-- The default privileges, exercised: a table created now, as migrations
-- create them.
create table public.kb44_probe (id int);

select ok(
  not has_table_privilege('anon', 'public.kb44_probe', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.kb44_probe', 'TRUNCATE'),
  'KB-44: a table created later does not hand anon or authenticated TRUNCATE'
);

select ok(
  not has_table_privilege('anon', 'public.kb44_probe', 'TRIGGER')
  and not has_table_privilege('anon', 'public.kb44_probe', 'REFERENCES'),
  'KB-44: nor TRIGGER or REFERENCES'
);

-- The ordinary grants are Supabase's to keep: this fix removes only the three.
select ok(
  has_table_privilege('authenticated', 'public.kb44_probe', 'SELECT, INSERT, UPDATE, DELETE'),
  'KB-44: a new table still gets the ordinary grants RLS governs'
);

select * from finish();
rollback;
