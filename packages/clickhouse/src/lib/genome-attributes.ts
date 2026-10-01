/**
 * Content genome attributes (FILM-1717).
 *
 * Three things share one physical store and must not share meaning:
 *
 * | Concept     | Question                                  | Example                  |
 * |-------------|-------------------------------------------|--------------------------|
 * | Taxonomy    | What is this video?                       | `topic:ai`               |
 * | Genome      | What creative mechanisms does it contain? | `result_first:yes`       |
 * | Performance | What happened?                            | transmission 2.1x        |
 *
 * Taxonomy and genome both travel as `dimension:slug` strings through
 * `publish_tags` → `video_dim.tags` (an `Array(String)` that already
 * serialises any dimension), so ClickHouse needs no change. They are told
 * apart here, by dimension, into two types. Performance is never a tag: it
 * is measured, so `parseVideoTag` cannot produce one, and no dimension may
 * carry a funnel stage's name.
 *
 * The dimension lists below are the one source for the `content_tags`
 * CHECK (the migration is compared with them by a test) and for the tag
 * form's schema. Pure and client-safe, like the rest of `lib/`.
 */
import type { FunnelStage } from './signal-map';

/** What a video is. Not a creative mechanism, so never a genome finding. */
export const TAXONOMY_DIMENSIONS = [
  'topic',
  'format',
  'thumbnail_style',
] as const;

export type TaxonomyDimension = (typeof TAXONOMY_DIMENSIONS)[number];

/**
 * Layer A — observable: recorded at publish by someone looking at the video
 * (genome v1).
 *
 * `hook_type` was a taxonomy dimension; it moves here because a hook is a
 * mechanism, not a subject. Its slugs are unchanged, so every existing
 * `hook_type:` tag keeps meaning what it meant.
 *
 * Duration is observable too, but it is not a tag: `video_dim` already holds
 * the published asset's length (FILM-1710), and a second, hand-entered copy
 * could only disagree with it. `durationAttribute` derives it instead.
 */
export const GENOME_OBSERVABLE_DIMENSIONS = [
  'hook_type',
  'opening_visual',
  'first_sentence',
  'face_present',
  'text_present',
  'cuts_per_minute',
  'scene_changes',
  'question_first_3s',
  'result_first',
] as const;

export type GenomeObservableDimension =
  (typeof GENOME_OBSERVABLE_DIMENSIONS)[number];

/** Derived from `video_dim`, never tagged. */
export const DURATION_DIMENSION = 'duration';

export type GenomeDimension =
  | GenomeObservableDimension
  | typeof DURATION_DIMENSION;

/** Every dimension a `content_tags` row may have — the table's CHECK. */
export const TAG_DIMENSIONS = [
  ...TAXONOMY_DIMENSIONS,
  ...GENOME_OBSERVABLE_DIMENSIONS,
] as const;

export type TagDimension = (typeof TAG_DIMENSIONS)[number];

const YES_NO = ['yes', 'no'] as const;

/**
 * Dimensions whose values are fixed rather than per-account. A yes/no
 * attribute spelt `yes` on one account and `true` on another could not be
 * compared, and a band is only a band if its edges are the same everywhere.
 * The rest — hook types, opening visuals, first sentences, topics — are each
 * account's own vocabulary, as `content_tags` has always been.
 *
 * Slugs follow the table's slug rule: lowercase, digits and hyphens.
 */
export const CLOSED_TAG_VALUES: Partial<
  Record<TagDimension, readonly string[]>
> = {
  face_present: YES_NO,
  text_present: YES_NO,
  question_first_3s: YES_NO,
  result_first: YES_NO,
  cuts_per_minute: ['under-5', '5-to-15', '15-to-30', 'over-30'],
  scene_changes: ['none', '1-to-3', '4-to-10', 'over-10'],
};

/** Null when the dimension is an open, per-account vocabulary. */
export function closedValuesFor(dimension: string): readonly string[] | null {
  return Object.hasOwn(CLOSED_TAG_VALUES, dimension)
    ? (CLOSED_TAG_VALUES[dimension as TagDimension] ?? null)
    : null;
}

/**
 * The funnel stage each mechanism is scored against, so `hook_type:cold-open`
 * is judged on the Hook stage rather than on views (FILM-1717 notes, "Not a
 * second statistics engine"). A caller may ask about any stage; this is the
 * default and what a hypothesis names.
 */
export const GENOME_DIMENSION_STAGE: Record<GenomeDimension, FunnelStage> = {
  hook_type: 'hook',
  opening_visual: 'hook',
  first_sentence: 'hook',
  question_first_3s: 'hook',
  face_present: 'hook',
  text_present: 'attention',
  cuts_per_minute: 'attention',
  scene_changes: 'attention',
  result_first: 'attention',
  duration: 'attention',
};

export interface TaxonomyTag {
  kind: 'taxonomy';
  dimension: TaxonomyDimension;
  value: string;
  /** The stored `dimension:slug` form. */
  tag: string;
}

export interface GenomeAttribute {
  kind: 'genome';
  layer: 'observable' | 'semantic';
  dimension: GenomeDimension;
  value: string;
  tag: string;
  /** Where the attribute came from: a `publish_tags` row, or `video_dim`. */
  source: 'tag' | 'video_dim';
}

/**
 * What happened, at a stage. Measured, never stored as a tag — so it has no
 * `tag` field, and nothing that parses tags returns one.
 */
export interface PerformanceOutcome {
  kind: 'performance';
  stage: FunnelStage;
  value: number | null;
}

export type VideoTag = TaxonomyTag | GenomeAttribute;

function isOneOf<T extends string>(
  list: readonly T[],
  value: string,
): value is T {
  return (list as readonly string[]).includes(value);
}

/**
 * Splits a stored tag into its kind. Null for anything that is not a known
 * `dimension:slug`, and for a closed dimension's value outside its list —
 * a stray `face_present:maybe` is not evidence of anything.
 */
export function parseVideoTag(tag: string): VideoTag | null {
  const separator = tag.indexOf(':');
  if (separator <= 0) return null;

  const dimension = tag.slice(0, separator);
  const value = tag.slice(separator + 1);
  if (!value) return null;

  const closed = closedValuesFor(dimension);
  if (closed && !closed.includes(value)) return null;

  if (isOneOf(TAXONOMY_DIMENSIONS, dimension)) {
    return { kind: 'taxonomy', dimension, value, tag };
  }

  if (isOneOf(GENOME_OBSERVABLE_DIMENSIONS, dimension)) {
    return {
      kind: 'genome',
      layer: 'observable',
      dimension,
      value,
      tag,
      source: 'tag',
    };
  }

  return null;
}

/**
 * Duration bands, by the published asset's length. Edges are where the
 * format families already draw lines (60 seconds, 3 minutes) plus two inside
 * long-form, so a band never straddles a family boundary.
 */
export const DURATION_BANDS = [
  { slug: 'under-15s', below: 15 },
  { slug: '15-to-60s', below: 60 },
  { slug: '1-to-3m', below: 180 },
  { slug: '3-to-10m', below: 600 },
  { slug: '10-to-20m', below: 1200 },
  { slug: 'over-20m', below: Number.POSITIVE_INFINITY },
] as const;

export type DurationBand = (typeof DURATION_BANDS)[number]['slug'];

/** Null when the asset's length is not known: unknown, never a band. */
export function durationBandOf(
  assetDurationSeconds: number | null,
): DurationBand | null {
  if (
    assetDurationSeconds === null ||
    !Number.isFinite(assetDurationSeconds) ||
    assetDurationSeconds <= 0
  ) {
    return null;
  }

  return DURATION_BANDS.find((band) => assetDurationSeconds < band.below)!.slug;
}

export function durationAttribute(
  assetDurationSeconds: number | null,
): GenomeAttribute | null {
  const band = durationBandOf(assetDurationSeconds);
  if (!band) return null;

  return {
    kind: 'genome',
    layer: 'observable',
    dimension: DURATION_DIMENSION,
    value: band,
    tag: `${DURATION_DIMENSION}:${band}`,
    source: 'video_dim',
  };
}

/** A video's tags, split by kind; unknown tags are dropped, not guessed at. */
export function splitVideoTags(tags: readonly string[]): {
  taxonomy: TaxonomyTag[];
  genome: GenomeAttribute[];
} {
  const taxonomy: TaxonomyTag[] = [];
  const genome: GenomeAttribute[] = [];

  for (const tag of tags) {
    const parsed = parseVideoTag(tag);
    if (parsed?.kind === 'taxonomy') taxonomy.push(parsed);
    if (parsed?.kind === 'genome') genome.push(parsed);
  }

  return { taxonomy, genome };
}
