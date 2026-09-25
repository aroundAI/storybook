-- ==================================
-- Compilations Schema
-- ==================================
-- Compilations are derived videos assembled from segments of existing episodes.

-- Compilation types
create type public.compilation_type as enum (
  'best_of',        -- Highlight reel
  'recap',          -- "Previously on..." recap
  'character_reel', -- Character-focused
  'top_moments',    -- Curated countdown
  'season_finale',  -- Season wrap-up compilation
  'custom'          -- Free-form
);

create table if not exists public.compilations (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  
  -- Metadata
  title varchar(500) not null,
  description text,
  compilation_type public.compilation_type not null default 'custom',
  
  -- Scope
  season_id uuid references public.seasons(id) on delete set null,  -- null = cross-season
  
  -- Output
  status varchar(50) not null default 'draft'
    check (status in ('draft', 'assembling', 'rendering', 'rendered', 'published', 'archived')),
  output_url text,           -- Final rendered video URL
  thumbnail_url text,
  duration_seconds integer,  -- Calculated total duration
  
  -- Chapter markers for YouTube Chapters
  chapters jsonb not null default '[]'::jsonb,
  -- Format: [{"title": "Chapter Name", "start_seconds": 0}, ...]
  
  metadata jsonb not null default '{}'::jsonb,
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

comment on table public.compilations is 'Compilations of segments from existing episodes';
comment on column public.compilations.compilation_type is 'Type of compilation: best_of, recap, character_reel, top_moments, season_finale, custom';

create table if not exists public.compilation_segments (
  id uuid primary key default extensions.uuid_generate_v4(),
  compilation_id uuid not null references public.compilations(id) on delete cascade,
  
  -- Source reference
  source_episode_id uuid not null references public.episodes(id) on delete cascade,
  source_shot_id uuid references public.shots(id) on delete set null,
  
  -- Segment metadata
  title varchar(500),         -- Optional label (e.g., "Best moment from Ep 3")
  sequence_number integer not null,  -- Order within the compilation
  
  -- Trim points (seconds within the source shot/episode video)
  start_seconds decimal(10,3) not null default 0,
  end_seconds decimal(10,3),  -- null = use full duration
  duration_seconds decimal(10,3),
  
  -- Source media (resolved URL for the segment)
  media_url text,
  thumbnail_url text,
  
  -- Transitions
  transition_type varchar(50) default 'cut'
    check (transition_type in ('cut', 'crossfade', 'fade_black', 'fade_white', 'dissolve')),
  transition_duration_ms integer default 0,
  
  -- Chapter marker
  is_chapter_start boolean default false,
  chapter_title varchar(200),
  
  metadata jsonb not null default '{}'::jsonb,
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

comment on table public.compilation_segments is 'Segments comprising a compilation';

-- Indexes
create index if not exists idx_compilations_project on public.compilations(project_id);
create index if not exists idx_compilations_account on public.compilations(account_id);
create index if not exists idx_compilation_segments_compilation on public.compilation_segments(compilation_id);
create index if not exists idx_compilation_segments_source_episode on public.compilation_segments(source_episode_id);
create index if not exists idx_compilation_segments_source_shot on public.compilation_segments(source_shot_id);
create index if not exists idx_compilation_segments_seq on public.compilation_segments(compilation_id, sequence_number);

-- Timestamps triggers
create trigger compilations_set_timestamps
before insert or update on public.compilations
for each row execute function public.trigger_set_timestamps();

create trigger compilation_segments_set_timestamps
before insert or update on public.compilation_segments
for each row execute function public.trigger_set_timestamps();

-- RLS Policies
alter table public.compilations enable row level security;
alter table public.compilation_segments enable row level security;

-- compilations
create policy "compilations_read" on public.compilations for select
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = compilations.project_id
      and pm.user_id = auth.uid()
    )
  );

create policy "compilations_create" on public.compilations for insert
  to authenticated with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = compilations.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "compilations_update" on public.compilations for update
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = compilations.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "compilations_delete" on public.compilations for delete
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = compilations.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- compilation_segments
create policy "compilation_segments_read" on public.compilation_segments for select
  to authenticated using (
    exists (
      select 1 from public.compilations c
      join public.project_members pm on pm.project_id = c.project_id
      where c.id = compilation_segments.compilation_id
      and pm.user_id = auth.uid()
    )
  );

create policy "compilation_segments_create" on public.compilation_segments for insert
  to authenticated with check (
    exists (
      select 1 from public.compilations c
      join public.project_members pm on pm.project_id = c.project_id
      where c.id = compilation_segments.compilation_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "compilation_segments_update" on public.compilation_segments for update
  to authenticated using (
    exists (
      select 1 from public.compilations c
      join public.project_members pm on pm.project_id = c.project_id
      where c.id = compilation_segments.compilation_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "compilation_segments_delete" on public.compilation_segments for delete
  to authenticated using (
    exists (
      select 1 from public.compilations c
      join public.project_members pm on pm.project_id = c.project_id
      where c.id = compilation_segments.compilation_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- Grants
revoke all on public.compilations from public, anon;
grant select, insert, update, delete on public.compilations to authenticated;

revoke all on public.compilation_segments from public, anon;
grant select, insert, update, delete on public.compilation_segments to authenticated;
