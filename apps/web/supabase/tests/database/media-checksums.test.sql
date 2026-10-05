begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(9);

-- KB-189: media_checksums holds the SHA-256 recorded when each file was
-- written. The edit package reads it with the caller's client, so a
-- viewer of the project reads it and a stranger does not; only the service
-- role (workers, server actions, the checksum route) writes it, through
-- record_media_checksum, which files the row under the key's own project.

select tests.create_supabase_user('kb189_owner', 'kb189-owner@storybook.dev');
select tests.create_supabase_user('kb189_viewer', 'kb189-viewer@storybook.dev');
select tests.create_supabase_user('kb189_stranger', 'kb189-stranger@storybook.dev');

select makerkit.authenticate_as('kb189_owner');
select public.create_team_account('KB189 Team');
select set_config('kb189.team', makerkit.get_account_id_by_slug('kb189-team')::text, true);

insert into public.projects (id, account_id, name, slug, status)
  values ('18900000-0000-4000-8000-000000000001', current_setting('kb189.team')::uuid,
          'Checksums', 'kb189-checksums', 'active');

select makerkit.authenticate_as('kb189_stranger');
select public.create_team_account('KB189 Stranger Co');

set local role postgres;

insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('kb189_viewer'), current_setting('kb189.team')::uuid, 'member');
insert into public.project_members (project_id, user_id, role)
  values ('18900000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb189_viewer'), 'viewer');
insert into public.episodes (id, project_id, number, title, status)
  values ('18900000-0000-4000-8000-0000000000e1', '18900000-0000-4000-8000-000000000001',
          1, 'Pilot', 'storyboard');

set local role service_role;

select lives_ok(
  $$ select public.record_media_checksum('audio',
       'episodes/18900000-0000-4000-8000-0000000000e1/dialogue/line_1.mp3', repeat('ab', 32), 24000) $$,
  'W1 the service role records an episode key'
);

select is(
  (select project_id from public.media_checksums
    where bucket = 'audio' and object_key = 'episodes/18900000-0000-4000-8000-0000000000e1/dialogue/line_1.mp3'),
  '18900000-0000-4000-8000-000000000001'::uuid,
  'W2 an episode key is filed under its episode''s project'
);

select public.record_media_checksum('project-assets',
  'projects/18900000-0000-4000-8000-000000000001/shots/18900000-0000-4000-8000-0000000000a1/video/1-a.mp4',
  repeat('CD', 32), 2000000);
select public.record_media_checksum('project-assets',
  'projects/18900000-0000-4000-8000-000000000001/shots/18900000-0000-4000-8000-0000000000a1/video/1-a.mp4',
  repeat('ef', 32), 2000001);

select results_eq(
  $$ select sha256, bytes from public.media_checksums
      where object_key like 'projects/18900000-0000-4000-8000-000000000001/shots/%' $$,
  $$ values (repeat('ef', 32), 2000001::bigint) $$,
  'W3 recording a key again replaces its row, lower-cased'
);

select throws_ok(
  $$ select public.record_media_checksum('audio-assets', 'music/x.mp3', repeat('ab', 32), 1) $$,
  '22023', null,
  'W4 a key that names no project is refused'
);

select throws_ok(
  $$ select public.record_media_checksum('audio',
       'episodes/18900000-0000-4000-8000-0000000000e1/dialogue/line_2.mp3', 'not-a-hash', 1) $$,
  '23514', null,
  'W5 anything but a 64-character hex SHA-256 is refused'
);

select makerkit.authenticate_as('kb189_viewer');

select is(
  (select count(*) from public.media_checksums),
  2::bigint,
  'R1 a viewer-role member reads the project''s checksums, as the edit package does'
);

select throws_ok(
  $$ select public.record_media_checksum('audio',
       'episodes/18900000-0000-4000-8000-0000000000e1/dialogue/line_3.mp3', repeat('ab', 32), 1) $$,
  '42501', null,
  'P1 a signed-in user cannot call the write function'
);

select throws_ok(
  $$ update public.media_checksums set sha256 = repeat('00', 32) $$,
  '42501', null,
  'P2 nor write the table directly'
);

select makerkit.authenticate_as('kb189_stranger');

select is(
  (select count(*) from public.media_checksums),
  0::bigint,
  'R2 a stranger reads none of them'
);

select * from finish();
rollback;
