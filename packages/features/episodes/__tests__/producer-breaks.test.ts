import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  breakCountFor,
  computeBreakPositions,
  planEpisodeRundown,
  resolveBreakPositions,
} from '../src/lib/server/services/producer-service';
import type { RundownSegment } from '../src/lib/server/services/producer-service';

// FILM-1134. A rundown carries the segments a commercial break follows:
// between segments, never after the last, one per five minutes of runtime,
// and the same ones every time the LLM leaves them out or gets them wrong.

const executeLLM = vi.fn();

vi.mock('@kit/prompt-engine/server', () => ({
  executeLLM: (...args: unknown[]) => executeLLM(...args),
}));

vi.mock('../src/lib/server/services/news-story-service', () => ({
  NewsStoryService: class {
    discoverTopStories = vi.fn(async () => [
      { headline: 'Story', topic: 'x', importance: 0.9, articles: [] },
    ]);
  },
}));

function segments(...durations: number[]): RundownSegment[] {
  return durations.map((duration, i) => ({
    segmentNumber: i + 1,
    title: `Segment ${i + 1}`,
    duration,
    category: 'feature',
    searchQuery: 'q',
    priority: 'medium',
  }));
}

describe('breakCountFor', () => {
  it.each([
    [0, 5, 0],
    [299, 5, 0],
    [300, 5, 1],
    [720, 5, 2],
    [1800, 3, 2],
    [600, 1, 0],
    [600, 0, 0],
  ])(
    '%is over %i segments has %i breaks',
    (seconds, segmentCount, expected) => {
      expect(breakCountFor(seconds, segmentCount)).toBe(expected);
    },
  );
});

describe('computeBreakPositions', () => {
  it('puts one break at the boundary nearest the middle', () => {
    // 60 + 60 + 60 + 60 + 60: the middle of 300s is 150s; boundaries at 60,
    // 120, 180, 240. 120 and 180 are equally near; the earlier wins.
    expect(computeBreakPositions(segments(60, 60, 60, 60, 60), 1)).toEqual([2]);
  });

  it('spaces several breaks through the running time', () => {
    // 10 segments of 60s = 600s, 2 breaks: targets 200s and 400s.
    expect(computeBreakPositions(segments(...Array(10).fill(60)), 2)).toEqual([
      3, 7,
    ]);
  });

  it('follows the running time, not the segment count', () => {
    // A long lead: 400s then four 25s pieces. The middle of 500s is 250s.
    expect(computeBreakPositions(segments(400, 25, 25, 25, 25), 1)).toEqual([
      1,
    ]);
  });

  it('never uses a boundary twice or the end of the last segment', () => {
    const positions = computeBreakPositions(segments(60, 60, 60), 5);

    expect(positions).toEqual([1, 2]);
  });

  it('makes none when asked for none', () => {
    expect(computeBreakPositions(segments(60, 60), 0)).toEqual([]);
  });
});

describe('resolveBreakPositions', () => {
  const twelveMinutes = segments(...Array(8).fill(90));

  it('keeps the LLM positions when they fit the runtime', () => {
    expect(resolveBreakPositions(twelveMinutes, 720, [5, 2])).toEqual([2, 5]);
  });

  it('computes them when the LLM leaves them out', () => {
    expect(resolveBreakPositions(twelveMinutes, 720, undefined)).toEqual(
      computeBreakPositions(twelveMinutes, 2),
    );
  });

  it.each([
    ['a break after the last segment', [2, 8]],
    ['a segment that does not exist', [2, 40]],
    ['a repeated position', [2, 2]],
    ['too few', [2]],
    ['too many', [2, 4, 6]],
    ['not numbers', ['2', '5']],
    ['not a list', 'after 2 and 5'],
  ])('computes them over %s', (_case, proposed) => {
    expect(resolveBreakPositions(twelveMinutes, 720, proposed)).toEqual(
      computeBreakPositions(twelveMinutes, 2),
    );
  });

  it('gives a short episode no breaks, whatever the LLM says', () => {
    expect(resolveBreakPositions(segments(60, 60), 120, [1])).toEqual([]);
  });
});

describe('planEpisodeRundown (FILM-1134)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const options = {
    episodeTitle: 'Evening',
    totalDuration: 10,
    accountId: 'a',
  };

  it('returns the LLM rundown with its breaks validated', async () => {
    executeLLM.mockResolvedValue({
      data: {
        rundown: segments(150, 150, 150, 150),
        totalRuntime: 600,
        breakPositions: [3, 1],
      },
    });

    await expect(planEpisodeRundown(options)).resolves.toMatchObject({
      totalRuntime: 600,
      breakPositions: [1, 3],
    });
  });

  it('computes the breaks when the model omits them', async () => {
    executeLLM.mockResolvedValue({
      data: { rundown: segments(150, 150, 150, 150), totalRuntime: 600 },
    });

    await expect(planEpisodeRundown(options)).resolves.toMatchObject({
      breakPositions: [1, 3],
    });
  });

  it('has no breaks in the single-segment fallback', async () => {
    executeLLM.mockRejectedValue(new Error('model down'));

    await expect(planEpisodeRundown(options)).resolves.toMatchObject({
      rundown: [expect.objectContaining({ segmentNumber: 1 })],
      breakPositions: [],
    });
  });
});
