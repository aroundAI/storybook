/**
 * Insights utilities for analytics processing
 */
import type { AnalyticsTotals, InsightsResult } from '../types';

/**
 * Calculate percentage changes between current and previous period
 */
export function calculateChanges(
  current: AnalyticsTotals,
  previous?: AnalyticsTotals,
): Record<string, number> {
  const changes: Record<string, number> = {};

  if (!previous) {
    return changes;
  }

  const keys: (keyof AnalyticsTotals)[] = [
    'views',
    'likes',
    'comments',
    'shares',
    'watchTimeSeconds',
    'subscribersGained',
    'revenueCents',
    'contentCount',
  ];

  for (const key of keys) {
    const currentVal = current[key] || 0;
    const previousVal = previous[key] || 0;

    if (previousVal > 0) {
      changes[key] = ((currentVal - previousVal) / previousVal) * 100;
    } else {
      changes[key] = currentVal > 0 ? 100 : 0;
    }
  }

  return changes;
}

/**
 * Safely parse JSON from LLM response
 */
export function parseInsightsResponse(
  content: string,
): Partial<InsightsResult> {
  try {
    // Try to extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr =
      jsonMatch && jsonMatch[1] ? jsonMatch[1].trim() : content.trim();

    return JSON.parse(jsonStr) as Partial<InsightsResult>;
  } catch {
    // If parsing fails, try to extract what we can
    return {};
  }
}
