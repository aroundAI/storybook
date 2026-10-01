import { z } from 'zod';

import {
  EXPERIMENT_MEASURES,
  EXPERIMENT_MEASURE_DEFINITIONS,
  FORMAT_FAMILIES,
} from '@kit/clickhouse';

/**
 * Channel experiments (FILM-1724). Shared by the server actions and the
 * page's forms; the table holds every rule here as well, because PostgREST
 * is reachable without them.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A calendar date');

/** An IANA zone this runtime knows; Postgres checks it again. */
export const TimeZoneSchema = z.string().refine(
  (zone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'An unknown time zone' },
);

/** `live` is in FILM-1716's vocabulary but nothing maps to it yet. */
export const ExperimentFormatFamilySchema = z.enum(
  FORMAT_FAMILIES.filter((family) => family !== 'live') as [
    string,
    ...string[],
  ],
);

export const ExperimentMeasureSchema = z.enum(EXPERIMENT_MEASURES);

export const ExperimentStyleInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the style').max(80),
  description: z.string().trim().max(500).optional(),
});

export const MIN_STYLES = 2;
export const MAX_STYLES = 8;

export const CreateChannelExperimentSchema = z
  .object({
    accountId: z.string().uuid(),
    connectionId: z.string().uuid({ message: 'Choose a channel' }),
    formatFamily: ExperimentFormatFamilySchema,
    title: z.string().trim().min(1, 'Give the experiment a title').max(200),
    hypothesis: z.string().trim().max(2000).optional(),
    expectedOutcome: z.string().trim().max(2000).optional(),
    measures: z
      .array(ExperimentMeasureSchema)
      .min(1, 'Choose at least one measure'),
    timeZone: TimeZoneSchema,
    styles: z
      .array(ExperimentStyleInputSchema)
      .min(MIN_STYLES, `At least ${MIN_STYLES} styles`)
      .max(MAX_STYLES, `At most ${MAX_STYLES} styles`),
  })
  .superRefine((value, context) => {
    const names = value.styles.map((style) => style.name.trim().toLowerCase());
    names.forEach((name, index) => {
      if (name && names.indexOf(name) !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['styles', index, 'name'],
          message: 'Each style needs its own name',
        });
      }
    });

    for (const measure of value.measures) {
      const families = EXPERIMENT_MEASURE_DEFINITIONS[measure].families;
      if (families && !families.includes(value.formatFamily as never)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measures'],
          message: `${EXPERIMENT_MEASURE_DEFINITIONS[measure].label} is only for short-form`,
        });
      }
    }
  });

export type CreateChannelExperimentInput = z.input<
  typeof CreateChannelExperimentSchema
>;

const experimentId = z.string().uuid();

export const ChannelExperimentIdSchema = z.object({ experimentId });

export const ListChannelExperimentsSchema = z.object({
  accountId: z.string().uuid(),
});

export const StartChannelExperimentSchema = z.object({
  experimentId,
  /** The caller's own calendar day (FILM-1610 E1). */
  startedAt: date,
});

export const AddExperimentStyleSchema = z.object({
  experimentId,
  name: z.string().trim().min(1, 'Name the style').max(80),
  description: z.string().trim().max(500).optional(),
});

export const RemoveExperimentStyleSchema = z.object({
  experimentId,
  styleId: z.string().uuid(),
});

export const AssignExperimentVideoSchema = z.object({
  experimentId,
  publishId: z.string().uuid({ message: 'Choose a video' }),
  styleId: z.string().uuid({ message: 'Choose a style' }),
});

export const UnassignExperimentVideoSchema = z.object({
  experimentId,
  publishId: z.string().uuid(),
});

export const ConcludeChannelExperimentSchema = z.object({
  experimentId,
  conclusion: z.string().trim().min(1, 'Say what you concluded').max(5000),
  outcomeStatus: z.enum(['confirmed', 'rejected', 'inconclusive']),
  endedAt: date,
});

export const AbandonChannelExperimentSchema = z.object({
  experimentId,
  reason: z.string().trim().max(5000).optional(),
  endedAt: date,
});
