import { describe, expect, it } from 'vitest';

import { youtubeStagingLine } from '../src/lib/schedule-view';
import {
  DEFAULT_YOUTUBE_LEAD_MINUTES,
  HELD_ALERT,
  type YouTubeStaging,
  heldPublishAt,
  readinessVerdict,
  shouldStage,
  withHold,
  youtubeLeadMinutesOf,
} from '../src/lib/youtube-staging';

/**
 * KB-214. YouTube served launch viewers 360p because a scheduled video was
 * uploaded public at its slot, before YouTube had made its HD version. A
 * YouTube post is now uploaded ahead of its time, private, and goes public
 * only once YouTube reports it processed in HD.
 */

const NOW = new Date('2026-11-05T10:00:00Z');
const at = (minutes: number) =>
  new Date(NOW.getTime() + minutes * 60_000).toISOString();

const post = (minutes: number, extra: Record<string, unknown> = {}) => ({
  platform: 'youtube',
  scheduled_at: at(minutes),
  metadata: {},
  release_priority: 'normal',
  ...extra,
});

describe('which posts are uploaded ahead of their time', () => {
  it('stages a YouTube post due within the lead time', () => {
    expect(shouldStage(post(90), NOW, 120)).toBe(true);
    expect(shouldStage(post(120), NOW, 120)).toBe(true);
  });

  it('leaves a post due later, or within two minutes, to its time', () => {
    expect(shouldStage(post(121), NOW, 120)).toBe(false);
    expect(shouldStage(post(2), NOW, 120)).toBe(false);
    expect(shouldStage(post(-5), NOW, 120)).toBe(false);
  });

  it('stages nothing already uploaded, nothing off YouTube, and nothing with a lead of 0', () => {
    expect(
      shouldStage(
        post(60, { metadata: { youtube: { videoId: 'v' } } }),
        NOW,
        120,
      ),
    ).toBe(false);
    expect(shouldStage(post(60, { platform: 'facebook' }), NOW, 120)).toBe(
      false,
    );
    expect(shouldStage(post(60), NOW, 0)).toBe(false);
  });

  it('leaves a breaking post due within ten minutes to go public when ready', () => {
    expect(
      shouldStage(post(4, { release_priority: 'breaking' }), NOW, 120),
    ).toBe(false);
    // A breaking release at a time of the owner's choosing is staged
    expect(
      shouldStage(post(60, { release_priority: 'breaking' }), NOW, 120),
    ).toBe(true);
  });

  it('reads the project lead time, 120 minutes unless set', () => {
    expect(youtubeLeadMinutesOf(null)).toBe(DEFAULT_YOUTUBE_LEAD_MINUTES);
    expect(youtubeLeadMinutesOf({ youtubeLeadMinutes: 45 })).toBe(45);
    expect(youtubeLeadMinutesOf({ youtubeLeadMinutes: 99_999 })).toBe(1440);
  });
});

describe('the HD gate', () => {
  const video = (
    definition: string,
    processingStatus: string,
    extra: Record<string, unknown> = {},
  ) => ({
    status: { privacyStatus: 'private', uploadStatus: 'uploaded', ...extra },
    processingDetails: { processingStatus },
    contentDetails: { definition },
  });

  it('is ready only in HD and processed', () => {
    expect(readinessVerdict(video('hd', 'succeeded'))).toEqual({
      state: 'ready',
    });
    expect(readinessVerdict(video('sd', 'succeeded'))).toEqual({
      state: 'hold',
      reason: 'hd_not_ready',
    });
    expect(readinessVerdict(video('hd', 'processing'))).toEqual({
      state: 'hold',
      reason: 'processing',
    });
  });

  it('fails a rejected upload with YouTube’s reason (KB-205’s words)', () => {
    const verdict = readinessVerdict(
      video('sd', 'processing', {
        uploadStatus: 'rejected',
        rejectionReason: 'length',
      }),
    );

    expect(verdict).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('rejectionReason: length'),
    });
  });

  it('holds ten minutes past the later of its time and now', () => {
    expect(heldPublishAt(at(5), NOW).toISOString()).toBe(at(15));
    expect(heldPublishAt(at(-20), NOW).toISOString()).toBe(at(10));
  });

  it('flags a video held six hours in all, and keeps holding it', () => {
    let staging: YouTubeStaging = {
      videoId: 'v',
      stagedAt: at(-120),
      publishAt: at(0),
      delays: [],
    };

    for (let hold = 0; hold < 36; hold++) {
      const to = heldPublishAt(staging.publishAt, NOW);
      staging = withHold(staging, { now: NOW, to, reason: 'hd_not_ready' });
      expect(staging.alert).toBe(hold === 35 ? HELD_ALERT : undefined);
    }

    expect(staging.delays).toHaveLength(36);
    expect(staging.publishAt).toBe(at(360));
  });
});

describe('what the Schedule tab says', () => {
  const view = (extra: Record<string, unknown> = {}) => ({
    staged: true,
    goLiveWhenReady: false,
    publishAt: '2026-11-05T12:00:00Z',
    delays: [] as unknown[],
    alert: null,
    error: null,
    ...extra,
  });
  const time = (iso: string) => iso.slice(11, 16);

  it('says when a staged video goes public', () => {
    expect(youtubeStagingLine(view(), time)?.text).toBe(
      'Uploaded, goes public at 12:00.',
    );
  });

  it('says a held video waits for HD, its new time and how often', () => {
    expect(youtubeStagingLine(view({ delays: [{}, {}] }), time)?.text).toBe(
      'Held: HD not ready, now 12:00 (held 2 times).',
    );
  });

  it('marks a video held over six hours', () => {
    expect(
      youtubeStagingLine(view({ delays: [{}], alert: HELD_ALERT }), time),
    ).toEqual({
      text: 'Held over 6 hours. Held: HD not ready, now 12:00 (held 1 time).',
      alert: true,
    });
  });

  it('says a breaking post goes public once YouTube has HD', () => {
    expect(
      youtubeStagingLine(view({ goLiveWhenReady: true }), time)?.text,
    ).toMatch(/goes public as soon as YouTube has HD/);
  });

  it('says nothing of a post that is not staged', () => {
    expect(youtubeStagingLine(null, time)).toBeNull();
    expect(youtubeStagingLine(view({ staged: false }), time)).toBeNull();
  });
});
