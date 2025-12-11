import type { ScreenplayData, StoryData } from '../types';

/**
 * Formats screenplay data for the LLM prompt
 * Converts structured screenplay data into a screenplay-formatted text
 */
export function formatScreenplayForPrompt(
  screenplayData: ScreenplayData,
): string {
  let text = '';

  if (screenplayData.scenes) {
    for (const scene of screenplayData.scenes) {
      // Scene heading
      const timeOfDay = scene.timeOfDay?.toUpperCase() ?? 'DAY';
      text += `INT./EXT. ${scene.location.toUpperCase()} - ${timeOfDay}\n\n`;
      text += `${scene.description}\n\n`;

      // Include dialogue from this scene
      if (scene.dialogue && scene.dialogue.length > 0) {
        for (const d of scene.dialogue) {
          text += `${d.character.toUpperCase()}\n`;
          if (d.parenthetical) {
            text += `(${d.parenthetical})\n`;
          }
          text += `${d.text}\n\n`;
        }
      }
    }
  }

  return text.trim();
}

/**
 * Formats story data for the LLM prompt (fallback when no screenplay)
 * Converts structured story data into a prompt-friendly text
 */
export function formatStoryForPrompt(storyData: StoryData): string {
  let text = '';

  if (storyData.premise) {
    text += `PREMISE:\n${storyData.premise}\n\n`;
  }

  if (storyData.fullStory) {
    text += `STORY:\n${storyData.fullStory}\n`;
  }

  return text.trim();
}
