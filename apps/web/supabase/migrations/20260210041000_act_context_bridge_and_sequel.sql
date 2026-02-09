-- Act Context Bridge & Sequel Linking System
-- FILM-1112: Act context bridges for movie continuity
-- FILM-1113: Sequel parent context caching + sequel_of column

-- =============================================================================
-- TABLE 1: act_context_bridges - Act-End State Snapshots
-- Captures complete narrative state at end of each movie act for continuity.
-- =============================================================================

create table if not exists public.act_context_bridges (
  id uuid primary key default extensions.uuid_generate_v4(),

  -- Link to movie (episode with short-film project type)
  episode_id uuid references public.episodes(id) on delete cascade not null,

  -- Act identification
  act_number integer not null check (act_number >= 1 and act_number <= 5),
  act_title text not null,

  -- Timing
  act_start_time integer not null default 0,
  act_end_time integer not null default 0,

  -- Full context state (JSONB for flexibility)
  context_state jsonb not null default '{}',

  -- Text summary for LLM injection
  carry_forward_text text not null default '',

  -- Metadata
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Unique per act per movie
  unique (episode_id, act_number)
);

create index if not exists ix_act_bridges_episode
  on public.act_context_bridges(episode_id);

-- Timestamps trigger
create trigger act_context_bridges_set_timestamps
before insert or update on public.act_context_bridges
for each row execute function public.trigger_set_timestamps();

-- RLS
alter table public.act_context_bridges enable row level security;
grant select, insert, update, delete on table public.act_context_bridges to authenticated;

create policy "act_context_bridges_project_access" on public.act_context_bridges
  for all to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = act_context_bridges.episode_id
      and public.has_role_on_account(p.account_id)
    )
  );

-- =============================================================================
-- TABLE 2: sequel_parent_contexts - Cached Parent Canon for Sequels
-- Stores pre-computed parent movie canon for efficient sequel generation.
-- =============================================================================

create table if not exists public.sequel_parent_contexts (
  id uuid primary key default extensions.uuid_generate_v4(),

  -- The sequel project
  sequel_project_id uuid references public.projects(id) on delete cascade not null,

  -- Parent project
  parent_project_id uuid references public.projects(id) on delete cascade not null,

  -- Cached parent canon
  parent_summary text not null default '',
  parent_immutable_events jsonb not null default '[]',
  parent_final_character_states jsonb not null default '{}',
  parent_resolved_threads jsonb not null default '[]',
  parent_world_facts jsonb not null default '[]',

  -- Visual continuity references
  character_visual_registry jsonb not null default '{}',
  location_registry jsonb not null default '[]',

  -- Cache metadata
  cached_at timestamptz default now(),
  parent_last_updated timestamptz,
  is_stale boolean default false,

  unique (sequel_project_id, parent_project_id)
);

create index if not exists ix_sequel_contexts_sequel
  on public.sequel_parent_contexts(sequel_project_id);

-- RLS
alter table public.sequel_parent_contexts enable row level security;
grant select, insert, update, delete on table public.sequel_parent_contexts to authenticated;

create policy "sequel_parent_contexts_project_access" on public.sequel_parent_contexts
  for all to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = sequel_parent_contexts.sequel_project_id
      and public.has_role_on_account(p.account_id)
    )
  );

-- =============================================================================
-- COLUMN: sequel_of on projects
-- Array of parent project UUIDs for sequel linking.
-- =============================================================================

alter table public.projects
  add column if not exists sequel_of uuid[] default '{}';
