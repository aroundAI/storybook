import { describe, expect, it } from 'vitest';

import { dueQueryKey } from '../_lib/due-query';

/**
 * FILM-1610 review 2, R8. The due list is "as of" the user's date, so the
 * date has to be part of the cache key: without it, a tab left open past
 * midnight kept serving yesterday's list from cache.
 */
describe('dueQueryKey', () => {
  it('differs from one local day to the next', () => {
    expect(dueQueryKey('a1', '2026-03-01')).not.toEqual(
      dueQueryKey('a1', '2026-03-02'),
    );
  });

  it('starts with the prefix the page invalidates after a start or conclude', () => {
    expect(dueQueryKey('a1', '2026-03-01').slice(0, 2)).toEqual([
      'experiments-due',
      'a1',
    ]);
  });
});
