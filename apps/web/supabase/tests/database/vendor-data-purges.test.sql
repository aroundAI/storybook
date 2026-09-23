begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-20 item 3 / KB-22 part B. What enqueues a purge of a connection's
-- vendor data, who can see and write the queue, and what the Postgres half
-- of a purge removes — tested with two connections side by side, so "and
-- nothing else" is a measured claim. The ClickHouse half is tested against
-- the real server in packages/clickhouse (verify:purge).
select plan(20);

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('outsider', 'outsider-kb22b@storybook.dev');
select makerkit.authenticate_as('outsider');
select public.create_team_account('KB22B Other Co');

set local role postgres;

select set_config('kb.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('kb.other', makerkit.get_account_id_by_slug('kb22b-other-co')::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('primary_owner'), 'role', 'authenticated')::text, true);

-- A: the YouTube channel purged. B: a second YouTube channel, the control.
-- T: a TikTok channel — disconnecting it purges nothing.
insert into public.platform_connections
  (id, account_id, platform, platform_account_id, platform_account_name,
   access_token_encrypted, refresh_token_encrypted, metadata)
values
  ('33333333-0000-4000-8000-00000000000a', current_setting('kb.story')::uuid, 'youtube',
   'UC-kb22b-A', 'Channel A', 'enc-a', 'enc-ra',
   '{"thumbnail_url": "https://yt.example/a.jpg", "scopes_granted_at": "2026-09-01T00:00:00Z"}'),
  ('33333333-0000-4000-8000-00000000000b', current_setting('kb.story')::uuid, 'youtube',
   'UC-kb22b-B', 'Channel B', 'enc-b', 'enc-rb',
   '{"thumbnail_url": "https://yt.example/b.jpg"}'),
  ('33333333-0000-4000-8000-00000000000e', current_setting('kb.story')::uuid, 'tiktok',
   'tt-kb22b', 'acme.tok', 'enc-t', 'enc-rt', '{}');

insert into public.projects (id, account_id, name, slug)
values ('33333333-0000-4000-8000-000000000001', current_setting('kb.story')::uuid, 'KB-22B probe', 'kb-22b-probe');
insert into public.episodes (id, project_id, number, title)
values ('33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001', 1, 'Episode');

insert into public.publishes
  (id, episode_id, platform_connection_id, platform, status, platform_content_id,
   published_at, duration_seconds, metadata)
values
  ('33333333-0000-4000-8000-0000000000a1', '33333333-0000-4000-8000-000000000002',
   '33333333-0000-4000-8000-00000000000a', 'youtube', 'published', 'vidA', now(), 300,
   '{"sync": {"last_data_date": "2026-09-20", "backfill_completed_at": "2026-09-02T00:00:00Z"}, "shortsGroupId": "g1"}'),
  ('33333333-0000-4000-8000-0000000000b1', '33333333-0000-4000-8000-000000000002',
   '33333333-0000-4000-8000-00000000000b', 'youtube', 'published', 'vidB', now(), 120,
   '{"sync": {"last_data_date": "2026-09-20"}}');

insert into public.revenue_records (publish_id, platform, record_date, revenue_cents, currency, source)
values
  ('33333333-0000-4000-8000-0000000000a1', 'youtube', '2026-09-01', 1234, 'USD', 'api'),
  ('33333333-0000-4000-8000-0000000000a1', 'youtube', '2026-09-02', 5000, 'USD', 'manual'),
  ('33333333-0000-4000-8000-0000000000b1', 'youtube', '2026-09-01', 777, 'USD', 'api');

insert into public.youtube_report_jobs (platform_connection_id, report_type_id, youtube_job_id)
values
  ('33333333-0000-4000-8000-00000000000a', 'channel_basic_a3', 'job-a'),
  ('33333333-0000-4000-8000-00000000000b', 'channel_basic_a3', 'job-b');

-- ==================================
-- What enqueues a purge
-- ==================================

select makerkit.authenticate_as('member');
select public.disconnect_platform_connection('33333333-0000-4000-8000-00000000000a');
select public.disconnect_platform_connection('33333333-0000-4000-8000-00000000000e');

set local role postgres;

select results_eq(
  $$ select connection_id, account_id, platform::text, reason::text
       from public.vendor_data_purges
      where connection_id in ('33333333-0000-4000-8000-00000000000a',
                              '33333333-0000-4000-8000-00000000000e') $$,
  $$ values ('33333333-0000-4000-8000-00000000000a'::uuid,
             current_setting('kb.story')::uuid, 'youtube', 'in_app_disconnect') $$,
  'Disconnecting a YouTube channel enqueues one purge; disconnecting TikTok enqueues none'
);

select results_eq(
  $$ select run_after - requested_at, due_by - requested_at
       from public.vendor_data_purges
      where connection_id = '33333333-0000-4000-8000-00000000000a' $$,
  $$ values (interval '1 hour', interval '7 days') $$,
  'It runs after an hour (in-flight syncs finish) and is due within YouTube''s 7 days'
);

-- Reconnect (the callbacks' upsert), then disconnect again: a second purge.
insert into public.platform_connections
  (account_id, platform, platform_account_id, platform_account_name,
   access_token_encrypted, refresh_token_encrypted, is_active)
values (current_setting('kb.story')::uuid, 'youtube', 'UC-kb22b-A', 'Channel A', 'enc-a2', 'enc-ra2', true)
on conflict (account_id, platform, platform_account_id) do update
  set access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted,
      is_active = excluded.is_active;

select is(
  (select count(*)::int from public.vendor_data_purges
    where connection_id = '33333333-0000-4000-8000-00000000000a'),
  1,
  'Reconnecting does not enqueue anything, nor cancel the pending purge (owner decision D2)'
);

select makerkit.authenticate_as('member');
select public.disconnect_platform_connection('33333333-0000-4000-8000-00000000000a');

set local role postgres;

select is(
  (select count(*)::int from public.vendor_data_purges
    where connection_id = '33333333-0000-4000-8000-00000000000a'),
  2,
  'A second disconnect enqueues a second purge'
);

-- ==================================
-- Who can see and write the queue
-- ==================================

select makerkit.authenticate_as('member');

select is(
  (select count(*)::int from public.vendor_data_purges
    where account_id = current_setting('kb.story')::uuid),
  2,
  'A member sees their own account''s purges'
);

select throws_ok(
  $$ insert into public.vendor_data_purges (connection_id, account_id, platform, reason, due_by)
     values ('33333333-0000-4000-8000-00000000000b', current_setting('kb.story')::uuid,
             'youtube', 'request', now()) $$,
  '42501',
  null,
  'A member cannot enqueue a purge'
);

select throws_ok(
  $$ update public.vendor_data_purges set completed_at = now() $$,
  '42501',
  null,
  'A member cannot mark a purge done'
);

select throws_ok(
  $$ select public.purge_connection_vendor_rows('33333333-0000-4000-8000-00000000000b') $$,
  '42501',
  null,
  'A member cannot run the purge itself'
);

select makerkit.authenticate_as('outsider');

select is_empty(
  $$ select * from public.vendor_data_purges
      where account_id = current_setting('kb.story')::uuid $$,
  'Someone outside the account sees none of its purges'
);

-- ==================================
-- The Postgres half: A's vendor rows, and nothing else
-- ==================================

set local role service_role;

select is(
  public.purge_connection_vendor_rows('33333333-0000-4000-8000-00000000000a'),
  '{"revenue_records_api": 1, "youtube_report_jobs": 1, "publishes_reset": 1}'::jsonb,
  'The purge reports what it removed'
);

set local role postgres;

select is(
  (select count(*)::int from public.revenue_records
    where publish_id = '33333333-0000-4000-8000-0000000000a1' and source = 'api'),
  0,
  'A''s synced revenue is gone'
);

select is(
  (select revenue_cents from public.revenue_records
    where publish_id = '33333333-0000-4000-8000-0000000000a1' and source = 'manual'),
  5000,
  'A''s revenue entry a person typed in is untouched'
);

select results_eq(
  $$ select metadata, duration_seconds from public.publishes
      where id = '33333333-0000-4000-8000-0000000000a1' $$,
  $$ values ('{"shortsGroupId": "g1"}'::jsonb, null::integer) $$,
  'A''s publish forgets what was collected, so a reconnect collects it again; its own fields stay'
);

select results_eq(
  $$ select platform_account_id::text, platform_account_name::text, metadata
       from public.platform_connections where id = '33333333-0000-4000-8000-00000000000a' $$,
  $$ values ('UC-kb22b-A', 'Channel A', '{"scopes_granted_at": "2026-09-01T00:00:00Z"}'::jsonb) $$,
  'A keeps its id and name (D3); the vendor''s picture is gone'
);

select is(
  (select count(*)::int from public.youtube_report_jobs
    where platform_connection_id = '33333333-0000-4000-8000-00000000000a'),
  0,
  'A''s report jobs are gone'
);

select is(
  (select count(*)::int from public.revenue_records
    where publish_id = '33333333-0000-4000-8000-0000000000b1' and source = 'api'),
  1,
  'B''s synced revenue is untouched'
);

select results_eq(
  $$ select p.metadata, p.duration_seconds, c.metadata
       from public.publishes p
       join public.platform_connections c on c.id = p.platform_connection_id
      where p.id = '33333333-0000-4000-8000-0000000000b1' $$,
  $$ values ('{"sync": {"last_data_date": "2026-09-20"}}'::jsonb, 120,
             '{"thumbnail_url": "https://yt.example/b.jpg"}'::jsonb) $$,
  'B''s publish and connection are untouched'
);

select is(
  (select count(*)::int from public.youtube_report_jobs
    where platform_connection_id = '33333333-0000-4000-8000-00000000000b'),
  1,
  'B''s report job is untouched'
);

-- ==================================
-- Deleting an account enqueues its purges, and still succeeds (KB-1)
-- ==================================

select set_config('request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('outsider'), 'role', 'authenticated')::text, true);

insert into public.platform_connections (id, account_id, platform, platform_account_id, platform_account_name)
values ('33333333-0000-4000-8000-0000000000c0', current_setting('kb.other')::uuid, 'instagram', 'ig-kb22b', 'other.ig');

select lives_ok(
  $$ do $d$ begin
       delete from public.accounts where id = current_setting('kb.other')::uuid;
       set constraints all immediate;
     end $d$ $$,
  'An account with a connection can still be deleted'
);

select results_eq(
  $$ select account_id, platform::text, reason::text, due_by - requested_at
       from public.vendor_data_purges
      where connection_id = '33333333-0000-4000-8000-0000000000c0' $$,
  $$ values (current_setting('kb.other')::uuid, 'instagram', 'connection_deleted', interval '7 days') $$,
  '… and its connection''s statistics are queued for deletion within 7 days, whatever the platform'
);

select * from finish();

rollback;
