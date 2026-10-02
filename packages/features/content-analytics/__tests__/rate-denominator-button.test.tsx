/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { RateDenominator } from '../src/components/rate-denominator';
import { recorded } from './helpers/recorded-rate';

/**
 * FILM-1732 review: the button beside a rate is a 24px target (WCAG 2.5.8),
 * and where a card repeats it per row, each row's button names its row.
 */
afterEach(cleanup);

const { denominator } = recorded(10);

it('names the row it belongs to', () => {
  const { container } = render(
    <RateDenominator
      denominator={denominator}
      figure="engagement rate"
      subject="Across the change"
    />,
  );

  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
    'What the engagement rate of Across the change was divided by',
  );
});

it('is a 24px target', () => {
  const { container } = render(
    <RateDenominator denominator={denominator} figure="engagement rate" />,
  );

  expect(container.querySelector('button')?.className).toMatch(/\bsize-6\b/);
});
