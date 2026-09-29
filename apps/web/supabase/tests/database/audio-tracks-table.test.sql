begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(11);

-- FILM-101h (audio_tracks). The table's rules, one assertion each: the type
-- and volume checks, the non-negative timeline start, the cascade from the
-- episode, and the two reads the audio studio makes (by type, in timeline
-- order). Fixture ids start with 101a.

select tests.create_supabase_user('at_owner', 'at-owner@storybook.dev');

-- The creator trigger on `projects` reads auth.uid(), null when inserting
-- as postgres, so the owner creates the project.
select makerkit.authenticate_as('at_owner');
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('101a0000-0000-4000-8000-00000000000a', 'FILM-101h team', false, tests.get_supabase_uid('at_owner'));
insert into public.projects (id, account_id, name, status) values
  ('101a0000-0000-4000-8000-000000000001', '101a0000-0000-4000-8000-00000000000a', 'FILM-101h', 'active');
insert into public.episodes (id, project_id, number, title) values
  ('101a0000-0000-4000-8000-000000000011', '101a0000-0000-4000-8000-000000000001', 1, 'FILM-101h episode');

select lives_ok(
  $$ insert into public.audio_tracks (episode_id, type, name)
     values ('101a0000-0000-4000-8000-000000000011', 'music', 'theme') $$,
  'a track for an existing episode with a valid type is accepted'
);

select throws_ok(
  $$ insert into public.audio_tracks (episode_id, type)
     values ('101a0000-0000-4000-8000-000000000011', 'podcast') $$,
  '23514', null,
  'a type outside music, sfx, dialogue_composite and ambient is refused'
);

select lives_ok(
  $$ insert into public.audio_tracks (episode_id, type, name, volume)
     values ('101a0000-0000-4000-8000-000000000011', 'sfx', 'at the limit', 2.0) $$,
  'volume 2.0, the top of its range, is accepted'
);

select throws_ok(
  $$ insert into public.audio_tracks (episode_id, type, volume)
     values ('101a0000-0000-4000-8000-000000000011', 'sfx', 2.01) $$,
  '23514', null,
  'a volume above 2.0 is refused'
);

select throws_ok(
  $$ insert into public.audio_tracks (episode_id, type, timeline_start_seconds)
     values ('101a0000-0000-4000-8000-000000000011', 'sfx', -0.5) $$,
  '23514', null,
  'a negative timeline start is refused'
);

select throws_ok(
  $$ insert into public.audio_tracks (episode_id, type, volume)
     values ('101a0000-0000-4000-8000-000000000011', 'ambient', -0.1) $$,
  '23514', null,
  'a negative volume is refused'
);

insert into public.audio_tracks (episode_id, type, name, timeline_start_seconds) values
  ('101a0000-0000-4000-8000-000000000011', 'music', 'outro', 90),
  ('101a0000-0000-4000-8000-000000000011', 'ambient', 'rain', 12.5),
  ('101a0000-0000-4000-8000-000000000011', 'music', 'intro', 0.25);

select results_eq(
  $$ select name from public.audio_tracks
     where episode_id = '101a0000-0000-4000-8000-000000000011' and type = 'music'
     order by name $$,
  $$ values ('intro'::varchar), ('outro'), ('theme') $$,
  'tracks can be read by type'
);

select results_eq(
  $$ select name from public.audio_tracks
     where episode_id = '101a0000-0000-4000-8000-000000000011'
       and name in ('outro', 'rain', 'intro')
     order by timeline_start_seconds $$,
  $$ values ('intro'::varchar), ('rain'), ('outro') $$,
  'tracks come back in timeline order'
);

select has_index(
  'public', 'audio_tracks', 'idx_audio_tracks_type',
  array['episode_id', 'type'],
  'the (episode, type) index behind the by-type read exists'
);

delete from public.episodes where id = '101a0000-0000-4000-8000-000000000011';

select is(
  (select count(*)::int from public.audio_tracks
    where episode_id = '101a0000-0000-4000-8000-000000000011'),
  0,
  'deleting the episode deletes its tracks'
);

select is(
  (select count(*)::int from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'audio_tracks'
      and constraint_type = 'CHECK' and constraint_name like 'audio_tracks_%_check'),
  3,
  'the three check constraints (type, volume, timeline start) are all present'
);

select * from finish();
rollback;
