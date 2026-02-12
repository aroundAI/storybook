# FILM-1142: Canon Dashboard Facts Tab

| Field | Value |
|-------|-------|
| **Status** | ✅ DONE |
| **Priority** | P2 |
| **Estimate** | 6h |
| **Dependencies** | FILM-1135, FILM-1140 |

## Summary

Add a "Facts" tab to the existing Canon Dashboard (in Story sidebar) that shows external facts relevant to the current episode.

## Goals

1. Display facts linked to the current episode
2. Allow users to link/unlink facts from the Research library
3. Show which facts were used in story generation
4. Indicate fact source and credibility

---

## Location

**File:** `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/story/_components/canon-dashboard.tsx`

## Current Tabs

```typescript
// Current tabs in CanonDashboard
<Tabs defaultValue="events">
  <TabsList>
    <TabsTrigger value="events">Events</TabsTrigger>
    <TabsTrigger value="states">States</TabsTrigger>
    <TabsTrigger value="threads">Threads</TabsTrigger>
  </TabsList>
  ...
</Tabs>
```

## Proposed Addition

```typescript
<Tabs defaultValue="events">
  <TabsList>
    <TabsTrigger value="events">Events</TabsTrigger>
    <TabsTrigger value="states">States</TabsTrigger>
    <TabsTrigger value="threads">Threads</TabsTrigger>
    <TabsTrigger value="facts">Facts</TabsTrigger>  {/* NEW */}
  </TabsList>
  
  <TabsContent value="facts">
    <EpisodeFactsPanel 
      projectId={projectId}
      episodeId={episodeId}
    />
  </TabsContent>
</Tabs>
```

---

## Component: EpisodeFactsPanel

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Facts                                              [+ Link]    │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ ☑️ Water discovered on Mars in 2024                       │ │
│  │    📄 NASA.gov (Tier 1)                                   │ │
│  │    Used in: Scene 3 ✓                                      │ │
│  │    [Unlink]                                               │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ ☑️ SpaceX Mars mission scheduled for 2026                 │ │
│  │    📰 Reuters (Tier 2)                                    │ │
│  │    Not yet used                                           │ │
│  │    [Unlink]                                               │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ─── Available Facts ────────────────────────────────────────  │
│  23 facts in Research library • [View All]                     │
└─────────────────────────────────────────────────────────────────┘
```

### Empty State

```
┌─────────────────────────────────────────────────────────────────┐
│  Facts                                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  No facts linked to this episode                                │
│                                                                 │
│  Link facts from your Research library to ensure                │
│  accurate story generation.                                     │
│                                                                 │
│  [+ Link Facts from Library]                                    │
│                                                                 │
│  Or go to Research → Facts to add new sources.                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component: LinkFactsDialog

Triggered by "+ Link" button.

```
┌──────────────────────────────────────────────────────────────────┐
│  Link Facts to Episode 3                                     ✕  │
│                                                                  │
│  Search: [Mars___________________________] 🔍                   │
│                                                                  │
│  Filter by source: [All Sources ▼]                              │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ☐ Mars has two moons: Phobos and Deimos                   │ │
│  │   NASA.gov • Tier 1                                       │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ ☑️ Water discovered on Mars in 2024                        │ │
│  │   NASA.gov • Tier 1 • Already linked                      │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ ☐ Mars average temperature is -60°C                       │ │
│  │   Wikipedia • Tier 2                                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [Cancel]                                     [Link 2 Selected]  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Junction Table

Already part of FILM-1135's `external_content`:

```sql
-- external_content table has episode_id for linking
CREATE TABLE IF NOT EXISTS external_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES external_sources(id),
  project_id UUID NOT NULL,
  episode_id UUID REFERENCES episodes(id),  -- Links fact to episode
  content_type TEXT NOT NULL,  -- 'fact', 'article', etc.
  content JSONB NOT NULL,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

For explicit linking without duplicating facts:

```sql
-- Episode-fact junction table
CREATE TABLE IF NOT EXISTS episode_facts (
  episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
  fact_id UUID REFERENCES external_content(id) ON DELETE CASCADE,
  used_in_generation BOOLEAN DEFAULT false,
  scene_reference TEXT,  -- e.g., "Scene 3, line 42"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (episode_id, fact_id)
);
```

---

## Server Actions

```typescript
// packages/features/episodes/src/server/episode-facts-actions.ts

export async function getEpisodeFactsAction(
  episodeId: string
): Promise<{ facts: EpisodeFact[] }>;

export async function linkFactsToEpisodeAction(
  episodeId: string,
  factIds: string[]
): Promise<void>;

export async function unlinkFactFromEpisodeAction(
  episodeId: string,
  factId: string
): Promise<void>;

export async function markFactUsedAction(
  episodeId: string,
  factId: string,
  sceneReference: string
): Promise<void>;

// Called during story generation to get linked facts
export async function getFactsForGenerationAction(
  episodeId: string
): Promise<{ facts: GenerationFact[] }>;
```

---

## Integration with Story Generation

In `story-generation-actions.ts`, inject linked facts:

```typescript
const linkedFacts = await getFactsForGenerationAction(episodeId);

// Format for injection into prompt
const factsContext = linkedFacts.map(f => 
  `[FACT from ${f.source}]: ${f.statement}`
).join('\n');

// Add to memory context
memoryContext.externalFacts = factsContext;
```

---

## Acceptance Criteria

- [x] Facts tab appears in Canon Dashboard
- [x] Shows linked facts with source attribution
- [x] Link dialog allows searching and selecting facts
- [x] Unlink button removes fact from episode
- [x] Used facts show scene reference when available
- [x] Empty state guides to Research library
- [x] Facts count shown in tab badge
