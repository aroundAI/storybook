---
id: FILM-1113
title: Movie Sequel Linking System
status: 🟡 PARTIAL
audited: 2026-09-23
priority: medium
effort: M
dependencies: [FILM-1110, FILM-1111]
---

# FILM-1113: Movie Sequel Linking System

## Overview

Enable movies to be linked as sequels to one or more parent movies, inheriting their canon (immutable events, character states, resolved threads) while allowing new narrative development.

## Problem Statement

When creating a movie sequel:
- Parent movie's canon must be respected (dead characters stay dead)
- Character development carries forward
- Resolved threads shouldn't be reopened without justification
- Visual continuity (character appearance, locations) should reference parents
- Need to handle crossovers (multiple parent movies)

## Solution

Add sequel linking to projects with automatic canon inheritance and a parent context builder.

---

## Data Model

### Database Changes

Already added in FILM-1110:
```sql
ALTER TABLE projects ADD COLUMN sequel_of UUID[] DEFAULT '{}';
```

Additional table for cached parent context:

```sql
CREATE TABLE sequel_parent_contexts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- The sequel project
  sequel_project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  
  -- Parent project
  parent_project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  
  -- Cached parent canon (computed at sequel creation)
  parent_summary TEXT NOT NULL,
  parent_immutable_events JSONB NOT NULL DEFAULT '[]',
  parent_final_character_states JSONB NOT NULL DEFAULT '{}',
  parent_resolved_threads JSONB NOT NULL DEFAULT '[]',
  parent_world_facts JSONB NOT NULL DEFAULT '[]',
  
  -- Visual continuity references
  character_visual_registry JSONB NOT NULL DEFAULT '{}',
  location_registry JSONB NOT NULL DEFAULT '[]',
  
  -- Cache metadata
  cached_at TIMESTAMPTZ DEFAULT now(),
  parent_last_updated TIMESTAMPTZ,
  is_stale BOOLEAN DEFAULT false,
  
  UNIQUE (sequel_project_id, parent_project_id)
);

CREATE INDEX idx_sequel_contexts_sequel ON sequel_parent_contexts(sequel_project_id);
```

---

## Implementation

### File: `packages/features/episodes/src/lib/canon/sequel-system.ts`

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Parent context for sequel inheritance
 */
export interface ParentContext {
  parentProjectId: string;
  parentTitle: string;
  
  // Summary for LLM context
  summary: string;
  
  // Inherited canon
  immutableEvents: Array<{
    eventType: string;
    eventKey: string;
    description: string;
  }>;
  
  finalCharacterStates: Record<string, {
    characterName: string;
    isAlive: boolean;
    lastEmotionalState: string;
    lastKnownLocation: string;
    finalAppearance: string;
  }>;
  
  resolvedThreads: Array<{
    threadName: string;
    resolution: string;
  }>;
  
  worldFacts: Array<{
    fact: string;
    established: string;
  }>;
  
  // Visual references
  characterVisualRegistry: Record<string, {
    characterName: string;
    baseDescription: string;
    lastAppearance: string;
    distinctiveFeatures: string[];
  }>;
  
  locationRegistry: Array<{
    locationName: string;
    description: string;
    destroyed: boolean;
  }>;
}

/**
 * Link a project as a sequel to parent(s)
 */
export async function linkAsSequel(
  sequelProjectId: string,
  parentProjectIds: string[],
  supabase: SupabaseClient
): Promise<void> {
  // Validate project exists and is MOVIE_SEQUEL type
  const { data: sequel } = await supabase
    .from('projects')
    .select('content_type')
    .eq('id', sequelProjectId)
    .single();
  
  if (sequel?.content_type !== 'MOVIE_SEQUEL') {
    throw new Error('Project must be MOVIE_SEQUEL type to link parents');
  }
  
  // Update sequel_of column
  await supabase
    .from('projects')
    .update({ sequel_of: parentProjectIds })
    .eq('id', sequelProjectId);
  
  // Build and cache parent contexts
  for (const parentId of parentProjectIds) {
    const context = await buildParentContext(parentId, supabase);
    
    await supabase.from('sequel_parent_contexts').upsert({
      sequel_project_id: sequelProjectId,
      parent_project_id: parentId,
      parent_summary: context.summary,
      parent_immutable_events: context.immutableEvents,
      parent_final_character_states: context.finalCharacterStates,
      parent_resolved_threads: context.resolvedThreads,
      parent_world_facts: context.worldFacts,
      character_visual_registry: context.characterVisualRegistry,
      location_registry: context.locationRegistry,
      cached_at: new Date().toISOString(),
    });
  }
}

/**
 * Build parent context from completed movie
 */
export async function buildParentContext(
  parentProjectId: string,
  supabase: SupabaseClient
): Promise<ParentContext> {
  // Get project info
  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', parentProjectId)
    .single();
  
  // Get immutable events
  const { data: immutableEvents } = await supabase
    .from('immutable_events')
    .select('event_type, event_key, description')
    .eq('project_id', parentProjectId);
  
  // Get final character states (latest per character)
  const { data: characters } = await supabase
    .from('assets')
    .select('id, name')
    .eq('project_id', parentProjectId)
    .eq('type', 'character');
  
  const finalCharacterStates: Record<string, any> = {};
  if (characters) {
    for (const char of characters) {
      const { data: lastState } = await supabase
        .from('character_states')
        .select('*')
        .eq('character_id', char.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      // Check if character died
      const isDead = immutableEvents?.some(
        e => e.event_type === 'death' && e.event_key.includes(char.id)
      );
      
      finalCharacterStates[char.id] = {
        characterName: char.name,
        isAlive: !isDead,
        lastEmotionalState: lastState?.state_value?.state ?? 'unknown',
        lastKnownLocation: lastState?.state_value?.location ?? 'unknown',
        finalAppearance: '', // Would come from visual assets
      };
    }
  }
  
  // Get resolved narrative threads
  const { data: resolvedThreads } = await supabase
    .from('narrative_threads')
    .select('thread_name, payoffs')
    .eq('project_id', parentProjectId)
    .eq('status', 'resolved');
  
  // Get episode summary (for movie, there's one main "episode")
  const { data: summary } = await supabase
    .from('episode_summaries')
    .select('summary_text')
    .eq('project_id', parentProjectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  return {
    parentProjectId,
    parentTitle: project?.name ?? 'Unknown',
    summary: summary?.summary_text ?? 'No summary available',
    immutableEvents: immutableEvents ?? [],
    finalCharacterStates,
    resolvedThreads: resolvedThreads?.map(t => ({
      threadName: t.thread_name,
      resolution: t.payoffs?.[0] ?? 'resolved',
    })) ?? [],
    worldFacts: immutableEvents?.filter(e => e.event_type === 'world_fact')
      .map(e => ({ fact: e.description, established: 'parent movie' })) ?? [],
    characterVisualRegistry: {}, // Populated from visual assets
    locationRegistry: [],
  };
}

/**
 * Get combined parent contexts for sequel
 */
export async function getSequelParentContexts(
  sequelProjectId: string,
  supabase: SupabaseClient
): Promise<ParentContext[]> {
  const { data } = await supabase
    .from('sequel_parent_contexts')
    .select('*')
    .eq('sequel_project_id', sequelProjectId);
  
  if (!data) return [];
  
  return data.map(row => ({
    parentProjectId: row.parent_project_id,
    parentTitle: '', // Would need join
    summary: row.parent_summary,
    immutableEvents: row.parent_immutable_events,
    finalCharacterStates: row.parent_final_character_states,
    resolvedThreads: row.parent_resolved_threads,
    worldFacts: row.parent_world_facts,
    characterVisualRegistry: row.character_visual_registry,
    locationRegistry: row.location_registry,
  }));
}

/**
 * Format parent contexts for LLM prompt injection
 */
export function formatParentContextsForPrompt(
  contexts: ParentContext[]
): string {
  if (contexts.length === 0) return '';
  
  const sections: string[] = [];
  
  sections.push('## PARENT MOVIE CANON');
  sections.push('The following is established from the parent movie(s) and MUST be respected:\n');
  
  for (const ctx of contexts) {
    sections.push(`### From "${ctx.parentTitle}"`);
    sections.push(ctx.summary);
    sections.push('');
    
    // Dead characters
    const dead = Object.values(ctx.finalCharacterStates).filter(c => !c.isAlive);
    if (dead.length > 0) {
      sections.push('**DECEASED CHARACTERS (DO NOT RESURRECT):**');
      dead.forEach(c => sections.push(`- ${c.characterName}`));
    }
    
    // Living characters with their final states
    const alive = Object.values(ctx.finalCharacterStates).filter(c => c.isAlive);
    if (alive.length > 0) {
      sections.push('\n**RETURNING CHARACTERS:**');
      alive.forEach(c => {
        sections.push(`- ${c.characterName}: was ${c.lastEmotionalState}, last seen at ${c.lastKnownLocation}`);
      });
    }
    
    // Resolved threads
    if (ctx.resolvedThreads.length > 0) {
      sections.push('\n**RESOLVED PLOT THREADS:**');
      ctx.resolvedThreads.forEach(t => {
        sections.push(`- ${t.threadName}: ${t.resolution}`);
      });
    }
  }
  
  return sections.join('\n');
}
```

---

## Acceptance Criteria

- [x] `sequel_parent_contexts` table created
- [ ] `linkAsSequel` function works for single and multiple parents — *audit: unverified* — never called in the product and untested; tests cover `formatParentContextsForPrompt` only
- [ ] Parent context correctly identifies dead vs alive characters — *audit: unverified* — logic at `packages/features/episodes/src/lib/canon/sequel-system.ts:302`; no test exercises `buildParentContext`
- [ ] Parent immutable events inherited to sequel validation — *audit: no longer true* — no validator or generation path reads parent contexts; `getSequelParentContexts` has no caller since 15f9940f
- [x] `formatParentContextsForPrompt` produces readable output
- [x] Crossover movies (2+ parents) merge contexts correctly
- [ ] UI allows selecting parent movies when type=MOVIE_SEQUEL — *audit: no longer true* — no parent selector exists in `apps/`; `ProjectTypeSchema` has no sequel type (`packages/features/film-studio-schemas/src/project.ts:6`)

---

## UI Integration

### Sequel Parent Selector

```tsx
// Show when content_type === 'MOVIE_SEQUEL'
{contentType === 'MOVIE_SEQUEL' && (
  <FormField
    name="sequelOf"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Parent Movie(s)</FormLabel>
        <MultiSelect
          options={availableMovies.map(m => ({
            value: m.id,
            label: m.name,
          }))}
          selected={field.value}
          onChange={field.onChange}
          placeholder="Select parent movies..."
        />
        <FormDescription>
          Select the movie(s) this is a sequel to. For crossovers, select multiple.
        </FormDescription>
      </FormItem>
    )}
  />
)}
```

---

## Testing

### Unit Test

```typescript
describe('Sequel System', () => {
  it('should build parent context with dead characters', async () => {
    // Setup parent movie with death event
    await supabase.from('immutable_events').insert({
      project_id: parentMovieId,
      event_type: 'death',
      event_key: `character:${characterId}:dead`,
      description: 'Hero died saving the world',
    });
    
    const context = await buildParentContext(parentMovieId, supabase);
    
    expect(context.finalCharacterStates[characterId].isAlive).toBe(false);
  });
  
  it('should format multiple parent contexts', () => {
    const contexts: ParentContext[] = [
      { parentTitle: 'Movie 1', finalCharacterStates: {...} },
      { parentTitle: 'Movie 2', finalCharacterStates: {...} },
    ];
    
    const formatted = formatParentContextsForPrompt(contexts);
    
    expect(formatted).toContain('From "Movie 1"');
    expect(formatted).toContain('From "Movie 2"');
  });
});
```

---

## Estimated Effort

| Task | Time |
|------|------|
| Database migration | 20 min |
| Implement sequel-system.ts | 2 hours |
| UI for parent selection | 45 min |
| Testing | 1 hour |
| **Total** | **~4 hours** |

---

## Dependencies

- **FILM-1110**: Content type enum with MOVIE_SEQUEL
- **FILM-1111**: Memory strategies with parent context allocation

## Blocks

- Sequel movie generation pipeline

---

## Implementation Status

**🟡 PARTIAL** (audit 2026-09-23; was **Implemented** in PR #177 — merged 2026-02-09)

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Sequel linking reachable in the product | No UI, action or generation path calls `linkAsSequel`, `buildParentContext` or `getSequelParentContexts` | owner |
| Parent canon inherited to sequel validation | Nothing reads `sequel_parent_contexts` | owner |
