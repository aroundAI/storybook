begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-22. Disconnecting a platform used to delete the connection row, and the
-- schema cascaded that into the channel's publishes and everything a person
-- had attached to them: manual revenue, tags, experiment membership, manual
-- tasks, YPP targets and publishing defaults. Disconnecting is now
-- `disconnect_platform_connection`, which wipes the credential and keeps the
-- row; and a connection with user data attached can no longer be deleted on
-- its own. Account deletion — which must still remove all of it — is covered
-- here too, because a foreign-key change is exactly what broke it in KB-1.
select plan(19);

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('outsider', 'outsider-kb22@storybook.dev');
select makerkit.authenticate_as('outsider');
select public.create_team_account('KB22 Other Co');

set local role postgres;

select set_config('kb.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('kb.other', makerkit.get_account_id_by_slug('kb22-other-co')::text, true);
-- The project trigger adds its creator as owner, from auth.uid().
select set_config('request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('primary_owner'), 'role', 'authenticated')::text, true);

-- A: the channel being disconnected. B: a control on the same account.
-- FB/IG: a Facebook Page and the Instagram account linked through it.
-- O: the outsider's own channel, for the account-deletion case.
insert into public.platform_connections
  (id, account_id, platform, platform_account_id, platform_account_name,
   access_token_encrypted, refresh_token_encrypted, token_expires_at, metadata)
values
  ('22222222-0000-4000-8000-00000000000a', current_setting('kb.story')::uuid, 'youtube',
   'UC-kb22-A', 'Channel A', 'enc-access-a', 'enc-refresh-a', now() + interval '1 hour', '{}'),
  ('22222222-0000-4000-8000-00000000000b', current_setting('kb.story')::uuid, 'youtube',
   'UC-kb22-B', 'Channel B', 'enc-access-b', 'enc-refresh-b', now() + interval '1 hour', '{}'),
  ('22222222-0000-4000-8000-0000000000f1', current_setting('kb.story')::uuid, 'facebook',
   'page-1', 'Acme Page', 'enc-access-fb', null, null, '{}'),
  ('22222222-0000-4000-8000-0000000000f2', current_setting('kb.story')::uuid, 'instagram',
   'ig-1', 'acme.ig', 'enc-access-ig', null, null, '{"linked_page_id": "page-1"}');

insert into public.projects (id, account_id, name, slug)
values ('22222222-0000-4000-8000-000000000001', current_setting('kb.story')::uuid, 'KB-22 probe', 'kb-22-probe');
insert into public.episodes (id, project_id, number, title)
values ('22222222-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001', 1, 'Episode');

insert into public.publishes
  (id, episode_id, platform_connection_id, platform, status, platform_content_id, published_at, scheduled_at)
values
  ('22222222-0000-4000-8000-0000000000a1', '22222222-0000-4000-8000-000000000002',
   '22222222-0000-4000-8000-00000000000a', 'youtube', 'published', 'vidA1', now(), null),
  ('22222222-0000-4000-8000-0000000000a2', '22222222-0000-4000-8000-000000000002',
   '22222222-0000-4000-8000-00000000000a', 'youtube', 'scheduled', null, null, now() + interval '2 days'),
  ('22222222-0000-4000-8000-0000000000b1', '22222222-0000-4000-8000-000000000002',
   '22222222-0000-4000-8000-00000000000b', 'youtube', 'published', 'vidB1', now(), null);

insert into public.revenue_records (publish_id, platform, record_date, revenue_cents, currency, source)
values
  ('22222222-0000-4000-8000-0000000000a1', 'youtube', '2026-09-01', 1234, 'USD', 'api'),
  ('22222222-0000-4000-8000-0000000000a1', 'youtube', '2026-09-02', 5000, 'USD', 'manual'),
  ('22222222-0000-4000-8000-0000000000b1', 'youtube', '2026-09-01', 777, 'USD', 'manual');

insert into public.content_tags (id, account_id, dimension, slug, label)
values ('22222222-0000-4000-8000-0000000000c1', current_setting('kb.story')::uuid, 'topic', 'kb22', 'KB-22');
insert into public.publish_tags (publish_id, tag_id)
values ('22222222-0000-4000-8000-0000000000a1', '22222222-0000-4000-8000-0000000000c1');

insert into public.analytics_experiments (id, account_id, connection_id, title, change_description)
values ('22222222-0000-4000-8000-0000000000e1', current_setting('kb.story')::uuid,
        '22222222-0000-4000-8000-00000000000a', 'Thumbnail style', 'x');
insert into public.experiment_publishes (experiment_id, publish_id)
values ('22222222-0000-4000-8000-0000000000e1', '22222222-0000-4000-8000-0000000000a1');

insert into public.manual_tasks (account_id, publish_id, task_type, title)
values (current_setting('kb.story')::uuid, '22222222-0000-4000-8000-0000000000a1', 'end_screen', 'Add end screen');

insert into public.channel_analytics_settings (connection_id, account_id, ypp_target_watch_hours)
values ('22222222-0000-4000-8000-00000000000a', current_setting('kb.story')::uuid, 4000);

insert into public.youtube_report_jobs (platform_connection_id, report_type_id, youtube_job_id)
values ('22222222-0000-4000-8000-00000000000a', 'channel_basic_a3', 'job-1');

insert into public.project_publishing_configs (project_id, platform_connection_id)
values ('22222222-0000-4000-8000-000000000001', '22222222-0000-4000-8000-00000000000a');
insert into public.episode_publishing_configs (episode_id, platform_connection_id)
values ('22222222-0000-4000-8000-000000000002', '22222222-0000-4000-8000-00000000000a');

-- Everything A's history is made of, one row per kind. Read as postgres so
-- RLS cannot make a missing row look like a hidden one.
create function pg_temp.a_history() returns table (what text, n int) language sql as $$
  select 'publishes', count(*)::int from public.publishes
    where platform_connection_id = '22222222-0000-4000-8000-00000000000a'
  union all select 'revenue manual', count(*)::int from public.revenue_records
    where publish_id = '22222222-0000-4000-8000-0000000000a1' and source = 'manual'
  union all select 'revenue api', count(*)::int from public.revenue_records
    where publish_id = '22222222-0000-4000-8000-0000000000a1' and source = 'api'
  union all select 'publish_tags', count(*)::int from public.publish_tags
    where publish_id = '22222222-0000-4000-8000-0000000000a1'
  union all select 'experiment_publishes', count(*)::int from public.experiment_publishes
    where publish_id = '22222222-0000-4000-8000-0000000000a1'
  union all select 'experiment still scoped to A', count(*)::int from public.analytics_experiments
    where id = '22222222-0000-4000-8000-0000000000e1'
      and connection_id = '22222222-0000-4000-8000-00000000000a'
  union all select 'manual_tasks', count(*)::int from public.manual_tasks
    where publish_id = '22222222-0000-4000-8000-0000000000a1'
  union all select 'channel_analytics_settings', count(*)::int from public.channel_analytics_settings
    where connection_id = '22222222-0000-4000-8000-00000000000a'
  union all select 'project_publishing_configs', count(*)::int from public.project_publishing_configs
    where platform_connection_id = '22222222-0000-4000-8000-00000000000a'
  union all select 'episode_publishing_configs', count(*)::int from public.episode_publishing_configs
    where platform_connection_id = '22222222-0000-4000-8000-00000000000a'
  union all select 'youtube_report_jobs', count(*)::int from public.youtube_report_jobs
    where platform_connection_id = '22222222-0000-4000-8000-00000000000a'
$$;

grant execute on function pg_temp.a_history() to authenticated;

create temp table a_before as select * from pg_temp.a_history();

-- ==================================
-- Disconnect, as a member of the account
-- ==================================

select makerkit.authenticate_as('member');

select results_eq(
  $$ select id, already_disconnected
       from public.disconnect_platform_connection('22222222-0000-4000-8000-00000000000a') $$,
  $$ values ('22222222-0000-4000-8000-00000000000a'::uuid, false) $$,
  'A member disconnects the channel, and only that channel'
);

set local role postgres;

select results_eq(
  $$ select what, n from pg_temp.a_history() order by what $$,
  $$ select what, n from a_before order by what $$,
  'Every row of the channel''s history survives the disconnect — publishes, manual revenue, tags, experiments, tasks, targets, publishing defaults'
);

select is(
  (select n from pg_temp.a_history() where what = 'revenue manual'),
  1,
  'The revenue entry a person typed in is still there'
);

select results_eq(
  $$ select access_token_encrypted, refresh_token_encrypted, token_expires_at, is_active,
            disconnected_at is not null
       from public.platform_connections where id = '22222222-0000-4000-8000-00000000000a' $$,
  $$ values (null::text, null::text, null::timestamptz, false, true) $$,
  'The disconnected row holds no credential, is inactive and says when it was disconnected'
);

select results_eq(
  $$ select access_token_encrypted, is_active, disconnected_at
       from public.platform_connections where id = '22222222-0000-4000-8000-00000000000b' $$,
  $$ values ('enc-access-b'::text, true, null::timestamptz) $$,
  'The other channel on the account is untouched'
);

-- ==================================
-- Idempotent, and scoped by RLS
-- ==================================

select makerkit.authenticate_as('member');

select results_eq(
  $$ select id, already_disconnected
       from public.disconnect_platform_connection('22222222-0000-4000-8000-00000000000a') $$,
  $$ values ('22222222-0000-4000-8000-00000000000a'::uuid, true) $$,
  'Disconnecting again changes nothing and says it was already disconnected'
);

select makerkit.authenticate_as('outsider');

select is_empty(
  $$ select * from public.disconnect_platform_connection('22222222-0000-4000-8000-00000000000b') $$,
  'Someone outside the account cannot disconnect its channel'
);

set local role postgres;

select is(
  (select is_active from public.platform_connections where id = '22222222-0000-4000-8000-00000000000b'),
  true,
  '… and the channel is still connected'
);

-- ==================================
-- Meta: the linked Page goes with the Instagram account
-- ==================================

select makerkit.authenticate_as('member');

select results_eq(
  $$ select id, already_disconnected
       from public.disconnect_platform_connection('22222222-0000-4000-8000-0000000000f2')
      order by id $$,
  $$ values ('22222222-0000-4000-8000-0000000000f1'::uuid, false),
            ('22222222-0000-4000-8000-0000000000f2'::uuid, false) $$,
  'Disconnecting an Instagram account disconnects the Facebook Page it is reached through'
);

set local role postgres;

select is(
  (select count(*)::int from public.platform_connections
    where id in ('22222222-0000-4000-8000-0000000000f1', '22222222-0000-4000-8000-0000000000f2')),
  2,
  '… and keeps both rows'
);

-- ==================================
-- A disconnected row cannot hold a token; writing one reconnects it
-- ==================================

select throws_ok(
  $$ update public.platform_connections set disconnected_at = now()
      where id = '22222222-0000-4000-8000-00000000000b' $$,
  '23514',
  null,
  'A row with a live token cannot be marked disconnected'
);

-- The upsert every OAuth callback performs (callback/youtube/route.ts).
insert into public.platform_connections
  (account_id, platform, platform_account_id, platform_account_name,
   access_token_encrypted, refresh_token_encrypted, token_expires_at, is_active)
values
  (current_setting('kb.story')::uuid, 'youtube', 'UC-kb22-A', 'Channel A',
   'enc-access-a2', 'enc-refresh-a2', now() + interval '1 hour', true)
on conflict (account_id, platform, platform_account_id) do update
  set access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted,
      token_expires_at = excluded.token_expires_at,
      is_active = excluded.is_active;

select results_eq(
  $$ select id, is_active, disconnected_at from public.platform_connections
      where account_id = current_setting('kb.story')::uuid and platform = 'youtube'
        and platform_account_id = 'UC-kb22-A' $$,
  $$ values ('22222222-0000-4000-8000-00000000000a'::uuid, true, null::timestamptz) $$,
  'Reconnecting the same channel re-attaches the same row, no longer disconnected'
);

select results_eq(
  $$ select what, n from pg_temp.a_history() order by what $$,
  $$ select what, n from a_before order by what $$,
  '… with all of its history still attached'
);

-- ==================================
-- A connection with user data cannot be deleted on its own
-- ==================================

select makerkit.authenticate_as('member');

select lives_ok(
  $$ delete from public.platform_connections where id = '22222222-0000-4000-8000-00000000000b' $$,
  'A member''s direct delete does not error …'
);

set local role postgres;

select is(
  (select count(*)::int from public.platform_connections where id = '22222222-0000-4000-8000-00000000000b'),
  1,
  '… and deletes nothing: there is no delete policy'
);

select throws_ok(
  $$ delete from public.platform_connections where id = '22222222-0000-4000-8000-00000000000b' $$,
  '23001',
  null,
  'Even with no RLS in the way, a connection with publishes cannot be deleted on its own'
);

insert into public.platform_connections (id, account_id, platform, platform_account_id, platform_account_name)
values ('22222222-0000-4000-8000-00000000000d', current_setting('kb.story')::uuid, 'youtube', 'UC-kb22-D', 'Channel D');
insert into public.channel_analytics_settings (connection_id, account_id, ypp_target_subscribers)
values ('22222222-0000-4000-8000-00000000000d', current_setting('kb.story')::uuid, 1000);

select throws_ok(
  $$ delete from public.platform_connections where id = '22222222-0000-4000-8000-00000000000d' $$,
  '23001',
  null,
  'Nor can one whose only dependant is a YPP target someone set'
);

-- ==================================
-- Deleting the account still deletes all of it (KB-1)
-- ==================================

select set_config('request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('outsider'), 'role', 'authenticated')::text, true);

insert into public.platform_connections (id, account_id, platform, platform_account_id, platform_account_name)
values ('22222222-0000-4000-8000-0000000000c0', current_setting('kb.other')::uuid, 'youtube', 'UC-kb22-O', 'Other channel');
insert into public.projects (id, account_id, name, slug)
values ('22222222-0000-4000-8000-0000000000c1', current_setting('kb.other')::uuid, 'Other probe', 'kb-22-other-probe');
insert into public.episodes (id, project_id, number, title)
values ('22222222-0000-4000-8000-0000000000c2', '22222222-0000-4000-8000-0000000000c1', 1, 'Episode');
insert into public.publishes (id, episode_id, platform_connection_id, platform, status, published_at)
values ('22222222-0000-4000-8000-0000000000c3', '22222222-0000-4000-8000-0000000000c2',
        '22222222-0000-4000-8000-0000000000c0', 'youtube', 'published', now());
insert into public.revenue_records (publish_id, platform, record_date, revenue_cents, currency, source)
values ('22222222-0000-4000-8000-0000000000c3', 'youtube', '2026-09-01', 100, 'USD', 'manual');
insert into public.channel_analytics_settings (connection_id, account_id, ypp_target_watch_hours)
values ('22222222-0000-4000-8000-0000000000c0', current_setting('kb.other')::uuid, 4000);
insert into public.project_publishing_configs (project_id, platform_connection_id)
values ('22222222-0000-4000-8000-0000000000c1', '22222222-0000-4000-8000-0000000000c0');

-- `set constraints all immediate` inside the case, so a key checked at commit
-- is checked here too: a lives_ok that passes on a schema refusing the
-- deletion at commit proves nothing.
select lives_ok(
  $$ do $d$ begin
       delete from public.accounts where id = current_setting('kb.other')::uuid;
       set constraints all immediate;
     end $d$ $$,
  'An account with a connected channel, its publishes and settings can still be deleted'
);

select is(
  (select count(*)::int from public.platform_connections where account_id = current_setting('kb.other')::uuid)
  + (select count(*)::int from public.publishes where id = '22222222-0000-4000-8000-0000000000c3')
  + (select count(*)::int from public.channel_analytics_settings where connection_id = '22222222-0000-4000-8000-0000000000c0'),
  0,
  '… and nothing of it is left'
);

select * from finish();

rollback;
