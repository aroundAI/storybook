import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * A live search over the 12 built-in NewsAPI sources, against a local
 * NewsAPI stub (FILM-1801's `VENDOR_URL_*`), counting the requests the real
 * aggregator makes. Only the database is stood in for: it answers the
 * built-in rows as the seed migration writes them, and an empty cache.
 */

const BUILTINS = [
  ['reuters', 'reuters', 'tier_1', 'center'],
  ['ap-news', 'associated-press', 'tier_1', 'center'],
  ['afp', 'agence-france-presse', 'tier_1', 'center'],
  ['bbc-news', 'bbc-news', 'tier_2', 'center_left'],
  ['nytimes', 'the-new-york-times', 'tier_2', 'center_left'],
  ['guardian', 'the-guardian-uk', 'tier_2', 'left'],
  ['wsj', 'the-wall-street-journal', 'tier_2', 'center_right'],
  ['aljazeera', 'al-jazeera-english', 'tier_2', 'center'],
  ['cnn', 'cnn', 'tier_2', 'center_left'],
  ['npr', 'npr', 'tier_2', 'center_left'],
  ['fox-news', 'fox-news', 'tier_2', 'center_right'],
  ['daily-telegraph', 'the-telegraph', 'tier_2', 'center_right'],
] as const;

const rows = BUILTINS.map(([slug, newsapiId, tier, bias]) => ({
  id: `row-${slug}`,
  category: 'news',
  provider_type: 'newsapi',
  credibility_tier: tier,
  bias_label: bias,
  config: { source_id: newsapiId, api_key_env: 'NEWSAPI_KEY' },
}));

/** Every select chain the aggregator builds, answering `data` at the end. */
function chain(data: unknown[]) {
  const result = { data, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'is',
    'in',
    'gt',
    'gte',
    'lte',
    'order',
    'range',
    'textSearch',
  ]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: typeof result) => unknown) =>
    resolve(result);
  return builder;
}

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => chain(table === 'external_sources' ? rows : []),
  }),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: () => ({
      upsert: () => ({ select: async () => ({ data: [], error: null }) }),
    }),
  }),
}));

interface Seen {
  path: string;
  query: URLSearchParams;
}

const requests: Seen[] = [];
let server: Server;
let origin: string;

/** Two articles, from two of the built-ins, whatever the query. */
const ARTICLES = [
  { id: 'reuters', name: 'Reuters', url: 'https://example.test/r1' },
  { id: 'bbc-news', name: 'BBC News', url: 'https://example.test/b1' },
];

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://stub');
    requests.push({ path: url.pathname, query: url.searchParams });

    const wanted = url.searchParams.get('sources')?.split(',');
    const articles = ARTICLES.filter(
      (a) => !wanted || wanted.includes(a.id),
    ).map((a) => ({
      source: { id: a.id, name: a.name },
      author: null,
      title: `${a.name} story`,
      description: null,
      url: a.url,
      urlToImage: null,
      publishedAt: '2026-09-20T10:00:00Z',
      content: null,
    }));

    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        status: 'ok',
        totalResults: articles.length,
        articles,
      }),
    );
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

beforeEach(() => {
  requests.length = 0;
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('VENDOR_SANDBOX', '1');
  vi.stubEnv('VENDOR_URL_NEWSAPI', origin);
  vi.stubEnv('NEWSAPI_KEY', 'test-newsapi-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function search() {
  const { ExternalContextAggregator } = await import(
    '../src/lib/server/services/context-aggregator'
  );
  const aggregator = new ExternalContextAggregator();
  await aggregator.initialize();
  return aggregator.search({ query: 'geneva closures', category: 'news' });
}

describe('a live news search over the NewsAPI built-ins', () => {
  it('asks NewsAPI once, for all the built-ins at once', async () => {
    await search();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe('/v2/everything');
    expect(requests[0]!.query.get('sources')?.split(',').sort()).toEqual(
      BUILTINS.map(([, newsapiId]) => newsapiId).sort(),
    );
  });

  it('attributes each article to the built-in it came from, with that source’s tier', async () => {
    const result = await search();

    const bySource = Object.fromEntries(
      result.content.map((c) => [c.url, [c.sourceId, c.credibilityTier]]),
    );
    expect(bySource).toEqual({
      'https://example.test/r1': ['row-reuters', 'tier_1'],
      'https://example.test/b1': ['row-bbc-news', 'tier_2'],
    });
  });

  it('carries each source’s bias label onto its articles, so the balance check sees it (FILM-1133)', async () => {
    const result = await search();

    const bias = Object.fromEntries(
      result.content.map((c) => [c.url, c.biasLabel]),
    );
    expect(bias).toEqual({
      'https://example.test/r1': 'center',
      'https://example.test/b1': 'center_left',
    });

    const { checkSourceBalance } = await import(
      '../src/lib/server/services/anchor-service'
    );
    expect(checkSourceBalance(result.content).biasDistribution).toEqual({
      center: 1,
      center_left: 1,
    });
  });
});
