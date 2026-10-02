/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from 'react';

import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContentTypeCard } from '../src/components/language-analytics-cards';
import type { FormatFamilyTotals } from '../src/server/language-analytics';
import { renderWithCoverage } from './helpers/coverage';

vi.mock('@kit/ui/card', () => {
  const passthrough = ({ children, ...props }: { children?: ReactNode }) => (
    <div {...props}>{children}</div>
  );

  return {
    Card: passthrough,
    CardContent: passthrough,
    CardHeader: passthrough,
    CardTitle: passthrough,
  };
});
vi.mock('@kit/ui/progress', () => ({ Progress: () => <div /> }));
vi.mock('@kit/ui/skeleton', () => ({ Skeleton: () => <div /> }));
vi.mock('@kit/ui/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

afterEach(cleanup);

/**
 * KB-162: a family of TikTok shorts has no follower gain. Its row says so
 * rather than "0".
 */
const family = (subscribersGained: number | null): FormatFamilyTotals => ({
  family: 'short_vertical',
  views: 1200,
  likes: 40,
  comments: 3,
  shares: 2,
  engagement: 3.75,
  revenueCents: 0,
  subscribersGained,
  contentCount: 2,
});

function row(container: HTMLElement) {
  return container.querySelector<HTMLElement>(
    '[data-test="format-family-row-short_vertical"]',
  )!;
}

describe('the format-family card, for a follower gain no video measured (KB-162)', () => {
  it('says the follower gain was not measured, never 0', () => {
    const { container } = renderWithCoverage(
      <ContentTypeCard
        data={{
          families: [family(null)],
          unclassified: 0,
          durationUnknown: 0,
        }}
      />,
    );

    const cells = [...row(container).querySelectorAll('td')].map(
      (cell) => cell.textContent,
    );
    expect(cells.at(-1)).toBe('Not measured');
  });

  it('still shows a measured follower gain', () => {
    const { container } = renderWithCoverage(
      <ContentTypeCard
        data={{ families: [family(4)], unclassified: 0, durationUnknown: 0 }}
      />,
    );

    const cells = [...row(container).querySelectorAll('td')].map(
      (cell) => cell.textContent,
    );
    expect(cells.at(-1)).toBe('4');
  });
});
