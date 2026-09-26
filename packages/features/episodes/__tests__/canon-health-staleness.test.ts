import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { getCanonHealthAction } from '../src/server/canon-actions';

// KB-108: the canon health dashboard's stale-thread count used "opened
// episode + number of touches" as the last-touched episode — the arithmetic
// KB-72 removed from CANON_007. It now resolves the touched episodes to
// numbers and applies the rule CANON_007 uses.

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  checkRateLimit: vi.fn(),
  enhanceAction: vi.fn(
    (fn: (data: unknown, user: { id: string }) => unknown) => (data: unknown) =>
      fn(data, { id: '00000000-0000-4000-8000-0000000000aa' }),
  ),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const PROJECT = '11111111-1111-4111-8111-111111111111';

interface Thread {
  id: string;
  thread_name: string;
  opened_at: string;
  episodes_touched: string[];
}

/**
 * A client answering by table. `episodes` answers both the "latest episode"
 * read (single) and the id → number resolution (paged by range).
 */
function clientWith(input: {
  latestEpisode: number;
  episodeNumbers: Record<string, number>;
  threads: Thread[];
  /** short-film: horizon 10 */
  metadata?: unknown;
}) {
  const from = vi.fn((table: string) => {
    let single = false;
    let window: [number, number] | undefined;

    const result = () => {
      switch (table) {
        case 'projects':
          return {
            data: { metadata: input.metadata ?? { projectType: 'short-film' } },
            error: null,
          };
        case 'immutable_events':
          return { data: null, count: 0, error: null };
        case 'narrative_threads':
          return single
            ? { data: null, error: null }
            : {
                data: input.threads.map((t) => ({
                  ...t,
                  project_id: PROJECT,
                  thread_type: 'plot',
                  status: 'open',
                  resolved_at: null,
                  promises: [],
                  payoffs: [],
                  description: null,
                  created_at: '2026-01-01T00:00:00Z',
                  updated_at: '2026-01-01T00:00:00Z',
                  opened_episode: null,
                  resolved_episode: null,
                })),
                count: input.threads.length,
                error: null,
              };
        case 'episodes': {
          if (single) {
            return { data: { number: input.latestEpisode }, error: null };
          }
          const rows = Object.entries(input.episodeNumbers).map(
            ([id, number]) => ({ id, number }),
          );
          return {
            data: window ? rows.slice(window[0], window[1] + 1) : rows,
            error: null,
          };
        }
        default:
          return { data: [], error: null };
      }
    };

    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    };
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      chain[m] = vi.fn(() => chain);
    }
    chain.single = vi.fn(() => {
      single = true;
      return chain;
    });
    chain.range = vi.fn((a: number, b: number) => {
      window = [a, b];
      return chain;
    });
    return chain;
  });

  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
}

type Health = {
  health: { issueCount: number };
  orphanedThreads: Array<{ threadName: string }>;
};

async function staleNames() {
  const result = (await getCanonHealthAction({ projectId: PROJECT })) as Health;
  return result.orphanedThreads.map((t) => t.threadName);
}

const NUMBERS = Object.fromEntries(
  [10, 19, 20, 21, 29].map((n) => [`e${n}`, n]),
);

describe('canon health: stale threads (KB-108)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('does not count a thread touched in the previous episode', async () => {
    clientWith({
      latestEpisode: 30,
      episodeNumbers: NUMBERS,
      threads: [
        {
          id: 't1',
          thread_name: 'Live',
          opened_at: 'e10',
          episodes_touched: ['e10', 'e29'],
        },
      ],
    });

    expect(await staleNames()).toEqual([]);
  });

  it('counts a thread untouched for the whole horizon, and not one a day short', async () => {
    clientWith({
      latestEpisode: 30,
      episodeNumbers: NUMBERS,
      threads: [
        {
          id: 't1',
          thread_name: 'Ten ago',
          opened_at: 'e10',
          episodes_touched: ['e10', 'e20'],
        },
        {
          id: 't2',
          thread_name: 'Nine ago',
          opened_at: 'e10',
          episodes_touched: ['e10', 'e21'],
        },
      ],
    });

    expect(await staleNames()).toEqual(['Ten ago']);
  });

  it('does not count a thread whose episodes do not resolve', async () => {
    clientWith({
      latestEpisode: 30,
      episodeNumbers: {},
      threads: [
        {
          id: 't1',
          thread_name: 'Unknown',
          opened_at: 'gone',
          episodes_touched: ['gone', 'also-gone'],
        },
      ],
    });

    expect(await staleNames()).toEqual([]);
  });

  it("uses the project's horizon as the threshold", async () => {
    clientWith({
      latestEpisode: 30,
      episodeNumbers: NUMBERS,
      metadata: {
        projectType: 'series',
        canon: { memoryHorizon: 5, memoryHorizonMode: 'custom' },
      },
      threads: [
        {
          id: 't1',
          thread_name: 'Nine ago',
          opened_at: 'e10',
          episodes_touched: ['e10', 'e21'],
        },
      ],
    });

    expect(await staleNames()).toEqual(['Nine ago']);
  });
});
