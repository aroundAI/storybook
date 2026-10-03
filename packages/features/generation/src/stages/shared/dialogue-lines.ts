/**
 * The `dialogue_lines` rebuild the screenplay stages commit: every English
 * line of the episode is replaced by the lines of the new screenplay, in
 * scene order, numbered from 1. Speakers map to `character_asset_id` by
 * name (case-insensitive); an unknown speaker keeps a null id, as the
 * handlers always did.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

export interface DialogueLineRow {
  episode_id: string;
  character_asset_id: string | null;
  text: string;
  sequence_number: number;
  scene_number: number;
  language: string;
  status: string;
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
      });
    }
  }

  return rows;
}

/**
 * Deletes the episode's existing lines and inserts `rows`, when there are
 * any. A failed insert is logged, not thrown: the screenplay itself has
 * already been saved.
 */
export async function rebuildDialogueLines(
  client: SupabaseClient<Database>,
  episodeId: string,
  rows: DialogueLineRow[],
  label: string,
): Promise<void> {
  if (rows.length === 0) return;

  const { error: deleteError } = await client
    .from('dialogue_lines')
    .delete()
    .eq('episode_id', episodeId);

  if (deleteError) {
    console.warn(
      `[${label}] Failed to delete old dialogue lines:`,
      deleteError,
    );
  }

  const { error: insertError } = await client
    .from('dialogue_lines')
    .insert(rows);

  if (insertError) {
    console.error(`[${label}] Failed to insert dialogue:`, insertError);
  }
}
