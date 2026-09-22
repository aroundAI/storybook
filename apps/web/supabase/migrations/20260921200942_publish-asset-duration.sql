-- ==================================
-- The published asset's duration (FILM-1710)
-- ==================================
-- ClickHouse `video_dim.duration_seconds` was filled from the *episode* —
-- its duration, then its target duration, then 0 — so a 45-second Short cut
-- from a 22-minute episode read as ~1,320 seconds. There was nowhere to put
-- the right number: a publish did not record its own length.
--
-- Nullable, with no default, and that is the point. Null is
-- `duration_unknown`: the state of every existing row until the provider has
-- been asked, and the permanent state of every Instagram row, because Meta's
-- IG Media node has no duration field. Adding it is metadata-only, so the
-- table is not rewritten.
--
-- Whole seconds as the platform reports them (YouTube
-- `contentDetails.duration`, TikTok `duration`). Strictly positive: 0 is how
-- "unknown" used to be spelled, and the check keeps it from coming back.

alter table public.publishes
  add column if not exists duration_seconds integer;

alter table public.publishes
  add constraint publishes_duration_seconds_positive_check
  check (duration_seconds > 0);

comment on column public.publishes.duration_seconds is
  'Published asset duration in whole seconds, as the platform reports it. Null = duration_unknown. Written only by the analytics asset-duration sync (service role); never the episode''s duration';

-- ----------------------------------
-- One writer
-- ----------------------------------
-- `publishes_update` lets a project member update any column, and
-- `publishes_create` any column on insert, so without this the new column is
-- writable from a browser session. It is a measurement taken from the
-- platform, and the sync (service role) is its only writer — the same
-- "single writer" rule the spec sets, held by the table rather than by
-- convention.
--
-- Kept, not refused: a member's update that happens to carry the column —
-- a whole-row write-back — still succeeds with the value unchanged, exactly
-- as `keep_experiment_creator` treats `created_by`.
--
-- Only an end-user session is held back, identified by the Postgres role
-- PostgREST switches to (`authenticated`, `anon`) — so the admin client
-- (`service_role`) and migrations, seeds and psql (`postgres`) keep write
-- access. `current_user`, not `auth.role()`: the JWT claim is what a first
-- draft read, and the pgTAP run showed a member's write going straight
-- through, because a session can hold the role without carrying the claim.
-- The role is what the grants and policies key on, so it is what this keys
-- on. That only holds while the function stays SECURITY INVOKER — as a
-- definer, `current_user` would be the owner and the guard would never fire.

create or replace function public.keep_publish_asset_duration()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.duration_seconds = null;
  else
    new.duration_seconds = old.duration_seconds;
  end if;

  return new;
end;
$$;

create trigger publishes_keep_asset_duration
  before insert or update of duration_seconds on public.publishes
  for each row execute function public.keep_publish_asset_duration();
