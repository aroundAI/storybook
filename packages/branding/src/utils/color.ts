/**
 * Color Utilities
 *
 * Helper functions for color validation and manipulation.
 */

import type { HexColor } from '../types';

/**
 * Validates if a string is a valid hex color
 */
export function isValidHexColor(color: string): color is HexColor {
  return /^#[0-9A-F]{6}$/i.test(color);
}

/**
 * Converts hex color to RGB values
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!isValidHexColor(hex)) {
    return null;
  }

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);

  return result
    ? {
        r: parseInt(result[1]!, 16),
        g: parseInt(result[2]!, 16),
        b: parseInt(result[3]!, 16),
      }
    : null;
}

/**
 * Calculates relative luminance of a color
 * Used for WCAG contrast ratio calculation
 */
function getRelativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((val) => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
}

/**
 * Calculates WCAG 2.1 contrast ratio between two colors
 * Returns a value between 1 and 21
 */
export function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  if (!rgb1 || !rgb2) {
    return 1; // Invalid colors, return minimum contrast
  }

  const l1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Checks if two colors meet WCAG AA contrast ratio (4.5:1)
 */
export function meetsWCAGAA(color1: string, color2: string): boolean {
  return getContrastRatio(color1, color2) >= 4.5;
}

/**
 * Checks if two colors meet WCAG AAA contrast ratio (7:1)
 */
export function meetsWCAGAAA(color1: string, color2: string): boolean {
  return getContrastRatio(color1, color2) >= 7;
}

/**
 * Darkens a hex color by a percentage
 */
export function darkenColor(hex: string, percent: number): HexColor {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    return hex as HexColor; // Return original if invalid
  }

  const factor = 1 - percent / 100;
  const r = Math.max(0, Math.min(255, Math.round(rgb.r * factor)));
  const g = Math.max(0, Math.min(255, Math.round(rgb.g * factor)));
  const b = Math.max(0, Math.min(255, Math.round(rgb.b * factor)));

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}` as HexColor;
}

/**
 * Lightens a hex color by a percentage
 */
export function lightenColor(hex: string, percent: number): HexColor {
  const rgb = hexToRgb(hex);

  if (!rgb) {
    return hex as HexColor; // Return original if invalid
  }

  const factor = percent / 100;
  const r = Math.max(0, Math.min(255, Math.round(rgb.r + (255 - rgb.r) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(rgb.g + (255 - rgb.g) * factor)));
  const b = Math.max(0, Math.min(255, Math.round(rgb.b + (255 - rgb.b) * factor)));

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}` as HexColor;
}

/**
 * Generates a darker variant of a color if not provided
 * Defaults to 20% darker
 */
export function generateDarkerVariant(color: HexColor, percent = 20): HexColor {
  return darkenColor(color, percent);
}
