begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- A fixed plan, so a run that stops early fails as a plan mismatch.
select plan(22);

-- KB-26. An uploaded research source (its text in `external_content`, its
-- name in `external_sources`) was readable by every signed-in user, and two
-- tenants uploading the same name shared one source row. These cases run the
-- policies as real roles.
--
-- The rule under test: an upload is readable only by an owner, admin or
-- member row in `project_members` for its project (`can_write_project`).
-- Reading the project is NOT enough. Public and unlisted projects are
-- readable by every signed-in user (20260108120000_public_sharing_rls.sql),
-- so the project here is made public before the outsider cases run.
--
-- Rows are written as `postgres`, standing in for the service-role client
-- that is the only writer of these tables. Ids are stashed with `set_config`
-- while still `postgres`: asking for an id under a role that cannot see it
-- returns NULL and silently turns a cross-tenant case into a null case.

select tests.create_supabase_user('kb26_alice', 'kb26-alice@storybook.dev');
select tests.create_supabase_user('kb26_colleague', 'kb26-colleague@storybook.dev');
select tests.create_supabase_user('kb26_viewer', 'kb26-viewer@storybook.dev');
select tests.create_supabase_user('kb26_teammate', 'kb26-teammate@storybook.dev');
select tests.create_supabase_user('kb26_outsider', 'kb26-outsider@storybook.dev');
select tests.create_supabase_user('kb26_solo', 'kb26-solo@storybook.dev');

-- Alice's team and project; she is the creator, so she holds the owner row.
select makerkit.authenticate_as('kb26_alice');
select public.create_team_account('KB26 Alice Co');
insert into public.projects (account_id, name, slug)
values (makerkit.get_account_id_by_slug('kb26-alice-co'), 'Doc', 'kb26-doc');

-- Solo's project in his personal account (no membership rows exist there).
select makerkit.authenticate_as('kb26_solo');
insert into public.projects (account_id, name, slug)
values (tests.get_supabase_uid('kb26_solo'), 'Solo Doc', 'kb26-solo-doc');

select makerkit.authenticate_as('kb26_outsider');
select public.create_team_account('KB26 Outsider Co');

set local role postgres;

select set_config('kb26.alice_account', makerkit.get_account_id_by_slug('kb26-alice-co')::text, true);
select set_config('kb26.p', (select id::text from public.projects where slug = 'kb26-doc'), true);
select set_config('kb26.solo_p', (select id::text from public.projects where slug = 'kb26-solo-doc'), true);
select set_config('kb26.outsider_p_account', makerkit.get_account_id_by_slug('kb26-outsider-co')::text, true);

-- colleague: account member with a project 'member' row -> may read
-- viewer:    account member with a project 'viewer' row -> may not
-- teammate:  account member with no project row         -> may not
insert into public.accounts_memberships (account_id, user_id, account_role)
values
  (current_setting('kb26.alice_account')::uuid, tests.get_supabase_uid('kb26_colleague'), 'member'),
  (current_setting('kb26.alice_account')::uuid, tests.get_supabase_uid('kb26_viewer'), 'member'),
  (current_setting('kb26.alice_account')::uuid, tests.get_supabase_uid('kb26_teammate'), 'member');

insert into public.project_members (project_id, user_id, role)
values
  (current_setting('kb26.p')::uuid, tests.get_supabase_uid('kb26_colleague'), 'member'),
  (current_setting('kb26.p')::uuid, tests.get_supabase_uid('kb26_viewer'), 'viewer');

-- Alice's upload, as uploadSourceContentAction writes it.
insert into public.external_sources (id, name, slug, project_id, category, provider_type, credibility_tier)
values ('26000000-0000-4000-8000-000000000001', 'Interview notes', 'interview-notes',
        current_setting('kb26.p')::uuid, 'research', 'manual', 'tier_3');
insert into public.external_content (external_id, source_id, project_id, is_upload, title, content, url, category)
values ('manual-kb26-alice', '26000000-0000-4000-8000-000000000001',
        current_setting('kb26.p')::uuid, true, 'Interview notes', 'CONFIDENTIAL', 'manual://interview-notes', 'research');

-- Solo's upload in his personal project.
insert into public.external_sources (id, name, slug, project_id, category, provider_type, credibility_tier)
values ('26000000-0000-4000-8000-000000000002', 'Solo notes', 'solo-notes',
        current_setting('kb26.solo_p')::uuid, 'research', 'manual', 'tier_3');
insert into public.external_content (external_id, source_id, project_id, is_upload, title, content, url, category)
values ('manual-kb26-solo', '26000000-0000-4000-8000-000000000002',
        current_setting('kb26.solo_p')::uuid, true, 'Solo notes', 'private', 'manual://solo-notes', 'research');

-- A shared provider cache row, under a seeded shared source.
insert into public.external_content (external_id, source_id, title, content, url, category, cache_expires_at)
values ('newsapi:kb26', (select id from public.external_sources where slug = 'reuters' and project_id is null),
        'Shared headline', 'public text', 'https://example.test/n', 'news', now() + interval '1 day');

-- A pre-fix upload: marked as an upload by the migration, owner unknown.
insert into public.external_content (external_id, source_id, is_upload, title, content, url, category)
values ('manual-kb26-legacy', '26000000-0000-4000-8000-000000000001',
        true, 'Legacy', 'LEGACY SECRET', 'manual://legacy', 'research');

-- ==================================
-- Reading uploaded content
-- ==================================

select makerkit.authenticate_as('kb26_alice');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-alice'),
  1, 'The project owner reads her own upload');

select makerkit.authenticate_as('kb26_colleague');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-alice'),
  1, 'A project member reads the project''s upload');

select makerkit.authenticate_as('kb26_viewer');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-alice'),
  0, 'A project viewer does not read uploads (owner/admin/member only)');

select makerkit.authenticate_as('kb26_teammate');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-alice'),
  0, 'An account member with no project_members row does not read uploads');

select makerkit.authenticate_as('kb26_outsider');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-alice'),
  0, 'A user of another account does not read the upload');

set local role postgres;
update public.projects set visibility = 'public' where id = current_setting('kb26.p')::uuid;

select makerkit.authenticate_as('kb26_outsider');
select is(
  (select count(*)::int from public.projects where id = current_setting('kb26.p')::uuid),
  1, 'Control: the outsider can now read the public project itself');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-alice'),
  0, 'Project visibility does not grant access: the outsider still cannot read the upload');

select makerkit.authenticate_as('kb26_solo');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-solo'),
  1, 'A personal-account owner reads uploads in his own project');

select makerkit.authenticate_as('kb26_alice');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-solo'),
  0, 'Alice does not read Solo''s personal upload');

select makerkit.authenticate_as('kb26_outsider');
select is(
  (select count(*)::int from public.external_content where external_id = 'newsapi:kb26'),
  1, 'A shared provider cache row stays readable by any signed-in user');

select makerkit.authenticate_as('kb26_alice');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-legacy'),
  0, 'An upload with no project is readable by nobody (owner cannot be known)');

select makerkit.authenticate_as('kb26_outsider');
select is(
  (select count(*)::int from public.external_content where external_id = 'manual-kb26-legacy'),
  0, 'An upload with no project is hidden from an outsider too');

-- ==================================
-- Reading upload sources
-- ==================================

select makerkit.authenticate_as('kb26_outsider');
select is(
  (select count(*)::int from public.external_sources where slug = 'interview-notes'),
  0, 'A user of another account does not see an uploaded source''s name');

select makerkit.authenticate_as('kb26_colleague');
select is(
  (select count(*)::int from public.external_sources where slug = 'interview-notes'),
  1, 'A project member sees the project''s uploaded source');

select makerkit.authenticate_as('kb26_outsider');
select ok(
  (select count(*) from public.external_sources where slug = 'reuters' and project_id is null) = 1,
  'Shared sources stay visible to any signed-in user');

-- ==================================
-- Constraints
-- ==================================

set local role postgres;

select throws_ok(
  $$ insert into public.external_content (external_id, source_id, project_id, is_upload, title, url, category)
     values ('kb26-owned-shared', '26000000-0000-4000-8000-000000000001',
             current_setting('kb26.p')::uuid, false, 't', 'u', 'research') $$,
  '23514', null,
  'A row with a project is always an upload: it can never be mistaken for a shared row');

select lives_ok(
  $$ insert into public.external_sources (name, slug, project_id, category, provider_type)
     values ('Interview notes', 'interview-notes', current_setting('kb26.solo_p')::uuid, 'research', 'manual') $$,
  'Two projects may each have a source with the same name');

select throws_ok(
  $$ insert into public.external_sources (name, slug, project_id, category, provider_type)
     values ('Interview notes', 'interview-notes', current_setting('kb26.p')::uuid, 'research', 'manual') $$,
  '23505', null,
  'One project cannot hold two sources with the same slug');

select throws_ok(
  $$ insert into public.external_sources (name, slug, category, provider_type)
     values ('Reuters again', 'reuters', 'news', 'newsapi') $$,
  '23505', null,
  'Shared sources stay unique by slug (null project is one scope)');

select lives_ok(
  $$ insert into public.external_sources (name, slug, project_id, category, provider_type, credibility_tier)
     values ('Reuters', 'reuters', current_setting('kb26.p')::uuid, 'research', 'manual', 'tier_3')
     on conflict (project_id, slug) do update set website_url = excluded.website_url $$,
  'An upload named like a shared source makes a project-local row (the upload''s upsert target)');

select is(
  (select provider_type || '/' || credibility_tier from public.external_sources
   where slug = 'reuters' and project_id is null),
  'newsapi/tier_1',
  'The shared Reuters row is untouched by a project upload named "Reuters"');

select is(
  (select count(*)::int from public.external_sources where slug = 'reuters'),
  2, 'Shared and project-local Reuters are two rows');

select * from finish();

rollback;
