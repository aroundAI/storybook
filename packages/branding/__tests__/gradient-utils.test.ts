import { describe, expect, it } from 'vitest';
import {
  applyGradientPreset,
  buildGlowShadow,
  buildGradientString,
  getAvailableGradientPresets,
  getGradientPresetDescription,
  type GlowConfig,
  type GradientConfig,
  isValidGradientConfig,
} from '../src/utils/gradient';

describe('Gradient Utilities', () => {
  describe('buildGradientString', () => {
    it('should return empty string when gradient is disabled', () => {
      const config: GradientConfig = { enabled: false };
      expect(buildGradientString(config)).toBe('');
    });

    it('should build gradient from simple color array', () => {
      const config: GradientConfig = {
        enabled: true,
        colors: ['#FF0000' as any, '#0000FF' as any],
      };
      const result = buildGradientString(config);
      expect(result).toBe('linear-gradient(to right, #FF0000, #0000FF)');
    });

    it('should build gradient with custom direction', () => {
      const config: GradientConfig = {
        enabled: true,
        colors: ['#FF0000' as any, '#0000FF' as any],
        direction: 'to bottom',
      };
      const result = buildGradientString(config);
      expect(result).toBe('linear-gradient(to bottom, #FF0000, #0000FF)');
    });

    it('should build radial gradient', () => {
      const config: GradientConfig = {
        enabled: true,
        type: 'radial',
        colors: ['#FF0000' as any, '#0000FF' as any],
      };
      const result = buildGradientString(config);
      expect(result).toBe('radial-gradient(to right, #FF0000, #0000FF)');
    });

    it('should build gradient with color stops', () => {
      const config: GradientConfig = {
        enabled: true,
        stops: [
          { color: '#FF0000' as any, position: 0 },
          { color: '#0000FF' as any, position: 100 },
        ],
      };
      const result = buildGradientString(config);
      expect(result).toBe('linear-gradient(to right, #FF0000 0%, #0000FF 100%)');
    });

    it('should build gradient with multiple color stops', () => {
      const config: GradientConfig = {
        enabled: true,
        stops: [
          { color: '#FF0000' as any, position: 0 },
          { color: '#00FF00' as any, position: 50 },
          { color: '#0000FF' as any, position: 100 },
        ],
      };
      const result = buildGradientString(config);
      expect(result).toBe(
        'linear-gradient(to right, #FF0000 0%, #00FF00 50%, #0000FF 100%)',
      );
    });

    it('should prioritize preset over colors and stops', () => {
      const config: GradientConfig = {
        enabled: true,
        preset: 'sunset',
        colors: ['#000000' as any, '#FFFFFF' as any],
      };
      const result = buildGradientString(config);
      // Should use sunset preset, not the colors
      expect(result).toContain('linear-gradient');
      expect(result).not.toContain('#000000');
      expect(result).not.toContain('#FFFFFF');
    });

    it('should use all preset gradients correctly', () => {
      const presets: Array<GradientConfig['preset']> = [
        'sunset',
        'ocean',
        'neon',
        'forest',
        'fire',
        'purple-blue',
      ];

      presets.forEach((preset) => {
        const config: GradientConfig = {
          enabled: true,
          preset,
        };
        const result = buildGradientString(config);
        expect(result).toBeTruthy();
        expect(result).toContain('gradient');
      });
    });

    it('should return empty string with insufficient colors', () => {
      const config: GradientConfig = {
        enabled: true,
        colors: ['#FF0000' as any],
      };
      expect(buildGradientString(config)).toBe('');
    });

    it('should return empty string with insufficient stops', () => {
      const config: GradientConfig = {
        enabled: true,
        stops: [{ color: '#FF0000' as any, position: 0 }],
      };
      expect(buildGradientString(config)).toBe('');
    });

    it('should handle three or more colors', () => {
      const config: GradientConfig = {
        enabled: true,
        colors: [
          '#FF0000' as any,
          '#00FF00' as any,
          '#0000FF' as any,
          '#FFFF00' as any,
        ],
      };
      const result = buildGradientString(config);
      expect(result).toBe(
        'linear-gradient(to right, #FF0000, #00FF00, #0000FF, #FFFF00)',
      );
    });
  });

  describe('buildGlowShadow', () => {
    it('should return empty string when glow is disabled', () => {
      const config: GlowConfig = { enabled: false };
      expect(buildGlowShadow(config, '#FFFFFF' as any)).toBe('');
    });

    it('should build glow shadow with fallback color', () => {
      const config: GlowConfig = { enabled: true };
      const result = buildGlowShadow(config, '#FFFFFF' as any);
      expect(result).toBeTruthy();
      expect(result).toContain('#FFFFFF');
    });

    it('should use custom color over fallback', () => {
      const config: GlowConfig = {
        enabled: true,
        color: '#FF0000' as any,
      };
      const result = buildGlowShadow(config, '#FFFFFF' as any);
      expect(result).toContain('#FF0000');
      expect(result).not.toContain('#FFFFFF');
    });

    it('should build glow with different intensities', () => {
      const intensities: Array<GlowConfig['intensity']> = [
        'subtle',
        'medium',
        'strong',
        'neon',
      ];

      intensities.forEach((intensity) => {
        const config: GlowConfig = {
          enabled: true,
          intensity,
        };
        const result = buildGlowShadow(config, '#FFFFFF' as any);
        expect(result).toBeTruthy();
        expect(result).toContain('#FFFFFF');
      });
    });

    it('should default to medium intensity', () => {
      const config: GlowConfig = { enabled: true };
      const result = buildGlowShadow(config, '#FFFFFF' as any);
      // Medium intensity should produce some shadow
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should generate multiple shadow layers', () => {
      const config: GlowConfig = {
        enabled: true,
        intensity: 'strong',
      };
      const result = buildGlowShadow(config, '#FFFFFF' as any);
      // Should have commas for multiple shadows
      expect(result).toContain(',');
    });
  });

  describe('applyGradientPreset', () => {
    it('should apply sunset preset', () => {
      const result = applyGradientPreset('sunset');
      expect(result.enabled).toBe(true);
      expect(result.preset).toBe('sunset');
      expect(result.colors).toBeDefined();
      expect(result.type).toBeDefined();
    });

    it('should apply ocean preset', () => {
      const result = applyGradientPreset('ocean');
      expect(result.enabled).toBe(true);
      expect(result.preset).toBe('ocean');
    });

    it('should apply all available presets', () => {
      const presets = ['sunset', 'ocean', 'neon', 'forest', 'fire', 'purple-blue'] as const;

      presets.forEach((preset) => {
        const result = applyGradientPreset(preset);
        expect(result.enabled).toBe(true);
        expect(result.preset).toBe(preset);
        expect(result.colors).toBeDefined();
        expect(Array.isArray(result.colors)).toBe(true);
      });
    });

    it('should return a copy of preset colors (not reference)', () => {
      const result1 = applyGradientPreset('sunset');
      const result2 = applyGradientPreset('sunset');
      expect(result1.colors).not.toBe(result2.colors);
    });

    it('should include gradient type in result', () => {
      const result = applyGradientPreset('sunset');
      expect(result.type).toBeDefined();
      expect(['linear', 'radial']).toContain(result.type);
    });

    it('should include direction in result', () => {
      const result = applyGradientPreset('sunset');
      expect(result.direction).toBeDefined();
      expect(typeof result.direction).toBe('string');
    });
  });

  describe('isValidGradientConfig', () => {
    it('should return false for disabled gradient', () => {
      const config: GradientConfig = { enabled: false };
      expect(isValidGradientConfig(config)).toBe(false);
    });

    it('should return true for valid preset', () => {
      const config: GradientConfig = {
        enabled: true,
        preset: 'sunset',
      };
      expect(isValidGradientConfig(config)).toBe(true);
    });

    it('should return true for valid color array', () => {
      const config: GradientConfig = {
        enabled: true,
        colors: ['#FF0000' as any, '#0000FF' as any],
      };
      expect(isValidGradientConfig(config)).toBe(true);
    });

    it('should return true for valid color stops', () => {
      const config: GradientConfig = {
        enabled: true,
        stops: [
          { color: '#FF0000' as any, position: 0 },
          { color: '#0000FF' as any, position: 100 },
        ],
      };
      expect(isValidGradientConfig(config)).toBe(true);
    });

    it('should return false for insufficient colors', () => {
      const config: GradientConfig = {
        enabled: true,
        colors: ['#FF0000' as any],
      };
      expect(isValidGradientConfig(config)).toBe(false);
    });

    it('should return false for insufficient stops', () => {
      const config: GradientConfig = {
        enabled: true,
        stops: [{ color: '#FF0000' as any, position: 0 }],
      };
      expect(isValidGradientConfig(config)).toBe(false);
    });

    it('should return false for empty configuration', () => {
      const config: GradientConfig = { enabled: true };
      expect(isValidGradientConfig(config)).toBe(false);
    });

    it('should return true with three or more colors', () => {
      const config: GradientConfig = {
        enabled: true,
        colors: ['#FF0000' as any, '#00FF00' as any, '#0000FF' as any],
      };
      expect(isValidGradientConfig(config)).toBe(true);
    });
  });

  describe('getGradientPresetDescription', () => {
    it('should return description for valid presets', () => {
      const presets = ['sunset', 'ocean', 'neon', 'forest', 'fire', 'purple-blue'] as const;

      presets.forEach((preset) => {
        const description = getGradientPresetDescription(preset);
        expect(description).toBeDefined();
        expect(typeof description).toBe('string');
        expect(description!.length).toBeGreaterThan(0);
      });
    });

    it('should return different descriptions for different presets', () => {
      const sunset = getGradientPresetDescription('sunset');
      const ocean = getGradientPresetDescription('ocean');
      expect(sunset).not.toBe(ocean);
    });
  });

  describe('getAvailableGradientPresets', () => {
    it('should return an array of preset names', () => {
      const presets = getAvailableGradientPresets();
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThan(0);
    });

    it('should include all expected presets', () => {
      const presets = getAvailableGradientPresets();
      const expected = ['sunset', 'ocean', 'neon', 'forest', 'fire', 'purple-blue'];
      expected.forEach((preset) => {
        expect(presets).toContain(preset);
      });
    });

    it('should return at least 6 presets', () => {
      const presets = getAvailableGradientPresets();
      expect(presets.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('Integration Tests', () => {
    it('should build gradient from applied preset', () => {
      const config = applyGradientPreset('sunset');
      const gradientString = buildGradientString(config as GradientConfig);
      expect(gradientString).toBeTruthy();
      expect(gradientString).toContain('gradient');
    });

    it('should validate config created from preset', () => {
      const config = applyGradientPreset('ocean');
      expect(isValidGradientConfig(config as GradientConfig)).toBe(true);
    });

    it('should work with all available presets', () => {
      const presets = getAvailableGradientPresets();
      presets.forEach((preset) => {
        const config = applyGradientPreset(preset);
        const isValid = isValidGradientConfig(config as GradientConfig);
        const gradientString = buildGradientString(config as GradientConfig);
        expect(isValid).toBe(true);
        expect(gradientString).toBeTruthy();
      });
    });

    it('should generate different gradients for different presets', () => {
      const sunset = buildGradientString(applyGradientPreset('sunset') as GradientConfig);
      const ocean = buildGradientString(applyGradientPreset('ocean') as GradientConfig);
      expect(sunset).not.toBe(ocean);
    });
  });

  describe('Edge Cases', () => {
    it('should handle gradient with no direction specified', () => {
      const config: GradientConfig = {
        enabled: true,
        colors: ['#FF0000' as any, '#0000FF' as any],
        direction: undefined,
      };
      const result = buildGradientString(config);
      expect(result).toContain('to right'); // Should use default
    });

    it('should handle gradient with empty colors array', () => {
      const config: GradientConfig = {
        enabled: true,
        colors: [],
      };
      expect(buildGradientString(config)).toBe('');
    });

    it('should handle gradient with empty stops array', () => {
      const config: GradientConfig = {
        enabled: true,
        stops: [],
      };
      expect(buildGradientString(config)).toBe('');
    });

    it('should handle glow with undefined intensity', () => {
      const config: GlowConfig = {
        enabled: true,
        intensity: undefined,
      };
      const result = buildGlowShadow(config, '#FFFFFF' as any);
      expect(result).toBeTruthy(); // Should use default medium
    });
  });
});
