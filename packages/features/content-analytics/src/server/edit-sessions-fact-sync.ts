import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type EditSessionFactRow,
  insertEditSessionFacts,
  isClickHouseEnabled,
} from '@kit/clickhouse/server';
import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';

import { deriveEditStyle } from '../lib/edit-style';

/**
 * The analytics sync's edit-session rollup (FILM-2006): every delivered
 * StorybookStudio session becomes one row of ClickHouse's
 * `edit_sessions_fact`, through `deriveEditStyle`, so the fact says what
 * the Edit style card says.
 *
 * Hourly it resends the sessions delivered in the last
 * {@link EDIT_FACT_WINDOW_HOURS} hours; once a day (`full`) it resends
 * every delivered session, which backfills sessions delivered before this
 * shipped and any hour the job missed. Resending is safe: the table is a
 * ReplacingMergeTree keyed on the session, so a session is one row however
 * often it is written.
 *
 * Reads with the admin client the sync already holds; nothing it writes
 * leaves the analytics store, and ClickHouse readers scope by project.
 */
type Client = SupabaseClient<Database>;

/** Twice the hourly cadence, so one missed run loses nothing. */
export const EDIT_FACT_WINDOW_HOURS = 48;

export interface EditFactSyncResult {
  /** False when ClickHouse is off: nothing was read or written. */
  enabled: boolean;
  delivered: number;
  written: number;
  /** Delivered sessions whose summary holds no valid report. */
  skipped: number;
}

interface DeliveredSession {
  id: string;
  episode_id: string;
  delivered_at: string | null;
  summary: unknown;
}

interface EpisodeScope {
  id: string;
  project_id: string;
  target_duration_seconds: number | null;
  project: { account_id: string | null } | null;
}

function renderIdsOf(summary: unknown): string[] {
  const renders =
    summary && typeof summary === 'object'
      ? (summary as { renders?: unknown }).renders
      : null;

  if (!Array.isArray(renders)) return [];

  return renders
    .map((render) =>
      render && typeof render === 'object'
        ? (render as { renderId?: unknown }).renderId
        : null,
    )
    .filter((id): id is string => typeof id === 'string');
}

const sortedUnique = (values: string[]) => [...new Set(values)].sort();

export async function syncEditSessionFacts(
  client: Client,
  options: { now?: Date; full?: boolean } = {},
): Promise<EditFactSyncResult> {
  if (!isClickHouseEnabled()) {
    return { enabled: false, delivered: 0, written: 0, skipped: 0 };
  }

  const now = options.now ?? new Date();
  const since = new Date(
    now.getTime() - EDIT_FACT_WINDOW_HOURS * 3_600_000,
  ).toISOString();

  const sessions = await fetchAllRows<DeliveredSession>((from, to) => {
    let query = client
      .from('edit_sessions')
      .select('id, episode_id, delivered_at, summary')
      .eq('status', 'delivered');

    if (!options.full) query = query.gte('delivered_at', since);

    return query.order('id').range(from, to);
  }, 'edit_sessions');

  if (sessions.length === 0) {
    return { enabled: true, delivered: 0, written: 0, skipped: 0 };
  }

  const episodes = await fetchAllByIds<EpisodeScope>(
    sessions.map((session) => session.episode_id),
    (chunk, from, to) =>
      client
        .from('episodes')
        .select(
          'id, project_id, target_duration_seconds, project:projects(account_id)',
        )
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'episodes',
  );
  const episodeById = new Map(episodes.map((row) => [row.id, row]));

  const renders = await fetchAllByIds<{
    id: string;
    preset: string;
    language: string;
  }>(
    sessions.flatMap((session) => renderIdsOf(session.summary)),
    (chunk, from, to) =>
      client
        .from('episode_renders')
        .select('id, preset, language')
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'episode_renders',
  );
  const renderById = new Map(renders.map((row) => [row.id, row]));

  const rows: EditSessionFactRow[] = [];
  let skipped = 0;

  for (const session of sessions) {
    const episode = episodeById.get(session.episode_id);
    const accountId = episode?.project?.account_id ?? null;
    const style = deriveEditStyle({
      summary: session.summary,
      episodeTargetDurationSeconds: episode?.target_duration_seconds ?? null,
    });

    if (!episode || !accountId || !style || !session.delivered_at) {
      skipped += 1;
      continue;
    }

    const delivered = renderIdsOf(session.summary)
      .map((id) => renderById.get(id))
      .filter((render) => render !== undefined);

    rows.push({
      session_id: session.id,
      episode_id: episode.id,
      project_id: episode.project_id,
      account_id: accountId,
      delivered_at: session.delivered_at,
      final_duration: style.finalDuration,
      target_duration: style.targetDuration,
      ai_ops: style.aiOps,
      user_ops: style.userOps,
      plans_proposed: style.plansProposed,
      plans_approved: style.plansApproved,
      cut_count: style.cutCount,
      avg_shot_length: style.avgShotLength,
      hook_type: style.hookType,
      cuts_per_minute: style.cutsPerMinute,
      ai_share: style.aiShare,
      languages: sortedUnique(delivered.map((render) => render.language)),
      presets: sortedUnique(delivered.map((render) => render.preset)),
    });
  }

  await insertEditSessionFacts(rows);

  return {
    enabled: true,
    delivered: sessions.length,
    written: rows.length,
    skipped,
  };
}
