import { describe, expect, it } from 'vitest';

import {
  UpdateAccountAnalyticsSettingsSchema,
  UpdateChannelAnalyticsSettingsSchema,
  latestJoinDate,
} from '../src/lib/schemas/settings.schema';

const base = {
  connectionId: '00000000-0000-4000-8000-0000000000c1',
  yppTargetWatchHours: null,
  yppTargetSubscribers: null,
  yppApplicantStatus: 'unknown' as const,
};

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('UpdateChannelAnalyticsSettingsSchema joinedYppAt', () => {
  it('accepts today and a past date', () => {
    for (const joinedYppAt of [isoDaysFromNow(0), '2025-01-15']) {
      expect(
        UpdateChannelAnalyticsSettingsSchema.safeParse({ ...base, joinedYppAt })
          .success,
      ).toBe(true);
    }
  });

  it('accepts clearing the date', () => {
    expect(
      UpdateChannelAnalyticsSettingsSchema.safeParse({
        ...base,
        joinedYppAt: null,
      }).success,
    ).toBe(true);
  });

  // One day of slack for users ahead of UTC, whose local today is UTC's
  // tomorrow; beyond that the date has not happened anywhere.
  it('accepts tomorrow in UTC but rejects anything later', () => {
    expect(
      UpdateChannelAnalyticsSettingsSchema.safeParse({
        ...base,
        joinedYppAt: isoDaysFromNow(1),
      }).success,
    ).toBe(true);

    const later = UpdateChannelAnalyticsSettingsSchema.safeParse({
      ...base,
      joinedYppAt: isoDaysFromNow(2),
    });

    expect(later.success).toBe(false);
    expect(later.error?.issues[0]?.message).toBe(
      "Joined date can't be in the future",
    );
  });

  it('rejects a date that does not exist', () => {
    for (const joinedYppAt of ['2026-13-45', '2026-02-30']) {
      expect(
        UpdateChannelAnalyticsSettingsSchema.safeParse({ ...base, joinedYppAt })
          .success,
      ).toBe(false);
    }
  });
});

describe('UpdateAccountAnalyticsSettingsSchema tagMinSample', () => {
  const account = {
    accountId: '00000000-0000-4000-8000-0000000000a1',
    yppTargetWatchHours: null,
    yppTargetSubscribers: null,
  };

  it('accepts up to 1000, and blank', () => {
    for (const tagMinSample of [1, 1000, null]) {
      expect(
        UpdateAccountAnalyticsSettingsSchema.safeParse({
          ...account,
          tagMinSample,
        }).success,
      ).toBe(true);
    }
  });

  it('refuses more than 1000', () => {
    const result = UpdateAccountAnalyticsSettingsSchema.safeParse({
      ...account,
      tagMinSample: 1001,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Use 1000 or fewer — a higher minimum hides every segment',
    );
  });
});

describe('latestJoinDate', () => {
  it('is tomorrow in UTC', () => {
    expect(latestJoinDate(new Date('2026-09-17T23:30:00.000Z'))).toBe(
      '2026-09-18',
    );
  });

  it('rolls over a month and a year end', () => {
    expect(latestJoinDate(new Date('2026-09-30T08:00:00.000Z'))).toBe(
      '2026-10-01',
    );
    expect(latestJoinDate(new Date('2026-12-31T12:00:00.000Z'))).toBe(
      '2027-01-01',
    );
  });

  // The UTC+10 case: 08:00 local on the 18th is 22:00 UTC on the 17th. The
  // user's today is the 18th, which is exactly the cutoff.
  it('covers a user ahead of UTC entering their local today', () => {
    expect(latestJoinDate(new Date('2026-09-17T22:00:00.000Z'))).toBe(
      '2026-09-18',
    );
  });
});
