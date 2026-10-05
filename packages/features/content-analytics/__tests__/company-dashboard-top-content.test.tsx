/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompanyDashboard } from '../src/components/company-dashboard';
import type {
  AccountDashboardData,
  AccountTopContent,
} from '../src/server/account-dashboard-actions';
import type { AnalyticsTotals } from '../src/types';
import { recorded } from './helpers/recorded-rate';

vi.mock('../src/components/metric-cards', () => ({ MetricCards: () => null }));
vi.mock('../src/components/performance-chart', () => ({
  PerformanceChart: () => null,
}));

afterEach(cleanup);

const TOTALS: AnalyticsTotals = {
  views: 0,
  likes: null,
  comments: null,
  shares: null,
  watchTimeSeconds: null,
  subscribersGained: null,
  revenueCents: null,
  contentCount: 1,
};

function dashboard(topContent: AccountTopContent[]): AccountDashboardData {
  return {
    totals: TOTALS,
    viewsScope: {
      platforms: ['youtube'],
      withRows: ['youtube'],
      windowLabel: 'the last 30 days',
    },
    engagementRate: null,
    revenueAccess: [],
    previousPeriodTotals: TOTALS,
    dailyMetrics: [],
    platformBreakdown: [],
    topContent,
    productionStatus: {
      inProgress: 0,
      finalized: 0,
      published: 1,
      scheduled: 0,
    },
    projectCount: 1,
  };
}

function topContent(
  views: number | null,
  engagementRate: AccountTopContent['engagementRate'],
): AccountTopContent {
  return {
    id: 'p1',
    title: 'A published video',
    views,
    likes: 0,
    engagementRate,
    platform: 'youtube',
  };
}

describe('CompanyDashboard top content (KB-194)', () => {
  it('a measured view count with no engagement rate says engagement not measured', () => {
    const { container } = render(
      <CompanyDashboard
        accountId="a"
        data={dashboard([topContent(0, null)])}
      />,
    );

    expect(container.textContent).toContain(
      '0 views • engagement not measured',
    );
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('0.0% engagement');
  });

  it('a measured rate, 0% included, still reads as a percentage', () => {
    const { container } = render(
      <CompanyDashboard
        accountId="a"
        data={dashboard([topContent(120, recorded(0))])}
      />,
    );

    expect(container.textContent).toContain('120 views • 0.0% engagement');
  });
});
