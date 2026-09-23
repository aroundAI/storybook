begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-55 (audio buckets) and KB-56 (reports for personal-account owners).
-- A fixed plan, so a run that aborts early fails as a plan mismatch.
select plan(28);

-- Fixtures:
--   T  team account of kb55_owner; kb55_member and kb55_viewer are account
--      members.
--   P  project of T. kb55_owner is owner (creator), kb55_member is member,
--      kb55_viewer is viewer. Episode E.
--   U  kb55_personal's personal account.
--   kb55_stranger belongs to nothing.
--
-- Storage cases insert into storage.objects as `authenticated`: the row the
-- Storage API writes under a user's session, and the check it runs when it
-- signs an upload URL. MIME and size limits are enforced by the Storage API,
-- not here; this file asserts the bucket rows that configure them.

select tests.create_supabase_user('kb55_owner', 'kb55-owner@storybook.dev');
select tests.create_supabase_user('kb55_member', 'kb55-member@storybook.dev');
select tests.create_supabase_user('kb55_viewer', 'kb55-viewer@storybook.dev');
select tests.create_supabase_user('kb55_personal', 'kb55-personal@storybook.dev');
select tests.create_supabase_user('kb55_stranger', 'kb55-stranger@storybook.dev');

select makerkit.authenticate_as('kb55_owner');
select public.create_team_account('KB55 Team');

set local role postgres;

select set_config('kb55.team', makerkit.get_account_id_by_slug('kb55-team')::text, true);
select set_config('kb55.personal', tests.get_supabase_uid('kb55_personal')::text, true);

insert into public.accounts_memberships (user_id, account_id, account_role)
values
  (tests.get_supabase_uid('kb55_member'), current_setting('kb55.team')::uuid, 'member'),
  (tests.get_supabase_uid('kb55_viewer'), current_setting('kb55.team')::uuid, 'member');

select makerkit.authenticate_as('kb55_owner');

insert into public.projects (id, account_id, name, slug)
values ('dddddddd-5500-4000-8000-000000000001', current_setting('kb55.team')::uuid, 'KB-55', 'kb55');

set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
values ('dddddddd-5500-4000-8000-000000000011', 'dddddddd-5500-4000-8000-000000000001', 1, 'E', 'draft');

insert into public.project_members (project_id, user_id, role)
values
  ('dddddddd-5500-4000-8000-000000000001', tests.get_supabase_uid('kb55_member'), 'member'),
  ('dddddddd-5500-4000-8000-000000000001', tests.get_supabase_uid('kb55_viewer'), 'viewer');

-- ==================================
-- Buckets
-- ==================================

select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'audio' $$,
  $$ values (true, 52428800::bigint, array['audio/mpeg']::text[]) $$,
  'audio exists: public, 50 MB, MP3 only'
);

select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'audio-assets' $$,
  $$ values (true, 52428800::bigint, array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a']::text[]) $$,
  'audio-assets exists: public, 50 MB, the audio library''s types'
);

select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'reports' $$,
  $$ values (false, 52428800::bigint, array['text/csv', 'application/pdf']::text[]) $$,
  'reports stays private and takes only CSV and PDF'
);

-- ==================================
-- audio: project writers, on <projectId>/... paths
-- ==================================

select makerkit.authenticate_as('kb55_owner');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('audio', 'dddddddd-5500-4000-8000-000000000001/sfx/o.mp3', auth.uid()::text) $$,
  'audio: the project owner stores SFX (what sfx-actions writes)'
);

select makerkit.authenticate_as('kb55_member');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('audio', 'dddddddd-5500-4000-8000-000000000001/music/m.mp3', auth.uid()::text) $$,
  'audio: a project member stores music'
);

select makerkit.authenticate_as('kb55_viewer');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('audio', 'dddddddd-5500-4000-8000-000000000001/sfx/v.mp3', auth.uid()::text) $$,
  '42501', null, 'audio: a project viewer may not write'
);

select makerkit.authenticate_as('kb55_stranger');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('audio', 'dddddddd-5500-4000-8000-000000000001/sfx/planted.mp3', auth.uid()::text) $$,
  '42501', null, 'audio: a stranger may not plant into the project'
);

select makerkit.authenticate_as('kb55_owner');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('audio', 'dialogue/dddddddd-5500-4000-8000-000000000011/line.mp3', auth.uid()::text) $$,
  '42501', null, 'audio: dialogue/... names no project, so only the server writes it'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('audio', 'temp/' || auth.uid() || '/preview.mp3', auth.uid()::text) $$,
  '42501', null, 'audio: temp/... (voice preview) is server-written only'
);

select makerkit.authenticate_as('kb55_stranger');
update storage.objects set metadata = '{"by":"stranger"}'::jsonb
where bucket_id = 'audio' and name = 'dddddddd-5500-4000-8000-000000000001/sfx/o.mp3';

set local role postgres;
select is(
  (select metadata from storage.objects where bucket_id = 'audio' and name = 'dddddddd-5500-4000-8000-000000000001/sfx/o.mp3'),
  null::jsonb,
  'audio: a stranger''s update changes nothing'
);

select makerkit.authenticate_as('kb55_owner');
update storage.objects set metadata = '{"by":"owner"}'::jsonb
where bucket_id = 'audio' and name = 'dddddddd-5500-4000-8000-000000000001/sfx/o.mp3';

set local role postgres;
select is(
  (select metadata ->> 'by' from storage.objects where bucket_id = 'audio' and name = 'dddddddd-5500-4000-8000-000000000001/sfx/o.mp3'),
  'owner',
  'audio: the owner may replace their own object (SFX/music upsert)'
);

-- storage.protect_delete refuses a direct DELETE unless this is set. The
-- Storage API sets it for its own deletes, which these cases stand in for;
-- RLS still decides which rows the DELETE can see.
set local storage.allow_delete_query = 'true';

select makerkit.authenticate_as('kb55_stranger');
delete from storage.objects where bucket_id = 'audio' and name = 'dddddddd-5500-4000-8000-000000000001/music/m.mp3';

set local role postgres;
select isnt_empty(
  $$ select 1 from storage.objects where bucket_id = 'audio' and name = 'dddddddd-5500-4000-8000-000000000001/music/m.mp3' $$,
  'audio: a stranger''s delete removes nothing'
);

select makerkit.authenticate_as('kb55_member');
delete from storage.objects where bucket_id = 'audio' and name = 'dddddddd-5500-4000-8000-000000000001/music/m.mp3';

set local role postgres;
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'audio' and name = 'dddddddd-5500-4000-8000-000000000001/music/m.mp3' $$,
  'audio: a project member may delete'
);

-- ==================================
-- audio-assets: server-written only
-- ==================================

select makerkit.authenticate_as('kb55_owner');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('audio-assets', 'music/1-o.mp3', auth.uid()::text) $$,
  '42501', null, 'audio-assets: even a project owner may not write directly'
);

select makerkit.authenticate_as('kb55_stranger');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('audio-assets', 'music/1-planted.mp3', auth.uid()::text) $$,
  '42501', null, 'audio-assets: a stranger may not write'
);

set local role service_role;
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('audio-assets', 'music/1-server.mp3') $$,
  'audio-assets: the server (service role) writes the audio library'
);

-- ==================================
-- reports (KB-56)
-- ==================================

-- Refused before KB-56: has_role_on_account has no membership row for a
-- personal account's owner.
select makerkit.authenticate_as('kb55_personal');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('reports', 'exports/' || current_setting('kb55.personal') || '/1-report.csv', auth.uid()::text) $$,
  'reports: a personal-account owner exports a report (KB-56)'
);
select isnt_empty(
  $$ select 1 from storage.objects where bucket_id = 'reports' and name = 'exports/' || current_setting('kb55.personal') || '/1-report.csv' $$,
  'reports: a personal-account owner reads their own report (KB-56)'
);

select makerkit.authenticate_as('kb55_owner');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('reports', 'exports/' || current_setting('kb55.team') || '/1-owner.csv', auth.uid()::text) $$,
  'reports: the team''s owner exports a report'
);

select makerkit.authenticate_as('kb55_member');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('reports', 'exports/' || current_setting('kb55.team') || '/1-member.csv', auth.uid()::text) $$,
  'reports: a team member exports a report'
);
select isnt_empty(
  $$ select 1 from storage.objects where bucket_id = 'reports' and name = 'exports/' || current_setting('kb55.team') || '/1-owner.csv' $$,
  'reports: a team member reads the team''s reports'
);

select makerkit.authenticate_as('kb55_stranger');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('reports', 'exports/' || current_setting('kb55.team') || '/1-planted.csv', auth.uid()::text) $$,
  '42501', null, 'reports: a stranger may not write into a team''s exports'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('reports', 'exports/' || current_setting('kb55.personal') || '/1-planted.csv', auth.uid()::text) $$,
  '42501', null, 'reports: a stranger may not write into someone''s personal exports'
);
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'reports' $$,
  'reports: a stranger sees no report'
);

-- KB-56 widens to the account's own owner, not to other accounts.
select makerkit.authenticate_as('kb55_personal');
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'reports' and name like 'exports/' || current_setting('kb55.team') || '/%' $$,
  'reports: a personal owner sees no other account''s reports'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('reports', 'exports/' || current_setting('kb55.team') || '/1-cross.csv', auth.uid()::text) $$,
  '42501', null, 'reports: a personal owner may not write into another account'
);

select makerkit.authenticate_as('kb55_stranger');
delete from storage.objects where bucket_id = 'reports' and name = 'exports/' || current_setting('kb55.team') || '/1-owner.csv';

set local role postgres;
select isnt_empty(
  $$ select 1 from storage.objects where bucket_id = 'reports' and name = 'exports/' || current_setting('kb55.team') || '/1-owner.csv' $$,
  'reports: a stranger''s delete removes nothing'
);

select makerkit.authenticate_as('kb55_owner');
delete from storage.objects where bucket_id = 'reports' and name = 'exports/' || current_setting('kb55.team') || '/1-owner.csv';

set local role postgres;
select is_empty(
  $$ select 1 from storage.objects where bucket_id = 'reports' and name = 'exports/' || current_setting('kb55.team') || '/1-owner.csv' $$,
  'reports: the team''s owner deletes their report'
);

select * from finish();

rollback;
