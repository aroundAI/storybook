/*
 * KB-95: a deleted audio-library asset is not matched again.
 *
 * The library's Delete now soft-deletes (`audio_assets.deleted_at`), and
 * every reader has to skip what it deleted. `match_audio_assets` did not: a
 * deleted asset stayed a semantic match for new cues, and so came back on a
 * timeline after the user had removed it. Its TypeScript sibling, the
 * prompt-hash match in `audio-cue-actions.ts`, is fixed in the same change.
 *
 * Same signature, same result, same (invoker) rights; `create or replace`
 * keeps the grants. The only change is `a.deleted_at is null`.
 *
 * Tests: tests/database/audio-assets-deleted.test.sql.
 */

create or replace function public.match_audio_assets(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_project_id uuid
)
returns table (
  id uuid,
  similarity float,
  prompt text,
  file_url text,
  audio_type text,
  name text
)
language sql stable as $$
  select
    a.id,
    1 - (a.embedding <=> query_embedding) as similarity,
    a.prompt,
    a.file_url,
    a.audio_type,
    a.name
  from public.audio_assets a
  where a.project_id = p_project_id
    and a.deleted_at is null
    and a.embedding is not null
    and a.status = 'completed'
    and 1 - (a.embedding <=> query_embedding) > match_threshold
  order by a.embedding <=> query_embedding
  limit match_count;
$$;
