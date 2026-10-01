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
  it('names five stages in funnel order, each with its question', () => {
    expect([...FUNNEL_STAGES]).toEqual([
      'reach',
      'hook',
      'attention',
      'transmission',
      'audience',
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

describe('an input gap holds only while nothing collects the field', () => {
  it('finds the code it is scanning', () => {
    for (const gap of SIGNAL_INPUT_GAPS) {
      expect(filesUnder(gap.within).length, gap.within).toBeGreaterThan(0);
    }
  });

  it('is stale once its marker appears', () => {
    const stale = SIGNAL_INPUT_GAPS.flatMap((gap) =>
      filesUnder(gap.within)
        .filter((file) => readFileSync(file, 'utf8').includes(gap.marker))
        .map(
          (file) =>
            `${gap.signal} on ${gap.platform}: ${gap.marker} is in ${file.slice(REPO.length + 1)}, so the gap is closed — remove it`,
        ),
    );

    expect(stale).toEqual([]);
  });

  it('is redundant where the families are already that weak', () => {
    const redundant = SIGNAL_INPUT_GAPS.filter((gap) => {
      const withoutGap = computeSignalSupport(
        SIGNALS[gap.signal],
        gap.platform,
        [],
      );
      return (
        SUPPORT_ORDER.indexOf(withoutGap.level) >=
        SUPPORT_ORDER.indexOf('not_ingested')
      );
    }).map((gap) => `${gap.signal} on ${gap.platform}`);

    expect(redundant).toEqual([]);
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

  it('both Attention signals render dark with KB-151 named, never as a figure', () => {
    const attention = stageReading('instagram', 'short_vertical', 'attention');

    expect(attention.status).toBe('dark');
    if (attention.status === 'unbound') return;
    expect(attention.blockers).toEqual(['KB-151']);

    const skip = attention.supporting.find(
      (support) => support.signal === 'reels_skip_rate',
    );
    expect(skip?.level).toBe('not_ingested');
    expect(skip?.blockers).toEqual(['KB-151']);
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
