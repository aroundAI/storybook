begin;
create extension "basejump-supabase_test_helpers" version '0.0.6';

-- KB-35. The notify trigger nobody listened to is gone, the pre-KB-35
-- columns are kept, and `match_episode_embeddings` answers only the service
-- role, only within one project, one model and the candidate window, and
-- never with a deleted episode. Each exclusion has an episode that would
-- otherwise rank first, so "excluded" is measured, not assumed.
select plan(17);

select makerkit.set_identifier('primary_owner', 'test@storybook.dev');

set local role postgres;

select set_config('kb.account', makerkit.get_account_id_by_slug('storybook')::text, true);
-- Projects record their creator from the JWT
select set_config('request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('primary_owner'), 'role', 'authenticated')::text, true);

-- q = e1. `vec(a, b)` is a 1024-dimension vector starting (a, b, 0, …).
create function pg_temp.vec(a real, b real) returns vector
language sql as $$
  select (array[a, b]::real[] || array_fill(0::real, array[1022]))::vector
$$;

insert into public.projects (id, account_id, name, slug) values
  ('35350000-0000-4000-8000-000000000001', current_setting('kb.account')::uuid, 'KB-35 target', 'kb-35-target'),
  ('35350000-0000-4000-8000-000000000002', current_setting('kb.account')::uuid, 'KB-35 other', 'kb-35-other');

-- A: identical to q. B: similarity 0.8. C: similarity 0 (below 0.5).
-- D: identical, other project. E: identical, older model. F: identical,
-- deleted. G: identical, not in the candidate window.
insert into public.episodes (id, project_id, number, title, deleted_at) values
  ('35350000-0000-4000-8000-00000000000a', '35350000-0000-4000-8000-000000000001', 1, 'A', null),
  ('35350000-0000-4000-8000-00000000000b', '35350000-0000-4000-8000-000000000001', 2, 'B', null),
  ('35350000-0000-4000-8000-00000000000c', '35350000-0000-4000-8000-000000000001', 3, 'C', null),
  ('35350000-0000-4000-8000-00000000000d', '35350000-0000-4000-8000-000000000002', 1, 'D', null),
  ('35350000-0000-4000-8000-00000000000e', '35350000-0000-4000-8000-000000000001', 4, 'E', null),
  ('35350000-0000-4000-8000-00000000000f', '35350000-0000-4000-8000-000000000001', 5, 'F', now()),
  ('35350000-0000-4000-8000-000000000010', '35350000-0000-4000-8000-000000000001', 6, 'G', null);

insert into public.episode_embeddings (episode_id, embedding, content_hash, model) values
  ('35350000-0000-4000-8000-00000000000a', pg_temp.vec(1, 0), 'h', 'voyage-3-large'),
  ('35350000-0000-4000-8000-00000000000b', pg_temp.vec(0.8, 0.6), 'h', 'voyage-3-large'),
  ('35350000-0000-4000-8000-00000000000c', pg_temp.vec(0, 1), 'h', 'voyage-3-large'),
  ('35350000-0000-4000-8000-00000000000d', pg_temp.vec(1, 0), 'h', 'voyage-3-large'),
  ('35350000-0000-4000-8000-00000000000e', pg_temp.vec(1, 0), 'h', 'voyage-large-2'),
  ('35350000-0000-4000-8000-00000000000f', pg_temp.vec(1, 0), 'h', 'voyage-3-large'),
  ('35350000-0000-4000-8000-000000000010', pg_temp.vec(1, 0), 'h', 'voyage-3-large');

-- The window the worker would pass: every episode above except G, and D
-- smuggled in from the other project.
create function pg_temp.match(n integer, floor double precision)
returns setof uuid language sql as $$
  select episode_id from public.match_episode_embeddings(
    pg_temp.vec(1, 0),
    '35350000-0000-4000-8000-000000000001',
    array[
      '35350000-0000-4000-8000-00000000000a', '35350000-0000-4000-8000-00000000000b',
      '35350000-0000-4000-8000-00000000000c', '35350000-0000-4000-8000-00000000000d',
      '35350000-0000-4000-8000-00000000000e', '35350000-0000-4000-8000-00000000000f'
    ]::uuid[],
    'voyage-3-large', n, floor)
$$;

-- The roles below call these helpers; the function under test is what
-- decides whether they get through.
grant execute on function pg_temp.vec(real, real), pg_temp.match(integer, double precision)
  to authenticated, service_role;

-- Machinery removed
select hasnt_trigger('public', 'episodes', 'episode_embedding_trigger',
  'the pg_notify trigger nobody listened to is gone');
select hasnt_function('public', 'trigger_generate_episode_embeddings',
  'its trigger function is gone');
select hasnt_function('public', 'search_similar_episodes',
  'the old search RPC, executable by any signed-in user, is gone');
select hasnt_index('public', 'episode_embeddings', 'episode_premise_embedding_idx',
  'the premise ivfflat index is gone');
select hasnt_index('public', 'episode_embeddings', 'episode_story_embedding_idx',
  'the story ivfflat index is gone');

-- Data kept, columns added
select has_column('public', 'episode_embeddings', 'premise_embedding', 'premise_embedding is kept');
select has_column('public', 'episode_embeddings', 'story_embedding', 'story_embedding is kept');
select has_column('public', 'episode_embeddings', 'embedding', 'embedding added');
select has_column('public', 'episode_embeddings', 'content_hash', 'content_hash added');
select has_column('public', 'episode_embeddings', 'model', 'model added');

-- Who may call it
select ok(
  not has_function_privilege('authenticated',
    'public.match_episode_embeddings(vector, uuid, uuid[], text, integer, double precision)', 'execute'),
  'a signed-in user cannot execute match_episode_embeddings');
select ok(
  not has_function_privilege('anon',
    'public.match_episode_embeddings(vector, uuid, uuid[], text, integer, double precision)', 'execute'),
  'anon cannot execute match_episode_embeddings');

select makerkit.authenticate_as('primary_owner');
select throws_ok(
  $$ select * from pg_temp.match(3, 0.5) $$,
  '42501',
  null,
  'the owner of the project is refused too: it is the worker''s call');

-- What it returns
set local role service_role;

select results_eq(
  $$ select * from pg_temp.match(3, 0.5) $$,
  $$ values ('35350000-0000-4000-8000-00000000000a'::uuid),
            ('35350000-0000-4000-8000-00000000000b'::uuid) $$,
  'most similar first; other project, older model, deleted and out-of-window episodes excluded; below the floor dropped');

select results_eq(
  $$ select * from pg_temp.match(1, 0.5) $$,
  $$ values ('35350000-0000-4000-8000-00000000000a'::uuid) $$,
  'match_count limits the rows');

select results_eq(
  $$ select * from pg_temp.match(3, 0) $$,
  $$ values ('35350000-0000-4000-8000-00000000000a'::uuid),
            ('35350000-0000-4000-8000-00000000000b'::uuid),
            ('35350000-0000-4000-8000-00000000000c'::uuid) $$,
  'a floor of 0 admits the dissimilar episode, still after the similar ones');

select is(
  (select round(similarity::numeric, 3) from public.match_episode_embeddings(
    pg_temp.vec(1, 0), '35350000-0000-4000-8000-000000000001',
    array['35350000-0000-4000-8000-00000000000b']::uuid[], 'voyage-3-large', 3, 0)),
  0.800,
  'similarity is cosine similarity');

select * from finish();
rollback;
