/**
 * @vitest-environment happy-dom
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VIEWS_NOT_MEASURED_REASON } from '../../lib/views';
import type { AnalyticsTotals } from '../../types';
import { MetricCards } from '../metric-cards';

vi.mock('@kit/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

/**
 * KB-162: a Facebook-only team has no views at all — Facebook counts four
 * kinds of view and none is a view in this sense (KB-153) — and the Views
 * card read the null as 0. It says "Not measured", with Facebook's reason.
 */
const facebookTeam: AnalyticsTotals = {
  views: null,
  likes: 14,
  comments: 0,
  shares: 0,
  watchTimeSeconds: null,
  subscribersGained: null,
  revenueCents: 0,
  contentCount: 1,
};

function viewsCard(container: HTMLElement) {
  return container.querySelector<HTMLElement>(
    '[data-test="metric-card-views"]',
  )!;
}

describe('MetricCards, for a team whose views no platform measured (KB-162)', () => {
  it('says Views were not measured, with Facebook’s reason, never 0', () => {
    const { container } = render(
      <MetricCards data={facebookTeam} previousData={null} isLoading={false} />,
    );
    const card = viewsCard(container);

    const notMeasured = within(card).getByText('Not measured');
    expect(notMeasured.getAttribute('title')).toBe(VIEWS_NOT_MEASURED_REASON);
    expect(card.querySelector('[data-test="metric-value"]')).toBeNull();
    // Likes, which Facebook does measure, are still a figure.
    expect(screen.getByText('14')).toBeDefined();
  });

  it('still shows measured views', () => {
    const { container } = render(
      <MetricCards
        data={{ ...facebookTeam, views: 1200 }}
        previousData={null}
        isLoading={false}
      />,
    );

    expect(within(viewsCard(container)).getByText('1.2K')).toBeDefined();
    expect(within(viewsCard(container)).queryByText('Not measured')).toBeNull();
  });
});
