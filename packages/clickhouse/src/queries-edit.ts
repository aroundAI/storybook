/**
 * Edit style (FILM-2006): one row per delivered StorybookStudio edit
 * session in `edit_sessions_fact`, written by the analytics sync and read
 * by the genome's edit-style dimensions.
 */
import { mergeMapsByChunk } from './chunked';
import { getClickHouseClient, isClickHouseEnabled } from './client';
import type { EditStyleFigures } from './lib/genome-attributes';

/** One delivered session, as the rollup writes it. Null is "not recorded". */
export interface EditSessionFactRow {
  session_id: string;
  episode_id: string;
  project_id: string;
  account_id: string;
  /** ISO 8601 */
  delivered_at: string;
  final_duration: number;
  target_duration: number | null;
  ai_ops: number;
  user_ops: number;
  plans_proposed: number | null;
  plans_approved: number | null;
  cut_count: number | null;
  avg_shot_length: number | null;
  hook_type: string | null;
  cuts_per_minute: number | null;
  ai_share: number | null;
  languages: string[];
  presets: string[];
}

/** An episode's latest delivered edit. */
export interface EpisodeEditStyle {
  episodeId: string;
  sessionId: string;
  deliveredAt: string;
  finalDuration: number;
  targetDuration: number | null;
  aiOps: number;
  userOps: number;
  plansProposed: number | null;
  plansApproved: number | null;
  cutCount: number | null;
  avgShotLength: number | null;
  cutsPerMinute: number | null;
  hookType: string | null;
  aiShare: number | null;
  languages: string[];
  presets: string[];
}

/** `2026-10-04T10:00:00.000Z` → `2026-10-04 10:00:00.000`, DateTime64's input form. */
function toDateTime64(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`edit_sessions_fact: not a timestamp: ${iso}`);
  }

  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Upserts delivered sessions. Writing a session again replaces its row
 * (ReplacingMergeTree on `synced_at`), so the hourly rollup may resend.
 */
export async function insertEditSessionFacts(
  rows: EditSessionFactRow[],
): Promise<void> {
  if (rows.length === 0 || !isClickHouseEnabled()) return;

  const client = getClickHouseClient();

  await client.insert({
    table: 'edit_sessions_fact',
    values: rows.map((row) => ({
      ...row,
      delivered_at: toDateTime64(row.delivered_at),
    })),
    format: 'JSONEachRow',
  });
}

const nullableNumber = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);

/**
 * Each episode's latest delivered edit, keyed by episode id; an episode
 * with no delivered session is absent, not present with zeros.
 */
export async function queryEditStyleByEpisode(input: {
  episodeIds: string[];
  /** Bounds the read to the table's leading sort key. */
  projectIds?: string[];
}): Promise<Map<string, EpisodeEditStyle>> {
  if (input.episodeIds.length === 0 || !isClickHouseEnabled()) {
    return new Map();
  }

  return mergeMapsByChunk(input.episodeIds, (chunk) =>
    queryEditStyleChunk({ ...input, episodeIds: chunk }),
  );
}

async function queryEditStyleChunk(input: {
  episodeIds: string[];
  projectIds?: string[];
}): Promise<Map<string, EpisodeEditStyle>> {
  const client = getClickHouseClient();
  const params: Record<string, unknown> = { episodeIds: input.episodeIds };
  const conditions = ['episode_id IN {episodeIds: Array(UUID)}'];

  if (input.projectIds?.length) {
    conditions.push('project_id IN {projectIds: Array(UUID)}');
    params.projectIds = input.projectIds;
  }

  // The latest delivery per episode; ties on delivered_at break on the
  // session id so the answer does not depend on part order. Output aliases
  // are prefixed: an alias named like a column shadows it inside the
  // aggregates, which ClickHouse refuses.
  const result = await client.query({
    query: `
      SELECT
        toString(episode_id) as out_episode_id,
        toString(argMax(session_id, k)) as out_session_id,
        formatDateTime(max(delivered_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC') as out_delivered_at,
        argMax(final_duration, k) as out_final_duration,
        argMax(target_duration, k) as out_target_duration,
        argMax(ai_ops, k) as out_ai_ops,
        argMax(user_ops, k) as out_user_ops,
        argMax(plans_proposed, k) as out_plans_proposed,
        argMax(plans_approved, k) as out_plans_approved,
        argMax(cut_count, k) as out_cut_count,
        argMax(avg_shot_length, k) as out_avg_shot_length,
        argMax(hook_type, k) as out_hook_type,
        argMax(cuts_per_minute, k) as out_cuts_per_minute,
        argMax(ai_share, k) as out_ai_share,
        argMax(languages, k) as out_languages,
        argMax(presets, k) as out_presets
      FROM (
        SELECT *, (delivered_at, session_id) as k
        FROM edit_sessions_fact FINAL
        WHERE ${conditions.join(' AND ')}
      )
      GROUP BY episode_id
    `,
    query_params: params,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    out_episode_id: string;
    out_session_id: string;
    out_delivered_at: string;
    out_final_duration: number;
    out_target_duration: number | null;
    out_ai_ops: number | string;
    out_user_ops: number | string;
    out_plans_proposed: number | string | null;
    out_plans_approved: number | string | null;
    out_cut_count: number | string | null;
    out_avg_shot_length: number | null;
    out_hook_type: string | null;
    out_cuts_per_minute: number | null;
    out_ai_share: number | null;
    out_languages: string[];
    out_presets: string[];
  }>();

  const styles = new Map<string, EpisodeEditStyle>();

  for (const row of rows) {
    styles.set(row.out_episode_id, {
      episodeId: row.out_episode_id,
      sessionId: row.out_session_id,
      deliveredAt: row.out_delivered_at,
      finalDuration: Number(row.out_final_duration),
      targetDuration: nullableNumber(row.out_target_duration),
      aiOps: Number(row.out_ai_ops),
      userOps: Number(row.out_user_ops),
      plansProposed: nullableNumber(row.out_plans_proposed),
      plansApproved: nullableNumber(row.out_plans_approved),
      cutCount: nullableNumber(row.out_cut_count),
      avgShotLength: nullableNumber(row.out_avg_shot_length),
      cutsPerMinute: nullableNumber(row.out_cuts_per_minute),
      hookType: row.out_hook_type ?? null,
      aiShare: nullableNumber(row.out_ai_share),
      languages: row.out_languages ?? [],
      presets: row.out_presets ?? [],
    });
  }

  return styles;
}

/**
 * The genome's optional edit-style dimensions (FILM-2006): for each video,
 * the edit style of its episode's latest delivered StorybookStudio session.
 * The episode comes from `video_dim` (latest row per video). A video whose
 * episode was never delivered from the Studio is absent, so it gains no
 * attribute rather than a zero band.
 */
export async function queryEditStyleForVideos(input: {
  videoIds: string[];
  /**
   * The tenant: both reads are bounded to its rows. The fact table holds a
   * row per delivered session, so the account filter is a small read.
   */
  accountId: string;
}): Promise<Map<string, EditStyleFigures>> {
  if (input.videoIds.length === 0 || !isClickHouseEnabled()) {
    return new Map();
  }

  return mergeMapsByChunk(input.videoIds, (chunk) =>
    queryEditStyleForVideosChunk({ ...input, videoIds: chunk }),
  );
}

async function queryEditStyleForVideosChunk(input: {
  videoIds: string[];
  accountId: string;
}): Promise<Map<string, EditStyleFigures>> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        v.vid as out_video_id,
        f.cpm as out_cuts_per_minute,
        f.asl as out_avg_shot_length,
        f.hook as out_hook_type,
        f.share as out_ai_share
      FROM (
        SELECT video_id as vid, argMax(episode_id, updated_at) as ep
        FROM video_dim
        WHERE video_id IN {videoIds: Array(String)}
          AND account_id = {accountId: UUID}
        GROUP BY video_id
      ) v
      INNER JOIN (
        SELECT
          episode_id as ep,
          argMax(cuts_per_minute, (delivered_at, session_id)) as cpm,
          argMax(avg_shot_length, (delivered_at, session_id)) as asl,
          argMax(hook_type, (delivered_at, session_id)) as hook,
          argMax(ai_share, (delivered_at, session_id)) as share
        FROM edit_sessions_fact FINAL
        WHERE account_id = {accountId: UUID}
        GROUP BY episode_id
      ) f ON f.ep = v.ep
    `,
    query_params: { videoIds: input.videoIds, accountId: input.accountId },
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    out_video_id: string;
    out_cuts_per_minute: number | null;
    out_avg_shot_length: number | null;
    out_hook_type: string | null;
    out_ai_share: number | null;
  }>();

  return new Map(
    rows.map((row) => [
      row.out_video_id,
      {
        cutsPerMinute: nullableNumber(row.out_cuts_per_minute),
        avgShotLength: nullableNumber(row.out_avg_shot_length),
        hookType: row.out_hook_type ?? null,
        aiShare: nullableNumber(row.out_ai_share),
      },
    ]),
  );
}
