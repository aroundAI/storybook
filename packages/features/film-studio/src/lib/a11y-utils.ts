/**
 * Accessibility utilities for WCAG 2.1 AA compliance
 * @module @kit/film-studio/lib/a11y-utils
 */

/**
 * WCAG 2.1 AA minimum contrast ratios
 */
export const CONTRAST_REQUIREMENTS = {
  /** Normal text (< 18pt or < 14pt bold) */
  normalText: 4.5,
  /** Large text (>= 18pt or >= 14pt bold) */
  largeText: 3.0,
  /** UI components and graphical objects */
  uiComponents: 3.0,
  /** Focus indicators */
  focusIndicator: 3.0,
} as const;

export type ContrastType = keyof typeof CONTRAST_REQUIREMENTS;

/**
 * RGB color representation
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Converts a hex color string to RGB values
 * @param hex - Hex color string (e.g., "#FF0000" or "#F00")
 * @returns RGB object or null if invalid
 */
export function hexToRgb(hex: string): RGB | null {
  // Remove # if present
  const cleanHex = hex.replace(/^#/, '');

  // Handle shorthand hex (e.g., "F00" -> "FF0000")
  let fullHex = cleanHex;
  if (cleanHex.length === 3) {
    fullHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  // Validate hex format
  if (!/^[0-9A-Fa-f]{6}$/.test(fullHex)) {
    return null;
  }

  const r = parseInt(fullHex.slice(0, 2), 16);
  const g = parseInt(fullHex.slice(2, 4), 16);
  const b = parseInt(fullHex.slice(4, 6), 16);

  return { r, g, b };
}

/**
 * Converts RGB values to hex color string
 * @param rgb - RGB object
 * @returns Hex color string (e.g., "#FF0000")
 */
export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`.toUpperCase();
}

/**
 * Calculates the relative luminance of a color per WCAG 2.1
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * @param rgb - RGB color values
 * @returns Relative luminance value (0-1)
 */
export function getRelativeLuminance(rgb: RGB): number {
  const linearize = (c: number): number => {
    const sRGB = c / 255;
    return sRGB <= 0.03928
      ? sRGB / 12.92
      : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  };

  const r = linearize(rgb.r);
  const g = linearize(rgb.g);
  const b = linearize(rgb.b);

  // ITU-R BT.709 coefficients
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculates the contrast ratio between two colors per WCAG 2.1
 * @see https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 * @param color1 - First color (hex string or RGB)
 * @param color2 - Second color (hex string or RGB)
 * @returns Contrast ratio (1-21)
 */
export function calculateContrastRatio(
  color1: string | RGB,
  color2: string | RGB,
): number {
  const rgb1 = typeof color1 === 'string' ? hexToRgb(color1) : color1;
  const rgb2 = typeof color2 === 'string' ? hexToRgb(color2) : color2;

  if (!rgb1 || !rgb2) {
    return 0;
  }

  const L1 = getRelativeLuminance(rgb1);
  const L2 = getRelativeLuminance(rgb2);

  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Checks if a contrast ratio meets WCAG 2.1 AA requirements
 * @param ratio - Contrast ratio to check
 * @param type - Type of content (normalText, largeText, uiComponents, focusIndicator)
 * @returns Whether the contrast ratio meets requirements
 */
export function isValidContrastRatio(
  ratio: number,
  type: ContrastType,
): boolean {
  return ratio >= CONTRAST_REQUIREMENTS[type];
}

/**
 * Result of a contrast validation check
 */
export interface ContrastValidationResult {
  ratio: number;
  meetsNormalText: boolean;
  meetsLargeText: boolean;
  meetsUIComponents: boolean;
  wcagLevel: 'AAA' | 'AA' | 'fail';
}

/**
 * Validates the contrast between two colors and returns detailed results
 * @param foreground - Foreground color (hex string or RGB)
 * @param background - Background color (hex string or RGB)
 * @returns Validation result with detailed information
 */
export function validateContrast(
  foreground: string | RGB,
  background: string | RGB,
): ContrastValidationResult {
  const ratio = calculateContrastRatio(foreground, background);

  return {
    ratio,
    meetsNormalText: ratio >= CONTRAST_REQUIREMENTS.normalText,
    meetsLargeText: ratio >= CONTRAST_REQUIREMENTS.largeText,
    meetsUIComponents: ratio >= CONTRAST_REQUIREMENTS.uiComponents,
    wcagLevel: ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'fail',
  };
}

/**
 * Focusable element selector for keyboard navigation
 */
export const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Gets all focusable elements within a container
 * @param container - The container element
 * @returns Array of focusable elements
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

/**
 * Formats a time duration for screen reader announcement
 * @param seconds - Duration in seconds
 * @returns Human-readable time string
 */
export function formatTimeForScreenReader(seconds: number): string {
  // Round first to handle edge cases like 59.5 -> 60
  const roundedSeconds = Math.round(seconds);

  if (roundedSeconds < 60) {
    return `${roundedSeconds} second${roundedSeconds === 1 ? '' : 's'}`;
  }

  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${minutes} minute${minutes === 1 ? '' : 's'} and ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
}

/**
 * Creates an ARIA label for a progress indicator
 * @param progress - Progress percentage (0-100)
 * @param label - Optional label prefix
 * @returns ARIA label string
 */
export function createProgressLabel(progress: number, label?: string): string {
  const percent = Math.round(progress);
  const base = `${percent}% complete`;
  return label ? `${label}: ${base}` : base;
}

/**
 * Generates a unique ID for ARIA relationships
 * @param prefix - ID prefix
 * @returns Unique ID string
 */
export function generateAriaId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
