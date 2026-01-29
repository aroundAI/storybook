---
spec_id: FILM-1007
title: Canon UI Components
status: draft
priority: high
effort: L
---

# FILM-1007: Canon UI Components

> **Purpose**: Define all user-facing UI components for Canon Management, including Project Settings pages and Episode workflow integration.

---

## Overview

Canon Management UI consists of:
1. **Project Settings Pages** - Full Canon management dashboard
2. **Episode Workflow Integration** - Inline Canon at each generation stage

---

## Project Settings Pages

### Route Structure

```
/studio/[projectSlug]/settings/
├── canon/                    → Canon Dashboard
│   ├── events/               → Immutable Events Editor
│   ├── threads/              → Narrative Threads Visualization
│   └── characters/           → Character State Timeline
```

---

## Component 1: Canon Dashboard

**Route**: `/settings/canon/`

### Purpose
Series-level Canon health overview with quick access to management tools.

### Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CANON MANAGEMENT                                                           │
│  ───────────────                                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ 📊 HEALTH       │  │ 📅 LAST UPDATE  │  │ ⚙️ ENFORCEMENT  │             │
│  │                 │  │                 │  │                 │             │
│  │  OK - 0 Issues  │  │  Episode 28     │  │  Flexible       │             │
│  │  ✓ All valid    │  │  2 days ago     │  │  [Change]       │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                             │
│  ┌── CANON STATISTICS ──────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │  IMMUTABLE EVENTS         ACTIVE THREADS         CHARACTER ARCS      │  │
│  │  ┌─────────────────┐     ┌─────────────────┐    ┌─────────────────┐  │  │
│  │  │      12         │     │       5         │    │       8         │  │  │
│  │  │  deaths: 3      │     │  open: 3        │    │  tracked        │  │  │
│  │  │  world: 5       │     │  progressing: 2 │    │  characters     │  │  │
│  │  │  timeline: 4    │     │                 │    │                 │  │  │
│  │  └─────────────────┘     └─────────────────┘    └─────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌── CONFIGURATION ─────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │  LLM Role Separation    [OFF] ─────────○───────── [ON]              │  │
│  │  Use Planner/Writer/Editor/Stylist pipeline                          │  │
│  │                                                                       │  │
│  │  Memory Horizon         [────────●────────────────] 10 episodes     │  │
│  │  Episodes included in context (max: 30)                              │  │
│  │                                                                       │  │
│  │  Enforcement Mode       [▼ Flexible               ]                  │  │
│  │  How violations are handled                                          │  │
│  │                                                                       │  │
│  │  Content Type           [▼ Series                 ]                  │  │
│  │  Affects validation rules and memory strategy                        │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  [Manage Events]  [Manage Threads]  [View Characters]                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Requirements

```typescript
interface CanonDashboardData {
  health: {
    status: 'ok' | 'warning' | 'error';
    issueCount: number;
    lastValidation: string;
  };
  stats: {
    immutableEvents: number;
    activeThreads: number;
    characterArcs: number;
    lastEpisode: number;
  };
  config: CanonSettings;
}
```

### Actions

| Action | Endpoint | Description |
|--------|----------|-------------|
| `getCanonDashboard` | GET | Fetch dashboard data |
| `updateCanonSettings` | PUT | Update configuration |

---

## Component 2: Immutable Events Editor

**Route**: `/settings/canon/events`

### Purpose
CRUD interface for managing immutable canon events (deaths, world facts, timelines).

### Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Back    IMMUTABLE EVENTS                           [+ Add Event]        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Filter: [All Types ▼]  [All Episodes ▼]  [Search...                  🔍]  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 💀 DEATH                                                    Ep 15  │   │
│  │ ──────────────────────────────────────────────────────────────────  │   │
│  │ Marcus sacrificed himself to save the kingdom                       │   │
│  │ Key: character:marcus:death                                         │   │
│  │ Established: Episode 15, Season 1                                   │   │
│  │                                                          [Edit] [×] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🌍 WORLD_FACT                                               Ep 22  │   │
│  │ ──────────────────────────────────────────────────────────────────  │   │
│  │ The Crown of Aldoria was destroyed in the Battle of Shadows         │   │
│  │ Key: artifact:crown_aldoria:destroyed                               │   │
│  │ Established: Episode 22, Season 1                                   │   │
│  │                                                          [Edit] [×] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ⏰ TIMELINE                                                 Ep 27  │   │
│  │ ──────────────────────────────────────────────────────────────────  │   │
│  │ Elena was revealed as a double agent                                │   │
│  │ Key: character:elena:revealed_traitor                               │   │
│  │ Established: Episode 27, Season 2                                   │   │
│  │                                                          [Edit] [×] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Add/Edit Modal

```
┌─────────────────────────────────────────────────────────────┐
│  ADD IMMUTABLE EVENT                                   [×]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Event Type *                                               │
│  [▼ Select type                          ]                  │
│  • death                                                    │
│  • world_fact                                               │
│  • relationship                                             │
│  • timeline                                                 │
│  • ability_loss                                             │
│  • location_destruction                                     │
│                                                             │
│  Event Key * (auto-generated)                               │
│  [character:name:event_type                ]                │
│                                                             │
│  Description *                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Describe what happened...                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Established In *                                           │
│  [▼ Episode 28                           ]                  │
│                                                             │
│  Additional Metadata (JSON)                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ { "witness": "Sarah", "location": "Throne Room" }   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ⚠️ Warning: Immutable events cannot be modified after      │
│  generation has referenced them.                            │
│                                                             │
│                              [Cancel]  [Create Event]       │
└─────────────────────────────────────────────────────────────┘
```

---

## Component 3: Narrative Threads Visualization

**Route**: `/settings/canon/threads`

### Purpose
Visual representation of plot threads across episodes with status tracking.

### Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Back    NARRATIVE THREADS                          [+ Add Thread]       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Filter: [▼ All Statuses]  Legend: ○ Open  ◐ Progressing  ● Resolved      │
│                                                                             │
│  TIMELINE VIEW                                                              │
│  ───────────────────────────────────────────────────────────────────────   │
│                                                                             │
│  Ep 5   10   15   20   25   30                                             │
│   │     │     │     │     │     │                                          │
│   ├─────┼─────┼─────┼─────┼─────┤                                          │
│   │     │     │     │     │     │                                          │
│   ◐═════════════════════════════════════○  Mystery of Lost Kingdom [OPEN]  │
│   │     │     │     │     │     │                                          │
│         ◐═══════════════════●              Sarah's Redemption [RESOLVED]   │
│   │     │     │     │     │     │                                          │
│               ◐═════════════════════○      Elena's Betrayal [PROGRESSING]  │
│   │     │     │     │     │     │                                          │
│   ├─────┼─────┼─────┼─────┼─────┤                                          │
│   │     │     │     │     │     │                                          │
│                                                                             │
│  ┌── THREAD DETAILS ────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │  MYSTERY OF LOST KINGDOM                              [Edit] [Close]  │  │
│  │  ─────────────────────────────                                        │  │
│  │  Status: OPEN  │  Setup: Ep 8  │  Target Resolution: Ep 35-40        │  │
│  │                                                                       │  │
│  │  Checkpoints:                                                         │  │
│  │  ✓ Ep 8: Initial mystery introduced                                  │  │
│  │  ✓ Ep 15: First clue discovered                                      │  │
│  │  ○ Ep 25: Second clue (EXPECTED, NOT HIT)                           │  │
│  │                                                                       │  │
│  │  ⚠️ This thread is overdue for a checkpoint                          │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component 4: Character State Timeline

**Route**: `/settings/canon/characters`

### Purpose
View character arc progression across episodes with state changes.

### Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Back    CHARACTER ARCS                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [▼ Sarah] ──────────────────────────────────────────────────────────────  │
│                                                                             │
│  CHARACTER: SARAH                                                           │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  EMOTIONAL ARC                                                              │
│  ────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│     hope  ┤    ╭──╮                                                        │
│           │   ╱    ╲                                                       │
│   neutral ┤──╱      ╲        ╭────╮                                        │
│           │          ╲      ╱      ╲      ╭──────                          │
│   despair ┤           ╰────╯        ╰────╯                                 │
│           └──────────────────────────────────────────────────────────────  │
│           Ep 1   5   10   15   20   25   28                                │
│                                                                             │
│  STATE CHANGES                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Ep 28: acceptance → determination                                   │   │
│  │ Trigger: Confronted Elena, learned truth                           │   │
│  │ Cost: Lost trust in mentor                                          │   │
│  │ Constraints: Must lead kingdom, cannot return to simple life        │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Ep 20: grief → acceptance                                           │   │
│  │ Trigger: Completed mourning ritual for Marcus                       │   │
│  │ Cost: Time, emotional energy                                        │   │
│  │ Constraints: Must honor his sacrifice                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Ep 15: hope → grief                                                 │   │
│  │ Trigger: Marcus's death                                             │   │
│  │ Cost: Lost companion                                                │   │
│  │ Constraints: Sole survivor of original group                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Episode Workflow Components

### Component 5: Canon Health Badge

**Location**: Episode header (all tabs)

```
┌─────────────────────────────────────────────────────────────────┐
│  EPISODE 29: "The Final Confrontation"        [Canon: ✓ OK]    │
└─────────────────────────────────────────────────────────────────┘

States:
• ✓ OK     (green)   - No violations detected
• ⚠️ 1     (yellow)  - Soft violations, can proceed
• ✖️ 2     (red)     - Critical violations, must resolve
```

### Component 6: Memory Context Preview

**Location**: `/ideation` tab (collapsible panel)

```
┌── MEMORY CONTEXT PREVIEW ─────────────────────────────────────┐
│ 📚 What the AI Knows (click to expand)            [▼ Expand] │
│                                                               │
│ IMMUTABLE FACTS (3)                                          │
│ • Marcus died in Episode 15                                   │
│ • The Crown was destroyed in Episode 22                       │
│ • Elena revealed as double-agent in Episode 27                │
│                                                               │
│ ACTIVE THREADS (2)                                            │
│ • Mystery of the Lost Kingdom (Ep 8, OPEN)                   │
│ • Sarah's redemption arc (Ep 20, RESOLVED)                   │
│                                                               │
│ CHARACTER STATES (2)                                          │
│ • Sarah: acceptance → determination                           │
│ • Elena: revealed_traitor → escaped                           │
│                                                               │
│ TOKEN BUDGET: 2,847 / 6,000 (47%)                            │
│ ████████████████░░░░░░░░░░░░░░░░                             │
└───────────────────────────────────────────────────────────────┘
```

### Component 7: Inline Violation Warnings

**Location**: `/story` tab (inline in editor)

```
⚠️ CONTINUITY WARNING
┌─────────────────────────────────────────────────────────────────┐
│ Line 47: "Marcus entered the room with the Crown"              │
│                                                                 │
│ ❌ IMMUTABLE VIOLATION (CANON_001)                             │
│ Marcus is DEAD (Episode 15)                                    │
│ The Crown is DESTROYED (Episode 22)                            │
│                                                                 │
│ Suggestion: Use flashback or memory instead                    │
│                                                                 │
│ [Fix Now] [Ignore (Flexible Mode)]                             │
└─────────────────────────────────────────────────────────────────┘
```

### Component 8: Continuity Sidebar

**Location**: `/screenplay` tab (right sidebar)

```
┌─ CONTINUITY ────────────────────────┐
│                                      │
│ SCENE CONSTRAINTS                    │
│ • Marcus: DEAD                       │
│ • Crown: DESTROYED                   │
│ • Time: NIGHT                        │
│                                      │
│ CHARACTERS PRESENT                   │
│ • Sarah (protagonist)                │
│ • Elena (voice only)                 │
│                                      │
│ ACTIVE THREADS                       │
│ ⚠️ Lost Kingdom: NOT YET TOUCHED    │
│ ✓ Sarah's Arc: Referenced           │
│                                      │
└──────────────────────────────────────┘
```

### Component 9: Episode Summary Generator

**Location**: `/publish` tab (modal on publish)

```
┌─────────────────────────────────────────────────────────────────┐
│  CANON EXTRACTION                                          [×] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  The following canon changes were detected in this episode:    │
│                                                                 │
│  NEW IMMUTABLE EVENTS                                          │
│  ☑️ Sarah claimed the throne (world_fact)                      │
│  ☑️ Elena escaped through the portal (timeline)                │
│                                                                 │
│  CHARACTER STATE CHANGES                                        │
│  ☑️ Sarah: acceptance → determination                          │
│  ☑️ Elena: revealed_traitor → escaped                          │
│                                                                 │
│  THREAD UPDATES                                                 │
│  ☑️ "Sarah's redemption arc": PROGRESSING → RESOLVED           │
│  ☐ "Mystery of Lost Kingdom": Still OPEN (orphan warning)     │
│                                                                 │
│  EPISODE SUMMARY (auto-generated)                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Sarah confronted Elena in the throne room, learning     │   │
│  │ the full truth of her betrayal. After a tense standoff, │   │
│  │ Elena escaped through an ancient portal. Sarah claimed  │   │
│  │ the throne, accepting her new role as ruler.            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│              [Skip Extraction]  [Review & Confirm]              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Order

| Priority | Component | Route/Location | Effort |
|----------|-----------|----------------|--------|
| 1 | Canon Dashboard | `/settings/canon/` | M |
| 2 | Canon Health Badge | Episode header | S |
| 3 | Memory Context Preview | `/ideation` | M |
| 4 | Inline Violation Warnings | `/story` | M |
| 5 | Episode Summary Generator | `/publish` | L |
| 6 | Immutable Events Editor | `/settings/canon/events` | M |
| 7 | Continuity Sidebar | `/screenplay` | M |
| 8 | Narrative Threads Viz | `/settings/canon/threads` | L |
| 9 | Character State Timeline | `/settings/canon/characters` | L |

---

## Acceptance Criteria

### Project Settings
- [ ] Canon Dashboard shows health metrics and configuration
- [ ] Settings persist to `projects.metadata.canon`
- [ ] Events, Threads, Characters pages render correctly
- [ ] CRUD operations work for all canon entities

### Episode Integration
- [ ] Canon Health Badge visible in episode header
- [ ] Memory Context Preview shows on Ideation tab
- [ ] Inline warnings display on Story generation
- [ ] Continuity Sidebar shows scene constraints
- [ ] Publish extracts and confirms canon changes

### Responsive Design
- [ ] All components work on desktop (1280px+)
- [ ] Collapsible panels for mobile
- [ ] Sidebar hides on narrow screens

---

## See Also

- [ARCHITECTURE.md](../ARCHITECTURE.md) - Component-algorithm mapping
- [FILM-1003](../lib/FILM-1003-continuity-validator.md) - Validation rules
- [FILM-1004](../lib/FILM-1004-memory-context-builder.md) - Context building
- [FILM-1005](../server/FILM-1005-canon-actions.md) - Server actions
- [ROUTES.md](../ROUTES.md) - Route specifications
