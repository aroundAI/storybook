import type { InsightsResult } from '../types';

export const INSIGHTS_STALE_TIME_MS = 60 * 60 * 1000;

/** The queued placeholder is `null`, and must be asked for again at once. */
export function insightsStaleTime(data: unknown): number {
  return data ? INSIGHTS_STALE_TIME_MS : 0;
}

/** The worker delivers the handler's `{ success, data }`, not the data. */
export function insightsFromJobResult(result: unknown): InsightsResult | null {
  if (!result || typeof result !== 'object') return null;

  const { success, data } = result as { success?: unknown; data?: unknown };

  if (success !== true || !data || typeof data !== 'object') return null;

  return data as InsightsResult;
}
