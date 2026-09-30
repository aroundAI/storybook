/**
 * Commit Story Canon
 *
 * After story generation, auto-populates Canon tables from the structured
 * LLM output so the Canon Dashboard has data to show immediately.
 *
 * Steps:
 *  0. CLEANUP — delete the canon an earlier generation of this episode made
 *  1. immutable_events  — key events extracted from the story
 *  2. character_states  — character arcs for characters found in project assets
 *  3. episode metadata  — themes stored for analytics/categorization
 *
 * Narrative threads are created via LLM extraction (Phase 5) or manually,
 * NOT by this function.
 *
 * All writes are non-fatal: failures are logged but don't break generation.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

export interface CommitStoryCanonInput {
  projectId: string;
  /** The account the job's LLM usage is recorded on (KB-129). */
  accountId: string;
  episodeId: string;
  episodeNumber: number;
  season: number;
  keyEvents: string[];
  characters: Array<{ name: string; role: string; arc: string }>;
  episodeSummary?: string;
  themes?: string[];
  storyContent?: string;
  createdBy: string;
  supabase: SupabaseClient<Database>;
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
    accountId,
    episodeId,
    episodeNumber,
    season,
    keyEvents,
    characters,
    themes,
    storyContent,
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

  // Step 4: Extract and commit narrative threads via LLM (non-fatal)
  await commitNarrativeThreadsViaLLM({
    accountId,
    projectId,
    episodeId,
    storyContent,
    supabase,
  });
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
  supabase: SupabaseClient<Database>,
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
  supabase: SupabaseClient<Database>;
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
  supabase: SupabaseClient<Database>;
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
  supabase: SupabaseClient<Database>;
}) {
  if (!themes?.length) return;

  // Fetch current metadata and merge themes
  const { data: episode } = await supabase
    .from('episodes')
    .select('metadata')
    .eq('id', episodeId)
    .single();

  const existingMetadata = (episode?.metadata as Record<string, unknown>) ?? {};

  const { error } = await supabase
    .from('episodes')
    .update({
      metadata: { ...existingMetadata, themes },
    })
    .eq('id', episodeId);

  if (error) {
    throw new Error(`themes metadata update failed: ${error.message}`);
  }
  console.log(
    `[commitStoryCanon] Stored ${themes.length} themes in episode metadata`,
  );
}

// ─── Step 4: LLM-Based Narrative Thread Extraction ────────────────────────────

interface LLMThreadUpdate {
  threadName: string;
  threadType?:
    | 'plot'
    | 'character'
    | 'mystery'
    | 'romantic'
    | 'conflict'
    | 'thematic';
  action: 'open' | 'progress' | 'resolve';
  description: string;
  promises?: string[];
}

/**
 * Runs LLM canon extraction to identify real narrative threads from the story,
 * then writes them directly to the database.
 *
 * This replaces the old hardcoded "Episode arc" thread creation.
 * Uses the same `canon-extraction` prompt template as the publish page.
 * Non-fatal: failures are logged but don't break story generation.
 */
async function commitNarrativeThreadsViaLLM({
  projectId,
  accountId,
  episodeId,
  storyContent,
  supabase,
}: {
  projectId: string;
  accountId: string;
  episodeId: string;
  storyContent?: string;
  supabase: SupabaseClient<Database>;
}) {
  if (!storyContent || storyContent.length < 100) return;

  try {
    const { executeLLM } = await import('@kit/prompt-engine/server');

    // Fetch active threads for LLM context
    const { data: activeThreads } = await supabase
      .from('narrative_threads')
      .select('thread_name, thread_type, status, description, promises')
      .eq('project_id', projectId)
      .in('status', ['open', 'progressed']);

    const threadsContext = activeThreads?.length
      ? activeThreads
          .map(
            (t) =>
              `- "${t.thread_name}" (${t.thread_type}, ${t.status}): ${t.description ?? ''}. Promises: ${((t.promises as string[]) ?? []).join(', ') || 'none'}`,
          )
          .join('\n')
      : 'No active threads';

    // Fetch project characters
    const { data: projectCharacters } = await supabase
      .from('assets')
      .select('name, type')
      .eq('project_id', projectId)
      .eq('type', 'character')
      .limit(30);

    const charsContext = projectCharacters?.length
      ? projectCharacters.map((c) => `- ${c.name}`).join('\n')
      : 'No characters defined';

    // Sanitize content
    const sanitizedContent = storyContent
      .replace(/\b(system|assistant)\s*:\s*/gi, '')
      .replace(
        /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,
        '',
      )
      .substring(0, 50_000)
      .trim();

    const result = await executeLLM<{
      extraction: {
        threadUpdates: LLMThreadUpdate[];
        episodeSummary: string;
        sentimentScore: number;
      };
    }>({
      templateSlug: 'canon-extraction',
      variables: {
        story_content: sanitizedContent,
        existing_characters: charsContext,
        existing_threads: threadsContext,
      },
      context: {
        name: 'canon-extraction-auto',
        accountId,
      },
    });

    const threadUpdates = result.data.extraction?.threadUpdates ?? [];
    if (threadUpdates.length === 0) {
      console.log(
        '[commitStoryCanon] LLM found no narrative threads to commit',
      );
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
            await supabase
              .from('narrative_threads')
              .update({
                status: 'progressed',
                episodes_touched: touched,
                description: update.description,
                version: ((existing.version as number) ?? 1) + 1,
              })
              .eq('id', existing.id);
            threadsCreated++;
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
            await supabase
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
              .eq('id', existing.id);
            threadsCreated++;
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
      `[commitStoryCanon] LLM thread extraction: ${threadsCreated}/${threadUpdates.length} threads committed`,
    );
  } catch (err) {
    console.warn(
      '[commitStoryCanon] LLM thread extraction failed (non-fatal):',
      err,
    );
  }
}
