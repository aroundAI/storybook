---
id: FILM-1006
title: LLM Role Separation
status: 🗑️ RETIRED
audited: 2026-09-23
priority: high
effort: M
dependencies: [FILM-304]
---

# FILM-1006: LLM Role Separation

> **🗑️ Retired (audit 2026-09-23).** The planner, writer, editor and stylist role prompts and `llm-role-orchestrator.ts` were deleted as dead code in 2f23eb4e (#220, 2026-05-23). Story generation runs the agent orchestrator instead (Story Director → Viral Analyst → Continuity Guardian), `packages/features/episodes/src/agent/story-orchestrator.ts`; the "LLM Role Separation" toggle left in canon settings is saved but no generation code reads it. Kept as a record; not outstanding work.

## Overview

Prompt templates for role-separated LLM calls: Planner, Writer, Editor, Stylist.

## Rationale

From `system-level-algo.md`:

> "Role Separation prevents entanglement: Planner writes structure, Writer writes prose, Editor refines, Stylist polishes. No role can violate constraints set by a higher role."

## Role Hierarchy

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

---

## Prompt Templates

### `planner-role.json`

**Location**: `packages/features/prompt-engine/src/prompts/story-generation/planner-role.json`

**Permissions**:
- ✅ Read all canon, characters, threads
- ✅ Create plot skeleton
- ✅ Define scene beats and pacing
- ❌ Cannot write dialogue
- ❌ Cannot write prose
- ❌ Cannot make style decisions

**Output Format**:
```json
{
  "plotSkeleton": [
    {
      "sceneNumber": 1,
      "beat": "OPENING IMAGE",
      "purpose": "Establish status quo",
      "characters": ["char_id"],
      "pacing": "slow",
      "emotionalTone": "peaceful",
      "constraints": ["Must not reference X"]
    }
  ],
  "proposedStateChanges": [...],
  "threadUpdates": [...]
}
```

---

### `writer-role.json`

**Location**: `packages/features/prompt-engine/src/prompts/story-generation/writer-role.json`

**Permissions**:
- ✅ Read plot skeleton from Planner
- ✅ Write full prose and dialogue
- ✅ Add sensory details
- ❌ Cannot add new characters
- ❌ Cannot change scene structure
- ❌ Cannot violate Planner's constraints

**Input Requirements**:
- Plot skeleton from Planner
- Memory context
- Character details

**Output Format**:
```json
{
  "scenes": [
    {
      "sceneNumber": 1,
      "content": "Full prose...",
      "dialogue": [...]
    }
  ]
}
```

---

### `editor-role.json`

**Location**: `packages/features/prompt-engine/src/prompts/story-generation/editor-role.json`

**Permissions**:
- ✅ Read Writer's output
- ✅ Improve clarity and flow
- ✅ Fix continuity issues
- ✅ Adjust pacing
- ❌ Cannot add new content
- ❌ Cannot change meaning
- ❌ Cannot alter structure

**Output Format**:
```json
{
  "edits": [
    {
      "location": { "scene": 1, "paragraph": 2 },
      "original": "...",
      "revised": "...",
      "reason": "Improved clarity"
    }
  ],
  "finalContent": "..."
}
```

---

### `stylist-role.json`

**Location**: `packages/features/prompt-engine/src/prompts/story-generation/stylist-role.json`

**Permissions**:
- ✅ Polish language
- ✅ Ensure consistent voice
- ✅ Generate VEO 3.1 prompts
- ❌ Cannot change facts
- ❌ Cannot alter meaning
- ❌ Cannot modify structure

**Output Format**:
```json
{
  "finalContent": "...",
  "veoPrompts": [
    {
      "shotNumber": 1,
      "prompt": "VEO 3.1 formatted prompt..."
    }
  ]
}
```

---

## Orchestration

### Full Pipeline (SERIES mode)

```typescript
async function generateWithRoleSeparation(input: GenerationInput): Promise<GenerationOutput> {
  const context = await buildMemoryContext(input.projectId, input.episodeNumber);
  
  // Stage 1: Planner
  const skeleton = await executeLLMRole('planner', {
    memoryContext: formatContextForPrompt(context),
    premise: input.premise,
    constraints: input.constraints,
  });
  
  // Validate skeleton
  const skelValidation = await validator.validatePlotSkeleton(skeleton, context);
  if (!skelValidation.pass) throw new ContinuityViolationError(skelValidation.violations);
  
  // Stage 2: Writer
  const prose = await executeLLMRole('writer', {
    skeleton,
    memoryContext: formatContextForPrompt(context),
    characters: input.characters,
  });
  
  // Stage 3: Editor
  const edited = await executeLLMRole('editor', {
    content: prose,
    skeleton,
  });
  
  // Validate edited content
  const editValidation = await validator.validateSceneBlocks(edited, context);
  if (!editValidation.pass) throw new ContinuityViolationError(editValidation.violations);
  
  // Stage 4: Stylist
  const final = await executeLLMRole('stylist', {
    content: edited,
    styleGuide: input.styleGuide,
  });
  
  return final;
}
```

### Single-Call Mode (MOVIE mode)

For self-contained content, all roles can be combined:

```typescript
async function generateSingleCall(input: GenerationInput): Promise<GenerationOutput> {
  const context = await buildMemoryContext(input.projectId, 1);
  
  return await executeLLM('story-generation', {
    memoryContext: formatContextForPrompt(context),
    premise: input.premise,
    // All-in-one generation
  });
}
```

---

## Mode Selection

| Content Type | Default Pipeline |
|--------------|------------------|
| SERIES | Full 4-role pipeline |
| MOVIE | Single-call (optional roles) |
| FACTUAL | Writer + Editor (no Planner creativity) |
| NEWS | Source-bound (special template) |

---

## Algorithms

### Algorithm 1: Role Permission Enforcement

**Problem**: Prevent roles from exceeding their authorized actions.

```typescript
interface RolePermission {
  canRead: string[];       // Data types this role can access
  canCreate: string[];     // Output types this role can produce
  canModify: string[];     // What it can change from previous role
  mustPreserve: string[];  // What it CANNOT change from previous role
}

const ROLE_PERMISSIONS: Record<LLMRole, RolePermission> = {
  planner: {
    canRead: ['memory_context', 'premise', 'characters', 'threads'],
    canCreate: ['plot_skeleton', 'scene_beats', 'pacing', 'constraints'],
    canModify: [],
    mustPreserve: [],
  },
  writer: {
    canRead: ['plot_skeleton', 'memory_context', 'characters'],
    canCreate: ['prose', 'dialogue', 'action_lines'],
    canModify: [],
    mustPreserve: ['scene_structure', 'character_list', 'constraints'],
  },
  editor: {
    canRead: ['writer_output', 'plot_skeleton'],
    canCreate: ['edits', 'improved_content'],
    canModify: ['prose', 'dialogue', 'pacing'],
    mustPreserve: ['facts', 'structure', 'character_actions', 'meaning'],
  },
  stylist: {
    canRead: ['editor_output', 'style_guide'],
    canCreate: ['final_content', 'veo_prompts'],
    canModify: ['word_choice', 'sentence_structure', 'formatting'],
    mustPreserve: ['facts', 'meaning', 'structure', 'dialogue_content'],
  },
};

function validateRoleOutput(
  role: LLMRole,
  input: RoleInput,
  output: RoleOutput
): ValidationResult {
  const permissions = ROLE_PERMISSIONS[role];
  const violations: string[] = [];
  
  // Check if output contains unauthorized elements
  for (const outputType of Object.keys(output)) {
    if (!permissions.canCreate.includes(outputType)) {
      violations.push(`Role ${role} cannot create ${outputType}`);
    }
  }
  
  // Check if preserved elements were modified
  if (role !== 'planner') {
    for (const field of permissions.mustPreserve) {
      const previous = extractField(input.previousOutput, field);
      const current = extractField(output, field);
      
      if (!deepEqual(previous, current)) {
        violations.push(`Role ${role} illegally modified ${field}`);
      }
    }
  }
  
  return {
    valid: violations.length === 0,
    violations,
  };
}
```

---

### Algorithm 2: Constraint Propagation

**Problem**: Constraints set by Planner must flow down to all subsequent roles.

```typescript
interface Constraint {
  id: string;
  type: 'must_include' | 'must_exclude' | 'timing' | 'character';
  description: string;
  source: LLMRole;
  priority: number;
}

class ConstraintPropagator {
  private constraints: Constraint[] = [];
  
  addFromPlanner(skeleton: PlotSkeleton): void {
    for (const scene of skeleton.scenes) {
      for (const constraint of scene.constraints || []) {
        this.constraints.push({
          id: `planner-${scene.sceneNumber}-${this.constraints.length}`,
          type: this.classifyConstraint(constraint),
          description: constraint,
          source: 'planner',
          priority: 100,  // Planner constraints are highest priority
        });
      }
    }
    
    // Add implicit constraints from memory context
    for (const event of skeleton.immutableEvents) {
      this.constraints.push({
        id: `canon-${event.id}`,
        type: 'must_exclude',
        description: `Cannot contradict: ${event.description}`,
        source: 'planner',
        priority: 200,  // Canon constraints are even higher
      });
    }
  }
  
  validateAgainstConstraints(content: string): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];
    
    for (const constraint of this.constraints) {
      if (constraint.type === 'must_include') {
        if (!this.contentContains(content, constraint.description)) {
          violations.push({
            constraint,
            severity: 'hard_fail',
            message: `Missing required element: ${constraint.description}`,
          });
        }
      }
      
      if (constraint.type === 'must_exclude') {
        if (this.contentContains(content, constraint.description)) {
          violations.push({
            constraint,
            severity: 'critical',
            message: `Contains forbidden element: ${constraint.description}`,
          });
        }
      }
    }
    
    return violations;
  }
  
  getConstraintsForRole(role: LLMRole): Constraint[] {
    // Each role inherits all constraints from previous roles
    const roleOrder = ['planner', 'writer', 'editor', 'stylist'];
    const roleIndex = roleOrder.indexOf(role);
    
    return this.constraints.filter(c => 
      roleOrder.indexOf(c.source) <= roleIndex
    );
  }
}
```

**Constraint Propagation Flow**:

```
Planner Output:
  constraints: ["Must show Sarah's fear of water", "Cannot mention the accident"]
       │
       ▼
Writer receives:
  inherited_constraints: [
    { type: 'must_include', desc: "Sarah's fear of water" },
    { type: 'must_exclude', desc: "the accident" }
  ]
       │
       ▼
Editor receives:
  inherited_constraints: [same + any writer-added constraints]
       │
       ▼
Stylist receives:
  inherited_constraints: [all accumulated constraints]
```

---

### Algorithm 3: Role Escalation Prevention

**Problem**: Later roles attempting to override earlier role decisions.

```typescript
interface RoleOutput {
  role: LLMRole;
  timestamp: string;
  decisions: Decision[];
}

interface Decision {
  type: string;
  value: unknown;
  reasoning: string;
  locked: boolean;  // If true, cannot be changed by later roles
}

class EscalationDetector {
  detectEscalation(
    previousOutputs: RoleOutput[],
    currentOutput: RoleOutput
  ): EscalationViolation[] {
    const violations: EscalationViolation[] = [];
    
    for (const decision of currentOutput.decisions) {
      // Find if this decision overrides a previous locked decision
      for (const prev of previousOutputs) {
        const overridden = prev.decisions.find(d => 
          d.type === decision.type && 
          d.locked && 
          !deepEqual(d.value, decision.value)
        );
        
        if (overridden) {
          violations.push({
            overrider: currentOutput.role,
            overridden: prev.role,
            decision: decision.type,
            previousValue: overridden.value,
            attemptedValue: decision.value,
            severity: this.calculateSeverity(prev.role, currentOutput.role),
          });
        }
      }
    }
    
    return violations;
  }
  
  calculateSeverity(overriddenRole: LLMRole, overriderRole: LLMRole): 'warning' | 'hard_fail' | 'critical' {
    const ROLE_AUTHORITY = { planner: 4, writer: 3, editor: 2, stylist: 1 };
    const authorityDiff = ROLE_AUTHORITY[overriddenRole] - ROLE_AUTHORITY[overriderRole];
    
    if (authorityDiff >= 2) return 'critical';    // Stylist overriding Planner
    if (authorityDiff === 1) return 'hard_fail';  // Editor overriding Writer
    return 'warning';                              // Adjacent roles
  }
}
```

---

### Algorithm 4: Fallback and Recovery

**Problem**: What happens when a role fails or produces invalid output?

```typescript
interface FallbackStrategy {
  maxRetries: number;
  fallbackRole: LLMRole | null;
  degradedMode: boolean;
}

const FALLBACK_STRATEGIES: Record<LLMRole, FallbackStrategy> = {
  planner: {
    maxRetries: 2,
    fallbackRole: null,  // No fallback - must succeed
    degradedMode: false,
  },
  writer: {
    maxRetries: 2,
    fallbackRole: 'planner',  // Re-run planner with simpler constraints
    degradedMode: true,
  },
  editor: {
    maxRetries: 1,
    fallbackRole: null,
    degradedMode: true,  // Skip if fails, use writer output directly
  },
  stylist: {
    maxRetries: 1,
    fallbackRole: null,
    degradedMode: true,  // Skip if fails, use editor output directly
  },
};

async function executeRoleWithFallback(
  role: LLMRole,
  input: RoleInput
): Promise<RoleOutput> {
  const strategy = FALLBACK_STRATEGIES[role];
  let attempts = 0;
  let lastError: Error | null = null;
  
  while (attempts < strategy.maxRetries) {
    attempts++;
    
    try {
      const output = await executeLLMRole(role, input);
      const validation = validateRoleOutput(role, input, output);
      
      if (validation.valid) {
        return output;
      }
      
      lastError = new RoleValidationError(validation.violations);
      
    } catch (error) {
      lastError = error as Error;
    }
    
    // Retry with simplified prompt on failure
    input = simplifyRoleInput(input, attempts);
  }
  
  // All retries exhausted
  if (strategy.degradedMode && input.previousOutput) {
    console.warn(`Role ${role} failed, using previous output`);
    return input.previousOutput;
  }
  
  if (strategy.fallbackRole) {
    console.warn(`Role ${role} failed, falling back to ${strategy.fallbackRole}`);
    return executeRoleWithFallback(strategy.fallbackRole, simplifyRoleInput(input, 0));
  }
  
  throw new RoleExecutionError(role, lastError);
}
```

---

### Algorithm 5: Output Diff Validation

**Problem**: Ensure each role only modified what it's allowed to modify.

```typescript
interface DiffResult {
  field: string;
  changeType: 'added' | 'removed' | 'modified';
  before: unknown;
  after: unknown;
}

function computeOutputDiff(
  previousOutput: RoleOutput,
  currentOutput: RoleOutput
): DiffResult[] {
  const diffs: DiffResult[] = [];
  const allFields = new Set([
    ...Object.keys(previousOutput),
    ...Object.keys(currentOutput),
  ]);
  
  for (const field of allFields) {
    const before = previousOutput[field];
    const after = currentOutput[field];
    
    if (before === undefined && after !== undefined) {
      diffs.push({ field, changeType: 'added', before, after });
    } else if (before !== undefined && after === undefined) {
      diffs.push({ field, changeType: 'removed', before, after });
    } else if (!deepEqual(before, after)) {
      diffs.push({ field, changeType: 'modified', before, after });
    }
  }
  
  return diffs;
}

function validateDiffs(
  role: LLMRole,
  diffs: DiffResult[]
): DiffViolation[] {
  const permissions = ROLE_PERMISSIONS[role];
  const violations: DiffViolation[] = [];
  
  for (const diff of diffs) {
    // Check additions
    if (diff.changeType === 'added') {
      if (!permissions.canCreate.includes(diff.field)) {
        violations.push({
          diff,
          message: `Role ${role} cannot create field ${diff.field}`,
        });
      }
    }
    
    // Check modifications
    if (diff.changeType === 'modified') {
      if (permissions.mustPreserve.includes(diff.field)) {
        violations.push({
          diff,
          message: `Role ${role} must preserve field ${diff.field}`,
        });
      }
      
      if (!permissions.canModify.includes(diff.field)) {
        violations.push({
          diff,
          message: `Role ${role} cannot modify field ${diff.field}`,
        });
      }
    }
    
    // Generally, roles shouldn't remove fields
    if (diff.changeType === 'removed') {
      violations.push({
        diff,
        message: `Role ${role} unexpectedly removed field ${diff.field}`,
      });
    }
  }
  
  return violations;
}
```

---

## Performance Considerations

| Stage | Typical Time | Token Usage |
|-------|--------------|-------------|
| Planner | 5-10s | 2K-4K |
| Writer | 15-30s | 4K-8K |
| Editor | 10-15s | 3K-6K |
| Stylist | 5-10s | 2K-4K |
| **Total** | **35-65s** | **11K-22K** |

**Parallel Execution Opportunity**:
- Planner must run first (creates structure)
- Writer depends on Planner
- Editor depends on Writer
- Stylist depends on Editor
- **No parallelization in main path**
- But: Multiple scenes can be processed in parallel after planning

---

## Project Settings Integration

LLM Role Separation is configurable per-project via Canon Settings.

### Role Toggle Component

**Location**: `/settings/canon/` dashboard

```
┌── LLM ROLE SEPARATION ──────────────────────────────────────────┐
│                                                                  │
│  Enable Role Pipeline    [OFF] ─────────○───────── [ON]        │
│                                                                  │
│  When enabled, generation uses 4 specialized roles:            │
│  • Planner → structure, scene beats                             │
│  • Writer → prose, dialogue                                     │
│  • Editor → refinement, consistency                             │
│  • Stylist → polish, tone                                       │
│                                                                  │
│  ⚠️ Increases generation time (35-65s vs 15-25s single-call)   │
│  ✓ Improves structure and consistency                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Episode Header Mode Indicator

**Location**: Episode header (all tabs)

```
┌─────────────────────────────────────────────────────────────────┐
│  EPISODE 29: "The Final Confrontation"                         │
│  [Canon: ✓ OK]  [Mode: 🎭 4-Role]                              │
└─────────────────────────────────────────────────────────────────┘

States:
• 🎭 4-Role   - Role separation enabled (Planner/Writer/Editor/Stylist)
• ⚡ Single   - Single-call generation (default)
```

### Generation Progress Indicator

**Location**: Generation modal (during story/screenplay generation)

```
┌── GENERATING STORY ─────────────────────────────────────────────┐
│                                                                  │
│  ✓ Planner  [████████████████████████] Complete (8.2s)         │
│  ↻ Writer   [██████████░░░░░░░░░░░░░░] 42% (est. 18s)          │
│  ○ Editor   [░░░░░░░░░░░░░░░░░░░░░░░░] Waiting                 │
│  ○ Stylist  [░░░░░░░░░░░░░░░░░░░░░░░░] Waiting                 │
│                                                                  │
│  Current: Writing scene 3 of 7...                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Settings Storage

```typescript
// projects.metadata.canon
interface CanonSettings {
  enabled: boolean;
  roleSeparation: boolean;   // ← Controls role pipeline
  memoryHorizon: number;
  enforcement: 'flexible' | 'strict';
  contentType: 'series' | 'movie' | 'factual' | 'news';
}

// Action to toggle role separation
export async function toggleRoleSeparationAction(
  projectId: string,
  enabled: boolean
): Promise<void> {
  await updateProjectMetadata(projectId, {
    canon: {
      roleSeparation: enabled,
    },
  });
}
```

### Integration with Generation Pipeline

```typescript
// In story-actions.ts

async function generateStory(params: StoryParams): Promise<StoryResult> {
  const canonSettings = await getProjectCanonSettings(params.projectId);
  
  if (canonSettings.roleSeparation) {
    // Use 4-role pipeline
    return generateWithRoles(params, canonSettings);
  } else {
    // Use single-call generation
    return generateSingleCall(params);
  }
}
```

**See also**: [FILM-1007: Canon UI Components](../ui/FILM-1007-canon-ui-components.md)

---

## Acceptance Criteria

- [ ] 4 role prompt templates created with clear permissions
- [ ] Orchestration function with validation at each stage
- [ ] Mode selection logic based on content type
- [ ] Role permission enforcement with violation detection
- [ ] Constraint propagation from Planner to all roles
- [ ] Escalation prevention between role levels
- [ ] Fallback strategies for role failures
- [ ] Output diff validation for unauthorized changes
- [ ] Cost tracking per role stage
- [ ] **New**: Role toggle in Project Settings
- [ ] **New**: Mode indicator in episode header
- [ ] **New**: Progress indicator during generation
- [ ] Integration tests for full 4-role pipeline
- [ ] Unit tests for constraint propagation


