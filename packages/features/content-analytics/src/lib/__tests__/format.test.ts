import { describe, expect, it } from 'vitest';

import {
  calculateChange,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
} from '../format';

describe('formatNumber', () => {
  it('should format billions with B suffix', () => {
    expect(formatNumber(1_000_000_000)).toBe('1.0B');
    expect(formatNumber(2_500_000_000)).toBe('2.5B');
    expect(formatNumber(12_345_678_901)).toBe('12.3B');
  });

  it('should format millions with M suffix', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M');
    expect(formatNumber(3_400_000)).toBe('3.4M');
    expect(formatNumber(999_999_999)).toBe('1000.0M');
  });

  it('should format thousands with K suffix', () => {
    expect(formatNumber(1_000)).toBe('1.0K');
    expect(formatNumber(1_200)).toBe('1.2K');
    expect(formatNumber(999_999)).toBe('1000.0K');
  });

  it('should format small numbers without suffix', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(100)).toBe('100');
    expect(formatNumber(999)).toBe('999');
  });

  it('should handle negative numbers', () => {
    expect(formatNumber(-1_500)).toBe('-1.5K');
    expect(formatNumber(-1_000_000)).toBe('-1.0M');
    expect(formatNumber(-2_500_000_000)).toBe('-2.5B');
    expect(formatNumber(-500)).toBe('-500');
  });
});

describe('formatDuration', () => {
  it('should format hours and minutes', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatDuration(7200)).toBe('2h 0m');
    expect(formatDuration(5400)).toBe('1h 30m');
  });

  it('should format minutes only when less than 1 hour', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(300)).toBe('5m');
    expect(formatDuration(3599)).toBe('59m');
  });

  it('should use K suffix for very large durations', () => {
    expect(formatDuration(3_600_000)).toBe('1.0Kh');
    expect(formatDuration(3_600_000 * 2.5)).toBe('2.5Kh');
  });

  it('should return 0m for negative or zero values', () => {
    expect(formatDuration(-100)).toBe('0m');
    expect(formatDuration(-3600)).toBe('0m');
  });
});

describe('formatCurrency', () => {
  it('should format dollars with USD currency symbol', () => {
    expect(formatCurrency(0)).toBe('$0');
    expect(formatCurrency(100)).toBe('$100');
    expect(formatCurrency(1000)).toBe('$1,000');
    expect(formatCurrency(1234567)).toBe('$1,234,567');
  });

  it('should round to whole dollars', () => {
    expect(formatCurrency(99.99)).toBe('$100');
    expect(formatCurrency(99.49)).toBe('$99');
  });
});

describe('formatPercent', () => {
  it('should format positive percentages', () => {
    expect(formatPercent(5.2)).toBe('5.2%');
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('should format negative percentages as absolute values', () => {
    expect(formatPercent(-5.2)).toBe('5.2%');
    expect(formatPercent(-100)).toBe('100.0%');
  });

  it('should handle zero', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('should round to 1 decimal place', () => {
    expect(formatPercent(5.249)).toBe('5.2%');
    expect(formatPercent(5.251)).toBe('5.3%');
  });
});

describe('calculateChange', () => {
  it('should return up direction for increases > 1%', () => {
    const result = calculateChange(102, 100);
    expect(result.direction).toBe('up');
    expect(result.percentage).toBe(2);
  });

  it('should return down direction for decreases < -1%', () => {
    const result = calculateChange(98, 100);
    expect(result.direction).toBe('down');
    expect(result.percentage).toBe(-2);
  });

  it('should return neutral for changes within -1% to 1%', () => {
    expect(calculateChange(100.5, 100).direction).toBe('neutral');
    expect(calculateChange(99.5, 100).direction).toBe('neutral');
    expect(calculateChange(101, 100).direction).toBe('neutral');
    expect(calculateChange(99, 100).direction).toBe('neutral');
  });

  it('should handle zero previous value', () => {
    const resultPositive = calculateChange(100, 0);
    expect(resultPositive.direction).toBe('up');
    expect(resultPositive.percentage).toBe(100);

    const resultZero = calculateChange(0, 0);
    expect(resultZero.direction).toBe('neutral');
    expect(resultZero.percentage).toBe(0);
  });

  it('should calculate correct percentage', () => {
    expect(calculateChange(150, 100).percentage).toBe(50);
    expect(calculateChange(50, 100).percentage).toBe(-50);
    expect(calculateChange(200, 100).percentage).toBe(100);
  });

  it('should handle going from value to zero (-100% decrease)', () => {
    const result = calculateChange(0, 100);
    expect(result.direction).toBe('down');
    expect(result.percentage).toBe(-100);
  });
});
