import { describe, expect, it } from 'vitest';

import { ActionRefusal } from '../src/refusals/action-result';
import { requireAffectedRows } from '../src/refusals/affected-rows';

/**
 * KB-61: PostgREST answers a DELETE or UPDATE that RLS filtered to no rows
 * with `{ data: null | [], error: null }` — the same as success. The helper
 * turns "nothing changed" into a refusal the user reads.
 */
describe('requireAffectedRows', () => {
  it('returns the rows a write reports', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];

    expect(requireAffectedRows(rows, 'Nothing was deleted')).toBe(rows);
  });

  it('refuses when the write changed no row', () => {
    expect(() => requireAffectedRows([], 'Nothing was deleted')).toThrow(
      new ActionRefusal('Nothing was deleted'),
    );
  });

  // A write without `.select()` answers `data: null`. Refusing it makes a
  // forgotten `.select()` fail every time, not pass every time.
  it('refuses a write that returned no rows at all (no .select())', () => {
    for (const data of [null, undefined]) {
      let caught: unknown;

      try {
        requireAffectedRows(data, 'Nothing was deleted');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ActionRefusal);
      expect((caught as Error).message).toBe('Nothing was deleted');
    }
  });
});
