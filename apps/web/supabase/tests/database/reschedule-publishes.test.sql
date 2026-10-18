begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(16);

-- FILM-2210. A breaking release moves a channel's queued Shorts back and
-- writes its own posts in one call (reschedule_publishes), and marks them
-- publishes.release_priority = 'breaking'.
--
-- Foreign ids are stashed with set_config while still postgres, as in
-- channel-posting-cadence.test.sql.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('brk_outsider', 'brk-outsider@storybook.dev');
select makerkit.authenticate_as('brk_outsider');
select public.create_team_account('Breaking Other Co');

set local role postgres;

select set_config('brk.story', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.platform_connections (id, account_id, platform, platform_account_name)
values ('22100000-0000-4000-8000-000000000001',
        current_setting('brk.story')::uuid, 'youtube', 'Story Channel');

select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('22100000-0000-4000-8000-0000000000a1',
          current_setting('brk.story')::uuid, 'Breaking fixture', 'active');

set local role postgres;

insert into public.project_members (project_id, user_id, role)
  values ('22100000-0000-4000-8000-0000000000a1', tests.get_supabase_uid('member'), 'member');

insert into public.episodes (id, project_id, number, title, status)
  values ('22100000-0000-4000-8000-0000000000e1',
          '22100000-0000-4000-8000-0000000000a1', 1, 'E1', 'draft'),
         ('22100000-0000-4000-8000-0000000000e2',
          '22100000-0000-4000-8000-0000000000a1', 2, 'Breaking', 'draft');

-- 40 Shorts, one a day at 12:00 UTC from 2026-11-01, each holding a slot
insert into public.publishes
  (id, episode_id, platform_connection_id, platform, content_type, status,
   scheduled_at, slot_at)
select ('22100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       '22100000-0000-4000-8000-0000000000e1',
       '22100000-0000-4000-8000-000000000001', 'youtube', 'short', 'scheduled',
       timestamptz '2026-11-01 12:05+00' + (n - 1) * interval '1 day',
       timestamptz '2026-11-01 12:00+00' + (n - 1) * interval '1 day'
  from generate_series(1, 40) n;

-- Each Short takes the next one's slot: the last moves to a new day
select set_config('brk.shift', (
  select jsonb_agg(jsonb_build_object(
           'id', id,
           'slot_at', slot_at + interval '1 day',
           'scheduled_at', scheduled_at + interval '1 day'))::text
    from public.publishes
   where episode_id = '22100000-0000-4000-8000-0000000000e1'
), true);

-- ==================================
-- Column
-- ==================================

select is(
  (select release_priority from public.publishes
    where id = '22100000-0000-4000-8000-000000000001'),
  'normal',
  'a post is normal unless it says breaking'
);

select throws_ok(
  $$ update public.publishes set release_priority = 'urgent'
      where id = '22100000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'a post is normal or breaking, nothing else'
);

-- ==================================
-- Moving a queue
-- ==================================

select makerkit.authenticate_as('member');

select lives_ok(
  $$ select public.reschedule_publishes(current_setting('brk.shift')::jsonb) $$,
  'a member shifts 40 Shorts a slot each without tripping the slot index'
);

select is(
  (select array_agg(slot_at order by slot_at) from public.publishes
    where episode_id = '22100000-0000-4000-8000-0000000000e1'),
  (select array_agg(timestamptz '2026-11-02 12:00+00' + n * interval '1 day' order by n)
     from generate_series(0, 39) n),
  'every Short holds the slot after its old one'
);

select is(
  (select scheduled_at from public.publishes
    where id = '22100000-0000-4000-8000-000000000001'),
  timestamptz '2026-11-02 12:05+00',
  'and goes at its new time'
);

-- A move onto a slot a post that does not move holds: nothing moves
select throws_ok(
  $$ select public.reschedule_publishes(jsonb_build_array(
       jsonb_build_object('id', '22100000-0000-4000-8000-000000000001',
                          'slot_at', '2026-11-20 12:00+00',
                          'scheduled_at', '2026-11-20 12:00+00'),
       jsonb_build_object('id', '22100000-0000-4000-8000-000000000002',
                          'slot_at', '2026-11-05 12:00+00',
                          'scheduled_at', '2026-11-05 12:00+00'))) $$,
  '23505', null,
  'a move onto a held slot is refused'
);

select is(
  (select slot_at from public.publishes
    where id = '22100000-0000-4000-8000-000000000001'),
  timestamptz '2026-11-02 12:00+00',
  'and the post before it in the call did not move'
);

-- A post the scheduled job claimed stays where it is, and so does the call
set local role postgres;
update public.publishes set status = 'queued'
 where id = '22100000-0000-4000-8000-000000000003';

select makerkit.authenticate_as('member');

select throws_ok(
  $$ select public.reschedule_publishes(jsonb_build_array(
       jsonb_build_object('id', '22100000-0000-4000-8000-000000000001',
                          'slot_at', '2026-12-30 12:00+00',
                          'scheduled_at', '2026-12-30 12:00+00'),
       jsonb_build_object('id', '22100000-0000-4000-8000-000000000003',
                          'slot_at', '2026-12-31 12:00+00',
                          'scheduled_at', '2026-12-31 12:00+00'))) $$,
  '55000', null,
  'a queued post does not move'
);

select is(
  (select slot_at from public.publishes
    where id = '22100000-0000-4000-8000-000000000001'),
  timestamptz '2026-11-02 12:00+00',
  'and the scheduled post in the same call did not move either'
);

select throws_ok(
  $$ select public.reschedule_publishes(jsonb_build_array(
       jsonb_build_object('id', '22100000-0000-4000-8000-000000000001',
                          'slot_at', '2026-12-30 12:00+00',
                          'scheduled_at', '2026-12-30 12:00+00'),
       jsonb_build_object('id', '22100000-0000-4000-8000-000000000001',
                          'slot_at', '2026-12-31 12:00+00',
                          'scheduled_at', '2026-12-31 12:00+00'))) $$,
  '22023', null,
  'a post moves once per call'
);

-- ==================================
-- New posts in the same call
-- ==================================

select is(
  (select count(*)::int from public.reschedule_publishes(
     jsonb_build_array(jsonb_build_object(
       'id', '22100000-0000-4000-8000-000000000001',
       'slot_at', '2026-12-30 12:00+00',
       'scheduled_at', '2026-12-30 12:00+00')),
     jsonb_build_array(jsonb_build_object(
       'episode_id', '22100000-0000-4000-8000-0000000000e2',
       'platform_connection_id', '22100000-0000-4000-8000-000000000001',
       'platform', 'youtube', 'content_type', 'short', 'status', 'published',
       'scheduled_at', '2026-11-02 12:00+00', 'slot_at', '2026-11-02 12:00+00',
       'after_episode_full', true, 'release_priority', 'breaking')))),
  1,
  'a breaking Short takes the slot a Short gave up, in the same call'
);

select is(
  (select (status, release_priority, after_episode_full)::text
     from public.publishes
    where episode_id = '22100000-0000-4000-8000-0000000000e2'),
  '(scheduled,breaking,t)',
  'it is written scheduled, breaking, and waiting for its long video'
);

-- ==================================
-- Whose posts
-- ==================================

select makerkit.authenticate_as('brk_outsider');

select throws_ok(
  $$ select public.reschedule_publishes(jsonb_build_array(
       jsonb_build_object('id', '22100000-0000-4000-8000-000000000004',
                          'slot_at', '2027-01-30 12:00+00',
                          'scheduled_at', '2027-01-30 12:00+00'))) $$,
  '55000', null,
  'another team cannot move the team''s posts'
);

select throws_ok(
  $$ select public.reschedule_publishes('[]'::jsonb,
       jsonb_build_array(jsonb_build_object(
         'episode_id', '22100000-0000-4000-8000-0000000000e2',
         'platform_connection_id', '22100000-0000-4000-8000-000000000001',
         'platform', 'youtube', 'content_type', 'short',
         'scheduled_at', '2027-01-02 12:00+00',
         'release_priority', 'breaking'))) $$,
  '42501', null,
  'nor schedule posts for its episodes'
);

set local role postgres;

select is(
  (select slot_at from public.publishes
    where id = '22100000-0000-4000-8000-000000000004'),
  timestamptz '2026-11-05 12:00+00',
  'the team''s post is where it was'
);

select ok(
  not has_function_privilege('anon', 'public.reschedule_publishes(jsonb, jsonb)', 'EXECUTE'),
  'anon cannot call it'
);

select * from finish();
rollback;
