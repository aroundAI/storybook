import { describe, expect, it } from 'vitest';

import { PLATFORMS, isPlatform } from '../src/lib/platforms';
import { tokenErrorMessage } from '../src/lib/token-errors';

/**
 * FILM-717. LinkedIn is removed from the product (owner, 2026-10-02). The
 * database CHECK still admits 'linkedin', so old rows keep their value, but
 * it is not a `Platform`: every reader that narrows with `isPlatform` treats
 * such a row as one the product does not support.
 */
describe('a platform the product removed', () => {
  it('is not a platform the product supports', () => {
    expect(PLATFORMS).not.toContain('linkedin');
    expect(isPlatform('linkedin')).toBe(false);
  });

  it('is refused in words that do not ask anyone to reconnect', () => {
    const sentence = tokenErrorMessage('PLATFORM_UNSUPPORTED', 'linkedin');

    expect(sentence).toBe(
      'This app no longer publishes to linkedin, so nothing was sent.',
    );
    expect(sentence).not.toMatch(/reconnect/i);
  });
});
