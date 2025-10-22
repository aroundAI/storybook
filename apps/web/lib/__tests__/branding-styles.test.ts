import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrandingConfig } from '@kit/branding';

import {
  generateBrandingStyles,
  generateGoogleFontsLink,
  generateLogoStyle,
  getBrandingStyleObject,
} from '../branding-styles';

// Mock @kit/branding
vi.mock('@kit/branding', () => ({
  getBrandingConfig: vi.fn(),
  buildGradientString: vi.fn(),
  buildGlowShadow: vi.fn(),
}));

describe('Branding Styles', () => {
  let mockConfig: BrandingConfig;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mock config
    mockConfig = {
      logo: {
        text: 'TestApp',
        textColorLight: '#000000',
        textColorDark: '#FFFFFF',
        fontWeight: 700,
      },
      colors: {
        primary: '#3B82F6',
        primaryDark: '#2563EB',
        secondary: '#8B5CF6',
        accent: '#F59E0B',
      },
      typography: {
        heading: {
          font: 'Inter',
          weights: [400, 600, 700],
        },
        body: {
          font: 'Roboto',
          weights: [400, 500],
        },
      },
    } as BrandingConfig;

    const { getBrandingConfig } = await import('@kit/branding');
    vi.mocked(getBrandingConfig).mockReturnValue(mockConfig);
  });

  describe('generateBrandingStyles', () => {
    it('should generate CSS custom properties', () => {
      const styles = generateBrandingStyles();

      expect(styles).toContain(':root {');
      expect(styles).toContain('--logo-text-color-light: #000000');
      expect(styles).toContain('--logo-text-color-dark: #FFFFFF');
      expect(styles).toContain('--brand-primary-light: #3B82F6');
      expect(styles).toContain('--brand-primary-dark-light: #2563EB');
      expect(styles).toContain('--brand-secondary-light: #8B5CF6');
      expect(styles).toContain('--brand-accent-light: #F59E0B');
      expect(styles).toContain('}');
    });

    it('should generate font family CSS variables', () => {
      const styles = generateBrandingStyles();

      expect(styles).toContain(
        "--font-heading: 'Inter', system-ui, -apple-system, sans-serif",
      );
      expect(styles).toContain(
        "--font-body: 'Roboto', system-ui, -apple-system, sans-serif",
      );
    });

    it('should format CSS properties correctly', () => {
      const styles = generateBrandingStyles();

      // Each property should be on its own line with 2 spaces indentation
      const lines = styles.split('\n');
      expect(lines[0]).toBe(':root {');
      expect(lines[lines.length - 1]).toBe('}');

      // All middle lines should start with 2 spaces
      for (let i = 1; i < lines.length - 1; i++) {
        expect(lines[i]).toMatch(/^  --/);
      }
    });

    it('should handle fonts with spaces in names', () => {
      mockConfig.typography.heading.font = 'Source Sans Pro';

      const styles = generateBrandingStyles();

      expect(styles).toContain(
        "--font-heading: 'Source Sans Pro', system-ui, -apple-system, sans-serif",
      );
    });

    it('should handle special characters in font names', () => {
      mockConfig.typography.body.font = 'Noto Sans JP';

      const styles = generateBrandingStyles();

      expect(styles).toContain(
        "--font-body: 'Noto Sans JP', system-ui, -apple-system, sans-serif",
      );
    });
  });

  describe('generateGoogleFontsLink', () => {
    it('should generate Google Fonts URL for single font', () => {
      mockConfig.typography.heading.font = 'Inter';
      mockConfig.typography.body.font = 'Inter';
      mockConfig.typography.heading.weights = [400, 700];
      mockConfig.typography.body.weights = [400, 500];

      const url = generateGoogleFontsLink();

      expect(url).toContain('https://fonts.googleapis.com/css2?');
      expect(url).toContain('family=Inter:wght@');
      expect(url).toContain('display=swap');
    });

    it('should merge weights for duplicate fonts', () => {
      mockConfig.typography.heading.font = 'Roboto';
      mockConfig.typography.body.font = 'Roboto';
      mockConfig.typography.heading.weights = [400, 700];
      mockConfig.typography.body.weights = [400, 500, 700];

      const url = generateGoogleFontsLink();

      // Should only have one Roboto entry
      const fontCount = (url.match(/family=Roboto/g) || []).length;
      expect(fontCount).toBe(1);

      // Should merge and sort weights: 400, 500, 700
      expect(url).toContain('400;500;700');
    });

    it('should generate URL for multiple different fonts', () => {
      mockConfig.typography.heading.font = 'Montserrat';
      mockConfig.typography.body.font = 'Open Sans';
      mockConfig.typography.heading.weights = [600, 700];
      mockConfig.typography.body.weights = [400];

      const url = generateGoogleFontsLink();

      expect(url).toContain('family=Montserrat:wght@600;700');
      expect(url).toContain('family=Open+Sans:wght@400');
      expect(url).toContain('&');
    });

    it('should handle fonts with spaces', () => {
      mockConfig.typography.heading.font = 'Source Sans Pro';
      mockConfig.typography.body.font = 'Noto Sans';
      mockConfig.typography.heading.weights = [400];
      mockConfig.typography.body.weights = [400];

      const url = generateGoogleFontsLink();

      expect(url).toContain('family=Source+Sans+Pro:wght@400');
      expect(url).toContain('family=Noto+Sans:wght@400');
    });

    it('should sort weights numerically', () => {
      mockConfig.typography.heading.font = 'Inter';
      mockConfig.typography.body.font = 'Inter';
      mockConfig.typography.heading.weights = [700, 400, 600];
      mockConfig.typography.body.weights = [900, 300];

      const url = generateGoogleFontsLink();

      // Should be sorted: 300, 400, 600, 700, 900
      expect(url).toContain('300;400;600;700;900');
    });

    it('should remove duplicate weights', () => {
      mockConfig.typography.heading.font = 'Roboto';
      mockConfig.typography.body.font = 'Roboto';
      mockConfig.typography.heading.weights = [400, 400, 700];
      mockConfig.typography.body.weights = [400, 700, 700];

      const url = generateGoogleFontsLink();

      // Should deduplicate to: 400, 700
      expect(url).toContain('400;700');

      // Should not have extra duplicates
      const weightSection = url.split('wght@')[1]?.split('&')[0];
      expect(weightSection).toBe('400;700');
    });
  });

  describe('getBrandingStyleObject', () => {
    it('should return style object with CSS variables', () => {
      const styles = getBrandingStyleObject();

      expect(styles).toEqual({
        '--logo-text-color-light': '#000000',
        '--logo-text-color-dark': '#FFFFFF',
        '--brand-primary-light': '#3B82F6',
        '--brand-primary-dark-light': '#2563EB',
        '--brand-secondary-light': '#8B5CF6',
        '--brand-accent-light': '#F59E0B',
      });
    });

    it('should return object suitable for React inline styles', () => {
      const styles = getBrandingStyleObject();

      // Should be a plain object with string values
      expect(typeof styles).toBe('object');
      Object.values(styles).forEach((value) => {
        expect(typeof value).toBe('string');
      });
    });

    it('should handle hex color values', () => {
      mockConfig.colors.primary = '#FF5733';
      mockConfig.colors.accent = '#C70039';

      const styles = getBrandingStyleObject();

      expect(styles['--brand-primary-light']).toBe('#FF5733');
      expect(styles['--brand-accent-light']).toBe('#C70039');
    });
  });

  describe('generateLogoStyle', () => {
    it('should generate basic logo styles', () => {
      const styles = generateLogoStyle(mockConfig);

      expect(styles.fontFamily).toBe('var(--font-heading)');
      expect(styles.fontWeight).toBe(700);
      expect(styles.color).toBe('var(--logo-text-color)');
    });

    it('should apply custom font family', () => {
      mockConfig.logo.customFont = {
        family: 'Pacifico',
        url: 'https://fonts.googleapis.com/css2?family=Pacifico',
      };

      const styles = generateLogoStyle(mockConfig);

      expect(styles.fontFamily).toBe("'Pacifico', var(--font-heading)");
    });

    it('should apply custom font weight', () => {
      mockConfig.logo.fontWeight = 900;

      const styles = generateLogoStyle(mockConfig);

      expect(styles.fontWeight).toBe(900);
    });

    it('should apply gradient text effect', async () => {
      mockConfig.logo.gradient = {
        enabled: true,
        from: '#3B82F6',
        to: '#8B5CF6',
        direction: 'to right',
      };

      const { buildGradientString } = await import('@kit/branding');
      vi.mocked(buildGradientString).mockReturnValue(
        'linear-gradient(to right, #3B82F6, #8B5CF6)',
      );

      const styles = generateLogoStyle(mockConfig);

      expect(styles.background).toBe(
        'linear-gradient(to right, #3B82F6, #8B5CF6)',
      );
      expect(styles.backgroundClip).toBe('text');
      expect(styles.WebkitBackgroundClip).toBe('text');
      expect(styles.WebkitTextFillColor).toBe('transparent');
      expect(styles.color).toBe('transparent');
    });

    it('should apply animated gradient', async () => {
      mockConfig.logo.gradient = {
        enabled: true,
        from: '#3B82F6',
        to: '#8B5CF6',
        direction: 'to right',
        animate: true,
      };

      const { buildGradientString } = await import('@kit/branding');
      vi.mocked(buildGradientString).mockReturnValue(
        'linear-gradient(to right, #3B82F6, #8B5CF6)',
      );

      const styles = generateLogoStyle(mockConfig);

      expect(styles.backgroundSize).toBe('200% 200%');
      expect(styles.animation).toContain('gradient-shift 3s ease infinite');
    });

    it('should apply glow effect', async () => {
      mockConfig.logo.glow = {
        enabled: true,
        intensity: 5,
      };

      const { buildGlowShadow } = await import('@kit/branding');
      vi.mocked(buildGlowShadow).mockReturnValue(
        '0 0 10px rgba(59, 130, 246, 0.5)',
      );

      const styles = generateLogoStyle(mockConfig);

      expect(styles.textShadow).toBe('0 0 10px rgba(59, 130, 246, 0.5)');
    });

    it('should apply animated glow effect', async () => {
      mockConfig.logo.glow = {
        enabled: true,
        intensity: 5,
        animate: true,
      };

      const { buildGlowShadow } = await import('@kit/branding');
      vi.mocked(buildGlowShadow).mockReturnValue(
        '0 0 10px rgba(59, 130, 246, 0.5)',
      );

      const styles = generateLogoStyle(mockConfig);

      expect(styles.textShadow).toBe('0 0 10px rgba(59, 130, 246, 0.5)');
      expect(styles.animation).toContain('glow-pulse 2s ease-in-out infinite');
    });

    it('should combine gradient and glow animations', async () => {
      mockConfig.logo.gradient = {
        enabled: true,
        from: '#3B82F6',
        to: '#8B5CF6',
        direction: 'to right',
        animate: true,
      };
      mockConfig.logo.glow = {
        enabled: true,
        intensity: 5,
        animate: true,
      };

      const { buildGradientString, buildGlowShadow } = await import(
        '@kit/branding'
      );
      vi.mocked(buildGradientString).mockReturnValue(
        'linear-gradient(to right, #3B82F6, #8B5CF6)',
      );
      vi.mocked(buildGlowShadow).mockReturnValue(
        '0 0 10px rgba(59, 130, 246, 0.5)',
      );

      const styles = generateLogoStyle(mockConfig);

      expect(styles.animation).toContain('gradient-shift 3s ease infinite');
      expect(styles.animation).toContain('glow-pulse 2s ease-in-out infinite');
    });

    it('should apply text stroke', () => {
      mockConfig.logo.stroke = {
        enabled: true,
        color: '#000000',
        width: 2,
      };

      const styles = generateLogoStyle(mockConfig);

      expect(styles.WebkitTextStroke).toBe('2px #000000');
    });

    it('should use default stroke values', () => {
      mockConfig.logo.stroke = {
        enabled: true,
      };

      const styles = generateLogoStyle(mockConfig);

      expect(styles.WebkitTextStroke).toBe('1px #000000');
    });

    it('should not apply gradient when disabled', async () => {
      mockConfig.logo.gradient = {
        enabled: false,
        from: '#3B82F6',
        to: '#8B5CF6',
        direction: 'to right',
      };

      const styles = generateLogoStyle(mockConfig);

      expect(styles.background).toBeUndefined();
      expect(styles.backgroundClip).toBeUndefined();
      expect(styles.color).toBe('var(--logo-text-color)');
    });

    it('should not apply glow when disabled', () => {
      mockConfig.logo.glow = {
        enabled: false,
        intensity: 5,
      };

      const styles = generateLogoStyle(mockConfig);

      expect(styles.textShadow).toBeUndefined();
    });

    it('should not apply stroke when disabled', () => {
      mockConfig.logo.stroke = {
        enabled: false,
        color: '#000000',
        width: 2,
      };

      const styles = generateLogoStyle(mockConfig);

      expect(styles.WebkitTextStroke).toBeUndefined();
    });

    it('should handle gradient returning null', async () => {
      mockConfig.logo.gradient = {
        enabled: true,
        from: '#3B82F6',
        to: '#8B5CF6',
        direction: 'to right',
      };

      const { buildGradientString } = await import('@kit/branding');
      vi.mocked(buildGradientString).mockReturnValue(null);

      const styles = generateLogoStyle(mockConfig);

      expect(styles.background).toBeUndefined();
      // When gradient is enabled but returns null, color is not set (no else block)
      expect(styles.color).toBeUndefined();
    });

    it('should handle glow shadow returning null', async () => {
      mockConfig.logo.glow = {
        enabled: true,
        intensity: 5,
      };

      const { buildGlowShadow } = await import('@kit/branding');
      vi.mocked(buildGlowShadow).mockReturnValue(null);

      const styles = generateLogoStyle(mockConfig);

      expect(styles.textShadow).toBeUndefined();
    });
  });
});
