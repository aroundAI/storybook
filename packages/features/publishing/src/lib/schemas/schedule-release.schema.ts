/**
 * FILM-719, FILM-2209. A release scheduled on its channels' cadence, and the cadence a
 * channel posts on. Shared by the actions and the forms that call them.
 */
import { z } from 'zod';

import { SLOT_TIME_PATTERN, isValidTimeZone } from '../cadence/cadence';
import { PlatformConfigSchema } from './publish.schema';

const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'Choose a timezone from the list.');

export const CadenceTargetSchema = PlatformConfigSchema.omit({
  platform: true,
  scheduledAt: true,
}).extend({
  key: z.string().min(1).max(200),
});

/**
 * FILM-2210. A breaking release: the long video now (or at `at`), its
 * Shorts at the front of each channel's queue with extra times a day
 */
export const BreakingSchema = z.object({
  at: z.string().datetime({ offset: true }).optional(),
  boost: z
    .object({
      extraPerDay: z.coerce.number().int().min(0).max(4),
      days: z.coerce.number().int().min(1).max(7),
    })
    .optional(),
  startAfterHours: z.coerce.number().min(0).max(48).optional(),
});

export const ScheduleReleaseSchema = z.object({
  episodeId: z.string().uuid(),
  targets: z.array(CadenceTargetSchema).min(1).max(200),
  notBefore: z.string().datetime(),
  timezone: TimeZoneSchema,
  aiGenerated: z.boolean().optional(),
  breaking: BreakingSchema.optional(),
  /** KB-204, previews only: the long video goes out now */
  longGoesAt: z.string().datetime().optional(),
});

export const BreakingReleaseSchema = ScheduleReleaseSchema.extend({
  breaking: BreakingSchema,
});

/** FILM-2210: the Publish screen's Breaking news form */
export const BreakingFormSchema = z
  .object({
    when: z.enum(['now', 'at']),
    /** A datetime-local value, in the browser's zone */
    at: z.string(),
    extraPerDay: z.coerce
      .number()
      .int()
      .min(0, 'No fewer than 0 extra Shorts.')
      .max(4, 'At most 4 extra Shorts a day.'),
    days: z.coerce
      .number()
      .int()
      .min(1, 'At least 1 day.')
      .max(7, 'At most 7 days.'),
  })
  .refine(
    (value) =>
      value.when === 'now' || new Date(value.at).getTime() > Date.now(),
    { message: 'Choose a time in the future.', path: ['at'] },
  );

/** FILM-2211: the Schedule page cancels one scheduled post */
export const CancelScheduledPublishSchema = z.object({
  publishId: z.string().uuid(),
});

/**
 * FILM-2213. A scheduled post's time, changed in place: one post, or an
 * episode's long video on every channel it is scheduled to
 */
export const ReschedulePublishSchema = z
  .object({
    publishId: z.string().uuid().optional(),
    episodeId: z.string().uuid().optional(),
    contentType: z.literal('full').optional(),
    scheduledAt: z.string().datetime({ offset: true }),
    ignoreCadence: z.boolean().optional(),
    note: z.string().max(500).optional(),
    timezone: TimeZoneSchema.optional(),
  })
  .refine((value) => !!value.publishId !== !!value.episodeId, {
    message: 'Name the post, or the episode, not both.',
    path: ['publishId'],
  })
  .refine((value) => !value.episodeId || value.contentType === 'full', {
    message: 'An episode moves its long video: contentType full.',
    path: ['contentType'],
  });

/** FILM-2213. Every post not yet due on a project's channels, laid again */
export const ReplanScheduleSchema = z.object({
  projectId: z.string().uuid(),
  from: z.string().datetime({ offset: true }).optional(),
  dryRun: z.boolean(),
  timezone: TimeZoneSchema.optional(),
});

/** FILM-2213. The Schedule tab's Change time form */
export const ChangeTimeFormSchema = z.object({
  /** A datetime-local value, in the browser's zone */
  at: z
    .string()
    .min(1, 'Choose a date and time.')
    .refine(
      (value) => !Number.isNaN(new Date(value).getTime()),
      'Choose a date and time.',
    ),
  allPlatforms: z.boolean(),
  ignoreCadence: z.boolean(),
  note: z.string().max(500, 'Keep the note under 500 characters.'),
});

export const HeldShortsSchema = z.object({
  publishIds: z.array(z.string().uuid()).min(1).max(200),
  timezone: TimeZoneSchema,
});

export const ChannelCadenceSchema = z
  .object({
    connectionId: z.string().uuid(),
    contentType: z.enum(['full', 'short']),
    timezone: TimeZoneSchema,
    slotTimes: z
      .array(z.string().regex(SLOT_TIME_PATTERN, 'Use a time like 18:00.'))
      .min(1, 'Add at least one posting time.')
      .max(6, 'At most six posting times a day.'),
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .min(1, 'Choose at least one day.'),
    minDaysBetween: z.coerce.number().int().min(0).max(30),
    everyNDays: z.coerce.number().int().min(1).max(30),
    startAfterHours: z.coerce.number().int().min(0).max(168),
    jitterMinutes: z.coerce.number().int().min(0).max(120),
    enabled: z.boolean(),
  })
  .refine((value) => new Set(value.slotTimes).size === value.slotTimes.length, {
    message: 'Each posting time is listed once.',
    path: ['slotTimes'],
  })
  .refine((value) => value.contentType === 'short' || value.everyNDays === 1, {
    message:
      'Every N days is for Shorts; long videos use the days between them.',
    path: ['everyNDays'],
  });

export const ChannelCadencesQuerySchema = z.object({
  connectionIds: z.array(z.string().uuid()).min(1).max(100),
});

export type ScheduleReleaseInput = z.infer<typeof ScheduleReleaseSchema>;
export type CadenceTargetInput = z.infer<typeof CadenceTargetSchema>;
export type ChannelCadenceInput = z.infer<typeof ChannelCadenceSchema>;
export type BreakingInput = z.infer<typeof BreakingSchema>;
export type BreakingFormValues = z.infer<typeof BreakingFormSchema>;
export type ReschedulePublishInput = z.infer<typeof ReschedulePublishSchema>;
export type ChangeTimeFormValues = z.infer<typeof ChangeTimeFormSchema>;
