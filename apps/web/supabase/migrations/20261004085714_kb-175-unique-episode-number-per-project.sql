-- KB-175: two live episodes of one project could carry the same number.
-- The create code has long assumed a constraint that never existed.
--
-- Existing duplicates are resolved first, deterministically: within a
-- project and number the oldest live episode (created_at, then id) keeps its
-- number; each later one takes the next free number above the project's
-- highest live number, in that same order. Slugs are left alone, so every
-- URL keeps working and the slug index stays unique. Only live rows count:
-- a soft-deleted episode frees its number.
with ranked as (
  select
    id,
    project_id,
    number,
    row_number() over (
      partition by project_id, number
      order by created_at, id
    ) as rank_in_number
  from public.episodes
  where deleted_at is null
),
later as (
  select
    id,
    project_id,
    row_number() over (
      partition by project_id
      order by number, rank_in_number, id
    ) as seq
  from ranked
  where rank_in_number > 1
),
top as (
  select project_id, max(number) as top_number
  from public.episodes
  where deleted_at is null
  group by project_id
)
update public.episodes e
set number = top.top_number + later.seq
from later
join top on top.project_id = later.project_id
where e.id = later.id;

-- 20260528163000_performance_indexes.sql made a plain index of this name
drop index if exists public.idx_episodes_project_number;

create unique index idx_episodes_project_number
  on public.episodes (project_id, number)
  where deleted_at is null;

comment on index public.idx_episodes_project_number is
  'KB-175: an episode number is unique per project among live episodes';
