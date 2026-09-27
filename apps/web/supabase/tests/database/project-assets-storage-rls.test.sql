begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-28. A fixed plan, so a run that aborts early fails as a plan mismatch
-- instead of reading as a nearly-passing suite.
select plan(48);

-- KB-99: the product is team accounts only; someone working alone is a team
-- of one. A fixture that used to sit on a user's personal account sits on a
-- team that user owns instead, with the owner membership a team always has.
create function pg_temp.solo_team(identifier text) returns uuid
language plpgsql security definer as $$
declare
  team uuid := md5('kb99-solo:' || identifier)::uuid;
begin
  insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
  values (team, identifier || ' (team of one)', false, tests.get_supabase_uid(identifier))
  on conflict (id) do nothing;

  insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid(identifier), team, 'owner')
  on conflict do nothing;

  return team;
end;
$$;
grant execute on function pg_temp.solo_team(text) to authenticated;

-- Who writes into a project, and what that means for its storage folder.
--
-- Fixtures:
--   P  private project of kb28_owner, with episode E. kb28_admin is admin,
--      kb28_member is member, kb28_viewer is viewer.
--   Q  public project of kb28_owner. kb28_stranger can read it.
--   R  kb28_stranger's own project, with episode ER.
--
-- Storage cases insert into storage.objects directly as `authenticated`.
-- That is the row the Storage API writes under the user's session, and the
-- same check it runs when it signs an upload URL.

select tests.create_supabase_user('kb28_owner', 'kb28-owner@storybook.dev');
select tests.create_supabase_user('kb28_admin', 'kb28-admin@storybook.dev');
select tests.create_supabase_user('kb28_member', 'kb28-member@storybook.dev');
select tests.create_supabase_user('kb28_viewer', 'kb28-viewer@storybook.dev');
select tests.create_supabase_user('kb28_stranger', 'kb28-stranger@storybook.dev');

-- Projects are created by their owners: the creator trigger reads auth.uid().
select makerkit.authenticate_as('kb28_owner');

insert into public.projects (id, account_id, name, slug, visibility)
values
  ('cccccccc-2800-4000-8000-000000000001', pg_temp.solo_team('kb28_owner'), 'KB-28 private', 'kb28-private', 'private'),
  ('cccccccc-2800-4000-8000-000000000002', pg_temp.solo_team('kb28_owner'), 'KB-28 public', 'kb28-public', 'public');

select makerkit.authenticate_as('kb28_stranger');

insert into public.projects (id, account_id, name, slug)
values ('cccccccc-2800-4000-8000-000000000003', pg_temp.solo_team('kb28_stranger'), 'KB-28 other', 'kb28-other');

set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
values
  ('cccccccc-2800-4000-8000-000000000011', 'cccccccc-2800-4000-8000-000000000001', 1, 'E', 'draft'),
  ('cccccccc-2800-4000-8000-000000000013', 'cccccccc-2800-4000-8000-000000000003', 1, 'ER', 'draft');

insert into public.project_members (project_id, user_id, role)
values
  ('cccccccc-2800-4000-8000-000000000001', tests.get_supabase_uid('kb28_admin'), 'admin'),
  ('cccccccc-2800-4000-8000-000000000001', tests.get_supabase_uid('kb28_member'), 'member'),
  ('cccccccc-2800-4000-8000-000000000001', tests.get_supabase_uid('kb28_viewer'), 'viewer');

-- ==================================
-- public.can_write_project
-- ==================================

select makerkit.authenticate_as('kb28_owner');
select ok(public.can_write_project('cccccccc-2800-4000-8000-000000000001'), 'can_write_project: the owner may write');

select makerkit.authenticate_as('kb28_admin');
select ok(public.can_write_project('cccccccc-2800-4000-8000-000000000001'), 'can_write_project: an admin may write');

select makerkit.authenticate_as('kb28_member');
select ok(public.can_write_project('cccccccc-2800-4000-8000-000000000001'), 'can_write_project: a member may write');

select makerkit.authenticate_as('kb28_viewer');
select ok(not public.can_write_project('cccccccc-2800-4000-8000-000000000001'), 'can_write_project: a viewer may not write');

select makerkit.authenticate_as('kb28_stranger');
select ok(not public.can_write_project('cccccccc-2800-4000-8000-000000000001'), 'can_write_project: a stranger may not write');

-- Until KB-85/88 a stranger could read any public project's row, and this
-- asserted that read before asserting it gave no write. The public-read
-- policy is gone: public pages read public_projects, which lists only public
-- TEAM accounts' projects. This one is on a personal account, so a stranger
-- reads it nowhere. can_write_project is a definer function over the id, so
-- the cases below do not depend on visibility either way.
select is_empty(
  $$ select id from public.projects where id = 'cccccccc-2800-4000-8000-000000000002' $$,
  'A stranger no longer reads a public project''s row (KB-85/88)'
);
select ok(not public.can_write_project('cccccccc-2800-4000-8000-000000000002'), 'can_write_project: a public-project reader may not write');
select ok(not public.can_write_project(null), 'can_write_project: a null project has no writers');

set local role anon;
select throws_ok(
  $$ select public.can_write_project('cccccccc-2800-4000-8000-000000000001') $$,
  '42501',
  null,
  'can_write_project: anon may not call it'
);

-- ==================================
-- Path resolution
-- ==================================

set local role postgres;

select is(kit.get_project_id_from_path('cccccccc-2800-4000-8000-000000000001/cover.png'), 'cccccccc-2800-4000-8000-000000000001'::uuid, 'Resolves <projectId>/...');
select is(kit.get_project_id_from_path('projects/cccccccc-2800-4000-8000-000000000001/assets/covers/c.png'), 'cccccccc-2800-4000-8000-000000000001'::uuid, 'Resolves projects/<projectId>/...');
select is(kit.get_project_id_from_path('episodes/cccccccc-2800-4000-8000-000000000011/thumbnails/t.png'), 'cccccccc-2800-4000-8000-000000000001'::uuid, 'Resolves episodes/<episodeId>/... through the episode');
select is(kit.get_project_id_from_path('projects/not-a-uuid/x.png'), null::uuid, 'An unparseable project id resolves to null');
select is(kit.get_project_id_from_path('foo/x.png'), null::uuid, 'An unknown shape resolves to null');

-- ==================================
-- INSERT
-- ==================================

select makerkit.authenticate_as('kb28_stranger');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'cccccccc-2800-4000-8000-000000000001/audit-probe/planted.png', auth.uid()::text) $$,
  '42501', null, 'A stranger may not plant <projectId>/... (the KB-28 reproduction)'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/planted.png', auth.uid()::text) $$,
  '42501', null, 'A stranger may not plant projects/<projectId>/...'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'episodes/cccccccc-2800-4000-8000-000000000011/thumbnails/planted.png', auth.uid()::text) $$,
  '42501', null, 'A stranger may not plant episodes/<episodeId>/...'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/cccccccc-2800-4000-8000-000000000002/assets/character/planted.png', auth.uid()::text) $$,
  '42501', null, 'A stranger may not plant into a public project they can read'
);

select makerkit.authenticate_as('kb28_viewer');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/v.png', auth.uid()::text) $$,
  '42501', null, 'A viewer may not upload'
);

select makerkit.authenticate_as('kb28_member');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/m.png', auth.uid()::text) $$,
  'A member may upload'
);

select makerkit.authenticate_as('kb28_admin');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/a.png', auth.uid()::text) $$,
  'An admin may upload'
);

select makerkit.authenticate_as('kb28_owner');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'cccccccc-2800-4000-8000-000000000001/cover.png', auth.uid()::text) $$,
  'The owner may upload to <projectId>/...'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/cccccccc-2800-4000-8000-000000000001/assets/covers/o.png', auth.uid()::text) $$,
  'The owner may upload to projects/<projectId>/assets/...'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/cccccccc-2800-4000-8000-000000000001/shots/cccccccc-2800-4000-8000-0000000000ff/frames/o.png', auth.uid()::text) $$,
  'The owner may upload to projects/<projectId>/shots/...'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/cccccccc-2800-4000-8000-000000000001/assets/master_video/export_en_1.mp4', auth.uid()::text) $$,
  'The owner may upload a master_video path'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'episodes/cccccccc-2800-4000-8000-000000000011/thumbnails/o.png', auth.uid()::text) $$,
  'The owner may upload to episodes/<episodeId>/...'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'foo/x.png', auth.uid()::text) $$,
  '42501', null, 'A path that names no project is refused'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/not-a-uuid/x.png', auth.uid()::text) $$,
  '42501', null, 'An unparseable project id is refused'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'dddddddd-2800-4000-8000-000000000099/x.png', auth.uid()::text) $$,
  '42501', null, 'A uuid that is no project is refused'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'episodes/cccccccc-2800-4000-8000-000000000013/thumbnails/x.png', auth.uid()::text) $$,
  '42501', null, 'The owner may not write under another project''s episode'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', 'projects/cccccccc-2800-4000-8000-000000000003/assets/x.png', auth.uid()::text) $$,
  '42501', null, 'The owner may not write under another project'
);

-- ==================================
-- UPDATE
-- ==================================

select makerkit.authenticate_as('kb28_stranger');

update storage.objects set metadata = '{"by":"stranger"}'::jsonb
where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/covers/o.png';

set local role postgres;
select is(
  (select metadata from storage.objects where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/covers/o.png'),
  null::jsonb,
  'A stranger''s update of the owner''s object changes nothing'
);

select makerkit.authenticate_as('kb28_viewer');

update storage.objects set metadata = '{"by":"viewer"}'::jsonb
where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/covers/o.png';

set local role postgres;
select is(
  (select metadata from storage.objects where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/covers/o.png'),
  null::jsonb,
  'A viewer''s update changes nothing'
);

-- Refused before KB-28: the old policy resolved `projects` as the project id.
select makerkit.authenticate_as('kb28_owner');

update storage.objects set metadata = '{"by":"owner"}'::jsonb
where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/covers/o.png';

set local role postgres;
select is(
  (select metadata ->> 'by' from storage.objects where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/covers/o.png'),
  'owner',
  'The owner may replace their own projects/<projectId>/... object'
);

select makerkit.authenticate_as('kb28_owner');

update storage.objects set metadata = '{"by":"owner-ep"}'::jsonb
where bucket_id = 'project-assets' and name = 'episodes/cccccccc-2800-4000-8000-000000000011/thumbnails/o.png';

set local role postgres;
select is(
  (select metadata ->> 'by' from storage.objects where bucket_id = 'project-assets' and name = 'episodes/cccccccc-2800-4000-8000-000000000011/thumbnails/o.png'),
  'owner-ep',
  'The owner may replace their own episodes/<episodeId>/... object'
);

select makerkit.authenticate_as('kb28_owner');

select throws_ok(
  $$ update storage.objects set name = 'projects/cccccccc-2800-4000-8000-000000000003/assets/moved.png'
     where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/a.png' $$,
  '42501', null, 'An object may not be moved into a project the caller does not write to'
);

-- ==================================
-- DELETE
-- ==================================

-- storage.protect_delete refuses a direct DELETE unless this is set. The
-- Storage API sets it for its own deletes, which are what these cases
-- stand in for; RLS still decides which rows the DELETE can see.
set local storage.allow_delete_query = 'true';

select makerkit.authenticate_as('kb28_stranger');

delete from storage.objects
where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/m.png';

set local role postgres;
select isnt_empty(
  $$ select 1 from storage.objects where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/m.png' $$,
  'A stranger''s delete of a member''s object removes nothing'
);

select makerkit.authenticate_as('kb28_viewer');

delete from storage.objects
where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/m.png';

set local role postgres;
select isnt_empty(
  $$ select 1 from storage.objects where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/m.png' $$,
  'A viewer''s delete removes nothing'
);

-- Before KB-28 this matched no row and reported success.
select makerkit.authenticate_as('kb28_owner');

delete from storage.objects
where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/m.png';

set local role postgres;
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'project-assets' and name = 'projects/cccccccc-2800-4000-8000-000000000001/assets/character/m.png' $$,
  'The owner may delete an object in projects/<projectId>/...'
);

-- ==================================
-- SELECT (unchanged: the bucket is public)
-- ==================================

select makerkit.authenticate_as('kb28_stranger');
select isnt_empty(
  $$ select 1 from storage.objects where bucket_id = 'project-assets' and name = 'cccccccc-2800-4000-8000-000000000001/cover.png' $$,
  'Reads stay open: project-assets is a public bucket'
);

-- ==================================
-- Bucket limits
-- ==================================

set local role postgres;

select is(
  (select file_size_limit from storage.buckets where id = 'project-assets'),
  524288000::bigint,
  'project-assets refuses objects over 500 MB'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'project-assets'),
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/mpeg','audio/wav','audio/ogg','audio/mp4'],
  'project-assets accepts only the UPLOAD_CONSTRAINTS types'
);

-- ==================================
-- update_project_cover_image
-- ==================================

select makerkit.authenticate_as('kb28_stranger');
select throws_ok(
  $$ select public.update_project_cover_image('cccccccc-2800-4000-8000-000000000001', 'https://attacker.example/x.png') $$,
  '42501', null, 'A stranger may not change a project''s cover'
);

select makerkit.authenticate_as('kb28_member');
select throws_ok(
  $$ select public.update_project_cover_image('cccccccc-2800-4000-8000-000000000001', 'https://member.example/x.png') $$,
  '42501', null, 'A member is not an editor and may not change the cover'
);

set local role postgres;
select is(
  (select metadata ->> 'coverImageUrl' from public.projects where id = 'cccccccc-2800-4000-8000-000000000001'),
  null::text,
  'The refused calls left the cover unchanged'
);

select makerkit.authenticate_as('kb28_admin');
select lives_ok(
  $$ select public.update_project_cover_image('cccccccc-2800-4000-8000-000000000001', 'https://cdn.example/admin.png') $$,
  'An admin may change the cover'
);

select makerkit.authenticate_as('kb28_owner');
select lives_ok(
  $$ select public.update_project_cover_image('cccccccc-2800-4000-8000-000000000001', 'https://cdn.example/owner.png') $$,
  'The owner may change the cover'
);

set local role postgres;
select is(
  (select metadata ->> 'coverImageUrl' from public.projects where id = 'cccccccc-2800-4000-8000-000000000001'),
  'https://cdn.example/owner.png',
  'The owner''s cover was saved'
);

select * from finish();

rollback;
