begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(8);

-- KB-98. `publish_tags_create` checked access to the publish only, so a tag
-- from any account was accepted — reproduced through RLS on 2026-09-25 by a
-- user who could not even see the tag — and dim-sync copied its slug into
-- this account's ClickHouse rows. The same hole experiment_tags had (KB-93).
-- The user in both accounts is the case only the policy can decide: RLS
-- lets them see both tags.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('pt_other_owner', 'pt-other-owner@storybook.dev');
select makerkit.authenticate_as('pt_other_owner');
select public.create_team_account('PT Other Co');

-- The project is created as the primary owner, who the creator trigger
-- makes its owner.
select makerkit.authenticate_as('primary_owner');
set local role postgres;

select set_config('pt.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('pt.other', makerkit.get_account_id_by_slug('pt-other-co')::text, true);

insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('member'), current_setting('pt.other')::uuid, 'member');

insert into public.content_tags (id, account_id, dimension, slug, label)
  values ('98989898-0000-4000-8000-000000000001', current_setting('pt.story')::uuid, 'topic', 'kb98-own', 'Own tag'),
         ('98989898-0000-4000-8000-000000000002', current_setting('pt.other')::uuid, 'topic', 'kb98-foreign', 'Foreign tag');

insert into public.projects (id, account_id, name, slug)
  values ('98989898-0000-4000-8000-000000000011', current_setting('pt.story')::uuid, 'KB-98 tags', 'kb-98-tags');
insert into public.episodes (id, project_id, number, title)
  values ('98989898-0000-4000-8000-000000000012', '98989898-0000-4000-8000-000000000011', 1, 'Episode');
insert into public.publishes (id, episode_id, platform, status)
  values ('98989898-0000-4000-8000-000000000013', '98989898-0000-4000-8000-000000000012', 'youtube', 'draft');

select makerkit.authenticate_as('member');

select results_eq(
  $$ select count(*)::int from public.content_tags
      where id in ('98989898-0000-4000-8000-000000000001',
                   '98989898-0000-4000-8000-000000000002') $$,
  array[2],
  'The member can see both tags, so only the policy can refuse the foreign one'
);

select lives_ok(
  $$ insert into public.publish_tags (publish_id, tag_id)
     values ('98989898-0000-4000-8000-000000000013', '98989898-0000-4000-8000-000000000001') $$,
  'A tag from the video''s own account can be linked'
);

select throws_ok(
  $$ insert into public.publish_tags (publish_id, tag_id)
     values ('98989898-0000-4000-8000-000000000013', '98989898-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'A tag from another account cannot be linked, even by someone in both'
);

select results_eq(
  $$ select tag_id from public.publish_tags
      where publish_id = '98989898-0000-4000-8000-000000000013' $$,
  array['98989898-0000-4000-8000-000000000001'::uuid],
  'Only the own-account link exists'
);

select throws_ok(
  $$ update public.content_tags
        set account_id = current_setting('pt.other')::uuid
      where id = '98989898-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'A tag cannot be moved to another account, which would make its links cross-account'
);

-- The ticket's reproduction: someone who cannot even see the tag.
select makerkit.authenticate_as('primary_owner');

select results_eq(
  $$ select count(*)::int from public.content_tags
      where id = '98989898-0000-4000-8000-000000000002' $$,
  array[0],
  'The owner cannot see the other account''s tag'
);

select throws_ok(
  $$ insert into public.publish_tags (publish_id, tag_id)
     values ('98989898-0000-4000-8000-000000000013', '98989898-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'A tag the caller cannot see is refused too'
);

select tests.create_supabase_user('pt_stranger', 'pt-stranger@storybook.dev');
select makerkit.authenticate_as('pt_stranger');

select throws_ok(
  $$ insert into public.publish_tags (publish_id, tag_id)
     values ('98989898-0000-4000-8000-000000000013', '98989898-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'Someone outside the account cannot tag its video'
);

select * from finish();

rollback;
