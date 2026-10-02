'use client';

import { useCallback, useState } from 'react';

import type { ActionResult } from '@kit/next/action-result';

import type {
  DiscardGeneratedEpisodesInput,
  EpisodeOutline,
} from '../../lib/schemas/batch-episode.schema';
import { discardGeneratedEpisodesAction } from '../../server/batch-episode-actions';

/**
 * The preview's outlines, whose rows the season_outline commit already
 * created (FILM-1901). Removing an outline, or cancelling the preview,
 * discards the rows the user did not keep, so the project shows the same
 * episodes it did when the rows were created on Create. Reordering and
 * editing discard nothing; confirming keeps every row (the create action
 * updates them with the edits).
 */

/** The ids that were in the preview and are no longer. */
export function removedOutlineIds(
  previous: EpisodeOutline[],
  next: EpisodeOutline[],
): string[] {
  const kept = new Set(next.map((outline) => outline.id).filter(Boolean));

  return previous
    .map((outline) => outline.id)
    .filter((id): id is string => !!id && !kept.has(id));
}

type Discard = (
  input: DiscardGeneratedEpisodesInput,
) => Promise<ActionResult<unknown>>;

export function useGeneratedOutlines({
  projectId,
  discard = discardGeneratedEpisodesAction,
  onDiscardFailed,
}: {
  projectId: string;
  discard?: Discard;
  onDiscardFailed?: (message: string) => void;
}) {
  const [episodes, setEpisodes] = useState<EpisodeOutline[]>([]);

  const discardRows = useCallback(
    async (episodeIds: string[]) => {
      if (episodeIds.length === 0) return;

      const result = await discard({ projectId, episodeIds });

      if (!result.ok) {
        onDiscardFailed?.(result.error);
      }
    },
    [discard, onDiscardFailed, projectId],
  );

  /** New outlines from a generation: nothing to discard. */
  const show = useCallback((next: EpisodeOutline[]) => setEpisodes(next), []);

  /** The preview's edits; the rows of removed outlines are discarded. */
  const replace = useCallback(
    async (next: EpisodeOutline[]) => {
      const removed = removedOutlineIds(episodes, next);
      setEpisodes(next);
      await discardRows(removed);
    },
    [discardRows, episodes],
  );

  /** The preview was cancelled: every remaining row is discarded. */
  const cancel = useCallback(async () => {
    const remaining = removedOutlineIds(episodes, []);
    setEpisodes([]);
    await discardRows(remaining);
  }, [discardRows, episodes]);

  /** The user confirmed: the rows stay. */
  const keep = useCallback(() => setEpisodes([]), []);

  return { episodes, show, replace, cancel, keep };
}
