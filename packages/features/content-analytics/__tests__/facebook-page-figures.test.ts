import { describe, expect, it, vi } from 'vitest';

import {
  FACEBOOK_THIRTY_DAY_REASON,
  channelReachAvailability,
} from '../src/lib/reach-overview';
import { readsChannelReach } from '../src/server/channel-reach-windows';
import { buildFacebookAudienceRows } from '../src/server/ingest';
import { readsFollowers } from '../src/server/subscriber-snapshot';

vi.mock('server-only', () => ({}));

/**
 * FILM-1720: a Page's followers, its unique viewers per window, and each
 * video's 3-second views by age, gender and country. Facebook ships dark,
 * so none of it is read until the connection holds the Page's insights.
 */

const FULL = [
  'read_insights',
  'pages_manage_engagement',
  'pages_read_engagement',
];

const connection = (platform: string, scopes: string[] | null) => ({
  id: 'c1',
  platform,
  platform_account_id: 'page-1',
  scopes,
});

describe('Facebook is read only once its insights are granted', () => {
  it('followers: a Page without read_insights is skipped, others are read', () => {
    expect(readsFollowers(connection('facebook', FULL))).toBe(true);
    expect(
      readsFollowers(connection('facebook', ['pages_read_engagement'])),
    ).toBe(false);
    expect(readsFollowers(connection('facebook', null))).toBe(false);
    expect(readsFollowers(connection('youtube', null))).toBe(true);
  });

  it('channel reach: Instagram always, a Page only with its insights', () => {
    expect(readsChannelReach(connection('instagram', null))).toBe(true);
    expect(readsChannelReach(connection('facebook', FULL))).toBe(true);
    expect(
      readsChannelReach(connection('facebook', ['pages_read_engagement'])),
    ).toBe(false);
    expect(readsChannelReach(connection('youtube', FULL))).toBe(false);
  });
});

describe("a Page's reach on the reach page", () => {
  it('7 days is measured; 30 days says Facebook has no such window', () => {
    expect(channelReachAvailability('facebook', 7).measured).toBe(true);
    expect(channelReachAvailability('facebook', 30)).toEqual({
      measured: false,
      reason: FACEBOOK_THIRTY_DAY_REASON,
    });
    expect(FACEBOOK_THIRTY_DAY_REASON).toMatch(/^Not measured: Facebook /);
  });
});

describe('buildFacebookAudienceRows', () => {
  const rows = buildFacebookAudienceRows({
    projectId: 'p1',
    videoId: 'v1',
    audience: {
      ageGender: [
        { gender: 'F', ageGroup: '18-24', views: 10 },
        { gender: 'M', ageGroup: '18-24', views: 30 },
        { gender: 'F', ageGroup: '25-34', views: 50 },
        { gender: 'U', ageGroup: '65+', views: 10 },
      ],
      countries: [
        { country: 'US', views: 75 },
        { country: 'GB', views: 25 },
      ],
    },
  });

  const of = (dimension: string) =>
    Object.fromEntries(
      rows
        .filter((row) => row.dimension === dimension)
        .map((row) => [row.key, [row.views, row.percentage]]),
    );

  it('sums each age group across genders, as a share of its dimension', () => {
    expect(of('age_group')).toEqual({
      '18-24': [40, 40],
      '25-34': [50, 50],
      '65+': [10, 10],
    });
  });

  it('sums each gender across ages, named as the other platforms name them', () => {
    expect(of('gender')).toEqual({
      female: [60, 60],
      male: [30, 30],
      other: [10, 10],
    });
  });

  it('keeps countries as Meta reports them', () => {
    expect(of('country')).toEqual({ US: [75, 75], GB: [25, 25] });
    expect(rows.every((row) => row.platform === 'facebook')).toBe(true);
  });

  it('writes nothing when Meta gave no breakdown', () => {
    expect(
      buildFacebookAudienceRows({
        projectId: 'p1',
        videoId: 'v1',
        audience: null,
      }),
    ).toEqual([]);
  });
});
