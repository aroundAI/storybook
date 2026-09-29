import { describe, expect, it } from 'vitest';

import { readFailed, whyNoRow } from '../src/rows';

/**
 * KB-138: "not found" only when there is no row. `.single()` says so with
 * PostgREST's `PGRST116`; any other error is a failed read and says what it
 * was (KB-137's statement timeout read as "Social post not found").
 */
const NO_ROW = {
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
};
const TIMEOUT = {
  code: '57014',
  message: 'canceling statement due to statement timeout',
};

describe('whyNoRow', () => {
  it('says "not found" when there is no row', () => {
    expect(whyNoRow(null, 'Episode not found')).toBe('Episode not found');
    expect(whyNoRow(undefined, 'Episode not found')).toBe('Episode not found');
    expect(whyNoRow(NO_ROW, 'Episode not found')).toBe('Episode not found');
  });

  it('names the failed read instead', () => {
    expect(whyNoRow(TIMEOUT, 'Episode not found')).toBe(
      'Episode not found: the read failed (canceling statement due to statement timeout)',
    );
    expect(whyNoRow({ message: 'fetch failed' }, 'Episode not found')).toBe(
      'Episode not found: the read failed (fetch failed)',
    );
  });
});

describe('readFailed', () => {
  it('is false for no row and true for any other error', () => {
    expect(readFailed(null)).toBe(false);
    expect(readFailed(NO_ROW)).toBe(false);
    expect(readFailed(TIMEOUT)).toBe(true);
    expect(readFailed({ message: 'fetch failed' })).toBe(true);
  });
});
