/**
 * The `dialogue_lines` rebuild the screenplay stages commit: every English
 * line of the episode is replaced by the lines of the new screenplay, in
 * scene order, numbered from 1. Speakers map to `character_asset_id` by
 * name (case-insensitive); an unknown speaker keeps a null id, as the
 * handlers always did.
 */
import { type CommitGroup, eq } from '../../commit-plan';
import type { GenerationOrigin } from '../../types';

export interface DialogueLineRow {
  episode_id: string;
  character_asset_id: string | null;
  text: string;
  sequence_number: number;
  scene_number: number;
  language: string;
  status: string;
  generation_origin?: GenerationOrigin;
}

/** The shape of a scene the rebuild reads; the stages' schemas carry more. */
export interface SceneWithDialogue {
  number?: unknown;
  dialogue?: Array<{ character?: unknown; text: string }> | null;
}

export function characterIdMap(
  characters: ReadonlyArray<{ id: string; name: string }>,
): Map<string, string> {
  return new Map(characters.map((c) => [c.name.toLowerCase(), c.id]));
}

export function dialogueRowsFromScenes(
  episodeId: string,
  scenes: ReadonlyArray<SceneWithDialogue>,
  characters: Map<string, string>,
  origin?: GenerationOrigin,
): DialogueLineRow[] {
  const rows: DialogueLineRow[] = [];
  let sequenceNumber = 1;

  for (const scene of scenes) {
    const sceneNumber = typeof scene.number === 'number' ? scene.number : 0;

    for (const line of scene.dialogue ?? []) {
      const speaker =
        typeof line.character === 'string' ? line.character.toLowerCase() : '';

      rows.push({
        episode_id: episodeId,
        character_asset_id: speaker ? (characters.get(speaker) ?? null) : null,
        text: line.text,
        sequence_number: sequenceNumber++,
        scene_number: sceneNumber,
        language: 'en',
        status: 'pending',
        ...(origin ? { generation_origin: origin } : {}),
      });
    }
  }

  return rows;
}

/**
 * The rebuild as one step of a commit's plan: the episode's existing lines
 * are deleted and `rows` inserted, together or not at all. Skippable, as
 * the handlers always treated it: the screenplay itself is saved either
 * way. No step when there are no rows (the old lines stay).
 */
export function dialogueRebuildSteps(
  episodeId: string,
  rows: DialogueLineRow[],
): CommitGroup[] {
  if (rows.length === 0) return [];

  return [
    {
      key: 'dialogue_lines',
      op: 'group',
      onError: 'skip',
      ops: [
        {
          op: 'delete',
          table: 'dialogue_lines',
          match: [eq('episode_id', episodeId)],
        },
        { op: 'insert', table: 'dialogue_lines', rows: [...rows] },
      ],
    },
  ];
}
