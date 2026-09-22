/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveConfidence } from '@kit/clickhouse';

import {
  LanguagePerformanceCard,
  PlatformLanguageMatrix,
} from '../src/components/language-analytics-cards';
import { TagMediansCard } from '../src/components/taxonomy/tag-medians-card';
import type { LanguagePerformance } from '../src/server/language-analytics';

// `@kit/ui` does not resolve its React runtime from this package's test
// environment; the other component tests stub it the same way.
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

/** This repo tags elements with `data-test`, not `data-testid`. */
function byTest(id: string, within: ParentNode = document): HTMLElement {
  const element = within.querySelector<HTMLElement>(`[data-test="${id}"]`);
  if (!element) throw new Error(`no [data-test="${id}"]`);
  return element;
}

function row(
  language: string | null,
  views: number,
  mature: number | null,
): LanguagePerformance {
  return {
    language,
    views,
    viewsChange: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    engagement: 0,
    revenueCents: 0,
    contentCount: 1,
    videoCount: mature ?? 2,
    checkpoint:
      mature === null
        ? null
        : {
            days: 30,
            medianViews: views,
            matureVideoCount: mature,
            confidence: resolveConfidence(mature),
          },
  };
}

// The unlabelled bucket has the most views, as it does on most projects.
const ROWS = [
  row(null, 5000, 40),
  row('en', 1000, 20),
  row('es', 700, 2),
  row('hi', 0, null),
];

describe('LanguagePerformanceCard (FILM-1702)', () => {
  it('names the unlabelled bucket, and not as a language', () => {
    render(<LanguagePerformanceCard data={ROWS} />);

    const notSet = byTest('language-row-__not_set__');

    expect(byTest('language-row-name', notSet).textContent).toBe(
      'Language not set',
    );
    expect(byTest('language-row-views', notSet).textContent).toBe('5.0K');
  });

  it('names the dimension it is grouped by', () => {
    const { rerender } = render(<LanguagePerformanceCard data={ROWS} />);

    expect(byTest('language-dimension-label-performance').textContent).toBe(
      'By content language',
    );

    rerender(<LanguagePerformanceCard data={ROWS} dimension="channel" />);

    expect(byTest('language-dimension-label-performance').textContent).toBe(
      'By channel target language',
    );
    expect(
      byTest('language-row-name', byTest('language-row-__not_set__'))
        .textContent,
    ).toBe('No channel target');
  });

  it('dims a thin language and shows its n, rather than hiding it', () => {
    render(<LanguagePerformanceCard data={ROWS} />);

    const spanish = byTest('language-row-es');

    expect(spanish.className).toContain('opacity-60');
    expect(byTest('language-row-checkpoint', spanish).textContent).toBe(
      '700 median at 30 days · 2 of 2 videos · too few to report',
    );
    expect(byTest('language-row-en').className).not.toContain('opacity-60');
  });

  it('says so when no video has reached the checkpoint, instead of a zero median', () => {
    render(<LanguagePerformanceCard data={ROWS} />);

    const hindi = byTest('language-row-hi');

    expect(hindi.className).toContain('opacity-60');
    expect(byTest('language-row-checkpoint', hindi).textContent).toBe(
      '2 videos, none 30 days old yet',
    );
  });

  it('never crowns the unlabelled bucket as the top language', () => {
    render(<LanguagePerformanceCard data={ROWS} />);

    expect(byTest('language-row-__not_set__').textContent).not.toContain('Top');
    expect(byTest('language-row-en').textContent).toContain('Top');
  });
});

describe('PlatformLanguageMatrix (FILM-1702)', () => {
  const entry = (language: string | null, engagementRate: number) => ({
    platform: 'youtube',
    language,
    views: 100,
    likes: 0,
    comments: 0,
    shares: 0,
    engagementRate,
    revenueCents: 0,
    contentCount: 1,
  });

  it('heads each column with the language name, not only a flag', () => {
    render(<PlatformLanguageMatrix data={[entry('es', 1), entry(null, 9)]} />);

    expect(byTest('matrix-language-es').textContent).toContain('Spanish');
    expect(byTest('matrix-language-__not_set__').textContent).toBe(
      'Language not set',
    );
  });

  it('does not name the unlabelled column as the best combination', () => {
    const { container } = render(
      <PlatformLanguageMatrix data={[entry('es', 1), entry(null, 9)]} />,
    );

    expect(container.textContent).toContain('Best: Spanish on YouTube');
    expect(container.textContent).not.toContain('Best: Language not set');
  });
});

describe('TagMediansCard, language rows (FILM-1702)', () => {
  it('names the not-set segment instead of rendering a row with no name', () => {
    render(
      <TagMediansCard
        segmentNoun="language"
        rows={[
          {
            segment: '',
            videoCount: 40,
            matureVideoCount: 40,
            medianViews: 900,
            meanViews: 900,
            spread: null,
            confidence: 'reportable',
          },
        ]}
      />,
    );

    expect(byTest('tag-medians-segment').textContent).toBe('Language not set');
  });
});
