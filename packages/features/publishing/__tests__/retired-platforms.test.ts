import { describe, expect, it } from 'vitest';

import {
  OFFERED_PLATFORMS,
  PLATFORMS,
  RETIRED_PLATFORMS,
  isRetiredPlatform,
} from '../src/lib/platforms';
import { tokenErrorMessage } from '../src/lib/token-errors';

/**
 * FILM-717. LinkedIn is retired "for now" (owner, 2026-10-02): nothing offers
 * it, and its stored rows are kept. So it stays a value the database holds
 * (`PLATFORMS`) and leaves the list of platforms the product offers.
 */
describe('retired platforms', () => {
  it('retires LinkedIn and nothing else', () => {
    expect(RETIRED_PLATFORMS).toEqual(['linkedin']);
    expect(isRetiredPlatform('linkedin')).toBe(true);
    expect(isRetiredPlatform('twitter')).toBe(false);
    expect(isRetiredPlatform('not-a-platform')).toBe(false);
  });

  it('keeps LinkedIn as a stored value, so its rows still read', () => {
    expect(PLATFORMS).toContain('linkedin');
  });

  it('offers every platform except the retired ones', () => {
    expect(OFFERED_PLATFORMS).toEqual(
      PLATFORMS.filter((platform) => platform !== 'linkedin'),
    );
  });

  it('says a retired platform is retired, not that a connection broke', () => {
    const sentence = tokenErrorMessage('PLATFORM_RETIRED', 'linkedin');

    expect(sentence).toBe(
      'LinkedIn is retired: this app no longer publishes to it. Your LinkedIn connection and what you published there are kept.',
    );
    expect(sentence).not.toMatch(/reconnect/i);
  });
});
