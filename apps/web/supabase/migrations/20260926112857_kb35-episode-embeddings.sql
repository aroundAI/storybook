-- KB-35: semantic search over a project's earlier episodes.
--
-- Additive for data: nothing is deleted and no column is dropped. What this
-- removes is machinery, not rows:
--
--   * `episode_embedding_trigger` and `trigger_generate_episode_embeddings()`
--     sent a `pg_notify('generate_embedding', …)` of up to ~2 KB on every
--     `episodes.story_data` write. Nothing has ever listened on that channel.
--     Embeddings are now written by the LLM worker when it reads them,
--     keyed by a content hash (apps/web/lambda/llm-worker/utils/semantic-episodes.ts).
--   * The two ivfflat indexes. They were built on an empty table (degenerate
--     centroids), and with a filter ivfflat post-filters and can return fewer
--     than the rows asked for. Searches are exact over one project's window
--     of at most 100 episodes. Dropping an index loses no data.
--   * `search_similar_episodes`, never called, executable by any signed-in
--     user. Replaced by `match_episode_embeddings`, service role only.
--
-- `premise_embedding` and `story_embedding` are left exactly as they are.
-- No code in this repository has ever written them, but that cannot be
-- checked against production from here, so the counts below are printed
-- when this migration runs and the columns stay until they are known.
-- New vectors go in `embedding`, tagged with the `model` that made them; a
-- row without a `content_hash` is re-embedded on first use into `embedding`
-- only.

do $$
declare
  total_rows bigint;
  premise_vectors bigint;
  story_vectors bigint;
begin
  select count(*), count(premise_embedding), count(story_embedding)
    into total_rows, premise_vectors, story_vectors
    from public.episode_embeddings;

  raise notice
    'KB-35: episode_embeddings holds % rows (% premise vectors, % story vectors); none are changed',
    total_rows, premise_vectors, story_vectors;
end
$$;

drop trigger if exists episode_embedding_trigger on public.episodes;
drop function if exists public.trigger_generate_episode_embeddings();

drop index if exists public.episode_premise_embedding_idx;
drop index if exists public.episode_story_embedding_idx;

drop function if exists public.search_similar_episodes(
  vector, uuid, uuid, double precision, integer
);

alter table public.episode_embeddings
  add column if not exists embedding vector(1024),
  add column if not exists content_hash text,
  add column if not exists model text;

comment on column public.episode_embeddings.embedding is
  'KB-35: the episode''s title, plot and key events, embedded by the LLM worker';
comment on column public.episode_embeddings.content_hash is
  'KB-35: sha256 of the model and the embedded text; a mismatch re-embeds';
comment on column public.episode_embeddings.model is
  'KB-35: the Voyage model that produced `embedding`; searches compare only equal models';
comment on column public.episode_embeddings.premise_embedding is
  'Pre-KB-35 column with no writer in this repository; kept until production counts are known';
comment on column public.episode_embeddings.story_embedding is
  'Pre-KB-35 column with no writer in this repository; kept until production counts are known';

-- The most similar of the given episodes to a query, within one project and
-- one model. The worker passes the candidate ids (its memory-horizon window),
-- so the project filter is a second fence, not the only one.
create or replace function public.match_episode_embeddings(
  query_embedding vector(1024),
  target_project_id uuid,
  candidate_episode_ids uuid[],
  embedding_model text,
  match_count integer default 3,
  min_similarity double precision default 0.5
)
returns table (episode_id uuid, similarity double precision)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    ee.episode_id,
    1 - (ee.embedding <=> query_embedding) as similarity
  from public.episode_embeddings ee
  join public.episodes e on e.id = ee.episode_id
  where e.project_id = target_project_id
    and e.deleted_at is null
    and ee.episode_id = any (candidate_episode_ids)
    and ee.model = embedding_model
    and ee.embedding is not null
    and 1 - (ee.embedding <=> query_embedding) >= min_similarity
  order by ee.embedding <=> query_embedding, ee.episode_id
  limit greatest(match_count, 0);
$$;

revoke all on function public.match_episode_embeddings(
  vector, uuid, uuid[], text, integer, double precision
) from public, anon, authenticated;

grant execute on function public.match_episode_embeddings(
  vector, uuid, uuid[], text, integer, double precision
) to service_role;
