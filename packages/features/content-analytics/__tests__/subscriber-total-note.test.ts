import { describe, expect, it } from 'vitest';

import { sumByPlatform } from '../src/lib/subscriber-series-sum';
import { describeTotal } from '../src/lib/subscriber-total-note';

function series(connectionId: string, dates: string[]) {
  return {
    connectionId,
    roundingStep: 0,
    points: dates.map((date) => ({
      date,
      level: 100,
      source: 'interpolated' as const,
    })),
  };
}

function channel(connectionId: string, isActive = true) {
  return {
    connectionId,
    platform: 'youtube',
    name: `${connectionId} name`,
    isActive,
  };
}

const names = { a: 'Channel A', b: 'Channel B' };

function noteFor(
  s: ReturnType<typeof series>[],
  c: ReturnType<typeof channel>[],
  lastData: Record<string, string | null> = {},
) {
  const [total] = sumByPlatform(s, c);

  if (!total) throw new Error('expected a YouTube total');

  return describeTotal(
    total,
    names,
    Object.fromEntries(
      Object.entries(lastData).map(([id, since]) => [
        id,
        since ? { kind: 'ended' as const, since } : { kind: 'none' as const },
      ]),
    ),
  );
}

describe('describeTotal', () => {
  it('dates a total that exists', () => {
    expect(
      noteFor(
        [series('a', ['2026-09-01']), series('b', ['2026-09-01'])],
        [channel('a'), channel('b')],
      ),
    ).toContain('YouTube total begins Sep 1, 2026');
  });

  // Both channels have data, but capture for one stopped before the other
  // started: nothing is missing, and there is still no day to add up.
  it('says channels share no day, rather than that none publishes', () => {
    const note = noteFor(
      [series('a', ['2026-06-01']), series('b', ['2026-09-01'])],
      [channel('a'), channel('b')],
    );

    expect(note).toContain('Channel A and Channel B have no day in common');
    expect(note).not.toContain('publishes here');
  });

  it('names a channel with no count as the reason', () => {
    expect(
      noteFor(
        [series('a', ['2026-09-01']), series('b', [])],
        [channel('a'), channel('b')],
      ),
    ).toContain('No YouTube total yet: Channel B has no subscriber count');
  });

  // Its data ended before the window: it had a count, it just stopped.
  it('says an active channel with old data has none since, not none yet', () => {
    const note = noteFor(
      [series('a', ['2026-09-01']), series('b', [])],
      [channel('a'), channel('b')],
      { b: '2025-06-30' },
    );

    expect(note).toContain('Channel B has no data since Jun 30, 2025');
    expect(note).not.toContain('no subscriber count');
  });

  it('says so when no active channel publishes here', () => {
    expect(
      noteFor([series('a', ['2026-09-01'])], [channel('a', false)]),
    ).toContain('no active YouTube channel publishes here');
  });
});
