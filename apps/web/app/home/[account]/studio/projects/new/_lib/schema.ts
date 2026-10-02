import { z } from 'zod';

import { StudioProjectSettingsSchema } from '@kit/film-studio-schemas/project';

// Film Studio project creation schema
// Combines basic project fields with studio-specific settings
export const CreateFilmProjectSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(255, 'Project name must be 255 characters or less'),
  description: z
    .string()
    .max(1000, 'Description must be 1000 characters or less')
    .optional(),
  settings: StudioProjectSettingsSchema,
});

export type CreateFilmProjectInput = z.infer<typeof CreateFilmProjectSchema>;

// Platform configuration for smart defaults: the target platforms a new
// project offers. LinkedIn is retired (FILM-717); a project that already
// targets it keeps the value, which the settings schema still accepts.
export const PLATFORM_CONFIGS = {
  youtube: {
    label: 'YouTube',
    icon: 'youtube',
    defaultAspectRatio: '16:9',
    defaultDuration: 5,
  },
  tiktok: {
    label: 'TikTok',
    icon: 'tiktok',
    defaultAspectRatio: '9:16',
    defaultDuration: 3,
  },
  instagram: {
    label: 'Instagram',
    icon: 'instagram',
    defaultAspectRatio: '1:1',
    defaultDuration: 5,
  },
  facebook: {
    label: 'Facebook',
    icon: 'facebook',
    defaultAspectRatio: '1:1',
    defaultDuration: 5,
  },
  twitter: {
    label: 'Twitter/X',
    icon: 'twitter',
    defaultAspectRatio: '16:9',
    defaultDuration: 5,
  },
  custom: {
    label: 'Custom',
    icon: 'settings',
    defaultAspectRatio: '16:9',
    defaultDuration: 5,
  },
} as const;

// Get smart defaults based on selected platforms
export function getSmartDefaults(platforms: string[]): {
  defaultAspectRatio: string;
  defaultDuration: number;
} {
  // Priority order: TikTok > Instagram > YouTube > others
  if (platforms.includes('tiktok')) {
    return { defaultAspectRatio: '9:16', defaultDuration: 3 };
  }
  if (platforms.includes('instagram')) {
    return { defaultAspectRatio: '1:1', defaultDuration: 5 };
  }
  if (platforms.includes('youtube')) {
    return { defaultAspectRatio: '16:9', defaultDuration: 5 };
  }
  // Default fallback
  return { defaultAspectRatio: '16:9', defaultDuration: 5 };
}
