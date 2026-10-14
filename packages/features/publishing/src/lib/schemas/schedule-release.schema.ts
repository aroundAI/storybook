/**
 * FILM-719. A release scheduled on its channels' cadence, and the cadence a
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

export const ScheduleReleaseSchema = z.object({
  episodeId: z.string().uuid(),
  targets: z.array(CadenceTargetSchema).min(1).max(200),
  notBefore: z.string().datetime(),
  timezone: TimeZoneSchema,
  aiGenerated: z.boolean().optional(),
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
    startAfterHours: z.coerce.number().int().min(0).max(168),
    jitterMinutes: z.coerce.number().int().min(0).max(120),
    enabled: z.boolean(),
  })
  .refine((value) => new Set(value.slotTimes).size === value.slotTimes.length, {
    message: 'Each posting time is listed once.',
    path: ['slotTimes'],
  });

export const ChannelCadencesQuerySchema = z.object({
  connectionIds: z.array(z.string().uuid()).min(1).max(100),
});

export type ScheduleReleaseInput = z.infer<typeof ScheduleReleaseSchema>;
export type CadenceTargetInput = z.infer<typeof CadenceTargetSchema>;
export type ChannelCadenceInput = z.infer<typeof ChannelCadenceSchema>;
