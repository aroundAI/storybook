import { getBrandingConfig } from '@kit/branding';

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

    // Typography
    '--font-heading-family': `var(--font-heading)`,
  };

  const cssVariables = Object.entries(styles)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');

  return `:root {\n${cssVariables}\n}`;
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
