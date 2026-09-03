'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { queryTotalsByVideoIds } from '@kit/clickhouse/server';
import type { AggregatedTotals } from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import type { Json } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  AbandonExperimentSchema,
  ConcludeExperimentSchema,
  CreateExperimentSchema,
  DeleteExperimentSchema,
  GetExperimentSchema,
  ListExperimentsSchema,
  StartExperimentSchema,
  UpdateExperimentSchema,
} from '../lib/schemas/experiment.schema';

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/** Metric totals captured for an experiment at a point in time. */
export interface ExperimentSnapshot {
  capturedAt: string;
  publishCount: number;
  totals: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    watchTimeSeconds: number;
    revenueCents: number;
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Sums ClickHouse totals for an experiment's linked publishes, so a
 * before/after comparison exists without the user recording numbers by
 * hand.
 */
async function captureSnapshot(
  publishIds: string[],
): Promise<ExperimentSnapshot> {
  const totals = {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    watchTimeSeconds: 0,
    revenueCents: 0,
  };

  if (publishIds.length > 0) {
    const perVideo = await queryTotalsByVideoIds(publishIds);

    for (const stats of perVideo.values() as Iterable<AggregatedTotals>) {
      totals.views += stats.views;
      totals.likes += stats.likes;
      totals.comments += stats.comments;
      totals.shares += stats.shares;
      totals.watchTimeSeconds += stats.watch_time_seconds;
      totals.revenueCents += stats.revenue_cents;
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    publishCount: publishIds.length,
    totals,
  };
}

async function linkedPublishIds(
  client: Client,
  experimentId: string,
): Promise<string[]> {
  const { data } = await client
    .from('experiment_publishes')
    .select('publish_id')
    .eq('experiment_id', experimentId);

  return (data ?? []).map((row) => row.publish_id);
}

async function replaceLinks(
  client: Client,
  experimentId: string,
  publishIds?: string[],
  tagIds?: string[],
): Promise<void> {
  if (publishIds) {
    await client
      .from('experiment_publishes')
      .delete()
      .eq('experiment_id', experimentId);

    if (publishIds.length > 0) {
      await client.from('experiment_publishes').insert(
        publishIds.map((publishId) => ({
          experiment_id: experimentId,
          publish_id: publishId,
        })),
      );
    }
  }

  if (tagIds) {
    await client
      .from('experiment_tags')
      .delete()
      .eq('experiment_id', experimentId);

    if (tagIds.length > 0) {
      await client.from('experiment_tags').insert(
        tagIds.map((tagId) => ({
          experiment_id: experimentId,
          tag_id: tagId,
        })),
      );
    }
  }
}

export const createExperimentAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    const { data: experiment, error } = await client
      .from('analytics_experiments')
      .insert({
        account_id: data.accountId,
        project_id: data.projectId ?? null,
        title: data.title,
        hypothesis: data.hypothesis ?? null,
        change_description: data.changeDescription,
        expected_outcome: data.expectedOutcome ?? null,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error || !experiment) {
      throw new Error(`Failed to create experiment: ${error?.message}`);
    }

    await replaceLinks(client, experiment.id, data.publishIds, data.tagIds);

    return { id: experiment.id };
  },
  { schema: CreateExperimentSchema, auth: true },
);

export const updateExperimentAction = enhanceAction(
  async ({ experimentId, publishIds, tagIds, ...fields }) => {
    const client = getSupabaseServerClient();

    const updates: Record<string, unknown> = {};
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.hypothesis !== undefined) updates.hypothesis = fields.hypothesis;
    if (fields.changeDescription !== undefined)
      updates.change_description = fields.changeDescription;
    if (fields.expectedOutcome !== undefined)
      updates.expected_outcome = fields.expectedOutcome;

    if (Object.keys(updates).length > 0) {
      const { error } = await client
        .from('analytics_experiments')
        .update(updates)
        .eq('id', experimentId);

      if (error) {
        throw new Error(`Failed to update experiment: ${error.message}`);
      }
    }

    await replaceLinks(client, experimentId, publishIds, tagIds);

    return { success: true };
  },
  { schema: UpdateExperimentSchema, auth: true },
);

/**
 * Marks an experiment running and snapshots the linked content's metrics
 * as the baseline to compare against later.
 */
export const startExperimentAction = enhanceAction(
  async ({ experimentId, startedAt }) => {
    const client = getSupabaseServerClient();

    const publishIds = await linkedPublishIds(client, experimentId);
    const baseline = await captureSnapshot(publishIds);

    const { error } = await client
      .from('analytics_experiments')
      .update({
        status: 'running',
        started_at: startedAt ?? today(),
        baseline_metrics: baseline as unknown as Json,
      })
      .eq('id', experimentId);

    if (error) {
      throw new Error(`Failed to start experiment: ${error.message}`);
    }

    return { success: true, baseline };
  },
  { schema: StartExperimentSchema, auth: true },
);

/**
 * Concludes an experiment, snapshotting results. The actual outcome is
 * required — an experiment without a recorded result teaches nothing.
 */
export const concludeExperimentAction = enhanceAction(
  async ({ experimentId, actualOutcome, outcomeStatus, endedAt }) => {
    const client = getSupabaseServerClient();

    const publishIds = await linkedPublishIds(client, experimentId);
    const result = await captureSnapshot(publishIds);

    const { error } = await client
      .from('analytics_experiments')
      .update({
        status: 'concluded',
        ended_at: endedAt ?? today(),
        actual_outcome: actualOutcome,
        outcome_status: outcomeStatus,
        result_metrics: result as unknown as Json,
      })
      .eq('id', experimentId);

    if (error) {
      throw new Error(`Failed to conclude experiment: ${error.message}`);
    }

    return { success: true, result };
  },
  { schema: ConcludeExperimentSchema, auth: true },
);

export const abandonExperimentAction = enhanceAction(
  async ({ experimentId, reason }) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('analytics_experiments')
      .update({
        status: 'abandoned',
        ended_at: today(),
        actual_outcome: reason ?? null,
        outcome_status: 'inconclusive',
      })
      .eq('id', experimentId);

    if (error) {
      throw new Error(`Failed to abandon experiment: ${error.message}`);
    }

    return { success: true };
  },
  { schema: AbandonExperimentSchema, auth: true },
);

export const listExperimentsAction = enhanceAction(
  async ({ accountId, projectId, status }) => {
    const client = getSupabaseServerClient();

    let query = client
      .from('analytics_experiments')
      .select(
        'id, title, hypothesis, status, outcome_status, started_at, ended_at, created_at, project_id',
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (projectId) query = query.eq('project_id', projectId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list experiments: ${error.message}`);
    }

    return data ?? [];
  },
  { schema: ListExperimentsSchema, auth: true },
);

export const getExperimentAction = enhanceAction(
  async ({ experimentId }) => {
    const client = getSupabaseServerClient();

    const { data: experiment, error } = await client
      .from('analytics_experiments')
      .select('*')
      .eq('id', experimentId)
      .single();

    if (error || !experiment) {
      throw new Error('Experiment not found or access denied');
    }

    const [{ data: publishes }, { data: tags }] = await Promise.all([
      client
        .from('experiment_publishes')
        .select('publish_id, publishes!inner(title, platform, published_at)')
        .eq('experiment_id', experimentId),
      client
        .from('experiment_tags')
        .select('tag_id, content_tags!inner(dimension, slug, label)')
        .eq('experiment_id', experimentId),
    ]);

    return {
      ...experiment,
      publishes: publishes ?? [],
      tags: tags ?? [],
    };
  },
  { schema: GetExperimentSchema, auth: true },
);

export const deleteExperimentAction = enhanceAction(
  async ({ experimentId }) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('analytics_experiments')
      .delete()
      .eq('id', experimentId);

    if (error) {
      throw new Error(`Failed to delete experiment: ${error.message}`);
    }

    return { success: true };
  },
  { schema: DeleteExperimentSchema, auth: true },
);
