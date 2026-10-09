-- FILM-2201: Flexible Production foundations (EDD specs/plans/FILM-2201-flexible-production-edd.md §10).
--
-- Seasons become first-class (created empty, reordered, deleted without
-- losing their episodes), and an episode records how it started and which
-- stages its author skipped. No policy changes: both functions run as
-- the caller, so the existing seasons and episodes policies decide.

-- Seasons: a cover, and optimistic locking like episodes.version
alter table public.seasons
  add column cover_url text,
  add column version integer not null default 1;

comment on column public.seasons.version is
  'FILM-2201: optimistic lock; a write passes the version it read and bumps it';

-- Episodes: how the episode started, and the stages its author skipped
alter table public.episodes
  add column entry_mode text not null default 'idea'
    constraint episodes_entry_mode_check
    check (entry_mode in ('idea', 'script', 'video')),
  add column skipped_stages text[] not null default '{}'
    constraint episodes_skipped_stages_check
    check (skipped_stages <@ array['ideation', 'story', 'screenplay', 'shots', 'audio']::text[]);

comment on column public.episodes.entry_mode is
  'FILM-2201: how the episode started: from an idea, a script or a finished video';
comment on column public.episodes.skipped_stages is
  'FILM-2201: stages the author chose not to do; writing to a stage un-skips it';

-- Reorders a project's live seasons to the order given, numbered 1..n.
-- Live numbers are unique (seasons_project_id_number_active_idx), so the
-- seasons first move clear of 1..n, then take their places. The caller must
-- be allowed to update every one of them (seasons_update).
create or replace function public.reorder_seasons(
  p_project_id uuid,
  p_season_ids uuid[]
)
returns setof public.seasons
language plpgsql
security invoker
set search_path = ''
as $$
declare
  live_ids uuid[];
  moved integer;
begin
  select coalesce(array_agg(s.id order by s.id), '{}')
    into live_ids
    from public.seasons s
   where s.project_id = p_project_id
     and s.deleted_at is null;

  if cardinality(p_season_ids) <> cardinality(live_ids)
     or (select count(distinct id) from unnest(p_season_ids) as id) <> cardinality(live_ids)
     or not (p_season_ids <@ live_ids) then
    raise exception 'Give every season of the project exactly once.'
      using errcode = '22023';
  end if;

  update public.seasons s
     set number = s.number + 100000
   where s.project_id = p_project_id
     and s.deleted_at is null;

  get diagnostics moved = row_count;

  if moved <> cardinality(live_ids) then
    raise exception 'You cannot reorder this project''s seasons.'
      using errcode = '42501';
  end if;

  update public.seasons s
     set number = ordered.position,
         version = s.version + 1
    from unnest(p_season_ids) with ordinality as ordered(id, position)
   where s.id = ordered.id;

  return query
    select s.*
      from public.seasons s
     where s.project_id = p_project_id
       and s.deleted_at is null
     order by s.number;
end;
$$;

-- Soft-deletes a season at the version the caller read, and moves its live
-- episodes to no season (Unsorted). Returns how many episodes moved. Nothing
-- of the episodes is deleted.
create or replace function public.soft_delete_season(
  p_season_id uuid,
  p_version integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_version integer;
  moved integer;
begin
  select s.version
    into current_version
    from public.seasons s
   where s.id = p_season_id
     and s.deleted_at is null;

  if not found then
    raise exception 'Season not found.' using errcode = 'P0002';
  end if;

  if current_version <> p_version then
    raise exception 'The season changed since it was read.' using errcode = '40001';
  end if;

  update public.seasons s
     set deleted_at = now(),
         version = s.version + 1
   where s.id = p_season_id
     and s.version = p_version
     and s.deleted_at is null;

  if not found then
    raise exception 'You cannot delete this season.' using errcode = '42501';
  end if;

  update public.episodes e
     set season_id = null
   where e.season_id = p_season_id
     and e.deleted_at is null;

  get diagnostics moved = row_count;

  return moved;
end;
$$;

revoke all on function public.reorder_seasons(uuid, uuid[]) from public, anon;
revoke all on function public.soft_delete_season(uuid, integer) from public, anon;
grant execute on function public.reorder_seasons(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.soft_delete_season(uuid, integer) to authenticated, service_role;
