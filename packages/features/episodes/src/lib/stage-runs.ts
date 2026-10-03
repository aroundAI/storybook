import type { getSupabaseBrowserClient } from '@kit/supabase/browser-client';
import type { Database } from '@kit/supabase/database';

/** The browser and the server client are the same SupabaseClient<Database>. */
type Client = ReturnType<typeof getSupabaseBrowserClient<Database>>;

/**
 * The studio pages and the generation stages each one shows (FILM-1910).
 *
 * - `stages`: what the page displays; its origin badge and "Restore
 *   previous version" read these.
 * - `blocks`: the stages whose open external run disables the page's
 *   Generate buttons and shows the banner: the page's own, plus the stage
 *   its Generate button would start (the story page's "Convert to
 *   Screenplay" starts `screenplay`).
 */
export const STUDIO_PAGE_STAGES = {
  story: {
    stages: ['story', 'story_refinement'],
    blocks: ['story', 'story_refinement', 'screenplay'],
  },
  screenplay: {
    stages: ['screenplay', 'screenplay_refinement'],
    blocks: ['screenplay', 'screenplay_refinement', 'shots'],
  },
  'visual-studio': {
    stages: ['shots'],
    blocks: ['shots'],
  },
  'audio-studio': {
    stages: ['audio_cues', 'dialogue_translation'],
    blocks: ['audio_cues', 'dialogue_translation'],
  },
} as const satisfies Record<
  string,
  { stages: readonly string[]; blocks: readonly string[] }
>;

export type StudioPage = keyof typeof STUDIO_PAGE_STAGES;

export const STUDIO_PAGES = Object.keys(STUDIO_PAGE_STAGES) as StudioPage[];

export function isStudioPage(value: string): value is StudioPage {
  return (STUDIO_PAGES as string[]).includes(value);
}

/** `/home/a/studio/p/episodes/e/story` → `story`; null on other tabs. */
export function studioPageFromPath(pathname: string | null): StudioPage | null {
  const last = pathname?.split('/').filter(Boolean).pop() ?? '';
  return isStudioPage(last) ? last : null;
}

export const STAGE_LABELS: Record<string, string> = {
  story: 'the story',
  story_refinement: 'a story refinement',
  screenplay: 'the screenplay',
  screenplay_refinement: 'a screenplay refinement',
  shots: 'the shot list',
  audio_cues: 'the audio cues',
  dialogue_translation: 'a dialogue translation',
};

export const NOTHING_TO_RESTORE =
  'There is no earlier version of this stage to restore.';
export const RESTORE_WHILE_RUN_OPEN =
  'An AI client is writing this stage right now. Wait for it to finish, or cancel it, before restoring.';
export const RESTORE_NEEDS_WRITE =
  'You need write access to this project to restore a version.';

export const OPEN_RUN_STATUSES = ['briefed', 'in_progress'] as const;

export interface OpenExternalRun {
  id: string;
  stage: string;
  clientName: string | null;
  model: string | null;
  startedAt: string;
  leaseExpiresAt: string | null;
}

/**
 * The episode's open external runs, read under the caller's RLS
 * (`generation_runs_read`: has_account_access). A run past its lease is
 * left out even before the expiry cron marks it, so a forgotten
 * conversation never shows as live. At most one open run exists per stage
 * (`generation_runs_one_open`), so this is a handful of rows: no paging.
 */
export async function listOpenExternalRuns(
  client: Client,
  episodeId: string,
  now = new Date(),
): Promise<OpenExternalRun[]> {
  const { data, error } = await client
    .from('generation_runs')
    .select('id, stage, origin, created_at, lease_expires_at')
    .eq('target_type', 'episode')
    .eq('target_id', episodeId)
    .eq('mode', 'external')
    .in('status', [...OPEN_RUN_STATUSES])
    .or(`lease_expires_at.is.null,lease_expires_at.gt.${now.toISOString()}`)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Could not read the episode's runs: ${error.message}`);
  }

  return data.map((row) => {
    const origin = (row.origin ?? {}) as Record<string, unknown>;

    return {
      id: row.id,
      stage: row.stage,
      clientName:
        typeof origin.clientName === 'string' ? origin.clientName : null,
      model: typeof origin.model === 'string' ? origin.model : null,
      startedAt: row.created_at,
      leaseExpiresAt: row.lease_expires_at,
    };
  });
}

export interface StageRevision {
  id: string;
  stage: string;
  createdAt: string;
}

/** The newest `content_revisions` snapshot of any of `stages`, or null. */
export async function latestStageRevision(
  client: Client,
  episodeId: string,
  stages: readonly string[],
): Promise<StageRevision | null> {
  const { data, error } = await client
    .from('content_revisions')
    .select('id, stage, created_at')
    .eq('target_type', 'episode')
    .eq('target_id', episodeId)
    .in('stage', [...stages])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the stage's versions: ${error.message}`);
  }

  return data
    ? { id: data.id, stage: data.stage, createdAt: data.created_at }
    : null;
}
