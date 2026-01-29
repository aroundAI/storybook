---
id: FILM-1005
title: Canon Server Actions
status: draft
effort: M
dependencies: [FILM-1003, FILM-1004]
---

# FILM-1005: Canon Server Actions

## Overview

Server actions for CRUD operations on canon management tables.

## File Location

`packages/features/episodes/src/server/canon-actions.ts`

---

## Actions

### `addImmutableEventAction`

Register a new immutable canon event.

```typescript
export const addImmutableEventAction = enhanceAction(
  async (data) => {
    // 1. Validate event doesn't conflict with existing
    const existing = await client
      .from('immutable_events')
      .select('id')
      .eq('project_id', data.projectId)
      .eq('event_key', data.eventKey)
      .single();
    
    if (existing.data) {
      throw new Error('This event already exists in canon');
    }
    
    // 2. Insert new event
    const { data: event, error } = await client
      .from('immutable_events')
      .insert({
        project_id: data.projectId,
        event_type: data.eventType,
        event_key: data.eventKey,
        established_in: data.episodeId,
        season: data.season,
        episode_number: data.episodeNumber,
        description: data.description,
        metadata: data.metadata,
        created_by: user.id,
      })
      .select()
      .single();
    
    // 3. Create audit log
    await createAuditLog({
      action: 'create',
      objectType: 'immutable_event',
      objectId: event.id,
      // ...
    });
    
    return { success: true, data: event };
  },
  { schema: AddImmutableEventSchema }
);
```

---

### `updateCharacterStateAction`

Record a character state transition.

```typescript
export const updateCharacterStateAction = enhanceAction(
  async (data) => {
    // 1. Get previous state
    const { data: previousState } = await client
      .from('character_states')
      .select('*')
      .eq('character_id', data.characterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // 2. Validate authorization triplet
    if (!data.trigger || !data.cost || !data.newConstraints?.length) {
      throw new Error('State change requires trigger, cost, and constraints');
    }
    
    // 3. Insert new state (append-only)
    const { data: state, error } = await client
      .from('character_states')
      .insert({
        character_id: data.characterId,
        episode_id: data.episodeId,
        state_type: data.stateType,
        state_value: data.stateValue,
        trigger_event: data.trigger,
        cost: data.cost,
        new_constraints: data.newConstraints,
        previous_state_id: previousState?.id,
        created_by: user.id,
      })
      .select()
      .single();
    
    // 4. Record delta
    await client.from('state_deltas').insert({
      episode_id: data.episodeId,
      entity_type: 'character',
      entity_id: data.characterId,
      before_state: previousState?.state_value,
      after_state: data.stateValue,
      change_reason: data.trigger,
    });
    
    return { success: true, data: state };
  },
  { schema: UpdateCharacterStateSchema }
);
```

---

### `createNarrativeThreadAction`

Open a new plot thread.

```typescript
export const createNarrativeThreadAction = enhanceAction(
  async (data) => {
    const { data: thread, error } = await client
      .from('narrative_threads')
      .insert({
        project_id: data.projectId,
        thread_name: data.threadName,
        thread_type: data.threadType,
        status: 'open',
        opened_at: data.episodeId,
        episodes_touched: [data.episodeId],
        promises: data.initialPromises || [],
        description: data.description,
      })
      .select()
      .single();
    
    return { success: true, data: thread };
  },
  { schema: CreateNarrativeThreadSchema }
);
```

---

### `progressThreadAction`

Update thread progress.

```typescript
export const progressThreadAction = enhanceAction(
  async (data) => {
    const { data: thread, error } = await client
      .from('narrative_threads')
      .update({
        status: data.newStatus,
        resolved_at: data.newStatus === 'resolved' ? data.episodeId : null,
        episodes_touched: client.sql`array_append(episodes_touched, ${data.episodeId})`,
        payoffs: data.payoff 
          ? client.sql`array_append(payoffs, ${data.payoff})`
          : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.threadId)
      .select()
      .single();
    
    return { success: true, data: thread };
  },
  { schema: ProgressThreadSchema }
);
```

---

### `getProjectCanonAction`

Fetch all canon data for a project.

```typescript
export const getProjectCanonAction = enhanceAction(
  async (data) => {
    const [immutableEvents, characterStates, threads] = await Promise.all([
      client.from('immutable_events').select('*').eq('project_id', data.projectId),
      client.from('character_states')
        .select('*, character:assets(name)')
        .eq('character.project_id', data.projectId),
      client.from('narrative_threads').select('*').eq('project_id', data.projectId),
    ]);
    
    return {
      success: true,
      data: {
        immutableEvents: immutableEvents.data || [],
        characterStates: characterStates.data || [],
        threads: threads.data || [],
      },
    };
  },
  { schema: GetProjectCanonSchema }
);
```

---

### `getEpisodeContextAction`

Build memory context for episode generation.

```typescript
export const getEpisodeContextAction = enhanceAction(
  async (data) => {
    const context = await buildMemoryContext(
      data.projectId,
      data.episodeNumber,
      {
        maxTokenPercentage: data.maxTokenPercentage,
        memoryHorizon: data.memoryHorizon,
      }
    );
    
    return {
      success: true,
      data: {
        context,
        formattedPrompt: formatContextForPrompt(context),
        tokenBudget: context.tokenBudget,
      },
    };
  },
  { schema: GetEpisodeContextSchema }
);
```

---

## Schemas

```typescript
export const AddImmutableEventSchema = z.object({
  projectId: z.string().uuid(),
  eventType: z.enum(['death', 'world_fact', 'relationship', 'timeline', 'ability_loss', 'location_destruction']),
  eventKey: z.string().min(1),
  episodeId: z.string().uuid(),
  season: z.number().int().positive(),
  episodeNumber: z.number().int().positive(),
  description: z.string().min(10).max(500),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateCharacterStateSchema = z.object({
  characterId: z.string().uuid(),
  episodeId: z.string().uuid(),
  stateType: z.enum(['emotional', 'physical', 'relationship', 'knowledge', 'ability', 'location', 'goal']),
  stateValue: z.record(z.unknown()),
  trigger: z.string().min(1).max(200),
  cost: z.string().min(1).max(200),
  newConstraints: z.array(z.string()).min(1).max(5),
});

export const CreateNarrativeThreadSchema = z.object({
  projectId: z.string().uuid(),
  threadName: z.string().min(3).max(100),
  threadType: z.enum(['character_arc', 'mystery', 'relationship', 'world_building', 'conflict']),
  episodeId: z.string().uuid(),
  initialPromises: z.array(z.string()).optional(),
  description: z.string().min(10).max(500),
});

export const ProgressThreadSchema = z.object({
  threadId: z.string().uuid(),
  episodeId: z.string().uuid(),
  newStatus: z.enum(['open', 'progressing', 'resolved', 'abandoned']),
  payoff: z.string().optional(),
});

export const GetProjectCanonSchema = z.object({
  projectId: z.string().uuid(),
});

export const GetEpisodeContextSchema = z.object({
  projectId: z.string().uuid(),
  episodeNumber: z.number().int().positive(),
  maxTokenPercentage: z.number().min(5).max(25).optional(),
  memoryHorizon: z.number().int().min(1).max(50).optional(),
});
```

---

## Action Patterns

### Pattern 1: Conflict Detection on Insert

**Problem**: Prevent duplicate or conflicting immutable events.

```typescript
async function checkEventConflict(
  client: SupabaseClient,
  projectId: string,
  eventKey: string
): Promise<ConflictResult> {
  // Direct key match
  const exactMatch = await client
    .from('immutable_events')
    .select('id, event_key, description')
    .eq('project_id', projectId)
    .eq('event_key', eventKey)
    .single();
  
  if (exactMatch.data) {
    return {
      hasConflict: true,
      type: 'exact',
      conflictingEvent: exactMatch.data,
      suggestion: 'This exact event already exists in canon',
    };
  }
  
  // Semantic conflict check (e.g., character:x:alive vs character:x:dead)
  const [entityType, entityId, state] = eventKey.split(':');
  
  if (entityType === 'character' && ['alive', 'dead'].includes(state)) {
    const oppositeState = state === 'alive' ? 'dead' : 'alive';
    const oppositeKey = `character:${entityId}:${oppositeState}`;
    
    const semanticMatch = await client
      .from('immutable_events')
      .select('id, event_key, description')
      .eq('project_id', projectId)
      .eq('event_key', oppositeKey)
      .single();
    
    if (semanticMatch.data) {
      return {
        hasConflict: true,
        type: 'semantic',
        conflictingEvent: semanticMatch.data,
        suggestion: `Cannot set ${state} - character is already ${oppositeState}`,
      };
    }
  }
  
  return { hasConflict: false };
}
```

---

### Pattern 2: Optimistic Locking for Thread Updates

**Problem**: Prevent race conditions when multiple users update same thread.

```typescript
async function updateThreadWithLock(
  client: SupabaseClient,
  threadId: string,
  expectedVersion: number,
  updates: ThreadUpdate
): Promise<UpdateResult> {
  // Use version column for optimistic locking
  const { data, error } = await client
    .from('narrative_threads')
    .update({
      ...updates,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId)
    .eq('version', expectedVersion)  // Only update if version matches
    .select()
    .single();
  
  if (error?.code === 'PGRST116') {  // No rows returned
    return {
      success: false,
      error: 'CONFLICT',
      message: 'Thread was modified by another user. Please refresh and try again.',
    };
  }
  
  return { success: true, data };
}
```

---

### Pattern 3: Batch State Recording

**Problem**: Recording multiple character states from a single episode efficiently.

```typescript
export const batchUpdateCharacterStatesAction = enhanceAction(
  async (data) => {
    const { episodeId, stateChanges } = data;
    
    // 1. Validate all changes before any writes
    const validationResults = await Promise.all(
      stateChanges.map(change => validateStateChange(change))
    );
    
    const failures = validationResults.filter(r => !r.valid);
    if (failures.length > 0) {
      return {
        success: false,
        errors: failures.map(f => f.error),
      };
    }
    
    // 2. Get all previous states in single query
    const characterIds = stateChanges.map(c => c.characterId);
    const { data: previousStates } = await client
      .from('character_states')
      .select('*')
      .in('character_id', characterIds)
      .order('created_at', { ascending: false });
    
    // Group by character (get latest per character)
    const latestByCharacter = new Map<string, CharacterState>();
    for (const state of previousStates || []) {
      if (!latestByCharacter.has(state.character_id)) {
        latestByCharacter.set(state.character_id, state);
      }
    }
    
    // 3. Prepare batch inserts
    const stateInserts = stateChanges.map(change => ({
      character_id: change.characterId,
      episode_id: episodeId,
      state_type: change.stateType,
      state_value: change.stateValue,
      trigger_event: change.trigger,
      cost: change.cost,
      new_constraints: change.newConstraints,
      previous_state_id: latestByCharacter.get(change.characterId)?.id,
      created_by: user.id,
    }));
    
    const deltaInserts = stateChanges.map(change => ({
      episode_id: episodeId,
      entity_type: 'character',
      entity_id: change.characterId,
      before_state: latestByCharacter.get(change.characterId)?.state_value,
      after_state: change.stateValue,
      change_reason: change.trigger,
    }));
    
    // 4. Execute batch inserts in transaction
    const { data: states, error: stateError } = await client
      .from('character_states')
      .insert(stateInserts)
      .select();
    
    if (stateError) throw stateError;
    
    const { error: deltaError } = await client
      .from('state_deltas')
      .insert(deltaInserts);
    
    if (deltaError) throw deltaError;
    
    return { success: true, data: states, count: states.length };
  },
  { schema: BatchUpdateCharacterStatesSchema }
);
```

---

### Pattern 4: Audit Trail with Context

**Problem**: Track who changed what, when, and why.

```typescript
interface AuditEntry {
  id: string;
  action_type: 'create' | 'update' | 'delete';
  object_type: 'immutable_event' | 'character_state' | 'narrative_thread' | 'world_state';
  object_id: string;
  actor_id: string;
  timestamp: string;
  changes: {
    field: string;
    before: unknown;
    after: unknown;
  }[];
  context: {
    episodeId?: string;
    reason?: string;
    triggerAction?: string;
  };
}

async function createAuditLog(
  client: SupabaseClient,
  entry: Omit<AuditEntry, 'id' | 'timestamp'>
): Promise<void> {
  await client
    .from('canon_audit_log')
    .insert({
      ...entry,
      timestamp: new Date().toISOString(),
    });
}

// Usage in action:
await createAuditLog(client, {
  action_type: 'create',
  object_type: 'immutable_event',
  object_id: event.id,
  actor_id: user.id,
  changes: [
    { field: 'event_key', before: null, after: data.eventKey },
    { field: 'description', before: null, after: data.description },
  ],
  context: {
    episodeId: data.episodeId,
    reason: 'Story generation established this fact',
  },
});
```

---

### Pattern 5: Error Recovery with Rollback

**Problem**: If part of a multi-step canon update fails, ensure consistency.

```typescript
async function updateCanonWithRollback(
  data: CanonUpdateBundle
): Promise<CanonUpdateResult> {
  const rollbackStack: RollbackAction[] = [];
  
  try {
    // Step 1: Create immutable event
    const event = await insertImmutableEvent(data.event);
    rollbackStack.push({
      action: 'delete',
      table: 'immutable_events',
      id: event.id,
    });
    
    // Step 2: Update character states
    const states = await batchInsertCharacterStates(data.characterChanges);
    rollbackStack.push({
      action: 'delete_batch',
      table: 'character_states',
      ids: states.map(s => s.id),
    });
    
    // Step 3: Progress threads
    for (const threadUpdate of data.threadUpdates) {
      const previousStatus = await getThreadStatus(threadUpdate.threadId);
      await updateThread(threadUpdate);
      rollbackStack.push({
        action: 'revert',
        table: 'narrative_threads',
        id: threadUpdate.threadId,
        previousValue: { status: previousStatus },
      });
    }
    
    // All steps succeeded
    return { success: true };
    
  } catch (error) {
    // Execute rollback in reverse order
    for (const action of rollbackStack.reverse()) {
      try {
        await executeRollback(action);
      } catch (rollbackError) {
        // Log but continue with other rollbacks
        console.error('Rollback failed:', rollbackError);
      }
    }
    
    throw new CanonUpdateError(
      'Canon update failed and was rolled back',
      { cause: error }
    );
  }
}

async function executeRollback(action: RollbackAction): Promise<void> {
  switch (action.action) {
    case 'delete':
      await client.from(action.table).delete().eq('id', action.id);
      break;
    case 'delete_batch':
      await client.from(action.table).delete().in('id', action.ids);
      break;
    case 'revert':
      await client.from(action.table).update(action.previousValue).eq('id', action.id);
      break;
  }
}
```

---

## Error Handling

| Error Type | HTTP Status | Message | Recovery |
|------------|-------------|---------|----------|
| `CANON_CONFLICT` | 409 | Event conflicts with existing canon | Show conflicting event, suggest alternative |
| `STATE_REVERSAL` | 422 | Character state would regress | Show current state, explain forward-only rule |
| `AUTH_TRIPLET_MISSING` | 400 | State change missing trigger/cost/constraints | List missing fields |
| `THREAD_VERSION_CONFLICT` | 409 | Thread was modified concurrently | Refresh and retry |
| `BUDGET_EXHAUSTED` | 422 | Token budget exceeded | Suggest reducing context |

```typescript
// Custom error classes
export class CanonConflictError extends Error {
  constructor(
    public conflictingEvent: ImmutableEvent,
    public proposedEvent: Partial<ImmutableEvent>
  ) {
    super(`Canon conflict: ${conflictingEvent.description}`);
    this.name = 'CanonConflictError';
  }
}

export class StateReversalError extends Error {
  constructor(
    public characterId: string,
    public currentState: string,
    public proposedState: string
  ) {
    super(`Cannot reverse ${currentState} to ${proposedState}`);
    this.name = 'StateReversalError';
  }
}
```

---

## UI Integration

Canon Actions power the following UI components:

### Canon Dashboard (`/settings/canon/`)

**Required actions**:

```typescript
// Query: Get Canon health metrics
export async function getCanonDashboardAction(
  projectId: string
): Promise<CanonDashboardData> {
  const [events, threads, characters, config] = await Promise.all([
    getImmutableEventsCount(projectId),
    getActiveThreadsCount(projectId),
    getTrackedCharactersCount(projectId),
    getProjectCanonSettings(projectId),
  ]);
  
  return {
    health: await computeCanonHealth(projectId),
    stats: { 
      immutableEvents: events, 
      activeThreads: threads, 
      characterArcs: characters 
    },
    config,
  };
}

// Mutation: Update Canon settings
export async function updateCanonSettingsAction(
  projectId: string,
  settings: Partial<CanonSettings>
): Promise<void> {
  await updateProjectMetadata(projectId, {
    canon: settings,
  });
}
```

### Event Editor (`/settings/canon/events`)

**CRUD actions**:

| Action | UI Trigger | Description |
|--------|------------|-------------|
| `listImmutableEventsAction` | Page load | List all events with filters |
| `addImmutableEventAction` | "Add Event" button | Create new event |
| `deleteImmutableEventAction` | "Delete" button | Remove event (if not referenced) |

### Publish Page (`/publish`)

**Canon extraction actions**:

```typescript
// Extract canon changes from episode content
export async function extractCanonChangesAction(
  episodeId: string,
  storyContent: StoryContent
): Promise<CanonExtractionResult> {
  const extraction = await extractCanonFromContent(storyContent);
  
  return {
    newImmutableEvents: extraction.deaths.concat(extraction.worldFacts),
    characterStateChanges: extraction.stateChanges,
    threadUpdates: extraction.threads,
    episodeSummary: await generateEpisodeSummary(storyContent),
    requiresConfirmation: true,
  };
}

// Commit extracted canon after user confirmation
export async function commitCanonChangesAction(
  extraction: CanonExtractionResult
): Promise<void> {
  await client.rpc('batch_commit_canon', {
    events: extraction.newImmutableEvents,
    state_changes: extraction.characterStateChanges,
    thread_updates: extraction.threadUpdates,
    summary: extraction.episodeSummary,
  });
}
```

### Real-Time Validation

**Inline validation for Story tab**:

```typescript
// Validate content as user types
export async function validateContentInlineAction(
  projectId: string,
  content: string,
  cursorPosition: number
): Promise<InlineValidationResult> {
  const violations = await checkContentForViolations(
    projectId,
    content
  );
  
  return {
    violations: violations.map(v => ({
      ...v,
      range: v.location,  // Map to editor range
    })),
    isValid: violations.length === 0,
  };
}
```

### Action-to-UI Mapping

| UI Component | Actions Used |
|--------------|--------------|
| Canon Dashboard | `getCanonDashboardAction`, `updateCanonSettingsAction` |
| Event Editor | `listImmutableEventsAction`, `addImmutableEventAction`, `deleteImmutableEventAction` |
| Thread Viewer | `listNarrativeThreadsAction`, `updateThreadStatusAction` |
| Character Timeline | `getCharacterHistoryAction`, `listCharacterStatesAction` |
| Memory Context Preview | `buildMemoryContextAction` (FILM-1004) |
| Inline Validator | `validateContentInlineAction` |
| Episode Summary Generator | `extractCanonChangesAction`, `commitCanonChangesAction` |

**See also**: [FILM-1007: Canon UI Components](../ui/FILM-1007-canon-ui-components.md)

---

## Acceptance Criteria

- [ ] All CRUD actions implemented with proper typing
- [ ] Authorization checks on all actions via RLS
- [ ] Audit logging for all mutations with context
- [ ] State delta tracking for rollback capability
- [ ] Input validation with comprehensive Zod schemas
- [ ] Error handling with specific error classes
- [ ] Optimistic locking for concurrent updates
- [ ] Batch operations for efficient multi-record updates
- [ ] Rollback support for failed transactions
- [ ] **New**: Dashboard query actions for Canon Settings page
- [ ] **New**: Canon extraction actions for Publish page
- [ ] Unit tests for conflict detection
- [ ] Integration tests for batch operations


