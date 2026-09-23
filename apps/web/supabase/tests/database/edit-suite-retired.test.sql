begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- FILM-607. The Edit Suite is retired. Its five database functions must not
-- be callable from the API. The first of them was KB-40: a SECURITY DEFINER
-- function, granted to authenticated, that let any signed-in user delete and
-- replace any episode's edit project by naming the owner's id.
--
-- A fixed plan, so a run that aborts early fails as a plan mismatch.
select plan(16);

-- ==================================
-- P1–P3: nobody but service_role may execute any overload
-- ==================================

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('batch_assemble_edit_project', 'batch_save_edit_project',
                        'create_edit_project_with_tracks', 'split_edit_clip',
                        'get_project_id_for_edit_project')),
  5,
  'Precondition: the five Edit Suite functions exist (one overload each)'
);

select ok(
  not has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  'P1: authenticated cannot execute ' || p.proname
)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('batch_assemble_edit_project', 'batch_save_edit_project',
                    'create_edit_project_with_tracks', 'split_edit_clip',
                    'get_project_id_for_edit_project')
order by p.proname;

select ok(
  not has_function_privilege('anon', p.oid, 'EXECUTE'),
  'P2: anon cannot execute ' || p.proname
)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('batch_assemble_edit_project', 'batch_save_edit_project',
                    'create_edit_project_with_tracks', 'split_edit_clip',
                    'get_project_id_for_edit_project')
order by p.proname;

select ok(
  has_function_privilege('service_role', p.oid, 'EXECUTE'),
  'P3: service_role keeps EXECUTE on batch_assemble_edit_project until part B drops it'
)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'batch_assemble_edit_project';

-- ==================================
-- P4: the KB-40 attack, as a second real user
-- ==================================
-- The owner's team has a public project with an episode whose edit project
-- has two tracks. A stranger with only a personal account names the owner's
-- id, which is what the old function trusted.

select tests.create_supabase_user('f607_owner', 'f607-owner@storybook.dev');
select tests.create_supabase_user('f607_stranger', 'f607-stranger@storybook.dev');

select makerkit.authenticate_as('f607_owner');
set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values ('60700000-0000-4000-8000-00000000000a', 'FILM-607 team', false, tests.get_supabase_uid('f607_owner'));

insert into public.projects (id, account_id, name, status, visibility)
values ('60700000-0000-4000-8000-000000000001', '60700000-0000-4000-8000-00000000000a', 'FILM-607 P', 'active', 'public');

insert into public.episodes (id, project_id, number, title)
values ('60700000-0000-4000-8000-000000000002', '60700000-0000-4000-8000-000000000001', 1, 'E');

insert into public.edit_projects (id, episode_id)
values ('60700000-0000-4000-8000-0000000000e1', '60700000-0000-4000-8000-000000000002');

insert into public.edit_tracks (edit_project_id, type, name, sort_order)
values
  ('60700000-0000-4000-8000-0000000000e1', 'video', 'Victim video', 0),
  ('60700000-0000-4000-8000-0000000000e1', 'dialogue', 'Victim dialogue', 1);

select set_config('f607.owner', tests.get_supabase_uid('f607_owner')::text, true);

select makerkit.authenticate_as('f607_stranger');

select isnt_empty(
  $$ select id from public.projects where id = '60700000-0000-4000-8000-000000000001' $$,
  'Precondition: the stranger can read the public project, and so its ids'
);

select throws_ok(
  format(
    $q$ select public.batch_assemble_edit_project(
          '60700000-0000-4000-8000-000000000002'::uuid, %L::uuid,
          1920, 1080, 30, 'en'::varchar,
          '[{"type":"video","name":"FORGED","sortOrder":0}]', '[]', '[]', '[]') $q$,
    current_setting('f607.owner')
  ),
  '42501',
  null,
  'P4: a stranger naming the owner cannot replace the owner''s edit project'
);

set local role postgres;

select is(
  (select id from public.edit_projects where episode_id = '60700000-0000-4000-8000-000000000002'),
  '60700000-0000-4000-8000-0000000000e1'::uuid,
  'P4: the victim edit project is the original one'
);

select is(
  (select array_agg(name order by sort_order) from public.edit_tracks
    where edit_project_id = '60700000-0000-4000-8000-0000000000e1'),
  array['Victim video', 'Victim dialogue']::varchar[],
  'P4: the victim''s tracks are unchanged'
);

select * from finish();
rollback;
