import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withRun } from '@kit/ai-gateway';
import { fakeRunHandle } from '@kit/generation/testing';

import {
  buildEpisodeContext,
  formatPreviousEpisodesForPrompt,
} from '../utils/context-builder';
import { resetSemanticLogLatch } from '../utils/semantic-episodes';

// KB-35. The previous-episode window follows the memory horizon, and earlier
// episodes similar to the one being written join the prompt. Supabase is a
// fake whose `match_episode_embeddings` computes real cosine similarity over
// what was upserted; Voyage is a fake fetch that embeds by keyword. No test
// reaches the network, and no real key exists here.

const DIM = 1024;
const KEY = 'test-key-not-real';

function axis(i: number) {
  return Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));
}

/** "lighthouse" → axis 0, "bakery" → axis 1, anything else → axis 2 */
function embedText(text: string) {
  const t = text.toLowerCase();
  return axis(t.includes('lighthouse') ? 0 : t.includes('bakery') ? 1 : 2);
}

function cosine(a: number[], b: number[]) {
  const dot = a.reduce((s, x, i) => s + x * b[i]!, 0);
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return dot / (norm(a) * norm(b));
}

interface EpisodeRow {
  id: string;
  number: number;
  title: string;
  story_data: Record<string, unknown>;
}

function episode(number: number, title: string, summary = title): EpisodeRow {
  return {
    id: `e${number}`,
    number,
    title,
    story_data: { fullStory: '…', episodeSummary: summary },
  };
}

type Call = [string, ...unknown[]];

function fakeSupabase(input: {
  projectMetadata: Record<string, unknown>;
  window: EpisodeRow[];
}) {
  const calls: Array<{ table: string; calls: Call[] }> = [];
  const embeddings = new Map<
    string,
    { embedding: string; content_hash: string; model: string }
  >();
  const upserts: string[][] = [];

  const current = {
    id: 'e40',
    number: 40,
    title: 'The Keeper Returns',
    description: 'The lighthouse keeper comes home',
    story_data: {},
    metadata: {},
    season_id: 's2',
    project: { id: 'p1', metadata: input.projectMetadata },
    season: null,
  };

  const client = {
    from(table: string) {
      const recorded = { table, calls: [] as Call[] };
      calls.push(recorded);
      let isSingle = false;

      const rows = () => {
        if (table === 'episodes') return isSingle ? current : input.window;
        if (table === 'episode_embeddings') {
          const ids = recorded.calls.find((c) => c[0] === 'in')?.[2] as
            | string[]
            | undefined;
          return [...embeddings.entries()]
            .filter(([id]) => !ids || ids.includes(id))
            .map(([episode_id, row]) => ({ episode_id, ...row }));
        }
        return isSingle ? null : [];
      };

      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: rows(), error: null }),
      };

      for (const method of [
        'select',
        'eq',
        'in',
        'gte',
        'lte',
        'lt',
        'not',
        'is',
        'order',
        'limit',
        'overrideTypes',
      ]) {
        chain[method] = (...args: unknown[]) => {
          recorded.calls.push([method, ...args]);
          return chain;
        };
      }

      chain.single = () => {
        isSingle = true;
        return chain;
      };
      chain.maybeSingle = chain.single;
      chain.upsert = (
        values: Array<{
          episode_id: string;
          embedding: string;
          content_hash: string;
          model: string;
        }>,
      ) => {
        upserts.push(values.map((v) => v.episode_id));
        for (const v of values) embeddings.set(v.episode_id, v);
        return Promise.resolve({ data: null, error: null });
      };

      return chain;
    },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('match_episode_embeddings');
      const query = JSON.parse(args.query_embedding as string) as number[];
      const ids = args.candidate_episode_ids as string[];

      const data = ids
        .map((id) => ({ id, row: embeddings.get(id) }))
        .filter(({ row }) => row && row.model === args.embedding_model)
        .map(({ id, row }) => ({
          episode_id: id,
          similarity: cosine(query, JSON.parse(row!.embedding)),
        }))
        .filter((m) => m.similarity >= (args.min_similarity as number))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, args.match_count as number);

      return { data, error: null };
    }),
  };

  return { client: client as never, calls, embeddings, upserts };
}

function fakeVoyage(options: { status?: number } = {}) {
  const requests: Array<{ input: string[]; input_type: string }> = [];

  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    // The gateway also writes the embedding's usage row (FILM-1902) through
    // the service-role client; that is the only other request allowed
    if (!url.startsWith('https://api.voyageai.com/')) {
      expect(url).toContain('/rest/v1/llm_usage_analytics');
      return new Response(null, { status: 201 });
    }

    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    const body = JSON.parse(init.body as string);
    requests.push(body);

    if (options.status) {
      return new Response('{}', { status: options.status });
    }

    return new Response(
      JSON.stringify({
        object: 'list',
        data: (body.input as string[]).map((text, index) => ({
          object: 'embedding',
          embedding: embedText(text),
          index,
        })),
      }),
    );
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, requests };
}

const SERIES_HORIZON_30 = {
  projectType: 'series',
  canon: { memoryHorizon: 30, memoryHorizonMode: 'custom' },
};

const WINDOW = [
  episode(12, 'The Keeper Leaves', 'The lighthouse keeper sails away.'),
  episode(20, 'Rolls at Dawn', 'The bakery opens early.'),
  episode(25, 'Flour Wars', 'A rival bakery appears.'),
  episode(37, 'Storm', 'A storm hits the harbour.'),
  episode(38, 'After the Storm', 'The town cleans up.'),
  episode(39, 'Calm', 'The sea goes quiet.'),
];

function run(
  supabase: ReturnType<typeof fakeSupabase>,
  options: Parameters<typeof buildEpisodeContext>[2] = {
    semanticContext: true,
    semanticQuery: 'The Keeper Returns\nThe lighthouse keeper comes home',
  },
) {
  // Semantic recall embeds through the gateway for the server run in scope
  // (FILM-1902); the worker puts one there before any handler runs
  return withRun(fakeRunHandle().run, () =>
    buildEpisodeContext('e40', supabase.client, options),
  );
}

function windowQuery(supabase: ReturnType<typeof fakeSupabase>) {
  return supabase.calls.find(
    (q) => q.table === 'episodes' && q.calls.some((c) => c[0] === 'gte'),
  )!.calls;
}

describe('previous-episode context (KB-35)', () => {
  beforeEach(() => {
    resetSemanticLogLatch();
    vi.stubEnv('VOYAGE_API_KEY', KEY);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('puts a similar earlier episode into the story prompt', async () => {
    fakeVoyage();
    const supabase = fakeSupabase({
      projectMetadata: SERIES_HORIZON_30,
      window: WINDOW,
    });

    const context = await run(supabase);

    expect(context.previousEpisodes.map((e) => [e.number, e.relation])).toEqual(
      [
        [39, 'recent'],
        [38, 'recent'],
        [37, 'recent'],
        [12, 'related'],
      ],
    );
    expect(formatPreviousEpisodesForPrompt(context.previousEpisodes)).toContain(
      '- Episode 12 (related earlier episode): "The Keeper Leaves"\n  Plot: The lighthouse keeper sails away.',
    );
  });

  it('reads the window the memory horizon sets, project-wide', async () => {
    fakeVoyage();
    const supabase = fakeSupabase({
      projectMetadata: SERIES_HORIZON_30,
      window: WINDOW,
    });

    await run(supabase);

    const calls = windowQuery(supabase);
    expect(calls).toContainEqual(['eq', 'project_id', 'p1']);
    expect(calls).toContainEqual(['gte', 'number', 10]);
    expect(calls).toContainEqual(['lte', 'number', 39]);
    expect(calls.some((c) => c[1] === 'season_id')).toBe(false);
  });

  it("uses the content type's horizon when none is chosen", async () => {
    fakeVoyage();
    const supabase = fakeSupabase({
      projectMetadata: { projectType: 'series' },
      window: WINDOW,
    });

    await run(supabase);

    expect(windowQuery(supabase)).toContainEqual(['gte', 'number', -10]);
  });

  it('gives news no previous episodes, and asks for none', async () => {
    const { fetchMock } = fakeVoyage();
    const supabase = fakeSupabase({
      projectMetadata: { projectType: 'news' },
      window: WINDOW,
    });

    const context = await run(supabase);

    expect(context.previousEpisodes).toEqual([]);
    expect(
      supabase.calls.some(
        (q) => q.table === 'episodes' && q.calls.some((c) => c[0] === 'gte'),
      ),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('embeds each episode once, and again only when its text changes', async () => {
    const { requests } = fakeVoyage();
    const supabase = fakeSupabase({
      projectMetadata: SERIES_HORIZON_30,
      window: WINDOW,
    });

    await run(supabase);
    const documentBatches = () =>
      requests.filter((r) => r.input_type === 'document');

    expect(documentBatches()).toHaveLength(1);
    expect(supabase.upserts).toEqual([['e12', 'e20', 'e25']]);

    await run(supabase);
    expect(documentBatches()).toHaveLength(1);

    WINDOW[1] = episode(20, 'Rolls at Dawn', 'The bakery burns down.');
    try {
      await run(supabase);
    } finally {
      WINDOW[1] = episode(20, 'Rolls at Dawn', 'The bakery opens early.');
    }
    expect(documentBatches()).toHaveLength(2);
    expect(supabase.upserts.at(-1)).toEqual(['e20']);
  });

  it('makes no Voyage request without a key, and keeps the recent episodes', async () => {
    vi.stubEnv('VOYAGE_API_KEY', '');
    const { fetchMock } = fakeVoyage();
    const supabase = fakeSupabase({
      projectMetadata: SERIES_HORIZON_30,
      window: WINDOW,
    });

    const context = await run(supabase);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(context.previousEpisodes.map((e) => e.number)).toEqual([39, 38, 37]);
    expect(console.info).toHaveBeenCalledWith(
      '[semantic-context] VOYAGE_API_KEY not set — sequential only',
    );
  });

  it('keeps the recent episodes and carries on when Voyage fails', async () => {
    fakeVoyage({ status: 503 });
    const supabase = fakeSupabase({
      projectMetadata: SERIES_HORIZON_30,
      window: WINDOW,
    });

    const context = await run(supabase);

    expect(context.previousEpisodes.map((e) => e.number)).toEqual([39, 38, 37]);
    expect(supabase.upserts).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[semantic-context] semantic search failed'),
    );
  });

  it('does not search for a caller that has not opted in', async () => {
    const { fetchMock } = fakeVoyage();
    const supabase = fakeSupabase({
      projectMetadata: SERIES_HORIZON_30,
      window: WINDOW,
    });

    const context = await run(supabase, {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(context.previousEpisodes.map((e) => e.relation)).toEqual([
      'recent',
      'recent',
      'recent',
    ]);
  });
});
