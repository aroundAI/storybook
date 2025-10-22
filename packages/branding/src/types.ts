/**
 * Branding Types
 *
 * TypeScript type definitions for the branding configuration system.
 * These types are inferred from the Zod schemas in config.ts.
 */

import type { z } from 'zod';

import type {
  BrandingConfigSchema,
  ColorConfigSchema,
  IconConfigSchema,
  LogoConfigSchema,
  MetadataConfigSchema,
  TypographyConfigSchema,
} from './config';

/**
 * Logo Configuration
 */
export type LogoConfig = z.infer<typeof LogoConfigSchema>;

/**
 * Logo Type
 */
export type LogoType = LogoConfig['type'];

/**
 * Color Configuration
 */
export type ColorConfig = z.infer<typeof ColorConfigSchema>;

/**
 * Typography Configuration
 */
export type TypographyConfig = z.infer<typeof TypographyConfigSchema>;

/**
 * Font Configuration
 */
export type FontConfig = TypographyConfig['heading'];

/**
 * Icon Configuration
 */
export type IconConfig = z.infer<typeof IconConfigSchema>;

/**
 * Icon Style
 */
export type IconStyle = IconConfig['style'];

/**
 * Metadata Configuration
 */
export type MetadataConfig = z.infer<typeof MetadataConfigSchema>;

/**
 * Brand Personality
 */
export type BrandPersonality = NonNullable<MetadataConfig['personality']>;

/**
 * App Category
 */
export type AppCategory = NonNullable<MetadataConfig['category']>;

/**
 * Complete Branding Configuration
 */
export type BrandingConfig = z.infer<typeof BrandingConfigSchema>;

/**
 * Font Weight Values
 */
export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

/**
 * Google Fonts Subset
 */
export type FontSubset =
  | 'latin'
  | 'latin-ext'
  | 'cyrillic'
  | 'cyrillic-ext'
  | 'greek'
  | 'greek-ext'
  | 'vietnamese';

/**
 * Hex Color String
 */
export type HexColor = `#${string}`;
