import 'server-only';

import { z } from 'zod';

import { fetchAllByIds } from '@kit/shared/pagination';

import type { AnalyticsClient } from './analytics-client';
import {
  type MeasuredVideo,
  readProjectVideoPerformance,
} from './performance-reader';

/**
 * Episode performance split by who wrote it (FILM-1912): StoryBook's own
 * model (`server`), an agent over MCP (`external`), or a person (`human`),
 * from the `generation_origin` FILM-1903 stamps on each episode per stage.
 * An episode written before the stamp existed is `unrecorded`, never
 * guessed.
 *
 * Figures are compared only within one platform and content type, and are
 * medians with their count: no composite score, and no figure where none
 * was measured. It is observational; which writer an episode got was not
 * randomised, so a difference is a lead for an experiment, not a cause.
 */

export const ORIGIN_STAGES = ['story', 'screenplay'] as const;

export const PerformanceByOriginSchema = z.object({
  projectId: z.string().uuid(),
  /** Whose stamp decides an episode's origin. */
  stage: z.enum(ORIGIN_STAGES).default('story'),
});

export type PerformanceByOriginInput = z.infer<
  typeof PerformanceByOriginSchema
>;

export const ORIGIN_KINDS = [
  'server',
  'external',
  'human',
  'unrecorded',
] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

export interface OriginFigures {
  origin: OriginKind;
  videos: number;
  /** Median lifetime average percentage viewed; null when none measured. */
  retentionMedian: number | null;
  retentionMeasured: number;
  /** Median views at the velocity age; null when none measured. */
  velocityMedian: number | null;
  velocityMeasured: number;
}

export type PerformanceByOriginResult =
  | { status: 'unmeasured'; reason: string }
  | {
      status: 'measured';
      stage: (typeof ORIGIN_STAGES)[number];
      velocityDays: number;
      groups: Array<{
        platform: string;
        contentType: string;
        origins: OriginFigures[];
      }>;
      notes: string[];
    };

export async function getPerformanceByOriginService(
  client: AnalyticsClient,
  input: PerformanceByOriginInput,
): Promise<PerformanceByOriginResult> {
  const reading = await readProjectVideoPerformance(client, input.projectId);

  if (reading.status === 'unmeasured') return reading;

  const episodeIds = [
    ...new Set(
      reading.videos.flatMap((video) =>
        video.episodeId ? [video.episodeId] : [],
      ),
    ),
  ];

  const episodes = await fetchAllByIds<{
    id: string;
    generation_origin: unknown;
  }>(
    episodeIds,
    (chunk, from, to) =>
      client
        .from('episodes')
        .select('id, generation_origin')
        .eq('project_id', input.projectId)
        .in('id', chunk)
        .order('id')
        .range(from, to),
    'episode origins',
  );

  const originOf = new Map(
    episodes.map((row) => [
      row.id,
      originKindOf(row.generation_origin, input.stage),
    ]),
  );

  return {
    status: 'measured',
    stage: input.stage,
    velocityDays: reading.velocityDays,
    groups: splitByOrigin(reading.videos, originOf),
    notes: [
      'Observational: which writer an episode got was not randomised, so a difference is a lead to test, not a cause.',
      'Compared only within one platform and content type; figures are medians with the count each is over.',
      '`unrecorded` episodes were written before origins were stamped (FILM-1903). An external origin’s model is what the client reported.',
      ...(reading.window.truncated
        ? [
            `Only the ${reading.window.mostRecent} most recent publishes were read.`,
          ]
        : []),
    ],
  };
}

/** An episode's origin for one stage, from `generation_origin[stage].kind`. */
export function originKindOf(origin: unknown, stage: string): OriginKind {
  const entry =
    origin && typeof origin === 'object'
      ? (origin as Record<string, unknown>)[stage]
      : undefined;
  const kind =
    entry && typeof entry === 'object'
      ? (entry as Record<string, unknown>).kind
      : undefined;

  return kind === 'server' || kind === 'external' || kind === 'human'
    ? kind
    : 'unrecorded';
}

/**
 * Groups the episodes' videos by platform and content type, then by
 * origin. A video with no episode is left out: it has no origin.
 */
export function splitByOrigin(
  videos: MeasuredVideo[],
  originOf: Map<string, OriginKind>,
) {
  const groups = new Map<string, Map<OriginKind, MeasuredVideo[]>>();

  for (const video of videos) {
    if (!video.episodeId) continue;

    const key = `${video.platform}\u0000${video.contentType}`;
    const origin = originOf.get(video.episodeId) ?? 'unrecorded';
    const byOrigin = groups.get(key) ?? new Map<OriginKind, MeasuredVideo[]>();

    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), video]);
    groups.set(key, byOrigin);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, byOrigin]) => {
      const [platform, contentType] = key.split('\u0000') as [string, string];

      return {
        platform,
        contentType,
        origins: ORIGIN_KINDS.filter((origin) => byOrigin.has(origin)).map(
          (origin): OriginFigures => {
            const members = byOrigin.get(origin)!;
            const retention = measured(members, (v) => v.retentionPercent);
            const velocity = measured(members, (v) => v.viewsFirstWeek);

            return {
              origin,
              videos: members.length,
              retentionMedian: median(retention),
              retentionMeasured: retention.length,
              velocityMedian: median(velocity),
              velocityMeasured: velocity.length,
            };
          },
        ),
      };
    });
}

function measured(
  videos: MeasuredVideo[],
  pick: (video: MeasuredVideo) => number | null,
) {
  return videos.flatMap((video) => {
    const value = pick(video);
    return value === null ? [] : [value];
  });
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
