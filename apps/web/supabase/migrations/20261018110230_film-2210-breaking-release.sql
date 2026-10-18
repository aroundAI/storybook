-- FILM-2210. A breaking-news release: an episode that goes out now, ahead of
-- a channel's scheduled posts, with its Shorts at the front of each
-- channel's Shorts queue and extra Short times for a few days.
--
-- 1. publishes.release_priority marks the breaking posts. The gate does not
--    count them toward a day's limit, and never moves them for it.
-- 2. reschedule_publishes moves many scheduled posts and writes the new ones
--    in one transaction. publishes_channel_slot_key is partial, so it cannot
--    be deferred: every moved post gives up its slot first, then takes its
--    new one, so no slot is held twice mid-move.

alter table public.publishes
  add column release_priority text not null default 'normal'
    constraint publishes_release_priority_check
      check (release_priority in ('normal', 'breaking'));

comment on column public.publishes.release_priority is
  'normal, or breaking: posted ahead of the channel''s queue and not counted toward its daily limit. FILM-2210';

-- A channel's breaking posts, which a normal post's day ignores
create index idx_publishes_channel_breaking
  on public.publishes (platform_connection_id, slot_at)
  where release_priority = 'breaking';

-- p_moves:   [{ id, slot_at, scheduled_at }], each a `scheduled` post
-- p_inserts: rows to insert as `scheduled`, as insertScheduledRows writes them
-- Returns the inserted rows. Any post that is not scheduled, or not the
-- caller's to change, refuses the whole call: nothing moves.
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
     where m ->> 'slot_at' is null or m ->> 'scheduled_at' is null
  ) then
    raise exception 'A moved post needs a slot and a time.' using errcode = '22023';
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
         scheduled_at = (m ->> 'scheduled_at')::timestamptz
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
  'Moves scheduled posts to new slots and inserts new scheduled posts, all or nothing. Security invoker: RLS decides whose. FILM-2210';

revoke all on function public.reschedule_publishes(jsonb, jsonb) from public, anon;
grant execute on function public.reschedule_publishes(jsonb, jsonb) to authenticated, service_role;
