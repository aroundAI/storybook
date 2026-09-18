import { describe, expect, it } from 'vitest';

import type { SubscriberSource } from '../src/lib/subscriber-series';
import {
  SUBSCRIBER_SOURCE_LABEL,
  isMeasuredSource,
  roundingErrorOf,
  weakestSource,
} from '../src/lib/subscriber-vocabulary';

/**
 * The shared subscriber rules, checked exhaustively (FILM-1617).
 *
 * There are four sources, so every combination is cheap to check — and
 * fixtures cannot be relied on to reach them all: a ranking that put
 * `clamped` below `interpolated` passed all 78 fixture pairs, because no
 * fixture has a clamped day inside a capture gap.
 */

const SOURCES: SubscriberSource[] = [
  'snapshot',
  'constrained',
  'clamped',
  'interpolated',
];

// The spec's rule (§3), stated independently: only a day without a snapshot
// is reconstructed.
const measuredBySpec: Record<SubscriberSource, boolean> = {
  snapshot: true,
  constrained: true,
  clamped: true,
  interpolated: false,
};

describe('subscriber vocabulary', () => {
  it.each(SOURCES)('%s is measured exactly as the spec says', (source) => {
    expect(isMeasuredSource(source)).toBe(measuredBySpec[source]);
  });

  it.each(SOURCES)('%s is labelled to match', (source) => {
    expect(SUBSCRIBER_SOURCE_LABEL[source].startsWith('measured')).toBe(
      measuredBySpec[source],
    );
    expect(SUBSCRIBER_SOURCE_LABEL[source].startsWith('reconstructed')).toBe(
      !measuredBySpec[source],
    );
  });

  describe('weakestSource, every pair', () => {
    const PAIRS = SOURCES.flatMap((a) => SOURCES.map((b) => [a, b] as const));

    it.each(PAIRS)('%s + %s', (a, b) => {
      const combined = weakestSource(a, b);

      // One of its parts, whichever order they come in.
      expect([a, b]).toContain(combined);
      expect(weakestSource(b, a)).toBe(combined);

      // Measured only if both parts are.
      expect(isMeasuredSource(combined)).toBe(
        measuredBySpec[a] && measuredBySpec[b],
      );

      // Clamped only when a part is.
      if (combined === 'clamped') {
        expect(a === 'clamped' || b === 'clamped').toBe(true);
      }
    });
  });

  it('bounds the rounding error by one less than the step', () => {
    expect(roundingErrorOf(0)).toBe(0);
    expect(roundingErrorOf(1)).toBe(0);
    expect(roundingErrorOf(100)).toBe(99);
    expect(roundingErrorOf(10_000)).toBe(9_999);
  });
});
