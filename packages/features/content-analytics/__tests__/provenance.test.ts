import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_PLATFORMS,
  CAPABILITY_MATRIX,
  METRIC_FAMILIES,
  type MetricFamily,
  type ObservedCoverageRow,
  capabilityCoverage,
  capabilityFor,
} from '@kit/clickhouse';

import type { CoverageMatrixResult } from '../src/lib/coverage';
import {
  type CoverageView,
  NO_CHANNELS_SENTENCE,
  TAB_FAMILIES,
  cardDimming,
  coverageStrip,
  filterAvailability,
  provenanceChip,
} from '../src/lib/provenance';
import type { ChannelRef } from '../src/server/channels';
import { channelRef, coverageResult } from './helpers/coverage';

/**
 * FILM-1705: the chip, the strip and the filter's third state, worked out
 * from FILM-1703's matrix and FILM-1704's observed coverage. The fixture is
 * the spec's §8 page: one platform covered, one connected but empty, one not
 * connected, and a connected platform analytics does not support.
 */

const WINDOW = '2026-09-01 to 2026-09-30';

function viewOf(
  result: CoverageMatrixResult | undefined,
  status: 'pending' | 'error' | 'success' = result ? 'success' : 'pending',
): CoverageView {
  return {
    windowLabel: WINDOW,
    cellsFor: (family: MetricFamily) =>
      Object.fromEntries(
        ANALYTICS_PLATFORMS.map((platform) => {
          const fromMatrix = capabilityCoverage(
            CAPABILITY_MATRIX[family][platform],
          );

          if (fromMatrix) return [platform, fromMatrix];
          if (status === 'success' && result) {
            return [platform, result.matrix[family][platform]];
          }

          return [platform, status === 'error' ? null : 'pending'];
        }),
      ) as ReturnType<CoverageView['cellsFor']>,
    channels: status === 'success' ? result?.channels : undefined,
    observed: status === 'success' ? result?.observed : undefined,
  };
}

const row = (
  table: ObservedCoverageRow['table'],
  platform: string,
  latestDate = '2026-09-29',
): ObservedCoverageRow => ({
  table,
  platform,
  rows: 10,
  latestDate,
  metricSources: [],
});

// YouTube has rows; TikTok is connected and has none; Instagram is not
// connected; a Facebook page is connected.
const SEEDED: ChannelRef[] = [
  channelRef('youtube', { name: 'Seed Studio' }),
  channelRef('tiktok', { name: '@seedstudio' }),
  channelRef('facebook', { name: 'Seed Studio Page' }),
];

const seeded = viewOf(
  coverageResult({
    rows: [
      row('video_metrics', 'youtube'),
      row('video_traffic_sources', 'youtube'),
      row('channel_daily', 'youtube'),
    ],
    channels: SEEDED,
  }),
);

describe('the chip', () => {
  it('on a traffic card says YouTube only', () => {
    expect(provenanceChip(seeded, ['traffic_sources']).label).toBe(
      'YouTube only',
    );
  });

  it('on the median card says what it pools, not what it could', () => {
    expect(provenanceChip(seeded, ['engagement']).label).toBe('YouTube only');

    const both = viewOf(
      coverageResult({
        rows: [row('video_metrics', 'youtube'), row('video_metrics', 'tiktok')],
        channels: SEEDED,
      }),
    );

    expect(provenanceChip(both, ['engagement'])).toMatchObject({
      label: '2 of 5 platforms · partly derived',
      tone: 'derived',
      state: 'covered',
      muted: false,
    });
  });

  it('colours level, not platform: native is neutral, a partial span is info', () => {
    expect(provenanceChip(seeded, ['traffic_sources']).tone).toBe('partial');
    expect(provenanceChip(seeded, ['traffic_sources'], ['youtube']).tone).toBe(
      'native',
    );
  });

  it('speaks each platform’s state in its own sentence, from the matrix where the matrix answers', () => {
    const chip = provenanceChip(seeded, ['traffic_sources']);
    const line = (platform: string) =>
      chip.lines.find((entry) => entry.platform === platform)!;

    expect(line('youtube').kind).toBe('covered');
    expect(line('youtube').text).toContain(
      capabilityFor('traffic_sources', 'youtube').note,
    );
    expect(line('tiktok')).toMatchObject({
      kind: 'not_ingested',
      text: [capabilityFor('traffic_sources', 'tiktok').note],
    });
    expect(line('instagram')).toMatchObject({
      kind: 'unsupported',
      text: [capabilityFor('traffic_sources', 'instagram').note],
    });
  });

  it('is muted, and names the empty channel and the window, when connected platforms have no rows', () => {
    const empty = viewOf(
      coverageResult({ rows: [], channels: [channelRef('tiktok')] }),
    );
    const chip = provenanceChip(empty, ['engagement']);

    expect(chip).toMatchObject({
      label: 'TikTok only · derived',
      muted: true,
      state: 'no_data_in_window',
    });
    expect(chip.bodyLines).toEqual([
      `TikTok: connected (tiktok channel), but no data for ${WINDOW}.`,
    ]);
  });

  it('says not connected, and invites connecting, when no capable platform is', () => {
    const none = viewOf(coverageResult({ rows: [], channels: [] }));
    const chip = provenanceChip(none, ['traffic_sources']);

    expect(chip).toMatchObject({ label: 'Not connected', muted: true });
    expect(chip.bodyLines.join(' ')).toBe(
      'YouTube: not connected. Connect a channel in settings to include it.',
    );
  });

  it('says not yet supported, or not reported, when the matrix rules every platform out', () => {
    // Watch time, on TikTok alone: not_ingested. (Revenue was the example
    // until FILM-1726 stored YouTube's earnings.)
    expect(provenanceChip(seeded, ['watch_time'], ['tiktok'])).toMatchObject({
      label: 'Not yet supported',
      state: 'not_ingested',
    });
    expect(provenanceChip(seeded, ['revenue']).label).toBe('YouTube only');
    expect(
      provenanceChip(seeded, ['device'], ['tiktok', 'instagram']),
    ).toMatchObject({
      label: 'Not reported',
      state: 'unsupported',
    });
  });

  it('keeps not authorised apart from no data in the window', () => {
    const unauthorised = viewOf(
      coverageResult({
        rows: [],
        channels: [channelRef('tiktok', { analyticsAccess: 'not_authorised' })],
      }),
    );
    const authorised = viewOf(
      coverageResult({ rows: [], channels: [channelRef('tiktok')] }),
    );

    const a = provenanceChip(unauthorised, ['engagement']);
    const b = provenanceChip(authorised, ['engagement']);

    expect(a.state).toBe('not_authorised');
    expect(b.state).toBe('no_data_in_window');
    expect(a.bodyLines).not.toEqual(b.bodyLines);
    expect(a.bodyLines.join(' ')).toMatch(/analytics access isn’t granted/);
  });

  it('claims only “up to” what it can cover while coverage cannot be measured', () => {
    const off = viewOf(
      coverageResult({ rows: [], channels: SEEDED, observed: false }),
    );

    expect(provenanceChip(off, ['engagement'])).toMatchObject({
      // Instagram and X are not connected, so they are not in "up to".
      label: 'Up to 3 of 5 platforms · partly derived',
      state: 'unknown',
    });
    // The audience families' table is not read by the coverage query.
    expect(
      provenanceChip(seeded, ['demographics']).lines.find(
        ({ platform }) => platform === 'youtube',
      )?.text,
    ).toEqual([
      `Whether YouTube has data for ${WINDOW} isn’t checked for this kind of figure yet.`,
    ]);
  });

  it('paints from capability before the answer arrives', () => {
    expect(
      provenanceChip(viewOf(undefined), ['traffic_sources']),
    ).toMatchObject({ label: 'YouTube only', state: 'pending' });
    expect(provenanceChip(viewOf(undefined), ['engagement'])).toMatchObject({
      label: 'Up to 5 platforms · partly derived',
      state: 'pending',
    });
  });

  it('says a shared-table family is checked by the table, not by its column', () => {
    const lines = provenanceChip(seeded, ['watch_time']).lines.find(
      ({ platform }) => platform === 'youtube',
    )!.text;

    expect(lines.join(' ')).toMatch(
      /not whether each video carries this figure/,
    );
    // Traffic sources has a table of its own.
    expect(
      provenanceChip(seeded, ['traffic_sources'])
        .lines.find(({ platform }) => platform === 'youtube')!
        .text.join(' '),
    ).not.toMatch(/each video carries/);
  });

  it('flags stale coverage in words', () => {
    const stale = viewOf(
      coverageResult({
        rows: [row('video_traffic_sources', 'youtube', '2026-08-01')],
        channels: SEEDED,
      }),
    );

    expect(
      provenanceChip(stale, ['traffic_sources']).lines[0]!.text.join(' '),
    ).toMatch(/collection may have stopped/);
  });
});

describe('the strip', () => {
  const strip = coverageStrip(seeded, TAB_FAMILIES['deep-dive']);
  const item = (platform: string) =>
    strip.items.find((entry) => entry.platform === platform)!;

  it('gives the seeded page one sentence per platform', () => {
    expect(strip.summary).toBeNull();
    expect(strip.items.map(({ platform, kind }) => [platform, kind])).toEqual([
      ['youtube', 'covered'],
      ['tiktok', 'no_data_in_window'],
      ['instagram', 'not_connected'],
      // Supported since FILM-1720: connected, and empty in the window.
      ['facebook', 'no_data_in_window'],
      // Supported since FILM-1727, and not connected in this seed.
      ['twitter', 'not_connected'],
    ]);
    expect(item('youtube').sentence).toBe('YouTube: data through 2026-09-29.');
    expect(item('tiktok').sentence).toBe(
      `TikTok: connected (@seedstudio), but no data for ${WINDOW}.`,
    );
    expect(item('instagram').sentence).toBe(
      'Instagram: not connected. Connect a channel in settings to include it.',
    );
  });

  it('names a connected Facebook channel rather than dropping it', () => {
    expect(item('facebook').sentence).toBe(
      `Facebook: connected (Seed Studio Page), but no data for ${WINDOW}.`,
    );
  });

  it('names a connection outside the analytics platforms as unsupported rather than dropping it', () => {
    // Every connectable platform has analytics since FILM-1727 and FILM-717;
    // the next one added to publishing without analytics lands here.
    const next = coverageStrip(
      viewOf(
        coverageResult({
          rows: [],
          channels: [channelRef('snapchat', { name: 'Seed Studio' })],
        }),
      ),
      TAB_FAMILIES['deep-dive'],
    ).items.find(({ platform }) => platform === 'snapchat');

    expect(next).toMatchObject({
      kind: 'unsupported_platform',
      sentence:
        'snapchat (Seed Studio): connected, but analytics doesn’t support snapchat.',
    });
  });

  it('tells not connected, connected but empty, not yet collected and not reported apart', () => {
    // Audience: TikTok's families are not_ingested (geography) and
    // unsupported (demographics, device); Instagram's device is unsupported.
    const notIngested = coverageStrip(seeded, ['geography']).items.find(
      ({ platform }) => platform === 'tiktok',
    )!;
    const notReported = coverageStrip(seeded, ['device']).items.find(
      ({ platform }) => platform === 'tiktok',
    )!;

    const sentences = [
      item('instagram'),
      item('tiktok'),
      notIngested,
      notReported,
    ].map(({ kind, sentence }) => [kind, sentence.replace(/^\w+: /, '')]);

    expect(sentences.map(([kind]) => kind)).toEqual([
      'not_connected',
      'no_data_in_window',
      'not_ingested',
      'not_reported',
    ]);
    expect(new Set(sentences.map(([, sentence]) => sentence)).size).toBe(4);
  });

  it('says why, once, for a project with no connections', () => {
    const none = coverageStrip(
      viewOf(coverageResult({ rows: [], channels: [] })),
      TAB_FAMILIES.overview,
    );

    expect(none.summary).toBe(NO_CHANNELS_SENTENCE);
  });

  it('describes its own window', () => {
    const deepDive: CoverageView = {
      ...seeded,
      windowLabel: 'the last 52 complete weeks',
    };

    expect(
      coverageStrip(deepDive, TAB_FAMILIES['deep-dive']).items.find(
        ({ platform }) => platform === 'tiktok',
      )!.sentence,
    ).toMatch(/no data for the last 52 complete weeks/);
  });
});

describe('the filter’s third state', () => {
  it('dims platforms the tab cannot cover, with the strip’s reason, and keeps the rest', () => {
    const { available, reasons } = filterAvailability(
      coverageStrip(seeded, TAB_FAMILIES['deep-dive']),
    );

    // Connected-but-empty depends on the window, which the header filter
    // does not share with Deep Dive, so it does not dim.
    expect(available).toEqual(['youtube', 'tiktok', 'facebook']);
    expect(reasons).toEqual({
      instagram:
        'Instagram: not connected. Connect a channel in settings to include it.',
      twitter: 'X: not connected. Connect a channel in settings to include it.',
    });
  });
});

describe('a card under the filter', () => {
  it('dims, with the matrix’s reasons, when no selected platform is one it can cover', () => {
    const dimming = cardDimming(['traffic_sources'], ['tiktok', 'instagram']);

    expect(dimming).toEqual({
      dimmed: true,
      reasons: [
        capabilityFor('traffic_sources', 'tiktok').note,
        capabilityFor('traffic_sources', 'instagram').note,
      ],
    });
  });

  it('does not dim while any selected platform is one it can cover', () => {
    expect(cardDimming(['traffic_sources'], ['youtube', 'tiktok'])).toEqual({
      dimmed: false,
    });
    expect(cardDimming(['engagement'], ['tiktok'])).toEqual({ dimmed: false });
  });

  it('dims with a reason when nothing is selected', () => {
    expect(cardDimming(['engagement'], [])).toMatchObject({ dimmed: true });
  });
});

describe('TAB_FAMILIES', () => {
  const read = (path: string) =>
    readFileSync(resolve(__dirname, '../src/components', path), 'utf8');

  const families = (source: string) =>
    [...source.matchAll(/metricFamily=\{?\s*(['"[][^}\n]*)/g)].flatMap(
      ([, value]) =>
        [...value!.matchAll(/'([a-z_]+)'|"([a-z_]+)"/g)]
          .map(([, a, b]) => a ?? b)
          .filter((name): name is MetricFamily =>
            (METRIC_FAMILIES as readonly string[]).includes(name!),
          ),
    );

  it.each([
    ['deep-dive', ['deep-dive/deep-dive-tab.tsx']],
    [
      'overview',
      [
        'overview/views-card.tsx',
        'overview/likes-card.tsx',
        'overview/comments-card.tsx',
        'overview/shares-card.tsx',
        'overview/platform-split-card.tsx',
        'overview/top-content-card.tsx',
        'overview/top-regions-card.tsx',
        'overview/gender-card.tsx',
      ],
    ],
    [
      'audience',
      [
        'audience/age-distribution-card.tsx',
        'audience/gender-split-card.tsx',
        'audience/geography-card.tsx',
        'audience/device-type-card.tsx',
      ],
    ],
    // FILM-1707: the tabs that moved onto the shell.
    ['content', ['content/content-card.tsx', 'content-table-panel.tsx']],
    ['video-log', ['video-log/video-log-tab.tsx']],
    [
      'language',
      [
        'language-analytics-cards.tsx',
        'language-trend-chart.tsx',
        'language-insights-cards.tsx',
        'shorts-geography-cards.tsx',
        'analytics-enhancement-cards.tsx',
      ],
    ],
  ] as const)('lists every family the %s cards declare', (tab, files) => {
    const declared = new Set(files.flatMap((file) => families(read(file))));

    expect(declared.size).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual(
      [...declared]
        .filter((family) =>
          (TAB_FAMILIES[tab] as readonly string[]).includes(family),
        )
        .sort(),
    );
  });
});
