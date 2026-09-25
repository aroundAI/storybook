begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(14);

-- KB-49, KB-47 (publishing). What the service-role workers ask before they
-- act, and the status an unpublish marks.
--
-- W1–W6  `can_user_write_project(user, project)` answers KB-28's rule for a
--        named user, and `can_write_project` still answers it for the
--        session's user, for every project role.
-- W7–W9  only `service_role` may call it: granted to `authenticated`, it
--        would tell any signed-in user who can write which project.
-- W10–W14 'deleting' is a status a writer can set and a viewer cannot; before
--        this it was refused for everyone, and the unpublish actions sent
--        their delete jobs regardless.

select tests.create_supabase_user('wa_owner', 'wa-owner@storybook.dev');
select tests.create_supabase_user('wa_admin', 'wa-admin@storybook.dev');
select tests.create_supabase_user('wa_member', 'wa-member@storybook.dev');
select tests.create_supabase_user('wa_viewer', 'wa-viewer@storybook.dev');
select tests.create_supabase_user('wa_off', 'wa-off@storybook.dev');
select tests.create_supabase_user('wa_stranger', 'wa-stranger@storybook.dev');

select makerkit.authenticate_as('wa_owner');
select public.create_team_account('WA Team');
select set_config('wa.team', makerkit.get_account_id_by_slug('wa-team')::text, true);

insert into public.projects (id, account_id, name, slug, status)
  values ('a9a90000-0000-4000-8000-000000000001', current_setting('wa.team')::uuid, 'WA', 'wa-project', 'active');

set local role postgres;

insert into public.accounts_memberships (user_id, account_id, account_role)
  select tests.get_supabase_uid(u), current_setting('wa.team')::uuid, 'member'
    from unnest(array['wa_admin', 'wa_member', 'wa_viewer', 'wa_off']) as u;

insert into public.project_members (project_id, user_id, role) values
  ('a9a90000-0000-4000-8000-000000000001', tests.get_supabase_uid('wa_admin'), 'admin'),
  ('a9a90000-0000-4000-8000-000000000001', tests.get_supabase_uid('wa_member'), 'member'),
  ('a9a90000-0000-4000-8000-000000000001', tests.get_supabase_uid('wa_viewer'), 'viewer');

insert into public.episodes (id, project_id, number, title, status)
  values ('a9a90000-0000-4000-8000-000000000002', 'a9a90000-0000-4000-8000-000000000001', 1, 'E1', 'draft');

insert into public.platform_connections (id, account_id, platform, platform_account_id, platform_account_name)
  values ('a9a90000-0000-4000-8000-00000000000c', current_setting('wa.team')::uuid, 'youtube', 'UCwa', 'WA channel');

insert into public.publishes (id, episode_id, platform_connection_id, platform, content_type, status, platform_content_id, language)
  values ('a9a90000-0000-4000-8000-000000000003', 'a9a90000-0000-4000-8000-000000000002',
          'a9a90000-0000-4000-8000-00000000000c', 'youtube', 'full', 'published', 'VIDEO123', 'en');

-- W1–W6: the named-user rule, and the session rule, agree for every role
select results_eq(
  $$ select u, public.can_user_write_project(tests.get_supabase_uid(u), 'a9a90000-0000-4000-8000-000000000001')
       from unnest(array['wa_owner', 'wa_admin', 'wa_member', 'wa_viewer', 'wa_off', 'wa_stranger']) as u
      order by u $$,
  $$ values ('wa_admin', true), ('wa_member', true), ('wa_off', false),
            ('wa_owner', true), ('wa_stranger', false), ('wa_viewer', false) $$,
  'W1 can_user_write_project: owner, admin and member write; viewer, off-project and stranger do not'
);

select makerkit.authenticate_as('wa_owner');
select ok(public.can_write_project('a9a90000-0000-4000-8000-000000000001'), 'W2 can_write_project: the owner, as themselves');
select makerkit.authenticate_as('wa_member');
select ok(public.can_write_project('a9a90000-0000-4000-8000-000000000001'), 'W3 can_write_project: a member');
select makerkit.authenticate_as('wa_viewer');
select ok(not public.can_write_project('a9a90000-0000-4000-8000-000000000001'), 'W4 can_write_project: not a viewer');
select makerkit.authenticate_as('wa_off');
select ok(not public.can_write_project('a9a90000-0000-4000-8000-000000000001'), 'W5 can_write_project: not an account member off the project');
select makerkit.authenticate_as('wa_stranger');
select ok(not public.can_write_project('a9a90000-0000-4000-8000-000000000001'), 'W6 can_write_project: not a stranger');

-- W7–W9: who may ask about someone else
set local role postgres;
select ok(not has_function_privilege('authenticated', 'public.can_user_write_project(uuid, uuid)', 'EXECUTE'),
  'W7 authenticated cannot call can_user_write_project');
select ok(not has_function_privilege('anon', 'public.can_user_write_project(uuid, uuid)', 'EXECUTE'),
  'W8 anon cannot call can_user_write_project');
select ok(has_function_privilege('service_role', 'public.can_user_write_project(uuid, uuid)', 'EXECUTE'),
  'W9 service_role can call can_user_write_project');

-- W10–W14: marking a publish for deletion
select makerkit.authenticate_as('wa_viewer');
select results_eq(
  $$ select count(*)::int from public.publishes where id = 'a9a90000-0000-4000-8000-000000000003' $$,
  array[1],
  'W10 a viewer can read the publish, so the refusal below is not vacuous'
);
select results_eq(
  $$ with u as (update public.publishes set status = 'deleting'
                 where id = 'a9a90000-0000-4000-8000-000000000003' returning 1)
     select count(*)::int from u $$,
  array[0],
  'W11 a viewer cannot mark it deleting'
);

select makerkit.authenticate_as('wa_admin');
select results_eq(
  $$ with u as (update public.publishes set status = 'deleting'
                 where id = 'a9a90000-0000-4000-8000-000000000003' returning status::text)
     select * from u $$,
  array['deleting'],
  'W12 an admin marks it deleting, and the update returns the row'
);

set local role postgres;
select throws_ok(
  $$ update public.publishes set status = 'removing' where id = 'a9a90000-0000-4000-8000-000000000003' $$,
  '23514',
  null,
  'W13 the status check still refuses a status nobody defined'
);
select is(
  (select status::text from public.publishes where id = 'a9a90000-0000-4000-8000-000000000003'),
  'deleting',
  'W14 the row is in deleting, where the publish worker looks for it'
);

select * from finish();
rollback;
