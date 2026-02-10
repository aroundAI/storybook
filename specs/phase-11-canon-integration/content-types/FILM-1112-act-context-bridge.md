---
id: FILM-1112
title: Movie Act Context Bridge
status: done
priority: medium
effort: L
dependencies: [FILM-1110, FILM-1111]
---

# FILM-1112: Movie Act Context Bridge

## Overview

Implement a context bridge system for movies that carries narrative state between acts, solving the AI context loss problem in long-form content.

## Problem Statement

When generating a movie with AI:
- AI loses context between generation calls
- Characters reappear who died earlier
- Plot threads get lost between acts
- Emotional arcs reset unexpectedly
- Visual/location continuity breaks

Movies have 3-5 acts, each potentially a separate generation. Without a context bridge, each act would be generated in isolation.

## Solution

Create an "Act Context Bridge" that captures the complete state at the end of each act and injects it into the next act's generation.

---

## Act Structure Models

### Three-Act Structure (Default)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         THREE-ACT MOVIE STRUCTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │      ACT 1      │     │      ACT 2      │     │      ACT 3      │       │
│  │     Setup       │     │  Confrontation  │     │   Resolution    │       │
│  │   (25% runtime) │     │   (50% runtime) │     │   (25% runtime) │       │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘       │
│           │                       │                       │                │
│           ▼                       ▼                       ▼                │
│     ┌──────────┐           ┌──────────┐           ┌──────────┐             │
│     │ BRIDGE 1 │           │ BRIDGE 2 │           │  FINAL   │             │
│     │ Act1→Act2│           │ Act2→Act3│           │  STATE   │             │
│     └──────────┘           └──────────┘           └──────────┘             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Five-Act Structure (Epic/Drama)

```
ACT 1 (Exposition) → BRIDGE → ACT 2 (Rising Action) → BRIDGE → 
ACT 3 (Climax) → BRIDGE → ACT 4 (Falling Action) → BRIDGE → 
ACT 5 (Resolution) → FINAL STATE
```

---

## Data Model

### File: `packages/features/episodes/src/types/act-context.ts`

```typescript
/**
 * Complete state captured at the end of an act
 */
export interface ActContextBridge {
  // Identification
  movieId: string;          // Episode ID (movie treated as single episode)
  actNumber: number;        // 1-5
  actTitle: string;         // "Setup", "Confrontation", etc.
  
  // Timing
  actStartTime: number;     // Seconds into movie
  actEndTime: number;       // Seconds into movie
  
  // Character state at act end
  charactersAlive: string[];                    // Character IDs
  characterStates: Record<string, CharacterActState>;
  
  // Plot continuity
  openThreads: string[];                        // Thread IDs still open
  resolvedThreads: string[];                    // Threads resolved this act
  promises: PlotPromise[];                      // Setups made
  
  // Physical continuity
  currentLocation: LocationState;
  establishedProps: string[];
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  weatherCondition: string;
  
  // Emotional/tonal continuity
  toneVector: ToneVector;
  stakesLevel: number;                          // 1-10
  tensionLevel: number;                         // 1-10
  
  // For next act
  mustResolve: string[];                        // Thread IDs that MUST be addressed
  mustNotInclude: string[];                     // Character IDs that are dead
  setupsToPayoff: string[];                     // Promises needing resolution
  carryForwardContext: string;                  // Summary paragraph
}

interface CharacterActState {
  characterId: string;
  characterName: string;
  
  // Status
  isAlive: boolean;
  location: string;
  
  // Emotional arc
  emotionalState: string;
  emotionalIntensity: number;           // 1-10
  
  // Knowledge at act end
  knowsFacts: string[];
  doesNotKnow: string[];
  
  // Relationships changed this act
  relationshipChanges: Array<{
    targetCharacterId: string;
    fromState: string;
    toState: string;
  }>;
  
  // Physical state
  injuries: string[];
  appearance: string;
  hasProps: string[];
}

interface PlotPromise {
  id: string;
  description: string;
  madeInAct: number;
  expectedPayoffAct: number;            // Which act should resolve this
  priority: 'critical' | 'major' | 'minor';
}

interface LocationState {
  locationId: string;
  locationName: string;
  isDestroyed: boolean;
  presentCharacters: string[];
  establishedDetails: string[];         // "Rain on windows", "Fire in hearth"
}

interface ToneVector {
  humor: number;          // 0-1
  darkness: number;       // 0-1
  romance: number;        // 0-1
  action: number;         // 0-1
  suspense: number;       // 0-1
}
```

### Database Table

```sql
-- Store act context bridges for movies

CREATE TABLE act_context_bridges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Link to movie (episode with content_type=MOVIE)
  episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE NOT NULL,
  
  -- Act identification
  act_number INTEGER NOT NULL CHECK (act_number >= 1 AND act_number <= 5),
  act_title TEXT NOT NULL,
  
  -- Timing
  act_start_time INTEGER NOT NULL,      -- Seconds
  act_end_time INTEGER NOT NULL,
  
  -- Full context state (JSONB for flexibility)
  context_state JSONB NOT NULL,
  
  -- Text summary for LLM injection
  carry_forward_text TEXT NOT NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Unique per act per movie
  UNIQUE (episode_id, act_number)
);

CREATE INDEX idx_act_bridges_episode ON act_context_bridges(episode_id);
```

---

## Implementation

### File: `packages/features/episodes/src/lib/canon/act-context-bridge.ts`

```typescript
import type { ActContextBridge, CharacterActState } from '../types/act-context';

/**
 * Build context bridge from completed act
 */
export async function buildActContextBridge(
  episodeId: string,
  actNumber: number,
  actContent: string,
  supabase: SupabaseClient
): Promise<ActContextBridge> {
  
  // Use LLM to extract state from act content
  const { executeLLM } = await import('@kit/prompt-engine/server');
  
  const extraction = await executeLLM<{ bridge: ActContextBridge }>({
    templateSlug: 'act-context-extraction',
    variables: {
      act_content: actContent,
      act_number: actNumber,
    },
    context: { name: 'act-context-bridge' },
    supabaseClient: supabase,
  });
  
  const bridge = extraction.data.bridge;
  bridge.movieId = episodeId;
  bridge.actNumber = actNumber;
  
  // Store in database
  await supabase.from('act_context_bridges').upsert({
    episode_id: episodeId,
    act_number: actNumber,
    act_title: bridge.actTitle,
    act_start_time: bridge.actStartTime,
    act_end_time: bridge.actEndTime,
    context_state: bridge,
    carry_forward_text: bridge.carryForwardContext,
  });
  
  return bridge;
}

/**
 * Get context bridge for injecting into next act
 */
export async function getActContextBridge(
  episodeId: string,
  previousActNumber: number,
  supabase: SupabaseClient
): Promise<ActContextBridge | null> {
  
  const { data } = await supabase
    .from('act_context_bridges')
    .select('context_state')
    .eq('episode_id', episodeId)
    .eq('act_number', previousActNumber)
    .single();
  
  if (!data) return null;
  
  return data.context_state as ActContextBridge;
}

/**
 * Format bridge for LLM prompt injection
 */
export function formatBridgeForPrompt(bridge: ActContextBridge): string {
  const sections: string[] = [];
  
  // Characters alive
  sections.push(`## CHARACTERS AT END OF ACT ${bridge.actNumber}`);
  for (const [id, state] of Object.entries(bridge.characterStates)) {
    if (state.isAlive) {
      sections.push(`• ${state.characterName}: ${state.emotionalState} (at ${state.location})`);
      if (state.injuries.length > 0) {
        sections.push(`  Injuries: ${state.injuries.join(', ')}`);
      }
    }
  }
  
  // Dead characters (DO NOT INCLUDE)
  const dead = Object.values(bridge.characterStates).filter(s => !s.isAlive);
  if (dead.length > 0) {
    sections.push(`\n## DEAD CHARACTERS (DO NOT INCLUDE)`);
    dead.forEach(d => sections.push(`• ${d.characterName} - DECEASED`));
  }
  
  // Open plot threads
  if (bridge.openThreads.length > 0) {
    sections.push(`\n## UNRESOLVED PLOT THREADS`);
    bridge.promises.filter(p => !bridge.resolvedThreads.includes(p.id))
      .forEach(p => sections.push(`• ${p.description} (priority: ${p.priority})`));
  }
  
  // Current location
  sections.push(`\n## CURRENT SCENE STATE`);
  sections.push(`Location: ${bridge.currentLocation.locationName}`);
  sections.push(`Time: ${bridge.timeOfDay}`);
  if (bridge.currentLocation.establishedDetails.length > 0) {
    sections.push(`Details: ${bridge.currentLocation.establishedDetails.join(', ')}`);
  }
  
  // Tone
  sections.push(`\n## TONE CONTINUATION`);
  sections.push(`Stakes: ${bridge.stakesLevel}/10, Tension: ${bridge.tensionLevel}/10`);
  
  // Context summary
  sections.push(`\n## CARRY FORWARD`);
  sections.push(bridge.carryForwardContext);
  
  return sections.join('\n');
}

/**
 * Validate next act against bridge
 */
export function validateAgainstBridge(
  nextActContent: string,
  bridge: ActContextBridge
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  
  // Check for dead character resurrection
  const deadNames = Object.values(bridge.characterStates)
    .filter(s => !s.isAlive)
    .map(s => s.characterName.toLowerCase());
  
  for (const name of deadNames) {
    // Simple check - could be enhanced with NLP
    const pattern = new RegExp(`\\b${name}\\b.{0,30}(said|walked|ran|looked)`, 'i');
    if (pattern.test(nextActContent)) {
      violations.push(`Dead character "${name}" appears to be acting in next act`);
    }
  }
  
  return {
    valid: violations.length === 0,
    violations,
  };
}
```

---

## Act Context Extraction Prompt

### File: `packages/features/prompt-engine/src/prompts/movie/act-context-extraction.json`

```json
{
  "slug": "act-context-extraction",
  "name": "Extract Act End Context",
  "version": "1.0",
  "description": "Extracts complete narrative state from end of movie act",
  
  "llm": {
    "provider": "google",
    "model": "gemini-2.0-flash",
    "max_tokens": 3000,
    "temperature": 0.1
  },
  
  "system_prompt": "You are a script supervisor extracting the EXACT state at the end of a movie act. Be precise about:\n- Who is alive vs dead\n- Exact emotional states\n- What each character knows\n- Physical locations and props\n- Unresolved plot threads\n\nThis data will be used to maintain continuity in the next act.",
  
  "user_prompt": "Extract the complete state at the end of Act {{act_number}}:\n\n---\n{{{act_content}}}\n---",
  
  "output": {
    "type": "object",
    "wrapper_key": "bridge"
  }
}
```

---

## Acceptance Criteria

- [x] `ActContextBridge` type fully defined
- [x] `act_context_bridges` table created with migration
- [x] `buildActContextBridge` extracts state via LLM
- [x] `formatBridgeForPrompt` produces readable output
- [x] `validateAgainstBridge` catches dead character resurrection
- [x] Movie generation uses bridges between acts
- [x] Context is correctly populated for 3-act and 5-act structures

---

## Testing

### Unit Test

```typescript
describe('Act Context Bridge', () => {
  it('should format bridge for prompt correctly', () => {
    const bridge: ActContextBridge = {
      actNumber: 1,
      characterStates: {
        'char-1': {
          characterName: 'John',
          isAlive: false,
          emotionalState: 'deceased',
          // ... other fields
        },
        'char-2': {
          characterName: 'Sarah',
          isAlive: true,
          emotionalState: 'grieving',
          location: 'battlefield',
          // ...
        },
      },
      // ... other fields
    };
    
    const formatted = formatBridgeForPrompt(bridge);
    
    expect(formatted).toContain('Sarah: grieving');
    expect(formatted).toContain('DEAD CHARACTERS');
    expect(formatted).toContain('John - DECEASED');
  });
  
  it('should detect dead character resurrection', () => {
    const bridge: ActContextBridge = {
      characterStates: {
        'char-1': { characterName: 'John', isAlive: false },
      },
    };
    
    const nextAct = 'John walked into the room and said hello.';
    const result = validateAgainstBridge(nextAct, bridge);
    
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain('John');
  });
});
```

---

## Estimated Effort

| Task | Time |
|------|------|
| Define types | 45 min |
| Create database migration | 30 min |
| Implement bridge functions | 2 hours |
| Create extraction prompt | 45 min |
| Testing | 1.5 hours |
| **Total** | **~5.5 hours** |

---

## Dependencies

- **FILM-1110**: Content type enum
- **FILM-1111**: Memory strategies

## Blocks

- Movie content type generation pipeline

---

## Implementation Status

**Implemented** in PR #177 — merged 2026-02-09
