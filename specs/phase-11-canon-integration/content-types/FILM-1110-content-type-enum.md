---
id: FILM-1110
title: Content Type Configurations
status: done
priority: high
effort: S
dependencies: []
---

# FILM-1110: Content Type Configurations

## Overview

Create content-type-specific configurations that integrate with the **existing** `ProjectTypeSchema` to provide different canon management rules, memory strategies, and validation behaviors per project type.

> [!IMPORTANT]
> This spec has been revised based on codebase research. The existing `projectType` field in `settings` JSONB is used instead of adding a new database column.

## Current System

**Existing Schema:** `packages/features/film-studio-schemas/src/project.ts`

```typescript
export const ProjectTypeSchema = z.enum([
  'short-film',   // Standalone short content
  'series',       // Multi-episode content
  'documentary',  // Non-fiction storytelling
  'ad',           // Commercial/promotional
  'educational',  // Learning content
]);
```

**Storage:** `projects.metadata.projectType` (JSONB column)

---

## Solution

### 1. Extend ProjectTypeSchema (Optional)

If needed, add `'news'` for live news content:

```typescript
// packages/features/film-studio-schemas/src/project.ts
export const ProjectTypeSchema = z.enum([
  'short-film',
  'series',
  'documentary',
  'ad',
  'educational',
  'news',  // NEW - for live news content
]);
```

### 2. Create Content Type Configuration Mapping

```typescript
// packages/features/episodes/src/lib/canon/content-type-configs.ts

import type { ProjectType } from '@kit/film-studio-schemas/project';

export type DecayFunction = 'linear' | 'exponential' | 'topic_match' | 'none';

export interface ContentTypeConfig {
  /** Number of episodes/acts to include in memory context */
  memoryHorizon: number;
  
  /** How memory priority decays over time */
  decayFunction: DecayFunction;
  
  /** Token budget allocation percentages */
  allocations: {
    events: number;
    characters: number;
    world: number;
    threads: number;
    summaries: number;
    facts?: number;
    external?: number;
  };
  
  /** Validation strictness */
  enforcement: 'strict' | 'flexible' | 'none';
  
  /** Whether verified facts are required */
  requiresFacts: boolean;
  
  /** Whether external context providers are used */
  requiresExternalContext: boolean;
  
  /** LLM roles for generation pipeline */
  roles: string[];
}

/**
 * Configuration mapping for each project type
 */
export const CONTENT_TYPE_CONFIGS: Record<ProjectType, ContentTypeConfig> = {
  'short-film': {
    memoryHorizon: 10,
    decayFunction: 'exponential',
    allocations: { 
      events: 35, 
      characters: 25, 
      world: 15, 
      threads: 15, 
      summaries: 10 
    },
    enforcement: 'strict',
    requiresFacts: false,
    requiresExternalContext: false,
    roles: ['planner', 'writer', 'editor', 'stylist'],
  },
  
  'series': {
    memoryHorizon: 50,
    decayFunction: 'linear',
    allocations: { 
      events: 35, 
      characters: 25, 
      world: 10, 
      threads: 20, 
      summaries: 10 
    },
    enforcement: 'strict',
    requiresFacts: false,
    requiresExternalContext: false,
    roles: ['planner', 'writer', 'editor', 'stylist'],
  },
  
  'documentary': {
    memoryHorizon: 5,
    decayFunction: 'topic_match',
    allocations: { 
      events: 15, 
      characters: 10, 
      world: 10, 
      threads: 10, 
      summaries: 10,
      facts: 25,
      external: 20
    },
    enforcement: 'strict',
    requiresFacts: true,
    requiresExternalContext: true,
    roles: ['researcher', 'fact-checker', 'writer', 'stylist'],
  },
  
  'educational': {
    memoryHorizon: 5,
    decayFunction: 'topic_match',
    allocations: { 
      events: 20, 
      characters: 15, 
      world: 10, 
      threads: 20, 
      summaries: 15,
      facts: 20
    },
    enforcement: 'flexible',
    requiresFacts: true,
    requiresExternalContext: false,
    roles: ['researcher', 'writer', 'editor', 'stylist'],
  },
  
  'ad': {
    memoryHorizon: 1,
    decayFunction: 'none',
    allocations: { 
      events: 20, 
      characters: 40, 
      world: 20, 
      threads: 10, 
      summaries: 10 
    },
    enforcement: 'flexible',
    requiresFacts: false,
    requiresExternalContext: false,
    roles: ['writer', 'stylist'],
  },
  
  'news': {
    memoryHorizon: 1,  // 24 hours only
    decayFunction: 'none',
    allocations: { 
      events: 5, 
      characters: 5, 
      world: 5, 
      threads: 5, 
      summaries: 5,
      facts: 10,
      external: 65
    },
    enforcement: 'strict',
    requiresFacts: true,
    requiresExternalContext: true,
    roles: ['aggregator', 'fact-checker', 'anchor', 'producer'],
  },
};

/**
 * Get configuration for a project type
 */
export function getContentTypeConfig(projectType: ProjectType): ContentTypeConfig {
  return CONTENT_TYPE_CONFIGS[projectType] ?? CONTENT_TYPE_CONFIGS['series'];
}
```

---

## Integration with Memory Context Builder

Update `memory-context-builder.ts` to use content type configs:

```typescript
// packages/features/episodes/src/lib/canon/memory-context-builder.ts

import { getContentTypeConfig } from './content-type-configs';
import type { ProjectType } from '@kit/film-studio-schemas/project';

// In buildMemoryContext function:
export async function buildMemoryContext(input: BuildMemoryContextInput) {
  // Get project type from settings
  const projectType = await getProjectType(input.projectId);
  const config = getContentTypeConfig(projectType);
  
  // Use config for budget allocation
  const budgetAllocation = {
    immutableEvents: config.allocations.events / 100,
    characterStates: config.allocations.characters / 100,
    worldStates: config.allocations.world / 100,
    narrativeThreads: config.allocations.threads / 100,
    episodeSummaries: config.allocations.summaries / 100,
  };
  
  // Use memoryHorizon from config
  const memoryHorizon = config.memoryHorizon;
  
  // ...rest of implementation
}

/**
 * Get project type from settings
 */
async function getProjectType(projectId: string): Promise<ProjectType> {
  const client = getSupabaseServerClient();
  
  const { data } = await client
    .from('projects')
    .select('metadata')
    .eq('id', projectId)
    .single();
  
  const settings = data?.metadata as { projectType?: ProjectType } | null;
  return settings?.projectType ?? 'series';
}
```

---

## UI Integration

The existing project creation form already handles this. No changes needed to UI.

**Existing form location:** `apps/web/app/home/[account]/studio/projects/new/_components/create-film-project-form.tsx`

---

## Acceptance Criteria

- [x] `ContentTypeConfig` interface defined
- [x] `CONTENT_TYPE_CONFIGS` mapping created for all project types
- [x] `getContentTypeConfig()` helper function works
- [x] Memory context builder uses config for budget allocation
- [x] Project type retrieved from settings.projectType (not new column)
- [x] Optional: Add 'news' to ProjectTypeSchema if needed

---

## Testing

```typescript
describe('getContentTypeConfig', () => {
  it('returns documentary config with facts enabled', () => {
    const config = getContentTypeConfig('documentary');
    expect(config.requiresFacts).toBe(true);
    expect(config.requiresExternalContext).toBe(true);
    expect(config.roles).toContain('researcher');
  });

  it('returns series config as default', () => {
    const config = getContentTypeConfig('series');
    expect(config.memoryHorizon).toBe(50);
    expect(config.decayFunction).toBe('linear');
  });

  it('returns news config with external focus', () => {
    const config = getContentTypeConfig('news');
    expect(config.allocations.external).toBe(65);
    expect(config.memoryHorizon).toBe(1);
  });
});
```

---

## Estimated Effort

| Task | Time |
|------|------|
| Create content-type-configs.ts | 1 hour |
| Update memory-context-builder.ts | 2 hours |
| Add 'news' to schema (if needed) | 30 min |
| Testing | 1 hour |
| **Total** | **~4.5 hours** (S) |

---

## Dependencies

- None (uses existing ProjectTypeSchema)

## Blocks

- FILM-1111: Memory Strategy Integration
- FILM-1102: Memory Context Injection

---

## Implementation Status

**Implemented** in PR #176 — merged 2026-02-09
