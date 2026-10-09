import 'server-only';

import type { Database } from '@kit/supabase/database';
import type { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * The season writes, callable with any Supabase client: the web's server
 * actions pass the cookie session's client, the MCP tools (FILM-2204) the
 * principal's RLS-scoped one. One copy of the numbering and retry rules for
 * the season dialog, the episode wizard's inline season and Generate Season
 * (FILM-2201).
 *
 * A failure the user caused comes back as `{ ok: false, ... }`; a database
 * failure throws.
 */
export type SeasonRow = Database['public']['Tables']['seasons']['Row'];

type Client = ReturnType<typeof getSupabaseServerClient<Database>>;

type Log = { warn: (ctx: unknown, msg: string) => void };

const noLog: Log = { warn: () => {} };

const MAX_RETRIES = 3;

export interface InsertSeasonInput {
  projectId: string;
  /** Defaults to "Season {number}", the name Generate Season has always given. */
  name?: string;
  /** A number the caller chose; auto-assigned (and retried on a clash) when absent. */
  number?: number;
  description?: string | null;
  directionNotes?: string | null;
}

export type InsertSeasonResult =
  | { ok: true; data: SeasonRow }
  | { ok: false; refusal: string; field: 'number' };

/**
 * Inserts a season at the given number, or at the project's next free one.
 * The live-number index refuses a number a concurrent create took
 * between the read and the insert (23505); an auto-assigned number is then
 * read again, a chosen one is refused.
 */
export async function insertSeason(
  client: Client,
  input: InsertSeasonInput,
  log: Log = noLog,
): Promise<InsertSeasonResult> {
  let lastMessage = 'Unknown error';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const number = input.number ?? (await nextSeasonNumber(client, input));

    const { data, error } = await client
      .from('seasons')
      .insert({
        project_id: input.projectId,
        number,
        name: input.name || `Season ${number}`,
        description: input.description ?? null,
        direction_notes: input.directionNotes ?? null,
      })
      .select()
      .single();

    if (!error) {
      return { ok: true, data };
    }

    lastMessage = error.message;

    if (error.code !== '23505') {
      break;
    }

    if (input.number) {
      return {
        ok: false,
        refusal: `Season ${input.number} already exists in this project. Choose a different number.`,
        field: 'number',
      };
    }

    log.warn({ attempt, error }, 'Season number conflict, retrying');
  }

  throw new Error(`Failed to create season: ${lastMessage}`);
}

/**
 * The number after the project's highest live season: a deleted season's
 * number is free again (`seasons_project_id_number_active_idx`).
 */
async function nextSeasonNumber(client: Client, input: InsertSeasonInput) {
  const { data, error } = await client
    .from('seasons')
    .select('number')
    .eq('project_id', input.projectId)
    .is('deleted_at', null)
    .order('number', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to read season numbers: ${error.message}`);
  }

  return (data?.[0]?.number ?? 0) + 1;
}
