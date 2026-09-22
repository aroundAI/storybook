---
id: FILM-1001
title: Canon Management Database Tables
status: 🟡 PARTIAL
audited: 2026-09-23
priority: high
effort: L
dependencies: [FILM-101]
---

# FILM-1001: Canon Management Database Tables

## Overview

Database schema for persistent canon state management. This is the foundation layer that enables all continuity enforcement.

## Problem Statement

Current system stores story data as unstructured JSONB but has no:
- Persistent tracking of established narrative facts
- Character state history across episodes
- Plot thread lifecycle management
- Change authorization audit trail

## Solution

Six new tables providing structured canon storage with append-only patterns for audit compliance.

---

## Database Schema

### 1. `immutable_events` - Hard Canon

Events that **CANNOT** be contradicted. Generation will **FAIL HARD** if violated.

```sql
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
  -- Examples:
  -- { "character_id": "uuid", "cause_of_death": "battle", "witnesses": ["uuid1"] }
  -- { "world_rule": "no_magic", "exceptions": [] }
  
  created_at timestamptz default now(),
  created_by uuid references auth.users,
  
  unique (project_id, event_key)
);

-- Indexes
create index ix_immutable_events_project on public.immutable_events (project_id);
create index ix_immutable_events_type on public.immutable_events (project_id, event_type);
```

**Usage Examples:**

| Event Type | Event Key | Description |
|------------|-----------|-------------|
| death | `character:abc123:dead` | John Smith died in battle |
| world_fact | `world:magic:disabled` | This world has no magic |
| relationship | `relationship:abc:def:siblings` | Characters are siblings |
| timeline | `timeline:war:ended:1945` | The war ended in 1945 |

---

### 2. `character_states` - Append-Only State Log

Tracks all character state changes. **Forward-only** - reversals are violations.

```sql
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
  -- Examples:
  -- emotional: { "state": "grieving", "intensity": 8, "cause": "father_death", "duration": "ongoing" }
  -- relationship: { "target_id": "uuid", "type": "romantic", "status": "together", "trust": 9 }
  -- knowledge: { "fact": "knows about the secret", "source": "overheard", "confidence": "certain" }
  
  -- REQUIRED: Authorization triplet
  trigger_event text not null,      -- What caused this change
  cost text,                         -- What was sacrificed (null for initial state)
  new_constraints text[],            -- What this change prevents
  
  -- Audit chain
  previous_state_id uuid references public.character_states(id),
  
  created_at timestamptz default now(),
  created_by uuid references auth.users
);

-- Performance indexes
create index ix_character_states_lookup 
  on public.character_states (character_id, created_at desc);
create index ix_character_states_episode 
  on public.character_states (episode_id);
create index ix_character_states_type 
  on public.character_states (character_id, state_type);
```

**State Evolution Example:**

```
Episode 1: John is "optimistic" (emotional)
  trigger: "story opening"
  cost: null
  constraints: []

Episode 3: John is "grieving" (emotional)
  trigger: "father's death in battle"
  cost: "lost innocence"
  constraints: ["cannot be carefree", "must seek meaning"]

Episode 7: John is "determined" (emotional)
  trigger: "found purpose in protecting others"
  cost: "gave up personal happiness"
  constraints: ["cannot abandon mission", "prioritizes duty"]
```

---

### 3. `world_states` - Environment Tracking

Current state of locations and settings.

```sql
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
  -- Example: { "weather": "storm", "time_of_day": "night", "population": "evacuated" }
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index ix_world_states_project on public.world_states (project_id, episode_id);
```

---

### 4. `narrative_threads` - Plot Thread Lifecycle

Tracks setups and payoffs to prevent orphaned plot threads.

```sql
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

create index ix_narrative_threads_active 
  on public.narrative_threads (project_id, status) 
  where status not in ('resolved', 'abandoned');
```

**Thread Integrity Rules:**
- Every `promise` should eventually have a corresponding `payoff`
- Threads cannot be `resolved` without at least one `payoff`
- `abandoned` threads trigger warnings

---

### 5. `state_deltas` - Change Audit Log

Immutable log of all state changes per episode.

```sql
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

create index ix_state_deltas_episode on public.state_deltas (episode_id);
```

---

### 6. `episode_summaries` - Memory Context Cache

Pre-computed summaries for efficient context injection.

```sql
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
```

---

## RLS Policies

All tables use project-based access control:

```sql
-- Example policy (applied to all tables)
create policy "canon_access" on public.immutable_events
  for all to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = immutable_events.project_id
      and public.has_role_on_account(p.account_id)
    )
  );
```

---

## Migration File

**Location**: `apps/web/supabase/migrations/YYYYMMDDHHMMSS_canon-management-tables.sql`

---

## Algorithms

### Algorithm 1: Event Key Generation

**Problem**: Need unique, deterministic identifiers for canon events to detect conflicts.

**Solution**: Structured key format that encodes entity type, ID, and state.

```
EVENT_KEY := <entity_type>:<entity_id>:<state>

Where:
  entity_type ∈ {character, world, relationship, timeline, location, ability}
  entity_id   := UUID or semantic identifier
  state       := normalized state string (lowercase, underscore-separated)
```

**Algorithm (Pseudocode)**:

```python
def generate_event_key(event: ImmutableEvent) -> str:
    """
    Generate unique event key for conflict detection.
    
    Time Complexity: O(1)
    Space Complexity: O(1)
    """
    match event.event_type:
        case 'death':
            # character:<uuid>:dead
            return f"character:{event.metadata['character_id']}:dead"
        
        case 'world_fact':
            # world:<rule_name>:<value>
            rule = normalize(event.metadata['world_rule'])
            value = normalize(event.metadata['value'])
            return f"world:{rule}:{value}"
        
        case 'relationship':
            # relationship:<id1>:<id2>:<type> (sorted to avoid duplicates)
            ids = sorted([event.metadata['char1_id'], event.metadata['char2_id']])
            rel_type = normalize(event.metadata['relationship_type'])
            return f"relationship:{ids[0]}:{ids[1]}:{rel_type}"
        
        case 'timeline':
            # timeline:<event_name>:<date_or_marker>
            name = normalize(event.metadata['event_name'])
            marker = normalize(event.metadata['time_marker'])
            return f"timeline:{name}:{marker}"
        
        case 'ability_loss':
            # ability:<character_id>:<ability_name>:lost
            char_id = event.metadata['character_id']
            ability = normalize(event.metadata['ability'])
            return f"ability:{char_id}:{ability}:lost"
        
        case 'location_destruction':
            # location:<location_id>:destroyed
            return f"location:{event.metadata['location_id']}:destroyed"

def normalize(s: str) -> str:
    """Lowercase, replace spaces with underscores, strip special chars."""
    return s.lower().replace(' ', '_').strip()
```

**Examples**:

| Event | Generated Key |
|-------|---------------|
| John Smith dies | `character:550e8400-e29b-41d4-a716-446655440000:dead` |
| Magic is disabled | `world:magic:disabled` |
| Alice and Bob are siblings | `relationship:alice-uuid:bob-uuid:siblings` |
| The war ended in 1945 | `timeline:great_war:ended_1945` |
| Hero loses flight | `ability:hero-uuid:flight:lost` |
| Castle is destroyed | `location:castle-uuid:destroyed` |

---

### Algorithm 2: Conflict Detection

**Problem**: Detect when proposed content contradicts established immutable events.

**Solution**: Key-based matching with semantic conflict rules.

```python
def detect_conflicts(
    proposed_events: List[ProposedEvent],
    existing_events: List[ImmutableEvent]
) -> List[Conflict]:
    """
    Detect conflicts between proposed and existing canon.
    
    Time Complexity: O(n × m) where n=proposed, m=existing
    Space Complexity: O(k) where k=conflicts found
    
    Note: For large canon (>1000 events), consider indexing by entity_type
    """
    conflicts = []
    existing_keys = {e.event_key: e for e in existing_events}
    
    for proposed in proposed_events:
        proposed_key = generate_event_key(proposed)
        
        # Direct key conflict (same key, different value)
        if proposed_key in existing_keys:
            conflicts.append(Conflict(
                type='direct_duplicate',
                proposed=proposed,
                existing=existing_keys[proposed_key],
                severity='critical'
            ))
            continue
        
        # Semantic conflicts (contradictory states)
        semantic_conflict = check_semantic_conflict(proposed_key, existing_keys)
        if semantic_conflict:
            conflicts.append(semantic_conflict)
    
    return conflicts

def check_semantic_conflict(proposed_key: str, existing_keys: Dict) -> Optional[Conflict]:
    """
    Check for semantically contradictory events.
    
    Examples of semantic conflicts:
    - "character:X:dead" vs "character:X:alive" 
    - "world:magic:enabled" vs "world:magic:disabled"
    - "ability:X:flight:lost" vs "ability:X:flight:gained"
    """
    parts = proposed_key.split(':')
    entity_type = parts[0]
    
    if entity_type == 'character':
        char_id = parts[1]
        proposed_state = parts[2]
        
        # Check for contradictory states
        contradictions = {
            'alive': 'dead',
            'dead': 'alive',
        }
        
        if proposed_state in contradictions:
            conflicting_key = f"character:{char_id}:{contradictions[proposed_state]}"
            if conflicting_key in existing_keys:
                return Conflict(
                    type='resurrection',
                    proposed_key=proposed_key,
                    existing_key=conflicting_key,
                    severity='critical',
                    message=f"Cannot resurrect dead character"
                )
    
    # Similar checks for other entity types...
    return None
```

**Conflict Types**:

| Type | Severity | Example | Resolution |
|------|----------|---------|------------|
| `direct_duplicate` | Critical | Same event key exists | Automatic block |
| `resurrection` | Critical | Dead character appears alive | Manual rewrite required |
| `state_contradiction` | Hard | World rule contradicted | Manual rewrite required |
| `timeline_paradox` | Hard | Event order violated | Adjust timeline |

---

### Algorithm 3: Append-Only Insertion Pattern

**Problem**: Ensure audit trail integrity by preventing modification of historical data.

**Solution**: Database + application layer enforcement.

```sql
-- Database layer: No UPDATE or DELETE grants
grant select, insert on table public.character_states to authenticated;
-- Note: No 'update' or 'delete' in grant

-- Application layer: Validate no updates attempted
```

```python
def insert_character_state(state: CharacterStateInput) -> CharacterState:
    """
    Insert new character state (append-only pattern).
    
    Invariants:
    1. previous_state_id must reference most recent state for this character
    2. created_at must be >= previous state's created_at
    3. episode_id must be >= previous state's episode (chronologically)
    """
    
    # Get most recent state for this character
    previous = get_latest_state(state.character_id)
    
    if previous:
        # Validate chronological order
        if state.episode_number < previous.episode_number:
            raise ValidationError(
                "Cannot insert state for earlier episode than most recent state"
            )
        
        # Link to previous
        state.previous_state_id = previous.id
    
    # Insert (database prevents update/delete)
    return db.insert('character_states', state)
```

**Audit Trail Reconstruction**:

```python
def get_character_history(character_id: str) -> List[CharacterState]:
    """
    Reconstruct complete character state history using linked list.
    
    Time Complexity: O(n) where n = number of states
    """
    states = []
    current = get_latest_state(character_id)
    
    while current:
        states.append(current)
        current = get_state_by_id(current.previous_state_id)
    
    return list(reversed(states))  # Chronological order
```

---

### Algorithm 4: State Transition Validation

**Problem**: Ensure character development moves forward, not backward.

**Solution**: State ordering and reversal detection.

```python
# Define state ordering for each state type
STATE_ORDERING = {
    'emotional': {
        # Higher index = further along growth arc
        'naive': 0,
        'optimistic': 1,
        'questioning': 2,
        'grieving': 3,
        'bitter': 4,
        'accepting': 5,
        'determined': 6,
        'wise': 7,
    },
    'physical': {
        'healthy': 0,
        'injured': 1,
        'recovering': 2,
        'scarred': 3,
        'disabled': 4,
    }
}

def validate_state_transition(
    previous: CharacterState,
    proposed: CharacterState
) -> ValidationResult:
    """
    Validate that state transition moves forward.
    
    Rules:
    1. Can move to higher index (forward progress)
    2. Can move laterally at same index (same complexity)
    3. Cannot move to lower index (regression) without explicit override
    """
    if previous.state_type != proposed.state_type:
        # Different state types - always allowed
        return ValidationResult(valid=True)
    
    prev_state = previous.state_value.get('state')
    prop_state = proposed.state_value.get('state')
    
    ordering = STATE_ORDERING.get(previous.state_type, {})
    
    prev_index = ordering.get(prev_state, -1)
    prop_index = ordering.get(prop_state, -1)
    
    if prev_index == -1 or prop_index == -1:
        # Unknown states - allow with warning
        return ValidationResult(valid=True, warnings=['Unknown state values'])
    
    if prop_index < prev_index:
        # Regression detected
        return ValidationResult(
            valid=False,
            error=f"State regression: '{prev_state}'→'{prop_state}' moves backward",
            suggestion=f"Consider states at or above '{prev_state}' level"
        )
    
    return ValidationResult(valid=True)
```

**Regression Examples**:

| Previous | Proposed | Valid? | Reason |
|----------|----------|--------|--------|
| grieving | optimistic | ❌ | Regression (index 3→1) |
| grieving | determined | ✅ | Forward (index 3→6) |
| bitter | bitter | ✅ | Same level |
| injured | healthy | ❌ | Regression (needs recovery arc) |
| injured → recovering → healthy | ✅ | Proper progression |

---

### Edge Case Handling

| Edge Case | Handling | Database Constraint |
|-----------|----------|---------------------|
| Duplicate event_key | Reject insert | `unique (project_id, event_key)` |
| Null event_key | Reject | `event_key text not null` |
| Self-referencing previous_state_id | Reject | Application validation |
| Circular state references | Reject | Application validation |
| Orphaned character states | Allow | FK allows null previous_state_id |
| Delete cascade on project | Yes | `on delete cascade` |
| Delete cascade on episode | Yes | `on delete cascade` |
| Invalid event_type | Reject | `check (event_type in (...))` |
| Negative season/episode | Accept | No constraint (future: add) |
| Empty metadata | Accept | `default '{}'` |
| Missing trigger_event | Reject (char_states) | `trigger_event text not null` |
| Empty constraints array | Accept | `text[] default null` |

---

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CANON MANAGEMENT ER                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐       ┌─────────────┐       ┌─────────────────────┐
│  projects   │◄──────│ immutable_  │       │   character_states  │
│             │   1:n │   events    │       │                     │
│ id (PK)     │       │             │       │ id (PK)             │
│ account_id  │       │ id (PK)     │       │ character_id (FK)───┼────►[assets]
│ metadata    │       │ project_id  │       │ episode_id (FK)─────┼────►[episodes]
└──────┬──────┘       │ event_key   │       │ previous_state_id───┼──┐
       │              │ event_type  │       │ state_type          │  │
       │              │ description │       │ state_value (jsonb) │  │
       │              └─────────────┘       │ trigger_event       │  │
       │                                    │ cost                │  │
       │                                    │ new_constraints[]   │  │
       │                                    └─────────────────────┘  │
       │                                              │               │
       │                                              └───────────────┘
       │                                                (self-ref)
       │
       ├──────────┐       ┌─────────────────────┐
       │          └──────►│   world_states      │
       │              1:n │                     │
       │                  │ id (PK)             │
       │                  │ project_id (FK)     │
       │                  │ episode_id (FK)─────┼────►[episodes]
       │                  │ location            │
       │                  │ environment_data    │
       │                  └─────────────────────┘
       │
       ├──────────┐       ┌─────────────────────┐
       │          └──────►│  narrative_threads  │
       │              1:n │                     │
       │                  │ id (PK)             │
       │                  │ project_id (FK)     │
       │                  │ thread_name         │
       │                  │ status              │
       │                  │ opened_at (FK)──────┼────►[episodes]
       │                  │ resolved_at (FK)────┼────►[episodes]
       │                  │ promises[]          │
       │                  │ payoffs[]           │
       │                  └─────────────────────┘
       │
       │          ┌───────────────────────────────────────┐
       │          │             [episodes]                 │
       │          │                  │                     │
       │          │                  ▼                     │
       │          │       ┌─────────────────────┐         │
       │          └──────►│   state_deltas      │         │
       │              1:n │                     │         │
       │                  │ id (PK)             │         │
       │                  │ episode_id (FK)     │         │
       │                  │ entity_type         │         │
       │                  │ entity_id           │         │
       │                  │ before_state        │         │
       │                  │ after_state         │         │
       │                  └─────────────────────┘         │
       │                                                   │
       │                  ┌─────────────────────┐         │
       │                  │  episode_summaries  │◄────────┘
       │                  │                     │     1:1
       │                  │ id (PK)             │
       │                  │ episode_id (FK,UQ)  │
       │                  │ plot_summary        │
       │                  │ sentiment_score     │
       │                  └─────────────────────┘

Legend:
  PK = Primary Key
  FK = Foreign Key
  UQ = Unique Constraint
  →  = References
  1:n = One-to-many relationship
  1:1 = One-to-one relationship
```

---

## Acceptance Criteria

- [x] All 6 tables created with correct constraints — *audit:* `apps/web/supabase/migrations/20260128225704_canon_management.sql:10`
- [x] Foreign keys enforce referential integrity — *audit:* `apps/web/supabase/migrations/20260128225704_canon_management.sql:12`, `apps/web/supabase/migrations/20260324095502_canon_episode_fk_cascade.sql:5`
- [x] Indexes created for common query patterns — *audit:* `apps/web/supabase/migrations/20260128225704_canon_management.sql:45`
- [ ] RLS policies applied and tested — *audit: not met* — applied (`apps/web/supabase/migrations/20260128225704_canon_management.sql:230`), but no pgTAP test asserts a canon access rule; the one member-role insert (`apps/web/supabase/tests/database/audit-author-snapshot.test.sql:57`) tests the name trigger — KB-17
- [x] TypeScript types generated: `pnpm supabase:web:typegen` — *audit:* `packages/supabase/src/database.types.ts:2851`
- [x] Types include: `ImmutableEvent`, `CharacterState`, `WorldState`, `NarrativeThread`, `StateDelta`, `EpisodeSummary` — *audit:* `packages/features/episodes/src/lib/canon/types.ts:17`

---

## Test Plan

```sql
-- Insert test immutable event
insert into public.immutable_events (project_id, event_type, event_key, established_in, season, episode_number, description)
values ('project-uuid', 'death', 'character:john:dead', 'episode-uuid', 1, 5, 'John died in battle');

-- Attempt to insert conflicting event (should fail unique constraint)
insert into public.immutable_events (project_id, event_type, event_key, established_in, season, episode_number, description)
values ('project-uuid', 'death', 'character:john:dead', 'episode-uuid', 1, 10, 'John died again');
-- Expected: ERROR unique constraint violation
```

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| RLS policies applied and tested | No pgTAP test asserts a canon access rule. The one member-role statement, `audit-author-snapshot.test.sql:57`, checks the name trigger — and succeeds while naming another user as author. The `immutable_events` policy (`FOR ALL`, no `WITH CHECK`) lets any member update, delete and re-author events | KB-17 |
