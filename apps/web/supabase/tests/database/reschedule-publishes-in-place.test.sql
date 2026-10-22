begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(8);

-- FILM-2213. A scheduled post's time changes in place through
-- reschedule_publishes: a time chosen past the posting rules holds no slot
-- (slot_at null), and each move merges its metadata (the history entry,
-- manualTime, YouTube's new publishAt) into the post's, keeping the rest.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

set local role postgres;

select set_config('mv.story', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.platform_connections (id, account_id, platform, platform_account_name)
values ('22130000-0000-4000-8000-000000000001',
        current_setting('mv.story')::uuid, 'youtube', 'Move Channel');

select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('22130000-0000-4000-8000-0000000000a1',
          current_setting('mv.story')::uuid, 'Move fixture', 'active');

set local role postgres;

insert into public.project_members (project_id, user_id, role)
  values ('22130000-0000-4000-8000-0000000000a1', tests.get_supabase_uid('member'), 'member');

insert into public.episodes (id, project_id, number, title, status)
  values ('22130000-0000-4000-8000-0000000000e1',
          '22130000-0000-4000-8000-0000000000a1', 1, 'E1', 'draft');

insert into public.publishes
  (id, episode_id, platform_connection_id, platform, content_type, status,
   title, tags, scheduled_at, slot_at, metadata)
values
  ('22130000-0000-4000-8000-000000000101',
   '22130000-0000-4000-8000-0000000000e1',
   '22130000-0000-4000-8000-000000000001', 'youtube', 'full', 'scheduled',
   'The long video', array['story'],
   '2026-11-05 14:30+00', '2026-11-05 14:30+00',
   '{"shortsGroupId": null, "createdVia": "cadence"}'::jsonb),
  ('22130000-0000-4000-8000-000000000102',
   '22130000-0000-4000-8000-0000000000e1',
   '22130000-0000-4000-8000-000000000001', 'youtube', 'short', 'failed',
   'A Short', array['story'],
   '2026-11-01 05:30+00', '2026-11-01 05:30+00', '{}'::jsonb);

select makerkit.authenticate_as('member');

-- ==================================
-- A time past the rules: no slot
-- ==================================

select lives_ok(
  $$ select public.reschedule_publishes(jsonb_build_array(jsonb_build_object(
       'id', '22130000-0000-4000-8000-000000000101',
       'slot_at', null,
       'scheduled_at', '2026-11-07 14:30+00',
       'metadata', jsonb_build_object(
         'manualTime', true,
         'scheduleHistory', jsonb_build_array(jsonb_build_object(
           'from', '2026-11-05T14:30:00Z', 'to', '2026-11-07T14:30:00Z',
           'at', '2026-11-02T03:30:00Z', 'via', 'ui', 'note', 'experiment')))))) $$,
  'a member moves a post to a time that holds no slot'
);

select is(
  (select (slot_at is null, scheduled_at)::text from public.publishes
    where id = '22130000-0000-4000-8000-000000000101'),
  (select (true, timestamptz '2026-11-07 14:30+00')::text),
  'it goes at its new time, holding no cadence slot'
);

select is(
  (select metadata from public.publishes
    where id = '22130000-0000-4000-8000-000000000101'),
  '{"shortsGroupId": null, "createdVia": "cadence", "manualTime": true,
    "scheduleHistory": [{"from": "2026-11-05T14:30:00Z", "to": "2026-11-07T14:30:00Z",
                         "at": "2026-11-02T03:30:00Z", "via": "ui", "note": "experiment"}]}'::jsonb,
  'the move''s metadata is merged in, and the post''s own keys are kept'
);

select is(
  (select (title, tags)::text from public.publishes
    where id = '22130000-0000-4000-8000-000000000101'),
  (select ('The long video', array['story'])::text),
  'the post is the same row: title and tags as they were'
);

-- ==================================
-- A move without metadata leaves it
-- ==================================

select lives_ok(
  $$ select public.reschedule_publishes(jsonb_build_array(jsonb_build_object(
       'id', '22130000-0000-4000-8000-000000000101',
       'slot_at', '2026-11-08 14:30+00',
       'scheduled_at', '2026-11-08 14:35+00'))) $$,
  'a move with a slot and no metadata, as a breaking release makes'
);

select is(
  (select (metadata ? 'manualTime', slot_at)::text from public.publishes
    where id = '22130000-0000-4000-8000-000000000101'),
  (select (true, timestamptz '2026-11-08 14:30+00')::text),
  'keeps the metadata it had, and takes its slot'
);

-- ==================================
-- Refused
-- ==================================

select throws_ok(
  $$ select public.reschedule_publishes(jsonb_build_array(jsonb_build_object(
       'id', '22130000-0000-4000-8000-000000000101',
       'slot_at', null,
       'scheduled_at', '2026-11-09 14:30+00',
       'metadata', '"not an object"'::jsonb))) $$,
  '22023', null,
  'metadata that is not an object is refused'
);

select throws_ok(
  $$ select public.reschedule_publishes(jsonb_build_array(jsonb_build_object(
       'id', '22130000-0000-4000-8000-000000000102',
       'slot_at', null,
       'scheduled_at', '2026-11-09 14:30+00'))) $$,
  '55000', null,
  'a failed post does not move'
);

select * from finish();
rollback;
