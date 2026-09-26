begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(57);

-- KB-85 and KB-88. What a visitor who is not signed in (`anon`, the public
-- API key) can reach in `public`, pinned exactly.
--
-- Until KB-88, `anon` had no USAGE on the schema, so public share pages were
-- a 404 to everyone signed out, and Supabase's default grants (read and write
-- on most tables) sat behind that one missing privilege (KB-85). Now `anon`
-- has USAGE and reads three read-only views and calls three link lookups.
-- Nothing else. The views list only public rows; an unlisted project or
-- episode is reached only through a lookup by its exact key.
--
-- The views and functions run with their owner's rights, past RLS, so their
-- columns and filters are the whole exposure, and are what the row cases
-- below pin. Everything that runs as `anon` uses fixed ids: `anon` cannot
-- call the tests.* helpers.

-- ==================================
-- Grants: the exact surface
-- ==================================

select schema_privs_are('public', 'anon', array['USAGE'],
  'G1: anon has USAGE on public, and nothing more');

select results_eq(
  $$ select c.relname::text collate "default"
       from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (has_table_privilege('anon', c.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
             or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
      order by 1 $$,
  $$ values ('public_accounts'), ('public_episodes'), ('public_projects') $$,
  'G2: the only relations anon holds any privilege on are the three public views'
);

select is_empty(
  $$ select c.relname
       from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (has_table_privilege('anon', c.oid,
               'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
             or has_any_column_privilege('anon', c.oid, 'INSERT,UPDATE,REFERENCES')) $$,
  'G3: no relation in public grants anon any write'
);

select table_privs_are('public', 'public_accounts', 'anon', array['SELECT'], 'G4: anon only reads public_accounts');
select table_privs_are('public', 'public_projects', 'anon', array['SELECT'], 'G4: anon only reads public_projects');
select table_privs_are('public', 'public_episodes', 'anon', array['SELECT'], 'G4: anon only reads public_episodes');

select is_empty(
  $$ select c.relname
       from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and case when c.relkind = 'S'
                 then has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
                 else false end $$,
  'G5: anon holds nothing on any sequence in public'
);

-- Extension members (pgvector's functions, owned by supabase_admin and
-- executable by PUBLIC) are out of a migration's reach and touch no table.
select results_eq(
  $$ select p.proname::text collate "default"
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and has_function_privilege('anon', p.oid, 'EXECUTE')
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_proc'::regclass
                           and d.objid = p.oid and d.deptype = 'e')
      order by 1 $$,
  $$ values ('get_shared_episode'), ('get_shared_project'), ('get_shared_project_episodes') $$,
  'G6: the only app functions anon can execute are the three link lookups'
);

select results_eq(
  $$ select p.proname::text collate "default", p.prosecdef, p.provolatile::text,
            p.proconfig = array['search_path=""']
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('get_shared_episode', 'get_shared_project', 'get_shared_project_episodes')
      order by 1 $$,
  $$ values ('get_shared_episode', true, 's', true),
            ('get_shared_project', true, 's', true),
            ('get_shared_project_episodes', true, 's', true) $$,
  'G7: each lookup is SECURITY DEFINER, STABLE, with an empty search_path'
);

-- New objects made by migrations (as postgres) grant anon nothing.
create table public.kb85_probe (id int);
create sequence public.kb85_probe_seq;
create function public.kb85_probe_fn() returns int language sql as 'select 1';

select ok(not has_table_privilege('anon', 'public.kb85_probe',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
  'G8: a new table grants anon nothing');
select ok(not has_sequence_privilege('anon', 'public.kb85_probe_seq', 'USAGE,SELECT,UPDATE'),
  'G8: a new sequence grants anon nothing');
select ok(not has_function_privilege('anon', 'public.kb85_probe_fn()', 'EXECUTE'),
  'G8: a new function grants anon nothing');

drop function public.kb85_probe_fn();
drop sequence public.kb85_probe_seq;
drop table public.kb85_probe;

select is_empty(
  $$ select tablename || '.' || policyname
       from pg_policies
      where schemaname = 'public'
        and tablename in ('projects', 'episodes')
        and (roles && array['anon', 'public']::name[]
             or policyname like 'Allow public read%') $$,
  'G9: projects and episodes have no public-read policy (public pages read the views)'
);

select columns_are('public', 'public_projects', array[
  'id', 'account_id', 'account_slug', 'name', 'description', 'public_slug',
  'visibility', 'metadata', 'seo_metadata', 'created_at', 'updated_at'],
  'G10: public_projects has exactly the columns public pages render');

select columns_are('public', 'public_episodes', array[
  'id', 'project_id', 'project_public_slug', 'account_slug', 'number', 'title',
  'description', 'duration_seconds', 'thumbnail_url', 'slug', 'public_slug',
  'visibility', 'localized_videos', 'seo_metadata', 'created_at', 'updated_at'],
  'G10: public_episodes has exactly the columns public pages render');

-- ==================================
-- Fixtures
-- ==================================
--   A  public team (kb85-pub-co), owned by kb85_owner
--      PP public project: E1 released, E2 soft-deleted, E3 private,
--                         E4 unlisted, E5 public but not released
--      PU unlisted project: U1
--      PR private project: R1 (visibility public, but its project is private)
--   B  private team (kb85-priv-co), owned by kb85_owner
--      BP public project: B1

select tests.create_supabase_user('kb85_owner', 'kb85-owner@storybook.dev');
select tests.create_supabase_user('kb85_stranger', 'kb85-stranger@storybook.dev');

insert into public.accounts (id, name, slug, is_personal_account, primary_owner_user_id, public_profile)
values
  ('85880000-0000-4000-8000-0000000000a1', 'KB-85 Public Co', 'kb85-pub-co', false,
   tests.get_supabase_uid('kb85_owner'), '{"is_public": true}'),
  ('85880000-0000-4000-8000-0000000000b1', 'KB-85 Private Co', 'kb85-priv-co', false,
   tests.get_supabase_uid('kb85_owner'), '{"is_public": false}');

insert into public.accounts_memberships (user_id, account_id, account_role)
values (tests.get_supabase_uid('kb85_owner'), '85880000-0000-4000-8000-0000000000a1', 'owner'),
       (tests.get_supabase_uid('kb85_owner'), '85880000-0000-4000-8000-0000000000b1', 'owner')
on conflict do nothing;

-- created_by defaults to auth.uid(), and a trigger makes it the project owner.
select makerkit.authenticate_as('kb85_owner');
set local role postgres;

insert into public.projects (id, account_id, name, status, visibility, public_slug, metadata) values
  ('85880000-0000-4000-8000-000000000001', '85880000-0000-4000-8000-0000000000a1', 'KB-85 Show', 'active',
   'public', 'kb85-show',
   '{"cover_url": "https://img.test/c.png", "genre": "drama", "canon": {"enabled": true}, "defaultProvider": "x"}'),
  ('85880000-0000-4000-8000-000000000002', '85880000-0000-4000-8000-0000000000a1', 'KB-85 Link', 'active',
   'unlisted', 'kb85-link', '{}'),
  ('85880000-0000-4000-8000-000000000003', '85880000-0000-4000-8000-0000000000a1', 'KB-85 Private', 'active',
   'private', 'kb85-private', '{}'),
  ('85880000-0000-4000-8000-000000000004', '85880000-0000-4000-8000-0000000000b1', 'KB-85 B Show', 'active',
   'public', 'kb85-b-show', '{}');

insert into public.episodes
  (id, project_id, number, title, slug, public_slug, visibility, localized_videos, deleted_at, story_data)
values
  ('85880000-0000-4000-8000-000000000011', '85880000-0000-4000-8000-000000000001', 1, 'E1', 'e1', 'e1', 'inherit',
   '{"en": {"youtube": {"url": "https://www.youtube.com/watch?v=kb85"}}}', null, '{"secret": "story"}'),
  ('85880000-0000-4000-8000-000000000012', '85880000-0000-4000-8000-000000000001', 2, 'E2', 'e2', 'e2', 'inherit',
   '{"en": {"youtube": {"url": "https://www.youtube.com/watch?v=kb85d"}}}', now(), null),
  ('85880000-0000-4000-8000-000000000013', '85880000-0000-4000-8000-000000000001', 3, 'E3', 'e3', 'e3', 'private',
   '{}', null, null),
  ('85880000-0000-4000-8000-000000000014', '85880000-0000-4000-8000-000000000001', 4, 'E4', 'e4', 'e4', 'unlisted',
   '{}', null, null),
  ('85880000-0000-4000-8000-000000000015', '85880000-0000-4000-8000-000000000001', 5, 'E5', 'e5', 'e5', 'public',
   '{}', null, null),
  ('85880000-0000-4000-8000-000000000021', '85880000-0000-4000-8000-000000000002', 1, 'U1', 'u1', 'u1', 'inherit',
   '{}', null, null),
  ('85880000-0000-4000-8000-000000000031', '85880000-0000-4000-8000-000000000003', 1, 'R1', 'r1', 'r1', 'public',
   '{}', null, null),
  ('85880000-0000-4000-8000-000000000041', '85880000-0000-4000-8000-000000000004', 1, 'B1', 'b1', 'b1', 'inherit',
   '{}', null, null);

-- ==================================
-- As anon: the views list public rows only
-- ==================================

select tests.clear_authentication();
set local role anon;

select results_eq(
  $$ select id::text from public.public_projects
      where id::text like '85880000-%' order by 1 $$,
  $$ values ('85880000-0000-4000-8000-000000000001') $$,
  'V1: anon lists the public project of a public team only (not unlisted, private, or a private team''s)'
);

select results_eq(
  $$ select id::text from public.public_episodes
      where id::text like '85880000-%' order by 1 $$,
  $$ values ('85880000-0000-4000-8000-000000000011'), ('85880000-0000-4000-8000-000000000015') $$,
  'V2: anon lists the public project''s visible episodes (not soft-deleted, private, unlisted, or another project''s)'
);

select is_empty(
  $$ select id from public.public_projects where visibility = 'unlisted' $$,
  'V3: no unlisted project can be listed from public_projects');

select is_empty(
  $$ select id from public.public_episodes where visibility = 'unlisted' $$,
  'V3: no unlisted episode can be listed from public_episodes');

select is_empty(
  $$ select id from public.public_episodes where project_id = '85880000-0000-4000-8000-000000000002' $$,
  'V3: the episodes of an unlisted project cannot be listed');

select results_eq(
  $$ select account_slug, public_slug, metadata from public.public_projects
      where id = '85880000-0000-4000-8000-000000000001' $$,
  $$ values ('kb85-pub-co'::text, 'kb85-show'::text,
             '{"cover_url": "https://img.test/c.png", "genre": "drama"}'::jsonb) $$,
  'V4: a public project carries only the three metadata keys the page reads (no canon, no provider)'
);

select results_eq(
  $$ select account_slug, project_public_slug from public.public_episodes
      where id = '85880000-0000-4000-8000-000000000011' $$,
  $$ values ('kb85-pub-co'::text, 'kb85-show'::text) $$,
  'V5: an episode row carries the slugs its URL needs'
);

select results_eq(
  $$ select slug::text from public.public_accounts where slug like 'kb85-%' order by 1 $$,
  $$ values ('kb85-pub-co') $$,
  'V6: anon reads the public team from public_accounts, not the private one'
);

-- ==================================
-- As anon: no base table, and no writes through the views
-- ==================================

select throws_ok($$ select 1 from public.projects limit 1 $$, '42501', null,
  'B1: anon cannot read projects');
select throws_ok($$ select 1 from public.episodes limit 1 $$, '42501', null,
  'B1: anon cannot read episodes');
select throws_ok($$ select 1 from public.accounts limit 1 $$, '42501', null,
  'B1: anon cannot read accounts');
select throws_ok($$ select 1 from public.platform_connections limit 1 $$, '42501', null,
  'B1: anon cannot read platform_connections');
select throws_ok($$ insert into public.notifications (account_id, body)
                   values ('85880000-0000-4000-8000-0000000000a1', 'x') $$, '42501', null,
  'B2: anon cannot write a table');
select throws_ok($$ update public.public_projects set name = 'x'
                   where id = '85880000-0000-4000-8000-000000000001' $$, null, null,
  'B2: public_projects cannot be written (not updatable for anyone; anon holds no UPDATE, G4)');
select throws_ok($$ delete from public.public_episodes
                   where id = '85880000-0000-4000-8000-000000000011' $$, null, null,
  'B2: public_episodes cannot be written (not updatable for anyone; anon holds no DELETE, G4)');
select throws_ok($$ select public.get_episode_languages(array['85880000-0000-4000-8000-000000000011'::uuid]) $$,
  '42501', null, 'B3: anon cannot call the studio RPCs');

-- ==================================
-- As anon: link lookups open unlisted rows by exact key only
-- ==================================

select results_eq(
  $$ select id::text from public.get_shared_project('85880000-0000-4000-8000-0000000000a1', 'kb85-link') $$,
  $$ values ('85880000-0000-4000-8000-000000000002') $$,
  'L1: an unlisted project opens by its exact link');
select results_eq(
  $$ select id::text from public.get_shared_project('85880000-0000-4000-8000-0000000000a1', 'kb85-show') $$,
  $$ values ('85880000-0000-4000-8000-000000000001') $$,
  'L1: a public project opens by its link');
select is_empty(
  $$ select id from public.get_shared_project('85880000-0000-4000-8000-0000000000a1', 'kb85-private') $$,
  'L2: a private project does not open');
select is_empty(
  $$ select id from public.get_shared_project('85880000-0000-4000-8000-0000000000b1', 'kb85-b-show') $$,
  'L2: a private team''s public project does not open');
select is_empty(
  $$ select id from public.get_shared_project('85880000-0000-4000-8000-0000000000a1', 'kb85-%') $$,
  'L3: the project slug is matched exactly, not as a pattern');
select is_empty(
  $$ select id from public.get_shared_project('85880000-0000-4000-8000-0000000000b1', 'kb85-link') $$,
  'L3: a slug does not open under another account');
select is_empty(
  $$ select id from public.get_shared_project(null, 'kb85-link') $$,
  'L3: a null account opens nothing');

select results_eq(
  $$ select id::text from public.get_shared_project_episodes('85880000-0000-4000-8000-000000000002') order by 1 $$,
  $$ values ('85880000-0000-4000-8000-000000000021') $$,
  'L4: an unlisted project''s page lists its episodes');
select results_eq(
  $$ select id::text from public.get_shared_project_episodes('85880000-0000-4000-8000-000000000001') order by 1 $$,
  $$ values ('85880000-0000-4000-8000-000000000011'), ('85880000-0000-4000-8000-000000000015') $$,
  'L4: a public project''s page lists what public_episodes lists');
select is_empty(
  $$ select id from public.get_shared_project_episodes('85880000-0000-4000-8000-000000000003') $$,
  'L5: a private project lists nothing');
select is_empty(
  $$ select id from public.get_shared_project_episodes('85880000-0000-4000-8000-000000000004') $$,
  'L5: a private team''s project lists nothing');

select results_eq(
  $$ select id::text from public.get_shared_episode('85880000-0000-4000-8000-000000000001', 'e4') $$,
  $$ values ('85880000-0000-4000-8000-000000000014') $$,
  'L6: an unlisted episode opens by its exact link');
select results_eq(
  $$ select id::text from public.get_shared_episode('85880000-0000-4000-8000-000000000002', 'u1') $$,
  $$ values ('85880000-0000-4000-8000-000000000021') $$,
  'L6: an episode of an unlisted project opens by its link');
select results_eq(
  $$ select id::text from public.get_shared_episode('85880000-0000-4000-8000-000000000001', 'e1') $$,
  $$ values ('85880000-0000-4000-8000-000000000011') $$,
  'L6: a public episode opens by its link');
select is_empty(
  $$ select id from public.get_shared_episode('85880000-0000-4000-8000-000000000001', 'e2') $$,
  'L7: a soft-deleted episode does not open');
select is_empty(
  $$ select id from public.get_shared_episode('85880000-0000-4000-8000-000000000001', 'e3') $$,
  'L7: a private episode does not open');
select is_empty(
  $$ select id from public.get_shared_episode('85880000-0000-4000-8000-000000000003', 'r1') $$,
  'L7: an episode of a private project does not open');
select is_empty(
  $$ select id from public.get_shared_episode('85880000-0000-4000-8000-000000000004', 'b1') $$,
  'L7: an episode of a private team does not open');
select is_empty(
  $$ select id from public.get_shared_episode('85880000-0000-4000-8000-000000000002', 'e1') $$,
  'L8: an episode slug does not open under another project');

-- ==================================
-- Signed in: strangers read the views, not the base tables; members unchanged
-- ==================================

set local role postgres;
select makerkit.authenticate_as('kb85_stranger');

select is_empty(
  $$ select id from public.projects where id::text like '85880000-%' $$,
  'S1: a signed-in stranger reads no project row of another account');
select is_empty(
  $$ select id from public.episodes where id::text like '85880000-%' $$,
  'S1: a signed-in stranger reads no episode row of another account (no story_data)');
select results_eq(
  $$ select id::text from public.public_projects where id::text like '85880000-%' $$,
  $$ values ('85880000-0000-4000-8000-000000000001') $$,
  'S2: a signed-in stranger lists what anon lists');
select results_eq(
  $$ select id::text from public.get_shared_project('85880000-0000-4000-8000-0000000000a1', 'kb85-link') $$,
  $$ values ('85880000-0000-4000-8000-000000000002') $$,
  'S2: a signed-in stranger opens an unlisted project by its link');
select is_empty(
  $$ select id from public.get_shared_project('85880000-0000-4000-8000-0000000000a1', 'kb85-private') $$,
  'S2: a signed-in stranger does not open a private project');

set local role postgres;
select makerkit.authenticate_as('kb85_owner');

select results_eq(
  $$ select id::text from public.projects where id::text like '85880000-%' order by 1 $$,
  $$ values ('85880000-0000-4000-8000-000000000001'), ('85880000-0000-4000-8000-000000000002'),
            ('85880000-0000-4000-8000-000000000003'), ('85880000-0000-4000-8000-000000000004') $$,
  'M1: the owner still reads every project of both teams');
select results_eq(
  $$ select story_data from public.episodes where id = '85880000-0000-4000-8000-000000000011' $$,
  $$ values ('{"secret": "story"}'::jsonb) $$,
  'M1: the owner still reads their episode''s story');

select * from finish();
rollback;
