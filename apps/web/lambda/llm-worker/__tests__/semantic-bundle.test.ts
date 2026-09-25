/**
 * KB-35: semantic previous-episode context must load and run in the LLM
 * Lambda bundle. The first version never could: it imported a package the
 * worker did not depend on, which esbuild dropped to a warning inside `try`,
 * and that package imported `server-only`. This builds the worker's own file
 * as SST does (esbuild, plain Node, no `react-server` condition) and runs it
 * in a separate `node` process, with a fake client and a fake embedder.
 *
 * esbuild is resolved through vite, as in canon-bundle.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

interface Esbuild {
  build(options: {
    entryPoints: string[];
    bundle: boolean;
    platform: 'node';
    format: 'esm';
    target: string;
    outfile: string;
    logLevel: 'silent';
  }): Promise<{ warnings: unknown[] }>;
}

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const esbuild = viteRequire('esbuild') as Esbuild;

const LLM_WORKER = path.resolve(__dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'kb-35-bundle-'));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const RUNNER = `
const warnings = [];
console.warn = console.error = (...a) => warnings.push(a.map(String).join(' '));
console.info = console.log = () => {};

const window = [
  { id: 'e1', number: 1, title: 'The Keeper Leaves', story_data: { episodeSummary: 'lighthouse' } },
  { id: 'e2', number: 2, title: 'Bakery', story_data: { episodeSummary: 'bakery' } },
  { id: 'e8', number: 8, title: 'Recent', story_data: { episodeSummary: 'storm' } },
  { id: 'e9', number: 9, title: 'Recent', story_data: { episodeSummary: 'storm' } },
  { id: 'e10', number: 10, title: 'Recent', story_data: { episodeSummary: 'storm' } },
];
const upserted = [];
const client = {
  from: (table) => {
    const q = {
      then: (resolve) => resolve({ data: table === 'episodes' ? window : [], error: null }),
      upsert: (rows) => { upserted.push(...rows.map((r) => r.episode_id)); return Promise.resolve({ error: null }); },
    };
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'not', 'is', 'order']) q[m] = () => q;
    return q;
  },
  rpc: async () => ({ data: [{ episode_id: 'e1', similarity: 0.9 }], error: null }),
};
const vector = Array.from({ length: 1024 }, () => 0.01);
const embedder = {
  model: 'voyage-3-large',
  embedDocuments: async (texts) => texts.map(() => vector),
  embedQuery: async () => vector,
};

let outcome;
try {
  const { fetchPreviousEpisodes } = await import('./previous-episodes.mjs');
  const episodes = await fetchPreviousEpisodes(client, {
    projectId: 'p1', currentNumber: 11, horizon: 50, projectType: 'series',
    semantic: { embedder, query: 'the lighthouse keeper returns' },
  });
  outcome = { episodes: episodes.map((e) => [e.number, e.relation]), upserted };
} catch (error) {
  outcome = { loadError: String(error?.message ?? error).split('\\n')[0] };
}
process.stdout.write(JSON.stringify({ ...outcome, warnings }));
`;

describe('semantic previous-episode context in the LLM Lambda bundle (KB-35)', () => {
  it('bundles without warnings and returns the related episode', async () => {
    const result = await esbuild.build({
      entryPoints: [path.join(LLM_WORKER, 'utils/previous-episodes.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile: path.join(outDir, 'previous-episodes.mjs'),
      logLevel: 'silent',
    });
    writeFileSync(path.join(outDir, 'run.mjs'), RUNNER);

    const run = JSON.parse(
      execFileSync(process.execPath, ['run.mjs'], {
        cwd: outDir,
        encoding: 'utf8',
      }),
    ) as {
      episodes?: Array<[number, string]>;
      upserted?: string[];
      loadError?: string;
      warnings: string[];
    };

    expect(result.warnings).toEqual([]);
    expect(run.loadError).toBeUndefined();
    expect(run.warnings).toEqual([]);
    expect(run.episodes).toEqual([
      [10, 'recent'],
      [9, 'recent'],
      [8, 'recent'],
      [1, 'related'],
    ]);
    expect(run.upserted).toEqual(['e1', 'e2']);
  }, 60_000);
});
