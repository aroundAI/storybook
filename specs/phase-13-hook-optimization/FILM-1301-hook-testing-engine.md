---
spec_id: FILM-1301
title: Hook Testing Engine (The "Hook Lab")
status: Approved — folded into Phase 15 (FILM-1510)
effort: L
dependencies: FILM-1201, FILM-716
---

# Hook Testing Engine (The "Hook Lab")

> [!IMPORTANT]
> **Architectural decision (2026-08-27): Hybrid Approach (Option C, §9.6) — implemented as [FILM-1510](../phase-15-deep-analytics/FILM-1510-hook-lab.md) in Phase 15.**
> - The "Phase 1" aggregate layer is delivered by FILM-1507's `hook_type` taxonomy dimension + `queryMedianByTag`.
> - The dedicated `hook_retention_metrics` ClickHouse table and its `002_hook_retention.ts` migration are **superseded** by the generic `video_retention_curves` table (FILM-1505) interpolated against `video_dim.duration_seconds` (FILM-1506). The `002_` migration number is claimed by Phase 15 (`002_metrics_v2.ts`); the feature branch's migration must not be cherry-picked.
> - Supabase schema from the feature branch is renumbered to `71-hook-testing.sql`.
> - Everything else on `feature/FILM-1301-hook-testing-engine` (types, schemas, scoring, prompt template, CRUD actions) remains reusable per §9.5.

## 1. Overview

The **Hook Lab** allows creators to generate, test, and optimize the first 3-10 seconds of video content ("hooks") using data-driven A/B testing. This shifts the workflow from "Production First" to **"Validation First"**, aligning with the Brendan Kane methodology of iterative testing.

> [!IMPORTANT]
> This spec maps every proposed component to concrete codebase integration points, so AI agents can implement the Hook Lab incrementally with full context.

> [!CAUTION]
> **ARCHITECTURAL DECISION REQUIRED** — Before implementation, we must decide between
> two fundamentally different approaches. See **Section 9: Architectural Discussion** below.
> The backend tables, scoring logic, and prompt templates are shared across both approaches;
> only the **workflow integration point** changes.

---

## 2. User Experience (The "Scientific Method" Workflow)

### 2.1 The Hook Dashboard

A new top-level section in the Studio sidebar: **Hook Lab**.

**Route:** `/home/[account]/studio/[projectSlug]/hooks`

| View | Description |
|------|-------------|
| Active Experiments | List of running A/B tests with live metrics |
| Winning Hooks | Archive of hooks that exceeded the "Viral Threshold" (>75% retention at 3s) |
| Hypothesis Builder | "I believe [Emotion X] will beat [Emotion Y] for [Audience Z]" |

### 2.2 The Experiment Workbench

**Route:** `/home/[account]/studio/[projectSlug]/hooks/[hookTestId]`

**Step 1: Generate Variants**
- Input: Core Topic (e.g., "Black Holes") + optional character/location context from assets.
- Action: LLM generates 5 scripts based on different **Psychological Triggers**:
  - *Negative Bias Hook*: "Why Black Holes will destroy us tomorrow."
  - *Visual ASMR Hook*: "Watch this star get eaten." (Slow motion)
  - *Direct Question Hook*: "Can you survive spaghettification?"
  - *Pattern Interrupt Hook*: \[Loud Noise\] "Stop scrolling!"
  - *Authority Hook*: "NASA just confirmed..."

**Step 2: Batch Rendering**
- System renders only the first 5-10 seconds per variant.
- Uses `ContentStyle: action-heavy` (0.5x scaling) to keep it punchy.
- Generates VEO 3.1 shots using existing scene-shot pipeline.

**Step 3: Deploy to Test Channels**
- One-click publish to "Burner" channels (categorized by language/niche).
- Metadata auto-generated with invisible test identifiers for tracking.
- Videos published as `Unlisted` on YouTube or to dedicated "Lab" channels.

**Step 4: Analyze & Promote**
- **Live Graph**: 3-second retention overlaid for all variants.
- **Winner Declaration**: System auto-badges the winner based on retention threshold.
- **"Promote to Episode"**: Converts winning Hook into the Intro of a new Episode entity.

---

## 3. Data Architecture

### 3.1 Database Schema (Supabase)

```sql
-- Hook test experiment container
CREATE TABLE hook_tests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  topic TEXT NOT NULL,                          -- Core topic being tested
  hypothesis TEXT,                              -- "I believe X will beat Y"
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generating', 'rendering', 'live', 'completed', 'archived')),
  viral_threshold NUMERIC DEFAULT 0.75,         -- 3s retention threshold (0-1)
  account_id UUID NOT NULL REFERENCES accounts(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Individual hook variants within a test
CREATE TABLE hook_variants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id UUID NOT NULL REFERENCES hook_tests(id) ON DELETE CASCADE,
  hook_type TEXT NOT NULL,                      -- 'negative_bias', 'visual_asmr', 'question', 'pattern_interrupt', 'authority'
  label TEXT,                                   -- Human-readable variant name (e.g., "Variant A")
  script TEXT NOT NULL,                         -- Generated hook script text
  veo_prompt JSONB,                             -- VEO 3.1 structured prompt (same shape as VeoPromptData)
  asset_id UUID REFERENCES assets(id),          -- Rendered video asset
  thumbnail_url TEXT,
  duration_seconds NUMERIC DEFAULT 5,
  platform_publish_ids JSONB DEFAULT '{}',      -- { "youtube": "publish_uuid", "tiktok": "publish_uuid" }
  retention_3s NUMERIC,                         -- Cached 3-second retention rate (0-1)
  retention_full NUMERIC,                       -- Cached full-hook retention rate (0-1)
  total_views INTEGER DEFAULT 0,                -- Cached view count
  is_winner BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enforce single winner per test at the DB level
CREATE UNIQUE INDEX uq_one_winner_per_test ON hook_variants (test_id) WHERE is_winner IS TRUE;

-- RLS policies
ALTER TABLE hook_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hook_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY hook_tests_select ON hook_tests FOR SELECT
  USING (account_id IN (SELECT id FROM accounts WHERE id = auth.uid()
    UNION SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()));

CREATE POLICY hook_tests_insert ON hook_tests FOR INSERT
  WITH CHECK (account_id IN (SELECT id FROM accounts WHERE id = auth.uid()
    UNION SELECT account_id FROM accounts_memberships WHERE user_id = auth.uid()));
```

### 3.2 Analytics Schema (ClickHouse Extension)

Extends `@kit/clickhouse` with a dedicated retention metrics table.

```sql
CREATE TABLE hook_retention_metrics (
    project_id UUID,
    test_id UUID,
    variant_id UUID,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
    metric_date Date,
    metric_timestamp DateTime DEFAULT now(),
    views UInt64,
    retention_1s Float32,      -- % viewers remaining at 1 second
    retention_3s Float32,      -- % viewers remaining at 3 seconds
    retention_5s Float32,      -- % viewers remaining at 5 seconds
    retention_full Float32,    -- % viewers who watched entirely
    avg_view_duration_ms UInt32,
    likes UInt32,
    shares UInt32,
    comments UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(metric_date)
ORDER BY (project_id, test_id, variant_id, platform, metric_timestamp)
SETTINGS index_granularity = 8192
```

**Winner query:**
```sql
SELECT
    variant_id,
    avg(retention_3s) AS avg_retention_3s,
    sum(views) AS total_views
FROM hook_retention_metrics
WHERE test_id = {testId:UUID}
GROUP BY variant_id
ORDER BY avg_retention_3s DESC
LIMIT 1
```

---

## 4. Implementation Map

### 4.1 New Package: `@kit/hooks` (or extend `@kit/episodes`)

> Decision point: Create standalone `packages/features/hooks/` OR add as a sub-module within `packages/features/episodes/`. **Recommendation:** Standalone package — the Hook Lab has its own DB tables, routes, and lifecycle independent of episodes.
>
> **UPDATE (2026-02-16):** During initial implementation attempt, we chose Option C (inside `@kit/episodes`)
> because hook testing is tightly coupled to episode content. See **Section 9** for the full
> architectural discussion about whether this should be standalone, embedded, or hybrid.

**Proposed package structure:**
```
packages/features/hooks/
├── src/
│   ├── components/
│   │   ├── hook-dashboard.tsx           # Main dashboard view
│   │   ├── hook-test-card.tsx           # Test summary card for list view
│   │   ├── experiment-workbench.tsx     # Full test detail/editing view
│   │   ├── variant-generator.tsx        # LLM variant generation UI
│   │   ├── variant-preview.tsx          # Side-by-side preview of rendered variants
│   │   ├── retention-chart.tsx          # Overlaid retention curves
│   │   ├── winner-badge.tsx             # Winner declaration + promote button
│   │   └── hypothesis-builder.tsx       # Hypothesis form
│   ├── server/
│   │   ├── hook-test-actions.ts         # CRUD for hook_tests + hook_variants
│   │   ├── variant-generation-actions.ts # LLM script generation
│   │   ├── variant-render-actions.ts    # VEO 3.1 rendering orchestration
│   │   ├── hook-publish-actions.ts      # Test publishing to burner channels
│   │   ├── hook-analytics-actions.ts    # ClickHouse retention queries
│   │   └── promote-to-episode-actions.ts # Winner → Episode intro conversion
│   ├── lib/
│   │   ├── types.ts                     # HookTest, HookVariant, HookType types
│   │   ├── constants.ts                 # Hook type definitions, thresholds
│   │   └── scoring.ts                   # Retention scoring + winner logic
│   └── index.ts
├── package.json
└── tsconfig.json
```

### 4.2 Integration Points with Existing Code

| Integration | Existing Code | How Hook Lab Connects |
|-------------|---------------|----------------------|
| **Assets** | `@kit/assets` — `assets` table | Rendered hook videos stored as assets with `type: 'hook_video'` |
| **Shot generation** | `scene-shot-generation.json` prompt | Reuse for hook rendering — single scene, action-heavy, 5-10s max |
| **VEO 3.1 prompts** | `VeoPromptData` in `episodes/src/lib/types.ts` | Store in `hook_variants.veo_prompt` using same structure |
| **Publishing** | `publish-actions.ts` in `@kit/publishing` | Extend `publishToAllAction` with `is_hook_test: true` flag; use `unlisted` visibility |
| **ClickHouse** | `@kit/clickhouse` — `video_metrics` table | New `hook_retention_metrics` table, new migration file `002_hook_retention.ts` |
| **Prompt engine** | `@kit/prompt-engine` — JSON prompts | New prompt template: `hook-variant-generation.json` |
| **Intro assets** | `intro-actions.ts` in `@kit/episodes` | "Promote to Episode" creates entry in `project_intros` table |
| **Shorts metadata** | `ShortsMetadata` type with `hookType`, `viralScore` | Already exists — reuse for scoring hook variants |
| **Duration scaling** | `calculateContentScaling()` in `@kit/episodes` | Use `action-heavy` style with 5-10s target |
| **Permissions** | `canPerformProjectAction()` in `@kit/projects/queries` | Guard all hook actions with `project.edit` permission |
| **Project sidebar** | Studio layout `[projectSlug]/layout.tsx` | Add "Hook Lab" nav item |

### 4.3 New Prompt Template

**File:** `packages/features/prompt-engine/src/prompts/hook-testing/hook-variant-generation.json`

**Purpose:** Given a topic and project context, generate 5 variant scripts targeting different psychological triggers.

**Template variables:**
- `{{topic}}` — Core topic (e.g., "Black Holes")
- `{{hook_count}}` — Number of variants (default: 5)
- `{{characters}}` — Character context from project assets
- `{{target_audience}}` — From project settings
- `{{target_duration}}` — Hook duration in seconds (default: 5)
- `{{genre}}` — From project settings

**Expected output schema:**
```typescript
z.object({
  variants: z.array(z.object({
    hookType: z.enum(['negative_bias', 'visual_asmr', 'question', 'pattern_interrupt', 'authority']),
    script: z.string(),
    openingLine: z.string(),
    visualDirection: z.string(),
    estimatedImpact: z.number().min(1).max(10),
    rationale: z.string(),
  }))
})
```

### 4.4 App Routes

**New route files to create:**
```
apps/web/app/home/[account]/studio/[projectSlug]/hooks/
├── page.tsx                    # Hook Lab dashboard
├── layout.tsx                  # Hooks layout with breadcrumbs
├── [hookTestId]/
│   ├── page.tsx                # Experiment workbench
│   ├── analytics/
│   │   └── page.tsx            # Detailed retention analytics
│   └── loading.tsx
├── new/
│   └── page.tsx                # New experiment creation
└── loading.tsx
```

### 4.5 Sidebar Extension

**File to modify:** `apps/web/app/home/[account]/studio/[projectSlug]/layout.tsx`

Add new navigation item:
```typescript
{
  label: 'Hook Lab',
  href: `/home/${account}/studio/${projectSlug}/hooks`,
  icon: BeakerIcon, // from lucide-react
}
```

---

## 5. How-To: Common Operations

### 5.1 Create a New Hook Test

```typescript
// server/hook-test-actions.ts
'use server';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export const createHookTestAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    const { data: test, error } = await client
      .from('hook_tests')
      .insert({
        project_id: data.projectId,
        account_id: data.accountId,
        name: data.name,
        topic: data.topic,
        hypothesis: data.hypothesis,
        status: 'draft',
      })
      .select()
      .single();
    // ... error handling, return test
  },
  { schema: CreateHookTestSchema }
);
```

### 5.2 Generate Variant Scripts

```typescript
// server/variant-generation-actions.ts
import { loadPrompt, executePrompt } from '@kit/prompt-engine';

export const generateVariantsAction = enhanceAction(
  async (data) => {
    const prompt = await loadPrompt('hook-testing/hook-variant-generation');
    const result = await executePrompt(prompt, {
      topic: data.topic,
      hook_count: data.variantCount || 5,
      characters: data.characterContext,
      target_audience: data.targetAudience,
      target_duration: data.durationSeconds || 5,
      genre: data.genre,
    });

    // Insert variants into hook_variants table
    const variants = result.variants.map((v, i) => ({
      test_id: data.testId,
      hook_type: v.hookType,
      label: `Variant ${String.fromCharCode(65 + i)}`, // A, B, C, D, E
      script: v.script,
      duration_seconds: data.durationSeconds || 5,
    }));

    const { data: created } = await client
      .from('hook_variants')
      .insert(variants)
      .select();
    return { variants: created };
  },
  { schema: GenerateVariantsSchema }
);
```

### 5.3 Promote Winner to Episode Intro

```typescript
// server/promote-to-episode-actions.ts
import { uploadProjectIntroAction } from '@kit/episodes/server';

export const promoteToEpisodeAction = enhanceAction(
  async (data) => {
    // 1. Fetch winning variant
    const { data: variant } = await client
      .from('hook_variants')
      .select('*, hook_tests(*)')
      .eq('id', data.variantId)
      .single();

    // 2. Create as project intro using existing intro system
    await uploadProjectIntroAction({
      projectId: variant.hook_tests.project_id,
      language: 'en',
      videoUrl: variant.asset_url,
      durationSeconds: variant.duration_seconds,
    });

    // 3. Mark variant as winner and test as completed
    await client
      .from('hook_variants')
      .update({ is_winner: true })
      .eq('id', data.variantId);

    await client
      .from('hook_tests')
      .update({ status: 'completed' })
      .eq('id', variant.test_id);
  },
  { schema: PromoteSchema }
);
```

### 5.4 Query ClickHouse Retention Data

```typescript
// server/hook-analytics-actions.ts
import { getClickHouseClient } from '@kit/clickhouse/server';

export async function queryHookRetention(testId: string) {
  const client = getClickHouseClient();
  const result = await client.query({
    query: `
      SELECT
        variant_id,
        avg(retention_1s) as avg_1s,
        avg(retention_3s) as avg_3s,
        avg(retention_5s) as avg_5s,
        avg(retention_full) as avg_full,
        sum(views) as total_views
      FROM hook_retention_metrics
      WHERE test_id = {testId:UUID}
      GROUP BY variant_id
      ORDER BY avg_3s DESC
    `,
    query_params: { testId },
    format: 'JSONEachRow',
  });
  return result.json();
}
```

---

## 6. Security & Risk

- **Burner Channels**: Test content MUST NOT pollute the main channel's algorithmic score. Use dedicated "Lab" channels or publish as `Unlisted`.
- **Permission model**: All actions gated by `canPerformProjectAction('project.edit')` — same as episodes.
- **Multi-tenancy**: Hook data scoped by `project_id` and `account_id` with RLS policies.
- **Cost control**: Default limit of 5 variants per test, configurable per plan. VEO rendering capped at 10 seconds per variant.

---

## 7. Existing Code to Leverage

> [!TIP]
> The codebase already has significant hook-adjacent infrastructure. Leverage, don't rebuild.

| Concept | Already Exists | Location |
|---------|---------------|----------|
| Hook types enum | `hookType` in `ShortsMetadata` | `packages/features/episodes/src/lib/types.ts:401-407` |
| Viral scoring (1-10) | `viralScore` in `ShortsMetadata` | `packages/features/episodes/src/lib/types.ts:399` |
| Shorts-first mindset in prompts | System prompt in shot generation | `prompt-engine/src/prompts/story-generation/scene-shot-generation.json` |
| VEO 3.1 prompt structure | `VeoPromptData` type | `packages/features/episodes/src/lib/types.ts:220-227` |
| Duration scaling | `calculateContentScaling()` | `packages/features/episodes/src/lib/duration-scaling.ts` |
| Asset management | `assets` table + `@kit/assets` | `packages/features/assets/` |
| Publishing pipeline | `publishToAllAction` | `packages/features/publishing/src/server/publish-actions.ts` |
| Intro asset system | `uploadProjectIntroAction` | `packages/features/episodes/src/server/intro-actions.ts` |
| ClickHouse client | `getClickHouseClient()` | `packages/clickhouse/src/client.ts` |
| ClickHouse migrations | DDL scripts | `packages/clickhouse/src/migrations/` |
| Magic clips prompt | Viral clip extraction | `prompt-engine/src/prompts/publishing/magic-clips.json` |

---

## 8. Quick Reference: Proposed File Paths

| Concern | Proposed Path |
|---------|---------------|
| Hook Lab package | `packages/features/hooks/` |
| Dashboard component | `packages/features/hooks/src/components/hook-dashboard.tsx` |
| Test CRUD actions | `packages/features/hooks/src/server/hook-test-actions.ts` |
| Variant generation | `packages/features/hooks/src/server/variant-generation-actions.ts` |
| Publishing integration | `packages/features/hooks/src/server/hook-publish-actions.ts` |
| Analytics queries | `packages/features/hooks/src/server/hook-analytics-actions.ts` |
| Promote to episode | `packages/features/hooks/src/server/promote-to-episode-actions.ts` |
| Types | `packages/features/hooks/src/lib/types.ts` |
| Retention chart | `packages/features/hooks/src/components/retention-chart.tsx` |
| Prompt template | `prompt-engine/src/prompts/hook-testing/hook-variant-generation.json` |
| ClickHouse migration | `packages/clickhouse/src/migrations/002_hook_retention.ts` |
| Dashboard route | `apps/web/app/home/[account]/studio/[projectSlug]/hooks/page.tsx` |
| Experiment route | `apps/web/app/home/[account]/studio/[projectSlug]/hooks/[hookTestId]/page.tsx` |
| Sidebar modification | `apps/web/app/home/[account]/studio/[projectSlug]/layout.tsx` |

---

## 9. 🔴 Architectural Discussion: Standalone Lab vs. Embedded A/B

> [!WARNING]
> **This section captures a critical architectural discussion from 2026-02-16.**
> The decision here fundamentally changes how hooks are tested and where the
> feature lives in the product. **Must be resolved before implementation.**

### 9.1 The Core Tension

The original spec (Sections 2-8 above) designs the Hook Lab as a **standalone,
detached tool** — you go to a separate "Hook Lab" section, create isolated test
clips, publish them to burner channels, measure retention, then promote a winner
back into an episode.

But in practice, the real workflow is more nuanced: **you try different hooks
across actual episodes and shorts to see what's clicking with your audience.**
This suggests the hook testing should be **embedded** into the existing
production flow, not bolted on as a separate laboratory.

### 9.2 Two Approaches Compared

| Dimension | **Approach A: Standalone Lab** | **Approach B: Embedded A/B** |
|-----------|-------------------------------|------------------------------|
| **When testing happens** | Before production — dedicated experimentation phase | During production — test as part of normal publishing |
| **Content used** | Isolated 5-10s hook clips (rendered just for the test) | Real episodes and shorts you're already making |
| **Signal quality** | Retention on synthetic test clips (lower ecological validity) | Retention on actual published content (high ecological validity) |
| **Learning scope** | Per-test winner ("Variant A beat Variant B for this topic") | Cross-episode patterns ("Question hooks do 2x for our channel over 20 episodes") |
| **Workflow** | Separate route (`/hooks`), separate dashboard | Options inside existing episode/screenplay/publishing flow |
| **DB model** | `hook_tests` + `hook_variants` (separate tables) | Could extend `episodes` or `shorts_groups` with `hook_strategy` metadata |
| **User effort** | High — must create separate test, wait for results, then go back to episodes | Low — just choose "try 3 hook variants" when publishing |
| **Platform risk** | Burner channels may confuse platform algorithms | A/B on production channels requires careful traffic splitting |
| **Complexity** | Self-contained, simpler to build | Deeply integrated, requires changes across publishing, analytics, episode workflow |

### 9.3 Open Questions (Must Answer Before Building)

> [!IMPORTANT]
> These questions emerged during the 2026-02-16 discussion. Answering them will
> determine the correct architecture.

**Q1: Publishing flow integration**
When you publish an episode, would you want to optionally publish 2-3 versions
with different opening hooks, then let ClickHouse data tell you which one
retained better? If yes, this means the hook testing is inseparable from the
publishing pipeline — you'd need to extend `publishToAllAction` to handle
multi-variant publishing, and the analytics pipeline to track retention
per-variant for the same "logical" episode.

**Q2: Shorts as the primary test vehicle**
Since shorts are quick to produce (1-3 minutes), are they the natural vehicle for
hook testing? Shorts already have `hookType` and `viralScore` in `ShortsMetadata`.
If so, the Hook Lab might just be a "create 3 versions of this short with
different openings" button in the shorts workflow, not a separate section at all.

**Q3: Cross-episode learning vs. per-test results**
Are you more interested in:
- **(a) Individual A/B results** — "Hook A beat Hook B for this specific episode"
- **(b) Aggregate pattern insights** — "Across 20 episodes, question hooks
  outperform shock hooks by 30% for our channel"
- **(c) Both** — individual results that feed into an aggregate learning system

If (b) or (c), we need a **hook performance tracking layer** that tags every
published video's hook type and builds aggregate analytics in ClickHouse. This
is fundamentally different from a test-by-test experiment model.

**Q4: Scope of "hook" — script only or script + visuals?**
Is a hook variant:
- **(a) Just the opening line/script** — same visual, different words
- **(b) Script + visual direction** — different camera angles, pacing, effects
- **(c) Full alternate opening** — different story setup entirely

This affects rendering cost (VEO generations per variant) and the DB model
(whether `veo_prompt` is per-variant or shared).

**Q5: How many variants are practical?**
Kane's methodology suggests 5-15 variants, but:
- Each VEO render costs ~$0.05-0.10
- 15 variants × 3 platforms = 45 published videos to manage
- More variants = more noise in analytics with low view counts

Is 3-5 variants with a clear hypothesis more actionable than 15 variants
casting a wide net?

### 9.4 Possible Hybrid Approach (Option C)

A third option combines the best of both worlds:

1. **Lightweight hook tagging** (always on): Every episode/short automatically
   gets its hook classified by type (`question`, `shock`, `story`, etc.) during
   story generation. ClickHouse tracks retention by hook type across all content.
   This gives **free aggregate learning** with zero extra effort.

2. **Intentional A/B testing** (opt-in): When a creator wants to deliberately
   test hooks, they use the Hook Lab to generate variants and publish them as
   separate shorts. This gives **controlled experiments** for specific topics.

3. **Cross-pollination**: The aggregate dashboard shows "Your question hooks
   average 82% 3s retention vs. 61% for shock hooks" — which informs the
   creator's next deliberate test and their everyday hook choices.

**This hybrid approach means the DB schema stays the same (hook_tests +
hook_variants for deliberate tests), but we ADD a hook_type tag to every
published video in the analytics pipeline.** The aggregate learning layer
is essentially a reporting view in ClickHouse, not a separate feature.

### 9.5 What Was Already Built (On Feature Branch)

> [!NOTE]
> An initial implementation attempt was made on branch
> `feature/FILM-1301-hook-testing-engine` (15 files, 1,535 lines). It was
> shelved pending architectural decision. The code is preserved on that branch
> and can be cherry-picked or discarded.

**Branch:** `feature/FILM-1301-hook-testing-engine`

| Step | What Was Built | Status |
|------|---------------|--------|
| DB Schema | `70-hook-testing.sql` — `hook_tests` + `hook_variants` with RLS, triggers, indexes | ✅ Complete |
| ClickHouse | `002_hook_retention.ts` DDL + `HookRetentionMetric` type + insert/query functions | ✅ Complete |
| Types/Schemas | `hook-types.ts`, `hook-constants.ts`, `hook-schemas.ts`, `hook-scoring.ts` in `@kit/episodes` | ✅ Complete |
| Server Actions | `hook-test-actions.ts` (CRUD) + `hook-variant-actions.ts` (generate via `executeLLM`, declare winner, promote) | ✅ Complete |
| Prompt Template | `hook-variant-generation.json` (Gemini 3 Pro, temp 0.85, 8 hook types) | ✅ Complete |
| UI Components | Not started | ❌ Pending |
| Publishing Integration | Not started | ❌ Pending |

**All code typechecks cleanly** across `@kit/episodes`, `@kit/clickhouse`, and
`@kit/prompt-engine`. If Approach A (Standalone) is chosen, this code can be
used directly. If Approach B (Embedded) is chosen, the types, schemas, scoring
logic, and prompt template are still reusable — only the server actions and
DB schema would need refactoring.

### 9.6 Recommendation

**Start with the Hybrid Approach (Option C):**

1. **Phase 1 (Low effort):** Add `hook_type` classification to every video
   published through the platform. Build an aggregate ClickHouse view showing
   retention by hook type per project. This is ~2 hours of work and delivers
   immediate insight.

2. **Phase 2 (Medium effort):** Build the deliberate testing flow (current spec
   Sections 2-5) for when creators want controlled experiments. Use the code
   already built on the feature branch.

3. **Phase 3 (Future):** Add "Try 3 hooks" button to the shorts publishing
   flow for embedded A/B testing on production content.

This way, creators start learning about their hooks immediately (Phase 1),
get a dedicated lab when they want it (Phase 2), and eventually get friction-free
testing in their normal workflow (Phase 3).

---

## 10. Acceptance Criteria

- [x] **Architectural approach decided** (Hybrid — see decision callout at top; implementation tracked in FILM-1510)
- [ ] Creator can generate 3-8 hook variants from a topic
- [ ] Each variant has a distinct hook type and VEO 3.1 visual direction
- [ ] Variants can be published to test channels
- [ ] ClickHouse tracks per-variant retention (1s, 3s, 5s, full)
- [ ] System auto-declares winner based on configurable threshold
- [ ] Winner can be promoted to episode intro
- [ ] Aggregate hook performance visible across projects
