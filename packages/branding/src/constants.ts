/**
 * Branding Constants
 *
 * Default values, color palettes, and constants for the branding system.
 */

import type {
  AppCategory,
  BrandPersonality,
  HexColor,
} from './types';

/**
 * Default Colors
 */
export const DEFAULT_COLORS = {
  primary: '#0066cc' as HexColor,
  primaryDark: '#0052a3' as HexColor,
  secondary: '#00cc66' as HexColor,
  accent: '#ff6b00' as HexColor,
  bgLight: '#ffffff' as HexColor,
  bgDark: '#0a0a0a' as HexColor,
  textLight: '#1a1a1a' as HexColor,
  textDark: '#ffffff' as HexColor,
} as const;

/**
 * Default Logo Configuration
 */
export const DEFAULT_LOGO = {
  type: 'text' as const,
  text: 'App',
  font: 'Inter',
  fontWeight: 700,
  textColorLight: '#1a1a1a' as HexColor,
  textColorDark: '#ffffff' as HexColor,
  width: 120,
  height: 40,
} as const;

/**
 * Default Typography Configuration
 */
export const DEFAULT_TYPOGRAPHY = {
  heading: {
    font: 'Inter',
    weights: [600, 700, 800],
    subsets: ['latin'],
  },
  body: {
    font: 'Inter',
    weights: [400, 500, 600],
    subsets: ['latin'],
  },
} as const;

/**
 * Default Icon Configuration
 */
export const DEFAULT_ICONS = {
  style: 'outline' as const,
  strokeWidth: 2,
} as const;

/**
 * Color Palettes by App Category
 *
 * Pre-defined color schemes for different app categories.
 * Used by AI to suggest appropriate branding.
 */
export const CATEGORY_COLOR_PALETTES: Record<
  AppCategory,
  {
    primary: HexColor;
    secondary: HexColor;
    accent: HexColor;
    description: string;
  }
> = {
  fintech: {
    primary: '#0066cc',
    secondary: '#00cc66',
    accent: '#FFD700',
    description: 'Blue for trust, green for growth, gold for value',
  },
  saas: {
    primary: '#6366f1',
    secondary: '#06b6d4',
    accent: '#f97316',
    description: 'Purple for innovation, cyan for technology, orange for action',
  },
  ecommerce: {
    primary: '#dc2626',
    secondary: '#14b8a6',
    accent: '#fbbf24',
    description: 'Red for urgency, teal for quality, yellow for attention',
  },
  healthcare: {
    primary: '#0891b2',
    secondary: '#10b981',
    accent: '#8b5cf6',
    description: 'Cyan for health, green for healing, purple for care',
  },
  education: {
    primary: '#4f46e5',
    secondary: '#f59e0b',
    accent: '#ec4899',
    description: 'Indigo for knowledge, amber for energy, pink for creativity',
  },
  social: {
    primary: '#ec4899',
    secondary: '#8b5cf6',
    accent: '#06b6d4',
    description: 'Pink for connection, purple for creativity, cyan for communication',
  },
};

/**
 * Font Recommendations by Brand Personality
 *
 * Suggested font pairings based on brand personality.
 */
export const PERSONALITY_FONT_PAIRS: Record<
  BrandPersonality,
  {
    heading: string;
    body: string;
    description: string;
  }
> = {
  professional: {
    heading: 'Inter',
    body: 'Inter',
    description: 'Clean, trustworthy, modern',
  },
  playful: {
    heading: 'Quicksand',
    body: 'Inter',
    description: 'Friendly, approachable, fun',
  },
  minimal: {
    heading: 'Inter',
    body: 'Inter',
    description: 'Clean, minimalist, focused',
  },
  bold: {
    heading: 'Montserrat',
    body: 'Inter',
    description: 'Strong, confident, direct',
  },
  elegant: {
    heading: 'Playfair Display',
    body: 'Inter',
    description: 'Sophisticated, premium, refined',
  },
};

/**
 * Supported Google Fonts
 *
 * Fonts that are pre-configured and can be loaded dynamically.
 * Add more fonts as needed.
 */
export const SUPPORTED_FONTS = [
  'Inter',
  'Poppins',
  'Montserrat',
  'Quicksand',
  'Nunito',
  'Playfair Display',
  'Lora',
  'DM Sans',
  'Open Sans',
  'Raleway',
  'Roboto',
  'Source Sans Pro',
  'Merriweather',
  'Cormorant',
  'JetBrains Mono',
] as const;

/**
 * Font Weight Names to Values
 */
export const FONT_WEIGHT_MAP = {
  thin: 100,
  extralight: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

/**
 * Gradient Presets
 *
 * Pre-defined gradient configurations for quick logo styling.
 * Each preset defines colors, type, and direction for consistent branding.
 */
export const GRADIENT_PRESETS = {
  sunset: {
    colors: ['#FF6B6B', '#FFE66D', '#FF6B6B'] as HexColor[],
    type: 'linear' as const,
    direction: 'to right',
    description: 'Warm sunset gradient - red to yellow',
  },
  ocean: {
    colors: ['#00B4DB', '#0083B0'] as HexColor[],
    type: 'linear' as const,
    direction: 'to right',
    description: 'Cool ocean blue gradient',
  },
  neon: {
    colors: ['#00F5FF', '#FF00FF', '#00F5FF'] as HexColor[],
    type: 'linear' as const,
    direction: 'to right',
    description: 'Vibrant neon cyan to magenta',
  },
  forest: {
    colors: ['#134E5E', '#71B280'] as HexColor[],
    type: 'linear' as const,
    direction: 'to right',
    description: 'Natural forest green gradient',
  },
  fire: {
    colors: ['#FF512F', '#F09819'] as HexColor[],
    type: 'linear' as const,
    direction: 'to right',
    description: 'Fiery red to orange gradient',
  },
  'purple-blue': {
    colors: ['#667eea', '#764ba2'] as HexColor[],
    type: 'linear' as const,
    direction: 'to right',
    description: 'Professional purple to blue gradient (like MakerKit)',
  },
} as const;

/**
 * Glow Intensity Presets
 *
 * Pre-defined text shadow configurations for glow effects.
 * Values represent the blur radius and spread for different intensity levels.
 */
export const GLOW_INTENSITY_PRESETS = {
  subtle: {
    shadows: ['0 0 10px'],
    description: 'Subtle glow - single soft shadow',
  },
  medium: {
    shadows: ['0 0 20px', '0 0 30px'],
    description: 'Medium glow - dual layered shadows',
  },
  strong: {
    shadows: ['0 0 30px', '0 0 40px', '0 0 50px'],
    description: 'Strong glow - triple layered shadows',
  },
  neon: {
    shadows: ['0 0 10px', '0 0 20px', '0 0 30px', '0 0 40px', '0 0 70px'],
    description: 'Intense neon glow - multi-layered effect',
  },
} as const;
