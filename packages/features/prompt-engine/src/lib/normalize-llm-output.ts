/**
 * LLM Output Normalization Utilities
 *
 * Functions to normalize LLM responses before Zod validation.
 * Handles common LLM quirks like adding "shot" suffix or using spaces instead of hyphens.
 */

/**
 * Valid shot type enum values (must match ShotTypeSchema)
 */
const VALID_SHOT_TYPES = new Set([
  'extreme-wide',
  'wide',
  'medium-wide',
  'medium',
  'medium-close-up',
  'close-up',
  'extreme-close-up',
  'two-shot',
  'three-shot',
  'group-shot',
  'over-shoulder',
  'full-body',
  'profile',
  'three-quarter',
  'low-angle',
  'high-angle',
  'dutch-angle',
  'bird-eye',
  'pov',
  'insert',
  'establishing',
  'reaction',
  'silhouette',
]);

/**
 * Common LLM variations mapped to valid enum values
 */
const SHOT_TYPE_MAPPINGS: Record<string, string> = {
  // Variations with "shot" suffix
  'medium-shot': 'medium',
  'wide-shot': 'wide',
  'close-shot': 'close-up',
  // Compound types with modifiers
  'medium-two-shot': 'two-shot',
  'medium-three-shot': 'three-shot',
  'wide-two-shot': 'two-shot',
  'wide-three-shot': 'three-shot',
  // Close-up variations
  close: 'close-up',
  closeup: 'close-up',
  'extreme-closeup': 'extreme-close-up',
  'extreme-close': 'extreme-close-up',
  // Other variations
  'over-the-shoulder': 'over-shoulder',
  'birds-eye': 'bird-eye',
  'birds-eye-view': 'bird-eye',
  'point-of-view': 'pov',
  'full-body-shot': 'full-body',
  'establishing-shot': 'establishing',
  'reaction-shot': 'reaction',
  'insert-shot': 'insert',
};

/**
 * Valid time of day enum values (must match TimeOfDaySchema)
 */
const VALID_TIME_OF_DAY = new Set([
  'dawn',
  'morning',
  'midday',
  'afternoon',
  'golden-hour',
  'dusk',
  'night',
  'day',
]);

/**
 * Common LLM time-of-day variations mapped to valid enum values
 */
const TIME_OF_DAY_MAPPINGS: Record<string, string> = {
  // Sunset variations → dusk or golden-hour
  sunset: 'golden-hour',
  'late-afternoon': 'afternoon',
  'early-morning': 'morning',
  'early-afternoon': 'afternoon',
  'late-morning': 'midday',
  evening: 'dusk',
  'early-evening': 'dusk',
  'late-evening': 'night',
  'golden hour': 'golden-hour',
  goldenhour: 'golden-hour',
  sunrise: 'dawn',
  daytime: 'day',
  nighttime: 'night',
  noon: 'midday',
  twilight: 'dusk',
  // Handle casing
  'golden-Hour': 'golden-hour',
  'Golden-hour': 'golden-hour',
};

/**
 * Normalize a time-of-day value from LLM output to valid enum value
 */
export function normalizeTimeOfDay(value: string): string {
  if (!value) return value;

  // Step 1: Normalize to lowercase, trim, convert spaces to hyphens
  const normalized = value.toLowerCase().trim().replace(/\s+/g, '-');

  // Step 2: Check mappings for known variations
  if (TIME_OF_DAY_MAPPINGS[normalized]) {
    return TIME_OF_DAY_MAPPINGS[normalized];
  }

  // Step 3: If already valid, return as-is
  if (VALID_TIME_OF_DAY.has(normalized)) {
    return normalized;
  }

  // Return normalized value even if not in enum (let Zod handle final validation)
  return normalized;
}

/**
 * Normalize a shot type value from LLM output to valid enum value
 *
 * Handles common variations:
 * - "medium shot" → "medium"
 * - "extreme close-up" → "extreme-close-up"
 * - "medium two-shot" → "two-shot"
 */
export function normalizeShotType(value: string): string {
  if (!value) return value;

  // Step 1: Normalize to lowercase, trim, convert spaces to hyphens
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/\s+shot$/i, '') // Remove trailing " shot" suffix
    .replace(/\s+/g, '-'); // Convert spaces to hyphens

  // Step 2: Check mappings for known variations
  if (SHOT_TYPE_MAPPINGS[normalized]) {
    return SHOT_TYPE_MAPPINGS[normalized];
  }

  // Step 3: If already valid, return as-is
  if (VALID_SHOT_TYPES.has(normalized)) {
    return normalized;
  }

  // Step 4: Try removing common suffixes/prefixes
  const withoutSuffix = normalized.replace(/-shot$/, '');
  if (VALID_SHOT_TYPES.has(withoutSuffix)) {
    return withoutSuffix;
  }

  // Return normalized value even if not in enum (let Zod handle final validation)
  return normalized;
}

/**
 * Timeline entry type from VEO prompt
 */
interface TimelineEntry {
  startTime: string;
  endTime: string;
  type: string;
  character?: string | null;
  content: string;
  emotion?: string;
  [key: string]: unknown;
}

/**
 * VEO prompt structure from LLM
 */
interface VeoPrompt {
  shotLine: string;
  timeline: TimelineEntry[];
  fullPrompt: string;
  negativePrompt: string;
  [key: string]: unknown;
}

/**
 * Shot structure from scene-shot-generation LLM output
 */
interface SceneShot {
  shotNumber: number;
  shotType: string;
  cameraDirection: string;
  description: string;
  characters: string[];
  duration: number;
  veoPrompt?: VeoPrompt;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Scene shot generation output structure
 */
interface SceneShotGenerationOutput {
  shots: SceneShot[];
  [key: string]: unknown;
}

/**
 * Normalize VEO prompt timeline entries
 * - Handles null character fields by providing empty string fallback
 */
function normalizeVeoPrompt(veoPrompt: VeoPrompt): VeoPrompt {
  if (!veoPrompt || !veoPrompt.timeline) return veoPrompt;

  return {
    ...veoPrompt,
    timeline: veoPrompt.timeline.map((entry) => ({
      ...entry,
      // Convert null character to empty string (for ambient/sound entries)
      character: entry.character ?? '',
    })),
  };
}

/**
 * Normalize scene-shot-generation LLM output before Zod validation
 *
 * Fixes:
 * - Shot type variations (e.g., "medium shot" → "medium")
 * - Null character fields in timeline entries
 * - Time of day variations (e.g., "sunset" → "golden-hour")
 */
export function normalizeSceneShotData(
  data: unknown,
): SceneShotGenerationOutput | unknown {
  if (typeof data !== 'object' || data === null) return data;

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.shots)) return data;

  const normalizedShots = (obj.shots as SceneShot[]).map((shot) => ({
    ...shot,
    // Normalize shot type to valid enum value
    shotType: shot.shotType ? normalizeShotType(shot.shotType) : shot.shotType,
    // Normalize VEO prompt timeline entries
    veoPrompt: shot.veoPrompt ? normalizeVeoPrompt(shot.veoPrompt) : undefined,
    // Normalize metadata.timeOfDay
    metadata: shot.metadata
      ? {
          ...shot.metadata,
          timeOfDay:
            typeof shot.metadata.timeOfDay === 'string'
              ? normalizeTimeOfDay(shot.metadata.timeOfDay)
              : shot.metadata.timeOfDay,
        }
      : shot.metadata,
  }));

  return {
    ...obj,
    shots: normalizedShots,
  };
}
