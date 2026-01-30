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

## 10. Next Steps

### Learn More

- **[ARCHITECTURE.md](../../specs/phase-10-canon-management/ARCHITECTURE.md)** - Complete system architecture
- **[FILM-1003-continuity-validator.md](../../specs/phase-10-canon-management/lib/FILM-1003-continuity-validator.md)** - All 9 validation rules in detail
- **[FILM-1006-llm-role-separation.md](../../specs/phase-10-canon-management/prompts/FILM-1006-llm-role-separation.md)** - Role pipeline algorithms

### Hands-On Practice

1. **Create a test project** with Canon Management enabled
2. **Add 3 immutable events** (death, world_fact, relationship)
3. **Create a narrative thread** with promises
4. **Generate an episode** and observe validation feedback
5. **Intentionally violate** a canon rule to see error handling

### Advanced Topics

- Custom validation rules for your content type
- Extending the Memory Context Builder
- Building custom Canon UI dashboards
- Integration with external content management systems

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

**Key Takeaway**: The CMS transforms AI content generation from a "hope for the best" approach to a structured, validated, and auditable process that maintains narrative integrity across episodes.

---

*Tutorial created for the Storybook platform - Phase 10: Canon Management System*
