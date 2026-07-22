-- ==================================
-- Compilations Schema & Migration
-- ==================================

-- 1. Create Compilation Types and Tables
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
  
  title varchar(500) not null,
  description text,
  compilation_type public.compilation_type not null default 'custom',
  
  season_id uuid references public.seasons(id) on delete set null,
  
  status varchar(50) not null default 'draft'
    check (status in ('draft', 'assembling', 'rendering', 'rendered', 'published', 'archived')),
  output_url text,
  thumbnail_url text,
  duration_seconds integer,
  
  edit_project_id uuid references public.edit_projects(id) on delete set null,
  chapters jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

comment on table public.compilations is 'Compilations of segments from existing episodes';
comment on column public.compilations.compilation_type is 'Type of compilation: best_of, recap, character_reel, top_moments, season_finale, custom';

create table if not exists public.compilation_segments (
  id uuid primary key default extensions.uuid_generate_v4(),
  compilation_id uuid not null references public.compilations(id) on delete cascade,
  
  source_episode_id uuid not null references public.episodes(id) on delete cascade,
  source_shot_id uuid references public.shots(id) on delete set null,
  
  title varchar(500),
  sequence_number integer not null,
  
  start_seconds decimal(10,3) not null default 0,
  end_seconds decimal(10,3),
  duration_seconds decimal(10,3),
  
  media_url text,
  thumbnail_url text,
  
  transition_type varchar(50) default 'cut'
    check (transition_type in ('cut', 'crossfade', 'fade_black', 'fade_white', 'dissolve')),
  transition_duration_ms integer default 0,
  
  is_chapter_start boolean default false,
  chapter_title varchar(200),
  
  metadata jsonb not null default '{}'::jsonb,
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

comment on table public.compilation_segments is 'Segments comprising a compilation';

create index if not exists idx_compilations_project on public.compilations(project_id);
create index if not exists idx_compilations_account on public.compilations(account_id);
create index if not exists idx_compilation_segments_compilation on public.compilation_segments(compilation_id);
create index if not exists idx_compilation_segments_source_episode on public.compilation_segments(source_episode_id);
create index if not exists idx_compilation_segments_source_shot on public.compilation_segments(source_shot_id);
create index if not exists idx_compilation_segments_seq on public.compilation_segments(compilation_id, sequence_number);

create trigger compilations_set_timestamps
before insert or update on public.compilations
for each row execute function public.trigger_set_timestamps();

create trigger compilation_segments_set_timestamps
before insert or update on public.compilation_segments
for each row execute function public.trigger_set_timestamps();

alter table public.compilations enable row level security;
alter table public.compilation_segments enable row level security;

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

revoke all on public.compilations from public, anon;
grant select, insert, update, delete on public.compilations to authenticated;

revoke all on public.compilation_segments from public, anon;
grant select, insert, update, delete on public.compilation_segments to authenticated;

-- 2. Modify Edit Projects for Compilations
ALTER TABLE public.edit_projects ALTER COLUMN episode_id DROP NOT NULL;
ALTER TABLE public.edit_projects ADD COLUMN compilation_id uuid REFERENCES public.compilations(id) ON DELETE CASCADE;
ALTER TABLE public.edit_projects DROP CONSTRAINT IF EXISTS edit_projects_episode_id_key;
ALTER TABLE public.edit_projects ADD CONSTRAINT edit_projects_episode_id_key UNIQUE(episode_id);
ALTER TABLE public.edit_projects ADD CONSTRAINT edit_projects_compilation_id_key UNIQUE(compilation_id);
ALTER TABLE public.edit_projects ADD CONSTRAINT edit_projects_source_check CHECK ((episode_id IS NOT NULL AND compilation_id IS NULL) OR (episode_id IS NULL AND compilation_id IS NOT NULL));
