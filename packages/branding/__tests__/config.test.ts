import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrandingConfig, BrandingConfigSchema } from '../src/config';

describe('Branding Configuration', () => {
  // Store original environment
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment before each test
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('NEXT_PUBLIC_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('getBrandingConfig', () => {
    it('should return default configuration when no env vars set', () => {
      const config = getBrandingConfig();

      expect(config).toBeDefined();
      expect(config.logo).toBeDefined();
      expect(config.colors).toBeDefined();
      expect(config.typography).toBeDefined();
      expect(config.icons).toBeDefined();
    });

    it('should use custom primary color from environment', () => {
      process.env.NEXT_PUBLIC_BRAND_PRIMARY = '#FF0000';

      const config = getBrandingConfig();

      expect(config.colors.primary).toBe('#FF0000');
    });

    it('should auto-generate primaryDark when not provided', () => {
      process.env.NEXT_PUBLIC_BRAND_PRIMARY = '#3B82F6';

      const config = getBrandingConfig();

      expect(config.colors.primaryDark).toBeDefined();
      expect(config.colors.primaryDark).toMatch(/^#[0-9A-F]{6}$/i);
      expect(config.colors.primaryDark).not.toBe('#3B82F6');
    });

    it('should use explicit primaryDark when provided', () => {
      process.env.NEXT_PUBLIC_BRAND_PRIMARY = '#3B82F6';
      process.env.NEXT_PUBLIC_BRAND_PRIMARY_DARK = '#1E40AF';

      const config = getBrandingConfig();

      expect(config.colors.primaryDark).toBe('#1E40AF');
    });

    it('should parse logo configuration from environment', () => {
      process.env.NEXT_PUBLIC_LOGO_TYPE = 'text';
      process.env.NEXT_PUBLIC_LOGO_TEXT = 'MyApp';
      process.env.NEXT_PUBLIC_LOGO_FONT = 'Inter';
      process.env.NEXT_PUBLIC_LOGO_FONT_WEIGHT = '700';

      const config = getBrandingConfig();

      expect(config.logo.type).toBe('text');
      expect(config.logo.text).toBe('MyApp');
      expect(config.logo.font).toBe('Inter');
      expect(config.logo.fontWeight).toBe(700);
    });

    it('should parse image logo configuration', () => {
      process.env.NEXT_PUBLIC_LOGO_TYPE = 'image';
      process.env.NEXT_PUBLIC_LOGO_IMAGE_URL = 'https://example.com/logo.png';
      process.env.NEXT_PUBLIC_LOGO_WIDTH = '200';
      process.env.NEXT_PUBLIC_LOGO_HEIGHT = '50';

      const config = getBrandingConfig();

      expect(config.logo.type).toBe('image');
      expect(config.logo.imageUrl).toBe('https://example.com/logo.png');
      expect(config.logo.width).toBe(200);
      expect(config.logo.height).toBe(50);
    });

    it('should parse color configuration', () => {
      process.env.NEXT_PUBLIC_BRAND_PRIMARY = '#3B82F6';
      process.env.NEXT_PUBLIC_BRAND_PRIMARY_DARK = '#1E40AF';
      process.env.NEXT_PUBLIC_BRAND_SECONDARY = '#8B5CF6';
      process.env.NEXT_PUBLIC_BRAND_ACCENT = '#F59E0B';

      const config = getBrandingConfig();

      expect(config.colors.primary).toBe('#3B82F6');
      expect(config.colors.primaryDark).toBe('#1E40AF');
      expect(config.colors.secondary).toBe('#8B5CF6');
      expect(config.colors.accent).toBe('#F59E0B');
    });

    it('should parse typography configuration', () => {
      process.env.NEXT_PUBLIC_FONT_HEADING = 'Poppins';
      process.env.NEXT_PUBLIC_FONT_HEADING_WEIGHTS = '600,700,800';
      process.env.NEXT_PUBLIC_FONT_BODY = 'Inter';
      process.env.NEXT_PUBLIC_FONT_BODY_WEIGHTS = '400,500';

      const config = getBrandingConfig();

      expect(config.typography.heading.font).toBe('Poppins');
      expect(config.typography.heading.weights).toEqual([600, 700, 800]);
      expect(config.typography.body.font).toBe('Inter');
      expect(config.typography.body.weights).toEqual([400, 500]);
    });

    it('should parse icon configuration', () => {
      process.env.NEXT_PUBLIC_ICON_STYLE = 'solid';
      process.env.NEXT_PUBLIC_ICON_STROKE_WIDTH = '3';

      const config = getBrandingConfig();

      expect(config.icons.style).toBe('solid');
      expect(config.icons.strokeWidth).toBe(3);
    });

    it('should parse metadata configuration', () => {
      process.env.NEXT_PUBLIC_BRAND_PERSONALITY = 'professional';
      process.env.NEXT_PUBLIC_APP_CATEGORY = 'saas';

      const config = getBrandingConfig();

      expect(config.metadata?.personality).toBe('professional');
      expect(config.metadata?.category).toBe('saas');
    });
  });

  describe('BrandingConfigSchema Validation', () => {
    it('should validate valid hex colors', () => {
      const validConfig = {
        logo: { type: 'text' as const, text: 'App' },
        colors: {
          primary: '#3B82F6',
          primaryDark: '#1E40AF',
          secondary: '#8B5CF6',
          accent: '#F59E0B',
        },
        typography: {
          heading: { font: 'Inter', weights: [700], subsets: ['latin'] },
          body: { font: 'Inter', weights: [400], subsets: ['latin'] },
        },
        icons: { style: 'outline' as const, strokeWidth: 2 },
      };

      const result = BrandingConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should reject invalid hex colors', () => {
      const invalidConfig = {
        logo: { type: 'text' as const },
        colors: {
          primary: 'invalid',
          primaryDark: '#1E40AF',
          secondary: '#8B5CF6',
          accent: '#F59E0B',
        },
        typography: {
          heading: { font: 'Inter', weights: [700] },
          body: { font: 'Inter', weights: [400] },
        },
        icons: {},
      };

      const result = BrandingConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject short hex colors', () => {
      const invalidConfig = {
        logo: { type: 'text' as const },
        colors: {
          primary: '#FFF',
          primaryDark: '#000',
          secondary: '#8B5CF6',
          accent: '#F59E0B',
        },
        typography: {
          heading: { font: 'Inter', weights: [700] },
          body: { font: 'Inter', weights: [400] },
        },
        icons: {},
      };

      const result = BrandingConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should require all color fields', () => {
      const invalidConfig = {
        logo: { type: 'text' as const },
        colors: {
          primary: '#3B82F6',
          // Missing required fields
        },
        typography: {
          heading: { font: 'Inter', weights: [700] },
          body: { font: 'Inter', weights: [400] },
        },
        icons: {},
      };

      const result = BrandingConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should validate logo text length', () => {
      const invalidConfig = {
        logo: {
          type: 'text' as const,
          text: 'A'.repeat(51), // Too long
        },
        colors: {
          primary: '#3B82F6',
          primaryDark: '#1E40AF',
          secondary: '#8B5CF6',
          accent: '#F59E0B',
        },
        typography: {
          heading: { font: 'Inter', weights: [700] },
          body: { font: 'Inter', weights: [400] },
        },
        icons: {},
      };

      const result = BrandingConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should validate font weights range', () => {
      const invalidConfig = {
        logo: { type: 'text' as const },
        colors: {
          primary: '#3B82F6',
          primaryDark: '#1E40AF',
          secondary: '#8B5CF6',
          accent: '#F59E0B',
        },
        typography: {
          heading: { font: 'Inter', weights: [50] }, // Invalid weight
          body: { font: 'Inter', weights: [400] },
        },
        icons: {},
      };

      const result = BrandingConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should validate icon style enum', () => {
      const invalidConfig = {
        logo: { type: 'text' as const },
        colors: {
          primary: '#3B82F6',
          primaryDark: '#1E40AF',
          secondary: '#8B5CF6',
          accent: '#F59E0B',
        },
        typography: {
          heading: { font: 'Inter', weights: [700] },
          body: { font: 'Inter', weights: [400] },
        },
        icons: {
          style: 'invalid' as any,
        },
      };

      const result = BrandingConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing optional fields gracefully', () => {
      process.env.NEXT_PUBLIC_BRAND_PRIMARY = '#3B82F6';

      const config = getBrandingConfig();

      expect(config).toBeDefined();
      expect(config.logo).toBeDefined();
      expect(config.colors).toBeDefined();
    });

    it('should handle invalid number strings gracefully', () => {
      process.env.NEXT_PUBLIC_LOGO_WIDTH = 'invalid';
      process.env.NEXT_PUBLIC_BRAND_PRIMARY = '#3B82F6';

      const config = getBrandingConfig();

      // Should use default value
      expect(typeof config.logo.width).toBe('number');
    });

    it('should handle case-insensitive hex colors', () => {
      process.env.NEXT_PUBLIC_BRAND_PRIMARY = '#3b82f6';
      process.env.NEXT_PUBLIC_BRAND_PRIMARY_DARK = '#1E40AF';

      const config = getBrandingConfig();

      expect(config.colors.primary).toBe('#3b82f6');
    });
  });
});
