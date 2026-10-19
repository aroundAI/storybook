begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(6);

-- KB-207. Deleting an episode (episodes.deleted_at) cancels its posts that
-- have not started; the ones that started or finished stay as history.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

set local role postgres;

select set_config('kb207.story', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.platform_connections (id, account_id, platform, platform_account_name)
values ('20700000-0000-4000-8000-000000000001',
        current_setting('kb207.story')::uuid, 'youtube', 'KB-207 Channel');

select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('20700000-0000-4000-8000-0000000000a1',
          current_setting('kb207.story')::uuid, 'KB-207 fixture', 'active');

set local role postgres;

insert into public.project_members (project_id, user_id, role)
  values ('20700000-0000-4000-8000-0000000000a1', tests.get_supabase_uid('member'), 'member');

insert into public.episodes (id, project_id, number, title, status)
  values ('20700000-0000-4000-8000-0000000000e1',
          '20700000-0000-4000-8000-0000000000a1', 1, 'Deleted', 'draft'),
         ('20700000-0000-4000-8000-0000000000e2',
          '20700000-0000-4000-8000-0000000000a1', 2, 'Kept', 'draft');

-- One publish per status on the episode to delete, one scheduled on the other
insert into public.publishes
  (id, episode_id, platform_connection_id, platform, content_type, status, scheduled_at)
select ('20700000-0000-4000-8000-00000000000' || n)::uuid,
       '20700000-0000-4000-8000-0000000000e1',
       '20700000-0000-4000-8000-000000000001', 'youtube', 'full', status,
       timestamptz '2026-11-01 12:00+00' + n * interval '1 day'
  from unnest(array['scheduled', 'queued', 'publishing', 'published', 'failed', 'deleted'])
       with ordinality as s(status, n);

insert into public.publishes
  (id, episode_id, platform_connection_id, platform, content_type, status, scheduled_at)
values ('20700000-0000-4000-8000-0000000000f1',
        '20700000-0000-4000-8000-0000000000e2',
        '20700000-0000-4000-8000-000000000001', 'youtube', 'full', 'scheduled',
        timestamptz '2026-11-20 12:00+00');

-- A member may delete the episode but not a publish: the cancel still runs
select makerkit.authenticate_as('member');

update public.episodes set deleted_at = now()
 where id = '20700000-0000-4000-8000-0000000000e1';

set local role postgres;

select is(
  (select count(*)::int from public.episodes
    where id = '20700000-0000-4000-8000-0000000000e1' and deleted_at is not null),
  1,
  'the member deleted the episode'
);

select is(
  (select array_agg(status::text order by status) from public.publishes
    where episode_id = '20700000-0000-4000-8000-0000000000e1'),
  array['deleted', 'failed', 'published', 'publishing'],
  'its scheduled and queued posts are cancelled; started and finished ones stay'
);

select is(
  (select status::text from public.publishes where id = '20700000-0000-4000-8000-0000000000f1'),
  'scheduled',
  'another episode''s scheduled post is untouched'
);

-- Another update of a deleted episode cancels nothing new
insert into public.publishes
  (id, episode_id, platform_connection_id, platform, content_type, status, scheduled_at)
values ('20700000-0000-4000-8000-0000000000f2',
        '20700000-0000-4000-8000-0000000000e1',
        '20700000-0000-4000-8000-000000000001', 'youtube', 'full', 'scheduled',
        timestamptz '2026-11-21 12:00+00');

update public.episodes set title = 'Renamed', deleted_at = now()
 where id = '20700000-0000-4000-8000-0000000000e1';

select is(
  (select count(*)::int from public.publishes where id = '20700000-0000-4000-8000-0000000000f2'),
  1,
  'only the change from live to deleted cancels'
);

-- Restoring and deleting again cancels again
update public.episodes set deleted_at = null
 where id = '20700000-0000-4000-8000-0000000000e1';
update public.episodes set deleted_at = now()
 where id = '20700000-0000-4000-8000-0000000000e1';

select is(
  (select count(*)::int from public.publishes where id = '20700000-0000-4000-8000-0000000000f2'),
  0,
  'deleting a restored episode cancels its scheduled posts'
);

select is(
  (select count(*)::int from public.publishes
    where episode_id = '20700000-0000-4000-8000-0000000000e2'),
  1,
  'the live episode keeps its post'
);

select * from finish();

rollback;
