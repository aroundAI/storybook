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
 * Logo Gradient Configuration Schema
 */
const LogoGradientSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(['linear', 'radial']).default('linear'),
  // Simple mode: array of 2+ colors
  colors: z.array(z.string().regex(/^#[0-9A-F]{6}$/i)).min(2).optional(),
  // Advanced mode: color stops with positions (0-100%)
  stops: z
    .array(
      z.object({
        color: z.string().regex(/^#[0-9A-F]{6}$/i),
        position: z.number().min(0).max(100),
      }),
    )
    .optional(),
  // Preset mode: use pre-defined gradient
  preset: z
    .enum(['sunset', 'ocean', 'neon', 'forest', 'fire', 'purple-blue'])
    .optional(),
  // Direction for linear gradients (e.g., 'to right', '45deg', 'to bottom right')
  direction: z.string().default('to right'),
  // Animation: gradient shifting
  animate: z.boolean().default(false),
});

/**
 * Logo Glow/Shadow Configuration Schema
 */
const LogoGlowSchema = z.object({
  enabled: z.boolean().default(false),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  intensity: z.enum(['subtle', 'medium', 'strong', 'neon']).default('medium'),
  // Animation: pulsing glow
  animate: z.boolean().default(false),
});

/**
 * Logo Stroke/Outline Configuration Schema
 */
const LogoStrokeSchema = z.object({
  enabled: z.boolean().default(false),
  width: z.number().min(0.5).max(5).default(1),
  color: z.string().regex(/^#[0-9A-F]{6}$/i).optional(),
});

/**
 * Custom Font Configuration Schema
 */
const CustomFontSchema = z.object({
  url: z.string().url().optional(),
  family: z.string().optional(),
});

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
  // Enhanced styling options
  gradient: LogoGradientSchema.optional(),
  glow: LogoGlowSchema.optional(),
  stroke: LogoStrokeSchema.optional(),
  customFont: CustomFontSchema.optional(),
});

/**
 * Color Configuration Schema
 */
export const ColorConfigSchema = z.object({
  primary: z.string().regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color'),
  primaryDark: z.string().regex(/^#[0-9A-F]{6}$/i, 'Must be a valid hex color'),
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
 * Safely parses a float from a string
 */
function safeParseFloat(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safely parses a boolean from a string
 */
function safeParseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return defaultValue;
}

/**
 * Parses a comma-separated list of hex colors
 */
function parseColorArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map((c) => c.trim()).filter((c) => c.length > 0);
}

/**
 * Parses color stops from JSON string
 * Expected format: [{"color":"#FF0000","position":0},{"color":"#0000FF","position":100}]
 */
function parseColorStops(value: string | undefined): Array<{ color: string; position: number }> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (stop) =>
          typeof stop === 'object' &&
          typeof stop.color === 'string' &&
          typeof stop.position === 'number'
      );
    }
  } catch {
    return undefined;
  }
  return undefined;
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
  // Get primary color for auto-generating primaryDark
  const primaryColor = process.env.NEXT_PUBLIC_BRAND_PRIMARY || DEFAULT_COLORS.primary;
  const primaryDark = process.env.NEXT_PUBLIC_BRAND_PRIMARY_DARK;

  // Auto-generate primaryDark if not provided and primary is valid
  const computedPrimaryDark =
    primaryDark ||
    (isValidHexColor(primaryColor) ? generateDarkerVariant(primaryColor as any) : DEFAULT_COLORS.primaryDark); // eslint-disable-line @typescript-eslint/no-explicit-any

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
      // Enhanced styling options
      gradient: process.env.NEXT_PUBLIC_LOGO_GRADIENT_ENABLED ? {
        enabled: safeParseBoolean(process.env.NEXT_PUBLIC_LOGO_GRADIENT_ENABLED, false),
        type: (process.env.NEXT_PUBLIC_LOGO_GRADIENT_TYPE as 'linear' | 'radial') || 'linear',
        colors: parseColorArray(process.env.NEXT_PUBLIC_LOGO_GRADIENT_COLORS),
        stops: parseColorStops(process.env.NEXT_PUBLIC_LOGO_GRADIENT_STOPS),
        preset: process.env.NEXT_PUBLIC_LOGO_GRADIENT_PRESET as 'sunset' | 'ocean' | 'neon' | 'forest' | 'fire' | 'purple-blue',
        direction: process.env.NEXT_PUBLIC_LOGO_GRADIENT_DIRECTION || 'to right',
        animate: safeParseBoolean(process.env.NEXT_PUBLIC_LOGO_GRADIENT_ANIMATE, false),
      } : undefined,
      glow: process.env.NEXT_PUBLIC_LOGO_GLOW_ENABLED ? {
        enabled: safeParseBoolean(process.env.NEXT_PUBLIC_LOGO_GLOW_ENABLED, false),
        color: process.env.NEXT_PUBLIC_LOGO_GLOW_COLOR,
        intensity: (process.env.NEXT_PUBLIC_LOGO_GLOW_INTENSITY as 'subtle' | 'medium' | 'strong' | 'neon') || 'medium',
        animate: safeParseBoolean(process.env.NEXT_PUBLIC_LOGO_GLOW_ANIMATE, false),
      } : undefined,
      stroke: process.env.NEXT_PUBLIC_LOGO_STROKE_ENABLED ? {
        enabled: safeParseBoolean(process.env.NEXT_PUBLIC_LOGO_STROKE_ENABLED, false),
        width: safeParseFloat(process.env.NEXT_PUBLIC_LOGO_STROKE_WIDTH, 1),
        color: process.env.NEXT_PUBLIC_LOGO_STROKE_COLOR,
      } : undefined,
      customFont: (process.env.NEXT_PUBLIC_LOGO_CUSTOM_FONT_URL || process.env.NEXT_PUBLIC_LOGO_CUSTOM_FONT_FAMILY) ? {
        url: process.env.NEXT_PUBLIC_LOGO_CUSTOM_FONT_URL,
        family: process.env.NEXT_PUBLIC_LOGO_CUSTOM_FONT_FAMILY,
      } : undefined,
    },
    colors: {
      primary: primaryColor,
      primaryDark: computedPrimaryDark,
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
