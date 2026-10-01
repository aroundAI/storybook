import { describe, expect, it } from 'vitest';

import { formatNumber } from '../format';
import { formatLanguageComparisonTooltip } from '../language-comparison-tooltip';

/**
 * KB-158. Recharts calls a tooltip formatter with the series' display name
 * ("Views"), not its data key ("views"); keyed on the name, every value fell
 * through to dollars and 1,080 views read "$1080.00".
 */
describe('formatLanguageComparisonTooltip', () => {
  // The arguments Recharts passes for the chart's one <Bar>.
  const views = (value: number) =>
    formatLanguageComparisonTooltip(value, 'Views', { dataKey: 'views' });

  it('reads a language views as a count, formatted as the axis is, with no currency', () => {
    const [value, label] = views(1080);

    expect(value).not.toContain('$');
    expect(value).toBe(formatNumber(1080));
    expect(label).toBe('Views');
  });

  it('reads a small count in full', () => {
    expect(views(720)).toEqual(['720', 'Views']);
  });

  it('never states a currency for a series it does not know', () => {
    const [value] = formatLanguageComparisonTooltip(42, 'Other', {
      dataKey: 'other',
    });

    expect(value).not.toContain('$');
  });
});
