import 'server-only';

import { screenplayDataFromScenes } from '@kit/generation/screenplay-data';
import type { Database, Json } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

import { parseScript } from '../lib/script-import';
import { OptimisticLockError } from '../lib/status-workflow';

type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

/** Statuses an imported screenplay moves forward from; a later one is kept */
const BEFORE_STORYBOARD = new Set(['draft', 'story']);

/**
 * Stores a finished script as an episode's screenplay (FILM-2205), for the
 * new-episode dialog and the MCP import_screenplay tool alike. The script is
 * read by parseScript and checked with the screenplay stage's SceneSchema,
 * and stored in the shape the stage commits (screenplayDataFromScenes), in
 * one write: the screenplay, the status the stage would set, and the
 * stage's origin as a person's import. Shots read the screenplay, and write
 * the dialogue lines themselves.
 */
export async function importScreenplay(
  client: Client,
  input: { episodeId: string; script: string; version?: number },
): Promise<
  | {
      ok: true;
      data: {
        episodeId: string;
        scenes: number;
        version: number;
        status: string;
      };
    }
  | { ok: false; refusal: string }
> {
  const parsed = parseScript(input.script);

  if (!parsed.ok) {
    return { ok: false, refusal: parsed.error };
  }

  const { data: episode, error: readError } = await client
    .from('episodes')
    .select('id, status, version, generation_origin')
    .eq('id', input.episodeId)
    .is('deleted_at', null)
    .maybeSingle();

  if (readError) {
    throw new Error(`Failed to read episode: ${readError.message}`);
  }

  if (!episode) {
    return { ok: false, refusal: 'Episode not found.' };
  }

  if (input.version !== undefined && episode.version !== input.version) {
    throw new OptimisticLockError('episode');
  }

  const at = new Date().toISOString();
  const screenplayData = screenplayDataFromScenes(parsed.scenes, {
    generatedAt: at,
    generatedBy: {
      model: `import:${parsed.format}`,
      provider: 'human',
      costCents: 0,
    },
  });
  const status = BEFORE_STORYBOARD.has(episode.status)
    ? 'storyboard'
    : episode.status;
  const origin = {
    ...((episode.generation_origin as Record<string, unknown> | null) ?? {}),
    screenplay: { kind: 'human', via: 'import', format: parsed.format, at },
  };

  const { data, error } = await client
    .from('episodes')
    .update({
      screenplay_data: screenplayData as unknown as Json,
      status,
      generation_origin: origin as Json,
    })
    .eq('id', input.episodeId)
    .eq('version', episode.version)
    .is('deleted_at', null)
    .select('id, version, status')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to store the screenplay: ${error.message}`);
  }

  // RLS filters a refused update to no rows (KB-61); so does a concurrent write
  if (!data) {
    throw new OptimisticLockError('episode');
  }

  return {
    ok: true,
    data: {
      episodeId: data.id,
      scenes: parsed.scenes.length,
      version: data.version,
      status: data.status,
    },
  };
}
