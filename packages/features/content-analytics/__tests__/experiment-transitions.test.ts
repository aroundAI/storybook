import { describe, expect, it } from 'vitest';

import {
  assertCanAbandon,
  assertCanConclude,
  assertCanStart,
  assertEditable,
} from '../src/lib/experiment-transitions';

describe('assertCanStart', () => {
  it('starts only a planned experiment', () => {
    expect(() => assertCanStart('planned')).not.toThrow();

    for (const status of ['running', 'concluded', 'abandoned']) {
      // Starting again would overwrite the baseline the result is compared to.
      expect(() => assertCanStart(status)).toThrow(
        /only a planned experiment/i,
      );
    }
  });
});

describe('assertCanConclude', () => {
  it('concludes only a running experiment', () => {
    expect(() =>
      assertCanConclude('running', '2026-07-01', '2026-09-13'),
    ).not.toThrow();

    for (const status of ['planned', 'concluded', 'abandoned']) {
      expect(() =>
        assertCanConclude(status, '2026-07-01', '2026-09-13'),
      ).toThrow(/only a running experiment/i);
    }
  });

  it('refuses an end before the start, which would invert the window', () => {
    expect(() =>
      assertCanConclude('running', '2026-07-01', '2026-06-30'),
    ).toThrow('before it started');
  });

  it('allows ending on the start day', () => {
    expect(() =>
      assertCanConclude('running', '2026-07-01', '2026-07-01'),
    ).not.toThrow();
  });

  it('refuses a running experiment with no start date', () => {
    expect(() => assertCanConclude('running', null, '2026-07-01')).toThrow(
      'must be started',
    );
  });
});

describe('assertEditable', () => {
  it('lets a planned experiment change anything', () => {
    expect(() =>
      assertEditable('planned', [
        'metricWatched',
        'reviewWindowDays',
        'publishIds',
      ]),
    ).not.toThrow();
  });

  it('freezes what the baseline was measured over once it has started', () => {
    for (const field of ['metricWatched', 'reviewWindowDays', 'publishIds']) {
      expect(() => assertEditable('running', [field])).toThrow(field);
    }
  });

  it('still lets a started experiment change its wording', () => {
    expect(() =>
      assertEditable('running', ['title', 'notes', 'hypothesis', 'category']),
    ).not.toThrow();
  });
});

describe('assertCanAbandon', () => {
  it('abandons only a planned or running experiment', () => {
    expect(() => assertCanAbandon('planned')).not.toThrow();
    expect(() => assertCanAbandon('running')).not.toThrow();

    for (const status of ['concluded', 'abandoned']) {
      // A concluded experiment's result would be overwritten.
      expect(() => assertCanAbandon(status)).toThrow(
        /only a planned or running experiment/i,
      );
    }
  });
});
