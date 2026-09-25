import type { Rng } from '../rng';
import { ARCHETYPES, type Archetype } from './growth';

/**
 * An object's performance profile (FILM-1802 §4): an archetype that fixes
 * the curve's shape, a long-tailed lifetime scale, and per-metric ratios
 * drawn around platform-plausible centres, so one object's figures agree
 * with each other.
 *
 * The centres are this sandbox's assumptions, not measurements: plausible
 * orders of magnitude for a small creator, stated here so a reader can see
 * and change them. A figure from this sandbox is an example, never a
 * benchmark.
 */

export const PLATFORMS = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'x',
  'linkedin',
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** Each ratio is per view, except `completion` (a share of the length watched). */
export const RATIO_NAMES = [
  'likes',
  'comments',
  'shares',
  'saves',
  'follows',
  'completion',
] as const;

export type RatioName = (typeof RATIO_NAMES)[number];

interface PlatformCentres {
  /** Median lifetime views and the spread of their log. */
  medianViews: number;
  logSpread: number;
  ratios: Record<RatioName, number>;
}

export const CENTRES: Record<Platform, PlatformCentres> = {
  youtube: {
    medianViews: 1_400,
    logSpread: 1.7,
    ratios: {
      likes: 0.041,
      comments: 0.0042,
      shares: 0.0031,
      saves: 0,
      follows: 0.0023,
      completion: 0.43,
    },
  },
  tiktok: {
    medianViews: 2_900,
    logSpread: 1.9,
    ratios: {
      likes: 0.074,
      comments: 0.0028,
      shares: 0.0046,
      saves: 0.0061,
      follows: 0.0017,
      completion: 0.36,
    },
  },
  instagram: {
    medianViews: 1_150,
    logSpread: 1.6,
    ratios: {
      likes: 0.057,
      comments: 0.0033,
      shares: 0.0072,
      saves: 0.0049,
      follows: 0.0021,
      completion: 0.39,
    },
  },
  facebook: {
    medianViews: 640,
    logSpread: 1.5,
    ratios: {
      likes: 0.027,
      comments: 0.0026,
      shares: 0.0038,
      saves: 0,
      follows: 0.0011,
      completion: 0.31,
    },
  },
  x: {
    medianViews: 430,
    logSpread: 1.6,
    ratios: {
      likes: 0.019,
      comments: 0.0021,
      shares: 0.0029,
      saves: 0.0012,
      follows: 0.0008,
      completion: 0.28,
    },
  },
  linkedin: {
    medianViews: 310,
    logSpread: 1.4,
    ratios: {
      likes: 0.022,
      comments: 0.0034,
      shares: 0.0017,
      saves: 0,
      follows: 0.0014,
      completion: 0.33,
    },
  },
};

export interface Profile {
  archetype: Archetype;
  /** Lifetime views: the figure the growth curve tends to. */
  lifetimeViews: number;
  ratios: Record<RatioName, number>;
}

/** A standard normal draw (Box–Muller). */
export function normal(rng: Rng) {
  const u = Math.max(rng.next(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

/** How often each archetype is drawn: most things flop or fade. */
const ARCHETYPE_WEIGHTS: Record<Archetype, number> = {
  breakout: 0.06,
  steady: 0.22,
  'slow-burn': 0.1,
  flop: 0.34,
  decaying: 0.28,
};

function drawArchetype(rng: Rng): Archetype {
  let roll = rng.next();
  for (const archetype of ARCHETYPES) {
    roll -= ARCHETYPE_WEIGHTS[archetype];
    if (roll < 0) return archetype;
  }
  return 'decaying';
}

const ARCHETYPE_SCALE: Record<Archetype, number> = {
  breakout: 9,
  steady: 1.6,
  'slow-burn': 2.4,
  flop: 0.12,
  decaying: 0.8,
};

export function drawProfile(rng: Rng, platform: Platform): Profile {
  const centre = CENTRES[platform];
  const archetype = drawArchetype(rng);

  // Log-normal: most objects small, a few large, as on real platforms.
  const lifetimeViews = Math.max(
    37,
    Math.round(
      centre.medianViews *
        ARCHETYPE_SCALE[archetype] *
        Math.exp(centre.logSpread * normal(rng)),
    ),
  );

  const ratios = Object.fromEntries(
    RATIO_NAMES.map((name) => {
      const middle = centre.ratios[name];
      if (middle === 0) return [name, 0];
      const drawn = middle * Math.exp(0.35 * normal(rng));
      return [name, Math.min(name === 'completion' ? 0.97 : 0.5, drawn)];
    }),
  ) as Record<RatioName, number>;

  return { archetype, lifetimeViews, ratios };
}
