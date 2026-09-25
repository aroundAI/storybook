begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(3);

-- FILM-CC-04 KB-92. The audio-cue worker copies each cue's scene from the shot
-- it starts on and inserts every cue of an episode in one statement. A shot's
-- scene is optional, so audio_cues.scene_number must be too: under NOT NULL,
-- one sceneless shot lost the episode every cue.

select tests.create_supabase_user('kb92_owner', 'kb92-owner@storybook.dev');

select makerkit.authenticate_as('kb92_owner');
set local role postgres;
insert into public.projects (id, account_id, name, status) values
  ('9292a000-0000-4000-8000-000000000001', tests.get_supabase_uid('kb92_owner'), 'KB-92', 'active');
insert into public.episodes (id, project_id, number, title) values
  ('9292a000-0000-4000-8000-000000000011', '9292a000-0000-4000-8000-000000000001', 1, 'KB-92 episode');

select col_is_null(
  'public', 'audio_cues', 'scene_number',
  'audio_cues.scene_number accepts null, as shots.scene_number does'
);

-- The worker's insert: one statement, the middle cue on a sceneless shot.
select lives_ok(
  $$ insert into public.audio_cues (episode_id, scene_number, cue_type, prompt) values
       ('9292a000-0000-4000-8000-000000000011', 1, 'sfx', 'door'),
       ('9292a000-0000-4000-8000-000000000011', null, 'ambient', 'rain'),
       ('9292a000-0000-4000-8000-000000000011', 2, 'music', 'theme') $$,
  'one cue with no scene does not fail the other cues in the same insert'
);

select results_eq(
  $$ select prompt, scene_number from public.audio_cues
     where episode_id = '9292a000-0000-4000-8000-000000000011'
     order by scene_number nulls last $$,
  $$ values ('door'::text, 1), ('theme'::text, 2), ('rain'::text, null::integer) $$,
  'all three cues saved; the sceneless one keeps no scene'
);

select * from finish();
rollback;
