import { describe, expect, it } from 'vitest';

import { ActionRefusal } from '../src/refusals/action-result';
import { requireAffectedRows, requireRow } from '../src/refusals/affected-rows';

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

/**
 * KB-138: `if (error || !row) throw new ActionRefusal('… not found')` showed a
 * statement timeout as a missing row (KB-137), and a refusal is never logged.
 */
describe('requireRow', () => {
  it('returns the row a read found', () => {
    const row = { id: 'a' };

    expect(requireRow({ data: row, error: null }, 'Post not found')).toBe(row);
  });

  it('refuses when .single() found no row (PGRST116)', () => {
    expect(() =>
      requireRow(
        { data: null, error: { code: 'PGRST116', message: '0 rows' } },
        'Post not found',
      ),
    ).toThrow(new ActionRefusal('Post not found'));
  });

  it('refuses when a read found no row and reported no error', () => {
    expect(() =>
      requireRow({ data: null, error: null }, 'Post not found'),
    ).toThrow(new ActionRefusal('Post not found'));
  });

  it('throws a failed read as a crash, not as "not found"', () => {
    let caught: unknown;

    try {
      requireRow(
        {
          data: null,
          error: {
            code: '57014',
            message: 'canceling statement due to statement timeout',
          },
        },
        'Post not found',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ActionRefusal);
    expect((caught as Error).message).toContain('statement timeout');
  });
});
