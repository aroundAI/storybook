import { describe, expect, it, vi } from 'vitest';

import { shortsChannelsFor, shortsTargets } from '../src/lib/shorts-targets';

vi.mock('../src/lib/x-switch', () => ({ X_ENABLED: false }));

/**
 * A short is cut differently for each platform: the YouTube cut goes to the
 * YouTube channels, the Instagram/Facebook cut to those, each in the
 * channel's own language (owner, 2026-10-10).
 */
describe('which channel gets which Shorts group', () => {
  const channels = [
    { id: 'yt-en', platform: 'youtube', language: 'en' },
    { id: 'yt-hi', platform: 'youtube', language: 'hi' },
    { id: 'ig-en', platform: 'instagram', language: 'en' },
    { id: 'fb-hi', platform: 'facebook', language: 'hi' },
    { id: 'x-en', platform: 'twitter', language: 'en' },
  ];

  const pairs = (groups: Parameters<typeof shortsTargets>[0]) =>
    shortsTargets(groups, channels).map(
      ({ group, language, channel }) => `${group.id}:${language}→${channel.id}`,
    );

  it('sends each cut to its own platforms, in each channel’s language', () => {
    expect(
      pairs([
        {
          id: 'yt-cut',
          platforms: ['youtube'],
          videos: { en: 'yt-en.mp4', hi: 'yt-hi.mp4' },
        },
        {
          id: 'ig-fb-cut',
          platforms: ['instagram', 'facebook'],
          videos: { en: 'ig-en.mp4', hi: 'ig-hi.mp4' },
        },
      ]),
    ).toEqual([
      'yt-cut:en→yt-en',
      'yt-cut:hi→yt-hi',
      'ig-fb-cut:en→ig-en',
      'ig-fb-cut:hi→fb-hi',
    ]);
  });

  it('a group naming no platform goes to every Shorts channel shown', () => {
    expect(pairs([{ id: 'all', videos: { en: 'en.mp4' } }])).toEqual([
      'all:en→yt-en',
      'all:en→ig-en',
    ]);
  });

  it('a language with no video sends nothing', () => {
    expect(
      pairs([{ id: 'yt-cut', platforms: ['youtube'], videos: { hi: '' } }]),
    ).toEqual([]);
  });

  it('a scheduled group in one language goes to the same channels', () => {
    expect(
      shortsChannelsFor(
        { platforms: ['instagram', 'facebook'] },
        'hi',
        channels,
      ).map((c) => c.id),
    ).toEqual(['fb-hi']);
  });
});
