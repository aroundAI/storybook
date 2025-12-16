import { describe, expect, it } from 'vitest';

import { calculateChanges } from '../src/server/insights-actions';
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
