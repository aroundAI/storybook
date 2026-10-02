import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_PLATFORMS,
  CAPABILITY_MATRIX,
  VIEWS_COLUMN_PLATFORMS,
} from '@kit/clickhouse';

import {
  VIEWS_NOT_MEASURED_FALLBACK,
  viewsNotMeasuredReason,
} from '../src/lib/views';

/**
 * KB-166: a null Views total said Facebook's reason whatever the scope, so
 * a YouTube-only episode with no rows yet read "Facebook counts four
 * different kinds of view". The reason is now worked out from the scope:
 * the matrix's views note for a platform with no views column, the chip's
 * no-data-in-window line for one with no rows, combined as the chips do.
 */
const FACEBOOK_NOTE =
  'Facebook counts four different kinds of view, and none of them is a view in this sense, so its plays are not counted as views.';
const YOUTUBE_NO_ROWS = 'YouTube: connected, but no data for the last 30 days.';

const window = 'the last 30 days';

describe('viewsNotMeasuredReason (KB-166)', () => {
  it('Facebook only: Facebook’s own matrix note', () => {
    expect(
      viewsNotMeasuredReason({
        platforms: ['facebook'],
        withRows: ['facebook'],
        windowLabel: window,
      }),
    ).toBe(FACEBOOK_NOTE);
  });

  it('YouTube only, no rows yet: the no-data-in-window reason, not Facebook’s', () => {
    const reason = viewsNotMeasuredReason({
      platforms: ['youtube'],
      withRows: [],
      windowLabel: window,
    });

    expect(reason).toBe(YOUTUBE_NO_ROWS);
    expect(reason).not.toContain('Facebook');
  });

  it('mixed: each platform’s reason once, in the chips’ platform order', () => {
    expect(
      viewsNotMeasuredReason({
        platforms: ['facebook', 'youtube', 'facebook'],
        withRows: ['facebook'],
        windowLabel: window,
      }),
    ).toBe(`${YOUTUBE_NO_ROWS} ${FACEBOOK_NOTE}`);
  });

  it('a platform with rows that reports views adds no reason', () => {
    expect(
      viewsNotMeasuredReason({
        platforms: ['tiktok', 'facebook'],
        withRows: ['tiktok', 'facebook'],
        windowLabel: window,
      }),
    ).toBe(FACEBOOK_NOTE);
  });

  it('no scope known: a reason that names no platform', () => {
    expect(viewsNotMeasuredReason(null)).toBe(VIEWS_NOT_MEASURED_FALLBACK);
    for (const platform of ANALYTICS_PLATFORMS) {
      expect(VIEWS_NOT_MEASURED_FALLBACK.toLowerCase()).not.toContain(platform);
    }
  });

  it('the matrix has a views note exactly where a platform has no views column (FILM-1722)', () => {
    for (const platform of ANALYTICS_PLATFORMS) {
      const note = CAPABILITY_MATRIX.engagement[platform].viewsNote;

      expect(
        { platform, hasNote: typeof note === 'string' && note.length > 0 },
        platform,
      ).toEqual({
        platform,
        hasNote: !VIEWS_COLUMN_PLATFORMS.includes(platform),
      });
    }
  });
});
