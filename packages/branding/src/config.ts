/**
 * Branding Configuration
 *
 * Main configuration parser with Zod validation schemas.
 * Reads from environment variables and provides validated branding config.
 */

import { z } from 'zod';

import { DEFAULT_COLORS, DEFAULT_ICONS, DEFAULT_LOGO, DEFAULT_TYPOGRAPHY } from './constants';
import { generateDarkerVariant, isValidHexColor } from './utils/color';
import { parseSubsets, parseWeights } from './utils/font';

/**
 * Logo Configuration Schema
 */
export const LogoConfigSchema = z.object({
  type: z.enum(['text', 'image', 'svg']).default('text'),
  text: z.string().min(1).max(50).optional(),
  font: z.string().optional(),
  fontWeight: z.number().min(100).max(900).optional(),
  textColorLight: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color')
    .optional(),
  textColorDark: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color')
    .optional(),
  icon: z.string().max(4).optional(), // Allow up to 4 chars for complex emojis
  imageUrl: z.string().url().optional(),
  imageDarkUrl: z.string().url().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  svg: z.string().optional(),
});

/**
 * Color Configuration Schema
 */
export const ColorConfigSchema = z.object({
  primary: z.string().regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color'),
  primaryDark: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color')
    .optional(),
  secondary: z.string().regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color'),
  accent: z.string().regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color'),
  bgLight: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color')
    .optional(),
  bgDark: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color')
    .optional(),
  textLight: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color')
    .optional(),
  textDark: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color')
    .optional(),
});

/**
 * Font Configuration Schema
 */
const FontConfigSchema = z.object({
  font: z.string().min(1),
  weights: z.array(z.number().min(100).max(900)),
  subsets: z.array(z.string()).default(['latin']),
});

/**
 * Typography Configuration Schema
 */
export const TypographyConfigSchema = z.object({
  heading: FontConfigSchema,
  body: FontConfigSchema,
});

/**
 * Icon Configuration Schema
 */
export const IconConfigSchema = z.object({
  style: z.enum(['outline', 'solid']).default('outline'),
  strokeWidth: z.number().min(1).max(3).default(2),
});

/**
 * Metadata Configuration Schema
 */
export const MetadataConfigSchema = z.object({
  personality: z
    .enum(['professional', 'playful', 'minimal', 'bold', 'elegant'])
    .optional(),
  category: z
    .enum(['fintech', 'saas', 'ecommerce', 'healthcare', 'education', 'social'])
    .optional(),
});

/**
 * Complete Branding Configuration Schema
 */
export const BrandingConfigSchema = z.object({
  logo: LogoConfigSchema,
  colors: ColorConfigSchema,
  typography: TypographyConfigSchema,
  icons: IconConfigSchema,
  metadata: MetadataConfigSchema.optional(),
});

/**
 * Type alias for the complete branding configuration
 */
export type BrandingConfig = z.infer<typeof BrandingConfigSchema>;

/**
 * Utility Functions
 */

/**
 * Safely parses an integer from a string
 */
function safeParseInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Gets environment variable branding configuration
 *
 * This function reads all NEXT_PUBLIC_* environment variables
 * and constructs a branding configuration object.
 *
 * @returns Validated branding configuration
 * @throws {ZodError} If configuration is invalid
 */
export function getBrandingConfig(): BrandingConfig {
  // Build raw config from environment variables
  const rawConfig = {
    logo: {
      type: (process.env.NEXT_PUBLIC_LOGO_TYPE as 'text' | 'image' | 'svg') || DEFAULT_LOGO.type,
      text: process.env.NEXT_PUBLIC_LOGO_TEXT || DEFAULT_LOGO.text,
      font: process.env.NEXT_PUBLIC_LOGO_FONT || DEFAULT_LOGO.font,
      fontWeight: safeParseInt(
        process.env.NEXT_PUBLIC_LOGO_FONT_WEIGHT,
        DEFAULT_LOGO.fontWeight,
      ),
      textColorLight:
        process.env.NEXT_PUBLIC_LOGO_TEXT_COLOR_LIGHT || DEFAULT_LOGO.textColorLight,
      textColorDark: process.env.NEXT_PUBLIC_LOGO_TEXT_COLOR_DARK || DEFAULT_LOGO.textColorDark,
      icon: process.env.NEXT_PUBLIC_LOGO_ICON,
      imageUrl: process.env.NEXT_PUBLIC_LOGO_IMAGE_URL,
      imageDarkUrl: process.env.NEXT_PUBLIC_LOGO_IMAGE_DARK_URL,
      width: safeParseInt(process.env.NEXT_PUBLIC_LOGO_WIDTH, DEFAULT_LOGO.width),
      height: safeParseInt(process.env.NEXT_PUBLIC_LOGO_HEIGHT, DEFAULT_LOGO.height),
      svg: process.env.NEXT_PUBLIC_LOGO_SVG,
    },
    colors: {
      primary: process.env.NEXT_PUBLIC_BRAND_PRIMARY || DEFAULT_COLORS.primary,
      primaryDark: process.env.NEXT_PUBLIC_BRAND_PRIMARY_DARK,
      secondary: process.env.NEXT_PUBLIC_BRAND_SECONDARY || DEFAULT_COLORS.secondary,
      accent: process.env.NEXT_PUBLIC_BRAND_ACCENT || DEFAULT_COLORS.accent,
      bgLight: process.env.NEXT_PUBLIC_BRAND_BG_LIGHT,
      bgDark: process.env.NEXT_PUBLIC_BRAND_BG_DARK,
      textLight: process.env.NEXT_PUBLIC_BRAND_TEXT_LIGHT,
      textDark: process.env.NEXT_PUBLIC_BRAND_TEXT_DARK,
    },
    typography: {
      heading: {
        font: process.env.NEXT_PUBLIC_FONT_HEADING || DEFAULT_TYPOGRAPHY.heading.font,
        weights: parseWeights(
          process.env.NEXT_PUBLIC_FONT_HEADING_WEIGHTS || DEFAULT_TYPOGRAPHY.heading.weights.join(','),
        ),
        subsets: parseSubsets(
          process.env.NEXT_PUBLIC_FONT_HEADING_SUBSETS ||
            DEFAULT_TYPOGRAPHY.heading.subsets.join(','),
        ),
      },
      body: {
        font: process.env.NEXT_PUBLIC_FONT_BODY || DEFAULT_TYPOGRAPHY.body.font,
        weights: parseWeights(
          process.env.NEXT_PUBLIC_FONT_BODY_WEIGHTS || DEFAULT_TYPOGRAPHY.body.weights.join(','),
        ),
        subsets: parseSubsets(
          process.env.NEXT_PUBLIC_FONT_BODY_SUBSETS || DEFAULT_TYPOGRAPHY.body.subsets.join(','),
        ),
      },
    },
    icons: {
      style:
        (process.env.NEXT_PUBLIC_ICON_STYLE as 'outline' | 'solid') || DEFAULT_ICONS.style,
      strokeWidth: safeParseInt(
        process.env.NEXT_PUBLIC_ICON_STROKE_WIDTH,
        DEFAULT_ICONS.strokeWidth,
      ),
    },
    metadata: {
      personality: process.env.NEXT_PUBLIC_BRAND_PERSONALITY as
        | 'professional'
        | 'playful'
        | 'minimal'
        | 'bold'
        | 'elegant'
        | undefined,
      category: process.env.NEXT_PUBLIC_APP_CATEGORY as
        | 'fintech'
        | 'saas'
        | 'ecommerce'
        | 'healthcare'
        | 'education'
        | 'social'
        | undefined,
    },
  };

  // Parse and validate with Zod
  const config = BrandingConfigSchema.parse(rawConfig);

  // Post-processing: Generate primaryDark if not provided
  if (!config.colors.primaryDark && isValidHexColor(config.colors.primary)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config.colors.primaryDark = generateDarkerVariant(config.colors.primary as any);
  }

  return config;
}

/**
 * Gets a subset of branding config for client-side use
 *
 * This strips out any server-only configuration and returns
 * only what's needed on the client.
 */
export function getClientBrandingConfig(): BrandingConfig {
  return getBrandingConfig();
}
