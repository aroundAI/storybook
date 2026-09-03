import { describe, expect, it } from 'vitest';

// Both live in lib/insights-utils, not in the action module — that one
// carries 'use server', where only async functions may be exported, so a
// synchronous helper could never have lived there.
import {
  calculateChanges,
  parseInsightsResponse,
} from '../src/lib/insights-utils';
import type { AnalyticsTotals } from '../src/types';

describe('calculateChanges', () => {
  const baseTotals: AnalyticsTotals = {
    views: 1000,
    likes: 100,
    comments: 50,
    shares: 25,
    watchTimeSeconds: 3600,
    subscribersGained: 10,
    revenueCents: 500,
    contentCount: 5,
  };

  it('should calculate percentage increases correctly', () => {
    const current: AnalyticsTotals = {
      ...baseTotals,
      views: 1500, // 50% increase
      likes: 150, // 50% increase
    };

    const previous: AnalyticsTotals = {
      ...baseTotals,
      views: 1000,
      likes: 100,
    };

    const changes = calculateChanges(current, previous);

    expect(changes.views).toBe(50);
    expect(changes.likes).toBe(50);
  });

  it('should calculate percentage decreases correctly', () => {
    const current: AnalyticsTotals = {
      ...baseTotals,
      views: 500, // 50% decrease
    };

    const previous: AnalyticsTotals = {
      ...baseTotals,
      views: 1000,
    };

    const changes = calculateChanges(current, previous);

    expect(changes.views).toBe(-50);
  });

  it('should return empty object when previous is undefined', () => {
    const changes = calculateChanges(baseTotals, undefined);

    expect(changes).toEqual({});
  });

  it('should handle zero previous values', () => {
    const current: AnalyticsTotals = {
      ...baseTotals,
      views: 100,
    };

    const previous: AnalyticsTotals = {
      ...baseTotals,
      views: 0,
    };

    const changes = calculateChanges(current, previous);

    // When previous is 0 and current > 0, should be 100%
    expect(changes.views).toBe(100);
  });

  it('should handle both zero values', () => {
    const current: AnalyticsTotals = {
      ...baseTotals,
      views: 0,
    };

    const previous: AnalyticsTotals = {
      ...baseTotals,
      views: 0,
    };

    const changes = calculateChanges(current, previous);

    // When both are 0, should be 0%
    expect(changes.views).toBe(0);
  });

  it('should calculate all metric changes', () => {
    const current: AnalyticsTotals = {
      views: 2000,
      likes: 200,
      comments: 100,
      shares: 50,
      watchTimeSeconds: 7200,
      subscribersGained: 20,
      revenueCents: 1000,
      contentCount: 10,
    };

    const previous: AnalyticsTotals = {
      views: 1000,
      likes: 100,
      comments: 50,
      shares: 25,
      watchTimeSeconds: 3600,
      subscribersGained: 10,
      revenueCents: 500,
      contentCount: 5,
    };

    const changes = calculateChanges(current, previous);

    // All should be 100% increase
    expect(changes.views).toBe(100);
    expect(changes.likes).toBe(100);
    expect(changes.comments).toBe(100);
    expect(changes.shares).toBe(100);
    expect(changes.watchTimeSeconds).toBe(100);
    expect(changes.subscribersGained).toBe(100);
    expect(changes.revenueCents).toBe(100);
    expect(changes.contentCount).toBe(100);
  });

  it('should handle fractional percentages', () => {
    const current: AnalyticsTotals = {
      ...baseTotals,
      views: 1234,
    };

    const previous: AnalyticsTotals = {
      ...baseTotals,
      views: 1000,
    };

    const changes = calculateChanges(current, previous);

    expect(changes.views).toBeCloseTo(23.4, 1);
  });
});

describe('parseInsightsResponse', () => {
  it('should parse valid JSON response', () => {
    const validJson = JSON.stringify({
      summary: 'Test summary',
      trends: ['Trend 1', 'Trend 2'],
      contentRecommendations: ['Rec 1'],
      postingStrategy: ['Post daily'],
      audienceInsights: ['Young audience'],
      topPerformers: [{ title: 'Video 1', analysis: 'Good content' }],
      actionItems: ['Action 1', 'Action 2'],
    });

    const result = parseInsightsResponse(validJson);

    expect(result.summary).toBe('Test summary');
    expect(result.trends).toEqual(['Trend 1', 'Trend 2']);
    expect(result.actionItems).toEqual(['Action 1', 'Action 2']);
  });

  it('should extract JSON from markdown code blocks', () => {
    const markdownResponse = `Here is the analysis:
\`\`\`json
{
  "summary": "Markdown wrapped summary",
  "trends": ["Trend from markdown"],
  "actionItems": []
}
\`\`\`
Additional text after.`;

    const result = parseInsightsResponse(markdownResponse);

    expect(result.summary).toBe('Markdown wrapped summary');
    expect(result.trends).toEqual(['Trend from markdown']);
  });

  it('should extract JSON from code blocks without language specifier', () => {
    const codeBlockResponse = `\`\`\`
{
  "summary": "No lang summary",
  "trends": []
}
\`\`\``;

    const result = parseInsightsResponse(codeBlockResponse);

    expect(result.summary).toBe('No lang summary');
  });

  it('should return empty object for invalid JSON', () => {
    const invalidJson = 'This is not valid JSON at all';

    const result = parseInsightsResponse(invalidJson);

    expect(result).toEqual({});
  });

  it('should return empty object for malformed JSON', () => {
    const malformedJson = '{ "summary": "Missing closing brace"';

    const result = parseInsightsResponse(malformedJson);

    expect(result).toEqual({});
  });

  it('should handle empty string input', () => {
    const result = parseInsightsResponse('');

    expect(result).toEqual({});
  });

  it('should handle partial insights response', () => {
    const partialJson = JSON.stringify({
      summary: 'Only summary provided',
    });

    const result = parseInsightsResponse(partialJson);

    expect(result.summary).toBe('Only summary provided');
    expect(result.trends).toBeUndefined();
    expect(result.actionItems).toBeUndefined();
  });
});
