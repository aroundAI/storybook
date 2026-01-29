---
id: FILM-1003
title: Continuity Validator Service
status: draft
effort: L
dependencies: [FILM-1001]
---

# FILM-1003: Continuity Validator Service

## Overview

Central enforcement service that validates content against established canon rules at multiple generation stages. This is the core of the Canon Management System.

## Problem Statement

Current `continuity-actions.ts` uses raw LLM calls to detect issues **after** they're written. This approach:
- Is expensive (full LLM call per check)
- Is inconsistent (LLM may miss patterns)
- Is reactive (finds problems, doesn't prevent them)
- Has no structured enforcement

## Solution

A rule-based validator that:
- Runs at 3 checkpoints during generation
- Uses database queries (fast, consistent)
- Prevents violations before generation
- Provides clear, actionable error messages

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Generation Pipeline                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Story Ideation  ───► [CHECKPOINT 1: Plot Skeleton] ───►   │
│                              │                              │
│                        VALIDATOR                            │
│                              │                              │
│                     ┌────────┴────────┐                     │
│                     │ Pass    │ Fail  │                     │
│                     ▼         ▼       │                     │
│                  Continue   Block + Error                   │
│                     │                                       │
│  Screenplay Gen ───► [CHECKPOINT 2: Scene Blocks] ───►     │
│                              │                              │
│                        VALIDATOR                            │
│                              │                              │
│  Shot List Gen  ───► [CHECKPOINT 3: Dialogue] ───►         │
│                              │                              │
│                        VALIDATOR                            │
│                              │                              │
│                         ▼                                   │
│                    Final Output                             │
└─────────────────────────────────────────────────────────────┘
```

---

## File Location

`packages/features/episodes/src/lib/services/continuity-validator.ts`

---

## Interface Definitions

```typescript
// Main validation result
export interface ContinuityValidationResult {
  pass: boolean;
  violations: ContinuityViolation[];
  warnings: ContinuityWarning[];
  metadata: ValidationMetadata;
}

// Individual violation
export interface ContinuityViolation {
  id: string;
  type: ViolationType;
  severity: ViolationSeverity;
  rule: RuleCode;
  message: string;
  location: ContentLocation;
  evidence: ViolationEvidence;
  suggestion: string;
  autoFixable: boolean;
}

// Violation types (9 categories)
export type ViolationType =
  | 'immutable_violation'     // Contradicting hard canon
  | 'state_reversal'          // Character regression
  | 'causality_break'         // Effect before cause
  | 'unauthorized_change'     // Missing authorization triplet
  | 'thread_orphan'           // Abandoned promise
  | 'reference_violation'     // Citing non-existent events
  | 'connectivity_failure'    // Insufficient callbacks
  | 'escalation_overflow'     // Stakes ceiling breach
  | 'tone_drift';             // Genre inconsistency

// Severity levels
export type ViolationSeverity = 
  | 'critical'   // Generation MUST stop
  | 'hard_fail'  // Generation blocked unless override
  | 'soft_fail'; // Warning, proceed with caution

// Location in content
export interface ContentLocation {
  sceneNumber?: number;
  lineNumber?: number;
  characterId?: string;
  excerpt: string;
}

// Evidence for violation
export interface ViolationEvidence {
  established: {
    episodeId: string;
    season: number;
    episodeNumber: number;
    description: string;
  };
  violated: {
    content: string;
    lineNumber?: number;
  };
}
```

---

## Validation Rules (9 Rules)

### Rule 1: CANON_001 - Immutable Violation

**Severity**: CRITICAL (generation MUST stop)

**Logic**:
```typescript
async checkImmutableViolation(
  proposedEvents: ProposedEvent[],
  context: MemoryContext
): Promise<ContinuityViolation[]> {
  const violations: ContinuityViolation[] = [];
  
  for (const event of proposedEvents) {
    // Generate event key from proposed event
    const eventKey = this.generateEventKey(event);
    // e.g., "character:john-uuid:alive" from "John appears in scene"
    
    // Query immutable events for conflicts
    const conflict = context.immutableEvents.find(ie => 
      this.keysConflict(ie.eventKey, eventKey)
    );
    // e.g., "character:john-uuid:dead" conflicts with "character:john-uuid:alive"
    
    if (conflict) {
      violations.push({
        id: `canon001-${Date.now()}`,
        type: 'immutable_violation',
        severity: 'critical',
        rule: 'CANON_001',
        message: `Cannot ${event.description}. ${conflict.description} [S${conflict.season}E${conflict.episodeNumber}]`,
        location: { excerpt: event.excerpt },
        evidence: {
          established: {
            episodeId: conflict.establishedIn,
            season: conflict.season,
            episodeNumber: conflict.episodeNumber,
            description: conflict.description,
          },
          violated: { content: event.excerpt },
        },
        suggestion: this.suggestAlternative('immutable', event, conflict),
        autoFixable: false,
      });
    }
  }
  
  return violations;
}
```

**Example Violation**:
```
❌ CANON_001 VIOLATION (CRITICAL)

Cannot show John Smith alive in scene 3. 
John Smith died in battle [S1E5].

Suggestion: Use flashback, memory, or different character.
```

---

### Rule 2: CANON_002 - State Reversal

**Severity**: HARD_FAIL

**Logic**: Character development must move **forward**. A character who has grown cannot regress without explicit narrative justification.

```typescript
async checkStateReversal(
  characterChanges: CharacterChange[],
  context: MemoryContext
): Promise<ContinuityViolation[]> {
  const violations: ContinuityViolation[] = [];
  
  for (const change of characterChanges) {
    const currentState = context.characterStates.get(change.characterId);
    if (!currentState) continue;
    
    // Check if proposed state is "backwards" from current
    if (this.isReversal(currentState.stateValue, change.proposedState)) {
      violations.push({
        id: `canon002-${Date.now()}`,
        type: 'state_reversal',
        severity: 'hard_fail',
        rule: 'CANON_002',
        message: `${change.characterName} cannot return to "${change.proposedState}". Current state is "${currentState.description}".`,
        // ...
      });
    }
  }
  
  return violations;
}

// Reversal detection examples:
// "optimistic" → "grieving" → "optimistic" = REVERSAL
// "trusting" → "betrayed" → "trusting" = REVERSAL without trauma processing
// "weak" → "strong" → "weak" without injury = REVERSAL
```

---

### Rule 3: CANON_003 - Causality Break

**Severity**: HARD_FAIL

**Logic**: Effects cannot precede causes.

```typescript
checkCausalityChain(events: TimelineEvent[]): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];
  
  for (const event of events) {
    // Check if event references something that hasn't happened yet
    if (event.references) {
      for (const ref of event.references) {
        const referencedEvent = events.find(e => e.id === ref.eventId);
        if (referencedEvent && referencedEvent.order > event.order) {
          violations.push({
            type: 'causality_break',
            message: `Scene ${event.sceneNumber} references event from scene ${referencedEvent.sceneNumber}`,
            // ...
          });
        }
      }
    }
  }
  
  return violations;
}
```

---

### Rule 4: CANON_004 - Unauthorized Change

**Severity**: SOFT_FAIL

**Logic**: Every state change requires:
- **Trigger**: What caused the change
- **Cost**: What was sacrificed
- **Constraint**: What this prevents going forward

```typescript
checkChangeAuthorization(change: StateChange): ContinuityViolation | null {
  const missing: string[] = [];
  
  if (!change.trigger) missing.push('trigger');
  if (!change.cost) missing.push('cost');
  if (!change.newConstraints?.length) missing.push('constraints');
  
  if (missing.length > 0) {
    return {
      type: 'unauthorized_change',
      severity: 'soft_fail',
      message: `State change missing: ${missing.join(', ')}`,
      suggestion: missing.map(m => this.suggestAuthorization(m, change)).join(' '),
      autoFixable: true,
    };
  }
  
  return null;
}
```

**Example Fix Suggestion**:
```
❌ CANON_004 WARNING

John's emotional state change missing: trigger, cost

Suggestion: 
- Trigger: Add scene showing what caused the change
- Cost: Show what John gives up for this growth
```

---

### Rule 5: CANON_005 - Thread Orphan

**Severity**: SOFT_FAIL

**Logic**: Every promise (setup) needs eventual payoff.

```typescript
async checkThreadIntegrity(
  skeleton: PlotSkeleton,
  context: MemoryContext
): Promise<ContinuityViolation[]> {
  const violations: ContinuityViolation[] = [];
  
  // Check for abandoned threads approaching deadline
  for (const thread of context.activeThreads) {
    if (thread.status === 'open') {
      const episodesSinceOpen = context.currentEpisodeNumber - thread.openedAtEpisode;
      
      // Warning if thread hasn't progressed in 3+ episodes
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

### Rule 6: CANON_006 - Reference Violation

**Severity**: HARD_FAIL

**Problem**: Characters or narration reference events that never happened in established canon.

**Algorithm**:

```typescript
async checkReferenceViolations(
  content: SceneContent,
  context: MemoryContext
): Promise<ContinuityViolation[]> {
  const violations: ContinuityViolation[] = [];
  
  // Extract all references from dialogue and narration
  const references = this.extractReferences(content);
  // Pattern: "Remember when X", "After the Y incident", "Since the Z happened"
  
  for (const ref of references) {
    const isValidReference = await this.validateReference(ref, context);
    
    if (!isValidReference.valid) {
      violations.push({
        id: `canon006-${Date.now()}-${ref.hash}`,
        type: 'reference_violation',
        severity: 'hard_fail',
        rule: 'CANON_006',
        message: `Reference to "${ref.description}" not found in canon`,
        location: {
          sceneNumber: ref.sceneNumber,
          lineNumber: ref.lineNumber,
          characterId: ref.speakerId,
          excerpt: ref.text,
        },
        evidence: {
          established: { 
            description: 'No matching event in canon' 
          },
          violated: { content: ref.text },
        },
        suggestion: this.suggestCanonAlternative(ref, context),
        autoFixable: false,
      });
    }
  }
  
  return violations;
}

async validateReference(
  ref: ExtractedReference,
  context: MemoryContext
): Promise<{ valid: boolean; matchedEvent?: ImmutableEvent }> {
  // Step 1: Search in immutable_events
  const immutableMatch = context.immutableEvents.find(ie => 
    this.fuzzyMatch(ref.description, ie.description, 0.75)
  );
  if (immutableMatch) return { valid: true, matchedEvent: immutableMatch };
  
  // Step 2: Search in episode_summaries.key_events
  for (const summary of context.episodeSummaries) {
    const keyEventMatch = summary.keyEvents.find(ke =>
      this.fuzzyMatch(ref.description, ke, 0.75)
    );
    if (keyEventMatch) return { valid: true };
  }
  
  // Step 3: Search in state_deltas for the referenced change
  const deltaMatch = await this.searchStateDeltas(ref.description, context.projectId);
  if (deltaMatch) return { valid: true };
  
  return { valid: false };
}

// Fuzzy matching using Levenshtein distance
fuzzyMatch(a: string, b: string, threshold: number): boolean {
  const similarity = 1 - (levenshtein(a.toLowerCase(), b.toLowerCase()) / 
                          Math.max(a.length, b.length));
  return similarity >= threshold;
}
```

**Reference Patterns Detected**:

| Pattern | Example | Extraction |
|---------|---------|------------|
| "Remember when..." | "Remember when John saved us" | `{ description: "John saved us", type: "callback" }` |
| "After the..." | "After the battle, we changed" | `{ description: "the battle", type: "temporal" }` |
| "Since..." | "Since Maria left" | `{ description: "Maria left", type: "causal" }` |
| "Just like..." | "Just like the old days" | `{ description: "the old days", type: "comparison" }` |
| Direct reference | "That night at the cabin" | `{ description: "night at the cabin", type: "direct" }` |

**Edge Cases**:

| Case | Handling |
|------|----------|
| Generic reference ("the good times") | Skip - too vague to validate |
| Future reference ("when we win") | Skip - not established yet |
| Hypothetical ("if mom were here") | Skip - conditional |
| Season 1 callback from Season 3 | Allow - all seasons are valid canon |

---

### Rule 7: CANON_007 - Connectivity Failure

**Severity**: SOFT_FAIL

**Problem**: Episode is too standalone, doesn't reference enough established narrative to feel connected.

**Algorithm**:

```typescript
checkConnectivity(
  skeleton: PlotSkeleton,
  context: MemoryContext,
  policy: ConnectivityPolicy
): ContinuityViolation | null {
  // Default threshold: 25% connectivity ratio
  const minRatio = policy.minConnectivityRatio ?? 0.25;
  
  // Count valid callbacks in this episode
  const callbackCount = this.countValidCallbacks(skeleton, context);
  
  // Calculate expected callbacks based on available canon
  const availableCallbackTargets = this.countCallbackTargets(context);
  
  if (availableCallbackTargets === 0) {
    // First episode or no canon yet - skip check
    return null;
  }
  
  const ratio = callbackCount / availableCallbackTargets;
  
  if (ratio < minRatio) {
    return {
      id: `canon007-${Date.now()}`,
      type: 'connectivity_failure',
      severity: 'soft_fail',
      rule: 'CANON_007',
      message: `Episode connectivity ratio ${(ratio * 100).toFixed(1)}% < ${(minRatio * 100)}% threshold`,
      location: { excerpt: 'Episode-level check' },
      evidence: {
        established: { 
          description: `${availableCallbackTargets} callback targets available` 
        },
        violated: { content: `Only ${callbackCount} callbacks found` },
      },
      suggestion: this.suggestCallbacks(context, skeleton),
      autoFixable: true,
    };
  }
  
  return null;
}

countValidCallbacks(skeleton: PlotSkeleton, context: MemoryContext): number {
  let count = 0;
  
  // Count character references to established characters
  for (const char of skeleton.characters) {
    if (context.characterStates.has(char.id)) count++;
  }
  
  // Count thread progressions
  for (const action of skeleton.plotActions) {
    if (action.touchesThread && context.activeThreads.some(t => t.id === action.touchesThread)) {
      count++;
    }
  }
  
  // Count location reuses
  for (const scene of skeleton.scenes) {
    if (context.worldStates.some(ws => ws.location === scene.location)) {
      count++;
    }
  }
  
  return count;
}

countCallbackTargets(context: MemoryContext): number {
  // Available targets: characters, threads, locations, events
  return (
    context.characterStates.size +
    context.activeThreads.length +
    context.worldStates.length +
    context.immutableEvents.length
  );
}
```

**Connectivity Ratio Calculation**:

```
                callbacks_made
Ratio = ─────────────────────────────
        available_callback_targets

Where:
  callbacks_made = characters_referenced + threads_touched + 
                   locations_reused + events_mentioned
  
  available_callback_targets = established_characters + active_threads + 
                               established_locations + immutable_events
```

**Thresholds by Content Type**:

| Content Type | Min Ratio | Rationale |
|--------------|-----------|-----------|
| SERIES | 25% | Each episode should feel connected |
| MOVIE | 10% | More standalone, less continuity |
| FACTUAL | 5% | Episodes often standalone |
| NEWS | 0% | No continuity requirement |

---

### Rule 8: CANON_008 - Escalation Overflow

**Severity**: SOFT_FAIL

**Problem**: Stakes escalate too quickly, reaching narrative ceiling prematurely.

**Algorithm**:

```typescript
checkEscalationOverflow(
  skeleton: PlotSkeleton,
  context: MemoryContext,
  policy: EscalationPolicy
): ContinuityViolation | null {
  // Calculate current stakes score
  const currentScore = this.calculateStakesScore(skeleton);
  
  // Get historical max
  const historicalMax = context.episodeSummaries
    .map(es => es.stakesScore ?? 0)
    .reduce((max, s) => Math.max(max, s), 0);
  
  // Calculate progress through series (0.0 to 1.0)
  const seriesProgress = context.currentEpisodeNumber / context.totalPlannedEpisodes;
  
  // Expected max at current progress
  const expectedMaxCeiling = policy.maxStakes * Math.pow(seriesProgress, 0.5);
  // Square root curve - stakes can rise faster early, slower later
  
  if (currentScore > expectedMaxCeiling * 1.5) {
    return {
      id: `canon008-${Date.now()}`,
      type: 'escalation_overflow',
      severity: 'soft_fail',
      rule: 'CANON_008',
      message: `Stakes score ${currentScore} exceeds ceiling ${expectedMaxCeiling.toFixed(1)} at ${(seriesProgress * 100).toFixed(0)}% through series`,
      location: { excerpt: 'Episode-level check' },
      evidence: {
        established: { description: `Historical max: ${historicalMax}` },
        violated: { content: `Proposed: ${currentScore}` },
      },
      suggestion: 'Consider personal stakes over global stakes. Save world-ending threats for finale.',
      autoFixable: false,
    };
  }
  
  return null;
}

calculateStakesScore(skeleton: PlotSkeleton): number {
  let score = 0;
  
  // Score components (0-10 scale each)
  const components = {
    threatenedScale: this.scoreThreatenedScale(skeleton),
    // 1=personal, 5=community, 10=world
    
    deathRisk: this.scoreDeathRisk(skeleton),
    // Number and importance of characters at risk
    
    irreversibility: this.scoreIrreversibility(skeleton),
    // How permanent are the consequences
    
    emotionalWeight: this.scoreEmotionalWeight(skeleton),
    // Relationship dynamics at stake
  };
  
  // Weighted sum
  score = (
    components.threatenedScale * 0.3 +
    components.deathRisk * 0.3 +
    components.irreversibility * 0.2 +
    components.emotionalWeight * 0.2
  );
  
  return Math.round(score * 10) / 10; // Round to 1 decimal
}
```

**Stakes Score Components**:

| Component | Low (1-3) | Medium (4-6) | High (7-10) |
|-----------|-----------|--------------|-------------|
| Threatened Scale | Personal problem | Community impact | World-ending |
| Death Risk | Minor character | Supporting cast | Main character |
| Irreversibility | Easily undone | Significant cost | Permanent |
| Emotional Weight | Casual relationship | Important bond | Core relationship |

**Ceiling Curve Visualization**:

```
Stakes
  10 ┤                                            ┌───● Finale
     │                                       ┌────┘
   8 ┤                                  ┌────┘
     │                             ┌────┘
   6 ┤                        ┌────┘
     │                   ┌────┘       ↑ Ceiling curve
   4 ┤              ┌────┘            (sqrt function)
     │         ┌────┘
   2 ┤    ┌────┘
     │┌───┘
   0 ┼────┬────┬────┬────┬────┬────┬────┬────┬────┬
     0%  10%  20%  30%  40%  50%  60%  70%  80%  90% 100%
                        Series Progress
```

---

### Rule 9: CANON_009 - Tone Drift

**Severity**: SOFT_FAIL

**Problem**: Episode tone deviates significantly from established series baseline.

**Algorithm**:

```typescript
checkToneDrift(
  skeleton: PlotSkeleton,
  context: MemoryContext,
  policy: TonePolicy
): ContinuityViolation | null {
  // Calculate episode tone vector
  const episodeTone = this.calculateToneVector(skeleton);
  
  // Get baseline from series history
  const baseline = this.calculateToneBaseline(context.episodeSummaries);
  
  // Calculate deviation
  const deviation = this.euclideanDistance(episodeTone, baseline);
  const stdDev = this.calculateToneStdDev(context.episodeSummaries, baseline);
  
  // Threshold: 2 standard deviations
  const threshold = policy.maxToneDeviation ?? 2.0;
  
  if (stdDev > 0 && deviation > stdDev * threshold) {
    return {
      id: `canon009-${Date.now()}`,
      type: 'tone_drift',
      severity: 'soft_fail',
      rule: 'CANON_009',
      message: `Tone deviation ${(deviation / stdDev).toFixed(1)}σ exceeds ${threshold}σ threshold`,
      location: { excerpt: 'Episode-level check' },
      evidence: {
        established: { 
          description: `Baseline: ${this.describeTone(baseline)}` 
        },
        violated: { 
          content: `Episode: ${this.describeTone(episodeTone)}` 
        },
      },
      suggestion: this.suggestToneAdjustment(episodeTone, baseline),
      autoFixable: false,
    };
  }
  
  return null;
}

calculateToneVector(content: PlotSkeleton): ToneVector {
  return {
    humor: this.scoreHumor(content),        // 0-1: serious to comedic
    darkness: this.scoreDarkness(content),   // 0-1: light to dark
    pace: this.scorePace(content),           // 0-1: slow to fast
    intimacy: this.scoreIntimacy(content),   // 0-1: epic to personal
    hope: this.scoreHope(content),           // 0-1: bleak to hopeful
  };
}

interface ToneVector {
  humor: number;
  darkness: number;
  pace: number;
  intimacy: number;
  hope: number;
}

euclideanDistance(a: ToneVector, b: ToneVector): number {
  return Math.sqrt(
    Math.pow(a.humor - b.humor, 2) +
    Math.pow(a.darkness - b.darkness, 2) +
    Math.pow(a.pace - b.pace, 2) +
    Math.pow(a.intimacy - b.intimacy, 2) +
    Math.pow(a.hope - b.hope, 2)
  );
}

describeTone(tone: ToneVector): string {
  const descriptors: string[] = [];
  
  if (tone.humor > 0.7) descriptors.push('comedic');
  else if (tone.humor < 0.3) descriptors.push('serious');
  
  if (tone.darkness > 0.7) descriptors.push('dark');
  else if (tone.darkness < 0.3) descriptors.push('light');
  
  if (tone.pace > 0.7) descriptors.push('fast-paced');
  else if (tone.pace < 0.3) descriptors.push('slow-burn');
  
  if (tone.hope > 0.7) descriptors.push('hopeful');
  else if (tone.hope < 0.3) descriptors.push('bleak');
  
  return descriptors.join(', ') || 'balanced';
}
```

**Tone Dimensions**:

| Dimension | Low End | Mid | High End |
|-----------|---------|-----|----------|
| Humor | Serious drama | Dry wit | Full comedy |
| Darkness | Family friendly | Mature themes | Grimdark |
| Pace | Contemplative | Steady | Action-packed |
| Intimacy | Epic scale | Balanced | Character study |
| Hope | Bleak/tragic | Realistic | Optimistic |

**Allowed Tone Drift by Episode Type**:

| Episode Type | Max Deviation | Example |
|--------------|---------------|---------|
| Regular | 2.0σ | Can shift slightly for variety |
| Bottle | 2.5σ | Character-focused may be slower |
| Finale | 3.0σ | Higher stakes can shift tone |
| Flashback | 3.5σ | Different era may have different tone |

---

## Checkpoint Methods

### Checkpoint 1: Plot Skeleton Validation

```typescript
async validatePlotSkeleton(
  skeleton: PlotSkeleton,
  context: MemoryContext,
  options?: ValidationOptions
): Promise<ContinuityValidationResult> {
  const startTime = Date.now();
  
  const violations: ContinuityViolation[] = [];
  const warnings: ContinuityWarning[] = [];
  
  // Rule 1: Check immutable violations
  violations.push(...await this.checkImmutableViolation(skeleton.events, context));
  
  // Rule 2: Check state reversals
  violations.push(...await this.checkStateReversal(skeleton.characterChanges, context));
  
  // Rule 3: Check causality
  violations.push(...this.checkCausalityChain(skeleton.events));
  
  // Rule 4: Check change authorization
  for (const change of skeleton.stateChanges) {
    const v = this.checkChangeAuthorization(change);
    if (v) violations.push(v);
  }
  
  // Rule 5: Check thread integrity
  violations.push(...await this.checkThreadIntegrity(skeleton, context));
  
  // Determine pass/fail
  const criticalCount = violations.filter(v => v.severity === 'critical').length;
  const hardFailCount = violations.filter(v => v.severity === 'hard_fail').length;
  
  return {
    pass: criticalCount === 0 && (hardFailCount === 0 || options?.allowHardFail),
    violations,
    warnings,
    metadata: {
      checkpointType: 'plot_skeleton',
      durationMs: Date.now() - startTime,
      rulesChecked: 5,
    },
  };
}
```

### Checkpoint 2: Scene Blocks Validation

Additional checks for scene-level content.

### Checkpoint 3: Dialogue Validation

Checks for dialogue-specific issues (exposition detection, character voice).

---

## Integration Points

### 1. story-actions.ts

```typescript
// Before queueing story generation:
const context = await buildMemoryContext(projectId, episodeNumber);
const validation = await validator.validatePlotSkeleton(skeleton, context);

if (!validation.pass) {
  throw new ContinuityViolationError(validation.violations);
}
```

### 2. screenplay-actions.ts

```typescript
// After screenplay completionjob finishes:
const validation = await validator.validateSceneBlocks(screenplay, context);
// Log warnings, block critical violations
```

### 3. Lambda job handler

```typescript
// In the LLM job processor:
const validated = await validateBeforeGeneration(input, context);
if (!validated.pass) {
  return { status: 'blocked', violations: validated.violations };
}
```

---

## Error Classes

```typescript
export class ContinuityViolationError extends Error {
  constructor(public violations: ContinuityViolation[]) {
    const summary = violations.map(v => `${v.rule}: ${v.message}`).join('; ');
    super(`Continuity violations detected: ${summary}`);
    this.name = 'ContinuityViolationError';
  }
}
```

---

## Workflow Integration

The Continuity Validator integrates at **four** generation checkpoints:

### Checkpoint Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  EPISODE GENERATION WORKFLOW                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  IDEATION ───────► Memory context validation                               │
│                    • Verifies project has Canon enabled                     │
│                    • Builds context via FILM-1004                           │
│                    • UI: Memory Context Preview panel                       │
│                                                                             │
│  STORY ──────────► Plot skeleton validation (CHECKPOINT 1)                 │
│                    • Runs: CANON_001, CANON_002, CANON_003, CANON_004      │
│                    • Blocks on: CRITICAL, HARD_FAIL                         │
│                    • UI: Canon Validation badge, inline warnings            │
│                                                                             │
│  SCREENPLAY ─────► Scene block validation (CHECKPOINT 2)                   │
│                    • Runs: CANON_005, CANON_006, CANON_007                  │
│                    • Warns on: SOFT_FAIL                                    │
│                    • UI: Continuity Sidebar                                 │
│                                                                             │
│  PUBLISH ────────► Canon extraction trigger                                │
│                    • Extracts: new immutable events, state changes          │
│                    • Updates: narrative_threads, episode_summaries          │
│                    • UI: Episode Summary Generator modal                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### IDEATION Checkpoint

**Purpose**: Prepare memory context before generation begins.

```typescript
// packages/features/episodes/src/lib/server/mutations/story-actions.ts

async function generateStory(params: StoryParams): Promise<StoryResult> {
  // IDEATION checkpoint: Build memory context
  const memoryContext = await buildMemoryContext({
    projectId: params.projectId,
    episodeNumber: params.episodeNumber,
    horizon: params.canonSettings?.memoryHorizon ?? 10,
  });
  
  // Context is injected into prompt
  const prompt = injectMemoryContext(storyPrompt, memoryContext);
  // ...
}
```

**UI Integration**: Memory Context Preview panel displays what AI knows.

### STORY Checkpoint

**Purpose**: Validate plot skeleton before expanding to prose.

```typescript
// Called after LLM returns plot skeleton

async function validatePlotSkeleton(
  skeleton: PlotSkeleton,
  context: MemoryContext
): Promise<ContinuityValidationResult> {
  const violations: ContinuityViolation[] = [];
  
  // Run primary validation rules
  violations.push(...await checkImmutableViolation(skeleton, context));  // CANON_001
  violations.push(...await checkStateReversal(skeleton, context));        // CANON_002
  violations.push(...await checkCausalityBreak(skeleton, context));       // CANON_003
  violations.push(...await checkUnauthorizedChange(skeleton, context));   // CANON_004
  
  return {
    pass: violations.filter(v => v.severity !== 'soft_fail').length === 0,
    violations,
    metadata: { checkpoint: 'STORY', rules: ['CANON_001', 'CANON_002', 'CANON_003', 'CANON_004'] }
  };
}
```

**UI Integration**: 
- Canon badge shows ✓/⚠️/✖️ in episode header
- Inline warnings appear next to violating content

### SCREENPLAY Checkpoint

**Purpose**: Validate scene blocks for thread connectivity and references.

```typescript
// Called after screenplay expansion

async function validateSceneBlocks(
  scenes: SceneBlock[],
  context: MemoryContext
): Promise<ContinuityValidationResult> {
  const violations: ContinuityViolation[] = [];
  
  // Run secondary validation rules
  violations.push(...await checkThreadOrphan(scenes, context));           // CANON_005
  violations.push(...await checkReferenceViolation(scenes, context));     // CANON_006
  violations.push(...await checkConnectivityFailure(scenes, context));    // CANON_007
  
  return {
    pass: violations.filter(v => v.severity !== 'soft_fail').length === 0,
    violations,
    metadata: { checkpoint: 'SCREENPLAY', rules: ['CANON_005', 'CANON_006', 'CANON_007'] }
  };
}
```

**UI Integration**: Continuity Sidebar shows active constraints and thread status.

### PUBLISH Checkpoint

**Purpose**: Extract canon changes and update database.

```typescript
// Called when user clicks Publish

async function extractAndConfirmCanon(
  episode: Episode,
  storyContent: StoryContent
): Promise<CanonExtractionResult> {
  // Extract new canon from generated content
  const extraction = await extractCanonChanges(storyContent, {
    detectDeaths: true,
    detectStateChanges: true,
    detectThreadUpdates: true,
  });
  
  // Return for user confirmation
  return {
    newImmutableEvents: extraction.immutableEvents,
    characterStateChanges: extraction.stateChanges,
    threadUpdates: extraction.threads,
    episodeSummary: extraction.summary,
    requiresConfirmation: true,
  };
}

// After user confirms in modal
async function commitCanonChanges(
  extraction: CanonExtractionResult
): Promise<void> {
  await batchRecordCanon(extraction);  // FILM-1005
}
```

**UI Integration**: Episode Summary Generator modal displays detected changes for user review.

### Checkpoint-Rule Matrix

| Checkpoint | Stage | Rules Run | UI Component |
|------------|-------|-----------|--------------|
| IDEATION | Before generation | (context build) | Memory Context Preview |
| STORY | After plot skeleton | CANON_001-004 | Canon Badge, Inline Warnings |
| SCREENPLAY | After scenes | CANON_005-007 | Continuity Sidebar |
| PUBLISH | On publish | (extraction) | Episode Summary Generator |

**See also**: [FILM-1007: Canon UI Components](../ui/FILM-1007-canon-ui-components.md)

---

## Acceptance Criteria

- [ ] All 9 violation types implemented
- [ ] 4 checkpoint methods functional (IDEATION, STORY, SCREENPLAY, PUBLISH)
- [ ] Integration with story-actions.ts
- [ ] Unit tests with >80% coverage
- [ ] Performance: single validation < 500ms
- [ ] Clear error messages with suggestions
- [ ] Audit logging for all validations

---

## Test Cases

```typescript
describe('ContinuityValidator', () => {
  describe('checkImmutableViolation', () => {
    it('should block resurrection of dead character', async () => {
      const context = mockContext({
        immutableEvents: [{
          eventType: 'death',
          eventKey: 'character:john:dead',
          description: 'John died in battle',
        }],
      });
      
      const skeleton = mockSkeleton({
        events: [{ description: 'John enters the room' }],
      });
      
      const result = await validator.validatePlotSkeleton(skeleton, context);
      
      expect(result.pass).toBe(false);
      expect(result.violations[0].type).toBe('immutable_violation');
      expect(result.violations[0].severity).toBe('critical');
    });
  });
  
  // ... additional test cases
});
```
