/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { capabilityFor } from '@kit/clickhouse';

import { AnalyticsCard } from '../src/components/overview/analytics-card';
import { renderWithCoverage } from './helpers/coverage';

/**
 * FILM-1706. The shell every Overview and Deep Dive card renders in: one
 * claim per card, evidence one gesture away. These run the real Radix
 * trigger, not a stub — what the disclosure announces is the point.
 */
afterEach(cleanup);

/** The card's text without its provenance chip, whose "3 platforms" is not a figure. */
function textOutsideChip(container: HTMLElement) {
  const copy = container.cloneNode(true) as HTMLElement;

  copy
    .querySelectorAll('[data-test="provenance-chip"]')
    .forEach((chip) => chip.remove());

  return copy.textContent;
}

const figureOf = (container: HTMLElement) =>
  container.querySelector('[data-test="card-figure"]');

describe('the claim', () => {
  it('shows one figure in tabular digits and one sentence', () => {
    const { container, getByText } = renderWithCoverage(
      <AnalyticsCard
        title={'Total Views'}
        metricFamily={'engagement'}
        claim={{ figure: '111,111', sentence: 'Views in the last 30 days.' }}
      />,
    );

    const figure = figureOf(container);

    expect(figure?.textContent).toBe('111,111');
    expect(figure?.className).toContain('tabular-nums');
    expect(getByText('Views in the last 30 days.')).toBeTruthy();
  });

  it('shows the stated reason, and no digits, where there is no figure', () => {
    const { container, getByText } = renderWithCoverage(
      <AnalyticsCard
        title={'Total Views'}
        metricFamily={'engagement'}
        claim={{
          figure: null,
          noFigure: 'Could not be read.',
          sentence: 'Views for this period could not be loaded.',
        }}
      />,
    );

    expect(figureOf(container)).toBeNull();
    expect(getByText('Could not be read.')).toBeTruthy();
    expect(textOutsideChip(container)).not.toMatch(/\d/);
  });

  it('shows placeholders, not a zero, while loading', () => {
    const { container } = renderWithCoverage(
      <AnalyticsCard
        title={'Total Views'}
        metricFamily={'engagement'}
        claim={'loading'}
      />,
    );

    expect(figureOf(container)).toBeNull();
    expect(textOutsideChip(container)).not.toMatch(/\d/);
  });
});

describe('the disclosure', () => {
  const details = {
    breakdown: [
      { label: 'YouTube', value: '3' },
      { label: 'TikTok', value: '1' },
    ],
    method: 'Share of views by platform.',
    caveats: ['Views on unmatched videos are not counted.'],
  } as const;

  function renderWithDetails() {
    return renderWithCoverage(
      <AnalyticsCard
        title={'Platform Split'}
        metricFamily={'engagement'}
        claim={{ figure: '75%', sentence: 'YouTube had the largest share.' }}
        details={details}
        data-test={'split'}
      />,
    );
  }

  it('is a button that announces whether it is open', () => {
    const { getByRole } = renderWithDetails();
    const trigger = getByRole('button', { name: /details/i });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('controls a region that stays in the DOM while closed, for find-in-page', () => {
    const { getByRole, container } = renderWithDetails();
    const trigger = getByRole('button', { name: /details/i });
    const region = container.querySelector(
      `#${CSS.escape(trigger.getAttribute('aria-controls') ?? '')}`,
    );

    expect(region).not.toBeNull();
    expect(region?.hasAttribute('hidden')).toBe(true);
    expect(region?.textContent).toContain(
      'Views on unmatched videos are not counted.',
    );
  });

  it('opens when find-in-page lands inside it', () => {
    const { getByRole, container } = renderWithDetails();
    const trigger = getByRole('button', { name: /details/i });
    const region = container.querySelector(
      `#${CSS.escape(trigger.getAttribute('aria-controls') ?? '')}`,
    );

    fireEvent(region!, new Event('beforematch'));

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(region?.hasAttribute('hidden')).toBe(false);
  });

  it('keeps a fixed order: breakdown, source, method, then caveats', () => {
    const { container } = renderWithDetails();
    const text = container.querySelector(
      '[data-test="split-details"]',
    )?.textContent;

    expect(text).toBeDefined();

    const order = [
      'YouTube',
      'Where this comes from',
      'Share of views by platform.',
      'Views on unmatched videos are not counted.',
    ].map((part) => text!.indexOf(part));

    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(container.querySelector('dl')).not.toBeNull();
  });

  it('says where the figure comes from in the matrix’s own words', () => {
    const { container } = renderWithDetails();

    expect(container.textContent).toContain(
      capabilityFor('engagement', 'youtube').note,
    );
  });

  it('marks a card that has details, and only such a card', () => {
    const withDetails = renderWithDetails();
    const root = withDetails.container.querySelector('[data-test="split"]');

    expect(root?.className).toContain('hover:bg-accent/30');
    cleanup();

    const { container, queryByRole } = renderWithCoverage(
      <AnalyticsCard
        title={'AI'}
        metricFamily={'recorded'}
        claim={{
          figure: null,
          noFigure: 'Not a measurement.',
          sentence: 'A restatement.',
        }}
        data-test={'plain'}
        details={null}
      />,
    );

    expect(queryByRole('button', { name: /details/i })).toBeNull();
    expect(
      container.querySelector('[data-test="plain"]')?.className,
    ).not.toContain('hover:bg-accent');
  });
});

describe('the shell is on the design system', () => {
  it('paints with tokens, and has no fixed height', () => {
    const { container } = renderWithCoverage(
      <AnalyticsCard
        title={'Shares'}
        metricFamily={'engagement'}
        claim={{ figure: '4', sentence: 'Times content was shared.' }}
        data-test={'shares'}
      />,
    );

    const root = container.querySelector('[data-test="shares"]');

    expect(root?.className).toMatch(/\bbg-card\b/);
    expect(root?.className).toMatch(/\bborder-border\b/);
    expect(root?.className).toMatch(/\btext-card-foreground\b/);
    expect(root?.className).not.toMatch(/\bh-\d+\b/);
  });
});

describe('the invariants are in the type', () => {
  // Checked by `tsc` over __tests__: each directive is an error if the
  // element under it compiles.
  const claim = { figure: '1', sentence: 'One.' } as const;

  it('compiles only the well-formed card', () => {
    const cards = [
      <AnalyticsCard
        key={'ok'}
        title={'ok'}
        metricFamily={'engagement'}
        claim={claim}
      />,
      <AnalyticsCard
        key={'many'}
        title={'ok'}
        metricFamily={['channel_totals', 'watch_time']}
        claim={claim}
      />,
      // @ts-expect-error a card declares what it shows
      <AnalyticsCard key={'family'} title={'x'} claim={claim} />,
      <AnalyticsCard
        key={'bad'}
        title={'x'}
        // @ts-expect-error nor a family the matrix does not know
        metricFamily={'likes'}
        claim={claim}
      />,
      <AnalyticsCard
        key={'reason'}
        title={'x'}
        metricFamily={'engagement'}
        // @ts-expect-error no figure without saying why
        claim={{ figure: null, sentence: 'One.' }}
      />,
      <AnalyticsCard
        key={'sentence'}
        title={'x'}
        metricFamily={'engagement'}
        // @ts-expect-error a figure always comes with its sentence
        claim={{ figure: '1' }}
      />,
      <AnalyticsCard
        key={'paint'}
        title={'x'}
        metricFamily={'engagement'}
        claim={claim}
        // @ts-expect-error no card is emphasised by painting it
        variant={'gradient'}
      />,
      <AnalyticsCard
        key={'height'}
        title={'x'}
        metricFamily={'engagement'}
        claim={claim}
        // @ts-expect-error no caller escapes the height by class
        className={'h-auto'}
      />,
      <AnalyticsCard
        key={'empty'}
        title={'x'}
        metricFamily={'engagement'}
        claim={claim}
        // @ts-expect-error an empty caveat list is not a disclosure
        details={{ caveats: [] }}
      />,
    ];

    expect(cards).toHaveLength(9);
  });
});
