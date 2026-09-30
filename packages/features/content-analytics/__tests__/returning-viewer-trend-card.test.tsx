/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReturningViewerProxyCard } from '../src/components/deep-dive/returning-viewer-proxy-card';
import {
  subscribedShareSeries,
  subscribedSplit,
} from '../src/lib/returning-viewer-proxy';

vi.mock('@kit/ui/skeleton', () => ({ Skeleton: () => <div /> }));

afterEach(cleanup);

const byTest = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-test="${name}"]`);

function splitFor(
  months: Array<[string, number, number]>,
): Parameters<typeof ReturningViewerProxyCard>[0]['split'] {
  const trend = subscribedShareSeries(
    months.map(([month, subscribedViews, notSubscribedViews]) => ({
      month,
      videoCount: 1,
      videosWithSplit: 1,
      subscribedViews,
      notSubscribedViews,
    })),
  );

  return {
    ...subscribedSplit([
      {
        key: 'subscribed',
        views: months.reduce((n, [, subscribed]) => n + subscribed, 0),
      },
      {
        key: 'not_subscribed',
        views: months.reduce((n, [, , not]) => n + not, 0),
      },
    ]),
    trend,
  };
}

describe('ReturningViewerProxyCard trend', () => {
  it('draws two runs and lists the gap month as no data, never 0%', () => {
    const { container } = render(
      <ReturningViewerProxyCard
        split={splitFor([
          ['2026-01-01', 350, 850],
          ['2026-03-01', 30, 70],
        ])}
      />,
    );

    const chart = byTest(container, 'returning-viewer-trend-chart')!;

    expect(chart.getAttribute('aria-label')).toContain('gaps');
    expect(chart.querySelectorAll('circle')).toHaveLength(2);
    expect(chart.querySelectorAll('polyline')).toHaveLength(0);

    const rows = [
      ...byTest(container, 'returning-viewer-table')!.querySelectorAll(
        'tbody tr',
      ),
    ].map((row) => row.textContent);

    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('no data');
    expect(rows[1]).not.toContain('0%');
    expect(rows[2]).toContain('30%');
  });

  it('joins consecutive measurable months with a line', () => {
    const { container } = render(
      <ReturningViewerProxyCard
        split={splitFor([
          ['2026-01-01', 1, 1],
          ['2026-02-01', 1, 3],
        ])}
      />,
    );

    expect(
      byTest(container, 'returning-viewer-trend-chart')!.querySelectorAll(
        'polyline',
      ),
    ).toHaveLength(1);
  });

  it('renders nothing when nothing was measured', () => {
    const { container } = render(
      <ReturningViewerProxyCard split={splitFor([])} />,
    );

    expect(container.innerHTML).toBe('');
  });
});
