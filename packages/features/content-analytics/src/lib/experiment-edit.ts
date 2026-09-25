/**
 * Editing a Change log entry (KB-7): the stored row into form values, and
 * the form's values back into the smallest update that says what changed.
 *
 * Pure, so the rules that decide what a save sends are tested without a
 * browser. Only what changed is sent because the action refuses a frozen
 * field it is sent at all — changed or not — once the change has started.
 */
import type { z } from 'zod';

import { frozenFields } from './experiment-transitions';
import {
  type CreateExperimentSchema,
  ExperimentCategorySchema,
  WatchedMetricSchema,
} from './schemas/experiment.schema';

export type ExperimentFormValues = z.infer<typeof CreateExperimentSchema>;

/** A change as `getExperimentAction` returns it, the fields the form edits. */
export interface EditableExperiment {
  id: string;
  account_id: string;
  project_id: string | null;
  title: string;
  hypothesis: string | null;
  change_description: string;
  expected_outcome: string | null;
  category: string | null;
  metric_watched: string | null;
  review_window_days: number;
  notes: string | null;
  connection_id: string | null;
  status: string;
  publishes: Array<{
    publish_id: string;
    publishes: {
      title: string | null;
      platform: string;
      published_at: string | null;
    } | null;
  }>;
  tags: Array<{
    tag_id: string;
    content_tags: { dimension: string; slug: string; label: string } | null;
  }>;
}

/** The update the form sends: the id, then only the fields that changed. */
export interface ExperimentUpdate {
  experimentId: string;
  title?: string;
  hypothesis?: string;
  changeDescription?: string;
  expectedOutcome?: string;
  category?: ExperimentFormValues['category'] | null;
  metricWatched?: ExperimentFormValues['metricWatched'] | null;
  reviewWindowDays?: number;
  notes?: string | null;
  connectionId?: string | null;
  publishIds?: string[];
  tagIds?: string[];
}

export function toFormValues(
  experiment: EditableExperiment,
): ExperimentFormValues {
  // A stored value the form no longer offers shows as none: kept, it would
  // fail the form's own schema and block saving anything else.
  const category = ExperimentCategorySchema.safeParse(experiment.category);
  const metric = WatchedMetricSchema.safeParse(experiment.metric_watched);

  return {
    accountId: experiment.account_id,
    projectId: experiment.project_id ?? undefined,
    title: experiment.title,
    hypothesis: experiment.hypothesis ?? '',
    changeDescription: experiment.change_description,
    expectedOutcome: experiment.expected_outcome ?? '',
    category: category.success ? category.data : undefined,
    metricWatched: metric.success ? metric.data : undefined,
    reviewWindowDays: experiment.review_window_days,
    notes: experiment.notes ?? '',
    connectionId: experiment.connection_id ?? undefined,
    publishIds: experiment.publishes.map((link) => link.publish_id),
    tagIds: experiment.tags.map((link) => link.tag_id),
  };
}

const sameSet = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && a.every((id) => b.includes(id));

export function toUpdatePayload(
  experimentId: string,
  status: string,
  initial: ExperimentFormValues,
  values: ExperimentFormValues,
): ExperimentUpdate {
  const frozen = frozenFields(status);
  const open = (field: keyof ExperimentUpdate) => !frozen.includes(field);
  const update: ExperimentUpdate = { experimentId };

  if (values.title !== initial.title) update.title = values.title;
  if (values.changeDescription !== initial.changeDescription) {
    update.changeDescription = values.changeDescription;
  }
  if (open('hypothesis') && values.hypothesis !== initial.hypothesis) {
    update.hypothesis = values.hypothesis;
  }
  if (
    open('expectedOutcome') &&
    values.expectedOutcome !== initial.expectedOutcome
  ) {
    update.expectedOutcome = values.expectedOutcome;
  }
  // `null` clears a select; `undefined` would leave the stored value alone.
  if (values.category !== initial.category) {
    update.category = values.category ?? null;
  }
  if (open('metricWatched') && values.metricWatched !== initial.metricWatched) {
    update.metricWatched = values.metricWatched ?? null;
  }
  if (
    open('reviewWindowDays') &&
    values.reviewWindowDays !== initial.reviewWindowDays
  ) {
    update.reviewWindowDays = values.reviewWindowDays;
  }
  if (values.notes !== initial.notes) {
    update.notes = values.notes?.trim() ? values.notes : null;
  }
  if (values.connectionId !== initial.connectionId) {
    update.connectionId = values.connectionId ?? null;
  }
  if (open('publishIds') && !sameSet(values.publishIds, initial.publishIds)) {
    update.publishIds = values.publishIds;
  }
  if (!sameSet(values.tagIds, initial.tagIds)) {
    update.tagIds = values.tagIds;
  }

  return update;
}
