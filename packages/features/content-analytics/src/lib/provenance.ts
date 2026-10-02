import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPlatform,
  COVERAGE_STALE_AFTER_DAYS,
  type CoverageState,
  type MetricFamily,
  OBSERVED_COVERAGE_TABLES,
  type SourceTable,
  capabilityFor,
} from '@kit/clickhouse';

import type { ChannelRef } from '../server/channels';
import { platformLabel } from './platform-labels';
import { NO_PLATFORM_SELECTED } from './platform-selection';
import { SHOWN_ANALYTICS_PLATFORMS } from './shown-platforms';

/**
 * Provenance surfaces (FILM-1705): what the chip on a card, the strip under
 * the page header and the platform filter say, worked out in one place from
 * FILM-1703's matrix and FILM-1704's observed coverage.
 *
 * Pure. No sentence here names a platform: names come from the label map,
 * and every statement about what a platform reports is the matrix's own
 * `note`, rendered verbatim. The templates below say only what the
 * observation says — connected, rows, a window.
 */

/**
 * One (family, platform) cell as a surface reads it: a state once known —
 * the matrix's half immediately — `'pending'` while the observed half is in
 * flight, and `null` when it cannot be measured.
 */
export type CoverageCell = CoverageState | 'pending' | null;

export type FamilyCells = Record<AnalyticsPlatform, CoverageCell>;

/** What a surface knows about the page it sits on. */
export interface CoverageView {
  /** The window in words: "2026-09-01 to 2026-09-30", "the last 52 complete weeks". */
  windowLabel: string;
  /** The cells for a family, capability filled in before any answer. */
  cellsFor: (family: MetricFamily) => FamilyCells;
  /** The connections in scope; `undefined` until the answer arrives. */
  channels: readonly ChannelRef[] | undefined;
  /** Whether ClickHouse was read; `undefined` until the answer arrives. */
  observed: boolean | undefined;
}

/**
 * Why one platform is, or is not, in a figure built from some families.
 *
 * `not_authorised` is FILM-1711's: connected, no rows, and the grant cannot
 * reach the platform's analytics — a different fact from an authorised
 * channel with nothing in the window, and never rendered alike.
 */
export type PlatformCoverage =
  | {
      kind: 'covered';
      latestDate: string;
      stale: boolean;
      /** Some family reaches this platform only by derivation. */
      derived: boolean;
      /** The observation was per table, and the table carries other families too. */
      sharedTable: boolean;
    }
  | { kind: 'no_data_in_window' }
  | { kind: 'not_authorised' }
  | { kind: 'not_connected' }
  | { kind: 'not_ingested' | 'unsupported'; notes: string[] }
  /**
   * `not_observed`: ClickHouse is off here. `not_in_check`: the family's
   * table is not one the coverage query reads. `failed`: the answer did not
   * arrive.
   */
  | { kind: 'unknown'; reason: 'not_observed' | 'not_in_check' | 'failed' }
  | { kind: 'pending' };

const HAS_DATA = new Set(['native', 'derived']);

function hasData(family: MetricFamily, platform: AnalyticsPlatform) {
  return HAS_DATA.has(capabilityFor(family, platform).level);
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** Families whose table is shared with another family — the grain FILM-1704 left. */
function sharesTable(family: MetricFamily, platform: AnalyticsPlatform) {
  const table = capabilityFor(family, platform).table;

  if (table === null) return false;

  return (
    ['engagement', 'reposts', 'watch_time', 'accounts_reached'] as const
  ).some(
    (other) =>
      other !== family && capabilityFor(other, platform).table === table,
  );
}

function isObservedTable(table: SourceTable | null) {
  return (
    table !== null &&
    (OBSERVED_COVERAGE_TABLES as readonly SourceTable[]).includes(table)
  );
}

/**
 * One platform across the families a surface shows. The best observation
 * wins — a figure covers a platform if any family it reads has that
 * platform's rows — and the matrix answers only when no family can have the
 * platform at all.
 */
export function platformCoverage(
  view: Pick<CoverageView, 'cellsFor' | 'channels' | 'observed'>,
  families: readonly MetricFamily[],
  platform: AnalyticsPlatform,
): PlatformCoverage {
  const capable = families.filter((family) => hasData(family, platform));

  if (capable.length === 0) {
    const states = families.map((family) => capabilityFor(family, platform));

    return {
      // "Not yet" is said whenever any of it could be built; "not reported"
      // only when none of it can.
      kind: states.some(({ level }) => level === 'not_ingested')
        ? 'not_ingested'
        : 'unsupported',
      notes: unique(states.map(({ note }) => note)),
    };
  }

  const cells = capable.map((family) => ({
    family,
    cell: view.cellsFor(family)[platform],
  }));

  const covered = cells.flatMap(({ family, cell }) =>
    cell !== null && cell !== 'pending' && cell.kind === 'covered'
      ? [{ family, cell }]
      : [],
  );

  if (covered.length > 0) {
    const latestDate = covered
      .map(({ cell }) => cell.latestDate)
      .reduce((a, b) => (a > b ? a : b));

    return {
      kind: 'covered',
      latestDate,
      stale: covered.every(({ cell }) => cell.stale),
      derived: capable.some(
        (family) => capabilityFor(family, platform).level === 'derived',
      ),
      sharedTable: covered.every(({ family }) => sharesTable(family, platform)),
    };
  }

  const kinds = cells.map(({ cell }) =>
    cell === null ? null : cell === 'pending' ? 'pending' : cell.kind,
  );

  if (kinds.includes('no_data_in_window')) {
    const active = (view.channels ?? []).filter(
      (channel) => channel.platform === platform && channel.isActive,
    );

    return active.length > 0 &&
      active.every((channel) => channel.analyticsAccess === 'not_authorised')
      ? { kind: 'not_authorised' }
      : { kind: 'no_data_in_window' };
  }

  if (kinds.includes('not_connected')) return { kind: 'not_connected' };
  if (kinds.includes('pending')) return { kind: 'pending' };

  return {
    kind: 'unknown',
    reason:
      view.observed === false
        ? 'not_observed'
        : view.observed === undefined
          ? 'failed'
          : capable.some((family) =>
                isObservedTable(capabilityFor(family, platform).table),
              )
            ? 'failed'
            : 'not_in_check',
  };
}

function names(
  channels: readonly ChannelRef[] | undefined,
  platform: string,
): string[] {
  return unique(
    (channels ?? [])
      .filter((channel) => channel.platform === platform && channel.isActive)
      .map((channel) => channel.name),
  );
}

function connectedAs(view: Pick<CoverageView, 'channels'>, platform: string) {
  const list = names(view.channels, platform);

  return list.length > 0 ? ` (${list.join(', ')})` : '';
}

/**
 * Why a platform is absent from a figure, in the strip's words — and in the
 * chip's, the card body's and the filter's (FILM-1709 §4). One builder, so
 * selecting TikTok alone reads the same explanation on every card as the
 * strip gives above them, rather than one empty state per card.
 */
export function absenceSentence(
  view: Pick<CoverageView, 'windowLabel' | 'channels'>,
  platform: AnalyticsPlatform,
  kind: 'no_data_in_window' | 'not_authorised' | 'not_connected',
): string {
  const name = platformLabel(platform);
  const as = connectedAs(view, platform);

  switch (kind) {
    case 'no_data_in_window':
      return `${name}: connected${as}, but no data for ${view.windowLabel}.`;
    case 'not_authorised':
      return `${name}: connected${as}, but analytics access isn’t granted — reconnect it in settings.`;
    case 'not_connected':
      return `${name}: not connected. Connect a channel in settings to include it.`;
  }
}

const UNKNOWN_SENTENCE = {
  not_observed: (name: string, window: string) =>
    `Whether ${name} has data for ${window} can’t be checked on this server.`,
  not_in_check: (name: string, window: string) =>
    `Whether ${name} has data for ${window} isn’t checked for this kind of figure yet.`,
  failed: (name: string, window: string) =>
    `Whether ${name} has data for ${window} couldn’t be checked — the coverage request failed.`,
} as const;

/**
 * What a creator reads about one platform's part in a figure, behind the
 * chip. Each state has its own sentence; none is a bare "no data".
 */
export function coverageLines(
  view: CoverageView,
  families: readonly MetricFamily[],
  platform: AnalyticsPlatform,
  coverage: PlatformCoverage,
): string[] {
  const name = platformLabel(platform);
  const window = view.windowLabel;

  switch (coverage.kind) {
    case 'covered': {
      const notes = unique(
        families
          .filter((family) => hasData(family, platform))
          .map((family) => capabilityFor(family, platform).note),
      );

      return [
        ...notes,
        coverage.stale
          ? `Newest ${name} data is from ${coverage.latestDate}, more than ${COVERAGE_STALE_AFTER_DAYS} days before ${window} ends, so collection may have stopped.`
          : `Newest ${name} data: ${coverage.latestDate}.`,
        ...(coverage.sharedTable
          ? [
              `Checked by whether ${name} has any video data for ${window}, not whether each video carries this figure.`,
            ]
          : []),
      ];
    }
    case 'no_data_in_window':
    case 'not_authorised':
    case 'not_connected':
      return [absenceSentence(view, platform, coverage.kind)];
    case 'not_ingested':
    case 'unsupported':
      return coverage.notes;
    case 'unknown':
      return [UNKNOWN_SENTENCE[coverage.reason](name, window)];
    case 'pending':
      return [`Checking ${name} for ${window}…`];
  }
}

/** Colour encodes level, never platform (FILM-1705 §2). */
export type ChipTone = 'native' | 'derived' | 'partial';

export type ChipState = PlatformCoverage['kind'];

export interface ProvenanceChip {
  label: string;
  tone: ChipTone;
  /** No observation puts a number behind the label: empty, absent or unchecked. */
  muted: boolean;
  /** The state the label speaks for. */
  state: ChipState;
  /** Per platform in scope, in order: what it contributes and why. */
  lines: { platform: AnalyticsPlatform; kind: ChipState; text: string[] }[];
  /** The lines for the chip's own state, for the card body when nothing is covered. */
  bodyLines: string[];
  /**
   * What a covered platform's figure describes when it is not the asset —
   * Instagram's audience is the account's followers, copied onto every post
   * (`account_level`). Said on the card, not only behind the chip, so the
   * figure cannot be read as per-video measurement (FILM-1707).
   */
  scopeLines: string[];
  /** For a figure no platform reports — recorded, or generated — what it is instead. */
  note?: string;
}

function coverageWords(
  platforms: readonly AnalyticsPlatform[],
  total: number,
  upTo: boolean,
) {
  if (platforms.length === 1) return `${platformLabel(platforms[0]!)} only`;

  // Every platform the filter left in: named, since "All 2 platforms"
  // reads as though there were only two (FILM-1709).
  if (platforms.length === total && total < SHOWN_ANALYTICS_PLATFORMS.length) {
    return `${upTo ? 'Up to ' : ''}${platforms.map(platformLabel).join(' + ')}`;
  }

  const prefix = upTo ? 'Up to ' : '';

  return platforms.length === total
    ? `${prefix}${upTo ? '' : 'All '}${total} platforms`
    : `${prefix}${platforms.length} of ${total} platforms`;
}

function toneFor(
  families: readonly MetricFamily[],
  named: readonly AnalyticsPlatform[],
  total: number,
): { tone: ChipTone; suffix: string } {
  const derived = named.filter((platform) =>
    families.some(
      (family) => capabilityFor(family, platform).level === 'derived',
    ),
  );

  if (derived.length > 0) {
    return {
      tone: 'derived',
      suffix:
        derived.length === named.length ? ' · derived' : ' · partly derived',
    };
  }

  return { tone: named.length < total ? 'partial' : 'native', suffix: '' };
}

/**
 * The chip: "what does this number cover?" — for the families a card reads,
 * over the platforms its figure spans.
 */
export function provenanceChip(
  view: CoverageView,
  families: readonly MetricFamily[],
  platforms: readonly AnalyticsPlatform[] = SHOWN_ANALYTICS_PLATFORMS,
): ProvenanceChip {
  const chip = chipFor(view, families, platforms);

  return {
    ...chip,
    scopeLines: accountLevelLines(
      families,
      chip.lines
        .filter(({ kind }) => kind === 'covered')
        .map(({ platform }) => platform),
    ),
  };
}

/** The matrix's note for each covered platform whose figure is the account's. */
export function accountLevelLines(
  families: readonly MetricFamily[],
  covered: readonly AnalyticsPlatform[],
): string[] {
  return unique(
    covered.flatMap((platform) =>
      families
        .map((family) => capabilityFor(family, platform))
        .filter((capability) => capability.method === 'account_level')
        .map(({ note }) => note),
    ),
  );
}

function chipFor(
  view: CoverageView,
  families: readonly MetricFamily[],
  platforms: readonly AnalyticsPlatform[],
): Omit<ProvenanceChip, 'scopeLines'> {
  const per = platforms.map((platform) => {
    const coverage = platformCoverage(view, families, platform);

    return {
      platform,
      coverage,
      text: coverageLines(view, families, platform, coverage),
    };
  });

  const lines = per.map(({ platform, coverage, text }) => ({
    platform,
    kind: coverage.kind,
    text,
  }));

  const having = (...kinds: ChipState[]) =>
    per
      .filter(({ coverage }) => kinds.includes(coverage.kind))
      .map(({ platform }) => platform);

  const bodyFor = (...kinds: ChipState[]) =>
    per
      .filter(({ coverage }) => kinds.includes(coverage.kind))
      .flatMap(({ text }) => text);

  const total = platforms.length;
  const capable = platforms.filter((platform) =>
    families.some((family) => hasData(family, platform)),
  );

  if (capable.length === 0) {
    const state =
      having('not_ingested').length > 0 ? 'not_ingested' : 'unsupported';

    return {
      label: state === 'not_ingested' ? 'Not yet supported' : 'Not reported',
      tone: 'partial',
      muted: true,
      state,
      lines,
      bodyLines: unique(bodyFor('not_ingested', 'unsupported')),
    };
  }

  const labelled = (
    named: AnalyticsPlatform[],
    state: ChipState,
    muted: boolean,
    upTo = false,
  ): Omit<ProvenanceChip, 'scopeLines'> => {
    const { tone, suffix } = toneFor(families, named, total);

    return {
      label: `${coverageWords(named, total, upTo)}${suffix}`,
      tone,
      muted,
      state,
      lines,
      bodyLines: muted ? bodyFor(state) : [],
    };
  };

  const covered = having('covered');

  if (covered.length > 0) return labelled(covered, 'covered', false);

  const empty = having('no_data_in_window', 'not_authorised');

  if (empty.length > 0) {
    const state =
      having('no_data_in_window').length > 0
        ? 'no_data_in_window'
        : 'not_authorised';

    return {
      ...labelled(empty, state, true),
      bodyLines: bodyFor('no_data_in_window', 'not_authorised'),
    };
  }

  const reachable = capable.filter(
    (platform) =>
      per.find((entry) => entry.platform === platform)?.coverage.kind !==
      'not_connected',
  );

  if (reachable.length === 0) {
    return {
      label: 'Not connected',
      tone: 'partial',
      muted: true,
      state: 'not_connected',
      lines,
      bodyLines: bodyFor('not_connected'),
    };
  }

  // Only the capability is known: name what the figure can cover, and say
  // "up to" where no observation will ever narrow it.
  const pending = having('pending').length > 0;

  return {
    ...labelled(reachable, pending ? 'pending' : 'unknown', false, true),
    bodyLines: [],
  };
}

/** The strip: "why is my TikTok missing?" — one item per platform. */
export type StripKind =
  | 'covered'
  | 'stale'
  | 'no_data_in_window'
  | 'not_authorised'
  | 'not_connected'
  | 'not_ingested'
  | 'not_reported'
  | 'unsupported_platform'
  | 'unknown'
  | 'pending';

export interface StripItem {
  platform: string;
  kind: StripKind;
  sentence: string;
}

export interface CoverageStrip {
  /** Said instead of the items when nothing is connected and nothing is covered. */
  summary: string | null;
  items: StripItem[];
}

export const NO_CHANNELS_SENTENCE =
  'No channels are connected to this project yet. Connect one in settings and its analytics appear here.';

export function coverageStrip(
  view: CoverageView,
  families: readonly MetricFamily[],
): CoverageStrip {
  const window = view.windowLabel;

  const items: StripItem[] = SHOWN_ANALYTICS_PLATFORMS.map((platform) => {
    const name = platformLabel(platform);
    const coverage = platformCoverage(view, families, platform);

    switch (coverage.kind) {
      case 'covered':
        return coverage.stale
          ? {
              platform,
              kind: 'stale',
              sentence: `${name}: nothing newer than ${coverage.latestDate}, so collection may have stopped.`,
            }
          : {
              platform,
              kind: 'covered',
              sentence: `${name}: data through ${coverage.latestDate}.`,
            };
      case 'no_data_in_window':
      case 'not_authorised':
      case 'not_connected':
        return {
          platform,
          kind: coverage.kind,
          sentence: absenceSentence(view, platform, coverage.kind),
        };
      case 'not_ingested':
        return {
          platform,
          kind: 'not_ingested',
          sentence: `${name}: what this tab shows isn’t collected from ${name} yet.`,
        };
      case 'unsupported':
        return {
          platform,
          kind: 'not_reported',
          sentence: `${name}: doesn’t report what this tab shows.`,
        };
      case 'unknown':
        return {
          platform,
          kind: 'unknown',
          sentence: `${name}: whether it has data for ${window} can’t be checked here.`,
        };
      case 'pending':
        return {
          platform,
          kind: 'pending',
          sentence: `${name}: checking…`,
        };
    }
  });

  // A connection on a platform outside `AnalyticsPlatform` is named, not
  // dropped (FILM-1705 §6): hiding it is what left creators wondering.
  const known: readonly string[] = ANALYTICS_PLATFORMS;
  const others = unique(
    (view.channels ?? [])
      .map((channel) => channel.platform)
      .filter((platform) => !known.includes(platform)),
  );

  for (const platform of others) {
    const name = platformLabel(platform);
    const list = unique(
      (view.channels ?? [])
        .filter((channel) => channel.platform === platform)
        .map((channel) => channel.name),
    );

    items.push({
      platform,
      kind: 'unsupported_platform',
      sentence: `${name} (${list.join(', ')}): connected, but analytics doesn’t support ${name}.`,
    });
  }

  const nothing =
    view.channels !== undefined &&
    view.channels.length === 0 &&
    !items.some((item) => item.kind === 'covered' || item.kind === 'stale');

  return { summary: nothing ? NO_CHANNELS_SENTENCE : null, items };
}

/**
 * The platform filter's third state (FILM-1705 §3): a platform no card on
 * the tab can cover is offered dimmed, with the strip's own sentence as the
 * reason, and stays selectable. Only reasons that do not depend on the
 * window dim it — the filter sits above every tab's window.
 */
export function filterAvailability(strip: CoverageStrip): {
  available: AnalyticsPlatform[];
  reasons: Partial<Record<AnalyticsPlatform, string>>;
} {
  const dims: readonly StripKind[] = [
    'not_connected',
    'not_ingested',
    'not_reported',
  ];
  const reasons: Partial<Record<AnalyticsPlatform, string>> = {};
  const available: AnalyticsPlatform[] = [];

  for (const platform of SHOWN_ANALYTICS_PLATFORMS) {
    const item = strip.items.find((entry) => entry.platform === platform);

    if (item && dims.includes(item.kind)) {
      reasons[platform] = item.sentence;
    } else {
      available.push(platform);
    }
  }

  return { available, reasons };
}

/**
 * Whether a card dims under the filter: it does when none of the selected
 * platforms is one it can cover. It never blanks — the figure stays, and the
 * reason is the matrix's note for each selected platform.
 */
export function cardDimming(
  families: readonly MetricFamily[],
  selected: readonly AnalyticsPlatform[],
  platforms: readonly AnalyticsPlatform[] = SHOWN_ANALYTICS_PLATFORMS,
): { dimmed: false } | { dimmed: true; reasons: string[] } {
  if (families.length === 0) return { dimmed: false };

  if (selected.length === 0) {
    return { dimmed: true, reasons: [NO_PLATFORM_SELECTED] };
  }

  const capable = platforms.filter((platform) =>
    families.some((family) => hasData(family, platform)),
  );

  if (selected.some((platform) => capable.includes(platform))) {
    return { dimmed: false };
  }

  return {
    dimmed: true,
    reasons: unique(
      selected.flatMap((platform) =>
        platforms.includes(platform)
          ? families.map((family) => capabilityFor(family, platform).note)
          : [
              `This card is about ${platforms.map(platformLabel).join(' and ')} only.`,
            ],
      ),
    ),
  };
}

/**
 * The families each tab's cards read, for the strip and the filter. A
 * suite reads the tabs' `metricFamily` props and fails when a card shows a
 * family missing here, so the list cannot quietly fall behind the cards.
 */
export const TAB_FAMILIES = {
  overview: ['engagement', 'geography', 'demographics'],
  content: ['engagement'],
  audience: ['demographics', 'geography', 'device'],
  'deep-dive': [
    'engagement',
    'traffic_sources',
    'follower_status',
    'channel_totals',
    'watch_time',
    'reach',
    'retention_curve',
  ],
  'video-log': ['engagement', 'reach', 'watch_time', 'revenue'],
  language: ['engagement', 'geography', 'revenue'],
  // A model's reading of the page's own figures: what it was given is the
  // page's engagement totals, so that is what the strip speaks for.
  insights: ['engagement'],
} as const satisfies Record<string, readonly MetricFamily[]>;

export type AnalyticsTab = keyof typeof TAB_FAMILIES;

export function isAnalyticsTab(value: string): value is AnalyticsTab {
  return value in TAB_FAMILIES;
}
