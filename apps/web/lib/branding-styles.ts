import {
  buildGlowShadow,
  buildGradientString,
  getBrandingConfig,
} from '@kit/branding';
import type { BrandingConfig } from '@kit/branding';

function generateFontFamilyName(fontName: string): string {
  return `'${fontName}', system-ui, -apple-system, sans-serif`;
}

function generateGoogleFontsUrl(
  fonts: Array<{ name: string; weights: number[] }>,
): string {
  const fontParams = fonts
    .map((font) => {
      const name = font.name.replace(/\s+/g, '+');
      const weights = font.weights.join(';');
      return `family=${name}:wght@${weights}`;
    })
    .join('&');

  return `https://fonts.googleapis.com/css2?${fontParams}&display=swap`;
}

/**
 * Generate inline CSS variables from branding configuration
 * These are injected into the root layout's <style> tag
 */
export function generateBrandingStyles(): string {
  const config = getBrandingConfig();

  const styles = {
    // Logo colors
    '--logo-text-color-light': config.logo.textColorLight,
    '--logo-text-color-dark': config.logo.textColorDark,

    // Brand colors (light mode)
    '--brand-primary-light': config.colors.primary,
    '--brand-primary-dark-light': config.colors.primaryDark,
    '--brand-secondary-light': config.colors.secondary,
    '--brand-accent-light': config.colors.accent,

    // Typography - font families
    '--font-heading': generateFontFamilyName(config.typography.heading.font),
    '--font-body': generateFontFamilyName(config.typography.body.font),
  };

  const cssVariables = Object.entries(styles)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');

  return `:root {\n${cssVariables}\n}`;
}

/**
 * Generate Google Fonts URL for branding fonts only.
 * Used in root layout — keeps non-studio pages lightweight.
 */
export function generateGoogleFontsLink(): string {
  const config = getBrandingConfig();

  // Only branding config fonts — no cinema fonts
  const fonts = [
    {
      name: config.typography.heading.font,
      weights: config.typography.heading.weights,
    },
    {
      name: config.typography.body.font,
      weights: config.typography.body.weights,
    },
  ];

  // Remove duplicates if heading and body use the same font
  const uniqueFonts = fonts.reduce(
    (acc, font) => {
      const existing = acc.find((f) => f.name === font.name);
      if (existing) {
        existing.weights = Array.from(
          new Set([...existing.weights, ...font.weights]),
        ).sort();
      } else {
        acc.push(font);
      }
      return acc;
    },
    [] as Array<{ name: string; weights: number[] }>,
  );

  return generateGoogleFontsUrl(uniqueFonts);
}

/**
 * Generate Google Fonts URL for cinema-specific typography.
 * Used in studio layout only — screenplay, reading mode, and timecode fonts.
 */
export function generateCinemaFontsLink(): string {
  const cinemaFonts = [
    {
      name: 'Courier Prime',
      weights: [400, 700],
    },
    {
      name: 'Merriweather',
      weights: [400, 700],
    },
    {
      name: 'JetBrains Mono',
      weights: [400, 500],
    },
  ];

  return generateGoogleFontsUrl(cinemaFonts);
}

/**
 * Get branding styles as a React style object for inline styles
 */
export function getBrandingStyleObject(): Record<string, string> {
  const config = getBrandingConfig();

  return {
    '--logo-text-color-light': config.logo.textColorLight,
    '--logo-text-color-dark': config.logo.textColorDark,
    '--brand-primary-light': config.colors.primary,
    '--brand-primary-dark-light': config.colors.primaryDark,
    '--brand-secondary-light': config.colors.secondary,
    '--brand-accent-light': config.colors.accent,
  } as Record<string, string>;
}

/**
 * Generate dynamic CSS styles for the logo component
 * Handles gradient text, glow effects, stroke, and custom fonts
 */
export function generateLogoStyle(config: BrandingConfig): React.CSSProperties {
  const styles: React.CSSProperties = {
    fontFamily: config.logo.customFont?.family
      ? `'${config.logo.customFont.family}', var(--font-heading)`
      : 'var(--font-heading)',
    fontWeight: config.logo.fontWeight ?? 700,
  };

  // Gradient text effect
  if (config.logo.gradient?.enabled) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gradient = buildGradientString(config.logo.gradient as any);
    if (gradient) {
      styles.background = gradient;
      styles.backgroundClip = 'text';
      styles.WebkitBackgroundClip = 'text';
      styles.WebkitTextFillColor = 'transparent';
      styles.color = 'transparent';

      // Animated gradient
      if (config.logo.gradient.animate) {
        styles.backgroundSize = '200% 200%';
        styles.animation = 'gradient-shift 3s ease infinite';
      }
    }
  } else {
    // Normal text color (uses CSS variable for light/dark mode)
    styles.color = 'var(--logo-text-color)';
  }

  // Glow/shadow effect
  if (config.logo.glow?.enabled) {
    const glowShadow = buildGlowShadow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config.logo.glow as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config.colors.primary as any,
    );
    if (glowShadow) {
      styles.textShadow = glowShadow;

      // Animated glow (pulsing)
      if (config.logo.glow.animate) {
        if (styles.animation) {
          // Combine animations
          styles.animation = `${styles.animation}, glow-pulse-logo 2s ease-in-out infinite`;
        } else {
          styles.animation = 'glow-pulse-logo 2s ease-in-out infinite';
        }
      }
    }
  }

  // Text stroke/outline
  if (config.logo.stroke?.enabled) {
    const strokeColor = config.logo.stroke.color || '#000000';
    const strokeWidth = config.logo.stroke.width || 1;
    styles.WebkitTextStroke = `${strokeWidth}px ${strokeColor}`;
  }

  return styles;
}
