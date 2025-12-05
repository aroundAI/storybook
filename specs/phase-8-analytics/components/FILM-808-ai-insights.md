# FILM-808: AI Insights

## Metadata
- **Phase:** 8 - Analytics
- **Priority:** P2 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-805 (Analytics Dashboard), @kit/llm
- **Blocks:** None

---

## Context

AI Insights uses LLM analysis to interpret analytics data and provide actionable recommendations. Instead of just showing numbers, it explains what the data means, identifies patterns, and suggests optimizations for content strategy, posting schedules, and audience targeting.

---

## Specification

### Requirements

1. **Performance Summary**: Natural language summary of key metrics
2. **Trend Analysis**: Identify rising/falling patterns
3. **Content Recommendations**: Suggest what's working and what to improve
4. **Posting Strategy**: Optimal posting times based on engagement
5. **Audience Insights**: Who's watching and how to reach more
6. **Competitor Benchmarking**: Compare against category averages (when available)

### AI Insights Component

```typescript
// packages/features/content-analytics/src/components/ai-insights.tsx

'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Skeleton } from '@kit/ui/skeleton';
import { Badge } from '@kit/ui/badge';
import { Sparkles, RefreshCw, TrendingUp, TrendingDown, Target, Clock, Users } from 'lucide-react';
import { generateInsightsAction } from '../server/insights-actions';

interface AIInsightsProps {
  projectId: string;
  analytics: AggregateAnalytics;
}

export function AIInsights({ projectId, analytics }: AIInsightsProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: insights, isLoading, refetch } = useQuery({
    queryKey: ['ai-insights', projectId, analytics?.totals?.views],
    queryFn: () => generateInsightsAction({ projectId, analytics }),
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
    enabled: !!analytics,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  if (isLoading) {
    return <InsightsSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          <h2 className="text-lg font-semibold">AI Insights</h2>
          <Badge variant="secondary" className="text-xs">
            Powered by Claude
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/20">
        <CardContent className="pt-6">
          <p className="text-lg leading-relaxed">
            {insights?.summary}
          </p>
        </CardContent>
      </Card>

      {/* Insight Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Performance Trends */}
        <InsightCard
          icon={TrendingUp}
          title="Performance Trends"
          insights={insights?.trends}
          iconColor="text-green-600"
        />

        {/* Content Recommendations */}
        <InsightCard
          icon={Target}
          title="Content Recommendations"
          insights={insights?.contentRecommendations}
          iconColor="text-blue-600"
        />

        {/* Best Posting Times */}
        <InsightCard
          icon={Clock}
          title="Optimal Posting Times"
          insights={insights?.postingStrategy}
          iconColor="text-orange-600"
        />

        {/* Audience Insights */}
        <InsightCard
          icon={Users}
          title="Audience Insights"
          insights={insights?.audienceInsights}
          iconColor="text-purple-600"
        />
      </div>

      {/* Top Performers */}
      {insights?.topPerformers?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Why These Videos Performed Well</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {insights.topPerformers.map((item, index) => (
              <div key={index} className="flex gap-4">
                <img
                  src={item.thumbnailUrl}
                  alt={item.title}
                  className="w-24 h-14 object-cover rounded"
                />
                <div>
                  <p className="font-medium line-clamp-1">{item.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {item.analysis}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Action Items */}
      {insights?.actionItems?.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-amber-600" />
              Recommended Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {insights.actionItems.map((action, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-200 text-amber-800 text-xs font-medium mt-0.5">
                    {index + 1}
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface InsightCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  insights: string[] | undefined;
  iconColor: string;
}

function InsightCard({ icon: Icon, title, insights, iconColor }: InsightCardProps) {
  if (!insights?.length) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconColor}`} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {insights.map((insight, index) => (
            <li key={index} className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground">•</span>
              <span>{insight}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5" />
        <Skeleton className="h-6 w-32" />
      </div>
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
```

### Insights Generation Server Action

```typescript
// packages/features/content-analytics/src/server/insights-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { createLLMClient } from '@kit/llm';
import { z } from 'zod';

const GenerateInsightsSchema = z.object({
  projectId: z.string().uuid(),
  analytics: z.any(),
});

interface InsightsResult {
  summary: string;
  trends: string[];
  contentRecommendations: string[];
  postingStrategy: string[];
  audienceInsights: string[];
  topPerformers: Array<{
    title: string;
    thumbnailUrl: string;
    analysis: string;
  }>;
  actionItems: string[];
}

export const generateInsightsAction = enhanceAction(
  async ({ projectId, analytics }): Promise<InsightsResult> => {
    const llmClient = createLLMClient();

    // Prepare analytics summary for LLM
    const analyticsSummary = {
      totals: analytics.totals,
      previousPeriodChange: calculateChanges(analytics.totals, analytics.previousPeriodTotals),
      platformBreakdown: analytics.platformMetrics,
      topContent: analytics.topContent?.slice(0, 5),
      audience: analytics.audience,
    };

    const prompt = `You are an expert social media analytics consultant. Analyze the following content performance data and provide actionable insights.

## Analytics Data
${JSON.stringify(analyticsSummary, null, 2)}

## Your Task
Provide insights in the following JSON format:
{
  "summary": "A 2-3 sentence overview of overall performance",
  "trends": ["Array of 3-4 key trend observations"],
  "contentRecommendations": ["Array of 3-4 specific content recommendations"],
  "postingStrategy": ["Array of 2-3 posting time/frequency recommendations"],
  "audienceInsights": ["Array of 2-3 audience-related insights"],
  "topPerformers": [
    {
      "title": "Video title",
      "thumbnailUrl": "thumbnail URL from data",
      "analysis": "Why this performed well"
    }
  ],
  "actionItems": ["Array of 3-5 specific actions to take this week"]
}

Guidelines:
- Be specific and actionable, not generic
- Reference actual numbers from the data
- Compare to previous period when relevant
- Consider platform-specific best practices
- Focus on growth opportunities`;

    const response = await llmClient.chat.completions.create({
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
    });

    const insights = JSON.parse(response.choices[0].message.content || '{}');

    return {
      summary: insights.summary || 'Unable to generate summary.',
      trends: insights.trends || [],
      contentRecommendations: insights.contentRecommendations || [],
      postingStrategy: insights.postingStrategy || [],
      audienceInsights: insights.audienceInsights || [],
      topPerformers: insights.topPerformers || [],
      actionItems: insights.actionItems || [],
    };
  },
  { schema: GenerateInsightsSchema, auth: true }
);

function calculateChanges(current: AnalyticsTotals, previous: AnalyticsTotals): Record<string, number> {
  const changes: Record<string, number> = {};

  for (const key of Object.keys(current)) {
    const currentVal = current[key] || 0;
    const previousVal = previous?.[key] || 0;

    if (previousVal > 0) {
      changes[key] = ((currentVal - previousVal) / previousVal) * 100;
    } else {
      changes[key] = currentVal > 0 ? 100 : 0;
    }
  }

  return changes;
}
```

### Prompt Template

```json
// packages/features/prompt-engine/src/prompts/analytics/generate-insights.json

{
  "name": "generate-insights",
  "description": "Generate AI-powered analytics insights",
  "model": "claude-3-5-sonnet-20241022",
  "temperature": 0.7,
  "responseFormat": "json",
  "systemPrompt": "You are an expert social media analytics consultant specializing in content performance optimization. Provide specific, actionable insights based on data.",
  "userPromptTemplate": "Analyze the following content performance data:\n\n{{analytics}}\n\nProvide insights in JSON format with: summary, trends, contentRecommendations, postingStrategy, audienceInsights, topPerformers, actionItems"
}
```

### Types

```typescript
// packages/features/content-analytics/src/types.ts

export interface InsightsResult {
  summary: string;
  trends: string[];
  contentRecommendations: string[];
  postingStrategy: string[];
  audienceInsights: string[];
  topPerformers: Array<{
    title: string;
    thumbnailUrl: string;
    analysis: string;
  }>;
  actionItems: string[];
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/content-analytics/src/components/ai-insights.tsx` |
| CREATE | `packages/features/content-analytics/src/server/insights-actions.ts` |
| CREATE | `packages/features/prompt-engine/src/prompts/analytics/generate-insights.json` |

---

## Acceptance Criteria

- [ ] Generates natural language summary of performance
- [ ] Identifies 3-4 key trends in data
- [ ] Provides specific content recommendations
- [ ] Suggests optimal posting times
- [ ] Analyzes audience demographics and behavior
- [ ] Explains why top content performed well
- [ ] Lists actionable items for improvement
- [ ] Caches insights to avoid repeated LLM calls
- [ ] Shows loading state during generation
- [ ] Allows manual refresh of insights

---

## Test Plan

### Unit Tests
- [ ] Test `calculateChanges` function
- [ ] Test insights JSON parsing

### Integration Tests
- [ ] Test with mocked LLM response
- [ ] Test caching behavior

---

## Cost Considerations

- Cache insights for 1 hour to avoid repeated LLM calls
- Use `claude-3-5-sonnet` for balance of quality and cost
- Limit context size by summarizing analytics data
- Consider daily regeneration limit per project

---

## Error Handling

| Error | Handling |
|-------|----------|
| LLM timeout | Show cached insights or fallback message |
| Invalid JSON response | Retry once, then show error |
| Rate limit | Queue for later, show cached |
| Empty analytics | Show "Not enough data" message |

---

## Privacy Considerations

- Only send aggregate metrics to LLM, not PII
- Don't send actual comments/content text
- Anonymize audience demographics before sending
