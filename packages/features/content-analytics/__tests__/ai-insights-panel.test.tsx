/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIInsights } from '../src/components/ai-insights';
import type { InsightsResult } from '../src/types';
import { TestCoverage } from './helpers/coverage';

const action = vi.hoisted(() => ({
  insights: null as unknown,
}));

vi.mock('../src/server/insights-actions', () => ({
  generateInsightsAction: async () => ({ ok: true, data: action.insights }),
}));

vi.mock('@kit/ui/hooks', () => ({
  useLlmJob: () => ({ status: 'idle', result: null, error: null }),
}));

vi.mock('@kit/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/**
 * FILM-808. The panel shows the model's trends, audience reading and the
 * reasons top content performed, and where there is none it says there is
 * none: no section is drawn around an invented list.
 */
afterEach(cleanup);

const answer = (over: Partial<InsightsResult> = {}): InsightsResult => ({
  summary: 'Views doubled.',
  trends: [],
  contentRecommendations: [],
  postingStrategy: [],
  audienceInsights: [],
  topPerformers: [],
  actionItems: [],
  ...over,
});

const analytics = {
  totals: {
    views: 10,
    likes: 1,
    comments: 0,
    shares: 0,
    watchTimeSeconds: 0,
    subscribersGained: 0,
    revenueCents: 0,
    contentCount: 1,
  },
  contentCount: 1,
  avgEngagementRate: 0.1,
};

async function renderPanel(insights: InsightsResult) {
  action.insights = insights;

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TestCoverage>
        <AIInsights
          projectId="p"
          analytics={analytics}
          windowLabel="2026-09-01 to 2026-09-30"
        />
      </TestCoverage>
    </QueryClientProvider>,
  );

  await screen.findByText(insights.summary);
}

const text = (dataTest: string) =>
  document.querySelector(`[data-test="${dataTest}"]`)?.textContent ?? '';

describe('the insights panel', () => {
  beforeEach(() => {
    action.insights = null;
  });

  it('renders trends, audience insights and why top content performed', async () => {
    await renderPanel(
      answer({
        trends: ['Views rose 100% across the selected platforms.'],
        audienceInsights: ['40% of measured viewers are 25-34.'],
        topPerformers: [
          { title: 'Pilot', analysis: 'Most views, 6% engaged.' },
        ],
      }),
    );

    expect(text('ai-insights-trends')).toContain('Views rose 100%');
    expect(text('ai-insights-audience')).toContain('25-34');
    expect(text('ai-insights-top-performers')).toContain('Pilot');
    expect(text('ai-insights-top-performers')).toContain('Most views');
  });

  it('says there is nothing, and claims no data, when the lists are empty', async () => {
    await renderPanel(answer());

    expect(text('ai-insights-trends')).toContain('No trends to report');
    expect(text('ai-insights-audience')).toContain(
      'No audience breakdown was available',
    );
    expect(text('ai-insights-top-performers')).toContain(
      'No top content was available',
    );
    expect(document.querySelectorAll('li')).toHaveLength(0);
  });

  /**
   * FILM-1707 §3: a generated reading is not a measurement. Every card is
   * on the shared shell, chipped as not measured, and says what it was
   * given and for which window — never which platform "reported" it.
   */
  it('chips every card as not measured and states what the model was given', async () => {
    await renderPanel(answer({ trends: ['Views rose.'] }));

    const cards = [...document.querySelectorAll('[data-card-shell]')];

    expect(cards.length).toBeGreaterThanOrEqual(4);

    for (const card of cards) {
      expect(card.getAttribute('data-metric-family')).toBe('generated');
      expect(
        card.querySelector('[data-test="provenance-chip"]')?.textContent,
      ).toContain('Not measured');
    }

    expect(text('ai-insights-summary')).toContain(
      'given this project’s totals for 2026-09-01 to 2026-09-30',
    );
  });
});
