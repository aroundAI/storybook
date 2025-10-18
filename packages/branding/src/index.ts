/**
 * Branding Package
 *
 * Environment-variable-based branding configuration system
 * for rapid app customization.
 */

// Export configuration
export { getBrandingConfig, getClientBrandingConfig } from './config';
export {
  BrandingConfigSchema,
  ColorConfigSchema,
  IconConfigSchema,
  LogoConfigSchema,
  MetadataConfigSchema,
  TypographyConfigSchema,
} from './config';

// Export types
export type {
  AppCategory,
  BrandingConfig,
  BrandPersonality,
  ColorConfig,
  FontConfig,
  FontSubset,
  FontWeight,
  HexColor,
  IconConfig,
  IconStyle,
  LogoConfig,
  LogoType,
  MetadataConfig,
  TypographyConfig,
} from './types';

// Export constants
export {
  CATEGORY_COLOR_PALETTES,
  DEFAULT_COLORS,
  DEFAULT_ICONS,
  DEFAULT_LOGO,
  DEFAULT_TYPOGRAPHY,
  FONT_WEIGHT_MAP,
  PERSONALITY_FONT_PAIRS,
  SUPPORTED_FONTS,
} from './constants';

// Export utilities
export {
  darkenColor,
  generateDarkerVariant,
  getContrastRatio,
  hexToRgb,
  isValidHexColor,
  lightenColor,
  meetsWCAGAA,
  meetsWCAGAAA,
} from './utils/color';
export {
  fontToCssVariable,
  generateFontFamily,
  getFallbackFonts,
  isSupportedFont,
  isValidWeight,
  parseSubsets,
  parseWeights,
} from './utils/font';
