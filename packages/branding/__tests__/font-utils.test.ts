import { describe, expect, it } from 'vitest';

import {
  fontToCssVariable,
  generateFontFamily,
  getFallbackFonts,
  isSupportedFont,
  isValidWeight,
  parseSubsets,
  parseWeights,
} from '../src/utils/font';

describe('Font Utilities', () => {
  describe('isSupportedFont', () => {
    it('should return true for supported fonts', () => {
      expect(isSupportedFont('Inter')).toBe(true);
      expect(isSupportedFont('Poppins')).toBe(true);
      expect(isSupportedFont('Roboto')).toBe(true);
    });

    it('should return false for unsupported fonts', () => {
      expect(isSupportedFont('Unknown Font')).toBe(false);
      expect(isSupportedFont('Comic Sans')).toBe(false);
      expect(isSupportedFont('')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isSupportedFont('Inter')).toBe(true);
      expect(isSupportedFont('inter')).toBe(false);
      expect(isSupportedFont('INTER')).toBe(false);
    });
  });

  describe('fontToCssVariable', () => {
    it('should convert font name to CSS variable format', () => {
      expect(fontToCssVariable('Inter')).toBe('inter');
      expect(fontToCssVariable('Playfair Display')).toBe('playfair-display');
      expect(fontToCssVariable('JetBrains Mono')).toBe('jetbrains-mono');
    });

    it('should handle single word fonts', () => {
      expect(fontToCssVariable('Roboto')).toBe('roboto');
      expect(fontToCssVariable('Poppins')).toBe('poppins');
    });

    it('should handle multiple spaces', () => {
      expect(fontToCssVariable('Font  With   Spaces')).toBe('font-with-spaces');
    });

    it('should handle empty string', () => {
      expect(fontToCssVariable('')).toBe('');
    });

    it('should convert to lowercase', () => {
      expect(fontToCssVariable('UPPERCASE')).toBe('uppercase');
      expect(fontToCssVariable('MixedCase Font')).toBe('mixedcase-font');
    });
  });

  describe('parseWeights', () => {
    it('should parse comma-separated weights', () => {
      expect(parseWeights('400,500,700')).toEqual([400, 500, 700]);
    });

    it('should handle spaces around weights', () => {
      expect(parseWeights('400, 500, 700')).toEqual([400, 500, 700]);
      expect(parseWeights('400 , 500 , 700')).toEqual([400, 500, 700]);
    });

    it('should filter out invalid weights below 100', () => {
      expect(parseWeights('50,400,700')).toEqual([400, 700]);
    });

    it('should filter out invalid weights above 900', () => {
      expect(parseWeights('400,700,1000')).toEqual([400, 700]);
    });

    it('should filter out non-numeric values', () => {
      expect(parseWeights('400,invalid,700')).toEqual([400, 700]);
      expect(parseWeights('400,abc,700')).toEqual([400, 700]);
    });

    it('should handle single weight', () => {
      expect(parseWeights('400')).toEqual([400]);
    });

    it('should handle empty string', () => {
      expect(parseWeights('')).toEqual([]);
    });

    it('should handle all valid weights', () => {
      expect(parseWeights('100,200,300,400,500,600,700,800,900')).toEqual([
        100, 200, 300, 400, 500, 600, 700, 800, 900,
      ]);
    });

    it('should filter duplicates naturally (returns array as-is)', () => {
      const result = parseWeights('400,400,700,700');
      expect(result).toEqual([400, 400, 700, 700]);
    });
  });

  describe('parseSubsets', () => {
    it('should parse comma-separated subsets', () => {
      expect(parseSubsets('latin,latin-ext')).toEqual(['latin', 'latin-ext']);
    });

    it('should handle spaces around subsets', () => {
      expect(parseSubsets('latin, latin-ext, cyrillic')).toEqual([
        'latin',
        'latin-ext',
        'cyrillic',
      ]);
    });

    it('should filter out empty strings', () => {
      expect(parseSubsets('latin,,latin-ext')).toEqual(['latin', 'latin-ext']);
    });

    it('should handle single subset', () => {
      expect(parseSubsets('latin')).toEqual(['latin']);
    });

    it('should handle empty string', () => {
      expect(parseSubsets('')).toEqual([]);
    });

    it('should preserve subset names exactly', () => {
      expect(parseSubsets('latin-ext,greek,cyrillic-ext')).toEqual([
        'latin-ext',
        'greek',
        'cyrillic-ext',
      ]);
    });

    it('should handle multiple commas', () => {
      expect(parseSubsets('latin,,,latin-ext')).toEqual(['latin', 'latin-ext']);
    });
  });

  describe('isValidWeight', () => {
    it('should return true for valid weights (100-900, multiples of 100)', () => {
      expect(isValidWeight(100)).toBe(true);
      expect(isValidWeight(200)).toBe(true);
      expect(isValidWeight(300)).toBe(true);
      expect(isValidWeight(400)).toBe(true);
      expect(isValidWeight(500)).toBe(true);
      expect(isValidWeight(600)).toBe(true);
      expect(isValidWeight(700)).toBe(true);
      expect(isValidWeight(800)).toBe(true);
      expect(isValidWeight(900)).toBe(true);
    });

    it('should return false for weights not multiples of 100', () => {
      expect(isValidWeight(150)).toBe(false);
      expect(isValidWeight(450)).toBe(false);
      expect(isValidWeight(750)).toBe(false);
    });

    it('should return false for weights below 100', () => {
      expect(isValidWeight(0)).toBe(false);
      expect(isValidWeight(50)).toBe(false);
      expect(isValidWeight(99)).toBe(false);
    });

    it('should return false for weights above 900', () => {
      expect(isValidWeight(901)).toBe(false);
      expect(isValidWeight(1000)).toBe(false);
      expect(isValidWeight(10000)).toBe(false);
    });

    it('should return false for negative weights', () => {
      expect(isValidWeight(-100)).toBe(false);
      expect(isValidWeight(-400)).toBe(false);
    });
  });

  describe('getFallbackFonts', () => {
    it('should return serif fallbacks for serif fonts', () => {
      const serifFallbacks = ['Georgia', 'Times New Roman', 'serif'];
      expect(getFallbackFonts('Playfair Display')).toEqual(serifFallbacks);
      expect(getFallbackFonts('Lora')).toEqual(serifFallbacks);
      expect(getFallbackFonts('Merriweather')).toEqual(serifFallbacks);
      expect(getFallbackFonts('Cormorant')).toEqual(serifFallbacks);
    });

    it('should return monospace fallbacks for mono fonts', () => {
      const monoFallbacks = ['Consolas', 'Monaco', 'monospace'];
      expect(getFallbackFonts('JetBrains Mono')).toEqual(monoFallbacks);
    });

    it('should return sans-serif fallbacks for sans-serif fonts', () => {
      const sansFallbacks = [
        'system-ui',
        'Helvetica Neue',
        'Helvetica',
        'Arial',
        'sans-serif',
      ];
      expect(getFallbackFonts('Inter')).toEqual(sansFallbacks);
      expect(getFallbackFonts('Roboto')).toEqual(sansFallbacks);
      expect(getFallbackFonts('Poppins')).toEqual(sansFallbacks);
    });

    it('should return sans-serif fallbacks for unknown fonts', () => {
      const sansFallbacks = [
        'system-ui',
        'Helvetica Neue',
        'Helvetica',
        'Arial',
        'sans-serif',
      ];
      expect(getFallbackFonts('Unknown Font')).toEqual(sansFallbacks);
    });
  });

  describe('generateFontFamily', () => {
    it('should generate font-family with serif fallbacks', () => {
      expect(generateFontFamily('Playfair Display')).toBe(
        '"Playfair Display", Georgia, Times New Roman, serif',
      );
    });

    it('should generate font-family with monospace fallbacks', () => {
      expect(generateFontFamily('JetBrains Mono')).toBe(
        '"JetBrains Mono", Consolas, Monaco, monospace',
      );
    });

    it('should generate font-family with sans-serif fallbacks', () => {
      expect(generateFontFamily('Inter')).toBe(
        '"Inter", system-ui, Helvetica Neue, Helvetica, Arial, sans-serif',
      );
    });

    it('should quote the main font name', () => {
      const result = generateFontFamily('Roboto');
      expect(result).toMatch(/^"Roboto"/);
    });

    it('should handle fonts with spaces', () => {
      const result = generateFontFamily('Open Sans');
      expect(result).toMatch(/^"Open Sans"/);
    });

    it('should work for single-word fonts', () => {
      expect(generateFontFamily('Poppins')).toBe(
        '"Poppins", system-ui, Helvetica Neue, Helvetica, Arial, sans-serif',
      );
    });
  });

  describe('Integration Tests', () => {
    it('should convert font name and generate proper CSS variable', () => {
      const fonts = [
        { name: 'Inter', variable: 'inter' },
        { name: 'Playfair Display', variable: 'playfair-display' },
        { name: 'JetBrains Mono', variable: 'jetbrains-mono' },
      ];

      fonts.forEach(({ name, variable }) => {
        expect(fontToCssVariable(name)).toBe(variable);
      });
    });

    it('should parse and validate weights together', () => {
      const weights = parseWeights('100,400,700,900');
      weights.forEach((weight) => {
        expect(isValidWeight(weight)).toBe(true);
      });
    });

    it('should generate complete font stack for different font types', () => {
      const serif = generateFontFamily('Lora');
      const sans = generateFontFamily('Inter');
      const mono = generateFontFamily('JetBrains Mono');

      expect(serif).toContain('serif');
      expect(sans).toContain('sans-serif');
      expect(mono).toContain('monospace');
    });
  });

  describe('Edge Cases', () => {
    it('should handle font names with special characters', () => {
      const cssVar = fontToCssVariable('Font-Name_123');
      expect(cssVar).toBe('font-name_123');
    });

    it('should handle very large weight values', () => {
      expect(parseWeights('400,99999,700')).toEqual([400, 700]);
    });

    it('should handle decimal weights', () => {
      expect(parseWeights('400.5,700.9')).toEqual([400, 700]);
    });

    it('should handle weights with leading zeros', () => {
      expect(parseWeights('0400,0700')).toEqual([400, 700]);
    });

    it('should handle empty subset after split', () => {
      expect(parseSubsets(', , ,')).toEqual([]);
    });
  });
});
