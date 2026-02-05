---
spec_id: FILM-1301
title: Hook Testing Engine (The "Hook Lab")
status: Draft
effort: L
dependencies: FILM-1201, FILM-716
---

# Hook Testing Engine (The "Hook Lab")

## 1. Overview
To align with the "Brendan Kane" methodology of iterative testing, the **Hook Lab** allows creators to generate, render, and test 5-15 variations of a video's first 3-10 seconds ("Hooks") before committing to full episode production. This shifts the workflow from "Production First" to "Validation First".

## 2. User Experience (The "Scientific Method" Workflow)

### 2.1 The Dashboard
A new top-level view in the Studio: `Hooks`.
- **Active Experiements**: List of running A/B tests.
- **Winning Hooks**: Archive of hooks that exceeded the "Viral Threshold" (>75% retention at 3s).
- **Hypothesis Builder**: "I believe [Emotion X] will beat [Emotion Y] for [Audience Z]."

### 2.2 The Experiment Workbench
1.  **Generate Variants**:
    - Input: Core Topic (e.g., "Black Holes").
    - Action: Generate 5 Scripts based on different **Psychological Triggers**:
        - *The Negative Bias Hook*: "Why Black Holes will destroy us tomorrow."
        - *The Visual ASMR Hook*: "Watch this star get eaten." (Slow motion).
        - *The Direct Question Hook*: "Can you survive spaghettification?"
        - *The Pattern Interrupt Hook*: [Loud Noise] "Stop scrolling!"

2.  **Batch Rendering**:
    - The system renders only the first 5-10 seconds.
    - Uses `ContentStyle: Action-Heavy` (0.5x scaling) to keep it punchy.
    - Parallel processing via `@kit/video-generation`.

3.  **Deploy to Test Channels**:
    - One-click publish to "Burner" channels (categorized by language/niche).
    - Metadata auto-generated: "Test A", "Test B" (invisible to user, used for tracking).

4.  **Analyze & Promote**:
    - **Live Graph**: 3-second retention overlaid for all 5 variants.
    - **Winner Declaration**: System badges the winner.
    - **"Promote to Episode"**: Converts the winning Hook Asset into the `Intro` scan of a new `Episode` entity.

## 3. Data Architecture

### 3.1 Database Config (Supabase)
```sql
CREATE TABLE hook_tests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  name TEXT NOT NULL,
  status TEXT CHECK (status IN ('draft', 'rendering', 'live', 'completed')),
  hypothesis TEXT,
  winner_variant_id UUID, -- Set when test concludes
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hook_variants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id UUID REFERENCES hook_tests(id),
  hook_type TEXT NOT NULL, -- 'negative', 'curiosity', 'visual', etc.
  script TEXT NOT NULL,
  asset_id UUID, -- Link to the rendered video asset
  platform_ids JSONB -- { "youtube": "v123", "tiktok": "t456" }
);
```

### 3.2 Analytics Ingestion (ClickHouse via FILM-1201)
We utilize the high-throughput `video_metrics` table defined in [FILM-1201](../phase-12-scale/database/FILM-1201-clickhouse-migration.md) to store second-by-second retention.

Querying the winner:
```sql
SELECT 
    variant_id, 
    argMax(retention_at_3s, timestamp) as final_retention 
FROM hook_retention_metrics 
WHERE test_id = {testId} 
GROUP BY variant_id 
ORDER BY final_retention DESC 
LIMIT 1
```

## 4. Implementation Details

### 4.1 `@kit/hooks` Package
- `HookGeneratorService`: Orchestrates the LLM to write the 5 variant scripts.
- `HookRendererService`: Wraps `@kit/video-generation` to enforce short duration limits.

### 4.2 Integration with Publishing
- Update `PublishingService` to handle `is_test` flag.
- Test videos should be published as `Unlisted` (if allowed for Shorts testing) or to specific `Test Channels`.

## 5. Security & Risk
- **Burner Channels**: We must ensure "Test Content" doesn't pollute the main channel's algorithmic score. Recommendation: Use dedicated "Lab" channels for testing, or use "Shorts" on the main channel (as Shorts algorithm is more volatile/forgiving).
