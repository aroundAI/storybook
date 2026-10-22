import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ActionRefusal } from '@kit/next/action-result';
import { fetchAllByIds } from '@kit/shared/pagination';
import type { Database, Json } from '@kit/supabase/database';

import { type ChannelCadenceRow, HORIZON_DAYS } from '../lib/cadence/cadence';
import { planReplan } from '../lib/cadence/plan-replan';
import { PLATFORM_NAMES, isPlatform } from '../lib/platforms';
import {
  type ScheduleChangeVia,
  manualTimeOf,
  scheduleHistoryOf,
} from '../lib/schedule-history';
import type { ChannelCadenceInput } from '../lib/schemas/schedule-release.schema';
import { youtubeStagingOf } from '../lib/youtube-staging';
import { cadenceRefusal } from './cadence-guard.service';
import {
  ON_CALENDAR,
  cadenceOfRows,
  contentTypeOf,
  readCadences,
  readCalendar,
} from './channel-calendar';
import { getProjectChannelIds } from './project-channels';
import { saveChannelCadence } from './schedule-release.service';
import { moveStagedPublishAt } from './youtube-staged.service';

/**
 * FILM-2213. A scheduled post's time changes in place, and new posting
 * rules re-plan what is already scheduled (owner, 2026-10-22: "I am going
 * to change everything that's scheduled from now on. I did a bulk schedule
 * before.").
 *
 * - `reschedulePublishes` moves one post, or every scheduled long-video
 *   post of an episode together, to a chosen time. The channel's posting
 *   rules are checked first; `ignoreCadence` posts past them and marks the
 *   post `manualTime`, which re-plans leave alone. A long video's Shorts,
 *   and the Shorts queued behind them, are laid again on the channel's
 *   queue behind its new time.
 * - `replanChannels` / `replanSchedule` lay every post not yet due again
 *   on the channels' current rules (planReplan). Saving posting rules runs
 *   it for that channel.
 *
 * Every move is written by reschedule_publishes in one call, rows updated
 * in place (title, tags, thumbnail and Shorts group kept), each with an
 * entry in `metadata.scheduleHistory`. A post uploaded to YouTube ahead of
 * its time (KB-214) is moved on YouTube first, so its old time cannot
 * fire; a refusal there moves nothing.
 */

type Client = SupabaseClient<Database>;

type Result<T> = { ok: true; data: T } | { ok: false; refusal: string };

/** A post this close to going out stays where it is */
export const SETTLED_WITHIN_MS = 15 * 60_000;

/** The calendar changed between planning and writing */
const CALENDAR_CHANGED = new Set(['23505', '55000']);

const DETAIL_COLUMNS =
  'id, episode_id, platform, platform_connection_id, content_type, status, slot_at, scheduled_at, metadata, title, release_priority, episodes!inner(number, title, deleted_at)';

interface Detail {
  id: string;
  episode_id: string;
  platform: string;
  platform_connection_id: string | null;
  content_type: string;
  status: string;
  slot_at: string | null;
  scheduled_at: string | null;
  metadata: unknown;
  title: string | null;
  release_priority: string;
  episodes: {
    number: number | null;
    title: string | null;
    deleted_at: string | null;
  };
}

export interface ScheduleMoveView {
  publishId: string;
  episodeId: string;
  /** "Ep 3 · Title" */
  episode: string;
  platform: string;
  connectionId: string | null;
  kind: 'long' | 'short';
  title: string | null;
  from: string;
  to: string;
}

export interface NotMoved {
  publishId: string;
  reason: string;
}

/** "Ep 3 · Title, YouTube Short: why" */
function notMovedOf(
  row: Detail | undefined,
  publishId: string,
  reason: string,
) {
  return {
    publishId,
    reason: row
      ? `${episodeLabel(row)} ${isPlatform(row.platform) ? PLATFORM_NAMES[row.platform] : row.platform} ${contentTypeOf(row) === 'short' ? 'Short' : 'long video'}: ${reason}`
      : reason,
  };
}

export interface RescheduleInput {
  publishId?: string;
  /** With contentType 'full': every scheduled long-video post of the episode */
  episodeId?: string;
  contentType?: 'full';
  /** ISO time with an offset */
  scheduledAt: string;
  ignoreCadence?: boolean;
  note?: string | null;
  /** The zone a channel with no posting rules of its own counts days in */
  timezone?: string;
}

export interface RescheduleResult {
  dryRun: boolean;
  moves: ScheduleMoveView[];
  /** The posting rules' refusal, which `ignoreCadence` overrides */
  cadenceRefusal: string | null;
  manualTime: boolean;
}

export interface ReplanResult {
  dryRun: boolean;
  moves: ScheduleMoveView[];
  /** Posts that stay where they were, and why */
  notMoved: NotMoved[];
}

interface Actor {
  userId: string;
  via: ScheduleChangeVia;
  note?: string | null;
}

interface PlannedMove {
  row: Detail;
  slotAt: Date | null;
  scheduledAt: Date;
  manualTime?: boolean;
}

function episodeLabel(row: Detail) {
  const number = row.episodes.number;
  const title = row.episodes.title;

  return [number !== null ? `Ep ${number}` : null, title]
    .filter(Boolean)
    .join(' · ');
}

function viewOf(move: PlannedMove): ScheduleMoveView {
  return {
    publishId: move.row.id,
    episodeId: move.row.episode_id,
    episode: episodeLabel(move.row),
    platform: move.row.platform,
    connectionId: move.row.platform_connection_id,
    kind: contentTypeOf(move.row) === 'short' ? 'short' : 'long',
    title: move.row.title,
    from: move.row.scheduled_at ?? move.row.slot_at ?? '',
    to: move.scheduledAt.toISOString(),
  };
}

const byTo = (a: ScheduleMoveView, b: ScheduleMoveView) =>
  a.to.localeCompare(b.to) || a.publishId.localeCompare(b.publishId);

function goesAt(row: Detail) {
  return new Date(row.scheduled_at ?? row.slot_at ?? 0);
}

/** Why a post that is not scheduled cannot move, in words */
export function notScheduledRefusal(status: string) {
  switch (status) {
    case 'published':
      return 'It has already gone out, so its time cannot change.';
    case 'queued':
    case 'publishing':
      return 'It is being posted right now, so its time cannot change.';
    case 'failed':
      return 'It failed to post. Publish it again from the Publish screen rather than moving it.';
    default:
      return `It is ${status}, not scheduled, so its time cannot change.`;
  }
}

async function readDetails(
  client: Client,
  column: 'id' | 'platform_connection_id' | 'episode_id',
  values: string[],
  statuses?: readonly string[],
) {
  return fetchAllByIds<Detail>(
    values,
    (chunk, from, to) => {
      const query = client
        .from('publishes')
        .select(DETAIL_COLUMNS)
        .in(column, chunk);

      return (statuses ? query.in('status', [...statuses]) : query)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{
        data: Detail[] | null;
        error: { message: string } | null;
      }>;
    },
    'scheduled posts',
  );
}

/** Every long video of these episodes, on any channel, where it goes */
async function readLongVideos(client: Client, episodeIds: string[]) {
  if (episodeIds.length === 0) return [];

  const rows = await fetchAllByIds<{
    id: string;
    episode_id: string;
    platform_connection_id: string | null;
    status: string;
    slot_at: string | null;
    scheduled_at: string | null;
    published_at: string | null;
  }>(
    episodeIds,
    (chunk, from, to) =>
      client
        .from('publishes')
        .select(
          'id, episode_id, platform_connection_id, status, slot_at, scheduled_at, published_at',
        )
        .in('episode_id', chunk)
        .eq('content_type', 'full')
        .in('status', [...ON_CALENDAR, 'published'])
        .order('id')
        .range(from, to),
    'episode long videos',
  );

  return rows.flatMap((row) => {
    const at = row.slot_at ?? row.scheduled_at ?? row.published_at;

    return at
      ? [
          {
            publishId: row.id,
            episodeId: row.episode_id,
            connectionId: row.platform_connection_id,
            at: new Date(at),
          },
        ]
      : [];
  });
}

/**
 * Whether a re-plan may move this post: scheduled, not due within
 * SETTLED_WITHIN_MS, not breaking, not a time chosen past the rules, and
 * not a YouTube upload that is public or goes public when ready
 */
function replannable(row: Detail, now: Date) {
  const staging = youtubeStagingOf(row.metadata);

  return (
    row.status === 'scheduled' &&
    !!row.platform_connection_id &&
    row.release_priority !== 'breaking' &&
    !manualTimeOf(row.metadata) &&
    goesAt(row).getTime() > now.getTime() + SETTLED_WITHIN_MS &&
    !staging?.wentPublicAt &&
    !staging?.goLiveWhenReady
  );
}

type ApplyOutcome =
  | { ok: true }
  | { ok: false; calendarChanged: true }
  | { ok: false; calendarChanged?: never; publishId: string; refusal: string };

/**
 * Writes the moves: YouTube first for a staged post, then every row in one
 * reschedule_publishes call with its history. A refusal anywhere moves
 * nothing, on YouTube or here.
 */
async function applyMoves(
  client: Client,
  moves: PlannedMove[],
  actor: Actor,
  now: Date,
): Promise<ApplyOutcome> {
  const movedOnYouTube: PlannedMove[] = [];

  const undoYouTube = async () => {
    for (const move of movedOnYouTube) {
      const staging = youtubeStagingOf(move.row.metadata);
      if (!staging) continue;

      // YouTube has the new time now; put the old one back
      await moveStagedPublishAt(
        {
          ...move.row,
          metadata: {
            youtube: { ...staging, publishAt: move.scheduledAt.toISOString() },
          },
        },
        staging.publishAt,
      );
    }
  };

  for (const move of moves) {
    const staging = youtubeStagingOf(move.row.metadata);
    if (move.row.platform !== 'youtube' || !staging) continue;

    const refusal = await moveStagedPublishAt(
      move.row,
      move.scheduledAt.toISOString(),
    );

    if (refusal) {
      await undoYouTube();
      return { ok: false, publishId: move.row.id, refusal };
    }

    movedOnYouTube.push(move);
  }

  const at = now.toISOString();
  const { error } = await client.rpc('reschedule_publishes', {
    p_moves: moves.map((move) => {
      const staging = youtubeStagingOf(move.row.metadata);
      const youtube =
        staging && movedOnYouTube.includes(move)
          ? (() => {
              const { error: _cleared, ...rest } = staging;
              return { ...rest, publishAt: move.scheduledAt.toISOString() };
            })()
          : undefined;

      return {
        id: move.row.id,
        slot_at: move.slotAt?.toISOString() ?? null,
        scheduled_at: move.scheduledAt.toISOString(),
        metadata: {
          scheduleHistory: [
            ...scheduleHistoryOf(move.row.metadata),
            {
              from: goesAt(move.row).toISOString(),
              to: move.scheduledAt.toISOString(),
              at,
              by: actor.userId,
              via: actor.via,
              note: actor.note?.trim() || null,
            },
          ],
          ...(move.manualTime ? { manualTime: true } : {}),
          ...(youtube ? { youtube } : {}),
        },
      };
    }) as unknown as Json,
    p_inserts: [],
  });

  if (error) {
    await undoYouTube();

    if (CALENDAR_CHANGED.has(error.code)) {
      return { ok: false, calendarChanged: true };
    }

    throw new Error(`Could not move the posts: ${error.message}`);
  }

  return { ok: true };
}

function refused<T>(error: unknown): Result<T> {
  if (error instanceof ActionRefusal) {
    return { ok: false, refusal: error.message };
  }

  throw error;
}

/** The hint after a posting-rules refusal, for the screen or the MCP */
function cadenceHint(via: ScheduleChangeVia) {
  return via === 'mcp'
    ? 'Choose a time the rules allow, or pass ignoreCadence: true to post at this time anyway; a re-plan then leaves it there.'
    : 'Choose a time the rules allow, or override the posting rules for this experiment; a re-plan then leaves it there.';
}

async function targetsOf(client: Client, input: RescheduleInput) {
  if (input.publishId) {
    const rows = await readDetails(client, 'id', [input.publishId]);
    const row = rows[0];

    if (!row) throw new ActionRefusal('That post was not found.');
    if (row.status !== 'scheduled') {
      throw new ActionRefusal(notScheduledRefusal(row.status));
    }

    return [row];
  }

  if (!input.episodeId || input.contentType !== 'full') {
    throw new ActionRefusal(
      'Name the post (publishId), or the episode with contentType full for its long video.',
    );
  }

  const rows = (await readDetails(client, 'episode_id', [input.episodeId]))
    .filter((row) => contentTypeOf(row) === 'full' && row.status !== 'deleted')
    .sort((a, b) => a.id.localeCompare(b.id));
  const scheduled = rows.filter((row) => row.status === 'scheduled');

  if (rows.length === 0) {
    throw new ActionRefusal('This episode has no long video scheduled.');
  }
  if (scheduled.length === 0) {
    throw new ActionRefusal(notScheduledRefusal(rows[0]!.status));
  }

  return scheduled;
}

/**
 * Moves one post, or an episode's long video on every channel, to a chosen
 * time. A dry run returns what would move and the posting rules' refusal,
 * writing nothing.
 */
export async function reschedulePublishes(
  client: Client,
  actor: Actor,
  input: RescheduleInput,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<Result<RescheduleResult>> {
  try {
    for (let attempt = 1; ; attempt++) {
      const now = options.now ?? new Date();
      const outcome = await rescheduleOnce(client, actor, input, {
        dryRun: !!options.dryRun,
        now,
      });

      if ('calendarChanged' in outcome) {
        if (attempt < 2) continue;
        throw new ActionRefusal(
          'The channel’s calendar changed while this move was planned. Try again.',
        );
      }

      return { ok: true, data: outcome };
    }
  } catch (error) {
    return refused(error);
  }
}

async function rescheduleOnce(
  client: Client,
  actor: Actor,
  input: RescheduleInput,
  options: { dryRun: boolean; now: Date },
): Promise<RescheduleResult | { calendarChanged: true }> {
  const { now } = options;
  const at = new Date(input.scheduledAt);

  if (
    Number.isNaN(at.getTime()) ||
    at.getTime() <= now.getTime() + SETTLED_WITHIN_MS
  ) {
    throw new ActionRefusal(
      'Choose a time at least 15 minutes from now: a post cannot move into the past, or so close to now that it may already be on its way.',
    );
  }

  const targets = await targetsOf(client, input);

  for (const row of targets) {
    const staging = youtubeStagingOf(row.metadata);

    if (staging?.wentPublicAt) {
      throw new ActionRefusal(
        'It is already public on YouTube, so its time cannot change.',
      );
    }
    if (staging?.goLiveWhenReady) {
      throw new ActionRefusal(
        'This breaking post goes public as soon as YouTube has it in HD; it has no time to change.',
      );
    }
    if (!row.platform_connection_id) {
      throw new ActionRefusal(
        'Its channel was disconnected, so it cannot be moved. Cancel it instead.',
      );
    }
  }

  const ids = targets.map((row) => row.id);
  const guard = await cadenceRefusal(
    client,
    targets.map((row) => ({
      connectionId: row.platform_connection_id!,
      contentType: contentTypeOf(row),
      at,
    })),
    {
      timezone: input.timezone,
      now,
      hint: cadenceHint(actor.via),
      exclude: ids,
      weekdays: true,
    },
  );

  if (guard && !input.ignoreCadence && !options.dryRun) {
    throw new ActionRefusal(guard);
  }

  const manualTime = !!input.ignoreCadence;
  const pinnedMoves: PlannedMove[] = targets.map((row) => ({
    row,
    // A time past the rules, or a breaking post's, holds no cadence slot
    slotAt: manualTime || row.release_priority === 'breaking' ? null : at,
    scheduledAt: at,
    manualTime,
  }));

  // A long video's Shorts, and those queued behind them, follow it
  const followers = targets.some((row) => contentTypeOf(row) === 'full')
    ? await shortsBehind(client, targets, at, input.timezone, now)
    : [];

  const moves = [...pinnedMoves, ...followers];
  const views = moves.map(viewOf).sort(byTo);

  if (options.dryRun) {
    return {
      dryRun: true,
      moves: views,
      cadenceRefusal: guard,
      manualTime,
    };
  }

  const applied = await applyMoves(client, moves, actor, now);

  if (!applied.ok && applied.calendarChanged) return { calendarChanged: true };
  if (!applied.ok) throw new ActionRefusal(applied.refusal);

  return { dryRun: false, moves: views, cadenceRefusal: null, manualTime };
}

/** The Shorts laid again behind long videos moved to `at` */
async function shortsBehind(
  client: Client,
  targets: Detail[],
  at: Date,
  timezone: string | undefined,
  now: Date,
): Promise<PlannedMove[]> {
  const connectionIds = [
    ...new Set(targets.map((row) => row.platform_connection_id!)),
  ];
  const from = new Date(
    Math.min(at.getTime(), ...targets.map((row) => goesAt(row).getTime())),
  );

  const [cadences, occupied, scheduled] = await Promise.all([
    readCadences(client, connectionIds),
    readCalendar(client, connectionIds, now),
    readDetails(client, 'platform_connection_id', connectionIds, ['scheduled']),
  ]);

  const movable = new Set(
    scheduled
      .filter(
        (row) =>
          contentTypeOf(row) === 'short' &&
          replannable(row, now) &&
          goesAt(row) >= from,
      )
      .map((row) => row.id),
  );

  const plan = planReplan({
    posts: occupied,
    movable,
    pinned: new Map(
      targets.map((row) => [row.id, { slotAt: at, scheduledAt: at }]),
    ),
    moveLongs: false,
    longVideos: await readLongVideos(client, [
      ...new Set(occupied.map((post) => post.episodeId)),
    ]),
    cadenceOf: cadenceOfRows(cadences, timezone ?? 'UTC'),
    from,
    now,
  });

  if (plan.unplaced.length) {
    throw new ActionRefusal(
      `No free Short time in the next ${HORIZON_DAYS} days for ${plan.unplaced.length} of the Shorts behind it. Add Short times or days to the channel’s posting rules.`,
    );
  }

  return plan.moves.map((move) => ({
    row: scheduled.find((row) => row.id === move.publishId)!,
    slotAt: move.slotAt,
    scheduledAt: move.scheduledAt,
  }));
}

export interface ReplanInput {
  connectionIds: string[];
  /** Nothing is laid earlier than this; now when absent */
  from?: string;
  dryRun: boolean;
  /** The zone a channel with no posting rules of its own posts in */
  timezone?: string;
  /** Rules not yet saved, used in their row's place: a preview of a save */
  cadenceOverride?: ChannelCadenceRow;
}

/** How often a re-plan is laid again after YouTube refuses one post */
const REPLAN_ATTEMPTS = 4;

/**
 * Lays every post not yet due on these channels again on their current
 * posting rules, or on `cadenceOverride`. A post YouTube refuses to move
 * stays, and the rest are planned around it; the result says which stayed
 * and why.
 */
export async function replanChannels(
  client: Client,
  actor: Actor,
  input: ReplanInput,
  options: { now?: Date } = {},
): Promise<Result<ReplanResult>> {
  try {
    const kept: NotMoved[] = [];
    let changed = 0;

    for (let attempt = 1; ; attempt++) {
      const now = options.now ?? new Date();
      const { moves, unplaced, rows } = await planChannels(
        client,
        input,
        now,
        new Set(kept.map((k) => k.publishId)),
      );
      const notMoved = [
        ...kept,
        ...unplaced.map((publishId) =>
          notMovedOf(
            rows.find((row) => row.id === publishId),
            publishId,
            `no free slot in the next ${HORIZON_DAYS} days under these rules, so it keeps its time.`,
          ),
        ),
      ];

      // Read before the write, which changes the rows' times
      const views = moves.map(viewOf).sort(byTo);

      if (input.dryRun || moves.length === 0) {
        return {
          ok: true,
          data: { dryRun: input.dryRun, moves: views, notMoved },
        };
      }

      const applied = await applyMoves(
        client,
        moves,
        { ...actor, via: 'replan' },
        now,
      );

      if (applied.ok) {
        return { ok: true, data: { dryRun: false, moves: views, notMoved } };
      }

      if (applied.calendarChanged && changed++ < 1) continue;
      if (applied.calendarChanged) {
        throw new ActionRefusal(
          'The channels’ calendar changed while the re-plan ran. Try again.',
        );
      }

      kept.push(
        notMovedOf(
          moves.find((move) => move.row.id === applied.publishId)?.row,
          applied.publishId,
          applied.refusal,
        ),
      );
      if (attempt >= REPLAN_ATTEMPTS) {
        throw new ActionRefusal(
          `YouTube refused to move ${kept.length} posts, so nothing moved. ${kept.map((k) => k.reason).join(' ')}`,
        );
      }
    }
  } catch (error) {
    return refused(error);
  }
}

async function planChannels(
  client: Client,
  input: ReplanInput,
  now: Date,
  keep: ReadonlySet<string>,
) {
  const { connectionIds } = input;
  if (connectionIds.length === 0) return { moves: [], unplaced: [], rows: [] };

  const [saved, occupied, scheduled] = await Promise.all([
    readCadences(client, connectionIds),
    readCalendar(client, connectionIds, now),
    readDetails(client, 'platform_connection_id', connectionIds, ['scheduled']),
  ]);
  const override = input.cadenceOverride;
  const cadences = override
    ? [
        ...saved.filter(
          (row) =>
            row.platform_connection_id !== override.platform_connection_id ||
            row.content_type !== override.content_type,
        ),
        override,
      ]
    : saved;
  const from = input.from ? new Date(input.from) : now;

  const movable = new Set(
    scheduled
      .filter(
        (row) =>
          !keep.has(row.id) && replannable(row, now) && goesAt(row) >= from,
      )
      .map((row) => row.id),
  );

  const plan = planReplan({
    posts: occupied,
    movable,
    moveLongs: true,
    longVideos: await readLongVideos(client, [
      ...new Set(occupied.map((post) => post.episodeId)),
    ]),
    cadenceOf: cadenceOfRows(cadences, input.timezone ?? 'UTC'),
    from,
    now,
  });

  return {
    moves: plan.moves.map(
      (move): PlannedMove => ({
        row: scheduled.find((row) => row.id === move.publishId)!,
        slotAt: move.slotAt,
        scheduledAt: move.scheduledAt,
      }),
    ),
    unplaced: plan.unplaced,
    rows: scheduled,
  };
}

/** Every channel of a project, re-planned: replanChannels on them */
export async function replanSchedule(
  client: Client,
  actor: Actor,
  input: Omit<ReplanInput, 'connectionIds' | 'cadenceOverride'> & {
    projectId: string;
  },
  options: { now?: Date } = {},
): Promise<Result<ReplanResult>> {
  const { projectId, ...rest } = input;
  const connectionIds = [...(await getProjectChannelIds(client, projectId))];

  return replanChannels(client, actor, { ...rest, connectionIds }, options);
}

export interface CadenceSaveResult {
  connectionId: string;
  contentType: ChannelCadenceInput['contentType'];
  /** False for a dry run: the rules were not saved */
  saved: boolean;
  replan: ReplanResult | null;
  /** Why the re-plan moved nothing; the rules are saved either way */
  replanRefusal: string | null;
}

function cadenceRowOf(input: ChannelCadenceInput): ChannelCadenceRow {
  return {
    platform_connection_id: input.connectionId,
    content_type: input.contentType,
    timezone: input.timezone,
    slot_times: [...input.slotTimes].sort(),
    days_of_week: [...new Set(input.daysOfWeek)].sort(),
    min_days_between: input.minDaysBetween,
    every_n_days: input.everyNDays,
    start_after_hours: input.startAfterHours,
    jitter_minutes: input.jitterMinutes,
    enabled: input.enabled,
  };
}

/**
 * FILM-2213. A channel's posting rules saved, then everything scheduled on
 * the channel re-planned on them, in one request. A dry run saves nothing
 * and shows what saving would move. A re-plan that fails leaves the rules
 * saved and says why nothing moved.
 */
export async function saveCadenceAndReplan(
  client: Client,
  actor: Actor,
  input: ChannelCadenceInput,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<Result<CadenceSaveResult>> {
  const dryRun = !!options.dryRun;

  if (!dryRun) {
    const saved = await saveChannelCadence(client, input);
    if (!saved.ok) return saved;
  }

  let replan: ReplanResult | null = null;
  let replanRefusal: string | null = null;

  try {
    const result = await replanChannels(
      client,
      actor,
      {
        connectionIds: [input.connectionId],
        dryRun,
        timezone: input.timezone,
        cadenceOverride: dryRun ? cadenceRowOf(input) : undefined,
      },
      options,
    );

    if (result.ok) replan = result.data;
    else replanRefusal = result.refusal;
  } catch (error) {
    replanRefusal = `The scheduled posts could not be re-planned: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    ok: true,
    data: {
      connectionId: input.connectionId,
      contentType: input.contentType,
      saved: !dryRun,
      replan,
      replanRefusal,
    },
  };
}
