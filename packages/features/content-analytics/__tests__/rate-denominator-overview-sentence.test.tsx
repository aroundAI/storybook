/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { OverviewGrid } from '../src/components/overview/overview-grid';
import { ABSENT } from '../src/lib/measured';
import type { AggregateAnalytics } from '../src/types';
import { renderWithCoverage } from './helpers/coverage';
import { recorded } from './helpers/recorded-rate';

/**
 * FILM-1732: the Overview's own summary names "an average engagement rate
 * of 10.0%", so that sentence carries the record of what the rate divided
 * by, as every other card showing the figure does.
 */
afterEach(cleanup);

const rate = recorded(10, ['youtube', 'tiktok']);

const analytics: AggregateAnalytics = {
  totals: {
    views: 1000,
    likes: 60,
    comments: 25,
    shares: 15,
    watchTimeSeconds: null,
    subscribersGained: null,
    revenueCents: null,
  },
  contentCount: 1,
  avgEngagementRate: rate.value,
  avgEngagementDenominator: rate.denominator,
};

it('puts the record beside the summary that names the rate', () => {
  renderWithCoverage(<OverviewGrid analytics={analytics} revenue={ABSENT} />);

  const card = screen.getByText(/average engagement rate of 10\.0%/);
  const trigger = card.querySelector('[data-test="rate-denominator-trigger"]');

  expect(trigger?.getAttribute('aria-label')).toBe(
    'What the average engagement rate was divided by',
  );

  fireEvent.click(trigger!);

  expect(
    document.querySelector('[data-test="rate-denominator"]')?.textContent,
  ).toContain('YouTube counted a view as');
});

it('puts none beside a model’s reading, which states no figure of ours', () => {
  const { container } = renderWithCoverage(
    <OverviewGrid
      analytics={analytics}
      revenue={ABSENT}
      insights={{ summary: 'Views held.' } as never}
    />,
  );

  expect(
    container.querySelector(
      '[data-test="overview-ai-insight"] [data-test="rate-denominator-trigger"]',
    ),
  ).toBeNull();
});
