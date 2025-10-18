import { getBrandingConfig } from '@kit/branding';

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
 * Generate Google Fonts URL for dynamic font loading
 */
export function generateGoogleFontsLink(): string {
  const config = getBrandingConfig();

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
        // Merge weights and remove duplicates
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
