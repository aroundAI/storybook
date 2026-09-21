---
phase: 11
title: Canon Management Integration & Content Type Taxonomy
status: done
priority: critical
estimated_effort: 3-4 weeks
---

# Phase 11: Canon Management Integration & Content Type Taxonomy

> **Status**: 🔴 NOT STARTED - Blocking production usage  
> **Dependencies**: Phase 10 (Canon Management System) - ✅ Complete

## Executive Summary

Phase 10 created the Canon Management **infrastructure** (database tables, validators, prompts). Phase 11 **connects** this infrastructure to the actual generation pipeline and expands the system to support all content types: Movies, Series (hard narrative and episodic), Science/Documentary, and News.

> [!CAUTION]  
> **The current system is NOT integrated.** The canon prompts exist but are never called. Story generation does not use memory context. Episode summary extraction uses regex, not LLM.

---

## Problem Statement

### Critical Integration Gaps

| Component | Current State | Required State |
|-----------|---------------|----------------|
| `extractCanonChangesAction` | Uses regex patterns | Must use LLM with `canon-extraction` prompt |
| `story-generation.ts` handler | No memory context injection | Must call `buildMemoryContext()` and inject into prompt |
| `prompt-registry.ts` | Missing canon-roles prompts | Must register `planner`, `writer`, `editor`, `stylist` |
| `runRolePipeline()` | Defined but never called | Must be callable from generation handlers |
| Fact Management | Does not exist | Required for Science/Documentary content |
| Source Citations | Does not exist | Required for News content |

### Missing Content Type Support

The current system only considers episodic series. We need algorithms for:

1. **Movies** - Full-length content where AI loses context between acts
2. **Movie Sequels** - Linking existing movies in the system
3. **Hard Narrative Series** - True Detective style (one continuous story)
4. **Episodic with Background Arc** - Smallville/Friends style (episode stories + season arc)
5. **Science/Documentary** - Mythbusters/Cosmos (requires citations, research papers)
6. **News** - Live data ingestion from credible sources

---

## Content Type Taxonomy

### Master Taxonomy Table

| Content Type | Canon Model | Memory Horizon | Fact Requirements | Source Requirements | LLM Roles |
|--------------|-------------|----------------|-------------------|---------------------|-----------|
| **MOVIE** | Acts (3-5) | 10 scenes | Low | None | Planner → Writer → Editor → Stylist |
| **MOVIE_SEQUEL** | Cross-movie canon | Full first movie | Low | Link to parent movie | Extended Planner → Writer → Editor → Stylist |
| **SERIES_HARD** | Full season arc | 50 episodes | Low | None | Planner → Writer → Editor → Stylist |
| **SERIES_EPISODIC** | Episode + background arc | 10 episodes | Low | None | Planner → Writer → Editor → Stylist |
| **DOCUMENTARY** | Topic-based | 5 episodes | **HIGH** | Research papers, citations | Researcher → Fact-Checker → Writer → Stylist |
| **NEWS** | None (live) | 24 hours | **CRITICAL** | Credible news APIs | Aggregator → Fact-Checker → Writer → Presenter |

### Content Type Algorithms

#### 1. MOVIE Content Type

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MOVIE GENERATION PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ACTS (3-5 per movie)                                                       │
│  ─────────────────────                                                      │
│                                                                             │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌───────┐ │
│  │  ACT 1  │────▶│  ACT 2A │────▶│  ACT 2B │────▶│  ACT 3  │────▶│ FINAL │ │
│  │ Setup   │     │ Conflict│     │ Rising  │     │ Climax  │     │Review │ │
│  └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └───────┘ │
│       │               │               │               │                    │
│       ▼               ▼               ▼               ▼                    │
│  ┌────────────────────────────────────────────────────────────────┐        │
│  │  INTER-ACT CONTEXT BRIDGE                                       │        │
│  │  ────────────────────────                                       │        │
│  │  • Characters alive at act end                                  │        │
│  │  • Emotional states                                             │        │
│  │  • Plot threads to carry forward                                │        │
│  │  • Props and locations established                              │        │
│  └────────────────────────────────────────────────────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Algorithm: Act Context Bridge**

```typescript
interface ActContextBridge {
  actNumber: number;
  
  // Character state at act end
  charactersAlive: CharacterId[];
  characterStates: Map<CharacterId, EmotionalState>;
  
  // Plot continuity
  openThreads: ThreadId[];
  promises: string[];
  
  // Physical continuity
  currentLocation: string;
  establishedProps: string[];
  timeOfDay: string;
  
  // For next act
  mustResolve: string[];
  mustNotInclude: string[];
}
```

#### 2. MOVIE_SEQUEL Content Type

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MOVIE SEQUEL GENERATION PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────┐                                                      │
│  │  PARENT MOVIE(S)  │◀─── Link via project.metadata.sequel_of             │
│  │  ───────────────  │                                                      │
│  │  • Summary        │                                                      │
│  │  • Final state    │                                                      │
│  │  • Characters     │                                                      │
│  └─────────┬─────────┘                                                      │
│            │                                                                │
│            ▼                                                                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  SEQUEL CONTEXT BUILDER                                               │  │
│  │  ────────────────────                                                 │  │
│  │  • Import all immutable_events from parent                            │  │
│  │  • Import character_states (latest per character)                     │  │
│  │  • Import resolved narrative_threads                                  │  │
│  │  • Flag: "This is a sequel, characters may be older"                  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│            │                                                                │
│            ▼                                                                │
│  STANDARD MOVIE PIPELINE (with inherited canon)                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Database Change Required:**

```sql
ALTER TABLE projects ADD COLUMN sequel_of UUID[] DEFAULT '{}';
-- Array to support multiple parent movies (e.g., crossover films)
```

#### 3. SERIES_HARD (True Detective Style)

One continuous narrative across all episodes. Every episode builds directly on the last.

```
Canon Model:
├── SEASON = One complete story
├── EPISODE = One chapter
├── Memory Horizon = ALL previous episodes
├── Context = Full series summary + last 3 episode details
└── Validation = Strict (no contradiction allowed)
```

**Memory Context Strategy:**

```typescript
interface HardNarrativeContext {
  type: 'SERIES_HARD';
  
  // Always include
  seriesPremise: string;
  immutableEvents: ImmutableEvent[];  // ALL deaths, facts, etc.
  
  // Sliding window
  recentEpisodes: EpisodeSummary[];   // Last 3 with full detail
  olderEpisodes: EpisodeSummary[];    // Earlier episodes, compressed
  
  // Thread tracking
  masterThread: NarrativeThread;       // The main mystery/story
  subThreads: NarrativeThread[];       // Supporting arcs
  
  // Character arcs (critical for hard narrative)
  characterArcs: Map<CharacterId, Arc>;
}
```

#### 4. SERIES_EPISODIC (Smallville/Friends Style)

Each episode has its own story, but there's a background arc across the season.

```
Canon Model:
├── SEASON = Background arc
├── EPISODE = Self-contained story + arc touchpoint
├── Memory Horizon = 10 episodes (for callbacks)
└── Validation = Flexible (minor inconsistencies tolerated)

Episode Structure:
┌─────────────────────────────────────────┐
│  EPISODE CONTENT (80%)                  │
│  ─────────────────────                  │
│  • Monster of the week                  │
│  • Problem introduced and resolved      │
│  • Character growth within episode      │
│                                         │
├─────────────────────────────────────────┤
│  BACKGROUND ARC TOUCHPOINT (20%)        │
│  ───────────────────────────────        │
│  • One scene advancing season arc       │
│  • Callbacks to previous episodes       │
│  • Setup for future episodes            │
└─────────────────────────────────────────┘
```

#### 5. DOCUMENTARY (Mythbusters/Cosmos Style)

**Critical Addition: Fact Management System**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DOCUMENTARY GENERATION PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  FACT REGISTRY (NEW TABLE: verified_facts)                            │  │
│  │  ─────────────────────────────────────                                │  │
│  │  • fact_id: UUID                                                      │  │
│  │  • claim: TEXT (the statement)                                        │  │
│  │  • source_type: ENUM (research_paper, textbook, expert, official)     │  │
│  │  • source_url: TEXT                                                   │  │
│  │  • source_citation: TEXT (APA/MLA format)                             │  │
│  │  • verification_status: ENUM (unverified, verified, disputed)         │  │
│  │  • verified_by: UUID (user who verified)                              │  │
│  │  • confidence_score: DECIMAL (0.0-1.0)                                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  RESEARCHER ROLE (NEW LLM ROLE)                                       │  │
│  │  ────────────────────────────                                         │  │
│  │  • Input: Topic + sub-topics                                          │  │
│  │  • Output: List of claims that need verification                      │  │
│  │  • Does NOT generate facts, only identifies what needs sources        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│            │                                                                │
│            ▼                                                                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  FACT-CHECKER ROLE (NEW LLM ROLE)                                     │  │
│  │  ──────────────────────────────                                       │  │
│  │  • Input: Claims + source material                                    │  │
│  │  • Matches claims to verified_facts table                             │  │
│  │  • Flags unverified claims for human review                           │  │
│  │  • Output: Verified claims with citations                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│            │                                                                │
│            ▼                                                                │
│  WRITER ROLE → STYLIST ROLE → Output with inline citations                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**New Database Table: `verified_facts`**

```sql
CREATE TABLE verified_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  
  -- The claim
  claim TEXT NOT NULL,
  simplified_claim TEXT,  -- For easier matching
  
  -- Source
  source_type VARCHAR(50) CHECK (source_type IN (
    'research_paper', 'textbook', 'encyclopedia', 
    'expert_interview', 'official_document', 'historical_record'
  )),
  source_url TEXT,
  source_citation TEXT,  -- Full citation (APA format)
  source_metadata JSONB,  -- DOI, publication date, authors, etc.
  
  -- Verification
  verification_status VARCHAR(20) DEFAULT 'unverified' CHECK (
    verification_status IN ('unverified', 'verified', 'disputed', 'retracted')
  ),
  verified_by UUID REFERENCES auth.users,
  verified_at TIMESTAMPTZ,
  
  -- Confidence
  confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  
  -- Usage tracking
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 6. NEWS Content Type

**Critical Addition: Live Data Ingestion**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          NEWS GENERATION PIPELINE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  NEWS SOURCE REGISTRY (NEW TABLE: news_sources)                       │  │
│  │  ─────────────────────────────────────                                │  │
│  │  • source_id: UUID                                                    │  │
│  │  • name: TEXT (e.g., "Reuters", "AP News")                            │  │
│  │  • credibility_tier: ENUM (tier_1, tier_2, tier_3)                    │  │
│  │  • api_config: JSONB (API keys, endpoints)                            │  │
│  │  • bias_label: TEXT (left, center, right, etc.)                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  NEWS ARTICLE CACHE (NEW TABLE: news_articles)                        │  │
│  │  ────────────────────────────────────                                 │  │
│  │  • article_id: UUID                                                   │  │
│  │  • source_id: UUID → news_sources                                     │  │
│  │  • headline: TEXT                                                     │  │
│  │  • content: TEXT                                                      │  │
│  │  • published_at: TIMESTAMPTZ                                          │  │
│  │  • fetched_at: TIMESTAMPTZ                                            │  │
│  │  • topics: TEXT[]                                                     │  │
│  │  • entities: JSONB (people, places, organizations)                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  AGGREGATOR ROLE → FACT-CHECKER ROLE → WRITER ROLE → PRESENTER ROLE        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Specifications

### Phase 11.1: Core Integration (Week 1)

| ID | Title | Files | Description |
|----|-------|-------|-------------|
| FILM-1101 | Register Canon Prompts | `prompt-registry.ts` | Add planner, writer, editor, stylist prompts |
| FILM-1102 | Memory Context Injection | `story-generation.ts` | Call `buildMemoryContext()` and inject into prompt |
| FILM-1103 | LLM-based Canon Extraction | `canon-actions.ts` | Replace regex with LLM call in `extractCanonChangesAction` |
| FILM-1104 | Validation Integration | `story-generation.ts` | Call validator at checkpoints |

### Phase 11.2: Content Type Framework (Week 2)

| ID | Title | Files | Description |
|----|-------|-------|-------------|
| FILM-1110 | Content Type Enum | `projects` table, types | Add content_type column and TypeScript types |
| FILM-1111 | Content Type Configs | New config file | Config per content type (memory horizon, validation level) |
| FILM-1112 | Act Context Bridge | New file | Movie act-to-act context management |
| FILM-1113 | Sequel System | Migration + types | sequel_of column and cross-project canon |

### Phase 11.3: Fact Management (Week 3)

| ID | Title | Files | Description |
|----|-------|-------|-------------|
| FILM-1120 | Verified Facts Table | Migration | New `verified_facts` table |
| FILM-1121 | Fact Management UI | New components | CRUD for facts, citation builder |
| FILM-1122 | Researcher Role Prompt | New prompt JSON | Topic → claims requiring verification |
| FILM-1123 | Fact-Checker Role Prompt | New prompt JSON | Claims → verified citations |

### Phase 11.4: News System (Week 4)

| ID | Title | Files | Description |
|----|-------|-------|-------------|
| FILM-1130 | News Source Registry | Migration | New `news_sources` table |
| FILM-1131 | News Article Cache | Migration | New `news_articles` table |
| FILM-1132 | News Aggregator | New service | Fetch from configured sources |
| FILM-1132 | News Aggregator API | New service | Fetch from configured sources |
| FILM-1133 | News Anchor Role | New prompt JSON | Source → broadcast script |
| FILM-1134 | Producer Role | New prompt JSON | Episode structure & orchestration |

---

## Detailed Specifications

### Integration Specs

- [FILM-1101: Register Canon Prompts in Lambda Worker](integration/FILM-1101-register-canon-prompts.md)
- [FILM-1102: Memory Context Injection into Story Generation](integration/FILM-1102-memory-context-injection.md)
- [FILM-1103: LLM-Based Canon Extraction](integration/FILM-1103-llm-canon-extraction.md)
- [FILM-1104: Validation Integration at Generation Checkpoints](integration/FILM-1104-validation-integration.md)

### Content Type Specs

- [FILM-1110: Content Type Enum and Project Configuration](content-types/FILM-1110-content-type-enum.md)
- [FILM-1111: Content Type Configurations and Memory Strategies](content-types/FILM-1111-content-type-configs.md)
- [FILM-1112: Movie Act Context Bridge](content-types/FILM-1112-act-context-bridge.md)
- [FILM-1113: Movie Sequel Linking System](content-types/FILM-1113-sequel-system.md)

### Fact Management Specs

- [FILM-1120: Verified Facts Database Table](fact-management/FILM-1120-verified-facts-table.md)
- [FILM-1121: Fact Management UI Components](fact-management/FILM-1121-fact-management-ui.md)
- [FILM-1122: Researcher LLM Role Prompt](fact-management/FILM-1122-researcher-role.md)
- [FILM-1123: Fact-Checker LLM Role Prompt](fact-management/FILM-1123-fact-checker-role.md)

### News System Specs

- [FILM-1130: News Source Registry Database Table](news-system/FILM-1130-news-source-registry.md)
- [FILM-1131: News Article Cache Database Table](news-system/FILM-1131-news-article-cache.md)
- [FILM-1132: News Aggregator API Integration](news-system/FILM-1132-news-aggregator-api.md)
- [FILM-1133: News Anchor LLM Role Prompt](news-system/FILM-1133-anchor-role.md)
- [FILM-1134: Producer LLM Role Prompt](news-system/FILM-1134-producer-role.md)

### External Context Providers (Unified Architecture)

- [FILM-1135: External Context Provider Interface](providers/FILM-1135-external-context-provider.md)

> [!IMPORTANT]
> FILM-1135 supersedes the news-specific provider design. It creates a unified `ExternalContextProvider` interface that works for news, research papers, historical archives, and other external sources. FILM-1130-1132 should be implemented using this unified architecture.

### UI Integration Specs

- [FILM-1140: Research Hub UI](ui-integration/FILM-1140-research-hub-ui.md)
- [FILM-1141: Fact Source Upload & Extraction](ui-integration/FILM-1141-fact-source-upload.md)
- [FILM-1142: Canon Dashboard Facts Tab](ui-integration/FILM-1142-canon-dashboard-facts.md)
- [FILM-1143: Generate Season Content Type Integration](ui-integration/FILM-1143-generate-season-integration.md)

> [!NOTE]
> These UI specs define how the external context system surfaces to users. They integrate with the existing Studio sidebar, Canon Dashboard, and Generate Season dialog.

---

## File Changes Matrix

### Must Modify

| File | Change | Priority |
|------|--------|----------|
| `apps/web/lambda/llm-worker/prompt-registry.ts` | Register canon-role prompts | P0 |
| `apps/web/lambda/llm-worker/handlers/story-generation.ts` | Inject memory context | P0 |
| `packages/features/episodes/src/server/canon-actions.ts` | Replace regex with LLM | P0 |
| `packages/features/episodes/src/lib/canon/llm-role-orchestrator.ts` | Expose for Lambda use | P0 |
| `apps/web/supabase/schemas/` | Add new tables | P1 |

### Must Create

| File | Purpose | Priority |
|------|---------|----------|
| `packages/features/prompt-engine/src/prompts/canon-roles/canon-extraction.json` | LLM-based canon extraction | P0 |
| `packages/features/episodes/src/lib/content-types/` | Content type configurations | P1 |
| `apps/web/supabase/migrations/*_add_verified_facts.sql` | Fact management table | P2 |
| `apps/web/supabase/migrations/*_add_news_sources.sql` | News source tables | P3 |

---

## API Changes

### New Prompt Templates Required

```
packages/features/prompt-engine/src/prompts/
├── canon-roles/
│   ├── planner-role.json      ✅ EXISTS - needs registration
│   ├── writer-role.json       ✅ EXISTS - needs registration
│   ├── editor-role.json       ✅ EXISTS - needs registration
│   ├── stylist-role.json      ✅ EXISTS - needs registration
│   └── canon-extraction.json  ❌ NEW - for extractCanonChangesAction
├── documentary/               ❌ NEW FOLDER
│   ├── researcher-role.json
│   └── fact-checker-role.json
└── news/                      ❌ NEW FOLDER
    ├── aggregator-role.json
    └── presenter-role.json
```

### New Server Actions Required

```typescript
// Documentary
export const addVerifiedFactAction = enhanceAction(...);
export const searchFactsAction = enhanceAction(...);
export const matchClaimToFactsAction = enhanceAction(...);

// News
export const addNewsSourceAction = enhanceAction(...);
export const fetchLatestNewsAction = enhanceAction(...);
export const aggregateNewsForTopicAction = enhanceAction(...);

// Content Type
export const setProjectContentTypeAction = enhanceAction(...);
export const getContentTypeConfigAction = enhanceAction(...);
```

---

## Database Migrations Required

### Migration 1: Content Type Column

```sql
-- Add content_type to projects
ALTER TABLE projects 
ADD COLUMN content_type VARCHAR(30) DEFAULT 'SERIES_EPISODIC' 
CHECK (content_type IN (
  'MOVIE', 
  'MOVIE_SEQUEL',
  'SERIES_HARD',
  'SERIES_EPISODIC',
  'DOCUMENTARY',
  'NEWS'
));

-- Add sequel linking
ALTER TABLE projects 
ADD COLUMN sequel_of UUID[] DEFAULT '{}';
```

### Migration 2: Verified Facts

```sql
CREATE TABLE verified_facts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  simplified_claim TEXT,
  source_type VARCHAR(50),
  source_url TEXT,
  source_citation TEXT,
  source_metadata JSONB,
  verification_status VARCHAR(20) DEFAULT 'unverified',
  verified_by UUID REFERENCES auth.users,
  verified_at TIMESTAMPTZ,
  confidence_score DECIMAL(3,2),
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_verified_facts_project ON verified_facts(project_id);
CREATE INDEX idx_verified_facts_status ON verified_facts(verification_status);
```

### Migration 3: News Sources

```sql
CREATE TABLE news_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  domain TEXT,
  credibility_tier VARCHAR(20) CHECK (credibility_tier IN ('tier_1', 'tier_2', 'tier_3')),
  bias_label VARCHAR(30),
  api_config JSONB,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE news_articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID REFERENCES news_sources(id),
  headline TEXT NOT NULL,
  content TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  topics TEXT[],
  entities JSONB,
  embedding VECTOR(1536)  -- For semantic search
);

CREATE INDEX idx_news_articles_topics ON news_articles USING GIN(topics);
CREATE INDEX idx_news_articles_published ON news_articles(published_at DESC);
```

---

## Success Criteria

### Phase 11.1 (Core Integration)

- [ ] Story generation injects memory context from `buildMemoryContext()`
- [ ] Canon role prompts registered in Lambda prompt registry
- [ ] `extractCanonChangesAction` uses LLM instead of regex
- [ ] Validator runs at checkpoints (plot skeleton, scene blocks, dialogue)

### Phase 11.2 (Content Types)

- [ ] Projects have `content_type` column with 6 values
- [ ] Each content type has configurable memory horizon
- [ ] Movie sequels can link to parent movies
- [ ] Act context bridge works for movie generation

### Phase 11.3 (Fact Management)

- [ ] `verified_facts` table created with RLS
- [ ] UI for adding/searching/verifying facts
- [ ] Researcher and Fact-Checker roles produce valid output
- [ ] Generated content includes inline citations when type = DOCUMENTARY

### Phase 11.4 (News System)

- [ ] `news_sources` and `news_articles` tables created
- [ ] At least 3 news sources configured (e.g., Reuters, AP, BBC)
- [ ] News aggregation produces timestamped, attributed content
- [ ] Generated news includes source attribution

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LLM extraction worse than regex for simple cases | Medium | Low | Keep regex as fallback for high-confidence patterns |
| News API costs | High | Medium | Cache aggressively, limit refresh frequency |
| Citation hallucination in Documentary | High | High | Strict fact-only mode, no LLM-generated facts |
| Token budget explosion with cross-movie canon | Medium | Medium | Aggressive summarization, tiered detail levels |

---

## Estimated Timeline

| Week | Focus | Deliverables |
|------|-------|--------------|
| Week 1 | Core Integration | Story generation uses memory context, prompts registered |
| Week 2 | Content Types | 6 content types working, movie sequels functional |
| Week 3 | Fact Management | verified_facts table, researcher/fact-checker roles |
| Week 4 | News System | news_sources, news_articles, aggregator role |

---

## Appendix: Content Type Config Schema

```typescript
interface ContentTypeConfig {
  type: ContentType;
  
  // Memory management
  memoryHorizon: number;           // Episodes/acts to include
  contextWindowPercent: number;    // % of tokens for history
  
  // Validation
  enforcement: 'strict' | 'flexible' | 'none';
  validationRules: ValidationRuleId[];
  
  // Role pipeline
  roles: RoleId[];
  
  // Content-type specific
  requiresCitations: boolean;
  requiresLiveData: boolean;
  actStructure?: 'three_act' | 'five_act' | 'episodic';
  
  // Canon inheritance
  inheritCanonFrom?: 'sequel_of' | 'season' | 'none';
}

const CONTENT_TYPE_CONFIGS: Record<ContentType, ContentTypeConfig> = {
  MOVIE: {
    type: 'MOVIE',
    memoryHorizon: 10,  // scenes, not episodes
    contextWindowPercent: 15,
    enforcement: 'strict',
    validationRules: ['CANON_001', 'CANON_002', 'CANON_003'],
    roles: ['planner', 'writer', 'editor', 'stylist'],
    requiresCitations: false,
    requiresLiveData: false,
    actStructure: 'three_act',
    inheritCanonFrom: 'none',
  },
  MOVIE_SEQUEL: {
    type: 'MOVIE_SEQUEL',
    memoryHorizon: 10,
    contextWindowPercent: 20,  // Higher for sequel context
    enforcement: 'strict',
    validationRules: ['CANON_001', 'CANON_002', 'CANON_003', 'CANON_006'],
    roles: ['planner', 'writer', 'editor', 'stylist'],
    requiresCitations: false,
    requiresLiveData: false,
    actStructure: 'three_act',
    inheritCanonFrom: 'sequel_of',
  },
  SERIES_HARD: {
    type: 'SERIES_HARD',
    memoryHorizon: 50,
    contextWindowPercent: 18,
    enforcement: 'strict',
    validationRules: ['CANON_001', 'CANON_002', 'CANON_003', 'CANON_005', 'CANON_006'],
    roles: ['planner', 'writer', 'editor', 'stylist'],
    requiresCitations: false,
    requiresLiveData: false,
    actStructure: 'episodic',
    inheritCanonFrom: 'season',
  },
  SERIES_EPISODIC: {
    type: 'SERIES_EPISODIC',
    memoryHorizon: 10,
    contextWindowPercent: 15,
    enforcement: 'flexible',
    validationRules: ['CANON_001', 'CANON_002', 'CANON_005'],
    roles: ['planner', 'writer', 'editor', 'stylist'],
    requiresCitations: false,
    requiresLiveData: false,
    actStructure: 'episodic',
    inheritCanonFrom: 'season',
  },
  DOCUMENTARY: {
    type: 'DOCUMENTARY',
    memoryHorizon: 5,
    contextWindowPercent: 10,
    enforcement: 'strict',  // Facts must be accurate
    validationRules: ['CANON_001', 'CANON_006'],
    roles: ['researcher', 'fact_checker', 'writer', 'stylist'],
    requiresCitations: true,
    requiresLiveData: false,
    inheritCanonFrom: 'none',
  },
  NEWS: {
    type: 'NEWS',
    memoryHorizon: 0,  // Live data only
    contextWindowPercent: 5,
    enforcement: 'strict',
    validationRules: ['CANON_006'],  // Reference validation only
    roles: ['aggregator', 'fact_checker', 'writer', 'presenter'],
    requiresCitations: true,
    requiresLiveData: true,
    inheritCanonFrom: 'none',
  },
};
```

---

## Next Steps

1. **Review and approve this spec**
2. **Merge current PR #170** (Phase 10 infrastructure)
3. **Create branch `feature/FILM-1101-canon-integration`**
4. **Implement Phase 11.1** (Core Integration) as first PR
5. **Continue with weekly PRs** for each sub-phase
