begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-13: `revenue_records_read` was rewritten so that its publish test is
-- evaluated once per query instead of once per row. This pins who can read
-- which revenue row, so the rewrite is shown not to change it (A1-A5 pass
-- identically before and after), and pins the shape that makes it fast (A6,
-- red before the rewrite).
--
-- Fixtures:
--   T  team account. rev_owner owns it; rev_member is a member.
--      PT  a private project of T, with a published video and a revenue row.
--      PP  a PUBLIC project of T, the same. Public projects are readable by
--          any signed-in user; their revenue is not.
--      RA  an account-scoped revenue row on T (no video).
--   S  a team of one: rev_solo owns it and nobody else is on it (KB-99: no
--      workspace data on a personal account). A project, a video and a
--      revenue row.
--   rev_projonly has a project_members row on PT and no role on T.
--   rev_stranger belongs to nothing here.
select plan(6);

select tests.create_supabase_user('rev_owner', 'rev-owner@storybook.dev');
select tests.create_supabase_user('rev_member', 'rev-member@storybook.dev');
select tests.create_supabase_user('rev_projonly', 'rev-projonly@storybook.dev');
select tests.create_supabase_user('rev_solo', 'rev-solo@storybook.dev');
select tests.create_supabase_user('rev_stranger', 'rev-stranger@storybook.dev');

-- The row filter RLS puts on revenue_records itself, in the plan of a
-- revenue read, as whoever calls it: the plan line naming has_account_access
create or replace function public.kb13_policy_filter() returns text
  language plpgsql security invoker set search_path = '' as $fn$
declare
  line text;
begin
  for line in execute
    'explain select publish_id, sum(revenue_cents) from public.revenue_records group by 1'
  loop
    if line ~ 'has_account_access' then
      return line;
    end if;
  end loop;
  return null;
end
$fn$;
grant execute on function public.kb13_policy_filter() to authenticated;

set local role postgres;

insert into public.accounts (id, name, is_personal_account, primary_owner_user_id)
values
  ('13130000-0000-4000-8000-0000000000a0', 'KB-13 team', false, tests.get_supabase_uid('rev_owner')),
  ('13130000-0000-4000-8000-0000000000a1', 'KB-13 solo team', false, tests.get_supabase_uid('rev_solo'));

insert into public.accounts_memberships (user_id, account_id, account_role)
values
  (tests.get_supabase_uid('rev_owner'), '13130000-0000-4000-8000-0000000000a0', 'owner'),
  (tests.get_supabase_uid('rev_member'), '13130000-0000-4000-8000-0000000000a0', 'member'),
  (tests.get_supabase_uid('rev_solo'), '13130000-0000-4000-8000-0000000000a1', 'owner')
on conflict do nothing;

insert into public.platform_connections (id, account_id, platform, platform_account_name, is_active)
values
  ('13130000-0000-4000-8000-0000000000c0', '13130000-0000-4000-8000-0000000000a0', 'youtube', 'T channel', true),
  ('13130000-0000-4000-8000-0000000000c1', '13130000-0000-4000-8000-0000000000a1', 'youtube', 'S channel', true);

-- Projects are created as their owner: the creator becomes the project owner
select set_config('request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('rev_owner'), 'role', 'authenticated')::text, true);
insert into public.projects (id, account_id, name, status, visibility)
values
  ('13130000-0000-4000-8000-0000000000b0', '13130000-0000-4000-8000-0000000000a0', 'PT', 'active', 'private'),
  ('13130000-0000-4000-8000-0000000000b1', '13130000-0000-4000-8000-0000000000a0', 'PP', 'active', 'public');

select set_config('request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('rev_solo'), 'role', 'authenticated')::text, true);
insert into public.projects (id, account_id, name, status)
values ('13130000-0000-4000-8000-0000000000b2', '13130000-0000-4000-8000-0000000000a1', 'PS', 'active');

insert into public.project_members (project_id, user_id, role)
values ('13130000-0000-4000-8000-0000000000b0', tests.get_supabase_uid('rev_projonly'), 'member');

insert into public.episodes (id, project_id, number, title, slug)
values
  ('13130000-0000-4000-8000-0000000000e0', '13130000-0000-4000-8000-0000000000b0', 1, 'PT 1', 'kb13-pt-1'),
  ('13130000-0000-4000-8000-0000000000e1', '13130000-0000-4000-8000-0000000000b1', 1, 'PP 1', 'kb13-pp-1'),
  ('13130000-0000-4000-8000-0000000000e2', '13130000-0000-4000-8000-0000000000b2', 1, 'PS 1', 'kb13-ps-1');

insert into public.publishes (id, episode_id, platform_connection_id, platform, status, title, published_at)
values
  ('13130000-0000-4000-8000-0000000000f0', '13130000-0000-4000-8000-0000000000e0', '13130000-0000-4000-8000-0000000000c0', 'youtube', 'published', 'PT 1', now()),
  ('13130000-0000-4000-8000-0000000000f1', '13130000-0000-4000-8000-0000000000e1', '13130000-0000-4000-8000-0000000000c0', 'youtube', 'published', 'PP 1', now()),
  ('13130000-0000-4000-8000-0000000000f2', '13130000-0000-4000-8000-0000000000e2', '13130000-0000-4000-8000-0000000000c1', 'youtube', 'published', 'PS 1', now());

insert into public.revenue_records (id, publish_id, account_id, platform, record_date, revenue_cents, currency, source, category)
values
  ('13130000-0000-4000-8000-000000000010', '13130000-0000-4000-8000-0000000000f0', null, 'youtube', '2026-09-01', 100, 'USD', 'api', 'ads'),
  ('13130000-0000-4000-8000-000000000011', '13130000-0000-4000-8000-0000000000f1', null, 'youtube', '2026-09-01', 200, 'USD', 'api', 'ads'),
  ('13130000-0000-4000-8000-000000000012', '13130000-0000-4000-8000-0000000000f2', null, 'youtube', '2026-09-01', 300, 'USD', 'api', 'ads'),
  ('13130000-0000-4000-8000-000000000013', null, '13130000-0000-4000-8000-0000000000a0', 'manual', '2026-09-01', 400, 'USD', 'manual', 'sponsorship');

-- The revenue rows (by amount) each user can read, as a sorted list
create or replace function public.kb13_visible() returns int[]
  language sql security invoker set search_path = '' as $fn$
  select coalesce(array_agg(revenue_cents order by revenue_cents), '{}')
    from public.revenue_records
   where id::text like '13130000-0000-4000-8000-00000000001%'
$fn$;
grant execute on function public.kb13_visible() to authenticated;

select makerkit.authenticate_as('rev_owner');
select is(public.kb13_visible(), array[100, 200, 400],
  'A1 the team owner reads the private and public videos'' revenue and the account row, not a stranger''s');

select makerkit.authenticate_as('rev_member');
select is(public.kb13_visible(), array[100, 200, 400],
  'A2 a team member reads the same as the owner');

select makerkit.authenticate_as('rev_projonly');
select is(public.kb13_visible(), '{}'::int[],
  'A3 a project member with no role on the account reads no revenue');

select makerkit.authenticate_as('rev_solo');
select is(public.kb13_visible(), array[300],
  'A4 the owner of a team of one reads their own video''s revenue only');

select makerkit.authenticate_as('rev_stranger');
select is(public.kb13_visible(), '{}'::int[],
  'A5 a stranger reads nothing, not even a public project''s revenue');

-- KB-13: the publish test is a set built once (a hashed subplan), not a
-- subquery run per revenue row
select makerkit.authenticate_as('rev_owner');
select matches(
  public.kb13_policy_filter(),
  'ANY \(publish_id = \(hashed SubPlan',
  'A6 the read policy''s publish test is evaluated once per query, not per row');

select * from finish();
rollback;
