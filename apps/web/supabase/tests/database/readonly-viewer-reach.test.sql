begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(6);

-- KB-59. 20260205114500_create_readonly_viewer.sql created `readonly_viewer`
-- (SELECT on every public table, now and in future, by default privileges)
-- and `myfriends`, a LOGIN role with a password committed to the repo, as a
-- member of it. The owner ruled it a test user and that it stays as it is
-- (2026-09-23, reconfirmed 2026-09-24), so nothing here changes it.
--
-- Measured on 2026-09-24, logged in as myfriends: 91 relations selectable,
-- 0 rows visible in every one. It reads nothing only because every public
-- table has RLS and every policy that reaches it tests auth.uid(), which is
-- NULL for a direct login. This file keeps it that way: the day a table
-- ships without RLS, or a definer function becomes callable by PUBLIC, the
-- committed password reads it, and this fails first.

-- 1. The role is what the owner ruled on, and no more.
select results_eq(
  $$ select rolname::text collate "default", rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
       from pg_roles where rolname in ('myfriends', 'readonly_viewer') order by 1 $$,
  $$ values ('myfriends', true, false, false, false, false),
            ('readonly_viewer', false, false, false, false, false) $$,
  'myfriends logs in but is not superuser, does not bypass RLS and cannot create roles or databases'
);

select results_eq(
  $$ select r.rolname::text collate "default" from pg_auth_members m
       join pg_roles r on r.oid = m.roleid
      where m.member = 'myfriends'::regrole order by 1 $$,
  $$ values ('readonly_viewer') $$,
  'myfriends is a member of readonly_viewer and of nothing else'
);

-- 2. Every public relation it can read is behind RLS. Tables must have RLS
-- on; views must run as the caller (security_invoker) so the underlying
-- tables' RLS applies. public_accounts is the one exception by design
-- (KB-60): an owner-rights view whose columns and rows are public anyway.
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_table_privilege('myfriends', c.oid, 'SELECT')
        and not (
              (c.relkind in ('r', 'p') and c.relrowsecurity)
           or (c.relkind = 'v' and 'security_invoker=true' = any(coalesce(c.reloptions, '{}')))
           or (c.relkind = 'v' and c.relname = 'public_accounts')
        ) $$,
  'every public relation myfriends can SELECT is an RLS table or a security_invoker view'
);

-- 3. No policy reaches it without testing who the caller is. A policy
-- written TO public with a constant predicate would hand it every row.
-- has_role_on_account tests auth.uid() itself.
select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and roles && array['public', 'readonly_viewer', 'myfriends']::name[]
        and cmd in ('SELECT', 'ALL')
        and coalesce(qual, '') !~ '(auth\.uid\(\)|has_role_on_account\()' $$,
  'no SELECT policy reaches myfriends without testing the caller'
);

-- 4. It can run no SECURITY DEFINER function in public or kit: RLS does not
-- apply inside one, so each would be a door past everything above.
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef
        and n.nspname in ('public', 'kit')
        and has_function_privilege('myfriends', p.oid, 'EXECUTE') $$,
  'myfriends can execute no SECURITY DEFINER function in public or kit'
);

-- 5. USAGE on auth was granted, but no table in it.
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth'
        and c.relkind in ('r', 'p', 'v', 'm')
        and has_table_privilege('myfriends', c.oid, 'SELECT') $$,
  'myfriends can SELECT no relation in the auth schema'
);

select * from finish();

rollback;
