begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(14);

-- FILM-2004: projects.brand and projects.edit_policy. Both are JSON objects,
-- '{}' by default (the app's schemas fill the defaults), never null and never
-- a non-object. They ride on projects_update: a project admin writes them, a
-- project member cannot. Writing one bumps updated_at, which the edit
-- package etag reads (FILM-2001).

select makerkit.set_identifier('owner', 'owner@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

-- The creator becomes the project owner (add_project_creator_as_owner)
select makerkit.authenticate_as('owner');
set local role postgres;
select set_config('bp.team', makerkit.get_account_id_by_slug('storybook')::text, true);

insert into public.projects (id, account_id, name, slug, updated_at)
  values ('b2b2b2b2-0000-4000-8000-000000002004', current_setting('bp.team')::uuid,
          'Brand project', 'brand-project', now() - interval '1 day');
insert into public.project_members (project_id, user_id, role)
  values ('b2b2b2b2-0000-4000-8000-000000002004', tests.get_supabase_uid('member'), 'member');

-- ------------------------------------------------------------------
-- The columns
-- ------------------------------------------------------------------
select col_type_is('public', 'projects', 'brand', 'jsonb', 'C1 projects.brand is jsonb');
select col_not_null('public', 'projects', 'brand', 'C2 projects.brand is not null');
select col_default_is('public', 'projects', 'brand', '{}'::jsonb, 'C3 projects.brand defaults to {}');
select col_type_is('public', 'projects', 'edit_policy', 'jsonb', 'C4 projects.edit_policy is jsonb');
select col_not_null('public', 'projects', 'edit_policy', 'C5 projects.edit_policy is not null');
select col_default_is('public', 'projects', 'edit_policy', '{}'::jsonb, 'C6 projects.edit_policy defaults to {}');

select is(
  (select brand || edit_policy from public.projects where id = 'b2b2b2b2-0000-4000-8000-000000002004'),
  '{}'::jsonb,
  'C7 a new project carries {} in both'
);

-- ------------------------------------------------------------------
-- Only objects
-- ------------------------------------------------------------------
select throws_ok(
  $$ update public.projects set brand = '[]' where id = 'b2b2b2b2-0000-4000-8000-000000002004' $$,
  '23514', null,
  'K1 a brand that is not an object is refused'
);
select throws_ok(
  $$ update public.projects set edit_policy = '"cut"' where id = 'b2b2b2b2-0000-4000-8000-000000002004' $$,
  '23514', null,
  'K2 an edit policy that is not an object is refused'
);
select throws_ok(
  $$ update public.projects set brand = null where id = 'b2b2b2b2-0000-4000-8000-000000002004' $$,
  '23502', null,
  'K3 a null brand is refused'
);

-- ------------------------------------------------------------------
-- Who writes: projects_update (project owner or admin)
-- ------------------------------------------------------------------
select makerkit.authenticate_as('member');
update public.projects set brand = '{"transitionStyle": "dip"}'
  where id = 'b2b2b2b2-0000-4000-8000-000000002004';
select makerkit.authenticate_as('owner');
select is(
  (select brand from public.projects where id = 'b2b2b2b2-0000-4000-8000-000000002004'),
  '{}'::jsonb,
  'W1 a project member cannot write the brand'
);

update public.projects
  set brand = '{"colors": {"captionText": "#FF0000"}}', edit_policy = '{"minShotLength": 2}'
  where id = 'b2b2b2b2-0000-4000-8000-000000002004';
select is(
  (select brand -> 'colors' ->> 'captionText' from public.projects where id = 'b2b2b2b2-0000-4000-8000-000000002004'),
  '#FF0000',
  'W2 a project owner writes the brand'
);
select is(
  (select (edit_policy ->> 'minShotLength')::numeric from public.projects where id = 'b2b2b2b2-0000-4000-8000-000000002004'),
  2::numeric,
  'W3 a project owner writes the edit policy'
);

-- ------------------------------------------------------------------
-- The etag's input
-- ------------------------------------------------------------------
select ok(
  (select updated_at > now() - interval '1 hour' from public.projects where id = 'b2b2b2b2-0000-4000-8000-000000002004'),
  'E1 writing the brand bumps projects.updated_at'
);

select * from finish();
rollback;
