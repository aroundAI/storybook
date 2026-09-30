begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(7);

-- FILM-202. createCharacterAction inserts an asset, then its details, and
-- deletes the asset if the details fail. That compensating delete is subject
-- to RLS, and `assets_delete` admits only project owners and admins. This
-- file settles what a plain project member can and cannot clean up.
-- Fixture ids start with 2020.

select tests.create_supabase_user('cr_owner', 'cr-owner@storybook.dev');
select tests.create_supabase_user('cr_member', 'cr-member@storybook.dev');

select makerkit.authenticate_as('cr_owner');
set local role postgres;
insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('20200000-0000-4000-8000-00000000000a', 'FILM-202 team', false, tests.get_supabase_uid('cr_owner'));
insert into public.accounts_memberships (user_id, account_id, account_role)
values (tests.get_supabase_uid('cr_member'), '20200000-0000-4000-8000-00000000000a', 'member');

select makerkit.authenticate_as('cr_owner');
insert into public.projects (id, account_id, name, status) values
  ('20200000-0000-4000-8000-000000000001', '20200000-0000-4000-8000-00000000000a', 'FILM-202', 'active');

set local role postgres;
insert into public.project_members (project_id, user_id, role)
values ('20200000-0000-4000-8000-000000000001', tests.get_supabase_uid('cr_member'), 'member');

select makerkit.authenticate_as('cr_member');

-- Why the old code could not clean up: it deleted the asset itself, as the
-- member, and assets_delete admits only project owners and admins.
select lives_ok(
  $$ insert into public.assets (id, project_id, type, name)
     values ('20200000-0000-4000-8000-0000000000a1', '20200000-0000-4000-8000-000000000001', 'character', 'Direct') $$,
  'a project member can insert an asset directly'
);

with removed as (
  delete from public.assets where id = '20200000-0000-4000-8000-0000000000a1' returning 1
)
select is((select count(*)::int from removed), 0,
  'but cannot delete it again, so a compensating delete by the member removes nothing');

-- The fix: one call, one transaction, as the function's owner.
select lives_ok(
  $$ select public.create_character_with_details(
       '20200000-0000-4000-8000-000000000001', 'Whole', 'd', '{"age": 3}'::jsonb, 'p', 'e', array['u'],
       'voice-1', 'https://cdn.example.com/f.png', 'https://cdn.example.com/t.png') $$,
  'a member creates a character through the function, image URLs included'
);

select results_eq(
  $$ select a.file_url, a.thumbnail_url, a.metadata::text, cd.elevenlabs_voice_id
       from public.assets a join public.character_details cd on cd.asset_id = a.id
      where a.name = 'Whole' $$,
  $$ values ('https://cdn.example.com/f.png', 'https://cdn.example.com/t.png', '{}', 'voice-1') $$,
  'the asset and its details both exist with what was given'
);

set local role postgres;
alter table public.character_details
  add constraint fn202_no_boom check (personality is distinct from 'boom');
select makerkit.authenticate_as('cr_member');

select throws_like(
  $$ select public.create_character_with_details(
       '20200000-0000-4000-8000-000000000001', 'Boom', 'd', '{}'::jsonb, 'boom', 'e', array['u']) $$,
  'Failed to create character:%fn202_no_boom%',
  'a failing details insert is reported'
);

set local role postgres;
select is(
  (select count(*)::int from public.assets where name = 'Boom'),
  0,
  'and the member leaves no orphan asset behind'
);

select makerkit.authenticate_as('cr_member');
select throws_like(
  $$ select public.create_character_with_details(
       '20200000-0000-4000-8000-000000000001', 'Whole', 'd', '{}'::jsonb, 'p', 'e', array['u']) $$,
  '%duplicate key value violates unique constraint%',
  'a second character with the same name in the project is refused'
);

select * from finish();
rollback;
