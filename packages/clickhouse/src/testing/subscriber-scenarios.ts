/**
 * The channel states every subscriber surface must handle (FILM-1617).
 *
 * One fixture set for every package's scenario test — the ClickHouse
 * readers, the Deep Dive card, the YPP card and the follower chip — so a
 * fix to one surface is checked against every state on every surface, not
 * only the state its bug report described. Seven review rounds on PR #262
 * found issues one state at a time; this is the list they should have been
 * checked against from the start.
 *
 * Plain data and pure helpers: nothing here touches a database.
 */
import type {
  SubscriberAnchor,
  SubscriberDelta,
} from '../lib/subscriber-series';

/** Every scenario is read on this day, over a one-year window. */
export const SCENARIO_TODAY = '2026-09-18';
export const SCENARIO_WINDOW_FROM = '2025-09-18';

export type ScenarioId =
  | 'never-measured'
  | 'hidden-count'
  | 'untracked-platform'
  | 'new-one-snapshot'
  | 'healthy-rounded'
  | 'healthy-exact'
  | 'capture-gap'
  | 'active-stopped-in-window'
  | 'active-stopped-before-window'
  | 'disconnected-in-window'
  | 'disconnected-before-window'
  | 'disconnected-never-measured'
  | 'snapshots-only';

export interface SubscriberScenario {
  id: ScenarioId;
  connectionId: string;
  name: string;
  platform: 'youtube' | 'facebook' | 'tiktok';
  isActive: boolean;
  anchors: SubscriberAnchor[];
  deltas: SubscriberDelta[];
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Daily history from `from` to `to`: a true level rising by `dailyNet`,
 * a delta every day after the first, and an anchor every day outside
 * `gap` — reported rounded down to `roundingStep` when it is non-zero, as
 * YouTube does above 1,000.
 */
function history(options: {
  from: string;
  to: string;
  start: number;
  dailyNet: number;
  roundingStep: number;
  gap?: { from: string; to: string };
}): { anchors: SubscriberAnchor[]; deltas: SubscriberDelta[] } {
  const anchors: SubscriberAnchor[] = [];
  const deltas: SubscriberDelta[] = [];

  let level = options.start;

  for (let day = options.from; day <= options.to; day = addDays(day, 1)) {
    if (day !== options.from) {
      level += options.dailyNet;
      deltas.push({ metricDate: day, net: options.dailyNet });
    }

    const inGap =
      options.gap !== undefined &&
      day >= options.gap.from &&
      day <= options.gap.to;

    if (!inGap) {
      const step = options.roundingStep;

      anchors.push({
        snapshotDate: day,
        subscriberCount: step > 0 ? Math.floor(level / step) * step : level,
        roundingStep: step,
      });
    }
  }

  return { anchors, deltas };
}

const YESTERDAY = addDays(SCENARIO_TODAY, -1);

/**
 * The `snapshots-only` channel's recorded follower counts, weekly. Exported
 * so a surface's test can check its figures against what was recorded.
 * Uneven on purpose: 70, then 35, then 105 a week, so a straight line
 * between each pair is distinguishable from one line across them all. The
 * last count is four days old while the daily rows run to yesterday, as a
 * weekly capture beside a daily sync leaves them: the unmeasured days after
 * it must not extend the curve.
 */
export const SNAPSHOTS_ONLY_COUNTS: ReadonlyArray<[string, number]> = [
  ['2026-08-20', 1_000],
  ['2026-08-27', 1_070],
  ['2026-09-03', 1_105],
  ['2026-09-10', 1_210],
  ['2026-09-14', 1_260],
];

/** A day's row with no measured movement: as a TikTok video's would be. */
function dailyUnmeasured(from: string, to: string): SubscriberDelta[] {
  const deltas: SubscriberDelta[] = [];

  for (let day = from; day <= to; day = addDays(day, 1)) {
    deltas.push({ metricDate: day, net: 0, measured: false });
  }

  return deltas;
}

function scenario(
  id: ScenarioId,
  fields: Omit<
    SubscriberScenario,
    'id' | 'connectionId' | 'anchors' | 'deltas'
  > &
    Partial<Pick<SubscriberScenario, 'anchors' | 'deltas'>>,
): SubscriberScenario {
  return {
    id,
    connectionId: `conn-${id}`,
    anchors: [],
    deltas: [],
    ...fields,
  };
}

export const SUBSCRIBER_SCENARIOS: SubscriberScenario[] = [
  scenario('never-measured', {
    name: 'Never Measured',
    platform: 'youtube',
    isActive: true,
  }),
  // Movement arrives from video metrics; the owner hides the count, so no
  // snapshot ever does.
  scenario('hidden-count', {
    name: 'Hidden Count',
    platform: 'youtube',
    isActive: true,
    deltas: history({
      from: '2026-07-20',
      to: YESTERDAY,
      start: 0,
      dailyNet: 3,
      roundingStep: 0,
    }).deltas,
  }),
  // Allowed by `platform_connections.platform`, never snapshotted.
  scenario('untracked-platform', {
    name: 'Facebook Page',
    platform: 'facebook',
    isActive: true,
  }),
  scenario('new-one-snapshot', {
    name: 'New Channel',
    platform: 'youtube',
    isActive: true,
    anchors: [
      { snapshotDate: YESTERDAY, subscriberCount: 480, roundingStep: 0 },
    ],
  }),
  scenario('healthy-rounded', {
    name: 'Rounded Channel',
    platform: 'youtube',
    isActive: true,
    ...history({
      from: '2026-03-01',
      to: YESTERDAY,
      start: 40_150,
      dailyNet: 12,
      roundingStep: 100,
    }),
  }),
  scenario('healthy-exact', {
    name: 'Exact Channel',
    platform: 'youtube',
    isActive: true,
    ...history({
      from: '2026-06-01',
      to: YESTERDAY,
      start: 600,
      dailyNet: 3,
      roundingStep: 0,
    }),
  }),
  scenario('capture-gap', {
    name: 'Gap Channel',
    platform: 'youtube',
    isActive: true,
    ...history({
      from: '2026-06-01',
      to: YESTERDAY,
      start: 700,
      dailyNet: 2,
      roundingStep: 0,
      gap: { from: '2026-08-01', to: '2026-08-20' },
    }),
  }),
  scenario('active-stopped-in-window', {
    name: 'Stopped Channel',
    platform: 'youtube',
    isActive: true,
    ...history({
      from: '2026-02-01',
      to: '2026-06-30',
      start: 800,
      dailyNet: 1,
      roundingStep: 0,
    }),
  }),
  scenario('active-stopped-before-window', {
    name: 'Long Stopped Channel',
    platform: 'youtube',
    isActive: true,
    ...history({
      from: '2025-01-01',
      to: '2025-06-30',
      start: 900,
      dailyNet: 1,
      roundingStep: 0,
    }),
  }),
  scenario('disconnected-in-window', {
    name: 'Retired Channel',
    platform: 'youtube',
    isActive: false,
    ...history({
      from: '2026-02-01',
      to: '2026-06-30',
      start: 2_300,
      dailyNet: 1,
      roundingStep: 10,
    }),
  }),
  scenario('disconnected-before-window', {
    name: 'Long Retired Channel',
    platform: 'youtube',
    isActive: false,
    ...history({
      from: '2025-01-01',
      to: '2025-06-30',
      start: 950,
      dailyNet: 1,
      roundingStep: 0,
    }),
  }),
  scenario('disconnected-never-measured', {
    name: 'Retired Unmeasured',
    platform: 'youtube',
    isActive: false,
  }),
  // TikTok reports no per-video gains or losses (KB-114): a follower count a
  // week, and daily rows whose movement was never measured. Decided
  // 2026-09-25: straight lines between the recorded counts, labelled as
  // reconstructed, never as daily movement.
  scenario('snapshots-only', {
    name: 'TikTok Channel',
    platform: 'tiktok',
    isActive: true,
    anchors: SNAPSHOTS_ONLY_COUNTS.map(([snapshotDate, subscriberCount]) => ({
      snapshotDate,
      subscriberCount,
      roundingStep: 0,
    })),
    deltas: dailyUnmeasured('2026-08-21', YESTERDAY),
  }),
];

export function scenarioById(id: ScenarioId): SubscriberScenario {
  const found = SUBSCRIBER_SCENARIOS.find((s) => s.id === id);

  if (!found) throw new Error(`No subscriber scenario ${id}`);

  return found;
}
