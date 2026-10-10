begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- A project's channels are project_publishing_configs rows: one per channel,
-- whatever the channel's language. Its language column is no longer read,
-- so it no longer refuses a language outside en/hi/es/pt.
select plan(3);

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');

set local role postgres;

select set_config('pc.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('primary_owner'), 'role', 'authenticated')::text, true);

insert into public.platform_connections
  (id, account_id, platform, platform_account_id, platform_account_name, language)
values
  ('2c000000-0000-4000-8000-00000000000a', current_setting('pc.story')::uuid, 'youtube',
   'UC-pc-en', 'EN channel', 'en'),
  ('2c000000-0000-4000-8000-00000000000b', current_setting('pc.story')::uuid, 'youtube',
   'UC-pc-bn', 'BN channel', 'bn');

insert into public.projects (id, account_id, name, slug)
values ('2c000000-0000-4000-8000-000000000001', current_setting('pc.story')::uuid,
        'Project channels', 'project-channels-probe');

select makerkit.authenticate_as('primary_owner');

select lives_ok(
  $$ insert into public.project_publishing_configs (project_id, platform_connection_id)
     values ('2c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-00000000000a') $$,
  'an owner adds a channel to the project'
);

select lives_ok(
  $$ insert into public.project_publishing_configs (project_id, platform_connection_id, language)
     values ('2c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-00000000000b', 'bn') $$,
  'a Bengali channel can be one of the project''s channels'
);

select throws_ok(
  $$ insert into public.project_publishing_configs (project_id, platform_connection_id, language)
     values ('2c000000-0000-4000-8000-000000000001', '2c000000-0000-4000-8000-00000000000a', 'hi') $$,
  '23505',
  null,
  'a channel is one of a project''s channels once, not once per language'
);

select * from finish();
rollback;
