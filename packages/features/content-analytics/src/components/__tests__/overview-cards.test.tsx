/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ABSENT, measured } from '../../lib/measured';
import type { ProjectRevenue } from '../../lib/project-revenue';
import { CommentsCard } from '../overview/comments-card';
import { PlatformSplitCard } from '../overview/platform-split-card';
import { RevenueCard } from '../overview/revenue-card';
import { SharesCard } from '../overview/shares-card';

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
 * KB-16: the Overview cards render what was measured, say so when nothing
 * was, and cannot be handed a default to draw instead. The
 * `@ts-expect-error` lines are the invariant: each is a call shape that
 * used to compile and produce an invented figure.
 */
describe('SharesCard', () => {
  it('shows the total and says the breakdown is not collected', () => {
    const { container } = render(<SharesCard shares={1234} />);

    expect(screen.getByText('1.2K')).toBeDefined();
    expect(
      screen.getByText(/We don’t collect how content was shared/),
    ).toBeDefined();
    // No donut and no legend: "Direct" / "Copy Link" was the 83/17 chart.
    expect(container.textContent).not.toContain('Direct');
    expect(container.textContent).not.toContain('Copy Link');
    expect(container.textContent).not.toContain('Viral');
  });

  it('accepts no breakdown to fall back from', () => {
    // Type-level only: the pin is the compile error, not the render.
    function pin() {
      // @ts-expect-error the prop that carried the 83/17 default is gone
      return <SharesCard shares={1} breakdown={{ direct: 83, copyLink: 17 }} />;
    }

    expect(pin).toBeTypeOf('function');
  });
});

describe('RevenueCard', () => {
  it('draws one card per currency, each with its own recorded mix', () => {
    const { container } = render(
      <RevenueCard
        revenue={measured<ProjectRevenue[]>([
          {
            currency: 'USD',
            totalRevenueCents: 160_000,
            byType: { ads: 120_000, premium: 40_000 },
          },
          {
            currency: 'EUR',
            totalRevenueCents: 80_000,
            byType: { sponsorship: 60_000, product: 20_000 },
          },
        ])}
      />,
    );

    const cards = container.querySelectorAll('[data-test="overview-revenue"]');

    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Revenue · USD');
    expect(cards[0]!.textContent).toContain('$1,600');
    expect(cards[0]!.textContent).toContain('Ads$1,200 · 75%');
    expect(cards[0]!.textContent).toContain('Premium$400 · 25%');
    expect(cards[1]!.textContent).toContain('Revenue · EUR');
    expect(cards[1]!.textContent).toContain('€800');
    expect(cards[1]!.textContent).toContain('Sponsorship€600 · 75%');
    expect(cards[1]!.textContent).toContain('Product sales€200 · 25%');
    expect(container.textContent).not.toContain('Projection');
  });

  it('names no currency when there is only one', () => {
    const { container } = render(
      <RevenueCard
        revenue={measured<ProjectRevenue[]>([
          { currency: 'USD', totalRevenueCents: 500, byType: { other: 500 } },
        ])}
      />,
    );

    expect(container.textContent).toContain('Revenue');
    expect(container.textContent).not.toContain('USD');
    expect(container.textContent).toContain('$5');
    expect(container.textContent).toContain('Other$5 · 100%');
  });

  it('says nothing was recorded rather than showing $0 with a split', () => {
    const { container } = render(<RevenueCard revenue={measured([])} />);

    expect(
      container.querySelector('[data-test="overview-revenue-none"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain('No revenue recorded');
    expect(container.textContent).not.toContain('$0');
    expect(container.textContent).not.toContain('Ad Revenue');
    expect(container.textContent).not.toContain('Sponsorships');
  });

  it('says so when the revenue could not be read', () => {
    const { container } = render(<RevenueCard revenue={ABSENT} />);

    expect(
      container.querySelector('[data-test="overview-revenue-absent"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain('$');
  });

  it('cannot be handed a total to split by itself', () => {
    function pins() {
      return [
        // @ts-expect-error the old shape: a bare total the card split 70/30
        <RevenueCard key="a" revenueCents={100_000} />,
        // @ts-expect-error absent carries no value to fall back to
        <RevenueCard key="b" revenue={{ kind: 'absent', value: [] }} />,
        // @ts-expect-error a bare array is not declared measured
        <RevenueCard key="c" revenue={[]} />,
      ];
    }

    expect(pins).toBeTypeOf('function');
  });
});

describe('CommentsCard', () => {
  it('names the most discussed item only when given one', () => {
    const { container, rerender } = render(
      <CommentsCard comments={0} mostDiscussed={null} />,
    );

    expect(container.textContent).not.toContain('drew');
    expect(container.textContent).not.toContain('most discussion');

    rerender(
      <CommentsCard
        comments={12}
        mostDiscussed={{ title: 'Episode 3', comments: 9 }}
      />,
    );

    expect(container.textContent).toContain('“Episode 3” drew 9 of these.');
  });

  it('takes no bare title to print a sentence about', () => {
    function pin() {
      // @ts-expect-error a title alone is not evidence it was discussed most
      return <CommentsCard comments={0} topCommentedTitle="Episode 3" />;
    }

    expect(pin).toBeTypeOf('function');
  });
});

describe('PlatformSplitCard', () => {
  it('states the denominator in the footer', () => {
    const { container } = render(
      <PlatformSplitCard
        platforms={[
          { platform: 'youtube', views: 3000 },
          { platform: 'tiktok', views: 1000 },
        ]}
      />,
    );

    expect(container.textContent).toContain('Share of 4.0K views by platform.');
    expect(container.textContent).not.toContain('Dominant');
  });

  it('says when no views were recorded, with no footer', () => {
    const { container } = render(<PlatformSplitCard platforms={[]} />);

    expect(container.textContent).toContain(
      'No views recorded in this period.',
    );
    expect(container.textContent).not.toContain('Share of');
  });
});
