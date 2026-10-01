import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AnalyticsPlatform } from '../src';
import {
  ANALYTICS_PLATFORMS,
  CAPABILITY_MATRIX,
  METRIC_FAMILIES,
  SUPPORT_ORDER,
  weakestSupport,
} from '../src/lib/data-provenance';
import {
  DURATION_REFINEMENTS,
  FORMAT_FAMILIES,
  contentTypesFor,
} from '../src/lib/format-families';
import type { FormatFamily } from '../src/lib/format-families';
import {
  FAMILIES_OUTSIDE_THE_FUNNEL,
  FUNNEL_STAGES,
  FUNNEL_STAGE_LABEL,
  FUNNEL_STAGE_QUESTION,
  SIGNALS,
  SIGNAL_IDS,
  SIGNAL_INPUT_GAPS,
  SIGNAL_MAP,
  computeSignalSupport,
  signalSupport,
  stageReading,
  stageReadings,
} from '../src/lib/signal-map';
import type {
  FunnelStage,
  SignalDefinition,
  SignalId,
  SignalInputGap,
  StageBinding,
} from '../src/lib/signal-map';

/**
 * FILM-1714. The map is only worth having if it cannot claim more than the
 * capability matrix grants, so these rules are the deliverable. Each one has
 * a mutation guard in `tooling/mutation-guards/film-1714.json`.
 */
const REPO = resolve(import.meta.dirname, '../../..');

function read(file: string) {
  return readFileSync(join(REPO, file), 'utf8');
}

function filesUnder(path: string): string[] {
  const absolute = join(REPO, path);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [absolute];

  return readdirSync(absolute).flatMap((name) =>
    name === 'node_modules' || name === '__tests__'
      ? []
      : filesUnder(join(path, name)),
  );
}

interface Cell {
  id: string;
  platform: AnalyticsPlatform;
  format: FormatFamily;
  stage: FunnelStage;
  binding: StageBinding | undefined;
}

const CELLS: Cell[] = ANALYTICS_PLATFORMS.flatMap((platform) =>
  FORMAT_FAMILIES.flatMap((format) =>
    FUNNEL_STAGES.map((stage) => ({
      id: `${platform} · ${format} · ${stage}`,
      platform,
      format,
      stage,
      binding: SIGNAL_MAP[platform]?.[format]?.[stage],
    })),
  ),
);

function boundSignals(binding: StageBinding): SignalId[] {
  return binding.primary === null
    ? []
    : [binding.primary, ...binding.supporting];
}

/** Whether any publish on `platform` resolves to `format`. */
function reachable(platform: AnalyticsPlatform, format: FormatFamily) {
  return (
    contentTypesFor(format, platform).length > 0 ||
    DURATION_REFINEMENTS.some(
      (rule) => rule.platform === platform && rule.family === format,
    )
  );
}

// ---------------------------------------------------------------------------
// Rule 1: every platform × format × stage
// ---------------------------------------------------------------------------

describe('rule 1: the map covers every platform, format and stage', () => {
  it('lists exactly the members of AnalyticsPlatform', () => {
    // Read from the source, as data-provenance.test.ts does: adding a
    // platform to the union fails there and here. Two suites failing is
    // the sign that the platform union is the seam.
    const union = /export type AnalyticsPlatform =([^;]+);/.exec(
      read('packages/clickhouse/src/types.ts'),
    )?.[1];

    expect(union, 'AnalyticsPlatform not found in types.ts').toBeDefined();

    const members = [...union!.matchAll(/'([^']+)'/g)].map(([, name]) => name);

    expect(members.length).toBeGreaterThan(0);
    expect(Object.keys(SIGNAL_MAP).sort()).toEqual(members.sort());
  });

  it('has a binding in every cell, and no others', () => {
    expect(
      CELLS.filter((cell) => !cell.binding).map((cell) => cell.id),
    ).toEqual([]);

    for (const platform of ANALYTICS_PLATFORMS) {
      expect(Object.keys(SIGNAL_MAP[platform]).sort(), platform).toEqual(
        [...FORMAT_FAMILIES].sort(),
      );
      for (const format of FORMAT_FAMILIES) {
        expect(Object.keys(SIGNAL_MAP[platform][format]).sort()).toEqual(
          [...FUNNEL_STAGES].sort(),
        );
      }
    }
  });

  it('binds a format exactly where something published can be in it', () => {
    const wrong = ANALYTICS_PLATFORMS.flatMap((platform) =>
      FORMAT_FAMILIES.flatMap((format) => {
        const notPublished = FUNNEL_STAGES.every((stage) => {
          const binding = SIGNAL_MAP[platform][format][stage];
          return (
            binding.primary === null &&
            binding.reason === 'format_not_published_on_platform'
          );
        });
        const anyNotPublished = FUNNEL_STAGES.some((stage) => {
          const binding = SIGNAL_MAP[platform][format][stage];
          return (
            binding.primary === null &&
            binding.reason === 'format_not_published_on_platform'
          );
        });

        return reachable(platform, format)
          ? anyNotPublished
            ? [`${platform} · ${format} is published but marked not`]
            : []
          : notPublished
            ? []
            : [`${platform} · ${format} is never published but has bindings`];
      }),
    );

    expect(wrong).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 2: unbound carries a note; every referenced signal exists
// ---------------------------------------------------------------------------

describe('rule 2: unbound stages say why, and bindings name real signals', () => {
  it('gives every unbound stage a reason and a non-empty note', () => {
    const silent = CELLS.filter(
      ({ binding }) =>
        binding?.primary === null &&
        (!binding.reason || !binding.note || binding.note.trim() === ''),
    ).map((cell) => cell.id);

    expect(silent).toEqual([]);
  });

  it('keeps unbound and dark apart: an unbound stage names no signal', () => {
    for (const { id, binding } of CELLS) {
      if (binding?.primary !== null) continue;
      expect(binding, id).not.toHaveProperty('supporting');
      expect(stageReading(...cellKey(id)).status, id).toBe('unbound');
    }
  });

  it('references only signals that are defined', () => {
    const known = new Set<string>(SIGNAL_IDS);
    const unknown = CELLS.flatMap(({ id, binding }) =>
      binding
        ? boundSignals(binding)
            .filter((signal) => !known.has(signal))
            .map((signal) => `${id}: ${signal}`)
        : [],
    );

    expect(unknown).toEqual([]);
  });

  it('defines each signal once, under its own id', () => {
    expect(Object.keys(SIGNALS).sort()).toEqual([...SIGNAL_IDS].sort());
    for (const id of SIGNAL_IDS) {
      expect(SIGNALS[id].id).toBe(id);
      expect(SIGNALS[id].definition.trim()).not.toBe('');
    }
  });

  it('does not list a primary again among its supporting signals', () => {
    for (const { id, binding } of CELLS) {
      if (!binding || binding.primary === null) continue;
      expect(new Set(boundSignals(binding)).size, id).toBe(
        boundSignals(binding).length,
      );
      for (const unavailable of binding.unavailable) {
        expect(unavailable.note.trim(), id).not.toBe('');
      }
    }
  });

  it('binds each signal only in the stage it answers', () => {
    const misplaced = CELLS.flatMap(({ id, stage, binding }) =>
      binding
        ? boundSignals(binding)
            .filter((signal) => SIGNALS[signal]?.stage !== stage)
            .map(
              (signal) => `${id}: ${signal} answers ${SIGNALS[signal]?.stage}`,
            )
        : [],
    );

    expect(misplaced).toEqual([]);
  });
});

function cellKey(id: string): [AnalyticsPlatform, FormatFamily, FunnelStage] {
  const [platform, format, stage] = id.split(' · ');
  return [
    platform as AnalyticsPlatform,
    format as FormatFamily,
    stage as FunnelStage,
  ];
}

// ---------------------------------------------------------------------------
// Rule 3: inputs are real families
// ---------------------------------------------------------------------------

describe('rule 3: every signal reads at least one family the matrix knows', () => {
  it('has non-empty inputs, each in METRIC_FAMILIES', () => {
    const known = new Set<string>(METRIC_FAMILIES);
    const bad = SIGNAL_IDS.flatMap((id) => {
      const inputs: readonly string[] = SIGNALS[id].inputs;
      if (inputs.length === 0) return [`${id}: no inputs`];
      return inputs
        .filter((family) => !known.has(family))
        .map((family) => `${id}: ${family} is not a metric family`);
    });

    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 4: the map may not claim more than the matrix grants
// ---------------------------------------------------------------------------

describe('rule 4: a stage never binds an unsupported input', () => {
  it('finds no bound signal with an unsupported input', () => {
    const overclaimed = CELLS.flatMap(({ id, platform, binding }) =>
      binding
        ? boundSignals(binding).flatMap((signal) =>
            signalSupport(signal, platform)
              .inputs.filter((input) => input.level === 'unsupported')
              .map((input) => `${id}: ${signal} reads ${input.family}`),
          )
        : [],
    );

    expect(overclaimed).toEqual([]);
  });

  it('allows a not_ingested input, which reads as dark with its blocker', () => {
    const attention = stageReading('tiktok', 'short_vertical', 'attention');

    expect(attention.status).toBe('dark');
    if (attention.status === 'unbound') return;
    expect(attention.primary.level).toBe('not_ingested');
    expect(attention.blockers).toEqual(['FILM-1730']);
    expect(attention.primary.inputs[0]?.note).toBe(
      CAPABILITY_MATRIX.watch_time.tiktok.note,
    );
  });

  it('keeps the backlog visible: some stage is dark today', () => {
    const dark = CELLS.filter(
      (cell) => stageReading(...cellKey(cell.id)).status === 'dark',
    );
    expect(dark.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 5: reverse coverage
// ---------------------------------------------------------------------------

describe('rule 5: every native family reaches a stage or says why not', () => {
  const fed = new Set(SIGNAL_IDS.flatMap((id) => SIGNALS[id].inputs));

  it('feeds every family that is native somewhere into a signal', () => {
    const stranded = METRIC_FAMILIES.filter(
      (family) =>
        ANALYTICS_PLATFORMS.some(
          (platform) => CAPABILITY_MATRIX[family][platform].level === 'native',
        ) &&
        !fed.has(family) &&
        !FAMILIES_OUTSIDE_THE_FUNNEL[family],
    );

    expect(stranded).toEqual([]);
  });

  it('allowlists only families no signal reads, each with a reason', () => {
    for (const [family, reason] of Object.entries(
      FAMILIES_OUTSIDE_THE_FUNNEL,
    )) {
      expect(fed.has(family as never), family).toBe(false);
      expect(reason.trim(), family).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// Stages, in one place
// ---------------------------------------------------------------------------

describe('the stages are platform-independent and defined once', () => {
  it('names six stages in funnel order, each with its question', () => {
    // Monetisation is the sixth (FILM-1726, owner 2026-10-01): an outcome
    // of the funnel, so it comes last.
    expect([...FUNNEL_STAGES]).toEqual([
      'reach',
      'hook',
      'attention',
      'transmission',
      'audience',
      'monetisation',
    ]);
    for (const stage of FUNNEL_STAGES) {
      expect(FUNNEL_STAGE_QUESTION[stage]).toMatch(/\?$/);
      expect(FUNNEL_STAGE_LABEL[stage]).not.toBe('');
    }
  });

  it('reads every platform × format in the same stage order', () => {
    for (const platform of ANALYTICS_PLATFORMS) {
      for (const format of FORMAT_FAMILIES) {
        expect(
          stageReadings(platform, format).map((reading) => reading.stage),
        ).toEqual([...FUNNEL_STAGES]);
      }
    }
  });

  it('is not restated anywhere else in the code', () => {
    const tuple = /'reach',\s*'hook',\s*'attention',\s*'transmission'/;
    const restated = ['packages', 'apps']
      .flatMap((root) => filesUnder(root))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => tuple.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(REPO.length + 1));

    expect(restated).toEqual(['packages/clickhouse/src/lib/signal-map.ts']);
  });
});

// ---------------------------------------------------------------------------
// Support is computed
// ---------------------------------------------------------------------------

describe('SUPPORT_ORDER', () => {
  it('ranks exactly the four SupportLevel members', () => {
    const union = /export type SupportLevel =([^;]+);/.exec(
      read('packages/clickhouse/src/lib/data-provenance.ts'),
    )?.[1];
    const members = [...union!.matchAll(/'([^']+)'/g)].map(([, name]) => name);

    expect([...SUPPORT_ORDER].sort()).toEqual(members.sort());
  });

  it('puts unsupported below not_ingested: a signal that can never exist is not dark', () => {
    expect(weakestSupport(['not_ingested', 'unsupported'])).toBe('unsupported');
    expect(weakestSupport(['unsupported', 'not_ingested'])).toBe('unsupported');
    expect(weakestSupport(['native', 'not_ingested'])).toBe('not_ingested');
    expect(weakestSupport(['derived', 'native'])).toBe('derived');
    expect(weakestSupport(['native'])).toBe('native');
  });

  it('argues its order in a comment', () => {
    const source = read('packages/clickhouse/src/lib/data-provenance.ts');
    const at = source.indexOf('export const SUPPORT_ORDER');
    expect(source.slice(at - 1500, at)).toContain(
      '`not_ingested` above `unsupported`',
    );
  });
});

describe('support is computed from the matrix, never authored', () => {
  it('adds no entry to CAPABILITY_MATRIX', () => {
    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual(
      [...METRIC_FAMILIES].sort(),
    );

    const source = read('packages/clickhouse/src/lib/signal-map.ts');
    expect(source).not.toMatch(/CAPABILITY_MATRIX(\[[^\]]+\]|\.\w+)*\s*=[^=]/);
    expect(source).not.toMatch(/Object\.assign\(\s*CAPABILITY_MATRIX/);
    expect(source).not.toMatch(/level:\s*'(native|derived)'/);
  });

  it('is the weakest input level, with no gap', () => {
    for (const id of SIGNAL_IDS) {
      for (const platform of ANALYTICS_PLATFORMS) {
        const support = signalSupport(id, platform);
        if (support.gap || support.unitPending) continue;

        const [first, ...rest] = SIGNALS[id].inputs.map(
          (family) => CAPABILITY_MATRIX[family][platform].level,
        );
        expect(support.level, `${id} on ${platform}`).toBe(
          weakestSupport([first!, ...rest]),
        );
      }
    }
  });

  it('keeps the full input list, not only the weakest level', () => {
    const support = signalSupport('views_per_follower', 'tiktok');

    expect(support.level).toBe('derived');
    expect(
      support.inputs.map(({ family, level }) => ({ family, level })),
    ).toEqual([
      { family: 'engagement', level: 'derived' },
      { family: 'channel_totals', level: 'native' },
    ]);
  });

  it('keeps composition apart from ingestion: a ratio can be native', () => {
    const share = signalSupport('share_rate', 'youtube');
    expect(share.composition).toBe('ratio');
    expect(share.level).toBe('native');

    const reached = signalSupport('accounts_reached', 'instagram');
    expect(reached.composition).toBe('measured');
    expect(reached.level).toBe('derived');
  });
});

// ---------------------------------------------------------------------------
// Input gaps: weaken only, and only while true
// ---------------------------------------------------------------------------

// Source files only: a backup or an editor's swap file beside the code is not
// code that collects the field.
function staleGaps(gaps: readonly SignalInputGap[]) {
  return gaps.flatMap((gap) =>
    filesUnder(gap.within)
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes(gap.marker))
      .map(
        (file) =>
          `${gap.signal} on ${gap.platform}: ${gap.marker} is in ${file.slice(REPO.length + 1)}, so the gap is closed — remove it`,
      ),
  );
}

function redundantGaps(gaps: readonly SignalInputGap[]) {
  return gaps
    .filter((gap) => {
      const withoutGap = computeSignalSupport(
        SIGNALS[gap.signal],
        gap.platform,
        [],
      );
      return (
        SUPPORT_ORDER.indexOf(withoutGap.level) >=
        SUPPORT_ORDER.indexOf('not_ingested')
      );
    })
    .map((gap) => `${gap.signal} on ${gap.platform}`);
}

/**
 * The two gaps KB-151 closed, kept as probes so both rules are still seen to
 * fire with SIGNAL_INPUT_GAPS empty. The average's marker is now in the
 * ingest code, so this probe is stale by construction.
 */
const KB_151_AVERAGE_GAP: SignalInputGap = {
  signal: 'ig_reels_avg_watch_time',
  platform: 'instagram',
  field: 'ig_reels_avg_watch_time',
  blockedBy: 'KB-151',
  note: 'Instagram reports how long a Reel was played on average, but we do not store that figure yet.',
  within: 'packages/features/content-analytics/src/server',
  marker: 'avgWatchTimeMs',
};

describe('an input gap holds only while nothing collects the field', () => {
  it('finds the code it is scanning', () => {
    for (const gap of [...SIGNAL_INPUT_GAPS, KB_151_AVERAGE_GAP]) {
      expect(filesUnder(gap.within).length, gap.within).toBeGreaterThan(0);
    }
  });

  it('is stale once its marker appears', () => {
    expect(staleGaps(SIGNAL_INPUT_GAPS)).toEqual([]);
  });

  it('flags a closed gap as stale (KB-151 stored the average)', () => {
    expect(staleGaps([KB_151_AVERAGE_GAP])).toHaveLength(1);
  });

  it('is redundant where the families are already that weak', () => {
    expect(redundantGaps(SIGNAL_INPUT_GAPS)).toEqual([]);
  });

  it('flags a gap on a signal whose families are already not ingested', () => {
    // TikTok watch time is FILM-1730's, so a gap there adds nothing.
    const onTikTok = { ...KB_151_AVERAGE_GAP, platform: 'tiktok' as const };
    expect(redundantGaps([KB_151_AVERAGE_GAP])).toEqual([]);
    expect(redundantGaps([onTikTok])).toEqual([
      'ig_reels_avg_watch_time on tiktok',
    ]);
  });

  it('weakens support to not_ingested, with its blocker, and never strengthens it', () => {
    const support = computeSignalSupport(
      SIGNALS.ig_reels_avg_watch_time,
      'instagram',
      [KB_151_AVERAGE_GAP],
    );
    expect(support.level).toBe('not_ingested');
    expect(support.gap).toBe(KB_151_AVERAGE_GAP);
    expect(support.blockers).toEqual(['KB-151']);
  });

  it('names a blocker and a creator-facing note, once per signal and platform', () => {
    const keys = SIGNAL_INPUT_GAPS.map(
      (gap) => `${gap.signal}·${gap.platform}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const gap of SIGNAL_INPUT_GAPS) {
      expect(gap.blockedBy).toMatch(/^(FILM-[\w-]+|KB-\d+)$/);
      expect(gap.note.trim()).not.toBe('');
    }
  });
});

describe('a figure in an unconfirmed unit is withheld', () => {
  const probe: SignalDefinition = {
    ...SIGNALS.ig_reels_avg_watch_time,
    unitCheck: {
      unit: 'milliseconds',
      pending: { owner: 'FILM-1712', question: 'Is it milliseconds?' },
    },
  };

  it('reads as dark with the confirmer as blocker while pending', () => {
    const support = computeSignalSupport(probe, 'instagram', []);

    expect(support.level).toBe('not_ingested');
    expect(support.unitPending?.owner).toBe('FILM-1712');
    expect(support.blockers).toEqual(['FILM-1712']);
  });

  it('is shown once confirmed against a live response', () => {
    const support = computeSignalSupport(
      SIGNALS.ig_reels_avg_watch_time,
      'instagram',
      [],
    );

    expect(SIGNALS.ig_reels_avg_watch_time.unitCheck?.confirmed?.on).toBe(
      '2026-09-29',
    );
    expect(support.unitPending).toBeNull();
    expect(support.level).toBe('derived');
  });
});

// ---------------------------------------------------------------------------
// Instagram, as the spec's criteria name it
// ---------------------------------------------------------------------------

describe('Instagram bindings', () => {
  const reels = [
    'short_vertical',
    'long_vertical',
    'teaser',
    'trailer',
  ] as const;

  it('Attention: ig_reels_avg_watch_time primary, reels_skip_rate supporting', () => {
    for (const format of reels) {
      const binding = SIGNAL_MAP.instagram[format].attention;
      expect(binding.primary, format).toBe('ig_reels_avg_watch_time');
      if (binding.primary === null) continue;
      expect(binding.supporting, format).toContain('reels_skip_rate');
    }
  });

  it('never binds average percentage viewed, which Instagram does not report', () => {
    const bindings = Object.values(SIGNAL_MAP.instagram).flatMap((stages) =>
      Object.values(stages).flatMap(boundSignals),
    );
    expect(bindings).not.toContain('average_percentage_viewed');
    expect(bindings).not.toContain('audience_retention');
  });

  it('Transmission includes reposts per reach, read from reposts_count', () => {
    for (const format of reels) {
      const binding = SIGNAL_MAP.instagram[format].transmission;
      expect(boundSignals(binding), format).toContain('reposts_per_reach');
    }
    expect(SIGNALS.reposts_per_reach.inputs).toContain('reposts');
    expect(CAPABILITY_MATRIX.reposts.instagram.reference.fields).toEqual([
      'reposts_count',
    ]);
    expect(signalSupport('reposts_per_reach', 'instagram').level).toBe(
      'derived',
    );
  });

  // KB-151 stored both. The average's unit is confirmed, so Attention is
  // measurable; the skip rate's scale is not, so it stays dark on the owner.
  it('Attention is measurable once KB-151 stores the average; the skip rate waits on its scale', () => {
    const attention = stageReading('instagram', 'short_vertical', 'attention');

    expect(attention.status).toBe('measurable');
    if (attention.status === 'unbound') return;
    expect(attention.primary.gap).toBeNull();
    expect(attention.blockers).toEqual([]);

    const skip = attention.supporting.find(
      (support) => support.signal === 'reels_skip_rate',
    );
    expect(skip?.gap).toBeNull();
    expect(skip?.level).toBe('not_ingested');
    expect(skip?.unitPending?.owner).toBe('owner');
    expect(skip?.blockers).toEqual(['owner']);
  });

  it('leaves Hook and Audience unbound for a Reel, with the reason', () => {
    expect(stageReading('instagram', 'short_vertical', 'hook')).toMatchObject({
      status: 'unbound',
      reason: 'platform_does_not_expose_a_hook_measure',
    });
    expect(
      stageReading('instagram', 'short_vertical', 'audience'),
    ).toMatchObject({
      status: 'unbound',
      reason: 'platform_does_not_expose_per_video_follows',
    });
  });
});

describe('a YouTube Short has no reach figure, and says so', () => {
  it('leaves Reach unbound rather than forcing impressions into it', () => {
    expect(stageReading('youtube', 'short_vertical', 'reach')).toMatchObject({
      status: 'unbound',
      reason: 'platform_does_not_expose_an_impression_equivalent',
    });
    expect(stageReading('youtube', 'long_horizontal', 'reach')).toMatchObject({
      status: 'measurable',
    });
  });
});

// ---------------------------------------------------------------------------
// Facebook, as FILM-1720 names it
// ---------------------------------------------------------------------------

describe('Facebook bindings (FILM-1720)', () => {
  const published = [
    'short_vertical',
    'long_horizontal',
    'teaser',
    'trailer',
  ] as const;

  const bindings = published.flatMap((format) =>
    FUNNEL_STAGES.flatMap((stage) =>
      boundSignals(SIGNAL_MAP.facebook[format][stage]),
    ),
  );

  it('binds no signal that divides by views or reads as YouTube’s', () => {
    // Facebook has no single view (FILM-1722): a per-view rate has no
    // denominator, and Meta's own average is not an average view duration.
    for (const signal of [
      'share_rate',
      'comment_rate',
      'subscriber_conversion',
      'average_view_duration',
      'average_percentage_viewed',
      'impressions',
      'impressions_ctr',
    ] as const) {
      expect(bindings, signal).not.toContain(signal);
    }
  });

  it('reads Hook from the click-to-play split, and Reach from people', () => {
    for (const format of published) {
      expect(SIGNAL_MAP.facebook[format].hook.primary, format).toBe(
        'click_to_play_share',
      );
      expect(SIGNAL_MAP.facebook[format].reach.primary, format).toBe(
        'accounts_reached',
      );
    }
    expect(stageReading('facebook', 'short_vertical', 'reach').status).toBe(
      'measurable',
    );
  });

  it('names Meta’s own average as unavailable, and divides the totals itself', () => {
    const attention = SIGNAL_MAP.facebook.short_vertical.attention;

    expect(attention.primary).toBe('watch_time_per_play');
    if (attention.primary === null) return;
    expect(attention.unavailable.map((u) => u.name)).toContain(
      'average time watched, as Facebook reports it',
    );
    expect(SIGNALS.watch_time_per_play.definition).toMatch(
      /longer than the reel/,
    );
  });

  it('leaves follows unbound for a video in the player, which Meta credits to reels only', () => {
    expect(
      stageReading('facebook', 'long_horizontal', 'audience'),
    ).toMatchObject({
      status: 'unbound',
      reason: 'platform_does_not_expose_per_video_follows',
    });
    expect(SIGNAL_MAP.facebook.short_vertical.audience.primary).toBe(
      'follows_per_reach',
    );
  });
});

describe('X bindings (FILM-1727): the second test of the map', () => {
  const timeline = ['long_horizontal', 'clip', 'teaser', 'trailer'] as const;

  it('reads Attention from the five playback quartiles, never from YouTube’s curve', () => {
    for (const format of timeline) {
      expect(stageReading('twitter', format, 'attention')).toMatchObject({
        status: 'measurable',
        primary: { signal: 'quartile_retention', level: 'native' },
      });
    }

    const bindings = Object.values(SIGNAL_MAP.twitter).flatMap((stages) =>
      Object.values(stages).flatMap(boundSignals),
    );
    expect(bindings).not.toContain('audience_retention');
    expect(bindings).not.toContain('average_view_duration');
  });

  it('reads Transmission from its conversation: reposts first, replies beside', () => {
    const transmission = stageReading('twitter', 'clip', 'transmission');

    expect(transmission).toMatchObject({
      status: 'measurable',
      primary: { signal: 'repost_rate', level: 'derived' },
    });
    if (transmission.status === 'unbound') return;
    expect(transmission.supporting.map((s) => [s.signal, s.level])).toEqual([
      ['comment_rate', 'derived'],
      ['share_rate', 'not_ingested'],
    ]);
  });

  it('keeps X’s shares dark: Enterprise-only, so no share rate is a figure', () => {
    expect(signalSupport('share_rate', 'twitter')).toMatchObject({
      level: 'not_ingested',
      blockers: ['FILM-1727'],
    });
  });

  it('binds Reach, Hook and Audience, and shows each as dark with this spec named', () => {
    for (const stage of ['reach', 'hook', 'audience'] as const) {
      const reading = stageReading('twitter', 'long_horizontal', stage);

      expect(reading.status, stage).toBe('dark');
      if (reading.status === 'unbound') continue;
      expect(reading.blockers, stage).toEqual(['FILM-1727']);
    }
  });

  it('has no X vertical short or live stream, because nothing X publishes is one', () => {
    for (const format of ['short_vertical', 'long_vertical', 'live'] as const) {
      expect(stageReading('twitter', format, 'reach')).toMatchObject({
        status: 'unbound',
        reason: 'format_not_published_on_platform',
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Monetisation, as FILM-1726 names it
// ---------------------------------------------------------------------------

describe('Monetisation (FILM-1726)', () => {
  const youtubePlayer = [
    'long_vertical',
    'long_horizontal',
    'teaser',
    'trailer',
  ] as const;
  const published = (platform: AnalyticsPlatform) =>
    FORMAT_FAMILIES.filter((format) => reachable(platform, format));

  it('reads YouTube’s player formats as earnings per thousand views', () => {
    for (const format of youtubePlayer) {
      const binding = SIGNAL_MAP.youtube[format].monetisation;
      expect(binding.primary, format).toBe('revenue_per_mille');
      expect(boundSignals(binding), format).toContain('estimated_revenue');
    }
    expect(SIGNALS.revenue_per_mille.inputs).toEqual(['revenue', 'engagement']);
  });

  it('reads a Short’s earnings, and names per-view earnings as unavailable', () => {
    const binding = SIGNAL_MAP.youtube.short_vertical.monetisation;

    expect(binding.primary).toBe('estimated_revenue');
    if (binding.primary === null) return;
    expect(binding.supporting).not.toContain('revenue_per_mille');
    expect(binding.unavailable.map((u) => u.name)).toContain(
      'earnings per thousand views',
    );
  });

  it('leaves TikTok and Instagram unbound: neither reports what a video earned', () => {
    for (const platform of ['tiktok', 'instagram'] as const) {
      for (const format of published(platform)) {
        expect(
          stageReading(platform, format, 'monetisation'),
          `${platform} · ${format}`,
        ).toMatchObject({
          status: 'unbound',
          reason: 'platform_does_not_expose_revenue',
        });
      }
    }
  });

  it('binds Facebook to its ad-break earnings, never to a per-view rate', () => {
    for (const format of published('facebook')) {
      const binding = SIGNAL_MAP.facebook[format].monetisation;
      expect(binding.primary, format).toBe('estimated_revenue');
      expect(boundSignals(binding), format).toContain('ad_break_cpm');
      expect(boundSignals(binding), format).not.toContain('revenue_per_mille');
    }
  });

  it('binds only signals that read the platform’s own revenue family', () => {
    // Manual revenue lives in Postgres and is the creator's figure, not the
    // platform's: binding it would make "dark" stop meaning unmeasurable
    // (FILM-1726 §3.4, lead-approved 2026-10-01).
    const monetisationSignals = SIGNAL_IDS.filter(
      (id) => SIGNALS[id].stage === 'monetisation',
    );

    expect(monetisationSignals.sort()).toEqual(
      ['ad_break_cpm', 'estimated_revenue', 'revenue_per_mille'].sort(),
    );
    for (const id of monetisationSignals) {
      expect(SIGNALS[id].inputs, id).toContain('revenue');
    }
  });

  it('is never measurable where the revenue family has no figure', () => {
    for (const platform of ANALYTICS_PLATFORMS) {
      const level = CAPABILITY_MATRIX.revenue[platform].level;
      if (level === 'native' || level === 'derived') continue;
      for (const format of published(platform)) {
        expect(
          stageReading(platform, format, 'monetisation').status,
          `${platform} · ${format}`,
        ).not.toBe('measurable');
      }
    }
  });
});
