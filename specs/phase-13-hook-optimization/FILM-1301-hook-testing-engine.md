---
spec_id: FILM-1301
title: Hook Testing Engine (The "Hook Lab")
status: Draft
effort: L
dependencies: FILM-1201, FILM-716
---

# Hook Testing Engine (The "Hook Lab")

## 1. Overview

The **Hook Lab** allows creators to generate, render, and A/B test 5-15 variations of a video's first 3-10 seconds ("Hooks") before committing to full episode production. This shifts the workflow from "Production First" to "Validation First", aligning with the Brendan Kane methodology of iterative testing.

> [!IMPORTANT]
> This spec maps every proposed component to concrete codebase integration points, so AI agents can implement the Hook Lab incrementally with full context.

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
  winner_variant_id UUID,                       -- Set when test concludes
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

    // 3. Mark test as completed
    await client
      .from('hook_tests')
      .update({ status: 'completed', winner_variant_id: data.variantId })
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
