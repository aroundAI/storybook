/**
 * @vitest-environment happy-dom
 */
import { cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { AIInsightCard } from '../src/components/overview/ai-insight-card';
import { renderWithCoverage } from './helpers/coverage';

/**
 * The card rendered `summary` with `dangerouslySetInnerHTML`. Today its one
 * caller builds that string from two formatted numbers, so nothing tainted
 * reaches it — but the card is exported with `summary: string`, and the
 * first caller to hand it a model's reading would have run whatever markup
 * the model wrote. It renders text now.
 */
afterEach(cleanup);

const PAYLOAD =
  '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>Views held.';

it('renders a summary as text, never as markup', () => {
  const { container } = renderWithCoverage(<AIInsightCard summary={PAYLOAD} />);

  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
  expect(container.textContent).toContain('<img src=x onerror=');
});

/**
 * FILM-1707: the Overview builds its summary from this page's own figures
 * by a fixed rule. Its chip says that — not a platform's coverage, which
 * would read as a measurement, and not "Not measured", which is a model's.
 */
it('chips a page-built summary as a page summary, not a measurement', () => {
  const { container } = renderWithCoverage(
    <AIInsightCard summary="10 views." author="page" />,
  );

  expect(
    container.querySelector('[data-test="provenance-chip"]')?.textContent,
  ).toContain('Page summary');
  expect(
    container
      .querySelector('[data-test="overview-ai-insight"]')
      ?.getAttribute('data-metric-family'),
  ).toBe('summary');
});

it('chips a model-written summary as not measured', () => {
  const { container } = renderWithCoverage(
    <AIInsightCard summary="Views held." author="model" />,
  );

  expect(
    container.querySelector('[data-test="provenance-chip"]')?.textContent,
  ).toContain('Not measured');
});
