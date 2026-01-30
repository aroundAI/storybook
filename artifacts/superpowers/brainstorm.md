# Canon Management UX + Algorithm Integration Brainstorm

## Goal
Design seamless integration of Canon Management System into the existing Project Studio UX, documenting both the **user-facing experience** AND the **underlying algorithm/prompt orchestration** at each workflow stage.

---

## Constraints

| Constraint | Rationale |
|------------|-----------|
| **Phase 10** | Separate phase, distinct from Episodes |
| **PostgreSQL + pgvector** | Vector search with Voyage embeddings, abstraction layer |
| **LLM role separation opt-in** | Configurable in project settings |
| **All content types** | SERIES, MOVIE, FACTUAL, NEWS supported |
| **Flexible enforcement** | Warn but allow, via constants |
| **10-episode horizon** | Configurable up to 30+ |
| **Fresh start migration** | No backfill needed |
| **Full Canon UI** | All surfaces in project settings |

---

## Known Context

### Current Episode Workflow
```
IDEATION → STORY → SCREENPLAY → VISUAL STUDIO → AUDIO STUDIO → PUBLISH
```

### Existing Routes
```
/studio/[projectSlug]/
├── settings/               → Audio, Cover, Intro, Visibility
├── episodes/[episodeSlug]/
│   ├── ideation/           → Story concepts
│   ├── story/              → Full narrative
│   ├── screenplay/         → Scene breakdown
│   ├── visual-studio/      → Shot prompts
│   ├── audio-studio/       → Audio timeline
│   └── publish/            → Distribution
```

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Algorithm latency | Generation feels slow | Async validation, caching |
| Context overflow | LLM ignores constraints | Strict token budgeting (15%) |
| User confusion | Features feel disconnected | Inline feedback, contextual help |
| Over-enforcement | Blocks creative exploration | Flexible mode default |

---

## Options

### Option A: Invisible Background Processing
Canon runs invisibly, only surfacing on violations.
- **Pro**: No UI changes, minimal disruption
- **Con**: Users can't see/understand constraints, hard to debug

### Option B: Dedicated Canon Tab
New "Canon" tab in episode header for all management.
- **Pro**: Clear separation, easy to find
- **Con**: Isolated from generation, context-switching

### Option C: Settings + Inline Alerts
Canon config in Settings, inline alerts during generation.
- **Pro**: Familiar pattern, contextual
- **Con**: Canon spread across multiple places

### Option D: Pre-Generation Gate + Post-Generation Summary (RECOMMENDED)
Canon integrated at natural workflow breakpoints with full visibility.
- **Pro**: Seamless integration, educational, actionable
- **Con**: More integration work

---

## Recommendation

### **Option D: Pre-Generation Gate + Post-Generation Summary**

Integrate Canon at each workflow stage with both:
1. **User-Facing UI** - Visual feedback, controls, previews
2. **Algorithm/Prompt Orchestration** - Under-the-hood enforcement

---

## End-to-End Workflow Integration

### Stage 1: PROJECT SETTINGS → Canon Configuration

#### User Experience
```
/studio/[projectSlug]/settings/canon/

┌─────────────────────────────────────────────────────────────────┐
│  CANON MANAGEMENT                           [Dashboard | Status]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📊 Series Health                                               │
│  ├── 12 Immutable Events                                        │
│  ├── 5 Active Threads                                           │
│  ├── 8 Character Arcs                                           │
│  └── Last Episode: #28, 2 new constraints                       │
│                                                                  │
│  ⚙️ Configuration                                              │
│  ├── LLM Role Separation: [OFF] ← Toggle                        │
│  ├── Memory Horizon: [10 episodes] ← Dropdown                   │
│  ├── Enforcement: [Flexible] ← Dropdown                         │
│  └── Content Type: [SERIES] ← Dropdown                          │
│                                                                  │
│  [Manage Events] [Manage Threads] [Character Arcs]              │
└─────────────────────────────────────────────────────────────────┘
```

#### Algorithm Effect
```typescript
// On save, updates projects.metadata.canon
const canonSettings = {
  roleSeparation: false,      // → FILM-1006 pipeline selection
  memoryHorizon: 10,          // → FILM-1004 windowing algorithm
  enforcement: 'flexible',    // → FILM-1003 violation severity
  contentType: 'series',      // → FILM-1006 mode selection
};
// Stored in: UPDATE projects SET metadata.canon = {...}
```

---

### Stage 2: IDEATION → Memory Context Preview

#### User Experience
```
/studio/[projectSlug]/episodes/[episodeSlug]/ideation/

┌─────────────────────────────────────────────────────────────────┐
│  EPISODE 29: "The Final Confrontation"        [Canon: ✓ Ready] │
├─────────────────────────────────────────────────────────────────┤
│  Ideation | Story | Screenplay | Shots | Audio | Publish       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌── MEMORY CONTEXT PREVIEW ─────────────────────────┐          │
│  │ 📚 What the AI Knows (click to expand)            │          │
│  │                                                    │          │
│  │ IMMUTABLE FACTS (cannot be contradicted)           │          │
│  │ • Marcus died in Episode 15 (S1E15)               │          │
│  │ • The Crown was destroyed in Episode 22           │          │
│  │ • Elena revealed as double-agent in Episode 27    │          │
│  │                                                    │          │
│  │ ACTIVE THREADS (must progress or close)            │          │
│  │ • Mystery of the Lost Kingdom (Ep 8, OPEN)        │          │
│  │ • Sarah's redemption arc (Ep 20, PROGRESSING)     │          │
│  │                                                    │          │
│  │ CHARACTER STATES (current)                         │          │
│  │ • Sarah: grief → acceptance (Ep 27)               │          │
│  │ • Elena: agent → revealed traitor (Ep 27)         │          │
│  │                                                    │          │
│  │ TOKEN BUDGET: 2,847 / 6,000 (47%)                 │          │
│  └────────────────────────────────────────────────────┘          │
│                                                                  │
│  [Generate Story Ideas]                                          │
└─────────────────────────────────────────────────────────────────┘
```

#### Algorithm Effect (Pre-Generation)
```typescript
// FILM-1004: buildMemoryContext() triggered on page load
const context = await buildMemoryContext(projectId, episodeNumber, {
  maxTokenPercentage: 15,     // Hard cap from ARCHITECTURE.md
  memoryHorizon: 10,          // From project settings
});

// Priority loading algorithm selects content:
// 1. ALL immutable events (priority: 200)
// 2. Recent episode summaries (priority: 100, decays by episode)
// 3. Active threads affecting this episode (priority: 90)
// 4. Latest character states (priority: 80)
// 5. World state (priority: 60)

// Token budget allocation (FILM-1004 Algorithm 1):
// ├── Immutable Events: 33% → 1,980 tokens
// ├── Characters: 25% → 1,500 tokens
// ├── Threads: 15% → 900 tokens
// ├── Summaries: 17% → 1,020 tokens
// └── World State: 10% → 600 tokens
```

#### Prompt Injection
```typescript
// Context formatted for LLM (FILM-1004: formatContextForPrompt)
const systemPrompt = `
## IMMUTABLE CANON (NEVER CONTRADICT)
- Marcus is DEAD (established Episode 15)
- The Crown is DESTROYED (established Episode 22)
- Elena is a REVEALED DOUBLE-AGENT (established Episode 27)

## ACTIVE NARRATIVE THREADS
- Mystery of the Lost Kingdom: MUST be referenced or progressed
- Sarah's redemption arc: Currently in phase PROGRESSING

## CHARACTER CURRENT STATES
- Sarah: emotional=acceptance, relationship=Elena(broken_trust)
- Elena: alignment=antagonist, cover=blown

## CONSTRAINTS
- Cannot resurrect Marcus
- Cannot restore The Crown
- Sarah must not immediately forgive Elena (too early)
`;
```

---

### Stage 3: STORY → Canon Validation

#### User Experience
```
/studio/[projectSlug]/episodes/[episodeSlug]/story/

┌─────────────────────────────────────────────────────────────────┐
│  EPISODE 29: "The Final Confrontation"        [Canon: ⚠️ 1]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ STORY CONTENT ──────────────────────────────────────────┐   │
│  │ Sarah stood before the throne room, her heart heavy...    │   │
│  │ She remembered Marcus's sacrifice, how he had given       │   │
│  │ everything to protect the kingdom. Now it was her turn.   │   │
│  │                                                            │   │
│  │ ⚠️ CONTINUITY WARNING                                     │   │
│  │ ┌─────────────────────────────────────────────────────┐   │   │
│  │ │ Line 47: "Marcus entered the room with the Crown"   │   │   │
│  │ │                                                      │   │   │
│  │ │ ❌ IMMUTABLE VIOLATION (CANON_001)                  │   │   │
│  │ │ Marcus is DEAD (Episode 15)                         │   │   │
│  │ │ The Crown is DESTROYED (Episode 22)                 │   │   │
│  │ │                                                      │   │   │
│  │ │ Suggestion: Use flashback or memory instead         │   │   │
│  │ │ [Fix Now] [Ignore (Flexible Mode)]                  │   │   │
│  │ └─────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

#### Algorithm Effect (During Generation)
```typescript
// FILM-1003: ContinuityValidator runs at PLOT_SKELETON checkpoint
const validation = await validator.validatePlotSkeleton(skeleton, context);

// Rule checks executed:
// CANON_001: checkImmutableViolation() → CRITICAL if Marcus alive
// CANON_002: checkStateReversal() → HARD_FAIL if character regresses
// CANON_003: checkCausalityChain() → HARD_FAIL if effect before cause
// CANON_004: checkChangeAuthorization() → SOFT_FAIL if missing triplet
// CANON_005: checkThreadIntegrity() → SOFT_FAIL if thread orphaned

// Each rule produces:
interface ContinuityViolation {
  type: 'immutable_violation',
  severity: 'critical',
  rule: 'CANON_001',
  message: 'Cannot show Marcus alive - established dead in Ep 15',
  evidence: { established: {...}, violated: {...} },
  suggestion: 'Use flashback or memory instead',
  autoFixable: false,
}
```

#### LLM Role Separation (If Enabled)
```typescript
// FILM-1006: 4-role pipeline
if (project.settings.roleSeparation) {
  // Stage 1: PLANNER (structure only)
  const skeleton = await executeLLMRole('planner', {
    memoryContext: formattedContext,
    permissions: ['create_structure', 'set_constraints'],
    mustPreserve: [],
  });
  await validator.validatePlotSkeleton(skeleton, context);
  
  // Stage 2: WRITER (prose within structure)
  const prose = await executeLLMRole('writer', {
    skeleton,
    permissions: ['write_prose', 'write_dialogue'],
    mustPreserve: ['scene_structure', 'constraints'],
  });
  await validator.validateSceneBlocks(prose, context);
  
  // Stage 3: EDITOR (refine without changing meaning)
  const edited = await executeLLMRole('editor', {
    content: prose,
    permissions: ['improve_clarity', 'adjust_pacing'],
    mustPreserve: ['facts', 'meaning', 'structure'],
  });
  
  // Stage 4: STYLIST (polish language only)
  const final = await executeLLMRole('stylist', {
    content: edited,
    permissions: ['polish_language', 'generate_veo_prompts'],
    mustPreserve: ['facts', 'meaning', 'structure', 'dialogue'],
  });
}
```

---

### Stage 4: SCREENPLAY → Continuity Sidebar

#### User Experience
```
/studio/[projectSlug]/episodes/[episodeSlug]/screenplay/

┌─────────────────────────────────────────────────────────────────┐
│  EPISODE 29          [Canon: ✓ OK] [Continuity ▸]              │
├─────────────────────────────────────────┬───────────────────────┤
│  SCENE 1: Throne Room                   │ 📋 CONTINUITY         │
│  ─────────────────────────              │                       │
│  INT. THRONE ROOM - NIGHT               │ SCENE CONSTRAINTS     │
│                                         │ • Marcus: DEAD        │
│  SARAH enters, haunted by memories.     │ • Crown: DESTROYED    │
│  The empty throne looms before her.     │ • Time: NIGHT         │
│                                         │                       │
│  ELENA (V.O.): You can't escape what    │ CHARACTERS PRESENT    │
│  you've done.                           │ • Sarah (protagonist) │
│                                         │ • Elena (voice only)  │
│  SARAH: I know. I've stopped trying.    │                       │
│                                         │ ACTIVE THREADS        │
│  She reaches for the scepter...         │ ⚠️ Lost Kingdom:      │
│                                         │   NOT YET TOUCHED     │
│  [+ Add Beat] [Generate Shots]          │                       │
└─────────────────────────────────────────┴───────────────────────┘
```

#### Algorithm Effect
```typescript
// FILM-1003: Real-time validation on scene save
const sceneValidation = await validator.validateSceneBlocks(
  screenplay.scenes,
  context,
  {
    checkpoint: 'scene_blocks',
    strictMode: project.settings.enforcement === 'strict',
  }
);

// Check thread connectivity (CANON_007)
const connectivity = calculateConnectivity(screenplay, context);
// Formula: (established_refs + progressed_threads) / (total_references)
// Warning if < 0.5 for SERIES mode

// Check escalation (CANON_008)
const escalation = calculateEscalation(screenplay, context);
// Stakes should follow ceiling curve, not exceed expected for episode #
```

---

### Stage 5: VISUAL STUDIO → Character Visual Registry

#### User Experience
```
/studio/[projectSlug]/episodes/[episodeSlug]/visual-studio/

┌─────────────────────────────────────────────────────────────────┐
│  SHOT 12: Sarah's Decision              [Canon: ✓] [Character]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PROMPT PREVIEW:                                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ A woman with dark hair and weathered armor stands       │    │
│  │ before an empty throne. Her expression shows resolve    │    │
│  │ mixed with grief. Cinematic lighting, fantasy style.    │    │
│  │                                                          │    │
│  │ CHARACTER: SARAH                                         │    │
│  │ ├── Hair: Dark brown, shoulder-length                   │    │
│  │ ├── Eyes: Green                                          │    │
│  │ ├── Build: Athletic, 5'8"                                │    │
│  │ ├── Current State: Grief → Acceptance                   │    │
│  │ └── Wardrobe: Weathered armor, no crown insignia        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  [Generate with VEO 3.1]                                        │
└─────────────────────────────────────────────────────────────────┘
```

#### Algorithm Effect
```typescript
// FILM-1004: Character state injected into VEO prompts
const characterContext = await getCharacterVisualContext(characterId);

// Generates VEO 3.1 prompt with consistency markers:
const veoPrompt = buildVeoPrompt({
  subject: characterContext.physicalAttributes,
  currentState: characterContext.latestState,
  continuityMarkers: [
    'weathered armor', // From episode 20 onwards
    'no crown insignia', // Crown destroyed in Ep 22
    'scar on left cheek', // Acquired in Ep 18
  ],
});
```

---

### Stage 6: PUBLISH → Episode Summary Generator

#### User Experience
```
/studio/[projectSlug]/episodes/[episodeSlug]/publish/

┌─────────────────────────────────────────────────────────────────┐
│  PUBLISH EPISODE 29                     [Canon: Extract Now]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📋 CANON CHANGES DETECTED                                      │
│  ───────────────────────────                                    │
│  The following will be added to series canon:                   │
│                                                                  │
│  NEW IMMUTABLE EVENTS:                                          │
│  ☑️ Sarah claimed the throne (world_fact)                       │
│  ☑️ Elena escaped through the portal (timeline)                 │
│                                                                  │
│  CHARACTER STATE CHANGES:                                       │
│  ☑️ Sarah: acceptance → determination                           │
│  ☑️ Elena: revealed_traitor → escaped                           │
│                                                                  │
│  THREAD UPDATES:                                                │
│  ☑️ "Sarah's redemption arc": PROGRESSING → RESOLVED            │
│  ☐ "Mystery of Lost Kingdom": Still OPEN (orphan warning)      │
│                                                                  │
│  [Review & Confirm] [Skip Canon Extraction]                     │
└─────────────────────────────────────────────────────────────────┘
```

#### Algorithm Effect (Post-Generation)
```typescript
// FILM-1005: Server actions to persist canon
await addImmutableEventAction({
  projectId,
  eventType: 'world_fact',
  eventKey: 'character:sarah:throne_claimed',
  episodeId,
  description: 'Sarah claimed the throne',
});

await updateCharacterStateAction({
  characterId: sarahId,
  episodeId,
  stateType: 'goal',
  stateValue: { primary: 'determination', achieved: ['throne'] },
  trigger: 'Claimed throne after confrontation',
  cost: 'Abandoned peaceful life',
  newConstraints: ['Must rule kingdom', 'Cannot leave capital'],
});

// Generate episode summary for future context
await generateEpisodeSummaryAction({
  episodeId,
  plotSummary: 'Sarah claimed the throne after confronting Elena...',
  keyEvents: ['throne_claimed', 'elena_escaped'],
  characterChanges: ['sarah:determination', 'elena:escaped'],
  sentimentScore: 0.75, // Hopeful
});
```

---

## Acceptance Criteria

### Project Settings Integration
- [ ] `/settings/canon/` route with 4 sub-pages
- [ ] Canon Dashboard with series health metrics
- [ ] Configuration toggles persisted to projects.metadata.canon

### Episode-Level Integration
- [ ] Memory Context Preview panel in Ideation (collapsible)
- [ ] Canon Validation badge in episode header
- [ ] Inline violation warnings with fix suggestions
- [ ] Continuity Sidebar in Screenplay editor
- [ ] Character Visual Registry in Visual Studio
- [ ] Episode Summary Generator on Publish

### Algorithm Integration
- [ ] FILM-1003: Validator runs at 3 checkpoints (skeleton, blocks, dialogue)
- [ ] FILM-1004: Memory context builds with priority loading
- [ ] FILM-1005: Server actions persist canon changes
- [ ] FILM-1006: LLM roles enforce permission boundaries

### Performance
- [ ] Context build < 200ms
- [ ] Validation < 500ms
- [ ] Full generation < 45s with validation

### Constants & Configuration
- [ ] Enforcement mode via constants (easy to change to strict later)
- [ ] Memory horizon configurable per project
- [ ] Token budget configurable (default 15%)
