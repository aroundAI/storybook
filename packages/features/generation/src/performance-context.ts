/**
 * Performance context (FILM-1912, EDD "Phase 2: past performance as
 * context"): what worked and what did not in a project's earlier episodes,
 * as a small block a brief can carry for ideation, story and shots.
 *
 * The analytics come through a `PerformanceReader` on `ctx.performance`,
 * which the caller builds from `@kit/content-analytics`'s services on its
 * own client (`createPerformanceReader`). This module never reads ClickHouse:
 * ClickHouse has no row-level security, so only a service that proved the
 * scope may, and this package is also bundled into the LLM worker, which
 * cannot load those `server-only` services. With no reader, or with
 * ClickHouse off, the block is omitted with its reason and nothing is
 * filled with zeros.
 *
 * What each ranked episode carries is computed here from what the project
 * stored (the story's opening hook, the screenplay's scenes and dialogue,
 * the shots), through the caller's client.
 */
import { fetchAllByIds } from '@kit/shared/pagination';

import type { Ctx } from './types';

/** The stages whose briefs may carry the block (FILM-1912 criterion 4). */
export const PERFORMANCE_CONTEXT_STAGES = [
  'ideation',
  'story',
  'shots',
] as const;
export type PerformanceContextStage =
  (typeof PERFORMANCE_CONTEXT_STAGES)[number];

/** Below this many comparable videos the block says so instead of ranking. */
export const MIN_RANKED_SAMPLE = 8;
/** Episodes shown at each end of a ranking. */
export const RANKED_PER_END = 3;
/** The serialised block stays under this many bytes ("a few KB"). */
export const PERFORMANCE_CONTEXT_MAX_BYTES = 4096;

/**
 * The genome's funnel stage for each generation stage: an idea is judged on
 * whether people stopped for it, a story and its shots on whether they kept
 * watching.
 */
export const FUNNEL_STAGE_FOR: Record<
  PerformanceContextStage,
  'hook' | 'attention'
> = {
  ideation: 'hook',
  story: 'attention',
  shots: 'attention',
};

/** One published video, as the reader measured it. */
export interface PerformanceVideo {
  publishId: string;
  /** Null for a publish with no StoryBook episode behind it. */
  episodeId: string | null;
  platform: string;
  contentType: string;
  publishedAt: string;
  /**
   * Lifetime average percentage viewed, as the platform reports it. Null
   * where the platform does not measure it: not measured, not zero.
   */
  retentionPercent: number | null;
  /**
   * Views in the reading's first `velocityDays` days. Null when that age has not
   * been reached, its window closed before ingest began, or the platform
   * has no single view.
   */
  viewsFirstWeek: number | null;
}

export interface PlatformFreshness {
  platform: string;
  /** The newest metric day ingested; null when none in the window. */
  latestDate: string | null;
  stale: boolean;
}

export interface ViewDefinitionChangeNote {
  platform: string;
  date: string;
  from: string;
  to: string;
}

export type PerformanceReading =
  | { status: 'unmeasured'; reason: string }
  | {
      status: 'measured';
      /** The age `viewsFirstWeek` is measured at, in days. */
      velocityDays: number;
      videos: PerformanceVideo[];
      /** The most recent publishes read, when there were more. */
      window: { mostRecent: number; truncated: boolean };
      freshness: PlatformFreshness[];
      /** Changes in what a view is, across the videos' days. */
      viewDefinitionChanges: ViewDefinitionChangeNote[];
    };

export interface GenomeNote {
  platform: string;
  formatFamily: string;
  /** The genome's own sentence, with its evidence and claim strength. */
  sentence: string;
}

export interface GenomeReading {
  findings: GenomeNote[];
  /** Why a channel or family gave nothing, in the genome's words. */
  refused: string[];
}

export interface ConcludedExperiment {
  kind: 'change_log' | 'channel_experiment';
  title: string;
  hypothesis: string | null;
  outcome: string;
  endedAt: string | null;
}

/** The analytics a context is built from, on the caller's client. */
export interface PerformanceReader {
  videos(projectId: string): Promise<PerformanceReading>;
  genome(
    projectId: string,
    funnelStage: 'hook' | 'attention',
  ): Promise<GenomeReading>;
  concludedExperiments(projectId: string): Promise<ConcludedExperiment[]>;
}

export type PerformanceMetric = 'retention' | 'velocity';

export interface EpisodeTraits {
  /** The story's opening hook; null when the story stored none. */
  hook: string | null;
  sceneCount: number | null;
  shotPacing: { shots: number; meanShotSeconds: number } | null;
  dialogueDensity: { lines: number; linesPerMinute: number | null } | null;
}

export interface RankedEpisode extends EpisodeTraits {
  episodeNumber: number | null;
  title: string | null;
  value: number;
  publishedAt: string;
}

export type PerformanceRanking =
  | {
      status: 'ranked';
      metric: PerformanceMetric;
      measure: string;
      group: { platform: string; contentType: string };
      sample: number;
      top: RankedEpisode[];
      bottom: RankedEpisode[];
    }
  | {
      status: 'not_enough_data';
      metric: PerformanceMetric;
      measure: string;
      group: { platform: string; contentType: string } | null;
      sample: number;
      minimum: number;
      label: string;
    };

export type PerformanceContext =
  | {
      status: 'omitted';
      stage: PerformanceContextStage;
      reason: string;
    }
  | {
      status: 'included';
      stage: PerformanceContextStage;
      projectId: string;
      label: string;
      sample: { videos: number; mostRecent: number; truncated: boolean };
      freshness: PlatformFreshness[];
      retention: PerformanceRanking;
      velocity: PerformanceRanking;
      genome: GenomeReading;
      experiments: ConcludedExperiment[];
      caveats: string[];
    };

function measureOf(metric: PerformanceMetric, velocityDays: number) {
  return metric === 'retention'
    ? 'average percentage of the video viewed, over its lifetime, as the platform reports it'
    : `views in the first ${velocityDays} days after publishing`;
}

const NO_READER =
  'No analytics reader in this runtime, so past performance was not read.';

/**
 * Builds the block for one project and stage. Never throws for missing
 * data: what cannot be measured is omitted with its reason.
 */
export async function buildPerformanceContext(
  ctx: Ctx,
  input: { projectId: string; stage: PerformanceContextStage },
): Promise<PerformanceContext> {
  const { projectId, stage } = input;
  const reader = ctx.performance;

  if (!reader) return { status: 'omitted', stage, reason: NO_READER };

  const reading = await reader.videos(projectId);

  if (reading.status === 'unmeasured') {
    return { status: 'omitted', stage, reason: reading.reason };
  }

  const [genome, experiments] = await Promise.all([
    reader.genome(projectId, FUNNEL_STAGE_FOR[stage]),
    reader.concludedExperiments(projectId),
  ]);

  const retention = rankVideos(
    reading.videos,
    'retention',
    reading.velocityDays,
  );
  const velocity = rankVideos(reading.videos, 'velocity', reading.velocityDays);

  const traits = await loadEpisodeTraits(ctx, projectId, [
    ...rankedEpisodeIds(retention),
    ...rankedEpisodeIds(velocity),
  ]);

  const context: PerformanceContext = {
    status: 'included',
    stage,
    projectId,
    label: labelFor(reading),
    sample: {
      videos: reading.videos.length,
      mostRecent: reading.window.mostRecent,
      truncated: reading.window.truncated,
    },
    freshness: reading.freshness,
    retention: withTraits(retention, traits),
    velocity: withTraits(velocity, traits),
    genome,
    experiments,
    caveats: caveatsFor(reading, velocity),
  };

  return capPerformanceContext(context);
}

/**
 * Whether the team turned the block on (`account_ai_settings`
 * `.performance_context_enabled`). Off by default: no row, or a read that
 * fails, is off.
 */
export async function performanceContextEnabled(ctx: Ctx): Promise<boolean> {
  const { data, error } = await ctx.client
    .from('account_ai_settings')
    .select('performance_context_enabled')
    .eq('account_id', ctx.accountId)
    .maybeSingle();

  if (error) {
    ctx.log?.(
      `[performance-context] could not read the team setting: ${error.message}`,
    );
    return false;
  }

  return data?.performance_context_enabled === true;
}

interface Ranked {
  status: 'ranked';
  metric: PerformanceMetric;
  measure: string;
  group: { platform: string; contentType: string };
  sample: number;
  top: PerformanceVideo[];
  bottom: PerformanceVideo[];
}

type RankResult =
  | Ranked
  | Extract<PerformanceRanking, { status: 'not_enough_data' }>;

function valueOf(video: PerformanceVideo, metric: PerformanceMetric) {
  return metric === 'retention' ? video.retentionPercent : video.viewsFirstWeek;
}

/**
 * Ranks the episodes' videos on one metric, within one comparable group: a
 * platform and content type, because a Short's retention is not a
 * long-form video's and one platform's view is not another's. The group
 * with the most measured videos is ranked; below `MIN_RANKED_SAMPLE` the
 * result says there is not enough data instead.
 *
 * Highest first; ties go to the newer video, then the publish id, so the
 * same data always ranks the same way. An episode appears once at each end.
 */
export function rankVideos(
  videos: PerformanceVideo[],
  metric: PerformanceMetric,
  velocityDays: number,
): RankResult {
  const groups = new Map<string, PerformanceVideo[]>();

  for (const video of videos) {
    if (!video.episodeId || valueOf(video, metric) === null) continue;

    const key = `${video.platform}\u0000${video.contentType}`;
    groups.set(key, [...(groups.get(key) ?? []), video]);
  }

  const [key, members] = [...groups.entries()].sort(
    ([a, left], [b, right]) => right.length - left.length || a.localeCompare(b),
  )[0] ?? [null, []];

  const group = key
    ? {
        platform: key.split('\u0000')[0]!,
        contentType: key.split('\u0000')[1]!,
      }
    : null;

  if (!group || members.length < MIN_RANKED_SAMPLE) {
    return {
      status: 'not_enough_data',
      metric,
      measure: measureOf(metric, velocityDays),
      group,
      sample: members.length,
      minimum: MIN_RANKED_SAMPLE,
      label: group
        ? `Not enough data to rank by ${metric}: ${members.length} comparable ${members.length === 1 ? 'video' : 'videos'} (${group.platform}, ${group.contentType}) measured, at least ${MIN_RANKED_SAMPLE} needed.`
        : `Not enough data to rank by ${metric}: no published episode has it measured.`,
    };
  }

  const ordered = [...members].sort(
    (a, b) =>
      valueOf(b, metric)! - valueOf(a, metric)! ||
      b.publishedAt.localeCompare(a.publishedAt) ||
      a.publishId.localeCompare(b.publishId),
  );

  const top = distinctEpisodes(ordered, new Set());
  const bottom = distinctEpisodes(
    [...ordered].reverse(),
    new Set(top.map((video) => video.episodeId!)),
  );

  return {
    status: 'ranked',
    metric,
    measure: measureOf(metric, velocityDays),
    group,
    sample: members.length,
    top,
    bottom,
  };
}

function distinctEpisodes(ordered: PerformanceVideo[], taken: Set<string>) {
  const picked: PerformanceVideo[] = [];
  const seen = new Set(taken);

  for (const video of ordered) {
    if (picked.length === RANKED_PER_END) break;
    if (seen.has(video.episodeId!)) continue;

    seen.add(video.episodeId!);
    picked.push(video);
  }

  return picked;
}

function rankedEpisodeIds(ranking: RankResult) {
  return ranking.status === 'ranked'
    ? [...ranking.top, ...ranking.bottom].map((video) => video.episodeId!)
    : [];
}

interface EpisodeRecord extends EpisodeTraits {
  number: number;
  title: string;
}

function withTraits(
  ranking: RankResult,
  episodes: Map<string, EpisodeRecord>,
): PerformanceRanking {
  if (ranking.status !== 'ranked') return ranking;

  const describe = (video: PerformanceVideo): RankedEpisode => {
    const episode = episodes.get(video.episodeId!);

    return {
      episodeNumber: episode?.number ?? null,
      title: episode ? clip(episode.title, 80) : null,
      value: valueOf(video, ranking.metric)!,
      publishedAt: video.publishedAt.slice(0, 10),
      hook: episode?.hook ?? null,
      sceneCount: episode?.sceneCount ?? null,
      shotPacing: episode?.shotPacing ?? null,
      dialogueDensity: episode?.dialogueDensity ?? null,
    };
  };

  return {
    ...ranking,
    top: ranking.top.map(describe),
    bottom: ranking.bottom.map(describe),
  };
}

interface EpisodeRow {
  id: string;
  number: number;
  title: string;
  duration_seconds: number | null;
  story_data: unknown;
  screenplay_data: unknown;
}

/**
 * The ranked episodes' traits, from the stored story, screenplay and
 * shots. Only the ranked episodes are read (at most four per end per
 * metric), and only this project's.
 */
async function loadEpisodeTraits(
  ctx: Ctx,
  projectId: string,
  episodeIds: string[],
): Promise<Map<string, EpisodeRecord>> {
  const ids = [...new Set(episodeIds)];

  if (ids.length === 0) return new Map();

  const [episodes, shots] = await Promise.all([
    fetchAllByIds<EpisodeRow>(
      ids,
      (chunk, from, to) =>
        ctx.client
          .from('episodes')
          .select(
            'id, number, title, duration_seconds, story_data, screenplay_data',
          )
          .eq('project_id', projectId)
          .in('id', chunk)
          .order('id')
          .range(from, to),
      'performance context episodes',
    ),
    fetchAllByIds<{ episode_id: string; duration_seconds: number }>(
      ids,
      (chunk, from, to) =>
        ctx.client
          .from('shots')
          .select('id, episode_id, duration_seconds')
          .in('episode_id', chunk)
          .is('deleted_at', null)
          .order('id')
          .range(from, to),
      'performance context shots',
    ),
  ]);

  const shotsByEpisode = new Map<string, number[]>();

  for (const shot of shots) {
    shotsByEpisode.set(shot.episode_id, [
      ...(shotsByEpisode.get(shot.episode_id) ?? []),
      Number(shot.duration_seconds),
    ]);
  }

  return new Map(
    episodes.map((row) => [
      row.id,
      {
        number: row.number,
        title: row.title,
        ...episodeTraits(row, shotsByEpisode.get(row.id) ?? []),
      },
    ]),
  );
}

/**
 * An episode's traits, from what it stored. Runtime for dialogue density is
 * the finished video's duration when known, else the shots' total; with
 * neither, lines per minute is null rather than guessed from the target.
 */
export function episodeTraits(
  episode: {
    duration_seconds: number | null;
    story_data: unknown;
    screenplay_data: unknown;
  },
  shotDurations: number[],
): EpisodeTraits {
  const hook = field(
    field(episode.story_data, 'viralStructure'),
    'openingHook',
  );
  const scenes = field(episode.screenplay_data, 'scenes');

  const shotTotal = shotDurations.reduce((sum, seconds) => sum + seconds, 0);
  const runtime =
    episode.duration_seconds && episode.duration_seconds > 0
      ? episode.duration_seconds
      : shotTotal > 0
        ? shotTotal
        : null;

  const lines = Array.isArray(scenes)
    ? scenes.reduce<number>((sum, scene) => {
        const dialogue = field(scene, 'dialogue');
        return sum + (Array.isArray(dialogue) ? dialogue.length : 0);
      }, 0)
    : null;

  return {
    hook:
      typeof hook === 'string' && hook.trim() ? clip(hook.trim(), 160) : null,
    sceneCount: Array.isArray(scenes) ? scenes.length : null,
    shotPacing:
      shotDurations.length > 0
        ? {
            shots: shotDurations.length,
            meanShotSeconds: round1(shotTotal / shotDurations.length),
          }
        : null,
    dialogueDensity:
      lines === null
        ? null
        : {
            lines,
            linesPerMinute: runtime ? round1(lines / (runtime / 60)) : null,
          },
  };
}

function labelFor(
  reading: Extract<PerformanceReading, { status: 'measured' }>,
) {
  const freshness = reading.freshness
    .map(
      (entry) =>
        `${entry.platform} ${entry.latestDate ?? 'no data in the last 30 days'}${entry.stale ? ' (stale)' : ''}`,
    )
    .join(', ');

  return `Past performance of this project's ${reading.window.truncated ? `${reading.window.mostRecent} most recent` : reading.videos.length} published ${reading.videos.length === 1 ? 'video' : 'videos'}; data as of ${freshness || 'unknown'}. Rankings compare like with like (one platform and content type) and are observational: what correlated with performance, not what caused it.`;
}

function caveatsFor(
  reading: Extract<PerformanceReading, { status: 'measured' }>,
  velocity: RankResult,
) {
  const caveats: string[] = [];

  if (velocity.status === 'ranked') {
    const dates = [...velocity.top, ...velocity.bottom].map((video) =>
      video.publishedAt.slice(0, 10),
    );
    const first = dates.reduce((a, b) => (a < b ? a : b));
    const last = addDays(
      dates.reduce((a, b) => (a > b ? a : b)),
      reading.velocityDays,
    );

    for (const change of reading.viewDefinitionChanges) {
      if (
        change.platform === velocity.group.platform &&
        change.date > first &&
        change.date <= last
      ) {
        caveats.push(
          `${change.platform} changed what counts as a view on ${change.date} (${change.from} → ${change.to}); videos either side of it count views differently.`,
        );
      }
    }
  }

  if (reading.window.truncated) {
    caveats.push(
      `Only the ${reading.window.mostRecent} most recent publishes were read.`,
    );
  }

  return caveats;
}

/**
 * Holds the block under `PERFORMANCE_CONTEXT_MAX_BYTES` by dropping the
 * least load-bearing detail first: experiments and genome findings beyond
 * the first few, then hooks shortened, then one episode per end.
 */
export function capPerformanceContext(
  context: PerformanceContext,
  maxBytes = PERFORMANCE_CONTEXT_MAX_BYTES,
): PerformanceContext {
  if (context.status !== 'included') return context;

  const steps: Array<(c: IncludedContext) => IncludedContext> = [
    (c) => ({ ...c, experiments: c.experiments.slice(0, 3) }),
    (c) => ({
      ...c,
      genome: {
        ...c.genome,
        findings: c.genome.findings.slice(0, 3),
        refused: c.genome.refused.slice(0, 2),
      },
    }),
    (c) =>
      mapEpisodes(c, (e) => ({ ...e, hook: e.hook ? clip(e.hook, 80) : null })),
    (c) => ({
      ...c,
      experiments: c.experiments.slice(0, 1),
      genome: {
        ...c.genome,
        findings: c.genome.findings.slice(0, 1),
        refused: [],
      },
    }),
    (c) =>
      mapRankings(c, (r) => ({
        ...r,
        top: r.top.slice(0, 2),
        bottom: r.bottom.slice(0, 2),
      })),
    (c) =>
      mapEpisodes(c, (e) => ({
        ...e,
        hook: null,
        title: e.title ? clip(e.title, 40) : null,
      })),
    (c) => ({ ...c, experiments: [], genome: { findings: [], refused: [] } }),
  ];

  let current: IncludedContext = context;

  for (const step of steps) {
    if (byteLength(current) <= maxBytes) break;
    current = step(current);
  }

  return current;
}

type IncludedContext = Extract<PerformanceContext, { status: 'included' }>;
type RankedRanking = Extract<PerformanceRanking, { status: 'ranked' }>;

function mapRankings(
  context: IncludedContext,
  map: (ranking: RankedRanking) => RankedRanking,
): IncludedContext {
  const apply = (ranking: PerformanceRanking) =>
    ranking.status === 'ranked' ? map(ranking) : ranking;

  return {
    ...context,
    retention: apply(context.retention),
    velocity: apply(context.velocity),
  };
}

function mapEpisodes(
  context: IncludedContext,
  map: (episode: RankedEpisode) => RankedEpisode,
) {
  return mapRankings(context, (ranking) => ({
    ...ranking,
    top: ranking.top.map(map),
    bottom: ranking.bottom.map(map),
  }));
}

export function byteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
