-- FILM-2213. A scheduled post's time changes in place, and new posting
-- rules re-plan what is already scheduled. Both go through
-- reschedule_publishes (FILM-2210), which now also:
--
-- 1. takes a null slot_at: a time the owner chose past the channel's
--    posting rules holds no cadence slot, so the scheduled job's gate
--    neither counts it toward a day nor moves it (as a post scheduled by
--    hand never was);
-- 2. merges a move's `metadata` into the post's, top-level keys only, so
--    the move records its history (scheduleHistory), a chosen time
--    (manualTime) and YouTube's new publish time in the same transaction.
--
-- Same signature, so the generated types do not change.

create or replace function public.reschedule_publishes(
  p_moves jsonb,
  p_inserts jsonb default '[]'::jsonb
)
returns setof public.publishes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_moved integer;
begin
  select coalesce(array_agg((m ->> 'id')::uuid), '{}')
    into v_ids
    from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) m;

  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Each post moves once.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) m
     where m ->> 'scheduled_at' is null
        or (m ? 'metadata' and jsonb_typeof(m -> 'metadata') <> 'object')
  ) then
    raise exception 'A moved post needs a time, and its metadata is an object.'
      using errcode = '22023';
  end if;

  update public.publishes
     set slot_at = null
   where id = any (v_ids)
     and status = 'scheduled';

  get diagnostics v_moved = row_count;

  if v_moved <> cardinality(v_ids) then
    raise exception 'Only scheduled posts move: % of % are.', v_moved, cardinality(v_ids)
      using errcode = '55000';
  end if;

  update public.publishes p
     set slot_at = (m ->> 'slot_at')::timestamptz,
         scheduled_at = (m ->> 'scheduled_at')::timestamptz,
         metadata = case
           when m ? 'metadata'
             then coalesce(p.metadata, '{}'::jsonb) || (m -> 'metadata')
           else p.metadata
         end
    from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) m
   where p.id = (m ->> 'id')::uuid;

  return query
  with inserted as (
    insert into public.publishes (
      episode_id, platform_connection_id, platform, content_type, title,
      description, tags, thumbnail_url, status, scheduled_at, slot_at,
      after_episode_full, metadata, language, ai_generated, release_priority
    )
    select r.episode_id, r.platform_connection_id, r.platform, r.content_type,
           r.title, r.description, r.tags, r.thumbnail_url, 'scheduled',
           r.scheduled_at, r.slot_at, coalesce(r.after_episode_full, false),
           coalesce(r.metadata, '{}'::jsonb), r.language,
           coalesce(r.ai_generated, false),
           coalesce(r.release_priority, 'normal')
      from jsonb_populate_recordset(
             null::public.publishes, coalesce(p_inserts, '[]'::jsonb)
           ) r
    returning *
  )
  select * from inserted;
end;
$$;

comment on function public.reschedule_publishes(jsonb, jsonb) is
  'Moves scheduled posts to new times (a null slot_at for a time chosen past the posting rules), merging each move''s metadata, and inserts new scheduled posts, all or nothing. Security invoker: RLS decides whose. FILM-2210, FILM-2213';

revoke all on function public.reschedule_publishes(jsonb, jsonb) from public, anon;
grant execute on function public.reschedule_publishes(jsonb, jsonb) to authenticated, service_role;
