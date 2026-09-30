import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeRundown,
  planEpisodeRundown,
} from '../src/lib/server/services/producer-service';
import type { RundownSegment } from '../src/lib/server/services/producer-service';

// FILM-1134. The rundown the model plans is put in priority order and its
// durations add up to the requested length, whatever the model returned.

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

function segment(
  segmentNumber: number,
  priority: RundownSegment['priority'],
  duration: number,
): RundownSegment {
  return {
    segmentNumber,
    title: `Segment ${segmentNumber}`,
    duration,
    category: 'feature',
    searchQuery: 'q',
    priority,
  };
}

const titles = (rundown: RundownSegment[]) => rundown.map((s) => s.title);
const total = (rundown: RundownSegment[]) =>
  rundown.reduce((sum, s) => sum + s.duration, 0);

describe('normalizeRundown: priority order', () => {
  it('puts high before medium before low', () => {
    const { rundown } = normalizeRundown(
      [
        segment(1, 'low', 100),
        segment(2, 'high', 100),
        segment(3, 'medium', 100),
      ],
      300,
    );

    expect(titles(rundown)).toEqual(['Segment 2', 'Segment 3', 'Segment 1']);
  });

  it("keeps the model's order within one priority", () => {
    const { rundown } = normalizeRundown(
      [
        segment(1, 'medium', 60),
        segment(2, 'medium', 60),
        segment(3, 'high', 60),
        segment(4, 'medium', 60),
      ],
      240,
    );

    expect(titles(rundown)).toEqual([
      'Segment 3',
      'Segment 1',
      'Segment 2',
      'Segment 4',
    ]);
  });

  it('numbers the segments 1..n again and maps the old numbers', () => {
    const { rundown, segmentNumbers } = normalizeRundown(
      [segment(1, 'low', 100), segment(2, 'high', 100)],
      200,
    );

    expect(rundown.map((s) => s.segmentNumber)).toEqual([1, 2]);
    expect(segmentNumbers.get(2)).toBe(1);
    expect(segmentNumbers.get(1)).toBe(2);
  });

  it('treats a priority it does not know as medium', () => {
    const odd = { ...segment(1, 'high', 60), priority: 'urgent' } as never;
    const { rundown } = normalizeRundown(
      [segment(2, 'low', 60), odd, segment(3, 'high', 60)],
      180,
    );

    expect(titles(rundown)).toEqual(['Segment 3', 'Segment 1', 'Segment 2']);
  });
});

describe('normalizeRundown: runtime', () => {
  it('leaves durations that already add up alone', () => {
    const { rundown } = normalizeRundown(
      [segment(1, 'high', 120), segment(2, 'low', 180)],
      300,
    );

    expect(rundown.map((s) => s.duration)).toEqual([120, 180]);
  });

  it('scales durations in proportion to the target', () => {
    const { rundown } = normalizeRundown(
      [segment(1, 'high', 100), segment(2, 'medium', 200)],
      600,
    );

    expect(rundown.map((s) => s.duration)).toEqual([200, 400]);
  });

  it.each([
    [[100, 100, 100], 600],
    [[90, 45, 61, 13], 601],
    [[7, 7, 7], 100],
    [[1000, 1, 1], 300],
  ])(
    'adds up to the target exactly, in whole seconds (%j -> %i)',
    (durations, target) => {
      const { rundown } = normalizeRundown(
        durations.map((d, i) => segment(i + 1, 'medium', d)),
        target,
      );

      expect(total(rundown)).toBe(target);
      expect(rundown.every((s) => Number.isInteger(s.duration))).toBe(true);
    },
  );

  it('gives the extra second to the largest remainder, the earlier on a tie', () => {
    const { rundown } = normalizeRundown(
      [
        segment(1, 'medium', 1),
        segment(2, 'medium', 1),
        segment(3, 'medium', 1),
      ],
      100,
    );

    expect(rundown.map((s) => s.duration)).toEqual([34, 33, 33]);
  });

  it('splits the target equally when a duration is missing or not positive', () => {
    const { rundown } = normalizeRundown(
      [segment(1, 'high', 0), segment(2, 'medium', Number.NaN)],
      300,
    );

    expect(rundown.map((s) => s.duration)).toEqual([150, 150]);
  });

  it('leaves the durations alone when there is no usable target', () => {
    const { rundown } = normalizeRundown([segment(1, 'high', 90)], 0);

    expect(rundown.map((s) => s.duration)).toEqual([90]);
  });

  it('gives the same rundown for the same input', () => {
    const input = [segment(1, 'low', 33), segment(2, 'high', 71)];

    expect(normalizeRundown(input, 500)).toEqual(normalizeRundown(input, 500));
  });
});

describe('planEpisodeRundown reconciles the model output', () => {
  const options = {
    episodeTitle: 'Tonight',
    totalDuration: 10,
    accountId: 'account-1',
  };

  beforeEach(() => executeLLM.mockReset());

  it("returns the target as the runtime, not the model's figure", async () => {
    executeLLM.mockResolvedValue({
      data: {
        rundown: [segment(1, 'high', 100), segment(2, 'medium', 100)],
        totalRuntime: 999,
      },
    });

    const plan = await planEpisodeRundown(options);

    expect(plan.totalRuntime).toBe(600);
    expect(total(plan.rundown)).toBe(600);
  });

  it('orders by priority and keeps a proposed break after the segment it followed', async () => {
    executeLLM.mockResolvedValue({
      data: {
        rundown: [
          segment(1, 'low', 150),
          segment(2, 'high', 150),
          segment(3, 'medium', 150),
          segment(4, 'low', 150),
        ],
        totalRuntime: 600,
        // After "Segment 2" (high, now first) and after "Segment 3" (now second).
        breakPositions: [2, 3],
      },
    });

    const plan = await planEpisodeRundown(options);

    expect(titles(plan.rundown)).toEqual([
      'Segment 2',
      'Segment 3',
      'Segment 1',
      'Segment 4',
    ]);
    expect(plan.breakPositions).toEqual([1, 2]);
  });

  it('falls back to the single segment when the model returns no rundown', async () => {
    executeLLM.mockResolvedValue({ data: { rundown: [], totalRuntime: 0 } });

    const plan = await planEpisodeRundown(options);

    expect(plan.rundown).toHaveLength(1);
    expect(plan.totalRuntime).toBe(600);
    expect(plan.breakPositions).toEqual([]);
  });
});
