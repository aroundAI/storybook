begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-95: once Delete soft-deletes an audio-library asset, the semantic
-- matcher must not return it for a new cue. Two assets with the same
-- embedding in one project, one deleted: only the live one matches.
select plan(3);

select tests.create_supabase_user('kb95_owner', 'kb95-owner@storybook.dev');

select makerkit.authenticate_as('kb95_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('95950000-0000-4000-8000-00000000000a', 'KB-95 team', false, tests.get_supabase_uid('kb95_owner'));

insert into public.projects (id, account_id, name, status)
values ('95950000-0000-4000-8000-000000000001', '95950000-0000-4000-8000-00000000000a', 'KB-95 P', 'active');

insert into public.audio_assets
  (id, project_id, audio_type, prompt_hash, prompt, status, file_url, embedding, deleted_at)
values
  ('95950000-0000-4000-8000-0000000000a1', '95950000-0000-4000-8000-000000000001',
   'sfx', 'kb95-live', 'Door slam', 'completed', 'https://cdn.test/live.mp3',
   array_fill(0.1, array[1536])::vector, null),
  ('95950000-0000-4000-8000-0000000000d1', '95950000-0000-4000-8000-000000000001',
   'sfx', 'kb95-deleted', 'Door slam', 'completed', 'https://cdn.test/deleted.mp3',
   array_fill(0.1, array[1536])::vector, now());

select is(
  (select count(*)::int from public.match_audio_assets(
    array_fill(0.1, array[1536])::vector, 0.5, 10,
    '95950000-0000-4000-8000-000000000001')),
  1,
  'M1 one match: the deleted asset is not returned'
);

select is(
  (select id from public.match_audio_assets(
    array_fill(0.1, array[1536])::vector, 0.5, 10,
    '95950000-0000-4000-8000-000000000001')),
  '95950000-0000-4000-8000-0000000000a1'::uuid,
  'M2 the match is the live asset'
);

-- Control: with the deletion undone, both match, so M1 is about deleted_at
-- and not about the fixture
update public.audio_assets set deleted_at = null
 where id = '95950000-0000-4000-8000-0000000000d1';

select is(
  (select count(*)::int from public.match_audio_assets(
    array_fill(0.1, array[1536])::vector, 0.5, 10,
    '95950000-0000-4000-8000-000000000001')),
  2,
  'M3 control: undeleted, both assets match'
);

select * from finish();
rollback;
