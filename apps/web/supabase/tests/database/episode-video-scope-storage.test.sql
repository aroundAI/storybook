begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(8);

-- KB-123. A publish may send any file of the episode's own project: the
-- episode's folders, a sibling episode's, or the project's
-- (ownedEpisodeVideo; owner, 2026-09-25). The argument is that whoever can
-- publish the episode can already write every one of those files, so the
-- rule grants nothing new. That rests on the project-assets storage policies
-- (can_write_project_storage, KB-28), so it is tested here, with real roles:
-- a project member can publish and can write each allowed location, and
-- cannot write a project they are not in, even in the same account.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('ev_other_owner', 'ev-other-owner@storybook.dev');
select makerkit.authenticate_as('ev_other_owner');
select public.create_team_account('EV Other Co');

select makerkit.authenticate_as('primary_owner');
set local role postgres;

select set_config('ev.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('ev.other', makerkit.get_account_id_by_slug('ev-other-co')::text, true);

insert into public.projects (id, account_id, name, slug)
  values ('e7e7a000-0000-4000-8000-000000000011', current_setting('ev.story')::uuid, 'EV project', 'ev-project'),
         ('e7e7a000-0000-4000-8000-000000000021', current_setting('ev.story')::uuid, 'EV same account', 'ev-same-account'),
         ('e7e7a000-0000-4000-8000-000000000031', current_setting('ev.other')::uuid, 'EV other account', 'ev-other-account');
insert into public.project_members (project_id, user_id, role)
  values ('e7e7a000-0000-4000-8000-000000000011', tests.get_supabase_uid('member'), 'member');
insert into public.episodes (id, project_id, number, title)
  values ('e7e7a000-0000-4000-8000-000000000012', 'e7e7a000-0000-4000-8000-000000000011', 1, 'Episode'),
         ('e7e7a000-0000-4000-8000-000000000013', 'e7e7a000-0000-4000-8000-000000000011', 2, 'Sibling'),
         ('e7e7a000-0000-4000-8000-000000000022', 'e7e7a000-0000-4000-8000-000000000021', 1, 'Same account'),
         ('e7e7a000-0000-4000-8000-000000000032', 'e7e7a000-0000-4000-8000-000000000031', 1, 'Other account');

select makerkit.authenticate_as('member');

select lives_ok(
  $$ insert into public.publishes (episode_id, platform, status)
     values ('e7e7a000-0000-4000-8000-000000000012', 'youtube', 'draft') $$,
  'The project member can publish the episode'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('project-assets', 'episodes/e7e7a000-0000-4000-8000-000000000012/videos/a.mp4') $$,
  '... and can write its own videos folder (class 1)'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('project-assets', 'episodes/e7e7a000-0000-4000-8000-000000000012/thumbnails/b.mp4') $$,
  '... and another of its folders (class 2)'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('project-assets', 'projects/e7e7a000-0000-4000-8000-000000000011/shots/s/video/c.mp4') $$,
  '... and the project''s folders (classes 3 and 4)'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('project-assets', 'episodes/e7e7a000-0000-4000-8000-000000000013/videos/d.mp4') $$,
  '... and a sibling episode''s folder (class 5): the same project grants nothing new'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('project-assets', 'episodes/e7e7a000-0000-4000-8000-000000000022/videos/e.mp4') $$,
  '42501',
  null,
  'A project in the same account they are not a member of is not theirs to write (class 6), so the boundary stops at the project'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('project-assets', 'projects/e7e7a000-0000-4000-8000-000000000021/assets/f.mp4') $$,
  '42501',
  null,
  '... by either folder shape'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('project-assets', 'episodes/e7e7a000-0000-4000-8000-000000000032/videos/g.mp4') $$,
  '42501',
  null,
  'Nor another account''s project (class 7)'
);

select * from finish();

rollback;
