-- Canon Management System Tables
-- Phase 10: FILM-1001 (Tables) + FILM-1002 (RLS Policies)
-- Enables persistent narrative continuity enforcement

-- =============================================================================
-- TABLE 1: immutable_events - Hard Canon Facts
-- Facts that CANNOT be contradicted. Generation will FAIL HARD if violated.
-- =============================================================================

create table if not exists public.immutable_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  
  -- Event classification
  event_type varchar(50) not null check (event_type in (
    'death',               -- Character permanently died
    'world_fact',          -- Established world truth (e.g., "magic doesn't exist")
    'relationship',        -- Permanent relationship state (e.g., "siblings")
    'timeline',            -- Fixed point in time (e.g., "war ended in 1945")
    'ability_loss',        -- Permanent removal of ability
    'location_destruction' -- Location permanently destroyed
  )),
  
  -- Unique key for conflict detection
  -- Format: "{entity}:{id}:{state}" e.g., "character:uuid:dead"
  event_key text not null,
  
  -- Provenance
  established_in uuid references public.episodes(id) not null,
  season integer not null,
  episode_number integer not null,
  
  -- Human-readable description for error messages
  description text not null,
  
  -- Additional structured data
  metadata jsonb default '{}',
  
  created_at timestamptz default now(),
  created_by uuid references auth.users,
  
  unique (project_id, event_key)
);

create index if not exists ix_immutable_events_project on public.immutable_events (project_id);
create index if not exists ix_immutable_events_type on public.immutable_events (project_id, event_type);

-- =============================================================================
-- TABLE 2: character_states - Append-Only State Log
-- Tracks all character state changes. Forward-only - reversals are violations.
-- =============================================================================

create table if not exists public.character_states (
  id uuid primary key default extensions.uuid_generate_v4(),
  
  -- Link to character asset
  character_id uuid references public.assets(id) on delete cascade not null,
  
  -- When established
  episode_id uuid references public.episodes(id) not null,
  
  -- State category
  state_type varchar(50) not null check (state_type in (
    'emotional',    -- Grief, happiness, anger, etc.
    'physical',     -- Health, injuries, appearance
    'relationship', -- Relationship to other characters
    'knowledge',    -- What the character knows/believes
    'ability',      -- Skills, powers, resources
    'location',     -- Current whereabouts
    'goal'          -- Current objective/motivation
  )),
  
  -- Structured state value
  state_value jsonb not null,
  
  -- REQUIRED: Authorization triplet
  trigger_event text not null,      -- What caused this change
  cost text,                         -- What was sacrificed (null for initial state)
  new_constraints text[],            -- What this change prevents
  
  -- Audit chain
  previous_state_id uuid references public.character_states(id),
  
  created_at timestamptz default now(),
  created_by uuid references auth.users
);

create index if not exists ix_character_states_lookup 
  on public.character_states (character_id, created_at desc);
create index if not exists ix_character_states_episode 
  on public.character_states (episode_id);
create index if not exists ix_character_states_type 
  on public.character_states (character_id, state_type);

-- =============================================================================
-- TABLE 3: world_states - Environment Tracking
-- Current state of locations and settings.
-- =============================================================================

create table if not exists public.world_states (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  episode_id uuid references public.episodes(id) not null,
  
  -- Location identifier
  location text not null,
  
  -- Temporal context
  time_period text,
  
  -- Narrative elements
  active_conflicts text[],
  atmosphere text,
  constraints text[],
  
  -- Structured environment data
  environment_data jsonb default '{}',
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists ix_world_states_project on public.world_states (project_id, episode_id);

-- =============================================================================
-- TABLE 4: narrative_threads - Plot Thread Lifecycle
-- Tracks setups and payoffs to prevent orphaned plot threads.
-- =============================================================================

create table if not exists public.narrative_threads (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  
  -- Thread identity
  thread_name text not null,
  thread_type varchar(50) default 'plot' check (thread_type in (
    'plot',       -- Main story arc
    'character',  -- Character growth arc
    'mystery',    -- Unanswered question
    'romantic',   -- Love interest arc
    'conflict',   -- Antagonist/obstacle arc
    'thematic'    -- Recurring theme
  )),
  
  -- Lifecycle status
  status varchar(20) default 'open' check (status in (
    'open',       -- Started, not resolved
    'progressed', -- Touched, not resolved
    'resolved',   -- Concluded
    'abandoned'   -- Dropped (flagged for review)
  )),
  
  -- Episode tracking
  opened_at uuid references public.episodes(id) not null,
  resolved_at uuid references public.episodes(id),
  episodes_touched uuid[] default '{}',
  
  -- Promise/payoff tracking
  promises text[] default '{}',
  payoffs text[] default '{}',
  
  description text,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists ix_narrative_threads_active 
  on public.narrative_threads (project_id, status) 
  where status not in ('resolved', 'abandoned');

-- =============================================================================
-- TABLE 5: state_deltas - Change Audit Log
-- Immutable log of all state changes per episode.
-- =============================================================================

create table if not exists public.state_deltas (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid references public.episodes(id) on delete cascade not null,
  
  entity_type varchar(50) not null check (entity_type in (
    'character', 'world', 'thread', 'immutable'
  )),
  entity_id uuid not null,
  
  before_state jsonb,
  after_state jsonb,
  change_reason text,
  scene_number integer,
  
  created_at timestamptz default now()
);

create index if not exists ix_state_deltas_episode on public.state_deltas (episode_id);

-- =============================================================================
-- TABLE 6: episode_summaries - Memory Context Cache
-- Pre-computed summaries for efficient context injection.
-- =============================================================================

create table if not exists public.episode_summaries (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid references public.episodes(id) on delete cascade not null unique,
  
  -- Summary content
  plot_summary text not null,
  key_events text[] default '{}',
  character_changes text[] default '{}',
  new_constraints text[] default '{}',
  
  -- SCORE framework
  sentiment_score decimal(3,2),
  
  -- Token tracking
  estimated_tokens integer,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================================================
-- RLS POLICIES (FILM-1002)
-- Project-based access control for all canon tables
-- =============================================================================

-- immutable_events: Full CRUD for project members
alter table public.immutable_events enable row level security;
grant select, insert, update, delete on table public.immutable_events to authenticated;

create policy "immutable_events_project_access" on public.immutable_events
  for all to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = immutable_events.project_id
      and public.has_role_on_account(p.account_id)
    )
  );

-- character_states: Append-only (no update/delete for audit integrity)
alter table public.character_states enable row level security;
grant select, insert on table public.character_states to authenticated;

create policy "character_states_read" on public.character_states
  for select to authenticated using (
    exists (
      select 1 from public.assets a
      join public.projects p on p.id = a.project_id
      where a.id = character_states.character_id
      and public.has_role_on_account(p.account_id)
    )
  );

create policy "character_states_insert" on public.character_states
  for insert to authenticated with check (
    exists (
      select 1 from public.assets a
      join public.projects p on p.id = a.project_id
      where a.id = character_states.character_id
      and public.has_role_on_account(p.account_id)
    )
  );

-- world_states: CRUD for project members
alter table public.world_states enable row level security;
grant select, insert, update on table public.world_states to authenticated;

create policy "world_states_project_access" on public.world_states
  for all to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = world_states.project_id
      and public.has_role_on_account(p.account_id)
    )
  );

-- narrative_threads: CRUD for project members
alter table public.narrative_threads enable row level security;
grant select, insert, update on table public.narrative_threads to authenticated;

create policy "narrative_threads_project_access" on public.narrative_threads
  for all to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = narrative_threads.project_id
      and public.has_role_on_account(p.account_id)
    )
  );

-- state_deltas: Append-only audit log
alter table public.state_deltas enable row level security;
grant select, insert on table public.state_deltas to authenticated;

create policy "state_deltas_read" on public.state_deltas
  for select to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = state_deltas.episode_id
      and public.has_role_on_account(p.account_id)
    )
  );

create policy "state_deltas_insert" on public.state_deltas
  for insert to authenticated with check (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = state_deltas.episode_id
      and public.has_role_on_account(p.account_id)
    )
  );

-- episode_summaries: CRUD for project members
alter table public.episode_summaries enable row level security;
grant select, insert, update on table public.episode_summaries to authenticated;

create policy "episode_summaries_access" on public.episode_summaries
  for all to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = episode_summaries.episode_id
      and public.has_role_on_account(p.account_id)
    )
  );
