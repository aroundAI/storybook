-- ==================================
-- Add missing columns to shots table
-- ==================================
-- FILM-303/307 implementation requires additional columns:
-- - scene_number: Which scene this shot belongs to
-- - shot_number: Shot number within the scene
-- - deleted_at: Soft delete support (consistent with episodes table)

-- Add scene_number column (optional, as shots may be generated without scene info)
alter table public.shots
add column if not exists scene_number integer;

-- Add shot_number column (optional, shot within scene)
alter table public.shots
add column if not exists shot_number integer;

-- Add deleted_at column for soft delete (consistent with episodes table pattern)
alter table public.shots
add column if not exists deleted_at timestamp with time zone default null;

-- Add comment for new columns
comment on column public.shots.scene_number is 'Scene number this shot belongs to';
comment on column public.shots.shot_number is 'Shot number within the scene';
comment on column public.shots.deleted_at is 'Soft delete timestamp';

-- Create index for soft delete queries
create index if not exists idx_shots_deleted_at on public.shots(deleted_at)
  where deleted_at is not null;

-- Update existing index to filter by deleted_at
drop index if exists idx_shots_episode_sequence;
create index if not exists idx_shots_episode_sequence on public.shots(episode_id, sequence_number)
  where deleted_at is null;
