/**
 * The canon a story writes (FILM-1901, story stage commit):
 *
 *  0. cleanup           — delete the canon an earlier generation of this episode made
 *  1. immutable_events  — key events from the story
 *  2. character_states  — character arcs for characters found in project assets
 *  3. episode metadata  — themes stored for analytics/categorization
 *  4. narrative threads — from the canon facts the story came with
 *  5. episode memory    — the summary and world state the memory builder reads
 *
 * Steps 4 and 5 need the canon facts (`CanonExtraction`): in server mode the
 * worker's generate step extracts them with the `canon-extraction` prompt;
 * in external mode the agent submits them with the story. Without them the
 * commit stores the story and stops after step 3, making no model call.
 *
 * Moved here from the LLM worker's `utils/commit-story-canon.ts`, which
 * keeps the model call. All writes are non-fatal: failures are logged.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import type { Database } from '@kit/supabase/database';

import { type ExtractedWorldState, describeStateChange } from './memory-rows';
import { storeEpisodeMemory } from './store-episode-memory';

type Client = SupabaseClient<Database>;

export const ThreadTypeSchema = z.enum([
  'plot',
  'character',
  'mystery',
  'romantic',
  'conflict',
  'thematic',
]);

export const ThreadUpdateSchema = z.object({
  threadName: z.string().min(1),
  threadType: ThreadTypeSchema.optional(),
  action: z.enum(['open', 'progress', 'resolve']),
  description: z.string(),
  promises: z.array(z.string()).optional(),
});

export type ThreadUpdate = z.infer<typeof ThreadUpdateSchema>;

/**
 * What the `canon-extraction` prompt returns (`extraction` key). The story
 * stage's output carries it as `canonFacts`; the `immutableEvents` the
 * prompt also returns are not stored by this commit, as before.
 */
export const CanonExtractionSchema = z.object({
  threadUpdates: z.array(ThreadUpdateSchema).default([]),
  episodeSummary: z.string(),
  sentimentScore: z.number().min(0).max(1),
  keyEvents: z.array(z.string()).optional(),
  characterStateChanges: z
    .array(
      z.object({
        characterName: z.string(),
        fromState: z.string(),
        toState: z.string(),
      }),
    )
    .optional(),
  worldState: z
    .object({
      location: z.string(),
      timePeriod: z.string().optional(),
      atmosphere: z.string().optional(),
      activeConflicts: z.array(z.string()).optional(),
    })
    .optional(),
});

export type CanonExtraction = z.infer<typeof CanonExtractionSchema>;

export interface CommitStoryCanonInput {
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  season: number;
  keyEvents: string[];
  characters: Array<{ name: string; role: string; arc: string }>;
  episodeSummary?: string;
  themes?: string[];
  /** The canon facts the story came with; null when there are none */
  extraction: CanonExtraction | null;
  createdBy: string;
  supabase: Client;
}

/**
 * Converts a free-text event description to a canonical event key slug.
 */
function toEventKey(text: string, episodeNumber: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${slug}-ep${episodeNumber}`;
}

export async function commitStoryCanon(
  input: CommitStoryCanonInput,
): Promise<void> {
  const {
    projectId,
    episodeId,
    episodeNumber,
    season,
    keyEvents,
    characters,
    themes,
    extraction,
    createdBy,
    supabase,
  } = input;

  // Step 0: Remove the canon a previous generation of this episode made.
  // A regenerated story replaces it; canon added by hand is kept (KB-78).
  await cleanupEpisodeCanon(episodeId, supabase);

  const results = await Promise.allSettled([
    commitKeyEvents({
      projectId,
      episodeId,
      episodeNumber,
      season,
      keyEvents,
      createdBy,
      supabase,
    }),
    commitCharacterStates({ projectId, episodeId, characters, supabase }),
    commitThemesToMetadata({ episodeId, themes, supabase }),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[commitStoryCanon] Non-fatal failure:', result.reason);
    }
  }

  if (!extraction) {
    console.log(
      '[commitStoryCanon] No canon facts with this story: threads and memory not written',
    );
    return;
  }

  // Step 4: narrative threads from the canon facts (non-fatal)
  await commitNarrativeThreads({
    projectId,
    episodeId,
    threadUpdates: extraction.threadUpdates,
    supabase,
  });

  // Step 5: Episode summary and world state, the same rows the publish commit
  // writes. Without a sentiment score there is nothing to store.
  if (Number.isFinite(extraction.sentimentScore)) {
    await storeEpisodeMemory(supabase, {
      projectId,
      episodeId,
      changes: {
        episodeSummary:
          input.episodeSummary?.trim() || extraction.episodeSummary || '',
        sentimentScore: extraction.sentimentScore,
        keyEvents: input.keyEvents.length
          ? input.keyEvents
          : extraction.keyEvents,
        characterChanges:
          extraction.characterStateChanges?.map(describeStateChange),
        worldState: extraction.worldState as ExtractedWorldState | undefined,
      },
    });
  }
}

// ─── Step 0: Cleanup ─────────────────────────────────────────────────────────

const STORY_GENERATION = 'story_generation';

/**
 * Deletes the canon a previous story generation made for this episode, so a
 * regenerated story replaces it. Canon a person added — an event from Add
 * Event, a thread from Add Thread or the Publish page — carries no generation
 * marker and is kept (KB-78).
 * FK CASCADE on episode deletion handles the delete-episode case separately.
 */
export async function cleanupEpisodeCanon(
  episodeId: string,
  supabase: Client,
): Promise<void> {
  const deletions = [
    {
      table: 'immutable_events',
      request: supabase
        .from('immutable_events')
        .delete()
        .eq('established_in', episodeId)
        .eq('metadata->>auto_generated', 'true')
        .select('id'),
    },
    {
      table: 'character_states',
      request: supabase
        .from('character_states')
        .delete()
        .eq('episode_id', episodeId)
        .eq('trigger_event', STORY_GENERATION)
        .select('id'),
    },
    {
      table: 'narrative_threads',
      request: supabase
        .from('narrative_threads')
        .delete()
        .eq('opened_at', episodeId)
        .eq('auto_generated', true)
        .select('id'),
    },
  ];

  const results = await Promise.all(
    deletions.map(async ({ table, request }) => {
      const { data, error } = await request;
      if (error) {
        console.warn(
          `[commitStoryCanon] Cleanup of ${table} failed:`,
          error.message,
        );
      }
      return `${table} ${data?.length ?? 0}`;
    }),
  );

  console.log(
    `[commitStoryCanon] Replaced generated canon for episode ${episodeId} (${results.join(', ')}); canon added by hand is kept`,
  );
}

// ─── Step 1: Key Events ───────────────────────────────────────────────────────

async function commitKeyEvents({
  projectId,
  episodeId,
  episodeNumber,
  season,
  keyEvents,
  createdBy,
  supabase,
}: {
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  season: number;
  keyEvents: string[];
  createdBy: string;
  supabase: Client;
}) {
  if (!keyEvents.length) return;

  const toInsert = keyEvents.map((text) => ({
    project_id: projectId,
    event_type: 'world_fact' as const,
    event_key: toEventKey(text, episodeNumber),
    established_in: episodeId,
    season,
    episode_number: episodeNumber,
    description: text,
    metadata: { auto_generated: true, source: STORY_GENERATION },
    created_by: createdBy,
  }));

  const { error } = await supabase.from('immutable_events').insert(toInsert);
  if (error) {
    throw new Error(`immutable_events insert failed: ${error.message}`);
  }
  console.log(`[commitStoryCanon] Committed ${toInsert.length} key events`);
}

// ─── Step 2: Character States ─────────────────────────────────────────────────

async function commitCharacterStates({
  projectId,
  episodeId,
  characters,
  supabase,
}: {
  projectId: string;
  episodeId: string;
  characters: Array<{ name: string; role: string; arc: string }>;
  supabase: Client;
}) {
  if (!characters.length) return;

  const names = characters.map((c) => c.name);
  const { data: assets } = await supabase
    .from('assets')
    .select('id, name')
    .eq('project_id', projectId)
    .eq('type', 'character')
    .in('name', names);

  if (!assets?.length) {
    console.log(
      '[commitStoryCanon] No matching character assets found, skipping states',
    );
    return;
  }

  const assetByName = new Map(
    (assets as Array<{ id: string; name: string }>).map((a) => [
      a.name.toLowerCase(),
      a.id,
    ]),
  );

  const toInsert = characters
    .filter((c) => assetByName.has(c.name.toLowerCase()))
    .map((c) => ({
      character_id: assetByName.get(c.name.toLowerCase())!,
      episode_id: episodeId,
      state_type: 'goal',
      state_value: { arc: c.arc, role: c.role },
      trigger_event: STORY_GENERATION,
    }));

  if (!toInsert.length) return;

  const { error } = await supabase.from('character_states').insert(toInsert);
  if (error) {
    throw new Error(`character_states insert failed: ${error.message}`);
  }
  console.log(
    `[commitStoryCanon] Committed ${toInsert.length} character states`,
  );
}

// ─── Step 3: Themes Metadata ──────────────────────────────────────────────────

/**
 * Stores episode themes (morals, lessons) in episode metadata.
 * These are categorization data for analytics — NOT narrative promises.
 */
async function commitThemesToMetadata({
  episodeId,
  themes,
  supabase,
}: {
  episodeId: string;
  themes?: string[];
  supabase: Client;
}) {
  if (!themes?.length) return;

  // Fetch current metadata and merge themes
  const { data: episode } = await supabase
    .from('episodes')
    .select('metadata')
    .eq('id', episodeId)
    .single();

  const existingMetadata = (episode?.metadata as Record<string, unknown>) ?? {};

  const { data: updated, error } = await supabase
    .from('episodes')
    .update({
      metadata: { ...existingMetadata, themes },
    })
    .eq('id', episodeId)
    .select('id');

  if (error) {
    throw new Error(`themes metadata update failed: ${error.message}`);
  }

  // RLS filters a refused update to no rows, without an error (KB-105)
  if (!updated?.length) {
    throw new Error('themes metadata update matched no row');
  }
  console.log(
    `[commitStoryCanon] Stored ${themes.length} themes in episode metadata`,
  );
}

// ─── Step 4: Narrative Threads ────────────────────────────────────────────────

/**
 * Writes the thread updates the canon facts name: opens new threads,
 * progresses or resolves existing ones. Non-fatal per thread.
 */
async function commitNarrativeThreads({
  projectId,
  episodeId,
  threadUpdates,
  supabase,
}: {
  projectId: string;
  episodeId: string;
  threadUpdates: ThreadUpdate[];
  supabase: Client;
}): Promise<void> {
  if (threadUpdates.length === 0) {
    console.log('[commitStoryCanon] No narrative threads to commit');
    return;
  }

  let threadsCreated = 0;
  for (const update of threadUpdates) {
    try {
      if (update.action === 'open') {
        const { error } = await supabase.from('narrative_threads').insert({
          project_id: projectId,
          thread_name: update.threadName,
          thread_type: update.threadType ?? 'plot',
          opened_at: episodeId,
          description: update.description,
          promises: update.promises ?? [],
          episodes_touched: [episodeId],
          status: 'open',
          auto_generated: true,
        });
        if (!error) threadsCreated++;
      } else if (update.action === 'progress') {
        const { data: existing } = await supabase
          .from('narrative_threads')
          .select('id, episodes_touched, version')
          .eq('project_id', projectId)
          .eq('thread_name', update.threadName)
          .in('status', ['open', 'progressed'])
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (existing) {
          const touched = [
            ...new Set([
              ...((existing.episodes_touched as string[]) ?? []),
              episodeId,
            ]),
          ];
          const { data: progressed } = await supabase
            .from('narrative_threads')
            .update({
              status: 'progressed',
              episodes_touched: touched,
              description: update.description,
              version: ((existing.version as number) ?? 1) + 1,
            })
            .eq('id', existing.id)
            .select('id');
          if (progressed?.length) threadsCreated++;
        }
      } else if (update.action === 'resolve') {
        const { data: existing } = await supabase
          .from('narrative_threads')
          .select('id, episodes_touched, payoffs, version')
          .eq('project_id', projectId)
          .eq('thread_name', update.threadName)
          .in('status', ['open', 'progressed'])
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (existing) {
          const touched = [
            ...new Set([
              ...((existing.episodes_touched as string[]) ?? []),
              episodeId,
            ]),
          ];
          const { data: resolved } = await supabase
            .from('narrative_threads')
            .update({
              status: 'resolved',
              resolved_at: episodeId,
              payoffs: [
                ...((existing.payoffs as string[]) ?? []),
                update.description,
              ],
              episodes_touched: touched,
              version: ((existing.version as number) ?? 1) + 1,
            })
            .eq('id', existing.id)
            .select('id');
          if (resolved?.length) threadsCreated++;
        }
      }
    } catch (threadErr) {
      console.warn(
        `[commitStoryCanon] Thread '${update.threadName}' failed:`,
        threadErr,
      );
    }
  }

  console.log(
    `[commitStoryCanon] Threads: ${threadsCreated}/${threadUpdates.length} committed`,
  );
}
