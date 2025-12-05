/**
 * Design tokens for the Film Studio feature
 *
 * Provides standardized colors, status indicators, and semantic meanings
 * for generation statuses, asset types, timeline tracks, and providers.
 */

// ============================================================================
// 1. Generation Status Colors
// ============================================================================

/**
 * Status tokens for job status badges, shot overlays, and progress indicators
 */
export const statusTokens = {
  pending: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-200 dark:border-slate-700',
    icon: 'Clock',
    label: 'Pending',
  },
  queued: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    icon: 'Hourglass',
    label: 'Queued',
  },
  generating: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
    icon: 'Loader2',
    label: 'Generating',
  },
  completed: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-400',
    border: 'border-green-200 dark:border-green-800',
    icon: 'CheckCircle',
    label: 'Completed',
  },
  failed: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
    icon: 'XCircle',
    label: 'Failed',
  },
  approved: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-800',
    icon: 'BadgeCheck',
    label: 'Approved',
  },
} as const;

export type StatusType = keyof typeof statusTokens;

// ============================================================================
// 2. Asset Type Colors
// ============================================================================

/**
 * Asset type tokens for asset cards, type badges, and filters
 */
export const assetTypeTokens = {
  character: {
    bg: 'bg-pink-500',
    bgLight: 'bg-pink-100 dark:bg-pink-900/30',
    text: 'text-pink-700 dark:text-pink-400',
    icon: 'User',
    label: 'Character',
  },
  location: {
    bg: 'bg-emerald-500',
    bgLight: 'bg-emerald-100 dark:bg-emerald-900/30',
    text: 'text-emerald-700 dark:text-emerald-400',
    icon: 'MapPin',
    label: 'Location',
  },
  prop: {
    bg: 'bg-orange-500',
    bgLight: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-700 dark:text-orange-400',
    icon: 'Box',
    label: 'Prop',
  },
  voice: {
    bg: 'bg-violet-500',
    bgLight: 'bg-violet-100 dark:bg-violet-900/30',
    text: 'text-violet-700 dark:text-violet-400',
    icon: 'Mic',
    label: 'Voice',
  },
  music: {
    bg: 'bg-amber-500',
    bgLight: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
    icon: 'Music',
    label: 'Music',
  },
  sfx: {
    bg: 'bg-cyan-500',
    bgLight: 'bg-cyan-100 dark:bg-cyan-900/30',
    text: 'text-cyan-700 dark:text-cyan-400',
    icon: 'Volume2',
    label: 'Sound Effect',
  },
} as const;

export type AssetType = keyof typeof assetTypeTokens;

// ============================================================================
// 3. Timeline Track Colors
// ============================================================================

/**
 * Timeline track tokens for the multi-track timeline editor
 */
export const timelineTrackTokens = {
  video: {
    bg: 'bg-blue-600',
    bgHover: 'bg-blue-500',
    border: 'border-blue-700',
    text: 'text-white',
    label: 'Video',
  },
  dialogue: {
    bg: 'bg-green-600',
    bgHover: 'bg-green-500',
    border: 'border-green-700',
    text: 'text-white',
    label: 'Dialogue',
  },
  music: {
    bg: 'bg-purple-600',
    bgHover: 'bg-purple-500',
    border: 'border-purple-700',
    text: 'text-white',
    label: 'Music',
  },
  sfx: {
    bg: 'bg-amber-600',
    bgHover: 'bg-amber-500',
    border: 'border-amber-700',
    text: 'text-white',
    label: 'SFX',
  },
  ambient: {
    bg: 'bg-slate-600',
    bgHover: 'bg-slate-500',
    border: 'border-slate-700',
    text: 'text-white',
    label: 'Ambient',
  },
} as const;

export type TrackType = keyof typeof timelineTrackTokens;

// ============================================================================
// 4. Episode Status Workflow
// ============================================================================

/**
 * Episode status tokens for episode progress and pipeline visualization
 */
export const episodeStatusTokens = {
  draft: {
    label: 'Draft',
    color: 'slate',
    step: 0,
    description: 'Episode created, no content yet',
  },
  story: {
    label: 'Story',
    color: 'blue',
    step: 1,
    description: 'Story generated and approved',
  },
  storyboard: {
    label: 'Storyboard',
    color: 'indigo',
    step: 2,
    description: 'Shot list generated',
  },
  generating: {
    label: 'Generating',
    color: 'amber',
    step: 3,
    description: 'Videos/audio being generated',
  },
  editing: {
    label: 'Editing',
    color: 'purple',
    step: 4,
    description: 'In timeline editor',
  },
  ready: {
    label: 'Ready',
    color: 'green',
    step: 5,
    description: 'Ready for publishing',
  },
  published: {
    label: 'Published',
    color: 'emerald',
    step: 6,
    description: 'Published to platforms',
  },
} as const;

export type EpisodeStatus = keyof typeof episodeStatusTokens;

// ============================================================================
// 5. Provider Brand Colors
// ============================================================================

/**
 * Provider tokens for provider selection and connection status
 */
export const providerTokens = {
  // Video providers
  kling: {
    name: 'Kling',
    bg: 'bg-indigo-600',
    icon: 'Video',
  },
  runway: {
    name: 'Runway',
    bg: 'bg-violet-600',
    icon: 'Film',
  },
  hailuo: {
    name: 'Hailuo',
    bg: 'bg-sky-600',
    icon: 'Clapperboard',
  },
  // Audio providers
  elevenlabs: {
    name: 'ElevenLabs',
    bg: 'bg-emerald-600',
    icon: 'AudioLines',
  },
  playht: {
    name: 'PlayHT',
    bg: 'bg-teal-600',
    icon: 'Mic2',
  },
  suno: {
    name: 'Suno',
    bg: 'bg-orange-600',
    icon: 'Music4',
  },
  udio: {
    name: 'Udio',
    bg: 'bg-rose-600',
    icon: 'Music2',
  },
  // Platforms
  youtube: {
    name: 'YouTube',
    bg: 'bg-red-600',
    icon: 'Youtube',
  },
  tiktok: {
    name: 'TikTok',
    bg: 'bg-black dark:bg-white',
    icon: 'Music2',
  },
  instagram: {
    name: 'Instagram',
    bg: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500',
    icon: 'Instagram',
  },
  facebook: {
    name: 'Facebook',
    bg: 'bg-blue-600',
    icon: 'Facebook',
  },
} as const;

export type ProviderType = keyof typeof providerTokens;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get status token with type safety
 */
export function getStatusToken(status: StatusType) {
  return statusTokens[status];
}

/**
 * Compose Tailwind classes for status styling
 */
export function getStatusClasses(status: StatusType): string {
  const token = statusTokens[status];
  return `${token.bg} ${token.text} ${token.border}`;
}

/**
 * Get asset type badge styling information
 */
export function getAssetTypeBadge(type: AssetType) {
  const token = assetTypeTokens[type];
  return {
    className: `${token.bgLight} ${token.text}`,
    icon: token.icon,
    label: token.label,
  };
}

/**
 * Get timeline track styling information
 */
export function getTrackClasses(type: TrackType): string {
  const token = timelineTrackTokens[type];
  return `${token.bg} ${token.text} ${token.border}`;
}

/**
 * Get episode status information
 */
export function getEpisodeStatus(status: EpisodeStatus) {
  return episodeStatusTokens[status];
}

/**
 * Get provider information by type
 */
export function getProviderInfo(provider: ProviderType) {
  return providerTokens[provider];
}

/**
 * Check if status is in a terminal state (completed, failed, or approved)
 */
export function isTerminalStatus(status: StatusType): boolean {
  return status === 'completed' || status === 'failed' || status === 'approved';
}

/**
 * Check if status is in an active/processing state
 */
export function isActiveStatus(status: StatusType): boolean {
  return status === 'queued' || status === 'generating';
}

/**
 * Get the next episode status in the workflow
 */
export function getNextEpisodeStatus(
  currentStatus: EpisodeStatus,
): EpisodeStatus | null {
  const currentStep = episodeStatusTokens[currentStatus].step;
  const nextStep = currentStep + 1;

  const nextStatus = Object.entries(episodeStatusTokens).find(
    ([, value]) => value.step === nextStep,
  );

  return nextStatus ? (nextStatus[0] as EpisodeStatus) : null;
}

/**
 * Get all statuses as an array for iteration
 */
export function getAllStatuses(): StatusType[] {
  return Object.keys(statusTokens) as StatusType[];
}

/**
 * Get all asset types as an array for iteration
 */
export function getAllAssetTypes(): AssetType[] {
  return Object.keys(assetTypeTokens) as AssetType[];
}

/**
 * Get all track types as an array for iteration
 */
export function getAllTrackTypes(): TrackType[] {
  return Object.keys(timelineTrackTokens) as TrackType[];
}

/**
 * Get all episode statuses as an array for iteration
 */
export function getAllEpisodeStatuses(): EpisodeStatus[] {
  return Object.keys(episodeStatusTokens) as EpisodeStatus[];
}

/**
 * Get all providers as an array for iteration
 */
export function getAllProviders(): ProviderType[] {
  return Object.keys(providerTokens) as ProviderType[];
}

/**
 * Get video providers only
 */
export function getVideoProviders(): ProviderType[] {
  return ['kling', 'runway', 'hailuo'];
}

/**
 * Get audio providers only
 */
export function getAudioProviders(): ProviderType[] {
  return ['elevenlabs', 'playht', 'suno', 'udio'];
}

/**
 * Get platform providers only
 */
export function getPlatformProviders(): ProviderType[] {
  return ['youtube', 'tiktok', 'instagram', 'facebook'];
}
