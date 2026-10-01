begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(9);

-- FILM-1717 v2. A Change log entry records the genome hypothesis it tests,
-- as dimension:slug@stage. The table refuses any other form, and the link
-- is fixed once the change has started: tying a running or concluded change
-- to a hypothesis afterwards would let the result choose what it confirms.
-- And the semantic dimensions (layer B) take only their levels.

select makerkit.set_identifier('member', 'member@storybook.dev');

set local role postgres;

select set_config('gh.story', makerkit.get_account_id_by_slug('storybook')::text, true);

-- ==================================
-- Semantic attributes
-- ==================================

select lives_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values (current_setting('gh.story')::uuid, 'identity', 'high', 'High') $$,
  'a semantic dimension takes a level'
);

select throws_ok(
  $$ insert into public.content_tags (account_id, dimension, slug, label)
     values (current_setting('gh.story')::uuid, 'humour', 'very-funny', 'Very funny') $$,
  '23514',
  null,
  'and refuses anything but low, medium or high'
);

select makerkit.authenticate_as('member');

-- ==================================
-- The hypothesis key
-- ==================================

select lives_ok(
  $$ insert into public.analytics_experiments (id, account_id, title, change_description, genome_hypothesis)
     values ('17171717-0000-4000-8000-000000000001', current_setting('gh.story')::uuid, 'Result first', 'x', 'result_first:yes@attention'),
            ('17171717-0000-4000-8000-000000000002', current_setting('gh.story')::uuid, 'No hypothesis', 'x', null) $$,
  'a change records the hypothesis it tests, or none'
);

select throws_ok(
  $$ insert into public.analytics_experiments (account_id, title, change_description, genome_hypothesis)
     values (current_setting('gh.story')::uuid, 'Free text', 'x', 'Result First') $$,
  '23514',
  null,
  'a hypothesis is a key, not free text'
);

select throws_ok(
  $$ insert into public.analytics_experiments (account_id, title, change_description, genome_hypothesis)
     values (current_setting('gh.story')::uuid, 'Not a stage', 'x', 'result_first:yes@views') $$,
  '23514',
  null,
  'and names a funnel stage'
);

-- ==================================
-- Frozen once started
-- ==================================

select lives_ok(
  $$ update public.analytics_experiments set genome_hypothesis = 'hook_type:cold-open@hook'
      where id = '17171717-0000-4000-8000-000000000001' $$,
  'while planned, the hypothesis can still change'
);

select lives_ok(
  $$ update public.analytics_experiments
        set status = 'running', started_at = '2026-07-10', baseline_metrics = '{"real": 1}'
      where id = '17171717-0000-4000-8000-000000000001' $$,
  'the change starts'
);

select throws_ok(
  $$ update public.analytics_experiments set genome_hypothesis = 'result_first:yes@attention'
      where id = '17171717-0000-4000-8000-000000000001' $$,
  'P0001',
  'The genome hypothesis cannot change once the experiment has started',
  'once started, the hypothesis it tests is fixed'
);

select is(
  (select genome_hypothesis from public.analytics_experiments
    where id = '17171717-0000-4000-8000-000000000001'),
  'hook_type:cold-open@hook',
  'and still reads as it did when the change started'
);

select * from finish();
rollback;
