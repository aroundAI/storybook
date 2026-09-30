begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(10);

-- FILM-202. updateCharacterAction wrote the asset, committed, then wrote the
-- details, so a failed details write left the asset changed. This file holds
-- update_character_with_details to one transaction and to project write
-- access. Fixture ids start with 2021.

select tests.create_supabase_user('cu_owner', 'cu-owner@storybook.dev');
select tests.create_supabase_user('cu_member', 'cu-member@storybook.dev');
select tests.create_supabase_user('cu_viewer', 'cu-viewer@storybook.dev');
select tests.create_supabase_user('cu_outsider', 'cu-outsider@storybook.dev');

select makerkit.authenticate_as('cu_owner');
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('20210000-0000-4000-8000-00000000000a', 'FILM-202 update team', false, tests.get_supabase_uid('cu_owner'));

select makerkit.authenticate_as('cu_owner');
insert into public.projects (id, account_id, name, status) values
  ('20210000-0000-4000-8000-000000000001', '20210000-0000-4000-8000-00000000000a', 'FILM-202 update', 'active');

set local role postgres;
insert into public.project_members (project_id, user_id, role) values
  ('20210000-0000-4000-8000-000000000001', tests.get_supabase_uid('cu_member'), 'member'),
  ('20210000-0000-4000-8000-000000000001', tests.get_supabase_uid('cu_viewer'), 'viewer');

insert into public.assets (id, project_id, type, name, description) values
  ('20210000-0000-4000-8000-0000000000a1', '20210000-0000-4000-8000-000000000001', 'character', 'Mara', 'orig');
insert into public.character_details (asset_id, physical_attributes, personality, element_prompt, reference_images, elevenlabs_voice_id)
values ('20210000-0000-4000-8000-0000000000a1', '{"age": 30, "hair": "red"}'::jsonb, 'calm', 'prompt', array['u1'], 'voice-1');

select makerkit.authenticate_as('cu_member');

select lives_ok(
  $$ select public.update_character_with_details(
       '20210000-0000-4000-8000-0000000000a1'::uuid,
       '{"name": "Mara II"}'::jsonb,
       '{"personality": "bold"}'::jsonb,
       '{"age": 31}'::jsonb) $$,
  'a project member updates asset and details in one call'
);

set local role postgres;
select results_eq(
  $$ select a.name::text, a.description, cd.personality, cd.element_prompt,
            cd.elevenlabs_voice_id, cd.physical_attributes::text
       from public.assets a join public.character_details cd on cd.asset_id = a.id
      where a.id = '20210000-0000-4000-8000-0000000000a1'::uuid $$,
  $$ values ('Mara II', 'orig', 'bold', 'prompt', 'voice-1', '{"age": 31, "hair": "red"}') $$,
  'given keys change, absent keys keep their value, attributes merge'
);

select makerkit.authenticate_as('cu_member');
select lives_ok(
  $$ select public.update_character_with_details(
       '20210000-0000-4000-8000-0000000000a1'::uuid,
       '{"description": null}'::jsonb, '{"reference_images": []}'::jsonb) $$,
  'an explicit null clears a field'
);

set local role postgres;
select results_eq(
  $$ select a.description, cd.reference_images from public.assets a
       join public.character_details cd on cd.asset_id = a.id where a.id = '20210000-0000-4000-8000-0000000000a1' $$,
  $$ values (null::text, array[]::text[]) $$,
  'the cleared description is null and the images are the empty array'
);

set local role postgres;
alter table public.character_details
  add constraint fn202u_no_boom check (personality is distinct from 'boom');
select makerkit.authenticate_as('cu_member');

select throws_like(
  $$ select public.update_character_with_details(
       '20210000-0000-4000-8000-0000000000a1'::uuid,
       '{"name": "Renamed"}'::jsonb, '{"personality": "boom"}'::jsonb) $$,
  '%fn202u_no_boom%',
  'a failing details write is reported'
);

set local role postgres;
select is(
  (select name from public.assets where id = '20210000-0000-4000-8000-0000000000a1'),
  'Mara II',
  'and the asset update in the same call is rolled back'
);

select makerkit.authenticate_as('cu_viewer');
select throws_like(
  $$ select public.update_character_with_details(
       '20210000-0000-4000-8000-0000000000a1'::uuid, '{"name": "Viewer"}'::jsonb) $$,
  'Access denied%',
  'a viewer cannot update a character'
);

select makerkit.authenticate_as('cu_outsider');
select throws_like(
  $$ select public.update_character_with_details(
       '20210000-0000-4000-8000-0000000000a1'::uuid, '{"name": "Outsider"}'::jsonb) $$,
  'Access denied%',
  'someone outside the project cannot update a character'
);

select makerkit.authenticate_as('cu_member');
select throws_like(
  $$ select public.update_character_with_details(
       '20210000-0000-4000-8000-0000000000ff', '{"name": "Ghost"}'::jsonb) $$,
  'Access denied%',
  'an unknown character is reported the same way as a forbidden one'
);

set local role postgres;
select is(
  (select count(*)::int from public.assets where name in ('Viewer', 'Outsider', 'Ghost', 'Renamed')),
  0,
  'none of the refused updates changed anything'
);

select * from finish();
rollback;
