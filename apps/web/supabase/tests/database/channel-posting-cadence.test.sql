begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(15);

-- FILM-719. A channel's posting cadence (channel_posting_cadences) and the
-- slot a scheduled post holds (publishes.slot_at).
--
-- The trap from revenue-records-rls.test.sql applies: foreign ids are
-- stashed with set_config while still postgres, because
-- makerkit.get_account_id_by_slug answers NULL for an account the caller
-- cannot see.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('cad_outsider', 'cad-outsider@storybook.dev');
select makerkit.authenticate_as('cad_outsider');
select public.create_team_account('Cadence Other Co');

set local role postgres;

select set_config('cad.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('cad.other', makerkit.get_account_id_by_slug('cadence-other-co')::text, true);

insert into public.platform_connections (id, account_id, platform, platform_account_name)
values
  ('7190cade-0000-4000-8000-000000000001',
   current_setting('cad.story')::uuid, 'youtube', 'Story Channel'),
  ('7190cade-0000-4000-8000-000000000002',
   current_setting('cad.other')::uuid, 'youtube', 'Outsider Channel');

-- ==================================
-- Who sets a channel's cadence
-- ==================================

select makerkit.authenticate_as('member');

select lives_ok(
  $$ insert into public.channel_posting_cadences
       (account_id, platform_connection_id, content_type, timezone, slot_times)
     values (current_setting('cad.story')::uuid,
             '7190cade-0000-4000-8000-000000000001', 'short',
             'Asia/Kolkata', '{10:00,18:00}') $$,
  'a member of the team sets its channel''s Shorts cadence'
);

select is(
  (select days_of_week from public.channel_posting_cadences
    where platform_connection_id = '7190cade-0000-4000-8000-000000000001'),
  '{0,1,2,3,4,5,6}'::smallint[],
  'a cadence posts every day unless told otherwise'
);

select throws_ok(
  $$ insert into public.channel_posting_cadences
       (account_id, platform_connection_id, content_type, slot_times)
     values (current_setting('cad.other')::uuid,
             '7190cade-0000-4000-8000-000000000002', 'short', '{18:00}') $$,
  '42501', null,
  'nor another team''s channel'
);

-- The account written is the one owning the channel, whoever writes it
set local role postgres;

select throws_ok(
  $$ insert into public.channel_posting_cadences
       (account_id, platform_connection_id, content_type, slot_times)
     values (current_setting('cad.story')::uuid,
             '7190cade-0000-4000-8000-000000000002', 'full', '{17:00}') $$,
  '23503', null,
  'a cadence cannot name one team and another team''s channel, even as postgres'
);

select makerkit.authenticate_as('cad_outsider');

select is_empty(
  $$ select 1 from public.channel_posting_cadences
      where platform_connection_id = '7190cade-0000-4000-8000-000000000001' $$,
  'another team does not see the cadence'
);

select is_empty(
  $$ update public.channel_posting_cadences set slot_times = '{03:00}'
      where platform_connection_id = '7190cade-0000-4000-8000-000000000001'
     returning 1 $$,
  'nor change it'
);

select is_empty(
  $$ delete from public.channel_posting_cadences
      where platform_connection_id = '7190cade-0000-4000-8000-000000000001'
     returning 1 $$,
  'nor reset it'
);

-- ==================================
-- What a cadence may say
-- ==================================

select makerkit.authenticate_as('member');

select throws_ok(
  $$ insert into public.channel_posting_cadences
       (account_id, platform_connection_id, content_type, slot_times)
     values (current_setting('cad.story')::uuid,
             '7190cade-0000-4000-8000-000000000001', 'full', '{25:00}') $$,
  '23514', null,
  'a slot is a time of day'
);

select throws_ok(
  $$ insert into public.channel_posting_cadences
       (account_id, platform_connection_id, content_type, slot_times, days_of_week)
     values (current_setting('cad.story')::uuid,
             '7190cade-0000-4000-8000-000000000001', 'full', '{17:00}', '{7}') $$,
  '23514', null,
  'a weekday is 0 to 6'
);

select throws_ok(
  $$ insert into public.channel_posting_cadences
       (account_id, platform_connection_id, content_type, slot_times)
     values (current_setting('cad.story')::uuid,
             '7190cade-0000-4000-8000-000000000001', 'full',
             '{01:00,02:00,03:00,04:00,05:00,06:00,07:00}') $$,
  '23514', null,
  'at most six slots a day'
);

select throws_ok(
  $$ insert into public.channel_posting_cadences
       (account_id, platform_connection_id, content_type, slot_times)
     values (current_setting('cad.story')::uuid,
             '7190cade-0000-4000-8000-000000000001', 'short', '{09:00}') $$,
  '23505', null,
  'one cadence per channel and content type'
);

select lives_ok(
  $$ delete from public.channel_posting_cadences
      where platform_connection_id = '7190cade-0000-4000-8000-000000000001' $$,
  'a member returns the channel to the defaults by deleting its row'
);

-- ==================================
-- One post per slot on a channel
-- ==================================

select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('7190cade-0000-4000-8000-0000000000a1',
          current_setting('cad.story')::uuid, 'Cadence fixture', 'active');

set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
  values ('7190cade-0000-4000-8000-0000000000e1',
          '7190cade-0000-4000-8000-0000000000a1', 1, 'E1', 'draft'),
         ('7190cade-0000-4000-8000-0000000000e2',
          '7190cade-0000-4000-8000-0000000000a1', 2, 'E2', 'draft');

insert into public.publishes
  (id, episode_id, platform_connection_id, platform, content_type, status,
   scheduled_at, slot_at, after_episode_full)
values ('7190cade-0000-4000-8000-0000000000b1',
        '7190cade-0000-4000-8000-0000000000e1',
        '7190cade-0000-4000-8000-000000000001', 'youtube', 'short', 'scheduled',
        '2026-11-03 12:41+00', '2026-11-03 12:30+00', true);

select throws_ok(
  $$ insert into public.publishes
       (episode_id, platform_connection_id, platform, content_type, status,
        scheduled_at, slot_at)
     values ('7190cade-0000-4000-8000-0000000000e2',
             '7190cade-0000-4000-8000-000000000001', 'youtube', 'short',
             'scheduled', '2026-11-03 12:22+00', '2026-11-03 12:30+00') $$,
  '23505', null,
  'a second release cannot take a slot another post holds'
);

update public.publishes set status = 'failed'
 where id = '7190cade-0000-4000-8000-0000000000b1';

select lives_ok(
  $$ insert into public.publishes
       (episode_id, platform_connection_id, platform, content_type, status,
        scheduled_at, slot_at)
     values ('7190cade-0000-4000-8000-0000000000e2',
             '7190cade-0000-4000-8000-000000000001', 'youtube', 'short',
             'scheduled', '2026-11-03 12:22+00', '2026-11-03 12:30+00') $$,
  'a failed post gives its slot back'
);

select is(
  (select after_episode_full from public.publishes
    where episode_id = '7190cade-0000-4000-8000-0000000000e2'),
  false,
  'a post waits for nothing unless it says so'
);

select * from finish();
rollback;
