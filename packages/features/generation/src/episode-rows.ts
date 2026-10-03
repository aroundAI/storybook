/**
 * The episode row a season outline becomes (FILM-314). The season_outline
 * stage's commit and `batchCreateEpisodesAction` build rows through this one
 * function, so the two paths cannot drift.
 */
import type { Json } from '@kit/supabase/database';

import { generateEpisodeSlug } from './slug';

export interface OutlineForRow {
  title: string;
  premise: string;
  mainPlot: string;
  characterFocus?: string[];
  arcPosition: string;
}

export function episodeRowFromOutline(
  outline: OutlineForRow,
  target: { projectId: string; seasonId: string | null; number: number },
) {
  return {
    project_id: target.projectId,
    season_id: target.seasonId,
    number: target.number,
    title: outline.title,
    slug: generateEpisodeSlug(target.number, outline.title),
    description: outline.premise,
    status: 'draft',
    story_data: {
      premise: outline.premise,
      mainPlot: outline.mainPlot,
      characterFocus: outline.characterFocus ?? [],
      arcPosition: outline.arcPosition,
      generatedFromBatch: true,
    } as Json,
    version: 1,
  };
}

/** What an edit to an outline changes on a row the commit already created. */
export function episodeRowUpdateFromOutline(outline: OutlineForRow) {
  const row = episodeRowFromOutline(outline, {
    projectId: '',
    seasonId: null,
    number: 0,
  });

  return {
    title: row.title,
    description: row.description,
    story_data: row.story_data,
  };
}
