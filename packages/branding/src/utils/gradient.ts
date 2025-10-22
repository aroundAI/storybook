/**
 * Gradient Utility Functions
 *
 * Functions for building CSS gradient strings and applying preset gradients.
 */

import type { HexColor } from '../types';
import { GRADIENT_PRESETS, GLOW_INTENSITY_PRESETS } from '../constants';

/**
 * Gradient configuration type (matching Zod schema)
 */
export type GradientConfig = {
  enabled: boolean;
  type?: 'linear' | 'radial';
  colors?: HexColor[];
  stops?: Array<{ color: HexColor; position: number }>;
  preset?: 'sunset' | 'ocean' | 'neon' | 'forest' | 'fire' | 'purple-blue';
  direction?: string;
  animate?: boolean;
};

/**
 * Glow configuration type (matching Zod schema)
 */
export type GlowConfig = {
  enabled: boolean;
  color?: HexColor;
  intensity?: 'subtle' | 'medium' | 'strong' | 'neon';
  animate?: boolean;
};

/**
 * Builds a CSS gradient string from gradient configuration
 *
 * Priority order:
 * 1. Preset (if specified)
 * 2. Color stops with positions (advanced mode)
 * 3. Simple color array (simple mode)
 *
 * @param config - Gradient configuration
 * @returns CSS gradient string (e.g., 'linear-gradient(to right, #fff, #000)')
 */
export function buildGradientString(config: GradientConfig): string {
  if (!config.enabled) {
    return '';
  }

  const type = config.type || 'linear';
  const direction = config.direction || 'to right';

  // Priority 1: Use preset if specified
  if (config.preset && config.preset in GRADIENT_PRESETS) {
    const preset = GRADIENT_PRESETS[config.preset];
    const colors = preset.colors.join(', ');
    return `${preset.type}-gradient(${preset.direction}, ${colors})`;
  }

  // Priority 2: Use color stops with positions (advanced mode)
  if (config.stops && config.stops.length >= 2) {
    const stops = config.stops
      .map((stop) => `${stop.color} ${stop.position}%`)
      .join(', ');
    return `${type}-gradient(${direction}, ${stops})`;
  }

  // Priority 3: Use simple color array
  if (config.colors && config.colors.length >= 2) {
    const colors = config.colors.join(', ');
    return `${type}-gradient(${direction}, ${colors})`;
  }

  // Fallback: return empty string if no valid configuration
  return '';
}

/**
 * Builds CSS text-shadow string for glow effects
 *
 * @param config - Glow configuration
 * @param fallbackColor - Fallback color if not specified in config
 * @returns CSS text-shadow string (e.g., '0 0 10px #fff, 0 0 20px #fff')
 */
export function buildGlowShadow(config: GlowConfig, fallbackColor: HexColor): string {
  if (!config.enabled) {
    return '';
  }

  const intensity = config.intensity || 'medium';
  const color = config.color || fallbackColor;
  const preset = GLOW_INTENSITY_PRESETS[intensity];

  return preset.shadows.map((shadow) => `${shadow} ${color}`).join(', ');
}

/**
 * Applies a gradient preset by name
 *
 * @param presetName - Name of the preset to apply
 * @returns Gradient configuration object
 */
export function applyGradientPreset(
  presetName: keyof typeof GRADIENT_PRESETS,
): Partial<GradientConfig> {
  const preset = GRADIENT_PRESETS[presetName];

  return {
    enabled: true,
    type: preset.type,
    colors: [...preset.colors],
    direction: preset.direction,
    preset: presetName,
  };
}

/**
 * Validates if a gradient configuration is complete and usable
 *
 * @param config - Gradient configuration to validate
 * @returns True if configuration can generate a valid gradient
 */
export function isValidGradientConfig(config: GradientConfig): boolean {
  if (!config.enabled) {
    return false;
  }

  // Check if preset is specified
  if (config.preset && config.preset in GRADIENT_PRESETS) {
    return true;
  }

  // Check if color stops are valid
  if (config.stops && config.stops.length >= 2) {
    return true;
  }

  // Check if simple colors are valid
  if (config.colors && config.colors.length >= 2) {
    return true;
  }

  return false;
}

/**
 * Gets the description for a gradient preset
 *
 * @param presetName - Name of the preset
 * @returns Description string or undefined if preset doesn't exist
 */
export function getGradientPresetDescription(
  presetName: keyof typeof GRADIENT_PRESETS,
): string | undefined {
  return GRADIENT_PRESETS[presetName]?.description;
}

/**
 * Gets all available gradient preset names
 *
 * @returns Array of preset names
 */
export function getAvailableGradientPresets(): Array<keyof typeof GRADIENT_PRESETS> {
  return Object.keys(GRADIENT_PRESETS) as Array<keyof typeof GRADIENT_PRESETS>;
}
