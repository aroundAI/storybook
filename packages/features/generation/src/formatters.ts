/**
 * Prompt text the stages build from project rows they read themselves.
 * The episode-level formatters (characters, locations, previous episodes)
 * stay with the worker's context builder and reach a stage through
 * `Ctx.episodeContext`; what is here needs no episode.
 */
import { sanitizeForPrompt } from '@kit/shared/prompt-sanitiser';

export interface RecurringElement {
  id: string;
  name: string;
  enabled: boolean;
  location?: string;
  purpose?: string;
  placement?: 'beginning' | 'middle' | 'end' | 'throughout';
  dialogueHints?: string;
}

/**
 * Format recurring elements for prompt injection.
 * Fully dynamic — no hardcoded values. Every word comes from project settings.
 * Placement-aware: generates distinct instruction text for beginning/middle/end/throughout.
 */
export function formatRecurringElementsForPrompt(
  recurringElements: RecurringElement[] | undefined,
): string {
  if (!recurringElements || recurringElements.length === 0) return '';

  const placementInstruction: Record<string, string> = {
    beginning: 'at the START of the episode — before the main story hook',
    middle: 'at a natural midpoint of the episode',
    end: 'as the FINAL moment of the episode — nothing follows it',
    throughout:
      'at multiple natural points distributed across the entire episode',
  };

  const elementBlocks = recurringElements.map((el, i) => {
    const placement = (el.placement ?? 'end').toLowerCase();
    const when =
      placementInstruction[placement] ??
      `at the ${el.placement} of the episode`;

    const lines: string[] = [
      `### Element ${i + 1}: "${el.name}" (Placement: ${el.placement ?? 'End'})`,
      '',
      `This element MUST appear ${when}.`,
      '',
    ];

    if (el.location) {
      lines.push(`**Location / Context**: ${el.location}`);
      lines.push(
        'If the story is already in this location at the placement point, embed the element naturally.',
        'If not, transition to this location at the appropriate time.',
        '',
      );
    }

    if (el.purpose) {
      lines.push(`**What must happen**: ${el.purpose}`);
      lines.push('');
    }

    if (el.dialogueHints) {
      lines.push(
        '**Character voice & tone reference** (study the patterns below to understand HOW these characters think, speak, and emote — then generate COMPLETELY ORIGINAL dialogue that captures the same cadence, vocabulary level, and emotional texture):',
        '',
        el.dialogueHints,
        '',
        '⚠️ The above are CHARACTER VOICE REFERENCES, not templates. ' +
          'NEVER reproduce or closely paraphrase any specific line from these references. ' +
          'Instead, internalize the speech patterns, emotional register, ' +
          'and personality traits demonstrated across ALL examples, ' +
          "then write fresh dialogue that sounds authentically like these characters in THIS episode's unique situation.",
      );
      lines.push('');
    }

    return lines.join('\n');
  });

  return [
    '---',
    '## RECURRING STORY ELEMENTS — ALL REQUIRED',
    '',
    ...elementBlocks,
    '---',
  ].join('\n');
}

/** The recurring elements a project's metadata holds, or none. */
export function recurringElementsOf(
  projectMetadata: Record<string, unknown>,
): RecurringElement[] {
  return Array.isArray(projectMetadata.recurringElements)
    ? (projectMetadata.recurringElements as RecurringElement[])
    : [];
}

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

/**
 * Premise Tier System
 *
 * Classifies the premise by length and returns tier-specific instructions
 * telling the LLM how detailed the output loglines should be.
 *
 * - Seed (≤250 chars): Short concept — concise loglines
 * - Developed (251-700 chars): Fleshed-out concept — expanded 2-3 sentence loglines
 * - Rich (701+ chars): Detailed narrative — full 4-6 sentence loglines preserving specifics
 */
export function premiseDepthInstructions(premise: string): string {
  const len = premise.length;

  if (len <= 250) {
    return '';
  }

  if (len <= 700) {
    return `LOGLINE DEPTH REQUIREMENT: The premise above contains developed themes and character motivations. Each variation's logline MUST be 2-3 sentences (200-400 characters). Preserve the core thematic argument from the premise while exploring a different narrative angle. Do NOT compress the premise's ideas into a single generic sentence.`;
  }

  return `LOGLINE DEPTH REQUIREMENT: The premise above is a richly detailed narrative concept. Each variation's logline MUST be 4-6 sentences (500-800 characters). You MUST preserve: (1) The specific details and mechanisms described in the premise (e.g., trade systems, historical specifics, scientific concepts), (2) The thematic argument and "so what" of the story, (3) Character motivations and their relationship to the subject matter. Do NOT compress—reinterpret the SAME depth from a different narrative angle. Each variation should feel as fleshed-out as the original premise, not a summary of it.`;
}

export interface SeasonFact {
  id?: string;
  claim: string;
  source_citation?: string | null;
  category?: string | null;
}

/**
 * Verified facts for a season prompt, one `FACT [id]` line each, with the
 * instruction that every one is placed in an episode. The season_outline
 * and season_analysis stages render the same block; the caller sanitises
 * the facts first (KB-101).
 */
export function formatFactsForSeasonPrompt(facts: SeasonFact[]): string {
  if (facts.length === 0) return '';

  const factLines = facts
    .map((f, i) => {
      const id = f.id ?? `fact-${i + 1}`;
      const source = f.source_citation ? ` | Source: ${f.source_citation}` : '';
      const category = f.category ? ` | Category: ${f.category}` : '';
      return `FACT [${id}]: ${f.claim}${source}${category}`;
    })
    .join('\n');

  return `## VERIFIED FACTS — assign each to an episode\n\n${factLines}\n\nTotal: ${facts.length} facts. Every fact MUST appear in at least one episode's fact_ids array.`;
}
