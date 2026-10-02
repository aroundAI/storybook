/**
 * @vitest-environment happy-dom
 */
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PerformanceOverTimeCard } from '../src/components/analytics-dashboard';
import type { DailyMetric } from '../src/types';
import { renderWithCoverage } from './helpers/coverage';

/**
 * FILM-1707 (FILM-1722 §5): Performance Over Time is on the one shell, and
 * a window crossing the day YouTube changed what counts as a view
 * (2026-08-27) marks the day rather than drawing the step as viewers.
 */
afterEach(cleanup);

function day(date: string, platform: string, views: number): DailyMetric {
  return {
    date,
    views,
    likes: 0,
    comments: 0,
    shares: 0,
    byPlatform: {
      [platform]: { views, likes: 0, comments: 0, shares: 0 },
    },
  };
}

const card = (container: HTMLElement) =>
  container.querySelector('[data-test="overview-performance"]');

describe('Performance Over Time', () => {
  it('marks the view-definition change a YouTube window crosses', () => {
    const { container } = renderWithCoverage(
      <PerformanceOverTimeCard
        data={[
          day('2026-08-20', 'youtube', 100),
          day('2026-09-03', 'youtube', 400),
        ]}
        platforms={['youtube', 'tiktok', 'instagram']}
        isLoading={false}
        from="2026-08-20"
        to="2026-09-03"
      />,
    );

    const marks = [
      ...container.querySelectorAll('[data-test="view-definition-mark"]'),
    ];

    expect(marks.map((mark) => mark.getAttribute('data-date'))).toEqual([
      '2026-08-27',
    ]);
    expect(marks[0]?.textContent).toContain('changed what counts as a view');
    expect(card(container)?.getAttribute('data-card-shell')).toBe('analytics');
    expect(
      card(container)?.querySelector('[data-test="card-figure"]')?.textContent,
    ).toBe('500');
  });

  it('marks nothing when the window is wholly on one side', () => {
    const { container } = renderWithCoverage(
      <PerformanceOverTimeCard
        data={[
          day('2026-09-01', 'youtube', 100),
          day('2026-09-20', 'youtube', 100),
        ]}
        platforms={['youtube']}
        isLoading={false}
        from="2026-09-01"
        to="2026-09-20"
      />,
    );

    expect(
      container.querySelectorAll('[data-test="view-definition-mark"]'),
    ).toHaveLength(0);
  });

  it('marks nothing for a platform whose definition did not change', () => {
    const { container } = renderWithCoverage(
      <PerformanceOverTimeCard
        data={[
          day('2026-08-20', 'tiktok', 100),
          day('2026-09-03', 'tiktok', 100),
        ]}
        platforms={['youtube', 'tiktok']}
        isLoading={false}
        from="2026-08-20"
        to="2026-09-03"
      />,
    );

    expect(
      container.querySelectorAll('[data-test="view-definition-mark"]'),
    ).toHaveLength(0);
  });
});
