import { describe, expect, it } from 'vitest';

import {
  NINETY_DAY_REASON,
  channelReachAvailability,
  measuredViews,
  parseReachWindow,
  postReachAvailability,
  totalCounts,
  windowBounds,
} from '../src/lib/reach-overview';

describe('reach page rules (cross-platform reach design)', () => {
  it('a window ends on the last complete day and spans its days', () => {
    const now = new Date('2026-09-28T19:00:00Z');

    expect(windowBounds(7, now)).toEqual({
      from: '2026-09-21',
      to: '2026-09-27',
    });
    expect(windowBounds(30, now)).toEqual({
      from: '2026-08-29',
      to: '2026-09-27',
    });
    expect(windowBounds(90, now).from).toBe('2026-06-30');
  });

  it('only 7, 30 and 90 are windows; anything else is 7', () => {
    expect(parseReachWindow('30')).toBe(30);
    expect(parseReachWindow('90')).toBe(90);
    expect(parseReachWindow('14')).toBe(7);
    expect(parseReachWindow(undefined)).toBe(7);
  });

  it("Instagram's channel reach exists for 7 and 30 days, not 90", () => {
    expect(channelReachAvailability('instagram', 7).measured).toBe(true);
    expect(channelReachAvailability('instagram', 30).measured).toBe(true);
    expect(channelReachAvailability('instagram', 90)).toEqual({
      measured: false,
      reason: NINETY_DAY_REASON,
    });
  });

  it("a platform without it says why, in the capability matrix's words", () => {
    const youtube = channelReachAvailability('youtube', 7);
    const tiktok = postReachAvailability('tiktok');

    expect(youtube).toMatchObject({ measured: false });
    expect(!youtube.measured && youtube.reason).toMatch(
      /^Not measured: YouTube reports how many times/,
    );
    expect(!tiktok.measured && tiktok.reason).toMatch(/Business integration/);
    expect(postReachAvailability('instagram').measured).toBe(true);
  });

  it('views, comments and shares total; nothing else is offered to total', () => {
    expect(
      totalCounts([
        { views: 100, comments: 3, shares: 2 },
        { views: 50, comments: 1, shares: 0 },
      ]),
    ).toEqual({ views: 150, comments: 4, shares: 2 });

    // The type admits only the three counts: a reach figure cannot be passed.
    expect(Object.keys(totalCounts([]))).toEqual([
      'views',
      'comments',
      'shares',
    ]);
  });

  it('adds nothing to views for Facebook, which has no single view (FILM-1720)', () => {
    // ClickHouse sums a Facebook row's NULL views to NULL, and the reader
    // used to read that as 0: a Facebook tab showing "0 views".
    expect(measuredViews('facebook', null)).toBeNull();
    expect(measuredViews('facebook', 0)).toBeNull();
    expect(measuredViews('instagram', '150')).toBe(150);

    expect(
      totalCounts([
        { views: 150, comments: 4, shares: 2 },
        { views: null, comments: 3, shares: 1 },
      ]),
    ).toEqual({ views: 150, comments: 7, shares: 3 });
  });
});
