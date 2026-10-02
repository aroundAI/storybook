/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AnalyticsTotals } from '../../types';
import {
  CompactMetric,
  MetricCardSkeleton,
  MetricCards,
} from '../metric-cards';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Clock: () => <span data-testid="icon-clock" />,
  DollarSign: () => <span data-testid="icon-dollar" />,
  Eye: () => <span data-testid="icon-eye" />,
  Heart: () => <span data-testid="icon-heart" />,
  Info: () => <span data-testid="icon-info" />,
  MessageCircle: () => <span data-testid="icon-message" />,
  Minus: () => <span data-testid="icon-minus" />,
  Share2: () => <span data-testid="icon-share" />,
  TrendingDown: () => <span data-testid="icon-trending-down" />,
  TrendingUp: () => <span data-testid="icon-trending-up" />,
  UserPlus: () => <span data-testid="icon-user-plus" />,
}));

// Mock the UI components
vi.mock('@kit/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card">{children}</div>
  ),
  CardContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="card-content" className={className}>
      {children}
    </div>
  ),
}));

vi.mock('@kit/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

vi.mock('@kit/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe('MetricCards', () => {
  const mockData: AnalyticsTotals = {
    views: 1500000,
    likes: 50000,
    comments: 2500,
    shares: 1200,
    watchTimeSeconds: 7200,
    subscribersGained: 500,
    revenueCents: 15000,
    contentCount: 10,
  };

  const mockPreviousData: AnalyticsTotals = {
    views: 1000000,
    likes: 40000,
    comments: 2000,
    shares: 1000,
    watchTimeSeconds: 6000,
    subscribersGained: 400,
    revenueCents: 12000,
    contentCount: 8,
  };

  it('should render 7 skeleton cards when loading', () => {
    render(<MetricCards data={null} previousData={null} isLoading={true} />);

    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThanOrEqual(7);
  });

  it('should render 7 metric cards when not loading', () => {
    render(
      <MetricCards
        data={mockData}
        previousData={mockPreviousData}
        isLoading={false}
      />,
    );

    const cards = screen.getAllByTestId('card');
    expect(cards).toHaveLength(7);
  });

  it('should display formatted values', () => {
    render(
      <MetricCards
        data={mockData}
        previousData={mockPreviousData}
        isLoading={false}
      />,
    );

    // Check for formatted view count (1.5M)
    expect(screen.getByText('1.5M')).toBeDefined();

    // Check for formatted likes (50.0K)
    expect(screen.getByText('50.0K')).toBeDefined();
  });

  it('should display metric labels', () => {
    render(
      <MetricCards
        data={mockData}
        previousData={mockPreviousData}
        isLoading={false}
      />,
    );

    expect(screen.getByText('Views')).toBeDefined();
    expect(screen.getByText('Likes')).toBeDefined();
    expect(screen.getByText('Comments')).toBeDefined();
    expect(screen.getByText('Shares')).toBeDefined();
    expect(screen.getByText('Watch Time')).toBeDefined();
    expect(screen.getByText('Subscribers')).toBeDefined();
    expect(screen.getByText('Revenue')).toBeDefined();
  });

  it('should handle null data gracefully', () => {
    render(<MetricCards data={null} previousData={null} isLoading={false} />);

    const cards = screen.getAllByTestId('card');
    expect(cards).toHaveLength(7);

    // Should display 0 for all metrics
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  describe('no previous period (KB-16)', () => {
    it('draws no change indicator when there is no previous period', () => {
      // `previousData={null}` was read as zero, and every non-zero metric
      // read "+100.0%" with a green arrow.
      const { container } = render(
        <MetricCards data={mockData} previousData={null} isLoading={false} />,
      );

      expect(container.querySelector('[data-test="metric-change"]')).toBeNull();
      expect(screen.queryByText('100.0%')).toBeNull();
      expect(screen.queryByTestId('icon-trending-up')).toBeNull();
      expect(screen.queryByLabelText(/Increased/)).toBeNull();
      expect(screen.getAllByText('No previous period to compare')).toHaveLength(
        7,
      );
    });

    it('draws no change for a metric whose previous period was zero', () => {
      const { container } = render(
        <MetricCards
          data={mockData}
          previousData={{ ...mockPreviousData, views: 0 }}
          isLoading={false}
        />,
      );

      // Five metrics have a baseline; views does not, and revenue draws no
      // figure at all — the matrix has no platform supplying it (FILM-1705).
      expect(
        container.querySelectorAll('[data-test="metric-change"]'),
      ).toHaveLength(5);
      expect(
        container.querySelector(
          '[data-test="metric-card-views"] [data-test="metric-change"]',
        ),
      ).toBeNull();
    });

    it('still reports a measured change', () => {
      render(
        <MetricCards
          data={mockData}
          previousData={mockPreviousData}
          isLoading={false}
        />,
      );

      // 1,000,000 → 1,500,000 views.
      expect(screen.getByLabelText('Increased by 50.0%')).toBeDefined();
    });
  });
});

describe('MetricCardSkeleton', () => {
  it('should render skeleton elements', () => {
    render(<MetricCardSkeleton />);

    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons).toHaveLength(2);
  });

  it('should be wrapped in a card', () => {
    render(<MetricCardSkeleton />);

    expect(screen.getByTestId('card')).toBeDefined();
  });
});

describe('CompactMetric', () => {
  it('should display label and value', () => {
    render(<CompactMetric label="Views" value="1.5M" />);

    expect(screen.getByText('Views')).toBeDefined();
    expect(screen.getByText('1.5M')).toBeDefined();
  });

  it('should display positive change with + prefix', () => {
    render(<CompactMetric label="Views" value="1.5M" change={5.2} />);

    expect(screen.getByText('+5.2%')).toBeDefined();
  });

  it('should display negative change without + prefix', () => {
    render(<CompactMetric label="Views" value="1.5M" change={-3.5} />);

    expect(screen.getByText('-3.5%')).toBeDefined();
  });

  it('should not display change when undefined', () => {
    render(<CompactMetric label="Views" value="1.5M" />);

    expect(screen.queryByText('%')).toBeNull();
  });

  it('should apply green color for positive change', () => {
    const { container } = render(
      <CompactMetric label="Views" value="1.5M" change={5.2} />,
    );

    const changeElement = container.querySelector('.text-green-600');
    expect(changeElement).not.toBeNull();
  });

  it('should apply red color for negative change', () => {
    const { container } = render(
      <CompactMetric label="Views" value="1.5M" change={-3.5} />,
    );

    const changeElement = container.querySelector('.text-red-600');
    expect(changeElement).not.toBeNull();
  });
});
