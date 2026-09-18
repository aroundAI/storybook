import { z } from 'zod';

import { WATCHED_METRIC_KEYS } from '../watched-metrics';

export const ExperimentStatusSchema = z.enum([
  'planned',
  'running',
  'concluded',
  'abandoned',
]);

export const ExperimentOutcomeSchema = z.enum([
  'pending',
  'confirmed',
  'rejected',
  'inconclusive',
]);

/**
 * What kind of change an experiment tests. A closed list for the form;
 * stored as unconstrained varchar so adding one needs no migration.
 */
export const ExperimentCategorySchema = z.enum([
  'packaging',
  'hook',
  'length',
  'format',
  'topic',
  'schedule',
  'other',
]);

export type ExperimentCategoryKey = z.infer<typeof ExperimentCategorySchema>;

/** Display labels, shared by the form and the detail view. */
export const EXPERIMENT_CATEGORY_LABELS: Record<ExperimentCategoryKey, string> =
  {
    packaging: 'Packaging (title, thumbnail)',
    hook: 'Hook / opening',
    length: 'Length',
    format: 'Format',
    topic: 'Topic',
    schedule: 'Schedule',
    other: 'Other',
  };

/** A stored category's label; an unrecognised one shows as stored. */
export function categoryLabel(category: string): string {
  return Object.hasOwn(EXPERIMENT_CATEGORY_LABELS, category)
    ? EXPERIMENT_CATEGORY_LABELS[category as ExperimentCategoryKey]
    : category;
}

export const WatchedMetricSchema = z.enum(WATCHED_METRIC_KEYS);

export const DEFAULT_REVIEW_WINDOW_DAYS = 60;

/** Days an experiment runs before review; the table enforces the same bounds. */
export const ReviewWindowDaysSchema = z
  .number({ invalid_type_error: 'Enter a number of days' })
  .int('Whole days only')
  .min(1, 'At least 1 day')
  .max(365, 'At most 365 days');

export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;
export type ExperimentCategory = z.infer<typeof ExperimentCategorySchema>;
export type ExperimentOutcome = z.infer<typeof ExperimentOutcomeSchema>;

export const CreateExperimentSchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  hypothesis: z.string().max(2000).optional(),
  changeDescription: z.string().min(1).max(2000),
  expectedOutcome: z.string().max(2000).optional(),
  category: ExperimentCategorySchema.optional(),
  metricWatched: WatchedMetricSchema.optional(),
  reviewWindowDays: ReviewWindowDaysSchema.default(DEFAULT_REVIEW_WINDOW_DAYS),
  notes: z.string().max(5000).optional(),
  connectionId: z.string().uuid().optional(),
  publishIds: z.array(z.string().uuid()).max(200).default([]),
  tagIds: z.array(z.string().uuid()).max(50).default([]),
});

export const UpdateExperimentSchema = z.object({
  experimentId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  hypothesis: z.string().max(2000).optional(),
  changeDescription: z.string().min(1).max(2000).optional(),
  expectedOutcome: z.string().max(2000).optional(),
  /** `null` clears the field; `undefined` leaves it alone. */
  category: ExperimentCategorySchema.nullable().optional(),
  metricWatched: WatchedMetricSchema.nullable().optional(),
  reviewWindowDays: ReviewWindowDaysSchema.optional(),
  notes: z.string().max(5000).nullable().optional(),
  connectionId: z.string().uuid().nullable().optional(),
  publishIds: z.array(z.string().uuid()).max(200).optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});

export const StartExperimentSchema = z.object({
  experimentId: z.string().uuid(),
  /** Defaults to today. */
  startedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const ConcludeExperimentSchema = z.object({
  experimentId: z.string().uuid(),
  /** What actually happened — required, since that is the point of the log. */
  actualOutcome: z.string().min(1).max(2000),
  outcomeStatus: ExperimentOutcomeSchema.exclude(['pending']),
  endedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const AbandonExperimentSchema = z.object({
  experimentId: z.string().uuid(),
  reason: z.string().max(2000).optional(),
});

export const ListExperimentsSchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  status: ExperimentStatusSchema.optional(),
});

export const GetExperimentSchema = z.object({
  experimentId: z.string().uuid(),
});

export const DeleteExperimentSchema = z.object({
  experimentId: z.string().uuid(),
});

export const ListExperimentsDueSchema = z.object({
  accountId: z.string().uuid(),
  /**
   * The caller's local date. "Due today" is a calendar question, and the
   * server's UTC date is a day off for anyone far enough from UTC.
   */
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const ListLinkablePublishesSchema = z.object({
  accountId: z.string().uuid(),
});
