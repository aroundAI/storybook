---
spec_id: FILM-1140
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-1140: Research Hub UI

| Field | Value |
|-------|-------|
| **Status** | 🟡 PARTIAL (audit 2026-09-23; was ✅ DONE) |
| **Priority** | P1 |
| **Estimate** | 8h |
| **Dependencies** | FILM-1135 (ExternalContextProvider) |

## Summary

Create a new "Research" section in the Studio sidebar where users can manage fact sources, external APIs, and verified facts for fact-based content types (documentary, educational, news).

## Goals

1. Provide a dedicated hub for managing external knowledge sources
2. Link sources to the unified `external_sources` table (FILM-1135)
3. Show content-type-specific guidance based on project settings
4. Enable fact curation workflow

## Non-Goals

- Automatic fact extraction (see FILM-1141)
- Episode-level fact linking (see FILM-1142)
- Generate Season integration (see FILM-1143)

---

## Route Structure

```
/home/[account]/studio/[projectSlug]/research/
├── page.tsx           → Research hub overview
├── sources/
│   └── page.tsx       → Source management
└── facts/
    └── page.tsx       → Verified facts library
```

## Sidebar Integration

Add to `studio-sidebar.tsx`:

```typescript
// After Assets section, before Settings
<div>
  <SectionHeader isCollapsed={isCollapsed}>Research</SectionHeader>
  <nav className="space-y-0.5">
    <NavItem
      href={`${basePath}/research`}
      icon={<BookOpen className="h-4 w-4" />}
      label="Research"
      count={counts.sources}
      isActive={isActive(`${basePath}/research`)}
      isCollapsed={isCollapsed}
    />
  </nav>
</div>
```

---

## Component: ResearchHubPage

### Overview State

Shows summary cards for:
- Total sources (PDFs, URLs, APIs)
- Extracted facts count
- Verified facts count
- Content type reminder

### Empty State

```
┌──────────────────────────────────────────────────────────────────┐
│  📚 Research Hub                                                 │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  No sources added yet                                      │ │
│  │                                                            │ │
│  │  Add fact sources to improve story accuracy.               │ │
│  │  Sources are used by AI during story generation.           │ │
│  │                                                            │ │
│  │  [+ Add Source]                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Suggested for Documentary projects:                             │
│  • Academic papers (PDF)                                        │
│  • Wikipedia articles                                           │
│  • Government databases                                         │
│  • News archives                                                │
└──────────────────────────────────────────────────────────────────┘
```

### Active State

```
┌──────────────────────────────────────────────────────────────────┐
│  📚 Research Hub                              [+ Add Source]     │
│                                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐│
│  │ 12          │ │ 47          │ │ 23          │ │ Documentary ││
│  │ Sources     │ │ Facts       │ │ Verified    │ │ Content Type││
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘│
│                                                                  │
│  Recent Sources                                                  │
│  ────────────────────────────────────────────────────────────── │
│  📄 NASA_History.pdf        │ 14 facts │ Tier 1  │ 2h ago      │
│  🔗 en.wikipedia.org/Mars   │ 8 facts  │ Tier 2  │ 1d ago      │
│  📡 NewsAPI (Science)       │ Live     │ Mixed   │ Active      │
│                                                                  │
│  [View All Sources →]                   [View All Facts →]       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component: SourcesListPage

### Table Columns

| Column | Description |
|--------|-------------|
| Name | Source title with type icon |
| Type | file/url/api |
| Facts | Extracted fact count |
| Tier | Trust level (1-3) |
| Status | active/pending/error |
| Actions | Edit, Refresh, Delete |

### Source Types

```typescript
type SourceType = 'file' | 'url' | 'api';

interface ExternalSource {
  id: string;
  projectId: string;
  name: string;
  type: SourceType;
  config: {
    // For file
    storagePath?: string;
    mimeType?: string;
    
    // For url
    url?: string;
    refreshInterval?: number;
    
    // For api
    provider?: 'newsapi' | 'semantic_scholar' | 'wikipedia';
    categories?: string[];
    query?: string;
  };
  credibility: {
    tier: 1 | 2 | 3;
    biasLabel?: 'left' | 'center' | 'right';
  };
  status: 'active' | 'pending' | 'error';
  lastFetched?: string;
  factCount?: number;
}
```

---

## Component: VerifiedFactsPage

### Fact Table

| Column | Description |
|--------|-------------|
| Fact | Short statement |
| Source | Link to source |
| Entities | Extracted entities (people, places, dates) |
| Verified | Checkbox for manual verification |
| Episodes | Count of episodes using this fact |

### Fact Card

```
┌─────────────────────────────────────────────────────────────────┐
│ ☑️ Water was discovered on Mars in 2024 by NASA's Perseverance │
│    Source: NASA.gov (Tier 1)                                    │
│    Entities: Mars, NASA, Perseverance, 2024                     │
│    Used in: Episode 3, Episode 7                                │
│    [Edit] [Delete] [Unverify]                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Integration

Uses tables from FILM-1135:
- `external_sources` - Source registry
- `external_content` - Cached content and extracted facts

---

## Server Actions

```typescript
// packages/features/episodes/src/server/research-actions.ts

export async function listSourcesAction(projectId: string);
export async function createSourceAction(data: CreateSourceInput);
export async function updateSourceAction(sourceId: string, data: UpdateSourceInput);
export async function deleteSourceAction(sourceId: string);
export async function refreshSourceAction(sourceId: string);

export async function listFactsAction(projectId: string, options?: { verified?: boolean });
export async function verifyFactAction(factId: string, verified: boolean);
export async function deleteFactAction(factId: string);
```

---

## Acceptance Criteria

- [x] `/research` route accessible from sidebar
- [ ] Sources list shows all project sources with CRUD — *audit: no longer true* — no edit in the hub (`updateExternalSourceAction` has no caller); sources are global, not per project
- [ ] Facts list shows extracted facts with verification toggle — *audit: no longer true* — the Facts tab only links out (`apps/web/app/home/[account]/studio/[projectSlug]/research/_components/research-hub-page.tsx:274`); verifying is refused (KB-18)
- [ ] Empty state guides user based on content type — *audit: no longer true* — one generic empty state (`apps/web/app/home/[account]/studio/[projectSlug]/research/_components/research-hub-page.tsx:193`); content type never read
- [ ] Source counts show in sidebar nav item — *audit: no longer true* — the sources half filters `external_content` by `project_id`, a column it lacks (`apps/web/app/home/[account]/studio/[projectSlug]/layout.tsx:84`)
- [ ] Proper loading and error states — *audit: no longer true* — shows "No sources configured" until the client fetch returns (`apps/web/app/home/[account]/studio/[projectSlug]/research/_components/research-hub-page.tsx:189`)
- [ ] Mobile responsive layout — *audit: unverified* — responsive classes present (`apps/web/app/home/[account]/studio/[projectSlug]/research/_components/research-hub-page.tsx:135`); needs a phone-width screenshot

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| Sources list shows all project sources with CRUD | The hub lists and soft-deletes sources and adds them via `AddSourceDialog`, but offers no edit; `updateExternalSourceAction` (`packages/features/episodes/src/server/external-context-actions.ts:288`) has no caller. `external_sources` is global by design (`external-context-actions.ts:351`), so there are no "project sources" | unassigned |
| Facts list shows extracted facts with verification toggle | The hub's Facts tab is a card linking to the Facts Library (`research-hub-page.tsx:274`); there, verification is always refused | KB-18 |
| Empty state guides user based on content type | `page.tsx` selects `metadata` but never passes a content type; the empty state is fixed text (`research-hub-page.tsx:193`) | unassigned |
| Source counts show in sidebar nav item | The count is `researchSources + researchFacts` (`apps/web/app/home/[account]/studio/[projectSlug]/_components/studio-sidebar.tsx:494`); `researchSources` queries `external_content.project_id` (`layout.tsx:84`), which no migration or generated type defines, so that request errors and only facts are counted | unassigned |
| Proper loading and error states | `sources` starts as `[]` (`research-hub-page.tsx:88`) and the empty state renders whenever it is empty (`:189`), so every load first shows "No sources configured"; `loadData` catches nothing | unassigned |
