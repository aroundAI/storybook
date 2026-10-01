begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(55);

-- FILM-1724: channel experiments. Every rule the comparison rests on is the
-- table's, because PostgREST is reachable without the actions.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');
select makerkit.set_identifier('member', 'member@storybook.dev');

select tests.create_supabase_user('other_owner', 'other-owner-ce@storybook.dev');
select makerkit.authenticate_as('other_owner');
select public.create_team_account('Other CE');

select tests.create_supabase_user('stranger', 'stranger-ce@storybook.dev');
select tests.create_supabase_user('viewer', 'viewer-ce@storybook.dev');

set local role postgres;

select set_config('ce.story', makerkit.get_account_id_by_slug('storybook')::text, true);
select set_config('ce.other', makerkit.get_account_id_by_slug('other-ce')::text, true);

-- `member` belongs to both teams; `viewer` to the story team only.
insert into public.accounts_memberships (user_id, account_id, account_role)
  values (tests.get_supabase_uid('member'), current_setting('ce.other')::uuid, 'member'),
         (tests.get_supabase_uid('viewer'), current_setting('ce.story')::uuid, 'member');

insert into public.platform_connections (id, account_id, platform, platform_account_name)
  values ('ce000000-0000-4000-8000-000000000001', current_setting('ce.story')::uuid, 'youtube', 'Story Channel'),
         ('ce000000-0000-4000-8000-000000000002', current_setting('ce.other')::uuid, 'youtube', 'Other Channel');

select makerkit.authenticate_as('primary_owner');
insert into public.projects (id, account_id, name, status)
  values ('ce000000-0000-4000-8000-000000000011', current_setting('ce.story')::uuid, 'Story project', 'active');

select makerkit.authenticate_as('other_owner');
insert into public.projects (id, account_id, name, status)
  values ('ce000000-0000-4000-8000-000000000012', current_setting('ce.other')::uuid, 'Other project', 'active');

set local role postgres;

-- `member` writes on both projects, so only the channel/account rule can
-- refuse the foreign video. `viewer` can only read the story project.
insert into public.project_members (project_id, user_id, role)
  values ('ce000000-0000-4000-8000-000000000011', tests.get_supabase_uid('member'), 'member'),
         ('ce000000-0000-4000-8000-000000000012', tests.get_supabase_uid('member'), 'member'),
         ('ce000000-0000-4000-8000-000000000011', tests.get_supabase_uid('viewer'), 'viewer');

insert into public.episodes (id, project_id, number, title, status)
  values ('ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000011', 1, 'S1', 'draft'),
         ('ce000000-0000-4000-8000-000000000022', 'ce000000-0000-4000-8000-000000000012', 1, 'O1', 'draft');

-- Publishes, named by what they test (last digits):
--   31 long, 2 days old     32 long, 1 day old     33 long, 40 days old (before start)
--   34 short, 2 days old    35 other account       36 long, 10 days old
--   37 draft                38 long, 3 days old    39 YouTube "short" of 200s
insert into public.publishes (id, episode_id, platform_connection_id, platform, content_type, status, published_at, duration_seconds)
  values
    ('ce000000-0000-4000-8000-000000000031', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000001', 'youtube', 'full', 'published', now() - interval '2 days', null),
    ('ce000000-0000-4000-8000-000000000032', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000001', 'youtube', 'full', 'published', now() - interval '1 day', null),
    ('ce000000-0000-4000-8000-000000000033', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000001', 'youtube', 'full', 'published', now() - interval '40 days', null),
    ('ce000000-0000-4000-8000-000000000034', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000001', 'youtube', 'short', 'published', now() - interval '2 days', 40),
    ('ce000000-0000-4000-8000-000000000035', 'ce000000-0000-4000-8000-000000000022', 'ce000000-0000-4000-8000-000000000002', 'youtube', 'full', 'published', now() - interval '2 days', null),
    ('ce000000-0000-4000-8000-000000000036', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000001', 'youtube', 'full', 'published', now() - interval '10 days', null),
    ('ce000000-0000-4000-8000-000000000037', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000001', 'youtube', 'full', 'draft', null, null),
    ('ce000000-0000-4000-8000-000000000038', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000001', 'youtube', 'full', 'published', now() - interval '3 days', null),
    ('ce000000-0000-4000-8000-000000000039', 'ce000000-0000-4000-8000-000000000021', 'ce000000-0000-4000-8000-000000000001', 'youtube', 'short', 'published', now() - interval '2 days', 200);

-- Creates an experiment, then fires the deferred style-count check now
-- rather than at a commit this test never reaches.
create function pg_temp.create_checked(p_styles jsonb, p_family text default 'long_horizontal',
                                       p_measures text[] default array['views'])
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  v_id := public.create_channel_experiment(
    current_setting('ce.story')::uuid, 'ce000000-0000-4000-8000-000000000001',
    p_family, 'Thumbnail styles', 'Faces win', 'Faces at least 20% more views',
    p_measures, 'UTC', p_styles);
  set constraints all immediate;
  set constraints all deferred;
  return v_id;
end;
$$;
grant execute on function pg_temp.create_checked(jsonb, text, text[]) to authenticated;

create function pg_temp.delete_style_checked(p_experiment uuid, p_name text)
returns void language plpgsql as $$
begin
  delete from public.channel_experiment_styles
   where experiment_id = p_experiment and name = p_name;
  set constraints all immediate;
  set constraints all deferred;
end;
$$;
grant execute on function pg_temp.delete_style_checked(uuid, text) to authenticated;

create function pg_temp.styles(n int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('name', 'Style ' || i)) from generate_series(1, n) i;
$$;
grant execute on function pg_temp.styles(int) to authenticated;

-- ======================================================================
-- 2–8 styles
-- ======================================================================
select makerkit.authenticate_as('primary_owner');

select throws_ok($$ select pg_temp.create_checked(pg_temp.styles(1)) $$, '23514', null,
  'An experiment with one style is refused');
select throws_ok($$ select pg_temp.create_checked(pg_temp.styles(9)) $$, '23514', null,
  'An experiment with nine styles is refused');
select lives_ok($$ select pg_temp.create_checked(pg_temp.styles(8)) $$,
  'Eight styles are accepted');

select set_config('ce.x', pg_temp.create_checked(
  '[{"name":"Mouth open"},{"name":"Mouth closed"}]'::jsonb)::text, true);

select results_eq(
  $$ select name::text from public.channel_experiment_styles
      where experiment_id = current_setting('ce.x')::uuid order by sort_order $$,
  array['Mouth open', 'Mouth closed'],
  'Two styles are accepted, in the order given');

-- The count is checked at commit; the helper fires it at once.
select throws_ok($$ select pg_temp.delete_style_checked(current_setting('ce.x')::uuid, 'Mouth closed') $$,
  '23514', null, 'Removing a style is refused when it would leave one');

select lives_ok($$
  insert into public.channel_experiment_styles (experiment_id, name, sort_order)
  values (current_setting('ce.x')::uuid, 'Teeth', 2) $$,
  'A third style can be added while planned');

-- ======================================================================
-- Shorts and long-form never share an experiment
-- ======================================================================
select throws_ok($$ select pg_temp.create_checked(pg_temp.styles(2), 'long_horizontal',
                                                  array['hook_retention_3s']) $$,
  '23514', null, 'Early retention is not offered on long-form');
select throws_ok($$ select pg_temp.create_checked(pg_temp.styles(2), 'shorts') $$,
  '23514', null, 'An unknown format family is refused');

select is(public.publish_format_family('youtube', 'short', null), 'short_vertical',
  'A YouTube short of unknown length is short-form');
select is(public.publish_format_family('youtube', 'short', 200), 'long_vertical',
  'A YouTube "short" over three minutes is long-form');
select is(public.publish_format_family('youtube', 'full', null), 'long_horizontal',
  'A YouTube full upload is horizontal long-form');
select is(public.publish_format_family('youtube', 'reel', null), null,
  'An unmapped content type has no family');

-- ======================================================================
-- Lifecycle (FILM-1610 rounds 4–5)
-- ======================================================================
select throws_like($$
  insert into public.channel_experiments (account_id, connection_id, format_family, title, status)
  values (current_setting('ce.story')::uuid, 'ce000000-0000-4000-8000-000000000001',
          'long_horizontal', 'Born running', 'running') $$,
  '%is planned, with no dates%', 'A new experiment starts planned');

select throws_like($$
  update public.channel_experiments set status = 'concluded'
   where id = current_setting('ce.x')::uuid $$,
  '%cannot move from planned to concluded%', 'Planned cannot jump to concluded');

select throws_like($$
  update public.channel_experiments set status = 'running'
   where id = current_setting('ce.x')::uuid $$,
  '%needs a start date%', 'A running experiment needs a start date');

-- Assignment before the start is refused (no start date to compare with).
select throws_like($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  select current_setting('ce.x')::uuid, s.id, 'ce000000-0000-4000-8000-000000000031'
    from public.channel_experiment_styles s
   where s.experiment_id = current_setting('ce.x')::uuid and s.sort_order = 0 $$,
  '%only while the experiment is running; this one is planned%', 'Videos are not assigned while the experiment is planned');

select lives_ok($$
  update public.channel_experiments
     set status = 'running', started_at = current_date - 20
   where id = current_setting('ce.x')::uuid $$,
  'Planned moves to running with its start date');

select throws_like($$
  update public.channel_experiments set hypothesis = 'Closed mouths win'
   where id = current_setting('ce.x')::uuid $$,
  '%cannot change once the experiment has started%', 'The hypothesis is frozen once running');

select throws_like($$
  update public.channel_experiments set measures = array['ctr']
   where id = current_setting('ce.x')::uuid $$,
  '%cannot change once the experiment has started%', 'The measures are frozen once running');

select throws_like($$
  update public.channel_experiments set started_at = current_date - 30
   where id = current_setting('ce.x')::uuid $$,
  '%start date is recorded once%', 'The start date is written once');

select throws_like($$
  update public.channel_experiments set result_snapshot = '{"version":1}'
   where id = current_setting('ce.x')::uuid $$,
  '%result is recorded once%', 'A result is written only by the conclusion');

select throws_like($$
  update public.channel_experiments set status = 'planned'
   where id = current_setting('ce.x')::uuid $$,
  '%cannot move from running to planned%', 'Running cannot go back to planned');

-- The Change log's guard reads the same move rule.
with c as (
  insert into public.analytics_experiments (account_id, title, change_description)
  values (current_setting('ce.story')::uuid, 'A change', 'x') returning id)
select set_config('ce.change', id::text, true) from c;

select throws_like($$
  update public.analytics_experiments set status = 'concluded'
   where id = current_setting('ce.change')::uuid $$,
  '%cannot move from planned to concluded%', 'The Change log still refuses planned → concluded (shared rule)');

-- ======================================================================
-- Assignment, the suggestion and the override
-- ======================================================================
select set_config('ce.a', (select id::text from public.channel_experiment_styles
  where experiment_id = current_setting('ce.x')::uuid and sort_order = 0), true);
select set_config('ce.b', (select id::text from public.channel_experiment_styles
  where experiment_id = current_setting('ce.x')::uuid and sort_order = 1), true);
select set_config('ce.c', (select id::text from public.channel_experiment_styles
  where experiment_id = current_setting('ce.x')::uuid and sort_order = 2), true);

select is(public.channel_experiment_suggested_style(current_setting('ce.x')::uuid),
  current_setting('ce.a')::uuid, 'With no videos, the first style is suggested');

select lives_ok($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.a')::uuid,
          'ce000000-0000-4000-8000-000000000031') $$,
  'A new video on the channel is assigned');

select results_eq($$
  select suggested_style_id, overridden, assigned_by
    from public.channel_experiment_videos
   where publish_id = 'ce000000-0000-4000-8000-000000000031' $$,
  $$ values (current_setting('ce.a')::uuid, false, tests.get_supabase_uid('primary_owner')) $$,
  'Following the suggestion is recorded as not overridden, with who assigned it');

select is(public.channel_experiment_suggested_style(current_setting('ce.x')::uuid),
  current_setting('ce.b')::uuid, 'The style with the fewest videos is suggested next');

select lives_ok($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id, suggested_style_id, overridden)
  values (current_setting('ce.x')::uuid, current_setting('ce.a')::uuid,
          'ce000000-0000-4000-8000-000000000032', current_setting('ce.a')::uuid, false) $$,
  'A user may override the suggestion');

select results_eq($$
  select suggested_style_id, overridden from public.channel_experiment_videos
   where publish_id = 'ce000000-0000-4000-8000-000000000032' $$,
  $$ values (current_setting('ce.b')::uuid, true) $$,
  'The override is recorded against the table''s suggestion, whatever the caller sent');

select is(public.channel_experiment_suggested_style(current_setting('ce.x')::uuid),
  current_setting('ce.b')::uuid, 'On a tie, the earlier style is suggested');

select throws_ok($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.b')::uuid,
          'ce000000-0000-4000-8000-000000000031') $$,
  '23505', null, 'A video belongs to one style per experiment');

select throws_like($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.b')::uuid,
          'ce000000-0000-4000-8000-000000000033') $$,
  '%published on or after the experiment started%', 'A video published before the start cannot be assigned');

select throws_like($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.b')::uuid,
          'ce000000-0000-4000-8000-000000000034') $$,
  '%not in the experiment''s format family (long_horizontal)%', 'A Short cannot join a long-form experiment');

select throws_like($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.b')::uuid,
          'ce000000-0000-4000-8000-000000000037') $$,
  '%Only a published video%', 'An unpublished video cannot be assigned');

-- A short-form experiment takes the Short and refuses the 200-second "short".
select set_config('ce.z', pg_temp.create_checked(pg_temp.styles(2), 'short_vertical',
  array['views', 'hook_retention_3s'])::text, true);
update public.channel_experiments set status = 'running', started_at = current_date - 5
 where id = current_setting('ce.z')::uuid;

select lives_ok($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  select current_setting('ce.z')::uuid, s.id, 'ce000000-0000-4000-8000-000000000034'
    from public.channel_experiment_styles s
   where s.experiment_id = current_setting('ce.z')::uuid and s.sort_order = 0 $$,
  'A Short joins a short-form experiment');

select throws_like($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  select current_setting('ce.z')::uuid, s.id, 'ce000000-0000-4000-8000-000000000039'
    from public.channel_experiment_styles s
   where s.experiment_id = current_setting('ce.z')::uuid and s.sort_order = 1 $$,
  '%not in the experiment''s format family (short_vertical)%', 'A long-form video cannot join a short-form experiment');

-- ======================================================================
-- Removal
-- ======================================================================
select throws_ok($$
  delete from public.channel_experiment_styles where id = current_setting('ce.a')::uuid $$,
  '23503', null, 'A style with videos cannot be removed');

select lives_ok($$
  delete from public.channel_experiment_styles where id = current_setting('ce.c')::uuid $$,
  'A style with no videos can be removed while running');

select lives_ok($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.b')::uuid,
          'ce000000-0000-4000-8000-000000000036') $$,
  'A 10-day-old video published after the start is assigned');

select throws_like($$
  delete from public.channel_experiment_videos
   where publish_id = 'ce000000-0000-4000-8000-000000000036' $$,
  '%7 or more days old%', 'A video past its first checkpoint stays in the experiment');

select lives_ok($$
  delete from public.channel_experiment_videos
   where publish_id = 'ce000000-0000-4000-8000-000000000032' $$,
  'A video younger than its first checkpoint can be unassigned');

select throws_ok($$
  update public.channel_experiment_videos set style_id = current_setting('ce.b')::uuid
   where publish_id = 'ce000000-0000-4000-8000-000000000031' $$,
  '42501', null, 'An assignment is not edited in place');

-- ======================================================================
-- RLS: accounts, two-account users, project roles
-- ======================================================================
select makerkit.authenticate_as('member');

select results_eq($$ select count(*)::int from public.publishes
  where id in ('ce000000-0000-4000-8000-000000000035', 'ce000000-0000-4000-8000-000000000038') $$,
  array[2], 'The two-account member sees both videos');

select throws_ok($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.b')::uuid,
          'ce000000-0000-4000-8000-000000000035') $$,
  '42501', null, 'Another account''s video cannot be assigned, even by someone in both');

select lives_ok($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.b')::uuid,
          'ce000000-0000-4000-8000-000000000038') $$,
  'A project member assigns a video of their own account');

select makerkit.authenticate_as('viewer');

select results_eq($$ select count(*)::int from public.channel_experiment_videos
  where experiment_id = current_setting('ce.x')::uuid $$,
  array[3], 'An account member reads the assignments');

select throws_ok($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.b')::uuid,
          'ce000000-0000-4000-8000-000000000032') $$,
  '42501', null, 'A project viewer cannot assign');

select makerkit.authenticate_as('stranger');

select results_eq($$
  select (select count(*) from public.channel_experiments where id = current_setting('ce.x')::uuid)
       + (select count(*) from public.channel_experiment_styles where experiment_id = current_setting('ce.x')::uuid)
       + (select count(*) from public.channel_experiment_videos where experiment_id = current_setting('ce.x')::uuid) $$,
  array[0::bigint], 'Someone outside the account reads nothing');

select throws_ok($$
  insert into public.channel_experiment_styles (experiment_id, name, sort_order)
  values (current_setting('ce.x')::uuid, 'Intruder', 5) $$,
  '42501', null, 'Someone outside the account cannot add a style');

select makerkit.authenticate_as('other_owner');

select throws_ok($$
  select public.create_channel_experiment(
    current_setting('ce.other')::uuid, 'ce000000-0000-4000-8000-000000000001',
    'long_horizontal', 'Borrowed channel', null, null, array['views'], 'UTC',
    '[{"name":"a"},{"name":"b"}]'::jsonb) $$,
  '23503', null, 'An experiment cannot use another account''s channel');

-- ======================================================================
-- Conclusion and deletion
-- ======================================================================
select makerkit.authenticate_as('primary_owner');

select lives_ok($$
  update public.channel_experiments
     set status = 'concluded', ended_at = current_date, conclusion = 'No clear difference',
         outcome_status = 'inconclusive', result_snapshot = '{"version":1}'
   where id = current_setting('ce.x')::uuid $$,
  'Running is concluded with its result, once');

select throws_like($$
  update public.channel_experiments set conclusion = 'Mouth open won'
   where id = current_setting('ce.x')::uuid $$,
  '%conclusion are recorded once%', 'The conclusion is not rewritten afterwards');

select throws_like($$
  insert into public.channel_experiment_videos (experiment_id, style_id, publish_id)
  values (current_setting('ce.x')::uuid, current_setting('ce.b')::uuid,
          'ce000000-0000-4000-8000-000000000032') $$,
  '%this one is concluded%', 'Nothing is assigned to a concluded experiment');

delete from public.channel_experiments where id = current_setting('ce.x')::uuid;

select results_eq($$ select count(*)::int from public.channel_experiments
  where id = current_setting('ce.x')::uuid $$,
  array[1], 'A concluded experiment is not deleted');

select lives_ok($$
  delete from public.channel_experiments where status = 'planned'
     and account_id = current_setting('ce.story')::uuid $$,
  'A planned experiment is deleted with its styles');

select * from finish();

rollback;
