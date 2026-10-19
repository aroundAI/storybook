import { describe, expect, it } from 'vitest';

import { DEFAULT_CADENCE } from '../src/lib/cadence/cadence';
import {
  type CadenceSummaryInput,
  MAX_CALENDAR_DAYS,
  cadenceSummary,
  matchesScheduleFilters,
  parseScheduleFilters,
  scheduleStatusOf,
} from '../src/lib/schedule-view';

/**
 * FILM-2211. The Schedule page: what its URL asks for, the one line that
 * says how a channel posts, and how each post's status reads.
 */
const NOW = new Date('2026-10-18T10:00:00Z');

describe('parseScheduleFilters', () => {
  it('defaults to every post from 7 days back to 30 days ahead', () => {
    const filters = parseScheduleFilters({}, NOW);

    expect(filters).toMatchObject({
      type: 'all',
      platform: null,
      status: null,
      from: '2026-10-11',
      to: '2026-11-17',
      clamped: false,
    });
    expect(filters.range.from.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(filters.range.to.toISOString()).toBe('2026-11-17T23:59:59.999Z');
  });

  it('reads type, platform, status and dates from the URL', () => {
    expect(
      parseScheduleFilters(
        {
          type: 'short',
          platform: 'instagram',
          status: 'held',
          from: '2026-10-01',
          to: '2026-10-05',
        },
        NOW,
      ),
    ).toMatchObject({
      type: 'short',
      platform: 'instagram',
      status: 'held',
      from: '2026-10-01',
      to: '2026-10-05',
    });
  });

  it('ignores values it does not know rather than showing nothing', () => {
    expect(
      parseScheduleFilters(
        {
          type: 'reel',
          platform: 'myspace',
          // Taking down is not a filter; Removed (KB-207) is
          status: 'deleting',
          from: '2026-13-40',
          to: 'soon',
        },
        NOW,
      ),
    ).toMatchObject({
      type: 'all',
      platform: null,
      status: null,
      from: '2026-10-11',
      to: '2026-11-17',
    });
  });

  it('takes the first of a repeated parameter', () => {
    expect(parseScheduleFilters({ type: ['long', 'short'] }, NOW).type).toBe(
      'long',
    );
  });

  it('turns a backwards range around', () => {
    expect(
      parseScheduleFilters({ from: '2026-10-20', to: '2026-10-10' }, NOW),
    ).toMatchObject({ from: '2026-10-10', to: '2026-10-20' });
  });

  it(`reads at most ${MAX_CALENDAR_DAYS} days, and says it cut the range`, () => {
    const filters = parseScheduleFilters(
      { from: '2026-01-01', to: '2026-12-31' },
      NOW,
    );

    expect(filters).toMatchObject({
      from: '2026-01-01',
      to: '2026-03-03',
      clamped: true,
    });
    const days =
      (filters.range.to.getTime() - filters.range.from.getTime()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(MAX_CALENDAR_DAYS);
  });
});

describe('matchesScheduleFilters', () => {
  const post = { contentType: 'short', platform: 'youtube', status: 'held' };
  const all = parseScheduleFilters({}, NOW);

  it('keeps everything with no filter', () => {
    expect(matchesScheduleFilters(post, all)).toBe(true);
  });

  it('long means anything that is not a Short', () => {
    const long = parseScheduleFilters({ type: 'long' }, NOW);

    expect(matchesScheduleFilters(post, long)).toBe(false);
    expect(matchesScheduleFilters({ ...post, contentType: 'full' }, long)).toBe(
      true,
    );
  });

  it('filters by platform and status', () => {
    expect(
      matchesScheduleFilters(
        post,
        parseScheduleFilters({ platform: 'instagram' }, NOW),
      ),
    ).toBe(false);
    expect(
      matchesScheduleFilters(
        post,
        parseScheduleFilters({ status: 'scheduled' }, NOW),
      ),
    ).toBe(false);
    expect(
      matchesScheduleFilters(
        post,
        parseScheduleFilters({ platform: 'youtube', status: 'held' }, NOW),
      ),
    ).toBe(true);
  });
});

describe('cadenceSummary', () => {
  const own = (
    contentType: 'full' | 'short',
    cadence: Partial<CadenceSummaryInput['cadence']>,
    enabled = true,
  ): CadenceSummaryInput => ({
    contentType,
    own: true,
    enabled,
    cadence: {
      ...DEFAULT_CADENCE[contentType],
      timezone: 'Asia/Kolkata',
      ...cadence,
    },
  });

  it('says each type’s times, spacing and zone in one line', () => {
    expect(
      cadenceSummary(
        [
          own('full', { slotTimes: ['20:00'], minDaysBetween: 3 }),
          own('short', {
            slotTimes: ['11:00', '17:00'],
            everyNDays: 1,
            startAfterHours: 2,
          }),
        ],
        'youtube',
      ),
    ).toBe(
      'Long 20:00 every 3 days · Shorts 11:00, 17:00 daily, from 2 h after · Asia/Kolkata',
    );
  });

  it('names the days when not every day, and every N days for Shorts', () => {
    expect(
      cadenceSummary(
        [
          own('full', { minDaysBetween: 1, daysOfWeek: [1, 3, 5] }),
          own('short', { everyNDays: 2, startAfterHours: 0 }),
        ],
        'youtube',
      ),
    ).toBe(
      'Long 17:00 daily on Mon, Wed, Fri · Shorts 18:00 every 2 days · Asia/Kolkata',
    );
  });

  it('says when a type posts on the defaults: none saved, or switched off', () => {
    expect(
      cadenceSummary(
        [
          {
            contentType: 'full',
            own: false,
            enabled: true,
            cadence: { ...DEFAULT_CADENCE.full, timezone: null },
          },
          own('short', { slotTimes: ['09:00'] }, false),
        ],
        'youtube',
      ),
    ).toBe(
      'Long 17:00 every 3 days (default) · Shorts 18:00 daily, from 2 h after (default)',
    );
  });

  it('gives each type its zone when the two differ', () => {
    expect(
      cadenceSummary(
        [
          own('full', { timezone: 'UTC' }),
          own('short', { timezone: 'Asia/Kolkata' }),
        ],
        'youtube',
      ),
    ).toBe(
      'Long 17:00 every 3 days (UTC) · Shorts 18:00 daily, from 2 h after (Asia/Kolkata)',
    );
  });

  it('leaves out the long rule on a channel that takes no long videos', () => {
    const both = [
      own('full', { slotTimes: ['20:00'] }),
      own('short', { slotTimes: ['11:00'], startAfterHours: 0 }),
    ];

    expect(cadenceSummary(both, 'instagram')).toBe(
      'Shorts 11:00 daily · Asia/Kolkata',
    );
    expect(cadenceSummary(both, 'youtube')).toBe(
      'Long 20:00 every 3 days · Shorts 11:00 daily · Asia/Kolkata',
    );
  });
});

describe('scheduleStatusOf', () => {
  it.each([
    ['scheduled', 'Scheduled', 'neutral'],
    ['queued', 'Queued', 'neutral'],
    ['publishing', 'Publishing', 'neutral'],
    ['published', 'Published', 'success'],
    ['failed', 'Failed', 'danger'],
    ['held', 'Held', 'warning'],
    ['deleting', 'Taking down', 'neutral'],
  ])('%s reads %s', (status, label, tone) => {
    expect(scheduleStatusOf(status)).toEqual({ label, tone });
  });

  it('shows a status it does not know as it is', () => {
    expect(scheduleStatusOf('archived')).toEqual({
      label: 'archived',
      tone: 'neutral',
    });
  });
});
