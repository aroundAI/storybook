# FILM-1140: Research Hub UI

| Field | Value |
|-------|-------|
| **Status** | 🔵 SPEC |
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

- [ ] `/research` route accessible from sidebar
- [ ] Sources list shows all project sources with CRUD
- [ ] Facts list shows extracted facts with verification toggle
- [ ] Empty state guides user based on content type
- [ ] Source counts show in sidebar nav item
- [ ] Proper loading and error states
- [ ] Mobile responsive layout
