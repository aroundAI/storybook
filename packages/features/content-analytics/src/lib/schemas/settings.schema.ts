/**
 * Analytics settings, account-wide and per channel (FILM-1608).
 *
 * One schema per level, shared by the server actions and the forms. Two
 * schemas for the two sides is how `publishId: ''` reached a
 * `z.string().uuid().optional()` in FILM-1609 and made a form unsubmittable
 * while every type checked.
 */
import { z } from 'zod';

import { MAX_TAG_MIN_SAMPLE, YPP_APPLICANT_STATUSES } from '../ypp-targets';

/**
 * The latest joined date anyone can mean: tomorrow in UTC, since for a user
 * ahead of UTC their local today already is UTC's tomorrow. A date after it
 * has not happened anywhere.
 *
 * One bound for both sides — the schema refuses dates after it, and
 * `resolveYppTarget` counts dates up to it as joined — so a date the form
 * accepts is never one the cards still treat as upcoming.
 */
export function latestJoinDate(now: Date = new Date()): string {
  const tomorrow = new Date(now);

  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  return tomorrow.toISOString().slice(0, 10);
}

/**
 * A target, or `null` for "inherit".
 *
 * `.nullable()` and not `.optional()`: absent and null mean different things
 * here. Null is a value the form submits and the action writes, and it is the
 * only way to clear an override once set.
 *
 * `.positive()` because every one of these is a denominator — a target of
 * zero renders as 100% complete against a bar of nothing. The ceiling is
 * Postgres' `integer`: without it the insert fails with `value out of range`,
 * which reaches the user as a redacted server-action error, a save that fails
 * with nothing actionable in it.
 */
const OptionalTarget = z
  .number()
  .int()
  .positive('Enter a whole number greater than zero, or leave blank to inherit')
  .max(2_147_483_647, 'That number is too large to store')
  .nullable();

export const YppApplicantStatusSchema = z.enum(YPP_APPLICANT_STATUSES);

export const GetAnalyticsSettingsSchema = z.object({
  accountId: z.string().uuid(),
});

export const UpdateAccountAnalyticsSettingsSchema = z.object({
  accountId: z.string().uuid(),
  yppTargetWatchHours: OptionalTarget,
  yppTargetSubscribers: OptionalTarget,
  tagMinSample: OptionalTarget.refine(
    (value) => value === null || value <= MAX_TAG_MIN_SAMPLE,
    `Use ${MAX_TAG_MIN_SAMPLE} or fewer — a higher minimum hides every segment`,
  ),
});

/**
 * Note what is *not* here: `accountId`.
 *
 * The account a channel override belongs to is derived server-side from the
 * connection row. Accepting it from the caller would mean RLS checks the
 * value written rather than the value implied by `connectionId`, so every
 * call site would need its own guard against the two disagreeing — a hole
 * that has to be re-closed forever instead of once. Not offering the field
 * removes the class.
 */
export const UpdateChannelAnalyticsSettingsSchema = z.object({
  connectionId: z.string().uuid(),
  yppTargetWatchHours: OptionalTarget,
  yppTargetSubscribers: OptionalTarget,
  yppApplicantStatus: YppApplicantStatusSchema,
  joinedYppAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
    // The regex alone admits 2026-13-45; a real date survives a round trip.
    .refine(
      (value) => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return (
          !Number.isNaN(date.getTime()) &&
          date.toISOString().slice(0, 10) === value
        );
      },
      { message: 'Invalid date' },
    )
    .refine((value) => value <= latestJoinDate(), {
      message: "Joined date can't be in the future",
    })
    .nullable(),
});

export type UpdateAccountAnalyticsSettingsInput = z.infer<
  typeof UpdateAccountAnalyticsSettingsSchema
>;

export type UpdateChannelAnalyticsSettingsInput = z.infer<
  typeof UpdateChannelAnalyticsSettingsSchema
>;
