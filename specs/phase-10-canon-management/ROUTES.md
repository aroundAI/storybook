---
title: Canon Management Routes
status: draft
---

# Canon Management Routes

> **Purpose**: Comprehensive route reference for all Canon Management UI pages.

---

## Project Settings Routes

All Canon settings routes are nested under the project settings layout:

```
/studio/[projectSlug]/settings/
└── canon/                         → Canon Dashboard
    ├── events/                    → Immutable Events Editor
    ├── threads/                   → Narrative Threads Visualization
    └── characters/                → Character State Timeline
```

---

## Route Specifications

### `/settings/canon/` - Canon Dashboard

| Property | Value |
|----------|-------|
| **File** | `apps/web/app/home/[account]/studio/[projectSlug]/settings/canon/page.tsx` |
| **Layout** | Uses settings layout with sidebar |
| **Data** | `getCanonDashboardAction(projectId)` |
| **Components** | `CanonHealthCard`, `CanonStatsGrid`, `CanonSettingsForm` |

**Data Requirements**:
```typescript
interface CanonDashboardPageData {
  health: CanonHealthStatus;
  stats: {
    immutableEvents: number;
    activeThreads: number;
    characterArcs: number;
    lastEpisode: number;
  };
  config: CanonSettings;
}
```

---

### `/settings/canon/events` - Immutable Events Editor

| Property | Value |
|----------|-------|
| **File** | `apps/web/app/home/[account]/studio/[projectSlug]/settings/canon/events/page.tsx` |
| **Layout** | Uses canon layout |
| **Data** | `listImmutableEventsAction(projectId, filters)` |
| **Components** | `EventList`, `EventCard`, `AddEventModal`, `EventFilters` |

**Data Requirements**:
```typescript
interface EventsPageData {
  events: ImmutableEvent[];
  filters: {
    eventType?: EventType;
    episodeId?: string;
    search?: string;
  };
  pagination: PaginationState;
}
```

---

### `/settings/canon/threads` - Narrative Threads

| Property | Value |
|----------|-------|
| **File** | `apps/web/app/home/[account]/studio/[projectSlug]/settings/canon/threads/page.tsx` |
| **Layout** | Uses canon layout |
| **Data** | `listNarrativeThreadsAction(projectId)` |
| **Components** | `ThreadTimeline`, `ThreadCard`, `AddThreadModal` |

**Data Requirements**:
```typescript
interface ThreadsPageData {
  threads: NarrativeThread[];
  episodeRange: { min: number; max: number };
  filterStatus?: 'open' | 'progressing' | 'resolved' | 'all';
}
```

---

### `/settings/canon/characters` - Character Timeline

| Property | Value |
|----------|-------|
| **File** | `apps/web/app/home/[account]/studio/[projectSlug]/settings/canon/characters/page.tsx` |
| **Layout** | Uses canon layout |
| **Data** | `listTrackedCharactersAction(projectId)` + `getCharacterHistoryAction(characterId)` |
| **Components** | `CharacterList`, `CharacterArcChart`, `StateChangeList` |

**Data Requirements**:
```typescript
interface CharactersPageData {
  characters: TrackedCharacter[];
  selectedCharacter?: string;
  stateHistory?: CharacterState[];
}
```

---

## Episode Workflow Integration Points

These are **not new routes** but existing routes with Canon components added:

| Existing Route | Canon Component | Spec Reference |
|----------------|-----------------|----------------|
| `/episodes/[episodeSlug]/ideation` | Memory Context Preview | FILM-1004, FILM-1007 |
| `/episodes/[episodeSlug]/story` | Canon Badge, Inline Warnings | FILM-1003, FILM-1007 |
| `/episodes/[episodeSlug]/screenplay` | Continuity Sidebar | FILM-1003, FILM-1007 |
| `/episodes/[episodeSlug]/visual-studio` | Character Visual Registry | FILM-1004, FILM-1007 |
| `/episodes/[episodeSlug]/publish` | Episode Summary Generator | FILM-1005, FILM-1007 |

---

## Layout Hierarchy

```
/home/[account]/studio/[projectSlug]/
├── layout.tsx                       → Project studio layout
│   └── settings/
│       ├── layout.tsx               → Settings sidebar layout  
│       └── canon/
│           ├── layout.tsx           → Canon sub-navigation [NEW]
│           ├── page.tsx             → Dashboard [NEW]
│           ├── events/page.tsx      → Events editor [NEW]
│           ├── threads/page.tsx     → Threads viz [NEW]
│           └── characters/page.tsx  → Character timeline [NEW]
```

---

## New Files to Create

| File | Type | Priority |
|------|------|----------|
| `settings/canon/layout.tsx` | Layout | 1 |
| `settings/canon/page.tsx` | Page | 1 |
| `settings/canon/events/page.tsx` | Page | 2 |
| `settings/canon/threads/page.tsx` | Page | 3 |
| `settings/canon/characters/page.tsx` | Page | 3 |
| `components/canon/canon-dashboard.tsx` | Component | 1 |
| `components/canon/canon-health-badge.tsx` | Component | 1 |
| `components/canon/memory-context-preview.tsx` | Component | 2 |
| `components/canon/inline-violation-warning.tsx` | Component | 2 |
| `components/canon/continuity-sidebar.tsx` | Component | 2 |
| `components/canon/episode-summary-generator.tsx` | Component | 2 |
| `components/canon/event-editor.tsx` | Component | 2 |
| `components/canon/thread-timeline.tsx` | Component | 3 |
| `components/canon/character-arc-chart.tsx` | Component | 3 |

---

## Navigation

Canon settings should appear in the project settings sidebar:

```
PROJECT SETTINGS
├── General
├── Team
├── Billing
├── Canon                    ← NEW
│   ├── Dashboard
│   ├── Events
│   ├── Threads
│   └── Characters
└── Danger Zone
```

---

## See Also

- [ARCHITECTURE.md](ARCHITECTURE.md) - System overview
- [FILM-1007: Canon UI Components](ui/FILM-1007-canon-ui-components.md) - Component specs
- [FILM-1005: Canon Actions](server/FILM-1005-canon-actions.md) - Server actions
