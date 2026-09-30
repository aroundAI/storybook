import { describe, expect, it } from 'vitest';

import {
  INSIGHTS_STALE_TIME_MS,
  insightsFromJobResult,
  insightsStaleTime,
} from '../src/lib/insights-result';

/**
 * FILM-808. The worker delivers the handler's `{ success, data }` as the
 * job result; the panel read fields off the wrapper and showed nothing. And
 * the queued placeholder (`null`) was held fresh for an hour, which
 * suppressed the request that would have replaced it.
 */
describe('insightsFromJobResult', () => {
  const data = { summary: 'Views are up.', actionItems: ['Reply'] };

  it('unwraps the delivered { success, data }', () => {
    expect(insightsFromJobResult({ success: true, data })).toBe(data);
  });

  it('is null for anything that is not a successful wrapper', () => {
    expect(insightsFromJobResult(null)).toBeNull();
    expect(insightsFromJobResult({ success: false, data })).toBeNull();
    expect(insightsFromJobResult({ success: true })).toBeNull();
    expect(insightsFromJobResult(data)).toBeNull();
  });
});

describe('insightsStaleTime', () => {
  it('holds real insights for the hour', () => {
    expect(insightsStaleTime({ summary: 'x' })).toBe(INSIGHTS_STALE_TIME_MS);
    expect(INSIGHTS_STALE_TIME_MS).toBe(3_600_000);
  });

  it('never holds the queued placeholder', () => {
    expect(insightsStaleTime(null)).toBe(0);
    expect(insightsStaleTime(undefined)).toBe(0);
  });
});
