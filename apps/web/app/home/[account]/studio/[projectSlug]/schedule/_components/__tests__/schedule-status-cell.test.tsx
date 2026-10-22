import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type ScheduleRow, StatusCell } from '../schedule-status-cell';

/**
 * KB-214. The Schedule tab says when a YouTube post uploaded ahead of its
 * time goes public, that the HD gate held it and how often, and marks one
 * held over six hours. (The browser screenshot is pending: the local stack
 * was down when this was written.)
 */

afterEach(cleanup);

const row = (youtube: ScheduleRow['youtube']): ScheduleRow => ({
  publishId: 'p1',
  episodeId: 'e1',
  episodeTitle: 'Harbour',
  episodeNumber: 1,
  episodeSlug: 'harbour',
  platform: 'youtube',
  channelName: 'Harbour TV',
  contentType: 'full',
  title: 'The harbour at dusk',
  status: 'scheduled',
  at: '2026-11-05T14:00:00Z',
  platformUrl: 'https://www.youtube.com/watch?v=v1',
  error: null,
  heldReason: null,
  breaking: false,
  episodeDeleted: false,
  removedReason: null,
  youtube,
});

const youtube = (extra: Partial<NonNullable<ScheduleRow['youtube']>> = {}) => ({
  staged: true,
  goLiveWhenReady: false,
  publishAt: '2026-11-05T14:00:00Z',
  delays: [],
  alert: null,
  error: null,
  ...extra,
});

const line = (r: ScheduleRow) =>
  render(<StatusCell row={r} timeZone="UTC" />).container.querySelector(
    '[data-test="schedule-row-youtube"]',
  );

describe('a staged YouTube post on the Schedule tab', () => {
  it('says it is uploaded and when it goes public', () => {
    expect(line(row(youtube()))?.textContent).toBe(
      'Uploaded, goes public at Thu 5 Nov, 14:00.',
    );
  });

  it('says it is held for HD, its new time and how often', () => {
    expect(
      line(
        row(youtube({ publishAt: '2026-11-05T14:20:00Z', delays: [{}, {}] })),
      )?.textContent,
    ).toBe('Held: HD not ready, now Thu 5 Nov, 14:20 (held 2 times).');
  });

  it('highlights one held over six hours', () => {
    const element = line(row(youtube({ delays: [{}], alert: 'held_over_6h' })));

    expect(element?.textContent).toMatch(/^Held over 6 hours\./);
    expect(element?.className).toMatch(/amber/);
  });

  it('says nothing of a post not staged', () => {
    expect(line(row(null))).toBeNull();
  });
});
