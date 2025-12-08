import { describe, expect, it } from 'vitest';

import {
  CONTRAST_REQUIREMENTS,
  FOCUSABLE_SELECTOR,
  calculateContrastRatio,
  createProgressLabel,
  formatTimeForScreenReader,
  generateAriaId,
  getRelativeLuminance,
  hexToRgb,
  isValidContrastRatio,
  rgbToHex,
  validateContrast,
} from '../src/lib/a11y-utils';

describe('a11y-utils', () => {
  describe('hexToRgb', () => {
    it('should convert 6-digit hex to RGB', () => {
      expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb('#0000FF')).toEqual({ r: 0, g: 0, b: 255 });
      expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('should handle hex without # prefix', () => {
      expect(hexToRgb('FF0000')).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should convert 3-digit shorthand hex to RGB', () => {
      expect(hexToRgb('#F00')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#0F0')).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb('#00F')).toEqual({ r: 0, g: 0, b: 255 });
      expect(hexToRgb('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#ABC')).toEqual({ r: 170, g: 187, b: 204 });
    });

    it('should handle lowercase hex', () => {
      expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    });

    it('should return null for invalid hex', () => {
      expect(hexToRgb('#GGGGGG')).toBeNull();
      expect(hexToRgb('#12345')).toBeNull();
      expect(hexToRgb('#1234567')).toBeNull();
      expect(hexToRgb('')).toBeNull();
      expect(hexToRgb('invalid')).toBeNull();
    });
  });

  describe('rgbToHex', () => {
    it('should convert RGB to hex', () => {
      expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe('#FF0000');
      expect(rgbToHex({ r: 0, g: 255, b: 0 })).toBe('#00FF00');
      expect(rgbToHex({ r: 0, g: 0, b: 255 })).toBe('#0000FF');
      expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#FFFFFF');
      expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    });

    it('should clamp values to 0-255 range', () => {
      expect(rgbToHex({ r: 300, g: -50, b: 128 })).toBe('#FF0080');
    });

    it('should round decimal values', () => {
      expect(rgbToHex({ r: 127.5, g: 64.4, b: 192.9 })).toBe('#8040C1');
    });
  });

  describe('getRelativeLuminance', () => {
    it('should calculate luminance for white', () => {
      const luminance = getRelativeLuminance({ r: 255, g: 255, b: 255 });
      expect(luminance).toBeCloseTo(1, 3);
    });

    it('should calculate luminance for black', () => {
      const luminance = getRelativeLuminance({ r: 0, g: 0, b: 0 });
      expect(luminance).toBeCloseTo(0, 3);
    });

    it('should calculate luminance for pure colors', () => {
      // Red has lower luminance than green due to ITU-R BT.709 coefficients
      const redLuminance = getRelativeLuminance({ r: 255, g: 0, b: 0 });
      const greenLuminance = getRelativeLuminance({ r: 0, g: 255, b: 0 });
      const blueLuminance = getRelativeLuminance({ r: 0, g: 0, b: 255 });

      expect(greenLuminance).toBeGreaterThan(redLuminance);
      expect(greenLuminance).toBeGreaterThan(blueLuminance);
    });

    it('should calculate luminance for gray', () => {
      const luminance = getRelativeLuminance({ r: 128, g: 128, b: 128 });
      expect(luminance).toBeGreaterThan(0);
      expect(luminance).toBeLessThan(1);
    });
  });

  describe('calculateContrastRatio', () => {
    it('should calculate 21:1 for black on white', () => {
      const ratio = calculateContrastRatio('#FFFFFF', '#000000');
      expect(ratio).toBeCloseTo(21, 0);
    });

    it('should calculate 1:1 for same colors', () => {
      const ratio = calculateContrastRatio('#FF0000', '#FF0000');
      expect(ratio).toBeCloseTo(1, 3);
    });

    it('should handle RGB input', () => {
      const ratio = calculateContrastRatio(
        { r: 255, g: 255, b: 255 },
        { r: 0, g: 0, b: 0 },
      );
      expect(ratio).toBeCloseTo(21, 0);
    });

    it('should handle mixed input types', () => {
      const ratio = calculateContrastRatio('#FFFFFF', { r: 0, g: 0, b: 0 });
      expect(ratio).toBeCloseTo(21, 0);
    });

    it('should return 0 for invalid colors', () => {
      expect(calculateContrastRatio('#INVALID', '#000000')).toBe(0);
      expect(calculateContrastRatio('#000000', '#INVALID')).toBe(0);
    });

    it('should be order-independent', () => {
      const ratio1 = calculateContrastRatio('#FFFFFF', '#333333');
      const ratio2 = calculateContrastRatio('#333333', '#FFFFFF');
      expect(ratio1).toBeCloseTo(ratio2, 3);
    });
  });

  describe('CONTRAST_REQUIREMENTS', () => {
    it('should define WCAG 2.1 AA requirements', () => {
      expect(CONTRAST_REQUIREMENTS.normalText).toBe(4.5);
      expect(CONTRAST_REQUIREMENTS.largeText).toBe(3.0);
      expect(CONTRAST_REQUIREMENTS.uiComponents).toBe(3.0);
      expect(CONTRAST_REQUIREMENTS.focusIndicator).toBe(3.0);
    });
  });

  describe('isValidContrastRatio', () => {
    it('should validate normal text contrast (4.5:1)', () => {
      expect(isValidContrastRatio(4.5, 'normalText')).toBe(true);
      expect(isValidContrastRatio(4.49, 'normalText')).toBe(false);
      expect(isValidContrastRatio(7, 'normalText')).toBe(true);
    });

    it('should validate large text contrast (3:1)', () => {
      expect(isValidContrastRatio(3, 'largeText')).toBe(true);
      expect(isValidContrastRatio(2.99, 'largeText')).toBe(false);
      expect(isValidContrastRatio(5, 'largeText')).toBe(true);
    });

    it('should validate UI component contrast (3:1)', () => {
      expect(isValidContrastRatio(3, 'uiComponents')).toBe(true);
      expect(isValidContrastRatio(2.5, 'uiComponents')).toBe(false);
    });

    it('should validate focus indicator contrast (3:1)', () => {
      expect(isValidContrastRatio(3, 'focusIndicator')).toBe(true);
      expect(isValidContrastRatio(2.9, 'focusIndicator')).toBe(false);
    });
  });

  describe('validateContrast', () => {
    it('should return detailed validation for high contrast (AAA)', () => {
      const result = validateContrast('#FFFFFF', '#000000');

      expect(result.ratio).toBeCloseTo(21, 0);
      expect(result.meetsNormalText).toBe(true);
      expect(result.meetsLargeText).toBe(true);
      expect(result.meetsUIComponents).toBe(true);
      expect(result.wcagLevel).toBe('AAA');
    });

    it('should return detailed validation for AA level', () => {
      // Gray on white with ~5:1 contrast
      const result = validateContrast('#757575', '#FFFFFF');

      expect(result.ratio).toBeGreaterThanOrEqual(4.5);
      expect(result.ratio).toBeLessThan(7);
      expect(result.meetsNormalText).toBe(true);
      expect(result.wcagLevel).toBe('AA');
    });

    it('should return fail level for low contrast', () => {
      // Light gray on white
      const result = validateContrast('#CCCCCC', '#FFFFFF');

      expect(result.ratio).toBeLessThan(4.5);
      expect(result.meetsNormalText).toBe(false);
      expect(result.meetsLargeText).toBe(result.ratio >= 3);
      expect(result.wcagLevel).toBe('fail');
    });
  });

  describe('FOCUSABLE_SELECTOR', () => {
    it('should include common focusable elements', () => {
      expect(FOCUSABLE_SELECTOR).toContain('button');
      expect(FOCUSABLE_SELECTOR).toContain('[href]');
      expect(FOCUSABLE_SELECTOR).toContain('input');
      expect(FOCUSABLE_SELECTOR).toContain('select');
      expect(FOCUSABLE_SELECTOR).toContain('textarea');
      expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
    });
  });

  describe('formatTimeForScreenReader', () => {
    it('should format seconds correctly', () => {
      expect(formatTimeForScreenReader(1)).toBe('1 second');
      expect(formatTimeForScreenReader(30)).toBe('30 seconds');
      expect(formatTimeForScreenReader(59)).toBe('59 seconds');
    });

    it('should format minutes correctly', () => {
      expect(formatTimeForScreenReader(60)).toBe('1 minute');
      expect(formatTimeForScreenReader(120)).toBe('2 minutes');
      expect(formatTimeForScreenReader(300)).toBe('5 minutes');
    });

    it('should format minutes and seconds correctly', () => {
      expect(formatTimeForScreenReader(61)).toBe('1 minute and 1 second');
      expect(formatTimeForScreenReader(90)).toBe('1 minute and 30 seconds');
      expect(formatTimeForScreenReader(125)).toBe('2 minutes and 5 seconds');
    });

    it('should round fractional seconds', () => {
      expect(formatTimeForScreenReader(30.7)).toBe('31 seconds');
      expect(formatTimeForScreenReader(90.4)).toBe('1 minute and 30 seconds');
    });

    it('should handle edge case when seconds round up to 60', () => {
      // 59.5 rounds to 60, should return "1 minute" not "60 seconds"
      expect(formatTimeForScreenReader(59.5)).toBe('1 minute');
      expect(formatTimeForScreenReader(59.6)).toBe('1 minute');
      // 119.5 rounds to 120, should return "2 minutes"
      expect(formatTimeForScreenReader(119.5)).toBe('2 minutes');
    });
  });

  describe('createProgressLabel', () => {
    it('should create basic progress label', () => {
      expect(createProgressLabel(0)).toBe('0% complete');
      expect(createProgressLabel(50)).toBe('50% complete');
      expect(createProgressLabel(100)).toBe('100% complete');
    });

    it('should include optional label prefix', () => {
      expect(createProgressLabel(75, 'Video generation')).toBe(
        'Video generation: 75% complete',
      );
    });

    it('should round decimal progress', () => {
      expect(createProgressLabel(33.7)).toBe('34% complete');
      expect(createProgressLabel(66.2)).toBe('66% complete');
    });
  });

  describe('generateAriaId', () => {
    it('should generate unique IDs with prefix', () => {
      const id1 = generateAriaId('dialog');
      const id2 = generateAriaId('dialog');

      expect(id1).toMatch(/^dialog-[a-z0-9]+$/);
      expect(id2).toMatch(/^dialog-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should use the provided prefix', () => {
      expect(generateAriaId('menu')).toMatch(/^menu-/);
      expect(generateAriaId('tooltip')).toMatch(/^tooltip-/);
    });
  });
});
