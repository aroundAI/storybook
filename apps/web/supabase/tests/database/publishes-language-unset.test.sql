begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(7);

-- FILM-1702. `publishes.language` used to be `NOT NULL DEFAULT 'en'`, so a
-- publish nobody labelled was recorded as English and every language
-- breakdown's English bucket was "English, plus everything unlabelled".
--
-- What this guards is the *database's* half of that: a generated type says
-- the column is nullable, and says nothing about whether an insert that
-- omits it still comes back as 'en'. Only the server can answer that.

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');

set local role postgres;

select set_config('lang.story', makerkit.get_account_id_by_slug('storybook')::text, true);

-- The account owner creates the project: the creator trigger on `projects`
-- reads auth.uid(), which is null when inserting as postgres.
select makerkit.authenticate_as('primary_owner');

insert into public.projects (id, account_id, name, status)
  values ('1a1a1a1a-0000-4000-8000-000000000001',
          current_setting('lang.story')::uuid, 'Language fixture', 'active');

set local role postgres;

insert into public.episodes (id, project_id, number, title, status)
  values ('1a1a1a1a-0000-4000-8000-000000000002',
          '1a1a1a1a-0000-4000-8000-000000000001', 1, 'E1', 'draft');

-- ==================================
-- Nothing defaults to a language
-- ==================================

-- The shape markAsExternallyUploaded writes: no connection, no language.
insert into public.publishes (id, episode_id, platform, content_type, status)
  values ('1a1a1a1a-0000-4000-8000-000000000003',
          '1a1a1a1a-0000-4000-8000-000000000002', 'youtube', 'full', 'published');

select is(
  (select language from public.publishes
    where id = '1a1a1a1a-0000-4000-8000-000000000003'),
  null,
  'a publish inserted without a language has none — it is not English'
);

select col_is_null('public', 'publishes', 'language',
  'publishes.language can say "never set"');

select col_hasnt_default('public', 'publishes', 'language',
  'publishes.language has no default to mistake for a choice');

-- ==================================
-- A chosen language is kept, English included
-- ==================================

insert into public.publishes (id, episode_id, platform, content_type, status, language)
  values ('1a1a1a1a-0000-4000-8000-000000000004',
          '1a1a1a1a-0000-4000-8000-000000000002', 'youtube', 'full', 'published', 'en'),
         ('1a1a1a1a-0000-4000-8000-000000000005',
          '1a1a1a1a-0000-4000-8000-000000000002', 'youtube', 'full', 'published', 'pt-BR');

select results_eq(
  $$ select language::text from public.publishes
      where id in ('1a1a1a1a-0000-4000-8000-000000000004',
                   '1a1a1a1a-0000-4000-8000-000000000005')
      order by id $$,
  $$ values ('en'), ('pt-BR') $$,
  'a deliberate English publish is still English, and a regional code still fits'
);

-- ==================================
-- "Not set" has exactly one spelling
-- ==================================

select throws_ok(
  $$ insert into public.publishes (episode_id, platform, content_type, status, language)
     values ('1a1a1a1a-0000-4000-8000-000000000002', 'youtube', 'full', 'draft', '') $$,
  '23514',
  null,
  'a blank language is refused: it would be a third state between NULL and a code'
);

select throws_ok(
  $$ insert into public.publishes (episode_id, platform, content_type, status, language)
     values ('1a1a1a1a-0000-4000-8000-000000000002', 'youtube', 'full', 'draft', '  ') $$,
  '23514',
  null,
  'whitespace is refused for the same reason'
);

select throws_ok(
  $$ update public.publishes set language = 'e'
      where id = '1a1a1a1a-0000-4000-8000-000000000004' $$,
  '23514',
  null,
  'a one-character code is refused on update too'
);

select * from finish();

rollback;
