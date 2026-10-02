'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ChannelExperimentResults,
  ExperimentMeasure,
  FormatFamily,
  ViewsDenominator,
} from '@kit/clickhouse';
import {
  compareStyles,
  evidenceKindOf,
  isExperimentMeasure,
  platformIdOfDim,
  resolveAssetDuration,
  resolveFormatFamily,
  viewFormatOf,
  viewsDenominatorFor,
} from '@kit/clickhouse';
import {
  queryChannelExperimentVideoDays,
  queryRetentionCurves,
} from '@kit/clickhouse/server';
import { enhanceAction } from '@kit/next/actions';
import { fetchAllRows } from '@kit/shared/pagination';
import type { Json } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ActionRefusal } from '../lib/action-result';
import { assertCallerToday } from '../lib/caller-date';
import {
  longestCheckpoint,
  measureExperimentVideo,
} from '../lib/channel-experiment-measures';
import {
  AbandonChannelExperimentSchema,
  AddExperimentStyleSchema,
  AssignExperimentVideoSchema,
  ChannelExperimentIdSchema,
  ConcludeChannelExperimentSchema,
  CreateChannelExperimentSchema,
  ListChannelExperimentsSchema,
  RemoveExperimentStyleSchema,
  StartChannelExperimentSchema,
  UnassignExperimentVideoSchema,
} from '../lib/schemas/channel-experiment.schema';
import { withRefusals } from './with-refusals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/**
 * Codes the table refuses with, each a sentence written for the user in the
 * migration (20261001114902). Production redacts thrown text, so a refusal
 * travels as an `ActionRefusal` value (FILM-1610 G1); anything else is a
 * failure and is logged.
 */
const TABLE_REFUSALS: Record<string, string | null> = {
  P0001: null,
  '23514': null,
  '23503': null,
  '23505': 'This video is already in the experiment.',
  '42501':
    'You cannot make this change: it needs a writing role on the video’s project, in this experiment’s account.',
};

function refuseOrThrow(
  error: { code?: string; message: string } | null,
  what: string,
): void {
  if (!error) return;

  if (error.code && Object.hasOwn(TABLE_REFUSALS, error.code)) {
    throw new ActionRefusal(TABLE_REFUSALS[error.code] ?? error.message);
  }

  throw new Error(`Failed to ${what}: ${error.message}`);
}

const blankToNull = (value?: string | null) => (value?.trim() ? value : null);

export interface ChannelExperimentRow {
  id: string;
  account_id: string;
  connection_id: string;
  format_family: string;
  title: string;
  hypothesis: string | null;
  expected_outcome: string | null;
  conclusion: string | null;
  outcome_status: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  time_zone: string;
  measures: string[];
  result_snapshot: unknown;
  created_at: string;
}

async function readExperiment(
  client: Client,
  experimentId: string,
): Promise<ChannelExperimentRow> {
  const { data, error } = await client
    .from('channel_experiments')
    .select('*')
    .eq('id', experimentId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read the experiment: ${error.message}`);
  if (!data)
    throw new ActionRefusal('Experiment not found, or you cannot see it.');

  return data as ChannelExperimentRow;
}

/**
 * A lifecycle write applied only if the experiment is still in `from` when
 * the row is written, as FILM-1610's `updateIfStatus`: two tabs cannot both
 * conclude it.
 */
async function updateIfStatus(
  client: Client,
  experimentId: string,
  from: string[],
  payload: Record<string, unknown>,
  what: string,
): Promise<void> {
  const { data, error } = await client
    .from('channel_experiments')
    .update(payload)
    .eq('id', experimentId)
    .in('status', from)
    .select('id');

  refuseOrThrow(error, what);

  if (!data || data.length === 0) {
    throw new ActionRefusal(
      `This experiment changed before it could ${what}. Reload and try again.`,
    );
  }
}

interface StyleRow {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
}

async function readStyles(client: Client, experimentId: string) {
  const { data, error } = await client
    .from('channel_experiment_styles')
    .select('id, name, description, sort_order')
    .eq('experiment_id', experimentId)
    .order('sort_order');

  if (error) throw new Error(`Failed to read the styles: ${error.message}`);

  return (data ?? []) as StyleRow[];
}

export interface AssignedVideo {
  publishId: string;
  styleId: string;
  overridden: boolean;
  suggestedStyleId: string | null;
  assignedAt: string;
  title: string | null;
  platform: string;
  contentType: string;
  durationSeconds: number | null;
  publishedAt: string;
}

interface EmbeddedPublish {
  title: string | null;
  platform: string;
  content_type: string;
  duration_seconds: number | null;
  published_at: string | null;
}

interface AssignedRow {
  publish_id: string;
  style_id: string;
  overridden: boolean;
  suggested_style_id: string | null;
  assigned_at: string;
  // A many-to-one embed is one object; the client's inference says array.
  publishes: EmbeddedPublish | EmbeddedPublish[] | null;
}

const embedded = (value: AssignedRow['publishes']) =>
  Array.isArray(value) ? (value[0] ?? null) : value;

/**
 * Every assignment, paged: the results are a median over them, and a
 * truncated read would be a smaller experiment with no error (max_rows).
 */
async function readAssignments(
  client: Client,
  experimentId: string,
): Promise<AssignedVideo[]> {
  const rows = await fetchAllRows<AssignedRow>(
    (from, to) =>
      client
        .from('channel_experiment_videos')
        .select(
          'publish_id, style_id, overridden, suggested_style_id, assigned_at, publishes!inner(title, platform, content_type, duration_seconds, published_at)',
        )
        .eq('experiment_id', experimentId)
        .order('publish_id')
        .range(from, to),
    'experiment videos',
  );

  return rows.map((row) => {
    const publish = embedded(row.publishes);

    return {
      publishId: row.publish_id,
      styleId: row.style_id,
      overridden: row.overridden,
      suggestedStyleId: row.suggested_style_id,
      assignedAt: row.assigned_at,
      title: publish?.title ?? null,
      platform: publish?.platform ?? '',
      contentType: publish?.content_type ?? '',
      durationSeconds: publish?.duration_seconds ?? null,
      publishedAt: publish?.published_at ?? '',
    };
  });
}

function measuresOf(row: ChannelExperimentRow): ExperimentMeasure[] {
  return row.measures.filter(isExperimentMeasure);
}

/** The views series the whole experiment is counted on (FILM-1722). */
function viewsSeriesFor(
  platform: string,
  family: FormatFamily,
  from: string,
  to: string,
): ViewsDenominator {
  const id = platformIdOfDim(platform);

  if (!id) return { kind: 'suppressed', reason: 'no_single_view_definition' };

  return viewsDenominatorFor(id, from, to < from ? from : to, {
    format: viewFormatOf(family),
  });
}

export type ResultsState =
  | { kind: 'not_started' }
  /** ClickHouse is off: nothing is known, which is not zero. */
  | { kind: 'analytics_off' }
  | { kind: 'live'; results: ChannelExperimentResults }
  | { kind: 'frozen'; results: ChannelExperimentResults };

/** The styles compared now, from ClickHouse. */
async function computeResults(
  client: Client,
  experiment: ChannelExperimentRow,
  styles: StyleRow[],
  videos: AssignedVideo[],
  asOf = new Date(),
): Promise<ChannelExperimentResults | null> {
  const measures = measuresOf(experiment);
  const family = experiment.format_family as FormatFamily;
  const videoIds = videos.map((video) => video.publishId);

  const [days, curves, connection] = await Promise.all([
    queryChannelExperimentVideoDays({
      accountId: experiment.account_id,
      connectionId: experiment.connection_id,
      videoIds,
      maxAgeDays: longestCheckpoint(measures),
    }),
    measures.includes('hook_retention_3s')
      ? queryRetentionCurves({ videoIds })
      : Promise.resolve(new Map()),
    client
      .from('platform_connections')
      .select('platform')
      .eq('id', experiment.connection_id)
      .maybeSingle(),
  ]);

  if (!days) return null;
  if (connection.error) {
    throw new Error(`Failed to read the channel: ${connection.error.message}`);
  }

  const views = viewsSeriesFor(
    connection.data?.platform ?? '',
    family,
    experiment.started_at ?? asOf.toISOString().slice(0, 10),
    asOf.toISOString().slice(0, 10),
  );

  return compareStyles({
    styles,
    measures,
    asOf,
    videos: videos.map((video) =>
      measureExperimentVideo(
        {
          ...video,
          facts: days.videos.get(video.publishId),
          curve: curves.get(video.publishId),
        },
        {
          formatFamily: family,
          measures,
          asOf,
          channelIngestStart: days.channelIngestStart,
          views,
        },
      ),
    ),
  });
}

export const listChannelExperimentsAction = enhanceAction(
  async ({ accountId }) => {
    const client = getSupabaseServerClient();

    return fetchAllRows<{
      id: string;
      title: string;
      status: string;
      format_family: string;
      connection_id: string;
      started_at: string | null;
      ended_at: string | null;
      created_at: string;
    }>(
      (from, to) =>
        client
          .from('channel_experiments')
          .select(
            'id, title, status, format_family, connection_id, started_at, ended_at, created_at',
          )
          .eq('account_id', accountId)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      'channel experiments',
    );
  },
  { schema: ListChannelExperimentsSchema, auth: true },
);

export const getChannelExperimentAction = withRefusals(
  'load the experiment',
  enhanceAction(
    async ({ experimentId }) => {
      const client = getSupabaseServerClient();
      const experiment = await readExperiment(client, experimentId);
      const [styles, videos] = await Promise.all([
        readStyles(client, experimentId),
        readAssignments(client, experimentId),
      ]);

      let suggestedStyleId: string | null = null;

      if (experiment.status === 'running') {
        // The table's own rule (channel_experiment_suggested_style): what
        // the page suggests is what the assignment will record.
        const { data, error } = await client.rpc(
          'channel_experiment_suggested_style',
          { p_experiment_id: experimentId },
        );
        refuseOrThrow(error, 'read the suggested style');
        suggestedStyleId = (data as string | null) ?? null;
      }

      let results: ResultsState;

      if (experiment.status === 'planned') {
        results = { kind: 'not_started' };
      } else if (experiment.status === 'concluded') {
        results = {
          kind: 'frozen',
          results: experiment.result_snapshot as ChannelExperimentResults,
        };
      } else {
        const live = await computeResults(client, experiment, styles, videos);
        results = live
          ? { kind: 'live', results: live }
          : { kind: 'analytics_off' };
      }

      const counts = new Map<string, number>();
      for (const video of videos) {
        counts.set(video.styleId, (counts.get(video.styleId) ?? 0) + 1);
      }

      return {
        experiment,
        styles: styles.map((style) => ({
          ...style,
          videoCount: counts.get(style.id) ?? 0,
        })),
        videos,
        suggestedStyleId,
        results,
        evidence: evidenceKindOf(experiment.status),
      };
    },
    { schema: ChannelExperimentIdSchema, auth: true },
  ),
);

export const createChannelExperimentAction = withRefusals(
  'create the experiment',
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();

      const { data: id, error } = await client.rpc(
        'create_channel_experiment',
        {
          p_account_id: data.accountId,
          p_connection_id: data.connectionId,
          p_format_family: data.formatFamily,
          p_title: data.title,
          p_hypothesis: blankToNull(data.hypothesis) as string,
          p_expected_outcome: blankToNull(data.expectedOutcome) as string,
          p_measures: data.measures,
          p_time_zone: data.timeZone,
          p_styles: data.styles.map((style) => ({
            name: style.name,
            description: style.description ?? '',
          })) as unknown as Json,
        },
      );

      if (error?.code === '23503') {
        throw new ActionRefusal('That channel is not in this account.');
      }
      refuseOrThrow(error, 'create the experiment');

      return { id: id as string };
    },
    { schema: CreateChannelExperimentSchema, auth: true },
  ),
);

export const startChannelExperimentAction = withRefusals(
  'start the experiment',
  enhanceAction(
    async ({ experimentId, startedAt }) => {
      assertCallerToday(startedAt);
      const client = getSupabaseServerClient();
      const experiment = await readExperiment(client, experimentId);

      if (experiment.status !== 'planned') {
        throw new ActionRefusal(
          `Only a planned experiment can be started; this one is ${experiment.status}.`,
        );
      }

      await updateIfStatus(
        client,
        experimentId,
        ['planned'],
        { status: 'running', started_at: startedAt },
        'start',
      );

      return { success: true };
    },
    { schema: StartChannelExperimentSchema, auth: true },
  ),
);

export const addExperimentStyleAction = withRefusals(
  'add the style',
  enhanceAction(
    async ({ experimentId, name, description }) => {
      const client = getSupabaseServerClient();
      const styles = await readStyles(client, experimentId);

      const { error } = await client.from('channel_experiment_styles').insert({
        experiment_id: experimentId,
        name,
        description: blankToNull(description),
        sort_order:
          Math.max(-1, ...styles.map((style) => style.sort_order)) + 1,
      });

      if (error?.code === '23505') {
        throw new ActionRefusal('Each style needs its own name.');
      }
      refuseOrThrow(error, 'add the style');

      return { success: true };
    },
    { schema: AddExperimentStyleSchema, auth: true },
  ),
);

export const removeExperimentStyleAction = withRefusals(
  'remove the style',
  enhanceAction(
    async ({ experimentId, styleId }) => {
      const client = getSupabaseServerClient();

      const { data, error } = await client
        .from('channel_experiment_styles')
        .delete()
        .eq('id', styleId)
        .eq('experiment_id', experimentId)
        .select('id');

      refuseOrThrow(error, 'remove the style');

      if (!data || data.length === 0) {
        throw new ActionRefusal(
          'Nothing was removed: the style was not found.',
        );
      }

      return { success: true };
    },
    { schema: RemoveExperimentStyleSchema, auth: true },
  ),
);

export const assignExperimentVideoAction = withRefusals(
  'assign the video',
  enhanceAction(
    async ({ experimentId, publishId, styleId }) => {
      const client = getSupabaseServerClient();
      const experiment = await readExperiment(client, experimentId);

      // The suggestion and whether this overrode it are the table's; the
      // channel is copied from the experiment by the same trigger.
      const { data, error } = await client
        .from('channel_experiment_videos')
        .insert({
          experiment_id: experimentId,
          publish_id: publishId,
          style_id: styleId,
          connection_id: experiment.connection_id,
        })
        .select('overridden, suggested_style_id')
        .single();

      refuseOrThrow(error, 'assign the video');

      return {
        overridden: (data as { overridden: boolean }).overridden,
        suggestedStyleId: (data as { suggested_style_id: string | null })
          .suggested_style_id,
      };
    },
    { schema: AssignExperimentVideoSchema, auth: true },
  ),
);

export const unassignExperimentVideoAction = withRefusals(
  'remove the video',
  enhanceAction(
    async ({ experimentId, publishId }) => {
      const client = getSupabaseServerClient();

      const { data, error } = await client
        .from('channel_experiment_videos')
        .delete()
        .eq('experiment_id', experimentId)
        .eq('publish_id', publishId)
        .select('publish_id');

      refuseOrThrow(error, 'remove the video');

      if (!data || data.length === 0) {
        throw new ActionRefusal(
          'Nothing was removed: the video is not in this experiment.',
        );
      }

      return { success: true };
    },
    { schema: UnassignExperimentVideoSchema, auth: true },
  ),
);

/** `YYYY-MM-DD` of an instant in a zone. */
function localDateIn(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;

  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Videos that can join the experiment now: published on its channel on or
 * after its start (by the creator's calendar), in its format family, and
 * not in it yet. The table refuses any other; this keeps the list to the
 * ones it would accept. Newest first, at most 100.
 */
export const listAssignableVideosAction = withRefusals(
  'list the videos',
  enhanceAction(
    async ({ experimentId }) => {
      const client = getSupabaseServerClient();
      const experiment = await readExperiment(client, experimentId);

      if (experiment.status !== 'running' || !experiment.started_at) return [];

      // A day of margin either side of the zone, then the exact date below.
      const from = new Date(`${experiment.started_at}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 1);

      const [rows, assigned] = await Promise.all([
        fetchAllRows<{
          id: string;
          title: string | null;
          platform: string;
          content_type: string;
          duration_seconds: number | null;
          published_at: string | null;
        }>(
          (start, end) =>
            client
              .from('publishes')
              .select(
                'id, title, platform, content_type, duration_seconds, published_at',
              )
              .eq('platform_connection_id', experiment.connection_id)
              .eq('status', 'published')
              .gte('published_at', from.toISOString())
              .order('id')
              .range(start, end),
          'assignable videos',
        ),
        readAssignments(client, experimentId),
      ]);

      const taken = new Set(assigned.map((video) => video.publishId));

      return rows
        .filter(
          (row): row is typeof row & { published_at: string } =>
            row.published_at !== null && !taken.has(row.id),
        )
        .filter(
          (row) =>
            localDateIn(row.published_at, experiment.time_zone) >=
            experiment.started_at!,
        )
        .filter((row) => {
          const family = resolveFormatFamily({
            platform: row.platform,
            contentType: row.content_type,
            assetDuration: resolveAssetDuration(row.duration_seconds),
          });

          return family.ok && family.family === experiment.format_family;
        })
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
        .slice(0, 100)
        .map((row) => ({
          id: row.id,
          title: row.title,
          publishedAt: row.published_at,
        }));
    },
    { schema: ChannelExperimentIdSchema, auth: true },
  ),
);

/**
 * Ends the experiment with what the user concluded, and freezes the
 * per-style results as they stand. A concluded experiment is the evidence
 * FILM-1717 may cite, so it shows the figures it was concluded on, not a
 * later re-read.
 */
export const concludeChannelExperimentAction = withRefusals(
  'conclude the experiment',
  enhanceAction(
    async ({ experimentId, conclusion, outcomeStatus, endedAt }) => {
      assertCallerToday(endedAt);
      const client = getSupabaseServerClient();
      const experiment = await readExperiment(client, experimentId);

      if (experiment.status !== 'running') {
        throw new ActionRefusal(
          `Only a running experiment can be concluded; this one is ${experiment.status}.`,
        );
      }

      if (experiment.started_at && endedAt < experiment.started_at) {
        throw new ActionRefusal(
          `An experiment cannot end (${endedAt}) before it started (${experiment.started_at}).`,
        );
      }

      const [styles, videos] = await Promise.all([
        readStyles(client, experimentId),
        readAssignments(client, experimentId),
      ]);
      const results = await computeResults(client, experiment, styles, videos);

      if (!results) {
        throw new ActionRefusal(
          'Analytics are not available right now, so the results cannot be recorded. Try again later.',
        );
      }

      await updateIfStatus(
        client,
        experimentId,
        ['running'],
        {
          status: 'concluded',
          ended_at: endedAt,
          conclusion,
          outcome_status: outcomeStatus,
          result_snapshot: results as unknown as Json,
        },
        'conclude',
      );

      return { success: true };
    },
    { schema: ConcludeChannelExperimentSchema, auth: true },
  ),
);

export const abandonChannelExperimentAction = withRefusals(
  'abandon the experiment',
  enhanceAction(
    async ({ experimentId, reason, endedAt }) => {
      assertCallerToday(endedAt);
      const client = getSupabaseServerClient();
      const experiment = await readExperiment(client, experimentId);

      if (experiment.status !== 'planned' && experiment.status !== 'running') {
        throw new ActionRefusal(
          `Only a planned or running experiment can be abandoned; this one is ${experiment.status}.`,
        );
      }

      await updateIfStatus(
        client,
        experimentId,
        ['planned', 'running'],
        {
          status: 'abandoned',
          ended_at:
            experiment.started_at && endedAt < experiment.started_at
              ? experiment.started_at
              : endedAt,
          conclusion: blankToNull(reason),
          outcome_status: 'inconclusive',
        },
        'abandon',
      );

      return { success: true };
    },
    { schema: AbandonChannelExperimentSchema, auth: true },
  ),
);

export const deleteChannelExperimentAction = withRefusals(
  'delete the experiment',
  enhanceAction(
    async ({ experimentId }) => {
      const client = getSupabaseServerClient();

      const { data, error } = await client
        .from('channel_experiments')
        .delete()
        .eq('id', experimentId)
        .in('status', ['planned', 'abandoned'])
        .select('id');

      refuseOrThrow(error, 'delete the experiment');

      // The delete policy refuses a running or concluded one by matching
      // nothing, so the rows say what happened.
      if (!data || data.length === 0) {
        throw new ActionRefusal(
          'Only a planned or abandoned experiment can be deleted. A running one is abandoned first; a concluded one is kept as the record.',
        );
      }

      return { success: true };
    },
    { schema: ChannelExperimentIdSchema, auth: true },
  ),
);
