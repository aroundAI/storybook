import { describe, expect, it } from 'vitest';

import { validatePlotSkeleton } from '../src/lib/canon/continuity-validator';
import type { MemoryContext, NarrativeThread } from '../src/lib/canon/types';

function thread(
  name: string,
  lastActiveEpisodeNumber: number | undefined,
): NarrativeThread {
  return {
    id: name,
    projectId: 'p',
    threadName: name,
    threadType: 'mystery',
    status: 'open',
    openedAt: 'e-opened',
    episodesTouched: ['e-opened', 'e-touched'],
    promises: ['who took the key'],
    payoffs: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastActiveEpisodeNumber,
  };
}

function canon007(threads: NarrativeThread[], episodeNumber: number) {
  const context = {
    projectId: 'p',
    episodeNumber,
    immutableEvents: [],
    characterStates: [],
    activeThreads: threads,
    recentSummaries: [],
    sources: [],
  } as unknown as MemoryContext;

  return validatePlotSkeleton(
    { premise: '', episodeNumber, characters: [], scenes: [] },
    context,
  ).violations.filter((v) => v.code === 'CANON_007');
}

describe('CANON_007 thread staleness (KB-72)', () => {
  it('does not call a thread touched in the previous episode stale', () => {
    // Opened in 58, touched in 58 and 59, checked at 60. Before KB-72 this
    // read "untouched for 58 episodes".
    expect(canon007([thread('The missing key', 59)], 60)).toEqual([]);
  });

  it('flags a thread last active five episodes ago, with that count', () => {
    const violations = canon007([thread('The missing key', 55)], 60);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toBe(
      'Thread "The missing key" has 1 unfulfilled promise(s), untouched for 5 episodes.',
    );
  });

  it('does not flag a thread last active four episodes ago', () => {
    expect(canon007([thread('The missing key', 56)], 60)).toEqual([]);
  });

  it('does not flag a thread whose last episode is unknown', () => {
    expect(canon007([thread('The missing key', undefined)], 60)).toEqual([]);
  });
});
