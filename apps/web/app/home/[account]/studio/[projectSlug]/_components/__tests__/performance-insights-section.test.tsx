import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordViewsDenominator } from '@kit/clickhouse';

import type { OverviewAnalytics } from '../overview-constants';
import { PerformanceInsightsSection } from '../performance-insights-section';

vi.mock('@kit/content-analytics/components', () => ({
  RateDenominator: () => null,
}));

afterEach(cleanup);

const analytics: OverviewAnalytics = {
  totalViews: 1200,
  totalLikes: 90,
  totalComments: 10,
  avgEngagementRate: {
    value: 8.3,
    denominator: recordViewsDenominator({
      platforms: ['youtube'],
      window: { from: '2026-09-01', to: '2026-09-30' },
    }),
  },
  contentCount: 4,
};

describe('PerformanceInsightsSection', () => {
  it('shows no trend badge or trend line, because no period-over-period figure is measured (KB-193)', () => {
    const { container } = render(
      <PerformanceInsightsSection analytics={analytics} />,
    );

    const text = container.textContent ?? '';
    expect(text).not.toMatch(/[+-]\d+(\.\d+)?%/);
    expect(container.querySelector('svg path[d*="Q 20 18"]')).toBeNull();
  });

  it('still shows the measured figures', () => {
    const { container } = render(
      <PerformanceInsightsSection analytics={analytics} />,
    );

    expect(container.textContent).toContain('1.2k');
    expect(container.textContent).toContain('8%');
  });

  it('shows no trend badge when nothing is measured', () => {
    const { container } = render(
      <PerformanceInsightsSection analytics={null} />,
    );

    expect(container.textContent).not.toMatch(/[+-]\d+%/);
  });

  it('says Not measured, never 0%, when the engagement rate is null (KB-194)', () => {
    const { container } = render(
      <PerformanceInsightsSection
        analytics={{ ...analytics, avgEngagementRate: null }}
      />,
    );

    const engagement = container.querySelector(
      '[data-test="overview-engagement-rate"]',
    );

    expect(engagement?.textContent).toBe('Not measured');
  });

  it('shows a measured 0% as 0%', () => {
    const { container } = render(
      <PerformanceInsightsSection
        analytics={{
          ...analytics,
          avgEngagementRate: { ...analytics.avgEngagementRate, value: 0 },
        }}
      />,
    );

    expect(
      container.querySelector('[data-test="overview-engagement-rate"]')
        ?.textContent,
    ).toBe('0%');
  });
});
