import { describe, expect, it } from 'vitest';

import { UpdateChannelAnalyticsSettingsSchema } from '../src/lib/schemas/settings.schema';

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
