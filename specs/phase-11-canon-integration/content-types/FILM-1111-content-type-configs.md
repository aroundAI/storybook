---
id: FILM-1111
title: Content Type Configurations and Memory Strategies
status: 🟡 PARTIAL
audited: 2026-09-23
priority: high
effort: M
dependencies: [FILM-1110]
---

# FILM-1111: Content Type Configurations and Memory Strategies

## Overview

Implement the memory context building strategies for each content type, including different token allocations, decay factors, and context assembly logic.

## Problem Statement

Current memory context builder uses a single strategy for all content. Different content types need:
- Movies: More context for current act, less for earlier acts
- Hard narrative series: Full season context with compression
- Episodic series: Rolling window with callbacks
- Documentary: Topic-based rather than timeline-based
- News: No history, only current sources

## Solution

Create content-type-specific memory strategies that the Memory Context Builder uses based on project configuration.

---

## Memory Strategy Definitions

### Strategy Comparison

| Content Type | Memory Horizon | Context Focus | Decay Model |
|--------------|----------------|---------------|-------------|
| MOVIE | 10 scenes | Current act | Linear within act |
| MOVIE_SEQUEL | Full parent movie | Parent summary + current | Parent = summary only |
| SERIES_HARD | 50 episodes | Full story arc | Exponential (0.95^n) |
| SERIES_EPISODIC | 10 episodes | Recent + callbacks | Linear (0.8^n) |
| DOCUMENTARY | 5 episodes | Topic relevance | By topic match score |
| NEWS | 0 (live only) | Current sources | No history |

---

## Implementation

### File: `packages/features/episodes/src/lib/canon/memory-strategies.ts`

```typescript
import type { ContentType, ContentTypeConfig } from '../types/content-types';
import { getContentTypeConfig } from '../types/content-types';

/**
 * Memory allocation breakdown per content type
 */
export interface MemoryAllocation {
  immutableEvents: number;  // Percentage
  characterStates: number;
  worldStates: number;
  narrativeThreads: number;
  episodeSummaries: number;
  parentContext: number;    // For sequels
  sourcesCitations: number; // For documentary/news
}

/**
 * Default memory allocations per content type
 */
export const MEMORY_ALLOCATIONS: Record<ContentType, MemoryAllocation> = {
  MOVIE: {
    immutableEvents: 30,
    characterStates: 30,
    worldStates: 10,
    narrativeThreads: 15,
    episodeSummaries: 15,
    parentContext: 0,
    sourcesCitations: 0,
  },
  
  MOVIE_SEQUEL: {
    immutableEvents: 25,
    characterStates: 20,
    worldStates: 5,
    narrativeThreads: 10,
    episodeSummaries: 10,
    parentContext: 30, // Significant allocation for parent movie
    sourcesCitations: 0,
  },
  
  SERIES_HARD: {
    immutableEvents: 35,
    characterStates: 25,
    worldStates: 10,
    narrativeThreads: 20,
    episodeSummaries: 10,
    parentContext: 0,
    sourcesCitations: 0,
  },
  
  SERIES_EPISODIC: {
    immutableEvents: 35,
    characterStates: 25,
    worldStates: 10,
    narrativeThreads: 15,
    episodeSummaries: 15,
    parentContext: 0,
    sourcesCitations: 0,
  },
  
  DOCUMENTARY: {
    immutableEvents: 10,
    characterStates: 5,
    worldStates: 5,
    narrativeThreads: 10,
    episodeSummaries: 20,
    parentContext: 0,
    sourcesCitations: 50, // Majority for verified facts
  },
  
  NEWS: {
    immutableEvents: 0,
    characterStates: 0,
    worldStates: 0,
    narrativeThreads: 0,
    episodeSummaries: 0,
    parentContext: 0,
    sourcesCitations: 100, // All for current sources
  },
};

/**
 * Decay function types
 */
export type DecayFunction = 'linear' | 'exponential' | 'topic_match' | 'none';

/**
 * Get decay factor for episode distance
 */
export function getDecayFactor(
  contentType: ContentType,
  episodeDistance: number
): number {
  const config = getContentTypeConfig(contentType);
  
  switch (contentType) {
    case 'MOVIE':
    case 'MOVIE_SEQUEL':
      // Linear decay within act
      return Math.max(0.3, 1 - (episodeDistance * 0.1));
      
    case 'SERIES_HARD':
      // Gentle exponential - keep more history
      return Math.pow(0.95, episodeDistance);
      
    case 'SERIES_EPISODIC':
      // Steeper decay - focus on recent
      return Math.pow(0.8, episodeDistance);
      
    case 'DOCUMENTARY':
      // No distance decay - use topic relevance instead
      return 1.0;
      
    case 'NEWS':
      // No history at all
      return 0;
      
    default:
      return Math.pow(0.9, episodeDistance);
  }
}

/**
 * Memory context options per content type
 */
export interface ContentTypeMemoryOptions {
  maxTokenPercentage: number;
  contextWindowSize: number;
  memoryHorizon: number;
  allocation: MemoryAllocation;
  decayFunction: DecayFunction;
  includeParentContext: boolean;
  includeSources: boolean;
}

/**
 * Get memory options for content type
 */
export function getMemoryOptionsForContentType(
  contentType: ContentType,
  contextWindowSize: number = 40000
): ContentTypeMemoryOptions {
  const config = getContentTypeConfig(contentType);
  const allocation = MEMORY_ALLOCATIONS[contentType];
  
  let decayFunction: DecayFunction = 'exponential';
  if (contentType === 'DOCUMENTARY') decayFunction = 'topic_match';
  if (contentType === 'NEWS') decayFunction = 'none';
  if (contentType === 'MOVIE' || contentType === 'MOVIE_SEQUEL') decayFunction = 'linear';
  
  return {
    maxTokenPercentage: config.contextWindowPercent,
    contextWindowSize,
    memoryHorizon: config.memoryHorizon,
    allocation,
    decayFunction,
    includeParentContext: contentType === 'MOVIE_SEQUEL',
    includeSources: config.requiresCitations,
  };
}

/**
 * Priority scoring for items in memory context
 */
export interface PriorityScore {
  score: number;      // 0-1
  reason: string;
  include: boolean;
}

/**
 * Calculate priority score for an item
 */
export function calculatePriority(
  item: { createdAt: Date; importance?: number; mentions?: number },
  currentEpisode: number,
  itemEpisode: number,
  contentType: ContentType
): PriorityScore {
  const distance = currentEpisode - itemEpisode;
  const decayFactor = getDecayFactor(contentType, distance);
  
  // Base score from recency
  let score = decayFactor;
  
  // Boost for importance
  if (item.importance) {
    score = score * 0.6 + (item.importance / 10) * 0.4;
  }
  
  // Boost for frequently mentioned items
  if (item.mentions && item.mentions > 3) {
    score = Math.min(1.0, score * 1.2);
  }
  
  const include = score > 0.1; // Minimum threshold
  
  return {
    score,
    reason: `decay=${decayFactor.toFixed(2)}, distance=${distance}`,
    include,
  };
}
```

### Integrate with Memory Context Builder

Update `buildMemoryContext` to use content-type strategies:

```typescript
// In memory-context-builder.ts

import { 
  getMemoryOptionsForContentType, 
  calculatePriority,
  MEMORY_ALLOCATIONS 
} from './memory-strategies';

export async function buildMemoryContext(
  projectId: string,
  episodeNumber: number,
  options?: Partial<MemoryContextOptions>
): Promise<MemoryContext> {
  
  // Get project content type
  const { data: project } = await client
    .from('projects')
    .select('content_type, sequel_of')
    .eq('id', projectId)
    .single();
  
  const contentType = project?.content_type ?? 'SERIES_EPISODIC';
  
  // Get content-type specific options
  const typeOptions = getMemoryOptionsForContentType(contentType);
  
  // Merge with user-provided options
  const finalOptions = {
    ...typeOptions,
    ...options,
  };
  
  // Apply allocation percentages
  const allocation = MEMORY_ALLOCATIONS[contentType];
  const totalBudget = Math.floor(
    finalOptions.contextWindowSize * (finalOptions.maxTokenPercentage / 100)
  );
  
  const budgets = {
    immutable: Math.floor(totalBudget * (allocation.immutableEvents / 100)),
    characters: Math.floor(totalBudget * (allocation.characterStates / 100)),
    world: Math.floor(totalBudget * (allocation.worldStates / 100)),
    threads: Math.floor(totalBudget * (allocation.narrativeThreads / 100)),
    summaries: Math.floor(totalBudget * (allocation.episodeSummaries / 100)),
    parent: Math.floor(totalBudget * (allocation.parentContext / 100)),
    sources: Math.floor(totalBudget * (allocation.sourcesCitations / 100)),
  };
  
  // Build context with type-specific logic
  // ... rest of implementation
}
```

---

## Acceptance Criteria

- [x] `memory-strategies.ts` created with all exports
- [x] `MEMORY_ALLOCATIONS` defined for all 6 content types
- [x] `getDecayFactor` returns correct value per type
- [x] `getMemoryOptionsForContentType` works for all types
- [ ] `buildMemoryContext` uses content-type strategies — *audit: no longer true* — strategies apply only when `projectType` is passed, and no caller passes it; scoring and decay are never used
- [x] Unit tests for all decay functions
- [x] Documentary type allocates 50% to sources
- [ ] News type has zero memory horizon — *audit: no longer true* — news horizon is 1 (`packages/features/episodes/src/lib/canon/content-type-configs.ts:168`); its memory allocations are all 0 instead

---

## Testing

### Unit Test

```typescript
describe('Memory Strategies', () => {
  describe('getDecayFactor', () => {
    it('SERIES_HARD should decay slowly', () => {
      const factor = getDecayFactor('SERIES_HARD', 10);
      expect(factor).toBeGreaterThan(0.5); // 0.95^10 ≈ 0.60
    });
    
    it('SERIES_EPISODIC should decay faster', () => {
      const factor = getDecayFactor('SERIES_EPISODIC', 10);
      expect(factor).toBeLessThan(0.2); // 0.8^10 ≈ 0.11
    });
    
    it('NEWS should have no memory', () => {
      const factor = getDecayFactor('NEWS', 1);
      expect(factor).toBe(0);
    });
  });
  
  describe('MEMORY_ALLOCATIONS', () => {
    it('DOCUMENTARY should prioritize sources', () => {
      expect(MEMORY_ALLOCATIONS.DOCUMENTARY.sourcesCitations).toBe(50);
    });
    
    it('MOVIE_SEQUEL should include parent context', () => {
      expect(MEMORY_ALLOCATIONS.MOVIE_SEQUEL.parentContext).toBe(30);
    });
  });
});
```

---

## Estimated Effort

| Task | Time |
|------|------|
| Create memory-strategies.ts | 1 hour |
| Integrate with buildMemoryContext | 1.5 hours |
| Testing | 1 hour |
| **Total** | **~3.5 hours** |

---

## Dependencies

- **FILM-1110**: Content type enum defined

## Blocks

- **FILM-1112**: Act context bridge uses strategies
- **FILM-1113**: Sequel system uses parent context allocation

---

## Implementation Status

**🟡 PARTIAL** (audit 2026-09-23; was **Implemented** in PR #176 — merged 2026-02-09)

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| `buildMemoryContext` uses content-type strategies | Same gap as FILM-1110: no caller passes `projectType`; `calculatePriority` and `getDecayFactor` are reached only from tests | unassigned |
| News type has zero memory horizon | Horizon is 1; memory is zeroed by allocation and decay instead | owner (accept, or change the config) |
