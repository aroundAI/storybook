import { describe, expect, it } from 'vitest';

import {
  MEMORY_ALLOCATIONS,
  calculatePriority,
  getDecayFactor,
  getMemoryOptionsForContentType,
} from '../src/lib/canon/memory-strategies';

describe('Memory Strategies (FILM-1111)', () => {
  // ===========================================================================
  // MEMORY ALLOCATIONS
  // ===========================================================================

  describe('MEMORY_ALLOCATIONS', () => {
    it('should define allocations for all 6 project types', () => {
      const types = Object.keys(MEMORY_ALLOCATIONS);
      expect(types).toHaveLength(6);
      expect(types).toEqual(
        expect.arrayContaining([
          'short-film',
          'series',
          'documentary',
          'ad',
          'educational',
          'news',
        ]),
      );
    });

    it('should have allocations that sum to 100 for each type', () => {
      for (const [, alloc] of Object.entries(MEMORY_ALLOCATIONS)) {
        const sum =
          alloc.immutableEvents +
          alloc.characterStates +
          alloc.worldStates +
          alloc.narrativeThreads +
          alloc.episodeSummaries +
          alloc.parentContext +
          alloc.sourcesCitations;
        expect(sum).toBe(100);
      }
    });

    it('should allocate 100% to sources for news type', () => {
      expect(MEMORY_ALLOCATIONS['news'].sourcesCitations).toBe(100);
      expect(MEMORY_ALLOCATIONS['news'].immutableEvents).toBe(0);
    });

    it('should have zero parentContext for all current types', () => {
      for (const alloc of Object.values(MEMORY_ALLOCATIONS)) {
        expect(alloc.parentContext).toBe(0);
      }
    });
  });

  // ===========================================================================
  // DECAY FUNCTIONS
  // ===========================================================================

  describe('getDecayFactor', () => {
    it('should return 1 at distance 0 for short-film', () => {
      expect(getDecayFactor('short-film', 0)).toBe(1);
    });

    it('should apply linear decay for short-film', () => {
      expect(getDecayFactor('short-film', 3)).toBeCloseTo(0.7);
      expect(getDecayFactor('short-film', 7)).toBeCloseTo(0.3);
      // Clamped at 0.3
      expect(getDecayFactor('short-film', 10)).toBe(0.3);
    });

    it('should return 1 at distance 0 for series', () => {
      expect(getDecayFactor('series', 0)).toBe(1);
    });

    it('should apply gentle exponential decay for series', () => {
      const d5 = getDecayFactor('series', 5);
      const d10 = getDecayFactor('series', 10);
      expect(d5).toBeCloseTo(Math.pow(0.95, 5));
      expect(d10).toBeCloseTo(Math.pow(0.95, 10));
      expect(d5).toBeGreaterThan(d10);
    });

    it('should return 1 for documentary regardless of distance', () => {
      expect(getDecayFactor('documentary', 0)).toBe(1);
      expect(getDecayFactor('documentary', 50)).toBe(1);
    });

    it('should return 1 for educational regardless of distance', () => {
      expect(getDecayFactor('educational', 100)).toBe(1);
    });

    it('should return 0 for news regardless of distance', () => {
      expect(getDecayFactor('news', 0)).toBe(0);
      expect(getDecayFactor('news', 5)).toBe(0);
    });

    it('should apply decay for ad type', () => {
      expect(getDecayFactor('ad', 0)).toBe(1);
      expect(getDecayFactor('ad', 2)).toBeCloseTo(0.6);
      // Clamped at 0.5
      expect(getDecayFactor('ad', 10)).toBe(0.5);
    });
  });

  // ===========================================================================
  // MEMORY OPTIONS
  // ===========================================================================

  describe('getMemoryOptionsForContentType', () => {
    it('should return correct options for series', () => {
      const options = getMemoryOptionsForContentType('series');
      expect(options.memoryHorizon).toBe(50);
      expect(options.maxTokenPercentage).toBe(18);
      expect(options.decayFunction).toBe('linear');
      expect(options.includeParentContext).toBe(false);
      expect(options.includeSources).toBe(false);
    });

    it('should return correct options for documentary', () => {
      const options = getMemoryOptionsForContentType('documentary');
      expect(options.memoryHorizon).toBe(5);
      expect(options.includeSources).toBe(true);
      expect(options.decayFunction).toBe('topic_match');
    });

    it('should return correct options for news', () => {
      const options = getMemoryOptionsForContentType('news');
      expect(options.memoryHorizon).toBe(1);
      expect(options.includeSources).toBe(true);
      expect(options.maxTokenPercentage).toBe(5);
    });

    it('should use custom context window size', () => {
      const options = getMemoryOptionsForContentType('series', 100_000);
      expect(options.contextWindowSize).toBe(100_000);
    });
  });

  // ===========================================================================
  // PRIORITY SCORING
  // ===========================================================================

  describe('calculatePriority', () => {
    const baseItem = { createdAt: new Date() };

    it('should give highest score to current episode', () => {
      const result = calculatePriority(baseItem, 5, 5, 'series');
      expect(result.score).toBe(1);
      expect(result.include).toBe(true);
    });

    it('should decay score for distant episodes in series', () => {
      const near = calculatePriority(baseItem, 10, 9, 'series');
      const far = calculatePriority(baseItem, 10, 1, 'series');
      expect(near.score).toBeGreaterThan(far.score);
    });

    it('should boost score for high importance', () => {
      const normal = calculatePriority(baseItem, 10, 5, 'series');
      const important = calculatePriority(
        { ...baseItem, importance: 9 },
        10,
        5,
        'series',
      );
      expect(important.score).toBeGreaterThan(normal.score);
    });

    it('should boost score for frequently mentioned items', () => {
      const normal = calculatePriority(baseItem, 10, 5, 'series');
      const mentioned = calculatePriority(
        { ...baseItem, mentions: 10 },
        10,
        5,
        'series',
      );
      expect(mentioned.score).toBeGreaterThanOrEqual(normal.score);
    });

    it('should exclude very low priority items', () => {
      // news always returns 0 decay
      const result = calculatePriority(baseItem, 10, 5, 'news');
      expect(result.score).toBe(0);
      expect(result.include).toBe(false);
    });

    it('should cap score at 1.0 even with boosts', () => {
      const boosted = calculatePriority(
        { ...baseItem, importance: 10, mentions: 50 },
        5,
        5,
        'series',
      );
      expect(boosted.score).toBeLessThanOrEqual(1.0);
    });

    it('should include reason string with decay info', () => {
      const result = calculatePriority(baseItem, 10, 5, 'series');
      expect(result.reason).toContain('decay=');
      expect(result.reason).toContain('distance=5');
    });
  });
});
