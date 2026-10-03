/**
 * Duration-based content scaling utilities
 *
 * Calculates appropriate content requirements (word count, scene count,
 * dialogue lines, shots) based on target episode duration.
 *
 * Supports content from 1 minute to 120 minutes (2-hour feature film).
 */

/**
 * Content style affects dialogue density and pacing
 */
export type ContentStyle = 'dialogue-heavy' | 'action-heavy' | 'balanced';

/**
 * Input parameters for content scaling calculation
 */
export interface ContentScalingParams {
  /** Target episode duration in seconds (60-7200) */
  targetDurationSeconds: number;
  /** Content style affects dialogue density */
  contentStyle: ContentStyle;
  /** Optional genre for future genre-specific adjustments */
  genre?: string;
}

/**
 * Calculated content requirements based on duration
 */
export interface ContentScalingResult {
  /** Story generation requirements */
  story: {
    /** Minimum word count for story */
    wordCountMin: number;
    /** Maximum word count for story */
    wordCountMax: number;
  };

  /** Screenplay conversion requirements */
  screenplay: {
    /** Minimum scene count */
    sceneCountMin: number;
    /** Maximum scene count */
    sceneCountMax: number;
    /** Minimum dialogue lines per scene */
    dialogueLinesPerSceneMin: number;
    /** Maximum dialogue lines per scene */
    dialogueLinesPerSceneMax: number;
    /** Total minimum dialogue lines */
    totalDialogueLinesMin: number;
    /** Total maximum dialogue lines */
    totalDialogueLinesMax: number;
  };

  /** Shot list generation requirements */
  shots: {
    /** Minimum total shots */
    totalShotsMin: number;
    /** Maximum total shots */
    totalShotsMax: number;
    /** Minimum shots per scene */
    shotsPerSceneMin: number;
    /** Maximum shots per scene */
    shotsPerSceneMax: number;
  };
}

/**
 * Style multipliers for content density
 */
const STYLE_MULTIPLIERS: Record<
  ContentStyle,
  { dialogue: number; action: number }
> = {
  'dialogue-heavy': { dialogue: 1.5, action: 0.7 },
  'action-heavy': { dialogue: 0.5, action: 1.5 },
  balanced: { dialogue: 1.0, action: 1.0 },
};

/**
 * Base rates for content generation (industry standards)
 */
const BASE_RATES = {
  /** Words per minute of screen time */
  wordsPerMinute: 150,
  /** Base dialogue lines per minute for balanced content */
  dialogueLinesPerMinute: 5.5,
  /** Average scene duration in seconds */
  avgSceneDurationShort: 45, // For content <= 5 minutes
  avgSceneDurationLong: 40, // For content > 5 minutes
  /** Average shot duration in seconds */
  avgShotDuration: 7,
};

/**
 * Calculate content requirements based on target duration
 *
 * This function implements scaling logic for the entire content pipeline:
 * - Story word count scales with duration
 * - Scene count scales with duration
 * - Dialogue lines scale with duration and style
 * - Shot count scales with duration
 *
 * @example
 * ```typescript
 * // 5-minute cartoon (dialogue-heavy)
 * const scaling = calculateContentScaling({
 *   targetDurationSeconds: 300,
 *   contentStyle: 'dialogue-heavy',
 * });
 * // Returns: ~750 words, ~7 scenes, ~40 dialogue lines, ~43 shots
 *
 * // 2-hour feature film (balanced)
 * const scaling = calculateContentScaling({
 *   targetDurationSeconds: 7200,
 *   contentStyle: 'balanced',
 * });
 * // Returns: ~18000 words, ~180 scenes, ~660 dialogue lines, ~1028 shots
 * ```
 */
export function calculateContentScaling(
  params: ContentScalingParams,
): ContentScalingResult {
  const { targetDurationSeconds, contentStyle } = params;
  const durationMinutes = targetDurationSeconds / 60;

  // Get style multiplier
  const multiplier = STYLE_MULTIPLIERS[contentStyle];

  // === Story Word Count ===
  // ~150 words per minute of screen time
  // Min/max provides 20% variance for creative flexibility
  const baseWordCount = Math.round(durationMinutes * BASE_RATES.wordsPerMinute);
  const storyWordCountMin = Math.max(100, Math.round(baseWordCount * 0.8));
  const storyWordCountMax = Math.round(baseWordCount * 1.2);

  // === Scene Count ===
  // Short content (1-5 min): fewer scenes, longer each (~45s avg)
  // Long content (>5 min): more scenes, moderate length (~40s avg)
  const avgSceneDuration =
    durationMinutes <= 5
      ? BASE_RATES.avgSceneDurationShort
      : BASE_RATES.avgSceneDurationLong;
  const baseSceneCount = Math.round(targetDurationSeconds / avgSceneDuration);
  const sceneCountMin = Math.max(2, Math.round(baseSceneCount * 0.8));
  const sceneCountMax = Math.round(baseSceneCount * 1.2);

  // === Dialogue Lines ===
  // Base: 5.5 lines per minute for balanced content
  // Dialogue-heavy (kids' cartoons): 1.5x = ~8.25 lines/min = 30-50 for 5 min
  // Action-heavy: 0.5x = ~2.75 lines/min
  const dialogueLinesPerMinute =
    BASE_RATES.dialogueLinesPerMinute * multiplier.dialogue;
  const baseTotalDialogueLines = Math.round(
    durationMinutes * dialogueLinesPerMinute,
  );

  // Calculate average scene count for per-scene calculations
  const avgSceneCount = (sceneCountMin + sceneCountMax) / 2;
  const avgDialogueLinesPerScene = Math.round(
    baseTotalDialogueLines / avgSceneCount,
  );

  const dialogueLinesPerSceneMin = Math.max(
    1,
    Math.round(avgDialogueLinesPerScene * 0.6),
  );
  const dialogueLinesPerSceneMax = Math.max(
    2,
    Math.round(avgDialogueLinesPerScene * 1.4),
  );

  const totalDialogueLinesMin = Math.max(
    3,
    Math.round(baseTotalDialogueLines * 0.8),
  );
  const totalDialogueLinesMax = Math.round(baseTotalDialogueLines * 1.2);

  // === Shot Count ===
  // ~7 seconds per shot on average (AI video constraint: 3-10s per shot)
  const baseTotalShots = Math.round(
    targetDurationSeconds / BASE_RATES.avgShotDuration,
  );
  const totalShotsMin = Math.max(3, Math.round(baseTotalShots * 0.8));
  const totalShotsMax = Math.round(baseTotalShots * 1.2);

  const avgShotsPerScene = Math.round(baseTotalShots / avgSceneCount);
  const shotsPerSceneMin = Math.max(2, Math.round(avgShotsPerScene * 0.7));
  const shotsPerSceneMax = Math.max(3, Math.round(avgShotsPerScene * 1.3));

  return {
    story: {
      wordCountMin: storyWordCountMin,
      wordCountMax: storyWordCountMax,
    },
    screenplay: {
      sceneCountMin,
      sceneCountMax,
      dialogueLinesPerSceneMin,
      dialogueLinesPerSceneMax,
      totalDialogueLinesMin,
      totalDialogueLinesMax,
    },
    shots: {
      totalShotsMin,
      totalShotsMax,
      shotsPerSceneMin,
      shotsPerSceneMax,
    },
  };
}

/**
 * Duration presets for UI selection
 */
export const DURATION_PRESETS = [
  { label: '1 minute', value: 60, description: 'Ultra-short (TikTok/Reels)' },
  { label: '2 minutes', value: 120, description: 'Short clip' },
  { label: '5 minutes', value: 300, description: 'Standard short' },
  { label: '10 minutes', value: 600, description: 'Medium short' },
  { label: '15 minutes', value: 900, description: 'Extended short' },
  { label: '30 minutes', value: 1800, description: 'TV episode (half-hour)' },
  { label: '45 minutes', value: 2700, description: 'TV episode (drama)' },
  { label: '1 hour', value: 3600, description: 'Feature short' },
  { label: '90 minutes', value: 5400, description: 'Standard feature' },
  { label: '2 hours', value: 7200, description: 'Full feature film' },
] as const;

/**
 * Get human-readable duration string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} min`;
}

/**
 * Get scaling preview text for UI display
 */
export function getScalingPreview(
  targetDurationSeconds: number,
  contentStyle: ContentStyle = 'dialogue-heavy',
): string {
  const scaling = calculateContentScaling({
    targetDurationSeconds,
    contentStyle,
  });

  const avgDialogue = Math.round(
    (scaling.screenplay.totalDialogueLinesMin +
      scaling.screenplay.totalDialogueLinesMax) /
      2,
  );
  const avgScenes = Math.round(
    (scaling.screenplay.sceneCountMin + scaling.screenplay.sceneCountMax) / 2,
  );
  const avgWords = Math.round(
    (scaling.story.wordCountMin + scaling.story.wordCountMax) / 2,
  );

  return `~${avgDialogue} dialogue lines, ~${avgScenes} scenes, ~${avgWords} words`;
}
