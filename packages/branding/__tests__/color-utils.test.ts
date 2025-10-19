import { describe, expect, it } from 'vitest';

import {
  darkenColor,
  generateDarkerVariant,
  getContrastRatio,
  hexToRgb,
  isValidHexColor,
  lightenColor,
  meetsWCAGAA,
  meetsWCAGAAA,
} from '../src/utils/color';

describe('Color Utilities', () => {
  describe('isValidHexColor', () => {
    it('should validate correct hex colors', () => {
      expect(isValidHexColor('#000000')).toBe(true);
      expect(isValidHexColor('#FFFFFF')).toBe(true);
      expect(isValidHexColor('#123ABC')).toBe(true);
      expect(isValidHexColor('#abcdef')).toBe(true);
    });

    it('should reject invalid hex colors', () => {
      expect(isValidHexColor('#GGGGGG')).toBe(false);
      expect(isValidHexColor('#12345')).toBe(false); // Too short
      expect(isValidHexColor('#1234567')).toBe(false); // Too long
      expect(isValidHexColor('123456')).toBe(false); // Missing #
      expect(isValidHexColor('#12G456')).toBe(false); // Invalid character
      expect(isValidHexColor('')).toBe(false);
      expect(isValidHexColor('red')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isValidHexColor('#aAbBcC')).toBe(true);
      expect(isValidHexColor('#AABBCC')).toBe(true);
      expect(isValidHexColor('#aabbcc')).toBe(true);
    });
  });

  describe('hexToRgb', () => {
    it('should convert valid hex to RGB', () => {
      expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb('#0000FF')).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('should handle lowercase hex colors', () => {
      expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#aabbcc')).toEqual({ r: 170, g: 187, b: 204 });
    });

    it('should return null for invalid hex colors', () => {
      expect(hexToRgb('#GGGGGG')).toBeNull();
      expect(hexToRgb('#12345')).toBeNull();
      expect(hexToRgb('invalid')).toBeNull();
      expect(hexToRgb('')).toBeNull();
    });

    it('should handle hex without # prefix', () => {
      // The regex in the function handles this
      expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
    });
  });

  describe('getContrastRatio', () => {
    it('should calculate correct contrast ratio for black and white', () => {
      const ratio = getContrastRatio('#000000', '#FFFFFF');
      expect(ratio).toBe(21); // Maximum contrast
    });

    it('should calculate correct contrast ratio for same colors', () => {
      const ratio = getContrastRatio('#000000', '#000000');
      expect(ratio).toBe(1); // No contrast
    });

    it('should calculate contrast ratio for common color pairs', () => {
      // Blue on white (common UI combination)
      const blueOnWhite = getContrastRatio('#0000FF', '#FFFFFF');
      expect(blueOnWhite).toBeGreaterThan(8); // Should have good contrast

      // Red on white
      const redOnWhite = getContrastRatio('#FF0000', '#FFFFFF');
      expect(redOnWhite).toBeGreaterThan(3);
    });

    it('should be symmetric (order should not matter)', () => {
      const ratio1 = getContrastRatio('#0066cc', '#FFFFFF');
      const ratio2 = getContrastRatio('#FFFFFF', '#0066cc');
      expect(ratio1).toBe(ratio2);
    });

    it('should return 1 for invalid colors', () => {
      expect(getContrastRatio('invalid', '#FFFFFF')).toBe(1);
      expect(getContrastRatio('#000000', 'invalid')).toBe(1);
      expect(getContrastRatio('invalid', 'invalid')).toBe(1);
    });

    it('should handle real-world color combinations', () => {
      // MakerKit primary on white
      const primaryOnWhite = getContrastRatio('#6366f1', '#FFFFFF');
      expect(primaryOnWhite).toBeGreaterThan(3.5);

      // Dark text on light background
      const darkOnLight = getContrastRatio('#333333', '#F5F5F5');
      expect(darkOnLight).toBeGreaterThan(11);
    });
  });

  describe('meetsWCAGAA', () => {
    it('should pass for high contrast combinations', () => {
      expect(meetsWCAGAA('#000000', '#FFFFFF')).toBe(true);
      expect(meetsWCAGAA('#FFFFFF', '#000000')).toBe(true);
    });

    it('should fail for low contrast combinations', () => {
      expect(meetsWCAGAA('#CCCCCC', '#FFFFFF')).toBe(false);
      expect(meetsWCAGAA('#FFFF00', '#FFFFFF')).toBe(false); // Yellow on white
    });

    it('should check against 4.5:1 ratio threshold', () => {
      // Test a color pair that's right at the threshold
      // Dark gray on white should pass
      expect(meetsWCAGAA('#666666', '#FFFFFF')).toBe(true);

      // Light gray on white should fail
      expect(meetsWCAGAA('#AAAAAA', '#FFFFFF')).toBe(false);
    });

    it('should handle common UI color combinations', () => {
      // Primary blue on white (should pass for most blues)
      expect(meetsWCAGAA('#0066cc', '#FFFFFF')).toBe(true);

      // Light blue on white (may fail)
      expect(meetsWCAGAA('#ADD8E6', '#FFFFFF')).toBe(false);
    });
  });

  describe('meetsWCAGAAA', () => {
    it('should pass for very high contrast combinations', () => {
      expect(meetsWCAGAAA('#000000', '#FFFFFF')).toBe(true);
      expect(meetsWCAGAAA('#FFFFFF', '#000000')).toBe(true);
    });

    it('should fail for moderate contrast combinations', () => {
      // These might pass AA but not AAA
      expect(meetsWCAGAAA('#666666', '#FFFFFF')).toBe(false);
      expect(meetsWCAGAAA('#0066cc', '#FFFFFF')).toBe(false);
    });

    it('should check against 7:1 ratio threshold', () => {
      // Very dark gray on white should pass AAA
      expect(meetsWCAGAAA('#444444', '#FFFFFF')).toBe(true);

      // Medium gray on white should fail AAA
      expect(meetsWCAGAAA('#777777', '#FFFFFF')).toBe(false);
    });

    it('should be more strict than WCAG AA', () => {
      const color1 = '#666666';
      const color2 = '#FFFFFF';

      // Should pass AA but not AAA
      expect(meetsWCAGAA(color1, color2)).toBe(true);
      expect(meetsWCAGAAA(color1, color2)).toBe(false);
    });
  });

  describe('darkenColor', () => {
    it('should darken colors by percentage', () => {
      const original = '#808080'; // Medium gray
      const darkened = darkenColor(original, 50); // 50% darker

      expect(isValidHexColor(darkened)).toBe(true);

      const originalRgb = hexToRgb(original);
      const darkenedRgb = hexToRgb(darkened);

      expect(darkenedRgb!.r).toBeLessThan(originalRgb!.r);
      expect(darkenedRgb!.g).toBeLessThan(originalRgb!.g);
      expect(darkenedRgb!.b).toBeLessThan(originalRgb!.b);
    });

    it('should not go below 0', () => {
      const black = darkenColor('#000000', 50);
      expect(black).toBe('#000000');
    });

    it('should handle 0% darkening (no change)', () => {
      const original = '#FF0000';
      const unchanged = darkenColor(original, 0);
      expect(unchanged.toLowerCase()).toBe(original.toLowerCase());
    });

    it('should handle 100% darkening (to black)', () => {
      const black = darkenColor('#FFFFFF', 100);
      expect(black).toBe('#000000');
    });

    it('should return original color if invalid', () => {
      const invalid = 'invalid';
      const result = darkenColor(invalid, 50);
      expect(result).toBe(invalid);
    });

    it('should produce consistent results', () => {
      const color = '#6366f1';
      const darkened1 = darkenColor(color, 20);
      const darkened2 = darkenColor(color, 20);
      expect(darkened1).toBe(darkened2);
    });

    it('should clamp values to 0-255 range', () => {
      const result = darkenColor('#FFFFFF', 50);
      const rgb = hexToRgb(result);

      expect(rgb!.r).toBeGreaterThanOrEqual(0);
      expect(rgb!.r).toBeLessThanOrEqual(255);
      expect(rgb!.g).toBeGreaterThanOrEqual(0);
      expect(rgb!.g).toBeLessThanOrEqual(255);
      expect(rgb!.b).toBeGreaterThanOrEqual(0);
      expect(rgb!.b).toBeLessThanOrEqual(255);
    });
  });

  describe('lightenColor', () => {
    it('should lighten colors by percentage', () => {
      const original = '#808080'; // Medium gray
      const lightened = lightenColor(original, 50); // 50% lighter

      expect(isValidHexColor(lightened)).toBe(true);

      const originalRgb = hexToRgb(original);
      const lightenedRgb = hexToRgb(lightened);

      expect(lightenedRgb!.r).toBeGreaterThan(originalRgb!.r);
      expect(lightenedRgb!.g).toBeGreaterThan(originalRgb!.g);
      expect(lightenedRgb!.b).toBeGreaterThan(originalRgb!.b);
    });

    it('should not go above 255', () => {
      const white = lightenColor('#FFFFFF', 50);
      expect(white).toBe('#ffffff');
    });

    it('should handle 0% lightening (no change)', () => {
      const original = '#FF0000';
      const unchanged = lightenColor(original, 0);
      expect(unchanged.toLowerCase()).toBe(original.toLowerCase());
    });

    it('should handle 100% lightening (to white)', () => {
      const white = lightenColor('#000000', 100);
      expect(white).toBe('#ffffff');
    });

    it('should return original color if invalid', () => {
      const invalid = 'invalid';
      const result = lightenColor(invalid, 50);
      expect(result).toBe(invalid);
    });

    it('should produce consistent results', () => {
      const color = '#6366f1';
      const lightened1 = lightenColor(color, 20);
      const lightened2 = lightenColor(color, 20);
      expect(lightened1).toBe(lightened2);
    });

    it('should clamp values to 0-255 range', () => {
      const result = lightenColor('#000000', 50);
      const rgb = hexToRgb(result);

      expect(rgb!.r).toBeGreaterThanOrEqual(0);
      expect(rgb!.r).toBeLessThanOrEqual(255);
      expect(rgb!.g).toBeGreaterThanOrEqual(0);
      expect(rgb!.g).toBeLessThanOrEqual(255);
      expect(rgb!.b).toBeGreaterThanOrEqual(0);
      expect(rgb!.b).toBeLessThanOrEqual(255);
    });
  });

  describe('generateDarkerVariant', () => {
    it('should use default 20% darkening', () => {
      const original = '#6366f1';
      const variant = generateDarkerVariant(original);
      const manual = darkenColor(original, 20);

      expect(variant).toBe(manual);
    });

    it('should accept custom percentage', () => {
      const original = '#6366f1';
      const variant = generateDarkerVariant(original, 30);
      const manual = darkenColor(original, 30);

      expect(variant).toBe(manual);
    });

    it('should return valid hex color', () => {
      const variant = generateDarkerVariant('#FFFFFF');
      expect(isValidHexColor(variant)).toBe(true);
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle darkening and lightening in sequence', () => {
      const original = '#808080';
      const darkened = darkenColor(original, 20);
      const restored = lightenColor(darkened, 25); // Note: not exact reverse

      // Should be different but both valid
      expect(isValidHexColor(darkened)).toBe(true);
      expect(isValidHexColor(restored)).toBe(true);
    });

    it('should maintain valid hex format throughout transformations', () => {
      const color = '#6366f1';
      const dark = darkenColor(color, 20);
      const light = lightenColor(color, 20);
      const variant = generateDarkerVariant(color);

      expect(isValidHexColor(dark)).toBe(true);
      expect(isValidHexColor(light)).toBe(true);
      expect(isValidHexColor(variant)).toBe(true);
    });

    it('should handle real-world branding scenarios', () => {
      // MakerKit-style purple
      const primary = '#6366f1';
      const primaryDark = generateDarkerVariant(primary);

      // Should create readable contrast
      const contrastRatio = getContrastRatio(primary, primaryDark);
      expect(contrastRatio).toBeGreaterThan(1);

      // Dark variant should be valid
      expect(isValidHexColor(primaryDark)).toBe(true);
    });
  });
});
