/**
 * Previous-episode context for story prompts (KB-35).
 *
 * One window, set by the project's memory horizon: the episodes numbered
 * [current − horizon, current), project-wide and across seasons (episode
 * numbers are assigned per project), with a story and not deleted. News
 * carries no episode history (FILM-1111 D4).
 *
 * From that window the prompt gets the most recent few, as before, and —
 * when a caller opts in and a Voyage key is set — the earlier episodes most
 * similar to the one being written. Embeddings are written here, on read,
 * only for episodes whose text or model changed, so every writer of a story
 * is covered and nothing needs a separate backfill. Any semantic failure
 * leaves the recent episodes alone.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProjectType } from '@kit/film-studio-schemas/project';
import type { Database } from '@kit/supabase/database';

import {
  embedderOrLog,
  episodeDocument,
  episodesNeedingEmbedding,
  withSequentialFallback,
} from './semantic-episodes';
import type { Embedder } from './voyage-embedder';

export const RECENT_EPISODES = 3;
export const RELATED_EPISODES = 3;
export const MIN_SIMILARITY = 0.5;

export interface PreviousEpisode {
  number: number;
  title: string;
  summary: string;
  sentimentScore?: number;
  keyEvents?: string[];
  relation: 'recent' | 'related';
}

interface WindowRow {
  id: string;
  number: number;
  title: string;
  summary: string;
  sentimentScore?: number;
  keyEvents?: string[];
}

/** The episode numbers the horizon covers, or null when none are. */
export function previousEpisodeRange(
  currentNumber: number,
  horizon: number,
  projectType: ProjectType,
): { from: number; to: number } | null {
  if (projectType === 'news' || horizon < 1) return null;

  return { from: currentNumber - horizon, to: currentNumber - 1 };
}

export interface SemanticOptions {
  embedder: Embedder | null;
  /** What the episode being written is about: its title and logline */
  query: string;
}

export async function fetchPreviousEpisodes(
  client: SupabaseClient<Database>,
  input: {
    projectId: string;
    currentNumber: number;
    horizon: number;
    projectType: ProjectType;
    semantic?: SemanticOptions;
  },
): Promise<PreviousEpisode[]> {
  const range = previousEpisodeRange(
    input.currentNumber,
    input.horizon,
    input.projectType,
  );

  if (!range) return [];

  const window = await fetchWindow(client, input.projectId, range);
  const recent = window.slice(-RECENT_EPISODES).reverse();
  const earlier = window.slice(0, Math.max(0, window.length - RECENT_EPISODES));

  const recentEpisodes = recent.map((row) => toPrevious(row, 'recent'));

  if (!input.semantic || earlier.length === 0) return recentEpisodes;

  const embedder = embedderOrLog(input.semantic.embedder);
  const query = input.semantic.query.trim();

  if (!embedder || !query) return recentEpisodes;

  const related = await withSequentialFallback(
    'semantic search',
    () =>
      findRelatedEpisodes(client, {
        projectId: input.projectId,
        candidates: earlier,
        windowSize: window.length,
        query,
        embedder,
      }),
    [],
  );

  return [
    ...recentEpisodes,
    ...related.map((row) => toPrevious(row, 'related')),
  ];
}

async function fetchWindow(
  client: SupabaseClient<Database>,
  projectId: string,
  range: { from: number; to: number },
): Promise<WindowRow[]> {
  // At most MAX_MEMORY_HORIZON (100) rows, under PostgREST's 1000-row cap.
  const { data, error } = await client
    .from('episodes')
    .select('id, number, title, story_data')
    .eq('project_id', projectId)
    .gte('number', range.from)
    .lte('number', range.to)
    .not('story_data->fullStory', 'is', null)
    .is('deleted_at', null)
    .order('number', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch previous episodes: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const story = (row.story_data ?? {}) as {
      episodeSummary?: string;
      sentimentScore?: number;
      keyEvents?: string[];
    };

    return {
      id: row.id,
      number: row.number,
      title: row.title,
      summary: story.episodeSummary ?? '',
      sentimentScore: story.sentimentScore,
      keyEvents: story.keyEvents,
    };
  });
}

async function findRelatedEpisodes(
  client: SupabaseClient<Database>,
  input: {
    projectId: string;
    candidates: WindowRow[];
    windowSize: number;
    query: string;
    embedder: Embedder;
  },
): Promise<WindowRow[]> {
  const started = Date.now();
  const { embedder, candidates } = input;
  const ids = candidates.map((row) => row.id);

  const { data: stored, error: storedError } = await client
    .from('episode_embeddings')
    .select('episode_id, content_hash')
    .in('episode_id', ids);

  if (storedError) {
    throw new Error(`reading embeddings: ${storedError.message}`);
  }

  const needed = episodesNeedingEmbedding(
    candidates.map((row) => ({
      episodeId: row.id,
      document: episodeDocument(row),
    })),
    new Map(
      (stored ?? [])
        .filter((row) => row.content_hash)
        .map((row) => [row.episode_id, row.content_hash as string]),
    ),
    embedder.model,
  );

  const [vectors, queryVector] = await Promise.all([
    embedder.embedDocuments(needed.map((row) => row.document)),
    embedder.embedQuery(input.query),
  ]);

  if (needed.length > 0) {
    const { error: upsertError } = await client
      .from('episode_embeddings')
      .upsert(
        needed.map((row, index) => ({
          episode_id: row.episodeId,
          embedding: JSON.stringify(vectors[index]),
          content_hash: row.hash,
          model: embedder.model,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'episode_id' },
      );

    if (upsertError) {
      throw new Error(`writing embeddings: ${upsertError.message}`);
    }
  }

  const { data: matches, error: matchError } = await client.rpc(
    'match_episode_embeddings',
    {
      query_embedding: JSON.stringify(queryVector),
      target_project_id: input.projectId,
      candidate_episode_ids: ids,
      embedding_model: embedder.model,
      match_count: RELATED_EPISODES,
      min_similarity: MIN_SIMILARITY,
    },
  );

  if (matchError) {
    throw new Error(`searching embeddings: ${matchError.message}`);
  }

  const byId = new Map(candidates.map((row) => [row.id, row]));
  const related = (matches ?? [])
    .map((match) => byId.get(match.episode_id))
    .filter((row): row is WindowRow => row !== undefined)
    .sort((a, b) => a.number - b.number);

  console.info(
    `[semantic-context] window=${input.windowSize} candidates=${candidates.length} embedded=${needed.length} related=${related.length} ms=${Date.now() - started}`,
  );

  return related;
}

function toPrevious(
  row: WindowRow,
  relation: PreviousEpisode['relation'],
): PreviousEpisode {
  return {
    number: row.number,
    title: row.title,
    summary: row.summary,
    sentimentScore: row.sentimentScore,
    keyEvents: row.keyEvents,
    relation,
  };
}
