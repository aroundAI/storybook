import { describe, expect, it } from 'vitest';

import {
  assertCanAbandon,
  assertCanConclude,
  assertCanDelete,
  assertCanStart,
  assertEditable,
  canAbandon,
  canConclude,
  canDelete,
  canStart,
  frozenFields,
} from '../src/lib/experiment-transitions';

const STATUSES = ['planned', 'running', 'concluded', 'abandoned'];

/** Whether an assert passes, so a button rule can be compared with it. */
const passes = (assert: () => void) => {
  try {
    assert();
    return true;
  } catch {
    return false;
  }
};

describe('assertCanStart', () => {
  it('starts only a planned experiment', () => {
    expect(() => assertCanStart('planned')).not.toThrow();

    for (const status of ['running', 'concluded', 'abandoned']) {
      // Starting again would overwrite the baseline the result is compared to.
      expect(() => assertCanStart(status)).toThrow(/only a planned change/i);
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
      ).toThrow(/only a running change/i);
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
      assertEditable('running', [
        'title',
        'notes',
        'changeDescription',
        'category',
      ]),
    ).not.toThrow();
  });

  // Round 5 (H3). This test used to list `hypothesis` as wording, which
  // contradicted the form: "recorded before the result is known, so
  // hindsight cannot rewrite it".
  it('refuses a new hypothesis or expected outcome once started', () => {
    for (const field of ['hypothesis', 'expectedOutcome']) {
      expect(() => assertEditable('running', [field])).toThrow(field);
      expect(() => assertEditable('concluded', [field])).toThrow(field);
      expect(() => assertEditable('planned', [field])).not.toThrow();
    }
  });
});

describe('assertCanAbandon', () => {
  it('abandons only a planned or running experiment', () => {
    expect(() => assertCanAbandon('planned')).not.toThrow();
    expect(() => assertCanAbandon('running')).not.toThrow();

    for (const status of ['concluded', 'abandoned']) {
      // A concluded experiment's result would be overwritten.
      expect(() => assertCanAbandon(status)).toThrow(
        /only a planned or running change/i,
      );
    }
  });
});

describe('assertCanDelete (KB-7, owner decision 2026-09-24)', () => {
  it('deletes only a planned or abandoned change', () => {
    expect(() => assertCanDelete('planned')).not.toThrow();
    expect(() => assertCanDelete('abandoned')).not.toThrow();

    // A running change is abandoned first; a concluded one is the record.
    expect(() => assertCanDelete('running')).toThrow(/abandon it first/i);
    expect(() => assertCanDelete('concluded')).toThrow(
      /only a planned or abandoned change/i,
    );
  });
});

describe('the page and the action share one rule per move (KB-7)', () => {
  it('shows a button exactly when the action would accept it', () => {
    for (const status of STATUSES) {
      expect(canStart(status)).toBe(passes(() => assertCanStart(status)));
      expect(canAbandon(status)).toBe(passes(() => assertCanAbandon(status)));
      expect(canDelete(status)).toBe(passes(() => assertCanDelete(status)));
      expect(canConclude(status)).toBe(status === 'running');
    }
  });

  it('locks in the form exactly the fields the action refuses', () => {
    expect(frozenFields('planned')).toEqual([]);

    for (const status of ['running', 'concluded', 'abandoned']) {
      const frozen = frozenFields(status);
      expect(frozen.length).toBeGreaterThan(0);

      for (const field of frozen) {
        expect(() => assertEditable(status, [field])).toThrow(field);
      }
      for (const field of ['title', 'changeDescription', 'category', 'notes', 'connectionId', 'tagIds']) {
        expect(frozen).not.toContain(field);
        expect(() => assertEditable(status, [field])).not.toThrow();
      }
    }
  });
});
