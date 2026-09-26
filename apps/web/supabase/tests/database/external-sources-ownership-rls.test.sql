begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(26);

-- KB-37. Research sources belong to a team. Before, rows with no project were
-- one registry that any "owner of any account" could change through the admin
-- client, and anyone becomes such an owner with one `create_team_account`
-- call. The actions now write through the caller's own client, so these
-- policies are the rule, run here as real roles.
--
--   built-in  (is_builtin)            read: everyone         write: nobody
--   team      (account_id, no project) read: team members    write: team owners
--   project   (project_id)            read/write: can_write_project
--   orphan    (none of the above)     read/write: nobody
--
-- Ids are stashed with `set_config` while `postgres`: under a role that cannot
-- see a row, a lookup returns NULL and turns a refusal case into a null case.

select tests.create_supabase_user('kb37_owner_a', 'kb37-owner-a@storybook.dev');
select tests.create_supabase_user('kb37_member_a', 'kb37-member-a@storybook.dev');
select tests.create_supabase_user('kb37_viewer_a', 'kb37-viewer-a@storybook.dev');
select tests.create_supabase_user('kb37_owner_b', 'kb37-owner-b@storybook.dev');
select tests.create_supabase_user('kb37_stranger', 'kb37-stranger@storybook.dev');

select makerkit.authenticate_as('kb37_owner_a');
select public.create_team_account('KB37 Team A');
insert into public.projects (account_id, name, slug)
values (makerkit.get_account_id_by_slug('kb37-team-a'), 'Doc A', 'kb37-doc-a');

select makerkit.authenticate_as('kb37_owner_b');
select public.create_team_account('KB37 Team B');

-- The one-RPC path: a stranger makes a throwaway team and owns it.
select makerkit.authenticate_as('kb37_stranger');
select public.create_team_account('KB37 Throwaway');

set local role postgres;

select set_config('kb37.a', makerkit.get_account_id_by_slug('kb37-team-a')::text, true);
select set_config('kb37.b', makerkit.get_account_id_by_slug('kb37-team-b')::text, true);
select set_config('kb37.pa', (select id::text from public.projects where slug = 'kb37-doc-a'), true);
select set_config('kb37.reuters', (select id::text from public.external_sources where slug = 'reuters' and is_builtin), true);

-- member_a: team member with a project 'member' row (a project writer)
-- viewer_a: team member with a project 'viewer' row
insert into public.accounts_memberships (account_id, user_id, account_role)
values
  (current_setting('kb37.a')::uuid, tests.get_supabase_uid('kb37_member_a'), 'member'),
  (current_setting('kb37.a')::uuid, tests.get_supabase_uid('kb37_viewer_a'), 'member');

insert into public.project_members (project_id, user_id, role)
values
  (current_setting('kb37.pa')::uuid, tests.get_supabase_uid('kb37_member_a'), 'member'),
  (current_setting('kb37.pa')::uuid, tests.get_supabase_uid('kb37_viewer_a'), 'viewer');

-- Rows an UPDATE or DELETE changed, run as the caller (security invoker),
-- with RETURNING as PostgREST writes. A data-modifying WITH cannot sit in a
-- subquery, so the count comes from GET DIAGNOSTICS.
create function pg_temp.rows_changed(statement text) returns int
language plpgsql as $fn$
declare
  n int;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

grant execute on function pg_temp.rows_changed(text) to authenticated;

-- A pre-fix source: no team, no project, not built-in.
insert into public.external_sources (id, name, slug, category, provider_type)
values ('37000000-0000-4000-8000-00000000000f', 'paper1.pdf', 'kb37-orphan', 'research', 'manual');

-- ==================================
-- Team sources
-- ==================================

select makerkit.authenticate_as('kb37_owner_a');

select lives_ok(
  $$ insert into public.external_sources (id, name, slug, account_id, category, provider_type)
     values ('37000000-0000-4000-8000-00000000000a', 'Notes', 'notes',
             current_setting('kb37.a')::uuid, 'research', 'manual') $$,
  'A team owner adds a team source');

select throws_ok(
  $$ insert into public.external_sources (name, slug, account_id, category, provider_type)
     values ('Planted', 'planted', current_setting('kb37.b')::uuid, 'research', 'manual') $$,
  '42501', null,
  'A team owner cannot add a source to another team');

select throws_ok(
  $$ insert into public.external_sources (name, slug, category, provider_type)
     values ('Planted', 'planted', 'news', 'manual') $$,
  '42501', null,
  'Nobody adds a source with no team (the old shared registry)');

select throws_ok(
  $$ insert into public.external_sources (name, slug, category, provider_type, is_builtin)
     values ('Fake wire', 'fake-wire', 'news', 'newsapi', true) $$,
  '42501', null,
  'Nobody adds a built-in');

select throws_ok(
  $$ insert into public.external_sources (name, slug, account_id, category, provider_type)
     values ('Notes', 'notes', current_setting('kb37.a')::uuid, 'research', 'manual') $$,
  '23505', null,
  'One team cannot hold two sources with the same slug');

select makerkit.authenticate_as('kb37_owner_b');

select lives_ok(
  $$ insert into public.external_sources (name, slug, account_id, category, provider_type)
     values ('Notes', 'notes', current_setting('kb37.b')::uuid, 'research', 'manual') $$,
  'Another team may have a source with the same name');

select is(
  (select count(*)::int from public.external_sources where id = '37000000-0000-4000-8000-00000000000a'),
  0, 'Another team''s owner does not see team A''s source');

select is(
  pg_temp.rows_changed($q$ update public.external_sources set is_active = false where id = '37000000-0000-4000-8000-00000000000a' returning 1 $q$),
  0, 'Another team''s owner cannot deactivate team A''s source');

select makerkit.authenticate_as('kb37_member_a');

select is(
  (select count(*)::int from public.external_sources where id = '37000000-0000-4000-8000-00000000000a'),
  1, 'A team member reads the team''s source');

select throws_ok(
  $$ insert into public.external_sources (name, slug, account_id, category, provider_type)
     values ('Mine', 'mine', current_setting('kb37.a')::uuid, 'research', 'manual') $$,
  '42501', null,
  'A team member who is not an owner cannot add a team source');

select is(
  pg_temp.rows_changed($q$ update public.external_sources set is_active = false where id = '37000000-0000-4000-8000-00000000000a' returning 1 $q$),
  0, 'A team member who is not an owner cannot deactivate a team source');

select makerkit.authenticate_as('kb37_stranger');

select is(
  pg_temp.rows_changed($q$ update public.external_sources set is_active = false where id = '37000000-0000-4000-8000-00000000000a' returning 1 $q$),
  0, 'The owner of a throwaway team cannot deactivate team A''s source');

-- ==================================
-- Project sources
-- ==================================

select makerkit.authenticate_as('kb37_member_a');

select lives_ok(
  $$ insert into public.external_sources (id, name, slug, project_id, category, provider_type)
     values ('37000000-0000-4000-8000-00000000000c', 'Draft', 'draft',
             current_setting('kb37.pa')::uuid, 'research', 'manual') $$,
  'A project writer adds a source to the project');

select is(
  (select account_id::text from public.external_sources where id = '37000000-0000-4000-8000-00000000000c'),
  current_setting('kb37.a'),
  'A project source takes its project''s team');

select makerkit.authenticate_as('kb37_viewer_a');

select throws_ok(
  $$ insert into public.external_sources (name, slug, project_id, category, provider_type)
     values ('Peek', 'peek', current_setting('kb37.pa')::uuid, 'research', 'manual') $$,
  '42501', null,
  'A project viewer cannot add a project source');

select is(
  (select count(*)::int from public.external_sources where id = '37000000-0000-4000-8000-00000000000c'),
  0, 'A project viewer does not read project sources');

select makerkit.authenticate_as('kb37_owner_b');

select throws_ok(
  $$ insert into public.external_sources (name, slug, project_id, category, provider_type)
     values ('Planted', 'planted', current_setting('kb37.pa')::uuid, 'research', 'manual') $$,
  '42501', null,
  'Another team''s owner cannot add a source to team A''s project');

set local role postgres;

select throws_ok(
  $$ insert into public.external_sources (name, slug, project_id, account_id, category, provider_type)
     values ('Crossed', 'crossed', current_setting('kb37.pa')::uuid,
             current_setting('kb37.b')::uuid, 'research', 'manual') $$,
  '23514', null,
  'A project source cannot claim a team other than its project''s');

-- ==================================
-- Built-ins, orphans, moving and deleting
-- ==================================

select makerkit.authenticate_as('kb37_stranger');

select is(
  (select count(*)::int from public.external_sources where id = current_setting('kb37.reuters')::uuid),
  1, 'A built-in is readable by any signed-in user');

select is(
  pg_temp.rows_changed($q$ update public.external_sources set is_active = false where id = current_setting('kb37.reuters')::uuid returning 1 $q$),
  0, 'Nobody deactivates a built-in through the API');

select makerkit.authenticate_as('kb37_owner_a');

select is(
  pg_temp.rows_changed($q$ update public.external_sources set name = 'Mine now' where id = current_setting('kb37.reuters')::uuid returning 1 $q$),
  0, 'A team owner cannot edit a built-in either');

select is(
  (select count(*)::int from public.external_sources where id = '37000000-0000-4000-8000-00000000000f'),
  0, 'A source with no team and no project (pre-fix) is readable by nobody');

select throws_ok(
  $$ update public.external_sources set account_id = current_setting('kb37.b')::uuid
     where id = '37000000-0000-4000-8000-00000000000a' $$,
  '42501', null,
  'A team owner cannot move a team source to another team');

select is(
  pg_temp.rows_changed($q$ delete from public.external_sources where id = '37000000-0000-4000-8000-00000000000a' returning 1 $q$),
  0, 'Sources are deactivated, never deleted through the API');

select is(
  pg_temp.rows_changed($q$ update public.external_sources set is_active = false where id = '37000000-0000-4000-8000-00000000000a' returning id $q$),
  1, 'A team owner deactivates the team''s source, with RETURNING as PostgREST writes');

select is(
  (select count(*)::int from public.external_sources
   where id = '37000000-0000-4000-8000-00000000000a' and not is_active),
  1, 'The team still reads its deactivated source (so it can be restored)');

select * from finish();

rollback;
