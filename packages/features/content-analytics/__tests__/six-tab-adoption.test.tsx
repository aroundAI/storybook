/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ANALYTICS_PLATFORMS,
  type ObservedCoverageRow,
  capabilityFor,
} from '@kit/clickhouse';

import {
  DATE_AXIS_NOTE_KEY,
  DateAxisNote,
} from '../src/components/deep-dive/date-axis-note';
import { MedianViewsCard } from '../src/components/deep-dive/median-views-card';
import { AnalyticsCard } from '../src/components/overview/analytics-card';
import {
  TRUE_DAILY_PLATFORMS,
  dateAxisScope,
  fetchDatedSentence,
  isFetchDated,
} from '../src/lib/row-dating';
import {
  markedBuckets,
  marksForBuckets,
  viewDefinitionMarks,
} from '../src/lib/view-definition-marks';
import {
  channelRef,
  coverageResult,
  renderWithCoverage,
} from './helpers/coverage';

/**
 * FILM-1707: what the shell says about a card the six tabs needed it to
 * say — a date axis that leaves fetch-dated platforms out (§2), an
 * account-level audience, a rule-built summary, a slot we do not collect —
 * and the view-definition marks a chart carries (FILM-1722).
 */
afterEach(cleanup);

const row = (
  table: ObservedCoverageRow['table'],
  platform: string,
): ObservedCoverageRow => ({
  table,
  platform,
  rows: 10,
  latestDate: '2026-09-29',
  metricSources: [],
});

const chipOf = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('[data-test="provenance-chip"]')!;

const scopeNoteOf = (container: HTMLElement) =>
  container.querySelector('[data-test="card-scope-note"]');

describe('the date-axis rule (§2), read from the matrix', () => {
  it('calls a platform fetch-dated exactly when its engagement is a snapshot delta', () => {
    for (const platform of ANALYTICS_PLATFORMS) {
      expect(isFetchDated(platform)).toBe(
        capabilityFor('engagement', platform).method ===
          'snapshot_delta_fetch_day',
      );
    }

    expect(TRUE_DAILY_PLATFORMS).toEqual(['youtube']);
  });

  it('says which platforms it leaves out, only when the project uses them', () => {
    expect(dateAxisScope(ANALYTICS_PLATFORMS, ['youtube'])).toEqual({
      platforms: ['youtube'],
      excluded: [],
      sentence: null,
    });

    expect(
      dateAxisScope(ANALYTICS_PLATFORMS, ['youtube', 'tiktok', 'instagram'])
        .sentence,
    ).toBe(
      'TikTok and Instagram aren’t shown here — they report running totals, not daily views.',
    );

    expect(fetchDatedSentence(['tiktok'])).toBe(
      'TikTok isn’t shown here — it reports running totals, not daily views.',
    );
  });
});

describe('a card on a date axis', () => {
  const pooled = coverageResult({
    rows: [row('video_metrics', 'youtube'), row('video_metrics', 'tiktok')],
    channels: [channelRef('youtube'), channelRef('tiktok')],
  });

  function MedianCard(props: { onDateAxis?: boolean; tiktokOnly?: boolean }) {
    return (
      <AnalyticsCard
        title={'Median views per video'}
        metricFamily={'engagement'}
        platforms={props.tiktokOnly ? ['tiktok'] : undefined}
        onDateAxis={props.onDateAxis}
        claim={{ figure: '200', sentence: 'January’s median upload.' }}
        data-test={'median'}
      />
    );
  }

  it('names only what it plots, never the platforms it pooled before', () => {
    const { container } = renderWithCoverage(<MedianCard onDateAxis />, {
      result: pooled,
    });

    expect(chipOf(container).textContent).toBe('YouTube only');
    expect(scopeNoteOf(container)?.textContent).toBe(
      'TikTok isn’t shown here — it reports running totals, not daily views.',
    );
    expect(container.querySelector('[data-date-axis="true"]')).not.toBeNull();
  });

  it('is what a pooled card would have claimed without the rule', () => {
    const { container } = renderWithCoverage(<MedianCard />, {
      result: pooled,
    });

    expect(chipOf(container).textContent).toBe(
      '2 of 3 platforms · partly derived',
    );
    expect(scopeNoteOf(container)).toBeNull();
  });

  it('says nothing about platforms a YouTube-only creator does not use', () => {
    const youtubeOnly = coverageResult({
      rows: [row('video_metrics', 'youtube')],
      channels: [channelRef('youtube')],
    });
    const { container } = renderWithCoverage(<MedianCard onDateAxis />, {
      result: youtubeOnly,
    });

    expect(chipOf(container).textContent).toBe('YouTube only');
    expect(scopeNoteOf(container)).toBeNull();
  });

  it('with only a fetch-dated platform chosen, says there is nothing to plot and why', () => {
    const { container } = renderWithCoverage(
      <MedianCard onDateAxis tiktokOnly />,
      { result: pooled },
    );

    expect(chipOf(container).textContent).toBe('Not on a date axis');
    expect(
      container.querySelector('[data-test="card-coverage-note"]')?.textContent,
    ).toBe(
      'TikTok isn’t shown here — it reports running totals, not daily views.',
    );
  });
});

describe('an account-level audience is not per-video measurement', () => {
  it('states the matrix’s account-wide note in the card, not only behind the chip', () => {
    const result = coverageResult({
      rows: [
        row('video_audience', 'youtube'),
        row('video_audience', 'instagram'),
      ],
      channels: [channelRef('youtube'), channelRef('instagram')],
    });
    const { container } = renderWithCoverage(
      <AnalyticsCard
        title={'Gender'}
        metricFamily={'demographics'}
        claim={{ figure: '52%', sentence: 'Women made up the largest share.' }}
      />,
      { result },
    );

    expect(scopeNoteOf(container)?.textContent).toBe(
      capabilityFor('demographics', 'instagram').note,
    );
  });

  it('says nothing of the kind when only YouTube, which is per video, is covered', () => {
    const result = coverageResult({
      rows: [row('video_audience', 'youtube')],
      channels: [channelRef('youtube'), channelRef('instagram')],
    });
    const { container } = renderWithCoverage(
      <AnalyticsCard
        title={'Gender'}
        metricFamily={'demographics'}
        claim={{ figure: '52%', sentence: 'Women made up the largest share.' }}
      />,
      { result },
    );

    expect(scopeNoteOf(container)).toBeNull();
  });
});

describe('cards no platform reported', () => {
  it.each([
    ['summary', 'Page summary'],
    ['not_collected', 'Not collected'],
    ['generated', 'Not measured'],
    ['recorded', 'Recorded'],
  ] as const)('a %s card is chipped “%s”', (kind, label) => {
    const { container } = renderWithCoverage(
      <AnalyticsCard
        title={kind}
        metricFamily={kind}
        claim={{ figure: null, noFigure: 'None.', sentence: 'Nothing.' }}
      />,
    );

    expect(chipOf(container).textContent).toBe(label);
  });

  it('carries the card’s own provenance note behind the chip', () => {
    const { container } = renderWithCoverage(
      <AnalyticsCard
        title={'AI Insights'}
        metricFamily={'generated'}
        provenanceNote={'Given this project’s totals, for September.'}
        claim={{ figure: null, noFigure: 'None.', sentence: 'Nothing.' }}
      />,
    );

    fireEvent.click(chipOf(container));

    expect(
      document.querySelector('[data-test="provenance-chip-details"]')
        ?.textContent,
    ).toContain('Given this project’s totals, for September.');
  });
});

describe('view-definition marks (FILM-1722 §5)', () => {
  it('marks YouTube’s 27 Aug 2026 change inside a range, and nothing outside it', () => {
    expect(
      viewDefinitionMarks(['youtube'], '2026-08-01', '2026-09-30').map(
        ({ date }) => date,
      ),
    ).toEqual(['2026-08-27']);
    expect(
      viewDefinitionMarks(['youtube'], '2026-09-01', '2026-09-30'),
    ).toEqual([]);
    expect(viewDefinitionMarks(['tiktok'], '2026-08-01', '2026-09-30')).toEqual(
      [],
    );
  });

  it('covers a monthly chart’s last month to its end', () => {
    const marks = marksForBuckets(
      ['youtube'],
      ['2026-07-01', '2026-08-01'],
      'month',
    );

    expect(marks.map(({ date }) => date)).toEqual(['2026-08-27']);
    expect([...markedBuckets(['2026-07-01', '2026-08-01'], marks)]).toEqual([
      '2026-08-01',
    ]);
  });

  it('is drawn beside the chart by the shell', () => {
    renderWithCoverage(
      <AnalyticsCard
        title={'Rolling 90-day views'}
        metricFamily={'engagement'}
        marks={viewDefinitionMarks(['youtube'], '2026-08-01', '2026-09-30')}
        claim={{ figure: '1,000', sentence: 'Views.' }}
      />,
    );

    const mark = document.querySelector('[data-test="view-definition-mark"]')!;

    expect(mark.getAttribute('data-date')).toBe('2026-08-27');
    expect(mark.textContent).toContain('YouTube changed what counts as a view');
  });
});

describe('the one-time note that the figures moved (§2)', () => {
  // Node 25 puts a global `localStorage` of its own over happy-dom's,
  // which fails without a backing file; the note reads a plain store.
  beforeEach(() => {
    const store = new Map<string, string>();

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    });
  });

  it('shows even when storage throws, and dismisses for the visit', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });

    render(<DateAxisNote excluded={['instagram']} />);

    fireEvent.click(
      document.querySelector('[data-test="deep-dive-date-axis-note-dismiss"]')!,
    );

    expect(
      document.querySelector('[data-test="deep-dive-date-axis-note"]'),
    ).toBeNull();
  });

  it('shows for a project on a fetch-dated platform, and stays dismissed', () => {
    const { unmount } = render(<DateAxisNote excluded={['tiktok']} />);

    expect(screen.getByText('These figures changed')).toBeTruthy();

    fireEvent.click(
      document.querySelector('[data-test="deep-dive-date-axis-note-dismiss"]')!,
    );

    expect(
      document.querySelector('[data-test="deep-dive-date-axis-note"]'),
    ).toBeNull();
    expect(window.localStorage.getItem(DATE_AXIS_NOTE_KEY)).toBe('1');

    unmount();
    render(<DateAxisNote excluded={['tiktok']} />);

    expect(
      document.querySelector('[data-test="deep-dive-date-axis-note"]'),
    ).toBeNull();
  });

  it('does not show for a project that uses no fetch-dated platform', () => {
    render(<DateAxisNote excluded={[]} />);

    expect(
      document.querySelector('[data-test="deep-dive-date-axis-note"]'),
    ).toBeNull();
  });
});

describe('the median chart draws inside itself (KB-155)', () => {
  it('places every band by its bottom, never by a percentage margin', () => {
    const { container } = render(
      <MedianViewsCard
        buckets={[
          {
            bucket: '2026-08-01',
            videoCount: 1,
            medianViews: 200,
            p25Views: 200,
            p75Views: 200,
            meanViews: 200,
          },
          {
            bucket: '2026-09-01',
            videoCount: 2,
            medianViews: 45,
            p25Views: 42.5,
            p75Views: 47.5,
            meanViews: 45,
          },
        ]}
      />,
    );

    const styled = [...container.querySelectorAll<HTMLElement>('[style]')];

    // A vertical margin's percentage is of the width: it lifted each band
    // hundreds of pixels above a 96px chart.
    expect(
      styled.filter(({ style }) =>
        /%/.test(style.marginBottom + style.marginTop),
      ),
    ).toEqual([]);

    const bands = container.querySelectorAll<HTMLElement>(
      '[data-test="median-band"]',
    );

    expect([...bands].map(({ style }) => style.bottom)).toEqual([
      '100%',
      '21.25%',
    ]);
  });
});
