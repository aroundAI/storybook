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
 * keeps the model call. `planStoryCanon` reads what the writes depend on
 * and returns them as steps of the story commit's plan (FILM-1903: one
 * transaction with the story). Every step is skippable, as every write here
 * always was non-fatal: a failure undoes that step and is reported.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import type { Database } from '@kit/supabase/database';

import {
  type CommitRef,
  type CommitStep,
  type CommitWrite,
  eq,
  ref,
} from '../commit-plan';
import { applyPlanThroughClient } from '../commit-through-client';
import { type ExtractedWorldState, describeStateChange } from './memory-rows';
import { planEpisodeMemory } from './store-episode-memory';

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

/**
 * The canon steps of a story's commit, in the order the handler wrote them:
 * the cleanup of the last generation's canon, key events, character
 * states, themes, then (with canon facts) threads and the episode memory.
 * Reads happen here, before any write, so each one answers as the handler's
 * read did after the writes before it: a thread the cleanup deletes is not
 * progressed, and one this commit opens is.
 */
export async function planStoryCanon(
  input: CommitStoryCanonInput,
): Promise<CommitStep[]> {
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
  const steps: CommitStep[] = [
    ...cleanupSteps(episodeId),
    ...keyEventSteps({
      projectId,
      episodeId,
      episodeNumber,
      season,
      keyEvents,
      createdBy,
    }),
    ...(await characterStateSteps({
      projectId,
      episodeId,
      characters,
      createdBy,
      supabase,
    })),
    ...themeSteps({ episodeId, themes }),
  ];

  if (!extraction) {
    console.log(
      '[commitStoryCanon] No canon facts with this story: threads and memory not written',
    );
    return steps;
  }

  // Step 4: narrative threads from the canon facts (non-fatal per thread)
  steps.push(
    ...(await threadSteps({
      projectId,
      episodeId,
      threadUpdates: extraction.threadUpdates,
      supabase,
    })),
  );

  // Step 5: Episode summary and world state, the same rows the publish commit
  // writes. Without a sentiment score there is nothing to store.
  if (Number.isFinite(extraction.sentimentScore)) {
    steps.push(
      ...(await planEpisodeMemory(supabase, {
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
      })),
    );
  }

  return steps;
}

/**
 * The canon a story writes, applied through `input.supabase` statement by
 * statement: for a caller outside a story commit. The story stage puts
 * `planStoryCanon`'s steps in its own plan instead.
 */
export async function commitStoryCanon(
  input: CommitStoryCanonInput,
): Promise<void> {
  const steps = await planStoryCanon(input);
  await applyPlanThroughClient(input.supabase, { ops: steps });
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
export function cleanupSteps(episodeId: string): CommitWrite[] {
  return [
    {
      key: 'canon.cleanup.immutable_events',
      op: 'delete',
      table: 'immutable_events',
      match: [
        eq('established_in', episodeId),
        eq('metadata->>auto_generated', 'true'),
      ],
      returning: ['id'],
      onError: 'skip',
    },
    {
      key: 'canon.cleanup.character_states',
      op: 'delete',
      table: 'character_states',
      match: [
        eq('episode_id', episodeId),
        eq('trigger_event', STORY_GENERATION),
      ],
      returning: ['id'],
      onError: 'skip',
    },
    {
      key: 'canon.cleanup.narrative_threads',
      op: 'delete',
      table: 'narrative_threads',
      match: [eq('opened_at', episodeId), eq('auto_generated', true)],
      returning: ['id'],
      onError: 'skip',
    },
  ];
}

/** The cleanup on its own, through the caller's client. */
export async function cleanupEpisodeCanon(
  episodeId: string,
  supabase: Client,
): Promise<void> {
  const applied = await applyPlanThroughClient(supabase, {
    ops: cleanupSteps(episodeId),
  });

  const counts = ['immutable_events', 'character_states', 'narrative_threads']
    .map(
      (table) =>
        `${table} ${applied.results[`canon.cleanup.${table}`]?.length ?? 0}`,
    )
    .join(', ');

  console.log(
    `[commitStoryCanon] Replaced generated canon for episode ${episodeId} (${counts}); canon added by hand is kept`,
  );
}

// ─── Step 1: Key Events ───────────────────────────────────────────────────────

function keyEventSteps({
  projectId,
  episodeId,
  episodeNumber,
  season,
  keyEvents,
  createdBy,
}: {
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  season: number;
  keyEvents: string[];
  createdBy: string;
}): CommitWrite[] {
  if (!keyEvents.length) return [];

  return [
    {
      op: 'insert',
      table: 'immutable_events',
      rows: keyEvents.map((text) => ({
        project_id: projectId,
        event_type: 'world_fact' as const,
        event_key: toEventKey(text, episodeNumber),
        established_in: episodeId,
        season,
        episode_number: episodeNumber,
        description: text,
        metadata: { auto_generated: true, source: STORY_GENERATION },
        created_by: createdBy,
      })),
      onError: 'skip',
    },
  ];
}

// ─── Step 2: Character States ─────────────────────────────────────────────────

async function characterStateSteps({
  projectId,
  episodeId,
  characters,
  createdBy,
  supabase,
}: {
  projectId: string;
  episodeId: string;
  characters: Array<{ name: string; role: string; arc: string }>;
  createdBy: string;
  supabase: Client;
}): Promise<CommitWrite[]> {
  if (!characters.length) return [];

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
    return [];
  }

  const assetByName = new Map(
    (assets as Array<{ id: string; name: string }>).map((a) => [
      a.name.toLowerCase(),
      a.id,
    ]),
  );

  const rows = characters
    .filter((c) => assetByName.has(c.name.toLowerCase()))
    .map((c) => ({
      character_id: assetByName.get(c.name.toLowerCase())!,
      episode_id: episodeId,
      state_type: 'goal',
      state_value: { arc: c.arc, role: c.role },
      trigger_event: STORY_GENERATION,
      // The author is the run's user, not whoever applies it (KB-77)
      created_by: createdBy,
    }));

  if (!rows.length) return [];

  return [{ op: 'insert', table: 'character_states', rows, onError: 'skip' }];
}

// ─── Step 3: Themes Metadata ──────────────────────────────────────────────────

/**
 * Stores episode themes (morals, lessons) in episode metadata, merged into
 * what is there. These are categorization data for analytics — NOT
 * narrative promises. requireRows: RLS filters a refused update to no
 * rows, without an error (KB-105).
 */
function themeSteps({
  episodeId,
  themes,
}: {
  episodeId: string;
  themes?: string[];
}): CommitWrite[] {
  if (!themes?.length) return [];

  return [
    {
      op: 'update',
      table: 'episodes',
      values: { metadata: { themes } },
      merge: ['metadata'],
      match: [eq('id', episodeId)],
      requireRows: true,
      onError: 'skip',
    },
  ];
}

// ─── Step 4: Narrative Threads ────────────────────────────────────────────────

interface ThreadState {
  id: string | CommitRef;
  episodes_touched: string[];
  payoffs: string[];
  version: number;
}

/**
 * Opens new threads, progresses or resolves existing ones: one skippable
 * step per thread update. A thread is found as the handler found it, the
 * latest open or progressed one of that name, as the writes before it in
 * this commit leave the table: not one the cleanup deletes, and the one an
 * earlier update in this list opened or progressed.
 */
async function threadSteps({
  projectId,
  episodeId,
  threadUpdates,
  supabase,
}: {
  projectId: string;
  episodeId: string;
  threadUpdates: ThreadUpdate[];
  supabase: Client;
}): Promise<CommitWrite[]> {
  if (threadUpdates.length === 0) {
    console.log('[commitStoryCanon] No narrative threads to commit');
    return [];
  }

  const live = new Map<string, ThreadState | null>();

  async function find(name: string): Promise<ThreadState | null> {
    if (live.has(name)) return live.get(name)!;

    const { data } = await supabase
      .from('narrative_threads')
      .select(
        'id, episodes_touched, payoffs, version, opened_at, auto_generated',
      )
      .eq('project_id', projectId)
      .eq('thread_name', name)
      .in('status', ['open', 'progressed'])
      .order('created_at', { ascending: false });

    const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
      id: string;
      episodes_touched: string[] | null;
      payoffs: string[] | null;
      version: number | null;
      opened_at: string | null;
      auto_generated: boolean | null;
    }>;
    const existing = rows.find(
      (row) => !(row.opened_at === episodeId && row.auto_generated === true),
    );

    const state = existing
      ? {
          id: existing.id,
          episodes_touched: existing.episodes_touched ?? [],
          payoffs: existing.payoffs ?? [],
          version: existing.version ?? 1,
        }
      : null;

    live.set(name, state);
    return state;
  }

  const steps: CommitWrite[] = [];

  for (const [index, update] of threadUpdates.entries()) {
    if (update.action === 'open') {
      const key = `canon.thread.${index}`;

      steps.push({
        key,
        op: 'insert',
        table: 'narrative_threads',
        asObject: true,
        rows: [
          {
            project_id: projectId,
            thread_name: update.threadName,
            thread_type: update.threadType ?? 'plot',
            opened_at: episodeId,
            description: update.description,
            promises: update.promises ?? [],
            episodes_touched: [episodeId],
            status: 'open',
            auto_generated: true,
          },
        ],
        returning: ['id'],
        onError: 'skip',
      });
      live.set(update.threadName, {
        id: ref(key, 'id', { one: true }),
        episodes_touched: [episodeId],
        payoffs: [],
        version: 1,
      });
      continue;
    }

    const existing = await find(update.threadName);

    if (!existing) continue;

    const touched = [...new Set([...existing.episodes_touched, episodeId])];
    const version = existing.version + 1;

    if (update.action === 'progress') {
      steps.push({
        op: 'update',
        table: 'narrative_threads',
        values: {
          status: 'progressed',
          episodes_touched: touched,
          description: update.description,
          version,
        },
        match: [eq('id', existing.id)],
        onError: 'skip',
      });
      live.set(update.threadName, {
        ...existing,
        episodes_touched: touched,
        version,
      });
    } else {
      steps.push({
        op: 'update',
        table: 'narrative_threads',
        values: {
          status: 'resolved',
          resolved_at: episodeId,
          payoffs: [...existing.payoffs, update.description],
          episodes_touched: touched,
          version,
        },
        match: [eq('id', existing.id)],
        onError: 'skip',
      });
      // A resolved thread is no longer open or progressed
      live.set(update.threadName, null);
    }
  }

  return steps;
}
