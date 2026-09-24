begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-78. Story regeneration replaces the threads generation opened and keeps
-- the ones a person opened; `auto_generated` is how it tells them apart.
-- Every writer other than the llm-worker omits the column, so its default is
-- what keeps a hand-opened thread safe.
select plan(4);

select has_column('public', 'narrative_threads', 'auto_generated',
  'narrative_threads records whether story generation opened the thread');
select col_type_is('public', 'narrative_threads', 'auto_generated', 'boolean',
  'auto_generated is a boolean');
select col_not_null('public', 'narrative_threads', 'auto_generated',
  'auto_generated is never unknown');
select col_default_is('public', 'narrative_threads', 'auto_generated', 'false',
  'a thread nobody marked is treated as opened by hand');

select * from finish();
rollback;
