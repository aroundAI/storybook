/**
 * Format families (FILM-1716).
 *
 * Short-form and long-form are different products: in one the viewer did
 * not ask for the video, in the other they chose it. A benchmark pool or a
 * signal map that mixes them describes neither. `content_type` is the input
 * here, not the answer — it has four values, three of which behave as
 * long-form, and it says nothing about orientation or surface. So a family
 * is mapped from `content_type` *and* platform, in one table, here.
 *
 * A family must change how a video is analysed, not merely describe it. Two
 * families that always share a signal map and a benchmark pool are one
 * family with two names.
 */
import type { AssetDuration } from './asset-duration';
import { resolveAssetDuration } from './asset-duration';

export const FORMAT_FAMILIES = [
  'short_vertical',
  'long_vertical',
  'long_horizontal',
  'teaser',
  'trailer',
  'clip',
  /**
   * In the vocabulary so the axis does not need widening later. Nothing
   * maps to it until live publishing exists.
   */
  'live',
] as const;

export type FormatFamily = (typeof FORMAT_FAMILIES)[number];

/** What a card calls each family. */
export const FORMAT_FAMILY_LABEL: Record<FormatFamily, string> = {
  short_vertical: 'Short (vertical feed)',
  long_vertical: 'Long-form (vertical)',
  long_horizontal: 'Long-form (horizontal)',
  teaser: 'Teaser',
  trailer: 'Trailer',
  clip: 'Timeline clip',
  live: 'Live',
};

/**
 * `publishes.content_type`'s CHECK (`film-studio-tables.sql`), which
 * `video_dim.content_type` copies. `format-families.test.ts` reads the
 * CHECK, so a value added there fails until it is mapped here.
 */
export const CONTENT_TYPES = ['full', 'short', 'teaser', 'trailer'] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * `publishes.platform`'s CHECK — every platform a `video_dim` row can carry.
 * Wider than `AnalyticsPlatform`, which is only the platforms we ingest
 * metrics for: a row's family is defined whether or not it has figures.
 * X is `twitter` here because that is what the column holds.
 */
export const PUBLISH_PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'twitter',
  'linkedin',
] as const;

export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

/**
 * The declared family of every `content_type` on every platform.
 *
 * - `full` is horizontal where the platform's long-form surface is a
 *   player (YouTube, Facebook, X, LinkedIn) and vertical where it is the
 *   same full-screen feed as everything else (TikTok, Instagram).
 * - `short` is `short_vertical` where it lands in a swipe feed (Shorts,
 *   For You, Reels, Facebook Reels) and `clip` where it lands in a mixed
 *   timeline the viewer scrolls past (X, LinkedIn) — the same file, a
 *   different view definition and a different reason to stop.
 * - `teaser` and `trailer` are their own families everywhere. They exist to
 *   send viewers elsewhere, so their success is not their own watch time,
 *   and a lookup that folded them into long-form dropped that.
 *
 * A `Record` on both axes, so a new content type or platform does not
 * compile until it is mapped — there is no default to fall into.
 */
export const FORMAT_BY_CONTENT_TYPE: Record<
  ContentType,
  Record<PublishPlatform, FormatFamily>
> = {
  full: {
    youtube: 'long_horizontal',
    tiktok: 'long_vertical',
    instagram: 'long_vertical',
    facebook: 'long_horizontal',
    twitter: 'long_horizontal',
    linkedin: 'long_horizontal',
  },
  short: {
    youtube: 'short_vertical',
    tiktok: 'short_vertical',
    instagram: 'short_vertical',
    facebook: 'short_vertical',
    twitter: 'clip',
    linkedin: 'clip',
  },
  teaser: {
    youtube: 'teaser',
    tiktok: 'teaser',
    instagram: 'teaser',
    facebook: 'teaser',
    twitter: 'teaser',
    linkedin: 'teaser',
  },
  trailer: {
    youtube: 'trailer',
    tiktok: 'trailer',
    instagram: 'trailer',
    facebook: 'trailer',
    twitter: 'trailer',
    linkedin: 'trailer',
  },
};

/**
 * Where a *known* asset duration overrides the declared family — only where
 * the platform's own rule makes the answer certain, never as a guess.
 *
 * YouTube categorises a square or vertical upload as a Short only up to
 * three minutes (60 seconds before 2024-10-15), per
 * https://support.google.com/youtube/answer/15424877 (read 2026-10-01; see
 * docs/platform-capability-reference.md). Above 180 seconds a `short` is
 * therefore not served as a Short in either era: it is a vertical long-form
 * video. Between 61 and 180 seconds a pre-2024-10-15 upload may not have
 * been a Short either, but this table does not know the upload date, so it
 * leaves those to the declared family rather than guessing.
 *
 * An unknown duration never triggers a refinement: the declared family
 * stands (`resolveFormatFamily`).
 */
export const DURATION_REFINEMENTS: readonly {
  platform: PublishPlatform;
  contentType: ContentType;
  /** Strictly above this many seconds, the family is `family`. */
  aboveSeconds: number;
  family: FormatFamily;
}[] = [
  {
    platform: 'youtube',
    contentType: 'short',
    aboveSeconds: 180,
    family: 'long_vertical',
  },
];

export type FormatFamilyResolution =
  | {
      ok: true;
      family: FormatFamily;
      /** What `content_type` and platform alone say. */
      declared: FormatFamily;
      /**
       * `declared` when the family is the declared one — including every
       * time the duration is unknown. `asset_duration` only when a known
       * duration moved it.
       */
      basis: 'declared' | 'asset_duration';
      duration: AssetDuration;
    }
  | {
      ok: false;
      /**
       * A value no table here knows. Not defaulted to anything: a row with
       * one is outside every family until it is mapped, and the live check
       * in verify-queries fails on it.
       */
      reason: 'unmapped_content_type' | 'unmapped_platform';
      platform: string;
      contentType: string;
    };

function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}

function isPublishPlatform(value: string): value is PublishPlatform {
  return (PUBLISH_PLATFORMS as readonly string[]).includes(value);
}

/**
 * A publish's format family.
 *
 * `assetDuration` is required, not optional, so a caller with no duration
 * has to say so with `DURATION_UNKNOWN` — and then gets the declared family,
 * never one inferred from the episode's length or a target.
 */
export function resolveFormatFamily(input: {
  platform: string;
  contentType: string;
  assetDuration: AssetDuration;
}): FormatFamilyResolution {
  const { platform, contentType, assetDuration } = input;

  if (!isPublishPlatform(platform)) {
    return { ok: false, reason: 'unmapped_platform', platform, contentType };
  }
  if (!isContentType(contentType)) {
    return {
      ok: false,
      reason: 'unmapped_content_type',
      platform,
      contentType,
    };
  }

  const declared = FORMAT_BY_CONTENT_TYPE[contentType][platform];

  if (assetDuration.known) {
    const refinement = DURATION_REFINEMENTS.find(
      (rule) =>
        rule.platform === platform &&
        rule.contentType === contentType &&
        assetDuration.seconds > rule.aboveSeconds,
    );

    if (refinement) {
      return {
        ok: true,
        family: refinement.family,
        declared,
        basis: 'asset_duration',
        duration: assetDuration,
      };
    }
  }

  return {
    ok: true,
    family: declared,
    declared,
    basis: 'declared',
    duration: assetDuration,
  };
}

/** `resolveFormatFamily` over a `video_dim` row's own columns. */
export function formatFamilyOfDim(dim: {
  platform: string;
  content_type: string;
  asset_duration_seconds: number | null;
}): FormatFamilyResolution {
  return resolveFormatFamily({
    platform: dim.platform,
    contentType: dim.content_type,
    assetDuration: resolveAssetDuration(dim.asset_duration_seconds),
  });
}

/**
 * The `(platform, content_type)` pairs seen in `video_dim` that no family
 * covers. The live check runs `SELECT DISTINCT platform, content_type FROM
 * video_dim FINAL` and fails on anything this returns.
 */
export function unmappedFormatPairs(
  observed: readonly { platform: string; content_type: string }[],
): { platform: string; content_type: string }[] {
  const seen = new Set<string>();

  return observed.filter((pair) => {
    const key = `${pair.platform}\u0000${pair.content_type}`;
    if (seen.has(key)) return false;
    seen.add(key);

    return !resolveFormatFamily({
      platform: pair.platform,
      contentType: pair.content_type,
      assetDuration: { known: false, reason: 'duration_unknown' },
    }).ok;
  });
}

/** The declared content types that resolve to `family` on `platform`. */
export function contentTypesFor(
  family: FormatFamily,
  platform: PublishPlatform,
): ContentType[] {
  return CONTENT_TYPES.filter(
    (contentType) => FORMAT_BY_CONTENT_TYPE[contentType][platform] === family,
  );
}

/**
 * A `video_dim` predicate selecting the rows `resolveFormatFamily` puts in
 * `family`, built from the same two tables so SQL and TypeScript cannot
 * disagree about membership. verify-queries checks they agree row for row.
 *
 * Reads `platform`, `content_type` and `asset_duration_seconds` as plain
 * names, so it belongs where those are the newest row's values — the
 * `latest` (HAVING) side of `buildDimConditions`, because the asset
 * duration is filled in after a publish's first dim row is written.
 *
 * A null duration compares as 0, so it never crosses a threshold: unknown
 * falls back to the declared family, as `resolveFormatFamily` does. Without
 * the `ifNull`, `NULL > 180` is NULL and the row would fall out of *every*
 * family.
 */
export function formatFamilyPredicate(
  family: FormatFamily,
  paramPrefix = 'fmt',
): { sql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  const branches: string[] = [];

  // `platform:content_type` keys rather than an Array(Tuple(...)) param: the
  // JS client serialises a nested array as an array, which ClickHouse will
  // not parse as a tuple. Neither vocabulary contains a colon.
  const declaredPairs: string[] = [];
  for (const contentType of CONTENT_TYPES) {
    for (const platform of PUBLISH_PLATFORMS) {
      if (FORMAT_BY_CONTENT_TYPE[contentType][platform] === family) {
        declaredPairs.push(`${platform}:${contentType}`);
      }
    }
  }

  const exceeds = (index: number) => {
    const rule = DURATION_REFINEMENTS[index]!;
    params[`${paramPrefix}R${index}Platform`] = rule.platform;
    params[`${paramPrefix}R${index}ContentType`] = rule.contentType;
    params[`${paramPrefix}R${index}Above`] = rule.aboveSeconds;

    return (
      `(platform = {${paramPrefix}R${index}Platform: String}` +
      ` AND content_type = {${paramPrefix}R${index}ContentType: String}` +
      ` AND ifNull(asset_duration_seconds, 0) > {${paramPrefix}R${index}Above: UInt32})`
    );
  };

  if (declaredPairs.length > 0) {
    params[`${paramPrefix}Declared`] = declaredPairs;

    // A declared row leaves its family when a refinement claims it.
    const leaving = DURATION_REFINEMENTS.flatMap((rule, index) =>
      FORMAT_BY_CONTENT_TYPE[rule.contentType][rule.platform] === family &&
      rule.family !== family
        ? [`NOT ${exceeds(index)}`]
        : [],
    );

    branches.push(
      [
        `concat(platform, ':', content_type) IN {${paramPrefix}Declared: Array(String)}`,
        ...leaving,
      ].join(' AND '),
    );
  }

  DURATION_REFINEMENTS.forEach((rule, index) => {
    if (
      rule.family === family &&
      FORMAT_BY_CONTENT_TYPE[rule.contentType][rule.platform] !== family
    ) {
      branches.push(exceeds(index));
    }
  });

  // `live` today: a family nothing maps to selects nothing, said in SQL
  // rather than by an empty IN list ClickHouse would reject.
  if (branches.length === 0) return { sql: '0', params: {} };

  return { sql: `(${branches.map((b) => `(${b})`).join(' OR ')})`, params };
}
