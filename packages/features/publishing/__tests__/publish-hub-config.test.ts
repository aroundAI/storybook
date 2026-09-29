import { describe, expect, it } from 'vitest';

import {
  PLATFORM_CONFIG,
  getDefaultPlatformSettings,
} from '../src/lib/platform-limits';
import {
  PlatformConfigSchema,
  PlatformSpecificSettingsSchema,
  PublishToAllSchema,
} from '../src/lib/schemas/publish.schema';

/**
 * FILM-708. The Publish Hub builds one config per platform the creator turns
 * on: its starting settings, then the metadata they edit, then an optional
 * schedule. These tests pin the pure parts: the starting settings per
 * platform, what the metadata schema accepts and refuses, and how a
 * schedule is read.
 */

const CONNECTION = '5b5bbbbb-0000-4000-8000-000000000001';
const EPISODE = '5b5bbbbb-0000-4000-8000-000000000002';

const config = (over: Record<string, unknown> = {}) => ({
  platform: 'youtube',
  connectionId: CONNECTION,
  title: 'A title',
  ...over,
});

describe('platform settings initialisation', () => {
  it('starts each platform with its own defaults', () => {
    expect(getDefaultPlatformSettings('youtube')).toEqual({
      privacy: 'private',
    });
    expect(getDefaultPlatformSettings('tiktok')).toEqual({
      disableDuet: false,
      disableStitch: false,
      disableComment: false,
    });
    expect(getDefaultPlatformSettings('instagram')).toEqual({
      shareToFeed: true,
    });
    expect(getDefaultPlatformSettings('facebook')).toEqual({ isReel: false });
    expect(getDefaultPlatformSettings('twitter')).toEqual({});
    expect(getDefaultPlatformSettings('linkedin')).toEqual({});
  });

  it('never assumes a YouTube audience or category (KB-30): the creator declares them', () => {
    const youtube = getDefaultPlatformSettings('youtube');

    expect(youtube).not.toHaveProperty('madeForKids');
    expect(youtube).not.toHaveProperty('categoryId');
  });

  it('starts YouTube private, so nothing goes public by default', () => {
    expect(getDefaultPlatformSettings('youtube').privacy).toBe('private');
  });

  it('gives every configured platform defaults the settings schema accepts', () => {
    for (const platform of Object.keys(PLATFORM_CONFIG)) {
      expect(
        PlatformSpecificSettingsSchema.safeParse(
          getDefaultPlatformSettings(platform as never),
        ).success,
        platform,
      ).toBe(true);
    }
  });
});

describe('metadata validation', () => {
  it('fills the optional fields with their defaults', () => {
    const parsed = PlatformConfigSchema.parse(config());

    expect(parsed).toMatchObject({
      contentType: 'full',
      description: '',
      tags: [],
      platformSpecific: {},
    });
    expect(parsed.language).toBeUndefined();
  });

  it('requires a title, up to 5000 characters', () => {
    expect(PlatformConfigSchema.safeParse(config({ title: '' })).success).toBe(
      false,
    );
    expect(
      PlatformConfigSchema.safeParse(config({ title: 'x'.repeat(5000) }))
        .success,
    ).toBe(true);
    expect(
      PlatformConfigSchema.safeParse(config({ title: 'x'.repeat(5001) }))
        .success,
    ).toBe(false);
  });

  it('limits the description to 70000 characters', () => {
    expect(
      PlatformConfigSchema.safeParse(config({ description: 'x'.repeat(70000) }))
        .success,
    ).toBe(true);
    expect(
      PlatformConfigSchema.safeParse(config({ description: 'x'.repeat(70001) }))
        .success,
    ).toBe(false);
  });

  it('refuses a platform outside the six, and a connection that is not a uuid', () => {
    expect(
      PlatformConfigSchema.safeParse(config({ platform: 'myspace' })).success,
    ).toBe(false);
    expect(
      PlatformConfigSchema.safeParse(config({ connectionId: 'not-a-uuid' }))
        .success,
    ).toBe(false);
  });

  it('accepts a thumbnail URL or none, and refuses text that is not a URL', () => {
    expect(
      PlatformConfigSchema.safeParse(
        config({ thumbnailUrl: 'https://cdn.example.com/t.png' }),
      ).success,
    ).toBe(true);
    expect(
      PlatformConfigSchema.safeParse(config({ thumbnailUrl: null })).success,
    ).toBe(true);
    expect(
      PlatformConfigSchema.safeParse(config({ thumbnailUrl: 'a picture' }))
        .success,
    ).toBe(false);
  });

  it('holds a language to two to five characters, and leaves it unset when omitted', () => {
    expect(
      PlatformConfigSchema.safeParse(config({ language: 'hi' })).success,
    ).toBe(true);
    expect(
      PlatformConfigSchema.safeParse(config({ language: 'e' })).success,
    ).toBe(false);
    expect(
      PlatformConfigSchema.safeParse(config({ language: 'en-GB-x' })).success,
    ).toBe(false);
  });

  it('refuses platform settings of the wrong type, such as a non-uuid playlist', () => {
    expect(
      PlatformConfigSchema.safeParse(
        config({ platformSpecific: { playlistIds: ['not-a-uuid'] } }),
      ).success,
    ).toBe(false);
    expect(
      PlatformConfigSchema.safeParse(
        config({ platformSpecific: { privacy: 'everyone' } }),
      ).success,
    ).toBe(false);
  });

  it('needs at least one platform to publish', () => {
    expect(
      PublishToAllSchema.safeParse({ episodeId: EPISODE, platforms: [] })
        .success,
    ).toBe(false);
    expect(
      PublishToAllSchema.safeParse({
        episodeId: EPISODE,
        platforms: [config()],
      }).success,
    ).toBe(true);
  });
});

describe('scheduling', () => {
  it('publishes now when no time is given, or the time is null', () => {
    expect(PlatformConfigSchema.parse(config()).scheduledAt).toBeUndefined();
    expect(
      PlatformConfigSchema.parse(config({ scheduledAt: null })).scheduledAt,
    ).toBeNull();
  });

  it('reads a schedule as an ISO datetime', () => {
    expect(
      PlatformConfigSchema.parse(
        config({ scheduledAt: '2026-10-05T14:30:00Z' }),
      ).scheduledAt,
    ).toBe('2026-10-05T14:30:00Z');
    expect(
      PlatformConfigSchema.safeParse(
        config({ scheduledAt: '2026-10-05T14:30:00+05:30' }),
      ).success,
    ).toBe(false);
  });

  it('refuses a schedule that is only a date, or free text', () => {
    expect(
      PlatformConfigSchema.safeParse(config({ scheduledAt: '2026-10-05' }))
        .success,
    ).toBe(false);
    expect(
      PlatformConfigSchema.safeParse(config({ scheduledAt: 'tomorrow' }))
        .success,
    ).toBe(false);
  });
});
