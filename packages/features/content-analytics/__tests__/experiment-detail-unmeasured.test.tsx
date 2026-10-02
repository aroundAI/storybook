/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExperimentDetail } from '../src/components/experiments/experiment-detail';

vi.mock('@kit/ui/badge', () => ({
  Badge: ({ children, ...props }: { children?: ReactNode }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('@kit/ui/skeleton', () => ({
  Skeleton: () => <div />,
}));

afterEach(cleanup);

/**
 * KB-162: an experiment over TikTok videos has no watch time in its
 * snapshots. The change row says so, rather than "0 → 0" with no change.
 */
const totals = (watchTimeSeconds: number | null) => ({
  views: 200,
  likes: 2,
  comments: 0,
  shares: 0,
  watchTimeSeconds,
  revenueCents: 0,
});

function renderWith(before: number | null, after: number | null) {
  return render(
    <ExperimentDetail
      experiment={{
        title: 'Hook test',
        hypothesis: null,
        change_description: 'Shorter hook',
        expected_outcome: null,
        actual_outcome: null,
        status: 'concluded',
        outcome_status: 'confirmed',
        started_at: '2026-07-01',
        ended_at: '2026-09-13',
        baseline_metrics: { totals: totals(before) },
        result_metrics: { totals: totals(after), publishCount: 2 },
      }}
    />,
  );
}

describe('ExperimentDetail, for a watch time no video measured (KB-162)', () => {
  it('says the watch time was not measured, with no change', () => {
    const { container } = renderWith(null, null);

    const row = container.querySelector(
      '[data-test="experiment-delta-not-measured"]',
    );
    expect(row?.textContent).toBe('Not measured');
    expect(row?.parentElement?.textContent).toBe('Watch time (s)Not measured');
  });

  it('still shows a measured change', () => {
    const { container } = renderWith(600, 900);

    expect(
      container.querySelector('[data-test="experiment-delta-not-measured"]'),
    ).toBeNull();
    expect(container.textContent).toContain('600 → 900');
  });
});
