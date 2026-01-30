---
id: FILM-1101
title: Register Canon Prompts in Lambda Worker
status: draft
priority: critical
effort: S
dependencies: [FILM-1006]
---

# FILM-1101: Register Canon Prompts in Lambda Worker

## Overview

Register the existing canon-role LLM prompts (planner, writer, editor, stylist) in the Lambda worker's prompt registry so they can be used during story generation.

## Problem Statement

Four canon-role prompts exist but are **not registered** in the Lambda prompt registry:
- `packages/features/prompt-engine/src/prompts/canon-roles/planner-role.json`
- `packages/features/prompt-engine/src/prompts/canon-roles/writer-role.json`
- `packages/features/prompt-engine/src/prompts/canon-roles/editor-role.json`
- `packages/features/prompt-engine/src/prompts/canon-roles/stylist-role.json`

The `runRolePipeline()` function cannot be called from Lambda handlers because these prompts aren't accessible.

## Solution

Import and register all canon-role prompts in the Lambda prompt registry.

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/lambda/llm-worker/prompt-registry.ts` | Add imports and registry entries |

---

## Implementation

### Step 1: Add Imports

```typescript
// Canon Role Prompts
import plannerRole from '../../../../packages/features/prompt-engine/src/prompts/canon-roles/planner-role.json';
import writerRole from '../../../../packages/features/prompt-engine/src/prompts/canon-roles/writer-role.json';
import editorRole from '../../../../packages/features/prompt-engine/src/prompts/canon-roles/editor-role.json';
import stylistRole from '../../../../packages/features/prompt-engine/src/prompts/canon-roles/stylist-role.json';
```

### Step 2: Add to Registry

```typescript
export const PROMPT_REGISTRY: Record<string, PromptTemplate> = {
  // ... existing entries ...
  
  // Canon Roles
  'planner-role': plannerRole as PromptTemplate,
  'writer-role': writerRole as PromptTemplate,
  'editor-role': editorRole as PromptTemplate,
  'stylist-role': stylistRole as PromptTemplate,
  
  // Nested aliases
  'canon-roles/planner-role': plannerRole as PromptTemplate,
  'canon-roles/writer-role': writerRole as PromptTemplate,
  'canon-roles/editor-role': editorRole as PromptTemplate,
  'canon-roles/stylist-role': stylistRole as PromptTemplate,
};
```

---

## Acceptance Criteria

- [ ] All 4 canon-role prompts are imported in `prompt-registry.ts`
- [ ] All 4 prompts are registered with both short and nested slug aliases
- [ ] TypeScript compilation passes without errors
- [ ] Lambda worker can access prompts via `getPromptTemplate('planner-role')`
- [ ] Unit test: Registry returns valid PromptTemplate for all 4 slugs

---

## Testing

### Manual Verification

```bash
# Build Lambda worker
pnpm --filter web build:lambda

# Verify prompts are bundled (check output size increase)
ls -la apps/web/lambda/llm-worker/dist/
```

### Unit Test

```typescript
import { getPromptTemplate, PROMPT_REGISTRY } from './prompt-registry';

describe('Canon Role Prompts Registration', () => {
  const canonRoles = ['planner-role', 'writer-role', 'editor-role', 'stylist-role'];
  
  it.each(canonRoles)('should register %s prompt', (role) => {
    expect(PROMPT_REGISTRY[role]).toBeDefined();
    expect(PROMPT_REGISTRY[role].name).toBeDefined();
  });
  
  it.each(canonRoles)('should access %s via getPromptTemplate', (role) => {
    const template = getPromptTemplate(role);
    expect(template).toBeDefined();
    expect(template.llm).toBeDefined();
  });
});
```

---

## Estimated Effort

| Task | Time |
|------|------|
| Add imports | 5 min |
| Add registry entries | 5 min |
| Verify build | 10 min |
| Write tests | 15 min |
| **Total** | **~35 min** |

---

## Dependencies

- **FILM-1006**: Canon role prompts must exist (✅ Complete)

## Blocks

- **FILM-1102**: Memory context injection needs prompts registered first
- **FILM-1104**: Validation integration needs role pipeline working
