/**
 * The episode context a `@kit/generation` stage reads, as the worker has
 * always built it. Its own module so the MCP route (FILM-1908) can build
 * the same context for an external run: there `semantic` is off, because
 * recalling similar episodes is an embedding model call and an external
 * run makes none (FR-20).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { EpisodeContextLoader } from '@kit/generation';
import type { Database } from '@kit/supabase/database';

import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatCharactersForVeoPrompt,
  formatFactsForPrompt,
  formatLocationsForPrompt,
  formatLocationsForVeoPrompt,
  formatPreviousEpisodesForPrompt,
  formatRecurringElementsForPrompt,
  formatVerifiedFactsForPrompt,
} from './context-builder';

export function episodeContextLoader(
  supabase: SupabaseClient<Database>,
  { semantic = true }: { semantic?: boolean } = {},
): EpisodeContextLoader {
  return async (episodeId, options) => {
    const recall = semantic && options.semanticQuery !== undefined;
    const context = await buildEpisodeContext(episodeId, supabase, {
      semanticContext: recall,
      semanticQuery: recall ? options.semanticQuery : undefined,
    });

    return {
      episodeNumber: context.episodeNumber,
      seasonNumber: context.seasonNumber,
      seasonPremise: context.seasonPremise,
      seasonDirectionNotes: context.seasonDirectionNotes,
      premise: context.premise,
      genre: context.genre,
      targetAudience: context.targetAudience,
      visualStyle: context.visualStyle,
      projectType: context.projectType,
      characters: formatCharactersForPrompt(context.characters),
      locations: formatLocationsForPrompt(context.locations),
      previousEpisodes: formatPreviousEpisodesForPrompt(
        context.previousEpisodes,
      ),
      previousEpisodeTitles: context.previousEpisodes.map((ep) => ({
        number: ep.number,
        title: ep.title,
      })),
      episodeFacts: formatFactsForPrompt(context.episodeFacts),
      verifiedFacts:
        context.verifiedFacts.length > 0
          ? formatVerifiedFactsForPrompt(context.verifiedFacts)
          : undefined,
      counts: {
        characters: context.characters.length,
        locations: context.locations.length,
      },
      // The VEO 3.1 form the shots stage prompts with, and the names its
      // referential checks compare against
      charactersVeo: formatCharactersForVeoPrompt(context.characters),
      locationsVeo: formatLocationsForVeoPrompt(context.locations),
      recurringElements: formatRecurringElementsForPrompt(
        context.recurringElements,
      ),
      characterNames: context.characters.map((c) => c.name),
      locationNames: context.locations.map((l) => l.name),
      characterList: context.characters.map(({ id, name }) => ({ id, name })),
      locationList: context.locations.map(({ id, name }) => ({ id, name })),
    };
  };
}
