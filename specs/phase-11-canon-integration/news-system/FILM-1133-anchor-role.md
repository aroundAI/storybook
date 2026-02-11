---
id: FILM-1133
title: News Anchor LLM Role Prompt
status: done
priority: medium
effort: M
dependencies: [FILM-1132, FILM-1006]
---

# FILM-1133: News Anchor LLM Role Prompt

## Overview

Create the News Anchor LLM role prompt that generates professional broadcast scripts from aggregated news articles, maintaining journalistic tone, proper attribution, and balanced coverage.

## Problem Statement

For NEWS content type:
- Raw news articles need transformation to broadcast format
- Must maintain journalistic integrity and attribution
- Need balanced coverage across perspectives
- Must avoid editorializing or bias injection

## Solution

Create `anchor-role.json` prompt template that transforms news data into professional broadcast scripts.

---

## Role Definition

| Attribute | Value |
|-----------|-------|
| Role Name | News Anchor |
| Primary Function | Script generation from news sources |
| Tone | Professional, authoritative, neutral |
| Restrictions | No opinions, no speculation, source attribution required |

---

## Implementation

### Step 1: Anchor Role Prompt Template

**File:** `packages/features/prompt-engine/src/prompts/news-generation/anchor-role.json`

```json
{
  "name": "anchor-role",
  "description": "Generates professional news broadcast scripts",
  "version": "1.0.0",
  "llm": {
    "provider": "google",
    "model": "gemini-1.5-pro",
    "temperature": 0.3,
    "maxTokens": 8000
  },
  "systemPrompt": "You are a professional news anchor. Core principles:\n1. Accuracy First - Only state facts from sources\n2. Attribution Required - Always cite sources\n3. Neutral Tone - No opinions or loaded language\n4. Balance - Present multiple perspectives\n5. Clarity - Use accessible broadcast language",
  "promptTemplate": "Generate a {{targetDuration}}-second broadcast script.\n\n## Episode: {{episodeTitle}}\n## Theme: {{segmentTheme}}\n\n## Source Articles\n{{#each articles}}\n### {{this.sourceName}} ({{this.credibilityTier}})\n{{this.title}}\n{{this.content}}\n{{/each}}\n\n## Output Format\nANCHOR: [Script text]\nGRAPHIC: [Lower third description]\nTRANSITION: [Bridge text]\nSOURCES: [Citations]",
  "inputSchema": {
    "type": "object",
    "properties": {
      "episodeTitle": { "type": "string" },
      "targetDuration": { "type": "number" },
      "segmentTheme": { "type": "string" },
      "articles": { "type": "array" }
    },
    "required": ["episodeTitle", "targetDuration", "segmentTheme", "articles"]
  }
}
```

### Step 2: Anchor Service

**File:** `packages/features/episodes/src/lib/server/services/news-anchor/anchor-service.ts`

```typescript
import { executeLLM } from '@kit/prompt-engine';
import { getNewsAggregator } from '../news-aggregator/news-aggregator';
import { z } from 'zod';

const AnchorScriptSchema = z.object({
  script: z.array(z.object({
    type: z.enum(['ANCHOR', 'GRAPHIC', 'TRANSITION']),
    content: z.string(),
    duration: z.number().optional(),
    sources: z.array(z.string()).optional(),
  })),
  sourcesUsed: z.array(z.string()),
});

export async function generateNewsSegment(params: {
  projectId: string;
  episodeId: string;
  episodeTitle: string;
  segmentTheme: string;
  targetDuration: number;
  searchQuery: string;
}) {
  const aggregator = await getNewsAggregator();
  const newsResults = await aggregator.search({
    projectId: params.projectId,
    query: params.searchQuery,
    credibilityTier: 'tier_1',
    pageSize: 10,
  });
  
  const result = await executeLLM({
    promptName: 'anchor-role',
    variables: {
      episodeTitle: params.episodeTitle,
      targetDuration: params.targetDuration,
      segmentTheme: params.segmentTheme,
      articles: newsResults.articles.map(a => ({
        sourceName: a.sourceName,
        credibilityTier: a.credibilityTier,
        title: a.title,
        content: a.content ?? a.description,
      })),
    },
  });
  
  return AnchorScriptSchema.parse(JSON.parse(result.text));
}
```

### Step 3: Balance Checker

```typescript
// packages/features/episodes/src/lib/server/services/news-anchor/balance-checker.ts

export async function checkSourceBalance(articleIds: string[]) {
  const supabase = await getSupabaseServerClient();
  
  const { data } = await supabase
    .from('news_articles')
    .select('source_id, news_sources!inner(name, bias_label)')
    .in('id', articleIds);
  
  const biasDistribution: Record<string, number> = {};
  for (const article of data ?? []) {
    const bias = article.news_sources?.bias_label ?? 'neutral';
    biasDistribution[bias] = (biasDistribution[bias] ?? 0) + 1;
  }
  
  const warnings: string[] = [];
  const biasLabels = Object.keys(biasDistribution);
  if (biasLabels.length === 1 && biasDistribution[biasLabels[0]!] > 1) {
    warnings.push(`All sources have "${biasLabels[0]}" bias`);
  }
  
  return { isBalanced: warnings.length === 0, biasDistribution, warnings };
}
```

### Step 4: Server Actions

```typescript
// packages/features/episodes/src/lib/server/mutations/anchor-actions.ts
'use server';

import { enhanceAction } from '@kit/next/actions';
import { z } from 'zod';
import { generateNewsSegment } from '../services/news-anchor/anchor-service';

const GenerateSegmentSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  episodeTitle: z.string(),
  segmentTheme: z.string(),
  targetDuration: z.number().min(30).max(600),
  searchQuery: z.string().min(1),
});

export const generateNewsSegmentAction = enhanceAction(
  async (data) => {
    const script = await generateNewsSegment(data);
    return { success: true, data: script };
  },
  { schema: GenerateSegmentSchema, auth: true }
);
```

---

## Acceptance Criteria

- [ ] Anchor role prompt generates valid broadcast scripts
- [ ] All claims are attributed to sources
- [ ] Script includes ANCHOR, GRAPHIC, TRANSITION cues
- [ ] Balance checker identifies bias distribution
- [ ] Server actions are authenticated

---

## Effort Estimation

| Task | Effort |
|------|--------|
| Anchor role prompt | 3 hours |
| Anchor service | 4 hours |
| Balance checker | 2 hours |
| Server actions | 2 hours |
| Testing | 3 hours |
| **Total** | **14 hours** (M) |

---

## Dependencies

**Requires:** FILM-1132, FILM-1006
**Blocks:** FILM-1134
