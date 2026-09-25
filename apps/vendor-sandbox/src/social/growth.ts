/**
 * How an object's figures grow (FILM-1802 §4). Pure: no clock, no state.
 *
 * The app's clock is real and cannot be accelerated, so `speed` (simulated
 * seconds per real second) accelerates each object's growth, not the
 * calendar. A cumulative figure at real time t is
 *
 *     round-down(lifetime × curve(simulated age at t))
 *
 * with `curve` non-decreasing from 0, so a total never decreases. A daily
 * figure on a real date is the cumulative at that day's end (or now) minus
 * the cumulative at its start, so dailies are never negative and always sum
 * to the total, at any speed. `speed = 0` freezes everything at zero.
 */

export const ARCHETYPES = [
  'breakout',
  'steady',
  'slow-burn',
  'flop',
  'decaying',
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

const DAY_MS = 86_400_000;

function logistic(x: number) {
  return 1 / (1 + Math.exp(-x));
}

/** A logistic rescaled so that it is 0 at age 0 and tends to 1. */
function lateRise(days: number, centre: number, width: number) {
  const start = logistic(-centre / width);
  return (logistic((days - centre) / width) - start) / (1 - start);
}

/**
 * The share of an object's lifetime total reached at a simulated age in
 * days: 0 at 0, non-decreasing, at most 1.
 */
export function curve(archetype: Archetype, days: number): number {
  if (!(days > 0)) return 0;

  switch (archetype) {
    // A quiet first days, then a surge that most of the total arrives in.
    case 'breakout':
      return 0.15 * (1 - Math.exp(-days / 2)) + 0.85 * lateRise(days, 6, 1.5);
    // Near-linear for months: evergreen, search-driven.
    case 'steady':
      return 1 - Math.exp(-days / 120);
    // Almost nothing for weeks, then found.
    case 'slow-burn':
      return lateRise(days, 35, 7);
    // Seen by the followers who were around that day, then nobody.
    case 'flop':
      return 1 - Math.exp(-days / 1.2);
    // A good first week, fading.
    case 'decaying':
      return 1 - Math.exp(-days / 4);
  }
}

/** Simulated age in days of something published at `publishedMs`. */
export function simulatedDays(
  publishedMs: number,
  nowMs: number,
  speed: number,
) {
  if (speed <= 0 || nowMs <= publishedMs) return 0;
  return ((nowMs - publishedMs) * speed) / DAY_MS;
}

export interface Growth {
  archetype: Archetype;
  /** The figure the curve tends to. */
  lifetime: number;
  publishedMs: number;
}

/** The cumulative figure at real time `atMs`: a non-negative integer. */
export function cumulativeAt(growth: Growth, atMs: number, speed: number) {
  return Math.floor(
    growth.lifetime *
      curve(growth.archetype, simulatedDays(growth.publishedMs, atMs, speed)),
  );
}

/**
 * The figure as the vendor reports it at `nowMs` when it lags by `delay`
 * simulated milliseconds (YouTube's 48–72 hour processing): the cumulative
 * at the moment that is `delay` of simulated time ago. The lag shrinks with
 * speed, as the spec asks.
 */
export function reportedAt(
  growth: Growth,
  nowMs: number,
  speed: number,
  delaySimulatedMs = 0,
) {
  if (speed <= 0) return 0;
  return cumulativeAt(growth, nowMs - delaySimulatedMs / speed, speed);
}

/**
 * Figures a person reads as made up: 1,000, 10,000, 12,345, 99,999. A figure
 * that lands on one is shown as the next figure that is not one (999 → 1,001).
 * "The smallest non-sentinel at or above v" is non-decreasing in v, so totals
 * still never fall and dailies, being differences of it, still sum to totals.
 */
export const ROUND_SENTINELS: ReadonlySet<number> = new Set([
  100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 999, 9_999, 99_999,
  999_999, 1_234, 12_345, 123_456, 500, 5_000, 50_000, 500_000,
]);

export function avoidSentinel(value: number) {
  let shown = value;
  while (ROUND_SENTINELS.has(shown)) shown += 1;
  return shown;
}

export interface DailyRow {
  /** A real UTC date, `YYYY-MM-DD`. */
  date: string;
  value: number;
}

/**
 * One row per real UTC date from `fromDate` to `toDate` inclusive, each the
 * increase within that day of a cumulative figure as it stands at `nowMs`.
 * A day after `nowMs` holds 0. Because every row is a difference of the same
 * non-decreasing function, rows are never negative and rows over an
 * object's whole life sum to its total.
 */
export function dailySeries(
  cumulative: (atMs: number) => number,
  fromDate: string,
  toDate: string,
  nowMs: number,
): DailyRow[] {
  const rows: DailyRow[] = [];
  const at = (ms: number) => cumulative(Math.min(ms, nowMs));

  for (
    let day = Date.parse(`${fromDate}T00:00:00Z`);
    day <= Date.parse(`${toDate}T00:00:00Z`);
    day += DAY_MS
  ) {
    rows.push({
      date: new Date(day).toISOString().slice(0, 10),
      value: at(day + DAY_MS) - at(day),
    });
  }

  return rows;
}
