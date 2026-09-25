/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExperimentDetail,
  type ExperimentMetricSnapshot,
} from '../src/components/experiments/experiment-detail';
import type { WatchedValue } from '../src/lib/watched-metrics';

// `@kit/ui` does not resolve its React runtime from this package's test
// environment; the subscriber component tests stub it the same way.
vi.mock('@kit/ui/badge', () => ({
  Badge: ({ children, ...props }: { children?: ReactNode }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('@kit/ui/skeleton', () => ({
  Skeleton: () => <div />,
}));

afterEach(cleanup);

/** This repo tags elements with `data-test`, not `data-testid`. */
function byTest(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-test="${id}"]`);
  if (!element) throw new Error(`no [data-test="${id}"]`);
  return element;
}

const TOTALS = {
  views: 1,
  likes: 0,
  comments: 0,
  shares: 0,
  watchTimeSeconds: 0,
  revenueCents: 0,
};

function measured(metric: 'ctr' | 'search_share', value: number): WatchedValue {
  return {
    status: 'measured',
    metric,
    value,
    unit: 'ratio',
    window: { start: '2026-06-01', end: '2026-06-30' },
    coveredVideos: 1,
    totalVideos: 1,
    daysWithData: 30,
    windowDays: 30,
  };
}

function experiment(
  overrides: Partial<Parameters<typeof ExperimentDetail>[0]['experiment']> = {},
) {
  return {
    title: 'Thumbnail test',
    hypothesis: null,
    change_description: 'Faces',
    expected_outcome: null,
    actual_outcome: null,
    status: 'concluded',
    outcome_status: 'confirmed',
    started_at: '2026-07-01',
    ended_at: '2026-09-13',
    baseline_metrics: null as ExperimentMetricSnapshot | null,
    result_metrics: null as ExperimentMetricSnapshot | null,
    ...overrides,
  };
}

describe('ExperimentDetail — what each snapshot measured (B4)', () => {
  it('labels the watched block with the metric the snapshots recorded, not the current setting', () => {
    render(
      <ExperimentDetail
        experiment={experiment({
          metric_watched: 'search_share',
          baseline_metrics: { totals: TOTALS, watched: measured('ctr', 0.02) },
          result_metrics: { totals: TOTALS, watched: measured('ctr', 0.03) },
        })}
      />,
    );

    expect(byTest('experiment-watched').textContent).toContain(
      'Impressions click-through rate',
    );
    expect(byTest('experiment-watched').textContent).not.toContain(
      'Search share',
    );
  });

  it('flags a baseline and result that measured different metrics', () => {
    render(
      <ExperimentDetail
        experiment={experiment({
          metric_watched: 'search_share',
          baseline_metrics: { totals: TOTALS, watched: measured('ctr', 0.02) },
          result_metrics: {
            totals: TOTALS,
            watched: measured('search_share', 0.1),
          },
        })}
      />,
    );

    expect(byTest('experiment-watched-mismatch')).toBeTruthy();
  });
});

describe('ExperimentDetail — display (C4-C6)', () => {
  it('shows the elapsed days for every concluded experiment, metric or not', () => {
    render(
      <ExperimentDetail
        experiment={experiment({
          metric_watched: null,
          baseline_metrics: { totals: TOTALS },
          result_metrics: { totals: TOTALS, resultAfterDays: 74 },
        })}
      />,
    );

    expect(byTest('experiment-result-after-days').textContent).toContain(
      '74 days',
    );
  });

  it('shows "Not recorded" for an empty string saved before blanks became null', () => {
    render(
      <ExperimentDetail experiment={experiment({ expected_outcome: '' })} />,
    );

    expect(screen.getByText('Not recorded')).toBeTruthy();
  });

  it('shows the category by its label, not its key', () => {
    render(<ExperimentDetail experiment={experiment({ category: 'hook' })} />);

    expect(byTest('experiment-detail-category').textContent).toBe(
      'Hook / opening',
    );
  });
});

describe('ExperimentDetail — coverage (C2, C3)', () => {
  const base = experiment({
    metric_watched: 'subscribers_net',
    status: 'running',
    ended_at: null,
  });

  it('says how much of the window the figure covers when it is partial', () => {
    render(
      <ExperimentDetail
        experiment={{
          ...base,
          baseline_metrics: {
            totals: TOTALS,
            watched: {
              status: 'measured',
              metric: 'subscribers_net',
              value: 30,
              unit: 'subscribers',
              window: { start: '2026-05-02', end: '2026-06-30' },
              coveredVideos: 2,
              totalVideos: 2,
              daysWithData: 12,
              windowDays: 60,
            },
          },
        }}
      />,
    );

    const side = byTest('experiment-watched-baseline');
    expect(side.textContent).toContain('data on 12 of 60 days');
    // A sum over 12 days is shown per day beside the raw total.
    expect(side.textContent).toContain('+30');
    expect(side.textContent).toContain('2.5 per day');
  });

  it('does not add a coverage note when every day has data', () => {
    render(
      <ExperimentDetail
        experiment={{
          ...base,
          baseline_metrics: {
            totals: TOTALS,
            watched: measured('ctr', 0.02),
          },
        }}
      />,
    );

    expect(byTest('experiment-watched-baseline').textContent).not.toContain(
      'data on',
    );
  });
});

describe('ExperimentDetail — the baseline measured twice (KB-8, owner decision)', () => {
  const partial = (value: number, days: number): WatchedValue => ({
    ...(measured('ctr', value) as Extract<
      WatchedValue,
      { status: 'measured' }
    >),
    window: { start: '2026-05-02', end: '2026-06-30' },
    daysWithData: days,
    windowDays: 60,
  });

  it('shows the start baseline and the re-measured one, each labelled, each with its days', () => {
    render(
      <ExperimentDetail
        experiment={experiment({
          metric_watched: 'ctr',
          baseline_metrics: { totals: TOTALS, watched: partial(0.04, 57) },
          result_metrics: {
            totals: TOTALS,
            watched: measured('ctr', 0.05),
            baselineRemeasured: partial(0.042, 60),
          },
        })}
      />,
    );

    const atStart = byTest('experiment-watched-baseline');
    const again = byTest('experiment-watched-baseline-remeasured');

    expect(atStart.textContent).toContain('measured at the start');
    expect(atStart.textContent).toContain('4.0%');
    expect(atStart.textContent).toContain('data on 57 of 60 days');

    expect(again.textContent).toContain('measured again at conclusion');
    expect(again.textContent).toContain('4.2%');
    // Stated even when every day has data: the two are read side by side.
    expect(again.textContent).toContain('data on 60 of 60 days');
  });

  it('draws no comparison between the two baselines', () => {
    render(
      <ExperimentDetail
        experiment={experiment({
          metric_watched: 'ctr',
          baseline_metrics: { totals: TOTALS, watched: partial(0.04, 57) },
          result_metrics: {
            totals: TOTALS,
            watched: measured('ctr', 0.05),
            baselineRemeasured: partial(0.042, 60),
          },
        })}
      />,
    );

    // Exactly the three measured figures, and no fourth derived from two of
    // them: the owner chose no headline comparison.
    const figures =
      byTest('experiment-watched').textContent?.match(/[+−-]?\d+(\.\d+)?%/g) ??
      [];
    expect(figures).toEqual(['4.0%', '4.2%', '5.0%']);
  });

  it('shows one baseline, as before, when the change was concluded before the re-measure existed', () => {
    render(
      <ExperimentDetail
        experiment={experiment({
          metric_watched: 'ctr',
          baseline_metrics: { totals: TOTALS, watched: measured('ctr', 0.04) },
          result_metrics: { totals: TOTALS, watched: measured('ctr', 0.05) },
        })}
      />,
    );

    expect(
      document.querySelector(
        '[data-test="experiment-watched-baseline-remeasured"]',
      ),
    ).toBeNull();
  });
});

describe('ExperimentDetail — tags (FILM-1509 remaining, now FILM-1610)', () => {
  it('lists the linked tags by label', () => {
    render(
      <ExperimentDetail
        experiment={experiment({
          tags: [
            {
              tag_id: 't1',
              content_tags: { dimension: 'topic', slug: 'a', label: 'Cooking' },
            },
            {
              tag_id: 't2',
              content_tags: {
                dimension: 'format',
                slug: 'b',
                label: 'Tutorial',
              },
            },
          ],
        })}
      />,
    );

    expect(byTest('experiment-detail-tags').textContent).toContain('Cooking');
    expect(byTest('experiment-detail-tags').textContent).toContain('Tutorial');
  });
});
