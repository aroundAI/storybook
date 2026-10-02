/**
 * Duration-based content scaling utilities
 *
 * The scaling itself (`calculateContentScaling`, `formatDuration`) lives in
 * `@kit/generation/duration-scaling`, where the generation core's checks
 * read it (FILM-1901); this module re-exports it and keeps the UI helpers.
 */
import {
  type ContentStyle,
  calculateContentScaling,
} from '@kit/generation/duration-scaling';

export {
  type ContentScalingParams,
  type ContentScalingResult,
  type ContentStyle,
  calculateContentScaling,
  formatDuration,
} from '@kit/generation/duration-scaling';

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
