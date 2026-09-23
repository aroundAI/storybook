# Canon Management System Tutorial

> **Learning Time**: 45-60 minutes  
> **Difficulty**: Intermediate  
> **Prerequisites**: Familiarity with the Storybook platform, TypeScript, and basic SQL

## What You'll Learn

By the end of this tutorial, you will:

1. ✅ Understand the **three canon layers** (Immutable, Soft, Ephemeral)
2. ✅ Know how the **6 database tables** work together to track narrative state
3. ✅ Use the **9 validation rules** to prevent common storytelling failures
4. ✅ Configure **Memory Context** with token budgeting for LLM calls
5. ✅ Leverage the **4-role LLM pipeline** (Planner → Writer → Editor → Stylist)
6. ✅ Build and extend **Canon UI components**

---

## Table of Contents

1. [Introduction: Why Canon Management?](#1-introduction-why-canon-management)
2. [Core Concepts](#2-core-concepts)
3. [Database Schema Deep Dive](#3-database-schema-deep-dive)
4. [The 9 Validation Rules](#4-the-9-validation-rules)
5. [Memory Context Builder](#5-memory-context-builder)
6. [LLM Role Separation](#6-llm-role-separation)
7. [UI Components](#7-ui-components)
8. [Integration Guide](#8-integration-guide)
9. [Troubleshooting](#9-troubleshooting)
10. [Next Steps](#10-next-steps)

---

## 1. Introduction: Why Canon Management?

### The Problem

When using LLMs to generate serialized content (like TV series episodes), you'll encounter these common failures:

| Problem | Description | Example |
|---------|-------------|---------|
| **Resurrection** | Dead characters reappear | "John walked in" (John died in E5) |
| **Knowledge Leak** | Characters know things they shouldn't | Sarah references secret meeting she wasn't at |
| **Character Regression** | Growth undone without justification | "Bitter Sarah" becomes "Naive Sarah" magically |
| **Orphaned Plots** | Setups without payoffs | "The mysterious letter" never mentioned again |
| **Nostalgia Spam** | Over-referencing past events | Every scene references S1E1 |

### The Solution

The Canon Management System (CMS) transforms generation from **reactive** (detect issues after) to **preventive** (block violations before):

```
┌─────────────────────────────────────────────────────────────────┐
│                    Canon Management System                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────────┐    ┌──────────────┐    │
│  │   Canon DB  │───▶│ Memory Context  │───▶│  Continuity  │    │
│  │  (6 tables) │    │    Builder      │    │   Validator  │    │
│  └─────────────┘    └─────────────────┘    └───────┬──────┘    │
│                                                    │           │
│                                              ┌─────▼─────┐     │
│                                              │ Generation │     │
│                                              │  Pipeline  │     │
│                                              └───────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Core Principle**: "The CMS is the Author, the LLM is a Bounded Generator."  
> LLMs don't write stories—they generate text within narrative constraints imposed by the CMS.

---

## 2. Core Concepts

### 2.1 The Three Canon Layers

```
┌─────────────────────────────────────────┐
│           IMMUTABLE LAYER               │  ← Never changes (deaths, world rules)
│  "John died in S1E5"                    │
├─────────────────────────────────────────┤
│             SOFT LAYER                  │  ← Changes with authorization
│  "Sarah is grieving → determined"       │
├─────────────────────────────────────────┤
│          EPHEMERAL LAYER                │  ← Per-scene, not persisted
│  "Coffee cup on table"                  │
└─────────────────────────────────────────┘
```

| Layer | Description | Enforcement | Database Table |
|-------|-------------|-------------|----------------|
| **Immutable** | Facts that NEVER change | Hard block on violation | `immutable_events` |
| **Soft** | Changeable with authorization | Validation required | `character_states`, `world_states` |
| **Ephemeral** | Per-scene details | No enforcement | Not stored |

### 2.2 The Authorization Triplet

Every soft state change requires three components:

```typescript
interface StateChange {
  trigger: string;      // What caused the change
  cost: string;         // What was sacrificed  
  constraints: string[]; // What this prevents going forward
}
```

**Example**: Sarah's emotional arc

```
Episode 1: Sarah is "optimistic"
  trigger: "story opening"
  cost: null
  constraints: []

Episode 3: Sarah is "grieving"
  trigger: "father's death in battle"
  cost: "lost innocence"
  constraints: ["cannot be carefree", "must seek meaning"]

Episode 7: Sarah is "determined"
  trigger: "found purpose in protecting others"
  cost: "gave up personal happiness"
  constraints: ["cannot abandon mission", "prioritizes duty"]
```

> [!TIP]
> The Authorization Triplet prevents "magical" character development. Every change must be earned through narrative cost.

### 2.3 Memory Budget

Historical context is limited to **15%** of the token budget to prevent:
- **Nostalgia spam** (over-referencing past)
- **Context window exhaustion**
- **New content starvation**

```
Total Context Window: 40,000 tokens
                    │
    ┌───────────────┴───────────────┐
    │   Memory Budget (15%)         │
    │   = 6,000 tokens              │
    └───────────────┬───────────────┘
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌─────────┐   ┌─────────┐   ┌─────────┐
│Immutable│   │Character│   │ Episode │
│ Events  │   │ States  │   │Summaries│
│  35%    │   │   25%   │   │   15%   │
└─────────┘   └─────────┘   └─────────┘
```

---

## 3. Database Schema Deep Dive

The Canon Management System uses 6 interconnected tables:

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
```

### 3.1 Table: `immutable_events`

**Purpose**: Hard canon facts that can NEVER be contradicted.

```sql
create table if not exists public.immutable_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  
  -- Event classification
  event_type varchar(50) not null check (event_type in (
    'death',               -- Character permanently died
    'world_fact',          -- Established world truth
    'relationship',        -- Permanent relationship state
    'timeline',            -- Fixed point in time
    'ability_loss',        -- Permanent removal of ability
    'location_destruction' -- Location permanently destroyed
  )),
  
  -- Unique key for conflict detection
  event_key text not null,
  
  -- Provenance
  established_in uuid references public.episodes(id) not null,
  season integer not null,
  episode_number integer not null,
  
  -- Human-readable description
  description text not null,
  metadata jsonb default '{}',
  
  created_at timestamptz default now(),
  created_by uuid references auth.users,
  
  unique (project_id, event_key)
);
```

**Event Key Format**: `{entity_type}:{entity_id}:{state}`

| Event Type | Event Key Example | Description |
|------------|-------------------|-------------|
| death | `character:abc123:dead` | John Smith died in battle |
| world_fact | `world:magic:disabled` | This world has no magic |
| relationship | `relationship:abc:def:siblings` | Characters are siblings |
| timeline | `timeline:war:ended:1945` | The war ended in 1945 |

### 3.2 Table: `character_states`

**Purpose**: Append-only log tracking character evolution. Reversals trigger validation failures.

```sql
create table if not exists public.character_states (
  id uuid primary key default extensions.uuid_generate_v4(),
  character_id uuid references public.assets(id) on delete cascade not null,
  episode_id uuid references public.episodes(id) not null,
  
  state_type varchar(50) not null check (state_type in (
    'emotional',    -- Grief, happiness, anger
    'physical',     -- Health, injuries, appearance
    'relationship', -- Relationship to other characters
    'knowledge',    -- What the character knows
    'ability',      -- Skills, powers, resources
    'location',     -- Current whereabouts
    'goal'          -- Current objective
  )),
  
  state_value jsonb not null,
  
  -- Authorization triplet (REQUIRED)
  trigger_event text not null,
  cost text,
  new_constraints text[],
  
  -- Audit chain (linked list)
  previous_state_id uuid references public.character_states(id),
  
  created_at timestamptz default now(),
  created_by uuid references auth.users
);
```

> [!CAUTION]
> This table is **append-only**. The RLS policy grants only `SELECT` and `INSERT` — no `UPDATE` or `DELETE`. This ensures audit trail integrity.

### 3.3 Table: `narrative_threads`

**Purpose**: Track plot thread lifecycle to prevent orphaned storylines.

```sql
create table if not exists public.narrative_threads (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  
  thread_name text not null,
  thread_type varchar(50) default 'plot' check (thread_type in (
    'plot',       -- Main story arc
    'character',  -- Character growth arc
    'mystery',    -- Unanswered question
    'romantic',   -- Love interest arc
    'conflict',   -- Antagonist/obstacle arc
    'thematic'    -- Recurring theme
  )),
  
  status varchar(20) default 'open' check (status in (
    'open',       -- Started, not resolved
    'progressed', -- Touched, not resolved
    'resolved',   -- Concluded
    'abandoned'   -- Dropped (flagged for review)
  )),
  
  opened_at uuid references public.episodes(id) not null,
  resolved_at uuid references public.episodes(id),
  episodes_touched uuid[] default '{}',
  
  promises text[] default '{}',
  payoffs text[] default '{}',
  
  description text
);
```

**Thread Integrity Rules**:
- Every `promise` should eventually have a corresponding `payoff`
- Threads cannot be `resolved` without at least one `payoff`
- `abandoned` threads trigger warnings

### 3.4 Supporting Tables

| Table | Purpose |
|-------|---------|
| `world_states` | Environment tracking (locations, atmosphere, conflicts) |
| `state_deltas` | Immutable audit log of all changes per episode |
| `episode_summaries` | Pre-computed summaries for efficient context injection |

---

## 4. The 9 Validation Rules

The Continuity Validator runs at **3 checkpoints** during generation:

```
Story Ideation  ───► [CHECKPOINT 1: Plot Skeleton] ───►
                            │
                      VALIDATOR
                            │
Screenplay Gen  ───► [CHECKPOINT 2: Scene Blocks] ───►
                            │
                      VALIDATOR
                            │
Shot List Gen   ───► [CHECKPOINT 3: Dialogue] ───►
                            │
                      VALIDATOR
                            │
                       Final Output
```

### Rule Summary

| Rule | Type | Severity | Description |
|------|------|----------|-------------|
| CANON_001 | `immutable_violation` | **CRITICAL** | Contradicting hard canon |
| CANON_002 | `state_reversal` | HARD_FAIL | Character regression |
| CANON_003 | `causality_break` | HARD_FAIL | Effect before cause |
| CANON_004 | `unauthorized_change` | SOFT_FAIL | Missing trigger/cost/constraint |
| CANON_005 | `thread_orphan` | SOFT_FAIL | Abandoned promise |
| CANON_006 | `reference_violation` | HARD_FAIL | Citing non-existent events |
| CANON_007 | `connectivity_failure` | SOFT_FAIL | Insufficient callbacks |
| CANON_008 | `escalation_overflow` | SOFT_FAIL | Stakes ceiling breach |
| CANON_009 | `tone_drift` | SOFT_FAIL | Genre inconsistency |

### 4.1 CANON_001: Immutable Violation (CRITICAL)

**Logic**: Detect when proposed content contradicts established immutable events.

```typescript
async checkImmutableViolation(
  proposedEvents: ProposedEvent[],
  context: MemoryContext
): Promise<ContinuityViolation[]> {
  const violations: ContinuityViolation[] = [];
  
  for (const event of proposedEvents) {
    const eventKey = this.generateEventKey(event);
    // e.g., "character:john-uuid:alive" from "John appears in scene"
    
    const conflict = context.immutableEvents.find(ie => 
      this.keysConflict(ie.eventKey, eventKey)
    );
    // e.g., "character:john-uuid:dead" conflicts with "alive"
    
    if (conflict) {
      violations.push({
        type: 'immutable_violation',
        severity: 'critical',
        rule: 'CANON_001',
        message: `Cannot ${event.description}. ${conflict.description} [S${conflict.season}E${conflict.episodeNumber}]`,
        suggestion: 'Use flashback, memory, or different character.',
        autoFixable: false,
      });
    }
  }
  
  return violations;
}
```

**Example Error Message**:
```
❌ CANON_001 VIOLATION (CRITICAL)

Cannot show John Smith alive in scene 3. 
John Smith died in battle [S1E5].

Suggestion: Use flashback, memory, or different character.
```

### 4.2 CANON_002: State Reversal (HARD_FAIL)

**Logic**: Character development must move **forward**. Regression without justification fails.

```typescript
// State ordering for emotional arc
const STATE_ORDERING = {
  emotional: {
    naive: 0,
    optimistic: 1,
    questioning: 2,
    grieving: 3,
    bitter: 4,
    accepting: 5,
    determined: 6,
    wise: 7,
  }
};
```

| Previous | Proposed | Valid? | Reason |
|----------|----------|--------|--------|
| grieving | optimistic | ❌ | Regression (index 3→1) |
| grieving | determined | ✅ | Forward (index 3→6) |
| bitter | bitter | ✅ | Same level |
| injured | healthy | ❌ | Needs recovery arc |

### 4.3 CANON_005: Thread Orphan (SOFT_FAIL)

**Logic**: Warn when plot threads haven't progressed in 3+ episodes.

```typescript
async checkThreadIntegrity(
  skeleton: PlotSkeleton,
  context: MemoryContext
): Promise<ContinuityViolation[]> {
  const violations: ContinuityViolation[] = [];
  
  for (const thread of context.activeThreads) {
    if (thread.status === 'open') {
      const episodesSinceOpen = context.currentEpisodeNumber - thread.openedAtEpisode;
      
      if (episodesSinceOpen >= 3 && !skeleton.touchesThread(thread.id)) {
        violations.push({
          type: 'thread_orphan',
          severity: 'soft_fail',
          message: `Thread "${thread.threadName}" has not progressed in ${episodesSinceOpen} episodes`,
          suggestion: `Consider: progress or resolve "${thread.threadName}" in this episode`,
        });
      }
    }
  }
  
  return violations;
}
```

### 4.4 Other Rules

| Rule | Key Algorithm |
|------|---------------|
| CANON_003 | Timeline analysis - effects cannot precede causes |
| CANON_004 | Authorization check - verify trigger/cost/constraint present |
| CANON_006 | Fuzzy matching against canon for referenced events |
| CANON_007 | Connectivity ratio: `callbacks / available_targets >= 0.25` |
| CANON_008 | Stakes score calculation with ceiling curve |
| CANON_009 | Tone vector distance (humor, darkness, pace, hope) |

---

## 5. Memory Context Builder

The Memory Context Builder assembles token-budgeted context for LLM calls.

### 5.1 Budget Allocation

```typescript
interface TokenBudget {
  used: number;
  max: number;
  percentage: number;
  breakdown: {
    immutable: number;   // 35% - always included
    characters: number;  // 25% - current character states
    world: number;       // 10% - world state
    threads: number;     // 15% - active threads
    summaries: number;   // 15% - episode summaries
  };
  withinLimit: boolean;
}
```

### 5.2 Usage Example

```typescript
import { buildMemoryContext, formatContextForPrompt } from '@kit/episodes';

// Build context for episode 29
const context = await buildMemoryContext(projectId, 29, {
  maxTokenPercentage: 15,    // 15% of context window
  contextWindowSize: 40000,  // Total tokens available
  memoryHorizon: 10,         // Look back 10 episodes
  priority: 'balanced',      // 'recency' | 'importance' | 'balanced'
});

// Format for LLM prompt
const promptSection = formatContextForPrompt(context);
```

### 5.3 Formatted Output

The `formatContextForPrompt` function produces structured text:

```markdown
## ESTABLISHED FACTS (DO NOT CONTRADICT)
The following facts are PERMANENT and cannot be changed:

• John Smith died in battle [S1E5]
• Magic is disabled in this world [S1E1]
• Sarah and Marcus are siblings [S1E3]

## CURRENT CHARACTER STATES
• Sarah: Determined, focused on protecting village
  Constraints: cannot abandon mission, prioritizes duty
• Elena: Revealed as double-agent, status unknown
  Constraints: cannot be trusted, whereabouts secret

## ACTIVE PLOT THREADS
These threads are open and expecting resolution:

• Mystery of the Lost Kingdom (Ep 8, OPEN)
  Promises made: ancient ruins hold the key
• Sarah's redemption arc (Ep 20, PROGRESSED)
  Promises made: must face her past

## RECENT EPISODE CONTEXT
• E28: Sarah confronted Elena at the border...
• E27: The betrayal was revealed when...
• E26: Tensions rise at court as...
```

### 5.4 Memory Horizon by Content Type

| Content Type | Hard Limit | Soft Target | Decay Factor |
|--------------|------------|-------------|--------------|
| SERIES | 50 episodes | 10 episodes | 0.95 per ep |
| MOVIE | 10 episodes | 3 episodes | 0.80 per ep |
| FACTUAL | 5 episodes | 2 episodes | 0.50 per ep |
| NEWS | 0 | 0 | N/A |

---

## 6. LLM Role Separation

The Canon Management System supports an optional **4-role pipeline** that separates concerns:

```
┌─────────────┐
│   PLANNER   │ ← Creates structure, sets constraints
└──────┬──────┘
       │ outputs: plot skeleton, scene beats
       ▼
┌─────────────┐
│   WRITER    │ ← Executes within structure
└──────┬──────┘
       │ outputs: full prose, dialogue
       ▼
┌─────────────┐
│   EDITOR    │ ← Refines without changing structure
└──────┬──────┘
       │ outputs: improved content
       ▼
┌─────────────┐
│   STYLIST   │ ← Polishes language only
└─────────────┘
       │ outputs: final polished content
```

### 6.1 Role Permissions

| Role | Can Create | Must Preserve |
|------|-----------|---------------|
| **Planner** | plot_skeleton, scene_beats, constraints | — |
| **Writer** | prose, dialogue, action_lines | scene_structure, character_list |
| **Editor** | edits, improved_content | facts, structure, meaning |
| **Stylist** | final_content, veo_prompts | facts, meaning, structure |

### 6.2 Enabling Role Separation

```typescript
// In Canon Settings (projects.metadata.canon)
interface CanonSettings {
  enabled: boolean;
  roleSeparation: boolean;   // ← Toggle 4-role pipeline
  memoryHorizon: number;
  enforcement: 'flexible' | 'strict';
  contentType: 'series' | 'movie' | 'factual' | 'news';
}
```

### 6.3 Pipeline Timing

| Stage | Typical Time | Token Usage |
|-------|--------------|-------------|
| Planner | 5-10s | 2K-4K |
| Writer | 15-30s | 4K-8K |
| Editor | 10-15s | 3K-6K |
| Stylist | 5-10s | 2K-4K |
| **Total** | **35-65s** | **11K-22K** |

> [!NOTE]
> When role separation is **disabled**, generation uses a single-call approach (15-25s). Enable role separation for better structure and consistency at the cost of longer generation time.

---

## 7. UI Components

### 7.1 Canon Settings Form

**Location**: `/studio/[projectSlug]/settings/`

```tsx
import { CanonSettingsForm } from './canon-settings-form';

<CanonSettingsForm 
  projectId={project.id}
  currentSettings={project.metadata?.canon}
/>
```

**Features**:
- Toggle Canon Tracking on/off
- Select Content Type (Series, Movie, Factual, News)
- Set Enforcement Level (Flexible/Strict)
- Adjust Memory Horizon (1-20 episodes)
- Enable/Disable LLM Role Separation

### 7.2 Canon Health Badge

**Location**: Episode header

```tsx
import { CanonHealthBadge } from './canon-health-badge';

<CanonHealthBadge projectId={project.id} />
```

**States**:
| Status | Icon | Meaning |
|--------|------|---------|
| ✓ Canon OK | Green check | No issues detected |
| ⚠️ Warnings | Yellow triangle | Soft violations present |
| ✖️ Errors | Red X | Hard violations detected |

### 7.3 Canon Dashboard

**Location**: `/episodes/[episodeSlug]/story/`

The Canon Dashboard provides a tabbed interface for:
- **Events**: Immutable events with expandable details
- **Threads**: Narrative threads with status badges
- **Characters**: Character state history

```tsx
import { CanonDashboard } from './canon-dashboard';

<CanonDashboard
  projectId={project.id}
  episodeId={episode.id}
  episodeNumber={episode.episode_number}
  season={episode.season}
  canonEnabled={canonSettings.enabled}
/>
```

---

## 8. Integration Guide

### 8.1 Adding an Immutable Event

```typescript
import { addImmutableEventAction } from '@kit/episodes/server';

await addImmutableEventAction({
  projectId: 'project-uuid',
  eventType: 'death',
  eventKey: 'character:john-uuid:dead',
  establishedIn: 'episode-uuid',
  season: 1,
  episodeNumber: 5,
  description: 'John Smith died in the battle for Castle Rock',
  metadata: {
    character_id: 'john-uuid',
    cause_of_death: 'battle',
    witnesses: ['sarah-uuid', 'marcus-uuid'],
  },
});
```

### 8.2 Updating Character State

```typescript
import { updateCharacterStateAction } from '@kit/episodes/server';

await updateCharacterStateAction({
  characterId: 'sarah-uuid',
  episodeId: 'episode-uuid',
  stateType: 'emotional',
  stateValue: {
    state: 'determined',
    intensity: 8,
    cause: 'found_purpose',
    duration: 'ongoing',
  },
  triggerEvent: "Sarah witnessed the village being saved",
  cost: "Gave up personal happiness for duty",
  newConstraints: [
    "Cannot abandon the village",
    "Prioritizes community over self",
  ],
});
```

### 8.3 Creating a Narrative Thread

```typescript
import { createNarrativeThreadAction } from '@kit/episodes/server';

await createNarrativeThreadAction({
  projectId: 'project-uuid',
  threadName: "The Lost Kingdom",
  threadType: 'mystery',
  openedAt: 'episode-uuid',
  description: "Ancient ruins may hold the key to saving the realm",
  promises: [
    "The ruins contain a secret weapon",
    "Someone knows the location but is hiding it",
  ],
});
```

### 8.4 Validating Content Before Generation

```typescript
import { 
  buildMemoryContext, 
  createContinuityValidator 
} from '@kit/episodes';

// Build context
const context = await buildMemoryContext(projectId, episodeNumber);

// Create validator
const validator = createContinuityValidator(context);

// Validate plot skeleton
const result = await validator.validatePlotSkeleton(skeleton);

if (!result.pass) {
  // Handle violations
  for (const violation of result.violations) {
    console.error(`${violation.rule}: ${violation.message}`);
    console.log(`Suggestion: ${violation.suggestion}`);
  }
  throw new ContinuityViolationError(result.violations);
}

// Continue with generation...
```

---

## 9. Troubleshooting

### Common Issues

#### "Cannot find immutable_events table"

**Cause**: Migration not applied.

**Solution**:
```bash
pnpm --filter web supabase migration up
pnpm supabase:web:typegen
```

#### "CANON_001 false positive"

**Cause**: Event key format mismatch.

**Solution**: Ensure event keys follow the exact format:
```
{entity_type}:{entity_id}:{state}
```

Example: `character:550e8400-e29b-41d4-a716-446655440000:dead`

#### "Memory context exceeds budget"

**Cause**: Too many canon events or long descriptions.

**Solution**:
1. Reduce `memoryHorizon` in settings
2. Truncate long descriptions
3. Enable `overflow: 'truncate'` strategy

#### "Character state INSERT fails"

**Cause**: Missing required `trigger_event` field.

**Solution**: Always provide the Authorization Triplet:
```typescript
{
  triggerEvent: "Required - what caused this change",
  cost: "Optional - what was sacrificed",
  newConstraints: ["Optional - what this prevents"],
}
```

---

## 10. Content Type Strategies

The Canon Management System adapts its behavior based on content type. This is the core of how the system supports everything from feature films to news programs.

### 10.1 The Content Type Matrix

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         CONTENT TYPE DECISION MATRIX                             │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                    NARRATIVE CONTINUITY (Low → High)                             │
│                    ─────────────────────────────────►                            │
│                                                                                  │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐         │
│   │    NEWS     │   │  FACTUAL    │   │   MOVIE     │   │   SERIES    │         │
│   │             │   │             │   │             │   │             │         │
│   │ No internal │   │ No fiction  │   │ Full story  │   │ Multi-ep    │         │
│   │ canon       │   │ canon, but  │   │ arc in one  │   │ continuity  │         │
│   │             │   │ requires    │   │ "episode"   │   │             │         │
│   │ REQUIRES:   │   │ citations   │   │             │   │ REQUIRES:   │         │
│   │ - Sources   │   │             │   │ REQUIRES:   │   │ - Full      │         │
│   │ - Credible  │   │ REQUIRES:   │   │ - Act       │   │   Memory    │         │
│   │   agencies  │   │ - Papers    │   │   structure │   │   Context   │         │
│   │ - Real-time │   │ - Citations │   │ - Scene     │   │ - Thread    │         │
│   │   data      │   │ - Expert    │   │   coherence │   │   Tracking  │         │
│   │             │   │   quotes    │   │ - Self-     │   │ - State     │         │
│   └─────────────┘   └─────────────┘   │   contained │   │   Machine   │         │
│                                       └─────────────┘   └─────────────┘         │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Movies: Self-Contained Context

> [!IMPORTANT]
> **The Problem**: AI cannot maintain context across a full 2-hour movie when generating scene-by-scene. By scene 45, it has "forgotten" scene 3.

**Solution**: Movies use a **compressed context window** with aggressive summarization:

```typescript
// Movie content type configuration
const MOVIE_CONFIG = {
  contentType: 'movie',
  
  // Memory horizon is the entire movie (all acts)
  memoryHorizon: {
    hardLimit: 10,      // Max 10 "episodes" (really acts/sequences)
    softTarget: 3,      // Always include last 3 sequences
    decayFactor: 0.80,  // Faster decay - recent scenes matter most
  },
  
  // Act structure provides narrative spine
  actStructure: {
    act1_setup: { endPercent: 25, purpose: 'establish world, characters, conflict' },
    act2_confrontation: { endPercent: 75, purpose: 'escalating obstacles' },
    act3_resolution: { endPercent: 100, purpose: 'climax and resolution' },
  },
  
  // No inter-episode memory needed (self-contained)
  episodeSummaries: false,
  
  // But we DO need intra-movie coherence
  sceneCoherence: {
    enabled: true,
    summarizeEveryNScenes: 5,  // Compress every 5 scenes
    maintainCharacterArcs: true,
  },
};
```

**How It Works for Movies**:

```
User creates project → Content Type: MOVIE
                    ↓
Creates single "episode" (the movie)
                    ↓
Movie is divided into sequences/acts
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ Generation Process (Scene 25 of 50)                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ INJECTED CONTEXT:                                           │
│ ├── Act 1 Summary (compressed, ~500 tokens)                 │
│ │   "John, a retired detective, discovers his partner       │
│ │    was murdered. He vows revenge. Key: gun introduced."   │
│ │                                                           │
│ ├── Act 2 Progress Summary (~300 tokens)                    │
│ │   "Scenes 15-24: John tracked leads, confronted           │
│ │    crime boss, lost the evidence."                        │
│ │                                                           │
│ ├── Immediate Context (Scenes 22-24, full detail)           │
│ │   [Complete scene text, ~1500 tokens]                     │
│ │                                                           │
│ └── Character State Snapshot                                │
│     "John: injured, desperate, knows location of boss"      │
│                                                             │
│ GENERATION: Scene 25 (warehouse confrontation)              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 10.3 Sequels: Linking Movies

When creating a sequel, the system links to parent movies:

```typescript
// Creating a sequel
await createProjectAction({
  name: "Die Hard 2",
  contentType: 'movie',
  linkedProjects: ['die-hard-1-uuid'],  // ← Links to first movie
  inheritCanon: true,                    // ← Import canon from linked
});

// System automatically imports:
// - All immutable_events from Die Hard 1
// - Character final states as starting states
// - Resolved threads (can be reopened)
// - World state (locations, rules)
```

```
┌─────────────────┐          ┌─────────────────┐
│   Die Hard 1    │          │   Die Hard 2    │
│                 │          │                 │
│ Canon:          │──────────│ Inherits:       │
│ - John alive    │  LINK    │ - John alive    │
│ - Hans dead     │          │ - Hans dead     │
│ - Building OK   │          │ - Building OK   │
│                 │          │                 │
│ Final State:    │          │ Starting State: │
│ John: "hero"    │──────────│ John: "hero"    │
└─────────────────┘          └─────────────────┘
```

### 10.4 Series: The Full Canon Experience

Series get the full power of the Canon Management System:

#### Type A: Hard Narrative Series (True Detective, Breaking Bad)

```typescript
const HARD_NARRATIVE_CONFIG = {
  contentType: 'series',
  seriesType: 'serialized',
  
  // Every episode matters
  memoryHorizon: {
    hardLimit: 50,      // Remember up to 50 episodes
    softTarget: 10,     // Always include last 10
    decayFactor: 0.95,  // Slow decay - old events still matter
  },
  
  // Thread tracking is critical
  threadTracking: {
    enforcePayoffs: true,         // Every promise must be paid
    maxOpenThreads: 15,           // Limit complexity
    orphanWarningEpisodes: 3,     // Warn if thread dormant
  },
  
  // Character arcs are locked
  characterArcs: {
    forwardOnly: true,            // No regression
    requireAuthorization: true,   // Trigger + Cost required
    trackRelationships: true,     // A↔B relationships matter
  },
  
  // Strict enforcement
  enforcement: 'strict',          // Block violations
};
```

#### Type B: Episodic with Background Arc (Smallville, Friends)

```typescript
const EPISODIC_WITH_ARC_CONFIG = {
  contentType: 'series',
  seriesType: 'episodic_with_arc',
  
  // Episode is self-contained but season arc exists
  memoryHorizon: {
    hardLimit: 20,      // Shorter memory
    softTarget: 5,      // Focus on recent
    decayFactor: 0.90,  // Faster decay
  },
  
  // Two-tier thread system
  threadTracking: {
    // "A Plot" - resolved within episode
    episodicThreads: {
      mustResolveWithinEpisode: true,
      episodeSummaryOnly: true,  // Don't carry full detail
    },
    // "B Plot" - season arc
    seasonThreads: {
      enforcePayoffs: true,
      minProgressEveryNEpisodes: 5,  // Touch arc every 5 eps
    },
  },
  
  // Characters have "reset" elements
  characterArcs: {
    forwardOnly: true,
    // But core traits can "reset" between episodes
    episodicTraits: ['mood', 'location', 'minor_relationships'],
    persistentTraits: ['major_relationships', 'knowledge', 'growth'],
  },
  
  enforcement: 'flexible',  // Warn but don't block
};
```

**Visual: Episodic vs Serialized**

```
SERIALIZED (True Detective):
Episode 1 ───► Episode 2 ───► Episode 3 ───► Episode 4
    │              │              │              │
    └──────────────┴──────────────┴──────────────┘
              Everything is connected


EPISODIC WITH ARC (Friends):
Episode 1       Episode 2       Episode 3       Episode 4
    │               │               │               │
 [A Plot]        [A Plot]        [A Plot]        [A Plot]
 (resolved)      (resolved)      (resolved)      (resolved)
    │               │               │               │
    └───────────────┴───────────────┴───────────────┘
              Background B Plot (Ross & Rachel)
```

### 10.5 Factual Content: Citations Over Canon

Science shows, documentaries, and history content don't need fictional canon—they need **verified facts**.

```typescript
const FACTUAL_CONFIG = {
  contentType: 'factual',
  
  // No narrative memory needed
  memoryHorizon: {
    hardLimit: 5,       // Minimal
    softTarget: 2,
    decayFactor: 0.50,  // Very fast decay
  },
  
  // But REQUIRE citations
  citationRequirements: {
    enabled: true,
    minCitationsPerClaim: 1,
    preferredSources: [
      'peer_reviewed_journals',
      'government_databases',
      'academic_institutions',
      'verified_expert_quotes',
    ],
    
    // Integration with knowledge bases
    knowledgeBases: [
      { type: 'wikipedia', trustLevel: 0.7 },
      { type: 'arxiv', trustLevel: 0.9 },
      { type: 'pubmed', trustLevel: 0.95 },
      { type: 'custom', endpoint: '/api/knowledge' },
    ],
  },
  
  // Fact-checking pipeline
  factChecking: {
    enabled: true,
    preGeneration: true,   // Verify facts BEFORE generating
    postGeneration: true,  // Validate claims after
    flagUnverified: true,  // Mark uncertain claims
  },
  
  // No fictional rules
  threadTracking: { enabled: false },
  characterArcs: { enabled: false },
  immutableEvents: { enabled: false },
};
```

**How Factual Content Works**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FACTUAL CONTENT GENERATION FLOW                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User Input: "Create episode about black holes"                             │
│                           │                                                 │
│                           ▼                                                 │
│  ┌─────────────────────────────────────────┐                               │
│  │         KNOWLEDGE BASE QUERY            │                               │
│  │                                         │                               │
│  │  Sources queried:                       │                               │
│  │  ├── arXiv: "black hole" papers         │                               │
│  │  ├── NASA: official data                │                               │
│  │  ├── Expert interviews DB               │                               │
│  │  └── Previous episodes (for callbacks)  │                               │
│  └─────────────────────────────────────────┘                               │
│                           │                                                 │
│                           ▼                                                 │
│  ┌─────────────────────────────────────────┐                               │
│  │         FACT VERIFICATION               │                               │
│  │                                         │                               │
│  │  Each claim tagged:                     │                               │
│  │  ✓ "Black holes have event horizons"    │                               │
│  │    [Source: Hawking 1974, Nature]       │                               │
│  │  ✓ "Sagittarius A* is 4M solar masses"  │                               │
│  │    [Source: Nobel Prize 2020 data]      │                               │
│  │  ⚠️ "Wormholes may exist"                │                               │
│  │    [Source: Theoretical, unverified]    │                               │
│  └─────────────────────────────────────────┘                               │
│                           │                                                 │
│                           ▼                                                 │
│  ┌─────────────────────────────────────────┐                               │
│  │         GENERATION WITH CITATIONS       │                               │
│  │                                         │                               │
│  │  Output includes:                       │                               │
│  │  - Narration with inline citations      │                               │
│  │  - Source bibliography                  │                               │
│  │  - Confidence levels per section        │                               │
│  │  - Expert quotes with attribution       │                               │
│  └─────────────────────────────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 10.6 News Content: Real-Time Data

News programs need completely different handling:

```typescript
const NEWS_CONFIG = {
  contentType: 'news',
  
  // NO canon at all - each segment is fresh
  memoryHorizon: { hardLimit: 0 },
  
  // Real-time data integration
  realTimeData: {
    enabled: true,
    sources: [
      { agency: 'reuters', trustLevel: 0.95 },
      { agency: 'ap', trustLevel: 0.95 },
      { agency: 'afp', trustLevel: 0.90 },
      { agency: 'custom_feed', endpoint: '/api/news' },
    ],
    freshnessWindow: '24h',  // Only use data from last 24 hours
    updateFrequency: '15m',  // Check for updates every 15 min
  },
  
  // Source verification
  sourceRequirements: {
    minSources: 2,              // Must have 2+ sources
    requireMainstream: true,    // At least 1 major outlet
    conflictResolution: 'flag', // Flag conflicting reports
  },
  
  // Editorial guidelines
  editorial: {
    balanceRequirement: true,   // Multiple viewpoints
    opinionLabeling: true,      // Mark opinion vs fact
    correctionTracking: true,   // Track if corrections needed
  },
};
```

---

## 11. System Integration

### 11.1 How Canon Connects to Season Generation

When a user clicks **"Generate Season"** and provides a roadmap:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SEASON GENERATION WITH CANON                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: User provides Season Roadmap                                       │
│  ─────────────────────────────────────                                      │
│  "Season 2: Sarah becomes village leader. Elena returns. War looms."        │
│                                                                             │
│  Step 2: System Loads Canon Context                                         │
│  ─────────────────────────────────────                                      │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │ buildMemoryContext(projectId, seasonStartEpisode)           │           │
│  │                                                             │           │
│  │ Returns:                                                    │           │
│  │ - Immutable events from Season 1                            │           │
│  │ - Final character states from S1 finale                     │           │
│  │ - Unresolved narrative threads                              │           │
│  │ - World state                                               │           │
│  └─────────────────────────────────────────────────────────────┘           │
│                                                                             │
│  Step 3: Canon Validates Roadmap                                            │
│  ─────────────────────────────────                                          │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │ validateSeasonRoadmap(roadmap, canonContext)                │           │
│  │                                                             │           │
│  │ Checks:                                                     │           │
│  │ ✓ "Sarah becoming leader" - valid (she's alive, trust high)│           │
│  │ ✓ "Elena returns" - valid (status was "escaped")           │           │
│  │ ❌ "Marcus leads army" - BLOCKED (Marcus died S1E15)        │           │
│  │ ⚠️ "Mystery of Kingdom" - WARNING (thread open 8 episodes)  │           │
│  └─────────────────────────────────────────────────────────────┘           │
│                                                                             │
│  Step 4: Generate Episode Skeletons                                         │
│  ───────────────────────────────────                                        │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │ For each episode in season:                                 │           │
│  │                                                             │           │
│  │   episodeSkeleton = generateWithMemory({                    │           │
│  │     roadmapSegment,                                         │           │
│  │     canonContext,        // ← Injected                      │           │
│  │     activeThreads,       // ← Must progress some            │           │
│  │     characterStates,     // ← Current states                │           │
│  │   });                                                       │           │
│  │                                                             │           │
│  │   // After each episode, UPDATE the canon                   │           │
│  │   await commitCanonChanges(projectId, episodeId, changes);  │           │
│  │                                                             │           │
│  └─────────────────────────────────────────────────────────────┘           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Single Episode Generation Flow

When creating episodes one at a time:

```typescript
// In story-actions.ts - simplified flow

async function generateStoryAction(params: {
  projectId: string;
  episodeId: string;
  premise: string;
}) {
  // 1. Load project settings
  const project = await getProject(params.projectId);
  const canonSettings = project.metadata?.canon as CanonSettings;
  
  // 2. Build memory context (this is where canon is loaded)
  const episodeNumber = await getEpisodeNumber(params.episodeId);
  const memoryContext = await buildMemoryContext(
    params.projectId,
    episodeNumber,
    {
      maxTokenPercentage: 15,
      memoryHorizon: canonSettings.memoryHorizon,
    }
  );
  
  // 3. Format context for LLM
  const canonPromptSection = formatContextForPrompt(memoryContext);
  
  // 4. Generate story with canon awareness
  const story = await executeLLM('story-generation', {
    premise: params.premise,
    
    // THIS IS WHERE CANON IS INJECTED
    systemContext: canonPromptSection,
    
    // Constraints from canon
    constraints: {
      deadCharacters: memoryContext.immutableEvents
        .filter(e => e.eventType === 'death')
        .map(e => e.eventKey),
      activeThreads: memoryContext.activeThreads
        .map(t => t.threadName),
      characterStates: Object.fromEntries(
        memoryContext.characterStates
      ),
    },
  });
  
  // 5. Validate generated content
  const validator = createContinuityValidator(memoryContext);
  const validation = await validator.validateStory(story);
  
  if (!validation.pass && canonSettings.enforcement === 'strict') {
    throw new ContinuityViolationError(validation.violations);
  }
  
  // 6. If valid, COMMIT canon changes
  if (story.proposedCanonChanges) {
    await commitCanonChanges(
      params.projectId,
      params.episodeId,
      story.proposedCanonChanges
    );
  }
  
  return story;
}
```

### 11.3 The Canon Commit Process

After each episode is generated and approved:

```typescript
// What gets committed to canon after an episode

interface CanonChanges {
  // New immutable events (deaths, world facts established)
  newImmutableEvents: Array<{
    eventType: string;
    eventKey: string;
    description: string;
  }>;
  
  // Character state updates
  characterStateChanges: Array<{
    characterId: string;
    stateType: string;
    newValue: unknown;
    trigger: string;
    cost: string;
    constraints: string[];
  }>;
  
  // Thread updates
  threadUpdates: Array<{
    threadId: string;
    status: 'progressed' | 'resolved';
    newPayoffs?: string[];
  }>;
  
  // New threads opened
  newThreads: Array<{
    name: string;
    type: string;
    promises: string[];
  }>;
  
  // Episode summary (for future context)
  episodeSummary: {
    plotSummary: string;
    keyEvents: string[];
    characterChanges: string[];
  };
}
```

---

## 12. User Perspective: Where Does Data Come From?

### 12.1 Data Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      USER PERSPECTIVE: DATA SOURCES                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────────────┐    ┌─────────────────────┐     │
│  │   WHAT AI   │    │   WHERE IT COMES    │    │    WHO MANAGES IT   │     │
│  │    KNOWS    │    │       FROM          │    │                     │     │
│  └──────┬──────┘    └──────────┬──────────┘    └──────────┬──────────┘     │
│         │                      │                          │                 │
│         ▼                      ▼                          ▼                 │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │                                                                  │      │
│  │  1. CANON (Internal Memory)                                      │      │
│  │     ├── What happened in past episodes                           │      │
│  │     ├── Who is alive/dead                                        │      │
│  │     ├── Character current states                                 │      │
│  │     └── Active plot threads                                      │      │
│  │                                                                  │      │
│  │     SOURCE: Canon Management Tables (immutable_events,           │      │
│  │             character_states, narrative_threads, etc.)           │      │
│  │                                                                  │      │
│  │     MANAGED BY: System (auto-extracted from generated content)   │      │
│  │                 + User (can manually add/edit events)            │      │
│  │                                                                  │      │
│  ├──────────────────────────────────────────────────────────────────┤      │
│  │                                                                  │      │
│  │  2. ASSETS (Character/Location Data)                             │      │
│  │     ├── Character visual descriptions                            │      │
│  │     ├── Character backstory & traits                             │      │
│  │     ├── Location details                                         │      │
│  │     └── Voice/style profiles                                     │      │
│  │                                                                  │      │
│  │     SOURCE: Assets Table (user-created characters, locations)    │      │
│  │                                                                  │      │
│  │     MANAGED BY: User (created in Character/Asset studio)         │      │
│  │                                                                  │      │
│  ├──────────────────────────────────────────────────────────────────┤      │
│  │                                                                  │      │
│  │  3. FACTS (External Knowledge)                                   │      │
│  │     ├── Scientific data & research                               │      │
│  │     ├── Historical events                                        │      │
│  │     ├── Current news                                             │      │
│  │     └── Expert quotes                                            │      │
│  │                                                                  │      │
│  │     SOURCE: Knowledge Base APIs (arXiv, PubMed, news feeds)      │      │
│  │                                                                  │      │
│  │     MANAGED BY: System (queried based on content type)           │      │
│  │                 + User (can add custom sources)                  │      │
│  │                                                                  │      │
│  ├──────────────────────────────────────────────────────────────────┤      │
│  │                                                                  │      │
│  │  4. USER INPUT (Direct Instructions)                             │      │
│  │     ├── Episode premise                                          │      │
│  │     ├── Season roadmap                                           │      │
│  │     ├── Style preferences                                        │      │
│  │     └── Constraints ("don't kill Sarah")                         │      │
│  │                                                                  │      │
│  │     SOURCE: Form inputs, chat messages                           │      │
│  │                                                                  │      │
│  │     MANAGED BY: User (each generation request)                   │      │
│  │                                                                  │      │
│  └──────────────────────────────────────────────────────────────────┘      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.2 When Does Each Data Type Apply?

| Content Type | Canon | Assets | Facts | User Input |
|--------------|-------|--------|-------|------------|
| **Series** | ✅ Full | ✅ Full | ❌ Optional | ✅ Required |
| **Movie** | ✅ Intra-movie | ✅ Full | ❌ Optional | ✅ Required |
| **Sequel** | ✅ Inherited + New | ✅ Full | ❌ Optional | ✅ Required |
| **Factual** | ❌ Minimal | ⚠️ Hosts only | ✅ **Critical** | ✅ Required |
| **News** | ❌ None | ⚠️ Anchors only | ✅ **Real-time** | ⚠️ Minimal |

### 12.3 User Journey: Fictional Content

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              USER JOURNEY: CREATING EPISODE 5 OF A SERIES                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STEP 1: User navigates to Episode 5 → Story tab                           │
│          ──────────────────────────────────────                             │
│          System silently loads:                                             │
│          ├── Canon from Episodes 1-4                                        │
│          ├── Active character states                                        │
│          └── Open narrative threads                                         │
│                                                                             │
│  STEP 2: User sees "Memory Context Preview" panel (optional view)           │
│          ───────────────────────────────────────────────────────            │
│          Shows what the AI "remembers":                                     │
│          ├── 3 immutable facts detected                                     │
│          ├── 5 characters tracked                                           │
│          ├── 2 open threads ("Mystery", "Romance arc")                      │
│          └── Token budget: 4,200 / 6,000 (70%)                              │
│                                                                             │
│  STEP 3: User enters premise                                                │
│          ───────────────────                                                │
│          "Sarah discovers Elena's hidden letter"                            │
│                                                                             │
│  STEP 4: System validates premise against canon                             │
│          ─────────────────────────────────────                              │
│          ✓ Sarah is alive                                                   │
│          ✓ Elena exists (status: escaped)                                   │
│          ✓ No conflicts with immutable events                               │
│                                                                             │
│  STEP 5: Generation happens with canon injected                             │
│          ─────────────────────────────────────                              │
│          LLM receives:                                                      │
│          ├── System prompt with canon context                               │
│          ├── Character current states                                       │
│          ├── Thread reminder ("Mystery must progress")                      │
│          └── User's premise                                                 │
│                                                                             │
│  STEP 6: User reviews generated story                                       │
│          ────────────────────────────                                       │
│          ├── Story text                                                     │
│          └── "Canon Changes" sidebar showing:                               │
│              ├── New event: "Letter found" (Episode 5)                      │
│              ├── Sarah: emotional → suspicious                              │
│              └── Thread "Mystery" progressed                                │
│                                                                             │
│  STEP 7: User approves → Canon is committed                                 │
│          ────────────────────────────────────                               │
│          Database updated:                                                  │
│          ├── episode_summaries: new row                                     │
│          ├── character_states: new row for Sarah                            │
│          └── narrative_threads: episodes_touched updated                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.4 User Journey: Factual Content

```
┌─────────────────────────────────────────────────────────────────────────────┐
│            USER JOURNEY: CREATING SCIENCE SHOW EPISODE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STEP 1: User creates project with Content Type: FACTUAL                    │
│          ──────────────────────────────────────────────                     │
│          System enables:                                                    │
│          ├── Citation requirements                                          │
│          ├── Fact verification pipeline                                     │
│          └── Knowledge base connections                                     │
│                                                                             │
│  STEP 2: User enters episode topic                                          │
│          ─────────────────────────                                          │
│          "The science of black holes"                                       │
│                                                                             │
│  STEP 3: System queries knowledge bases                                     │
│          ─────────────────────────────                                      │
│          ┌─────────────────────────────────────────────────┐               │
│          │  KNOWLEDGE BASE RESULTS                         │               │
│          │                                                 │               │
│          │  arXiv: 15 relevant papers found                │               │
│          │  ├── "Event Horizon Telescope Results" (2019)   │               │
│          │  ├── "Hawking Radiation Confirmed" (2021)       │               │
│          │  └── ... 13 more                                │               │
│          │                                                 │               │
│          │  NASA: 8 data sources found                     │               │
│          │  ├── Sagittarius A* measurements                │               │
│          │  └── ... 7 more                                 │               │
│          │                                                 │               │
│          │  Experts: 3 interview transcripts available     │               │
│          └─────────────────────────────────────────────────┘               │
│                                                                             │
│  STEP 4: User sees "Sources Preview" panel                                  │
│          ───────────────────────────────                                    │
│          Can select which sources to prioritize                             │
│          Can add custom sources (PDFs, URLs)                                │
│                                                                             │
│  STEP 5: Generation happens with facts injected                             │
│          ─────────────────────────────────────                              │
│          LLM receives:                                                      │
│          ├── Verified facts as source material                              │
│          ├── Citation format instructions                                   │
│          └── User's topic                                                   │
│                                                                             │
│  STEP 6: User reviews with citation view                                    │
│          ────────────────────────────────                                   │
│          ┌─────────────────────────────────────────────────┐               │
│          │  GENERATED SCRIPT                               │               │
│          │                                                 │               │
│          │  "Black holes are regions where gravity is      │               │
│          │   so strong that nothing escapes [1]. The       │               │
│          │   event horizon marks the point of no           │               │
│          │   return [2]."                                  │               │
│          │                                                 │               │
│          │  CITATIONS:                                     │               │
│          │  [1] Hawking, S. (1974). Nature.                │               │
│          │  [2] Event Horizon Telescope (2019). ApJL.      │               │
│          │                                                 │               │
│          │  CONFIDENCE: 94% verified                       │               │
│          │  ⚠️ 1 claim needs verification (line 45)         │               │
│          └─────────────────────────────────────────────────┘               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 12.5 Canon Manager vs Facts: When Which?

| Question | Answer |
|----------|--------|
| "What happened to John?" | → **Canon Manager** (internal story memory) |
| "Is Sarah alive?" | → **Canon Manager** (immutable events check) |
| "What's Sarah's current emotion?" | → **Canon Manager** (character_states) |
| "What's the speed of light?" | → **Facts** (knowledge base) |
| "What happened at the UN today?" | → **Facts** (news feeds) |
| "Who discovered black holes?" | → **Facts** (citations) |
| "Did our characters meet Einstein?" | → **Canon** (timeline establishment) + **Facts** (Einstein data) |

---

## 13. Next Steps

### Learn More

- **[ARCHITECTURE.md](../../specs/phase-10-canon-management/ARCHITECTURE.md)** - Complete system architecture
- **[FILM-1003-continuity-validator.yaml](../specs/phase-10-canon-management/lib/FILM-1003-continuity-validator.yaml)** - All 9 validation rules in detail
- **[FILM-1006-llm-role-separation.yaml](../specs/phase-10-canon-management/prompts/FILM-1006-llm-role-separation.yaml)** - Role pipeline algorithms

### Hands-On Practice

1. **Create a SERIES project** with Canon Management enabled
2. **Generate 3 episodes**, observing how canon accumulates
3. **Try to violate canon** by referencing a dead character
4. **Create a FACTUAL project** and see citation requirements
5. **Link two MOVIE projects** as a sequel

### Implementation Checklist

For developers extending the system:

- [ ] Knowledge Base API integration for factual content
- [ ] Real-time news feed integration
- [ ] Citation formatting by style (APA, MLA, Chicago)
- [ ] Custom validation rules for content type
- [ ] Sequel linking UI in project settings
- [ ] Season generation with roadmap validation

---

## Summary

The Canon Management System provides:

| Component | Purpose |
|-----------|---------|
| **6 Database Tables** | Persistent narrative state storage |
| **9 Validation Rules** | Prevent common LLM storytelling failures |
| **Memory Context Builder** | Token-budgeted context assembly |
| **LLM Role Pipeline** | Separated concerns for better output |
| **UI Components** | User-friendly canon management |
| **Content Type Strategies** | Adapted behavior for movies, series, factual, news |
| **System Integration** | Seamless connection with season/episode generation |

### Content Type Summary

| Type | Canon | Facts | Key Feature |
|------|-------|-------|-------------|
| **Movies** | Intra-movie only | Optional | Act-based compression |
| **Sequels** | Inherited from parent | Optional | Cross-project linking |
| **Series (Serialized)** | Full tracking | Optional | Thread enforcement |
| **Series (Episodic)** | Two-tier (A/B plots) | Optional | Partial reset |
| **Factual** | None | Required | Citation pipeline |
| **News** | None | Real-time | Source verification |

**Key Takeaway**: The CMS is not one-size-fits-all. It adapts its behavior based on content type, providing full narrative memory for fiction while switching to fact-verification mode for non-fiction content.

---

*Tutorial created for the Storybook platform - Phase 10: Canon Management System*
