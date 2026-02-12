# FILM-1143: Generate Season Content Type Integration

| Field | Value |
|-------|-------|
| **Status** | ✅ DONE |
| **Priority** | P1 |
| **Estimate** | 6h |
| **Dependencies** | FILM-1110, FILM-1135, FILM-1140 |

## Summary

Update the Generate Season dialog to be aware of the project's content type and show linked research sources, ensuring fact-based content types use external context during generation.

## Goals

1. Show content type banner in Generate Season dialog
2. Display linked sources summary
3. Require sources for factual content types
4. Pass external context to story generation
5. Preview memory context including facts

---

## Location

**File:** `apps/web/app/home/[account]/studio/[projectSlug]/episodes/_components/season-generator-dialog.tsx`

## Current Flow

```
1. Premise (roadmap input)
2. Assets (character/location mapping)  
3. Generate (create episodes)
```

## Proposed Changes

### Step 1: Premise - Add Content Type Banner

```
┌──────────────────────────────────────────────────────────────────┐
│  Generate Season                                                 │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 📚 DOCUMENTARY PROJECT                                     │ │
│  │ External facts will be included in story generation.       │ │
│  │                                                            │ │
│  │ Linked Sources (12 facts):                                 │ │
│  │ • NASA History (PDF) - 8 facts                            │ │
│  │ • Reuters Science (API) - 4 articles                      │ │
│  │                                                            │ │
│  │ [+ Add More Sources] [View Facts →]                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Production Roadmap:                                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ # Mars Documentary - Season 1                              │ │
│  │ ...                                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Content Type Variants

**Series/Movie (fiction):**
```
┌────────────────────────────────────────────────────────────────┐
│ 🎬 SERIES PROJECT                                              │
│ Canon memory will maintain character and story consistency.    │
│ Canon Events: 24 | Character States: 8 | Active Threads: 3    │
└────────────────────────────────────────────────────────────────┘
```

**Documentary/Educational:**
```
┌────────────────────────────────────────────────────────────────┐
│ 📚 DOCUMENTARY PROJECT                                         │
│ External facts will be included in story generation.           │
│                                                                │
│ Linked Sources: 3 sources, 47 facts                            │
│ ⚠️ No sources added yet - stories may be less accurate        │
│                                                                │
│ [Add Sources in Research Tab →]                                │
└────────────────────────────────────────────────────────────────┘
```

**News:**
```
┌────────────────────────────────────────────────────────────────┐
│ 📰 NEWS PROJECT                                                 │
│ Live news feeds will provide balanced coverage.                 │
│                                                                │
│ Connected APIs: NewsAPI (Science, Technology)                   │
│ Balance: ✓ Left (NPR) ✓ Center (Reuters) ✓ Right (WSJ)         │
│ Last refresh: 2 hours ago [Refresh Now]                        │
└────────────────────────────────────────────────────────────────┘
```

---

## Component: ContentTypeBanner

```typescript
interface ContentTypeBannerProps {
  projectId: string;
  contentType: 'series' | 'movie' | 'factual' | 'news';
}

export function ContentTypeBanner({ projectId, contentType }: ContentTypeBannerProps) {
  const { sources, facts, loading } = useResearchSummary(projectId);
  
  return (
    <Alert variant={getVariant(contentType)}>
      <AlertIcon icon={getIcon(contentType)} />
      <AlertTitle>{getTitle(contentType)}</AlertTitle>
      <AlertDescription>
        {getDescription(contentType, sources, facts)}
      </AlertDescription>
      {needsSources(contentType) && sources.length === 0 && (
        <AlertAction>
          <Link href={`/research`}>Add Sources in Research Tab →</Link>
        </AlertAction>
      )}
    </Alert>
  );
}
```

---

## Data Flow

### Fetch Project Settings

```typescript
// In SeasonGeneratorDialog
const { data: project } = useProject(projectId);
const canonSettings = project?.metadata?.canon;
const contentType = canonSettings?.contentType ?? 'series';
```

### Fetch Research Summary

```typescript
// Hook to get source and fact counts
function useResearchSummary(projectId: string) {
  const [data, setData] = useState({ sources: [], facts: [], loading: true });
  
  useEffect(() => {
    getResearchSummaryAction(projectId).then(setData);
  }, [projectId]);
  
  return data;
}
```

---

## Server Action Updates

### Season Analysis with Facts

Update `analyzeSeasonRoadmapAction` to include external context:

```typescript
export async function analyzeSeasonRoadmapAction(data: AnalyzeSeasonInput) {
  const { projectId, roadmap } = data;
  
  // Get content type
  const project = await getProject(projectId);
  const contentType = project.metadata?.canon?.contentType;
  
  // Get external facts if factual content type
  let externalContext = null;
  if (['factual', 'news'].includes(contentType)) {
    externalContext = await getExternalContextForGeneration(projectId);
  }
  
  // Build memory context
  const memoryContext = await buildMemoryContext({
    projectId,
    includeFacts: true,
    externalContext,
  });
  
  // Queue LLM job with enriched context
  return queueSeasonAnalysis({
    roadmap,
    memoryContext,
    externalContext,
  });
}
```

### New Action: Research Summary

```typescript
// packages/features/episodes/src/server/research-actions.ts

export async function getResearchSummaryAction(projectId: string) {
  const client = await getSupabaseServerClient();
  
  const { data: sources } = await client
    .from('external_sources')
    .select('id, name, type, status')
    .eq('project_id', projectId);
    
  const { count: factCount } = await client
    .from('external_content')
    .select('id', { count: 'exact' })
    .eq('project_id', projectId)
    .eq('content_type', 'fact');
    
  return {
    sources: sources ?? [],
    factCount: factCount ?? 0,
    hasApiSources: sources?.some(s => s.type === 'api'),
  };
}
```

---

## Prompt Integration

### Updated Season Analysis Prompt

```json
{
  "name": "season-analysis",
  "system": "You are analyzing a production roadmap to generate episode outlines.\n\n{{#if externalContext}}## VERIFIED FACTS\nUse these facts in your episode outlines where relevant:\n{{externalContext}}\n{{/if}}\n\n{{#if memoryContext}}## CANON CONTEXT\n{{memoryContext}}\n{{/if}}",
  "user": "Analyze this roadmap and generate episode outlines:\n\n{{roadmap}}"
}
```

---

## Validation

### Require Sources for Factual Content

```typescript
// In handleAnalyze
const handleAnalyze = (data) => {
  if (['factual', 'news'].includes(contentType) && sources.length === 0) {
    toast.warning(
      'No fact sources linked. Stories will be based only on the roadmap.'
    );
  }
  
  // Proceed with analysis...
};
```

---

## Acceptance Criteria

- [x] Content type banner shows in Generate Season
- [x] Banner shows linked sources summary
- [x] Warning shown when factual content has no sources
- [ ] "Add Sources" link navigates to Research tab
- [ ] External facts passed to season analysis
- [ ] Memory context includes external facts
- [ ] News projects show API connection status
- [ ] Refresh button updates live API sources
