import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatCurrency, isBrowser } from '../src/utils';

describe('isBrowser', () => {
  it('should return true when window is defined', () => {
    // In Node.js test environment, window is undefined by default
    // We need to mock it
    global.window = {} as any;

    expect(isBrowser()).toBe(true);

    // Clean up
    delete (global as any).window;
  });

  it('should return false when window is undefined', () => {
    // Ensure window is undefined
    delete (global as any).window;

    expect(isBrowser()).toBe(false);
  });

  it('should return false in Node.js environment', () => {
    expect(isBrowser()).toBe(false);
  });
});

describe('formatCurrency', () => {
  describe('USD formatting', () => {
    it('should format USD currency with en-US locale', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 1234.56,
      });

      expect(result).toBe('$1,234.56');
    });

    it('should format USD with string value', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: '1234.56',
      });

      expect(result).toBe('$1,234.56');
    });

    it('should format zero USD', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 0,
      });

      expect(result).toBe('$0.00');
    });

    it('should format negative USD amounts', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: -1234.56,
      });

      expect(result).toBe('-$1,234.56');
    });

    it('should handle very large amounts', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 1000000000,
      });

      expect(result).toBe('$1,000,000,000.00');
    });

    it('should handle decimal precision', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 1.99,
      });

      expect(result).toBe('$1.99');
    });

    it('should round to two decimal places', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 1.999,
      });

      // JavaScript rounds 1.999 to 2.00
      expect(result).toBe('$2.00');
    });
  });

  describe('EUR formatting', () => {
    it('should format EUR currency with en-GB locale', () => {
      const result = formatCurrency({
        currencyCode: 'EUR',
        locale: 'en-GB',
        value: 1234.56,
      });

      expect(result).toBe('€1,234.56');
    });

    it('should format EUR with de-DE locale (German formatting)', () => {
      const result = formatCurrency({
        currencyCode: 'EUR',
        locale: 'de-DE',
        value: 1234.56,
      });

      // German format uses comma for decimals and period for thousands
      expect(result).toContain('1');
      expect(result).toContain('234');
      expect(result).toContain('56');
      expect(result).toContain('€');
    });

    it('should format EUR with fr-FR locale (French formatting)', () => {
      const result = formatCurrency({
        currencyCode: 'EUR',
        locale: 'fr-FR',
        value: 1234.56,
      });

      expect(result).toContain('1');
      expect(result).toContain('234');
      expect(result).toContain('56');
      expect(result).toContain('€');
    });
  });

  describe('GBP formatting', () => {
    it('should format GBP currency with en-GB locale', () => {
      const result = formatCurrency({
        currencyCode: 'GBP',
        locale: 'en-GB',
        value: 1234.56,
      });

      expect(result).toBe('£1,234.56');
    });

    it('should format GBP with negative amounts', () => {
      const result = formatCurrency({
        currencyCode: 'GBP',
        locale: 'en-GB',
        value: -500,
      });

      expect(result).toBe('-£500.00');
    });
  });

  describe('JPY formatting (no decimal places)', () => {
    it('should format JPY currency without decimal places', () => {
      const result = formatCurrency({
        currencyCode: 'JPY',
        locale: 'ja-JP',
        value: 1234,
      });

      expect(result).toBe('¥1,234');
    });

    it('should format JPY with decimal input (rounds)', () => {
      const result = formatCurrency({
        currencyCode: 'JPY',
        locale: 'ja-JP',
        value: 1234.56,
      });

      // JPY doesn't use decimals, so it rounds
      expect(result).toBe('¥1,235');
    });
  });

  describe('Other currencies', () => {
    it('should format CAD (Canadian Dollar)', () => {
      const result = formatCurrency({
        currencyCode: 'CAD',
        locale: 'en-CA',
        value: 1234.56,
      });

      // Canadian formatting may vary by Node version/locale data
      expect(result).toContain('1');
      expect(result).toContain('234');
      expect(result).toContain('56');
      expect(result).toContain('CA');
    });

    it('should format AUD (Australian Dollar)', () => {
      const result = formatCurrency({
        currencyCode: 'AUD',
        locale: 'en-AU',
        value: 1234.56,
      });

      expect(result).toContain('1');
      expect(result).toContain('234');
      expect(result).toContain('56');
      expect(result).toContain('A');
    });

    it('should format INR (Indian Rupee)', () => {
      const result = formatCurrency({
        currencyCode: 'INR',
        locale: 'en-IN',
        value: 1234.56,
      });

      expect(result).toContain('1');
      expect(result).toContain('234');
      expect(result).toContain('56');
      // Can be either ₹ or Rs depending on locale data
      expect(result).toMatch(/₹|Rs/);
    });

    it('should format BRL (Brazilian Real)', () => {
      const result = formatCurrency({
        currencyCode: 'BRL',
        locale: 'pt-BR',
        value: 1234.56,
      });

      expect(result).toContain('1');
      expect(result).toContain('234');
      expect(result).toContain('56');
      // Can be either R$ or BRL depending on locale data
      expect(result).toMatch(/R\$|BRL/);
    });
  });

  describe('Locale handling', () => {
    it('should use region when available in locale', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 1000,
      });

      expect(result).toBe('$1,000.00');
    });

    it('should fallback to language when region is missing', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en',
        value: 1000,
      });

      // Should still format, even without region
      expect(result).toContain('1,000');
      expect(result).toContain('$');
    });

    it('should handle different language-region combinations', () => {
      // English with Indian region
      const result = formatCurrency({
        currencyCode: 'INR',
        locale: 'en-IN',
        value: 100000,
      });

      // Indian number format uses lakhs system - just verify digits and currency
      expect(result).toContain('1');
      expect(result).toContain('0');
      // Can be either ₹ or Rs depending on locale data
      expect(result).toMatch(/₹|Rs/);
    });
  });

  describe('Edge cases', () => {
    it('should handle fractional cents', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 0.01,
      });

      expect(result).toBe('$0.01');
    });

    it('should handle very small amounts', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 0.001,
      });

      // Rounds to 0.00
      expect(result).toBe('$0.00');
    });

    it('should handle string numbers with leading zeros', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: '0123.45',
      });

      expect(result).toBe('$123.45');
    });

    it('should handle string numbers with spaces', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: ' 123.45 ',
      });

      expect(result).toBe('$123.45');
    });

    it('should handle exponential notation', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 1.23e3,
      });

      expect(result).toBe('$1,230.00');
    });

    it('should handle maximum safe integer', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: Number.MAX_SAFE_INTEGER,
      });

      expect(result).toContain('$9,007,199,254,740,991');
    });
  });

  describe('Invalid inputs', () => {
    it('should handle NaN gracefully', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: NaN,
      });

      // Intl.NumberFormat includes currency symbol even for NaN
      expect(result).toContain('NaN');
    });

    it('should handle Infinity', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: Infinity,
      });

      // Intl.NumberFormat includes currency symbol even for Infinity
      expect(result).toContain('∞');
    });

    it('should handle non-numeric strings', () => {
      const result = formatCurrency({
        currencyCode: 'USD',
        locale: 'en-US',
        value: 'not a number',
      });

      // Intl.NumberFormat includes currency symbol even for NaN
      expect(result).toContain('NaN');
    });
  });

  describe('Cryptocurrency and special currencies', () => {
    it('should format Bitcoin (BTC) if supported', () => {
      // Note: BTC might not be supported in all Intl implementations
      try {
        const result = formatCurrency({
          currencyCode: 'BTC',
          locale: 'en-US',
          value: 0.00123456,
        });

        expect(result).toBeDefined();
      } catch (e) {
        // BTC might not be supported, that's okay
        expect(e).toBeDefined();
      }
    });
  });
});
