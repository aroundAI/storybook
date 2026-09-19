/**
 * Font Utilities
 *
 * Helper functions for font handling and validation.
 */
import { SUPPORTED_FONTS } from '../constants';
import type { FontSubset, FontWeight } from '../types';

/**
 * Checks if a font is supported
 */
export function isSupportedFont(fontName: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return SUPPORTED_FONTS.includes(fontName as any);
}

/**
 * Converts font name to CSS variable name
 * Example: "Playfair Display" -> "playfair-display"
 */
export function fontToCssVariable(fontName: string): string {
  return fontName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Parses font weights from comma-separated string
 */
export function parseWeights(value: string): FontWeight[] {
  return value
    .split(',')
    .map((w) => parseInt(w.trim(), 10))
    .filter((w) => !isNaN(w) && w >= 100 && w <= 900) as FontWeight[];
}

/**
 * Parses font subsets from comma-separated string
 */
export function parseSubsets(value: string): FontSubset[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0) as FontSubset[];
}

/**
 * Validates if a weight is valid
 */
export function isValidWeight(weight: number): weight is FontWeight {
  return weight >= 100 && weight <= 900 && weight % 100 === 0;
}

/**
 * Gets fallback fonts for a given font
 */
export function getFallbackFonts(fontName: string): string[] {
  const isSerif = [
    'Playfair Display',
    'Lora',
    'Merriweather',
    'Cormorant',
  ].includes(fontName);
  const isMono = ['JetBrains Mono'].includes(fontName);

  if (isSerif) {
    return ['Georgia', 'Times New Roman', 'serif'];
  }

  if (isMono) {
    return ['Consolas', 'Monaco', 'monospace'];
  }

  return ['system-ui', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'];
}

/**
 * Generates CSS font-family declaration with fallbacks
 */
export function generateFontFamily(fontName: string): string {
  const fallbacks = getFallbackFonts(fontName);
  return `"${fontName}", ${fallbacks.join(', ')}`;
}
