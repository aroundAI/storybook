import { sanitizeForPrompt } from './sanitize-for-prompt';

interface NeighbouringEpisode {
  number: number;
  title: string;
  premise: string;
  mainPlot: string;
  characterFocus?: string[];
  arcPosition: string;
}

/**
 * The outlines around an episode being regenerated, and the user's note, as
 * prompt context (KB-121). Empty when there are neither, so a full-season
 * outline is prompted as before. Every field is the user's text, so each is
 * sanitised.
 */
export function formatNeighbouringEpisodes(
  episodes: NeighbouringEpisode[] = [],
  additionalContext?: string,
): string {
  const lines = [...episodes]
    .sort((a, b) => a.number - b.number)
    .map((episode) => {
      const focus = episode.characterFocus?.length
        ? ` Focus: ${episode.characterFocus.map(sanitizeForPrompt).join(', ')}.`
        : '';

      return `- Episode ${episode.number} (${sanitizeForPrompt(episode.arcPosition)}): "${sanitizeForPrompt(episode.title)}". ${sanitizeForPrompt(episode.premise)} ${sanitizeForPrompt(episode.mainPlot)}${focus}`;
    });

  const sections = [];

  if (lines.length > 0) {
    sections.push(
      `## NEIGHBOURING EPISODES (keep continuity with these; do not repeat them)\n${lines.join('\n')}`,
    );
  }

  if (additionalContext?.trim()) {
    sections.push(
      `## NOTE FROM THE WRITER\n${sanitizeForPrompt(additionalContext.trim())}`,
    );
  }

  return sections.join('\n\n');
}
