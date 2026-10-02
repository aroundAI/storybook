/**
 * The worker's `Ctx.episodeContext` (FILM-1901): the context builder's
 * episode, formatted both ways a prompt reads it. `@kit/generation` never
 * imports the builder (it reaches an embedding model for KB-35), so the
 * worker hands it in through this seam.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { EpisodeContextLoader } from '@kit/generation';
import type { Database } from '@kit/supabase/database';

import {
  buildEpisodeContext,
  formatCharactersForPrompt,
  formatCharactersForVeoPrompt,
  formatLocationsForPrompt,
  formatLocationsForVeoPrompt,
  formatPreviousEpisodesForPrompt,
  formatRecurringElementsForPrompt,
} from './context-builder';

export function episodeContextLoader(
  supabase: SupabaseClient<Database>,
): EpisodeContextLoader {
  return async (episodeId, options) => {
    const context = await buildEpisodeContext(episodeId, supabase, {
      semanticContext: Boolean(options.semanticQuery),
      semanticQuery: options.semanticQuery,
    });

    return {
      episodeNumber: context.episodeNumber,
      seasonNumber: context.seasonNumber,
      seasonPremise: context.seasonPremise,
      seasonDirectionNotes: context.seasonDirectionNotes,
      characters: formatCharactersForPrompt(context.characters),
      locations: formatLocationsForPrompt(context.locations),
      previousEpisodes: formatPreviousEpisodesForPrompt(
        context.previousEpisodes,
      ),
      counts: {
        characters: context.characters.length,
        locations: context.locations.length,
      },
      charactersVeo: formatCharactersForVeoPrompt(context.characters),
      locationsVeo: formatLocationsForVeoPrompt(context.locations),
      recurringElements: formatRecurringElementsForPrompt(
        context.recurringElements,
      ),
      characterNames: context.characters.map((c) => c.name),
      locationNames: context.locations.map((l) => l.name),
      genre: context.genre,
      targetAudience: context.targetAudience,
      visualStyle: context.visualStyle,
    };
  };
}
