/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  analyseGenome,
  applyLinkedTests,
  concludedChangeLogEntry,
  genomeHypothesisKey,
  metricProvenanceFor,
  stageReading,
} from '@kit/clickhouse';
import type {
  FunnelStage,
  GenomeAnalysis,
  GenomeVideo,
  SegmentMeasure,
} from '@kit/clickhouse';

import { GenomeFindings } from '../src/components/signal-surface/genome-findings';
import { StageDetail } from '../src/components/signal-surface/stage-detail';
import { StageStrip } from '../src/components/signal-surface/stage-strip';
import {
  type StageSurface,
  type StageVideoFigure,
  diagnosisOf,
  stageSurfaceFor,
} from '../src/lib/signal-surface';

/**
 * FILM-1719's DOM guards, written against the components rather than a
 * page: five kinds of emptiness that differ in the DOM, a band alone only
 * in the strip, depths that stay in the DOM and announce their state, and
 * no recommendation without its evidence beside it.
 */
afterEach(cleanup);

const PUBLISHED = '2026-06-01 12:00:00';

function rowsFor(
  subject: number | null,
  peer: (index: number) => number,
): StageVideoFigure[] {
  return [
    {
      videoId: 'subject',
      publishedAt: PUBLISHED,
      formatFamily: 'short_vertical',
      value: subject,
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      videoId: `peer-${index}`,
      publishedAt: `2026-0${1 + (index % 4)}-${String(10 + index).padStart(2, '0')} 00:00:00`,
      formatFamily: 'short_vertical' as const,
      value: peer(index),
    })),
  ];
}

function surface(stage: FunnelStage, rows: StageVideoFigure[]): StageSurface {
  return stageSurfaceFor({
    reading: stageReading('youtube', 'short_vertical', stage),
    platform: 'youtube',
    subject: {
      videoId: 'subject',
      publishedAt: PUBLISHED,
      formatFamily: 'short_vertical',
      checkpoint: { judgable: true },
    },
    checkpointDays: 30,
    rows,
    provenanceFor: (signal: SegmentMeasure) =>
      metricProvenanceFor(signal, 'youtube'),
  });
}

/**
 * The spec's fixture, on one screen: a YouTube Short whose Reach is unbound,
 * Hook and Monetisation dark, Attention judged below, Transmission against a
 * zero typical figure, and Audience with no figure for this video.
 */
const STAGES: StageSurface[] = [
  surface('reach', []),
  surface('hook', []),
  surface(
    'attention',
    rowsFor(10, (index) => 30 + index),
  ),
  surface(
    'transmission',
    rowsFor(0.02, () => 0),
  ),
  surface(
    'audience',
    rowsFor(null, () => 0.01),
  ),
  surface('monetisation', []),
];

const DIAGNOSIS = diagnosisOf(
  Object.fromEntries(STAGES.map((s) => [s.stage, s])) as Record<
    FunnelStage,
    StageSurface
  >,
);

const cellOf = (container: HTMLElement, stage: FunnelStage) =>
  container.querySelector<HTMLElement>(
    `[data-test="stage-cell"][data-stage="${stage}"]`,
  )!;

describe('the strip', () => {
  it('the fixture holds every state', () => {
    expect(STAGES.map((s) => s.state)).toEqual([
      'unbound',
      'dark',
      'judged',
      'insufficient_cohort',
      'not_judgable',
      'dark',
    ]);
  });

  it('renders the five emptinesses differently in the DOM, not only visually', () => {
    const { container } = render(
      <StageStrip stages={STAGES} diagnosis={DIAGNOSIS} />,
    );

    const states = new Set(
      [...container.querySelectorAll('[data-test="stage-cell"]')].map((cell) =>
        cell.getAttribute('data-stage-state'),
      ),
    );
    expect(states).toEqual(
      new Set([
        'unbound',
        'dark',
        'judged',
        'insufficient_cohort',
        'not_judgable',
      ]),
    );

    // Unbound and dark: a rule and a reason, no figure, no bar.
    for (const stage of ['reach', 'hook'] as const) {
      const cell = cellOf(container, stage);
      expect(cell.querySelector('[data-test="stage-rule"]')).not.toBeNull();
      expect(cell.querySelector('[data-test="stage-value"]')).toBeNull();
      expect(cell.querySelector('[data-bar]')).toBeNull();
    }
    expect(cellOf(container, 'reach').textContent).toMatch(/Not reported here/);
    expect(cellOf(container, 'hook').textContent).not.toMatch(
      /Not reported here/,
    );

    // The figure is real; only the comparison is missing.
    const thin = cellOf(container, 'transmission');
    expect(thin.querySelector('[data-test="stage-value"]')?.textContent).toBe(
      '2.0%',
    );
    expect(thin.querySelector('[data-bar]')).toBeNull();

    // No figure for this video: said, not drawn as a zero.
    const none = cellOf(container, 'audience');
    expect(none.querySelector('[data-test="stage-value"]')).toBeNull();
    expect(none.textContent).toMatch(/reported no figure/);

    const judged = cellOf(container, 'attention');
    expect(judged.getAttribute('data-band')).toBe('below');
    expect(judged.querySelectorAll('[data-bar]')).toHaveLength(3);
    // FILM-1715's four states: directional and established differ too.
    expect(judged.getAttribute('data-benchmark-state')).toBe('established');
    expect(judged.textContent).not.toMatch(/Directional/);
  });

  it('draws a bar only for a judged stage, and every segment has a size', () => {
    const { container } = render(
      <StageStrip stages={STAGES} diagnosis={DIAGNOSIS} />,
    );

    const bars = [...container.querySelectorAll<HTMLElement>('[data-bar]')];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(
        bar.closest('[data-stage-state]')?.getAttribute('data-stage-state'),
      ).toBe('judged');
      expect(bar.className).toMatch(/\bh-1\.5\b/);
      expect(bar.className).toMatch(/\bw-6\b/);
    }
  });

  it('shows the judged count beside the diagnosis', () => {
    const { container } = render(
      <StageStrip stages={STAGES} diagnosis={DIAGNOSIS} />,
    );

    const coverage = container.querySelector('[data-test="signal-coverage"]')!;
    expect(coverage.getAttribute('data-judged-count')).toBe('1');
    expect(coverage.textContent).toMatch(/^Judged on 1 of 6 stages\./);
    expect(
      container
        .querySelector('[data-test="signal-diagnosis"]')
        ?.getAttribute('data-kind'),
    ).toBe('too_few_judged');
  });
});

describe('the drill-down', () => {
  const renderDetails = () =>
    render(
      <ol>
        {STAGES.map((s) => (
          <StageDetail
            key={s.stage}
            surface={s}
            videos={{ 'peer-0': { title: 'Peer zero', url: null } }}
            onSelectVideo={() => {}}
          />
        ))}
      </ol>,
    );

  it('never shows a band alone: value, lift, typical and n travel together', () => {
    const { container } = renderDetails();
    const detail = container.querySelector(
      '[data-test="stage-detail"][data-stage="attention"]',
    )!;

    expect(detail.querySelector('[data-test="stage-band"]')).toBeNull();
    expect(
      detail.querySelector('[data-test="stage-measure-line"]')?.textContent,
    ).toMatch(
      /^0:10 average view duration · 0\.\dx typical · typical = 0:40 · n = 20$/,
    );
  });

  it('keeps every depth in the DOM while closed, and flips aria-expanded', () => {
    const { container } = renderDetails();
    const detail = container.querySelector<HTMLElement>(
      '[data-test="stage-detail"][data-stage="attention"]',
    )!;
    const trigger = detail.querySelector<HTMLElement>(
      '[data-test="stage-measure-trigger"]',
    )!;
    const region = detail.querySelector<HTMLElement>(
      '[data-test="stage-measure"]',
    )!;

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(region.hasAttribute('hidden')).toBe(true);
    // Depth 3 is inside depth 2 and still findable: the provider field and path.
    expect(region.textContent).toMatch(/averageViewDuration|Provider field/);
    expect(
      region.querySelector('[data-test="stage-ingestion-path"]')?.textContent,
    ).toMatch(/^Ingestion path: /);
    expect(region.querySelectorAll('[data-test="stage-peer"]')).toHaveLength(
      20,
    );

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(region.hasAttribute('hidden')).toBe(false);

    const raw = region.querySelector<HTMLElement>(
      '[data-test="stage-raw-trigger"]',
    )!;
    expect(raw.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(raw);
    expect(raw.getAttribute('aria-expanded')).toBe('true');
  });

  it('is reachable from the keyboard: every trigger is a button', () => {
    const { container } = renderDetails();

    for (const trigger of container.querySelectorAll(
      '[data-test="stage-measure-trigger"], [data-test="stage-raw-trigger"]',
    )) {
      expect(trigger.tagName).toBe('BUTTON');
    }
  });

  it('names comparables as links, not counts', () => {
    const { container } = renderDetails();
    const link = container.querySelector<HTMLAnchorElement>(
      '[data-test="comparable-link"][data-video-id="peer-0"]',
    )!;

    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBeTruthy();
    expect(link.textContent).toBe('Peer zero');
  });
});

describe('genome findings', () => {
  const CHANNEL = 'c0000000-0000-4000-8000-000000000001';

  function genomeVideo(value: number): GenomeVideo {
    const tags = [
      'topic:ai',
      value >= 29 || value <= 3 ? 'result_first:yes' : 'result_first:no',
    ];

    return {
      videoId: `v${String(value).padStart(2, '0')}`,
      connectionId: CHANNEL,
      platform: 'youtube',
      formatFamily: 'long_horizontal',
      assetDurationSeconds: 300,
      tags,
      value,
    };
  }

  function analysis(control: 'observed' | 'controlled'): GenomeAnalysis {
    return analyseGenome({
      videos: Array.from({ length: 40 }, (_, index) => genomeVideo(index + 1)),
      stage: 'transmission',
      signal: 'share_rate',
      checkpointDays: 30,
      control,
      provenance: metricProvenanceFor('share_rate', 'youtube'),
    });
  }

  function causal(): GenomeAnalysis {
    const base = analysis('controlled');
    const finding = base.findings[0]!;
    const backing = concludedChangeLogEntry({
      id: 'change-1',
      status: 'concluded',
      ended_at: '2026-09-01T00:00:00Z',
      outcome_status: 'confirmed',
    })!;

    return applyLinkedTests(base, [
      {
        hypothesis: genomeHypothesisKey(finding.attribute, 'transmission'),
        backing,
      },
    ]);
  }

  const renderGenome = (genome: GenomeAnalysis) =>
    render(
      <GenomeFindings
        genome={{ transmission: genome }}
        subjectTags={['result_first:yes']}
        videos={{}}
        onSelectVideo={() => {}}
      />,
    );

  it('renders every recommendation beside its evidence block', () => {
    const { container } = renderGenome(analysis('observed'));
    const recommendations = container.querySelectorAll(
      '[data-test="recommendation"]',
    );

    expect(recommendations.length).toBeGreaterThan(0);
    for (const recommendation of recommendations) {
      const siblings = [...(recommendation.parentElement?.children ?? [])];
      expect(
        siblings.some((el) => el.getAttribute('data-test') === 'evidence'),
      ).toBe(true);
    }
  });

  it('words each strength differently, and a causal claim only beside its test', () => {
    const observed = renderGenome(analysis('observed')).container;
    const observedClaim = observed.querySelector('[data-test="genome-claim"]')!;
    expect(observedClaim.textContent).toMatch(/^Videos tagged /);
    expect(observed.querySelector('[data-test="genome-backing"]')).toBeNull();
    cleanup();

    const controlled = renderGenome(analysis('controlled')).container;
    expect(
      controlled.querySelector('[data-test="genome-claim"]')?.textContent,
    ).toMatch(/^Among comparable videos, /);
    expect(controlled.querySelector('[data-test="genome-backing"]')).toBeNull();
    cleanup();

    const tested = renderGenome(causal()).container;
    const finding = tested.querySelector(
      '[data-test="genome-finding"][data-strength="causal"]',
    )!;
    expect(
      finding.querySelector('[data-test="genome-claim"]')?.textContent,
    ).toMatch(/^Changing to .* \(concluded Change log entry, 2026-09-01\)$/);
    expect(
      finding
        .querySelector('[data-test="genome-backing"]')
        ?.getAttribute('data-backing-kind'),
    ).toBe('change_log');
  });

  it('lists both comparable sets as links, and the evidence level', () => {
    const { container } = renderGenome(analysis('observed'));
    const finding = container.querySelector('[data-test="genome-finding"]')!;

    expect(
      finding.querySelectorAll(
        '[data-test="comparable-successful"] a[data-test="comparable-link"]',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      finding.querySelector('[data-test="comparable-unsuccessful"]'),
    ).not.toBeNull();
    expect(
      finding.querySelector('[data-test="evidence-label"]')?.textContent,
    ).toMatch(
      /^(Early signal|Directional|Established pattern) — \d+ videos? · /,
    );
  });
});
