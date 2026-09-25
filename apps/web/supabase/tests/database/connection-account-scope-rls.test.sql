begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(19);

-- A row may name only its own account's channel (the connection class of
-- KB-98). Reproduced through RLS on 2026-09-25: publishes, both publishing
-- config tables, short_publications and social_posts all accepted another
-- account's platform_connection_id — the publish cron, unpublish and the
-- analytics sync act on a publish's channel, and posting a social post
-- decrypts its channel's token. `member` belongs to both accounts, so RLS
-- lets them see both channels and only the rule can refuse the foreign one.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('cs_other_owner', 'cs-other-owner@storybook.dev');
select makerkit.authenticate_as('cs_other_owner');
select public.create_team_account('CS Other Co');

select makerkit.authenticate_as('primary_owner');
set local role postgres;

select set_config('cs.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('cs.other', makerkit.get_account_id_by_slug('cs-other-co')::text, true);

insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('member'), current_setting('cs.other')::uuid, 'member');

insert into public.platform_connections (id, account_id, platform, platform_account_id, platform_account_name)
  values ('c5c5c5c5-0000-4000-8000-00000000000a', current_setting('cs.story')::uuid, 'youtube', 'UC-cs-own', 'Own channel'),
         ('c5c5c5c5-0000-4000-8000-00000000000b', current_setting('cs.other')::uuid, 'youtube', 'UC-cs-other', 'Other channel');

insert into public.projects (id, account_id, name, slug)
  values ('c5c5c5c5-0000-4000-8000-000000000011', current_setting('cs.story')::uuid, 'Channel scope', 'channel-scope');
insert into public.project_members (project_id, user_id, role)
  values ('c5c5c5c5-0000-4000-8000-000000000011', tests.get_supabase_uid('member'), 'member');
insert into public.episodes (id, project_id, number, title)
  values ('c5c5c5c5-0000-4000-8000-000000000012', 'c5c5c5c5-0000-4000-8000-000000000011', 1, 'Episode');
insert into public.shorts (id, episode_id, start_seconds, end_seconds)
  values ('c5c5c5c5-0000-4000-8000-000000000013', 'c5c5c5c5-0000-4000-8000-000000000012', 0, 30);
insert into public.publishes (id, episode_id, platform, status, platform_connection_id)
  values ('c5c5c5c5-0000-4000-8000-000000000014', 'c5c5c5c5-0000-4000-8000-000000000012', 'youtube', 'draft',
          'c5c5c5c5-0000-4000-8000-00000000000a');
insert into public.episode_publishing_configs (id, episode_id, platform_connection_id)
  values ('c5c5c5c5-0000-4000-8000-000000000015', 'c5c5c5c5-0000-4000-8000-000000000012',
          'c5c5c5c5-0000-4000-8000-00000000000a');

select makerkit.authenticate_as('member');

select results_eq(
  $$ select count(*)::int from public.platform_connections
      where id in ('c5c5c5c5-0000-4000-8000-00000000000a', 'c5c5c5c5-0000-4000-8000-00000000000b') $$,
  array[2],
  'The member can see both channels, so only the rule can refuse the foreign one'
);

-- publishes
select lives_ok(
  $$ insert into public.publishes (episode_id, platform, status, platform_connection_id)
     values ('c5c5c5c5-0000-4000-8000-000000000012', 'youtube', 'draft', 'c5c5c5c5-0000-4000-8000-00000000000a') $$,
  'A publish to the account''s own channel is allowed'
);

select throws_ok(
  $$ insert into public.publishes (episode_id, platform, status, platform_connection_id)
     values ('c5c5c5c5-0000-4000-8000-000000000012', 'youtube', 'draft', 'c5c5c5c5-0000-4000-8000-00000000000b') $$,
  '42501',
  null,
  'A publish to another account''s channel is refused, even for someone in both'
);

select lives_ok(
  $$ insert into public.publishes (episode_id, platform, status)
     values ('c5c5c5c5-0000-4000-8000-000000000012', 'youtube', 'draft') $$,
  'A publish with no channel (an upload) is allowed'
);

select throws_ok(
  $$ update public.publishes
        set platform_connection_id = 'c5c5c5c5-0000-4000-8000-00000000000b',
            status = 'scheduled'
      where id = 'c5c5c5c5-0000-4000-8000-000000000014' $$,
  '42501',
  null,
  'A publish cannot be repointed at another account''s channel'
);

select lives_ok(
  $$ update public.publishes set status = 'scheduled'
      where id = 'c5c5c5c5-0000-4000-8000-000000000014' $$,
  'A publish on the own channel can still be updated'
);

-- episode_publishing_configs
select throws_ok(
  $$ insert into public.episode_publishing_configs (episode_id, platform_connection_id, language)
     values ('c5c5c5c5-0000-4000-8000-000000000012', 'c5c5c5c5-0000-4000-8000-00000000000b', 'es') $$,
  '42501',
  null,
  'An episode config cannot name another account''s channel'
);

select throws_ok(
  $$ update public.episode_publishing_configs
        set platform_connection_id = 'c5c5c5c5-0000-4000-8000-00000000000b'
      where id = 'c5c5c5c5-0000-4000-8000-000000000015' $$,
  '42501',
  null,
  'An episode config cannot be repointed at another account''s channel'
);

select lives_ok(
  $$ update public.episode_publishing_configs set language = 'hi'
      where id = 'c5c5c5c5-0000-4000-8000-000000000015' $$,
  'An episode config on the own channel can still be updated'
);

-- project_publishing_configs
select throws_ok(
  $$ insert into public.project_publishing_configs (project_id, platform_connection_id)
     values ('c5c5c5c5-0000-4000-8000-000000000011', 'c5c5c5c5-0000-4000-8000-00000000000b') $$,
  '42501',
  null,
  'A project config cannot name another account''s channel'
);

select lives_ok(
  $$ insert into public.project_publishing_configs (project_id, platform_connection_id)
     values ('c5c5c5c5-0000-4000-8000-000000000011', 'c5c5c5c5-0000-4000-8000-00000000000a') $$,
  'A project config on the own channel is allowed'
);

select throws_ok(
  $$ update public.project_publishing_configs
        set platform_connection_id = 'c5c5c5c5-0000-4000-8000-00000000000b'
      where project_id = 'c5c5c5c5-0000-4000-8000-000000000011'
        and platform_connection_id = 'c5c5c5c5-0000-4000-8000-00000000000a' $$,
  '42501',
  null,
  'A project config cannot be repointed at another account''s channel'
);

-- short_publications (the own case uses its own language: on main the
-- foreign insert succeeds and would otherwise hold the unique key)
select throws_ok(
  $$ insert into public.short_publications (short_id, platform, platform_connection_id)
     values ('c5c5c5c5-0000-4000-8000-000000000013', 'youtube', 'c5c5c5c5-0000-4000-8000-00000000000b') $$,
  '42501',
  null,
  'A short publication cannot name another account''s channel'
);

select lives_ok(
  $$ insert into public.short_publications (short_id, platform, language, platform_connection_id)
     values ('c5c5c5c5-0000-4000-8000-000000000013', 'youtube', 'es', 'c5c5c5c5-0000-4000-8000-00000000000a') $$,
  'A short publication on the own channel is allowed'
);

select throws_ok(
  $$ update public.short_publications
        set platform_connection_id = 'c5c5c5c5-0000-4000-8000-00000000000b'
      where short_id = 'c5c5c5c5-0000-4000-8000-000000000013' and language = 'es' $$,
  '42501',
  null,
  'A short publication cannot be repointed at another account''s channel'
);

-- social_posts: a composite foreign key, so the refusal is 23503 for every role
select throws_ok(
  $$ insert into public.social_posts (account_id, raw_notes, platform_connection_id)
     values (current_setting('cs.story')::uuid, 'x', 'c5c5c5c5-0000-4000-8000-00000000000b') $$,
  '23503',
  null,
  'A social post cannot name another account''s channel'
);

select lives_ok(
  $$ insert into public.social_posts (account_id, raw_notes, platform_connection_id)
     values (current_setting('cs.story')::uuid, 'x', 'c5c5c5c5-0000-4000-8000-00000000000a') $$,
  'A social post on the own channel is allowed'
);

select throws_ok(
  $$ update public.platform_connections
        set account_id = current_setting('cs.other')::uuid
      where id = 'c5c5c5c5-0000-4000-8000-00000000000a' $$,
  '42501',
  null,
  'A channel cannot be moved to another account, tokens and all'
);

-- An outsider to the other account, who cannot even see its channel.
select makerkit.authenticate_as('primary_owner');

select throws_ok(
  $$ insert into public.publishes (episode_id, platform, status, platform_connection_id)
     values ('c5c5c5c5-0000-4000-8000-000000000012', 'youtube', 'draft', 'c5c5c5c5-0000-4000-8000-00000000000b') $$,
  '42501',
  null,
  'A channel the caller cannot see is refused too'
);

select * from finish();

rollback;
