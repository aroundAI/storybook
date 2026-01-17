/**
 * Duration-based content scaling utilities for Lambda handlers
 * 
 * Copied from @kit/episodes/lib/duration-scaling.ts to avoid server-only import issues
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
 */
export function calculateContentScaling(
    params: ContentScalingParams,
): ContentScalingResult {
    const { targetDurationSeconds, contentStyle } = params;
    const durationMinutes = targetDurationSeconds / 60;

    // Get style multiplier
    const multiplier = STYLE_MULTIPLIERS[contentStyle];

    // === Story Word Count ===
    const baseWordCount = Math.round(durationMinutes * BASE_RATES.wordsPerMinute);
    const storyWordCountMin = Math.max(100, Math.round(baseWordCount * 0.8));
    const storyWordCountMax = Math.round(baseWordCount * 1.2);

    // === Scene Count ===
    const avgSceneDuration =
        durationMinutes <= 5
            ? BASE_RATES.avgSceneDurationShort
            : BASE_RATES.avgSceneDurationLong;
    const baseSceneCount = Math.round(targetDurationSeconds / avgSceneDuration);
    const sceneCountMin = Math.max(2, Math.round(baseSceneCount * 0.8));
    const sceneCountMax = Math.round(baseSceneCount * 1.2);

    // === Dialogue Lines ===
    const dialogueLinesPerMinute =
        BASE_RATES.dialogueLinesPerMinute * multiplier.dialogue;
    const baseTotalDialogueLines = Math.round(
        durationMinutes * dialogueLinesPerMinute,
    );

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
