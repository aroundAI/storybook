import { describe, expect, it } from 'vitest';

import { ANALYTICS_PLATFORMS } from '../src/lib/data-provenance';
import {
  PLATFORM_ENUM_TYPE,
  PLATFORM_ENUM_VALUES,
} from '../src/lib/platform-enum';
import { PLATFORM_ENUM_AFTER_021 } from '../src/migrations/021_twitter';

/**
 * FILM-1720. The `platform` enum is stated once in code and once in the
 * migration that last widened it; a query parameter declared with a
 * different enum errors at the server on a valid selection.
 */
describe('the platform enum', () => {
  it('is the enum the latest widening migration leaves on every table', () => {
    expect(PLATFORM_ENUM_TYPE).toBe(PLATFORM_ENUM_AFTER_021);
  });

  it('has an ordinal for every analytics platform, appended and never renumbered', () => {
    expect(Object.keys(PLATFORM_ENUM_VALUES).sort()).toEqual(
      [...ANALYTICS_PLATFORMS].sort(),
    );
    // Stored values never move: 001-004, then 020 and 021 appended.
    expect(PLATFORM_ENUM_VALUES).toMatchObject({
      youtube: 1,
      tiktok: 2,
      instagram: 3,
      facebook: 4,
      twitter: 5,
    });
  });
});
