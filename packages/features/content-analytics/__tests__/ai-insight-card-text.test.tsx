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
