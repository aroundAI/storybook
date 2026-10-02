/**
 * FILM-1110: the canon memory builder must load in the LLM Lambda.
 *
 * SST bundles each worker with esbuild for plain Node — no `react-server`
 * export condition — so a module that reaches `import 'server-only'` throws
 * the moment it loads. Next.js resolves that import to an empty file and
 * vitest aliases it to a mock, so neither a `next build` nor a unit test can
 * see the failure. This test builds the worker's own file the way the
 * deploy does and runs the result in a separate `node` process, so nothing
 * of vitest's (aliases, transforms, environment) is involved.
 *
 * esbuild is resolved through vite (vitest's own dependency) rather than
 * declared here, to keep the lockfile unchanged.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The part of esbuild's API this test calls. Declared here rather than
 * imported: `apps/web` does not depend on esbuild (it is loaded through
 * vite below), so `typeof import('esbuild')` cannot resolve under the
 * lambda typecheck.
 */
interface Esbuild {
  build(options: {
    entryPoints: string[];
    bundle: boolean;
    platform: 'node';
    format: 'esm';
    target: string;
    outfile: string;
    logLevel: 'silent';
  }): Promise<unknown>;
}

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const esbuild = viteRequire('esbuild') as Esbuild;

/**
 * SST bundles the workers as ESM with this shim in the banner (sst.config.ts,
 * nodejs.format esm): the AWS SDK's CommonJS dependencies call require(),
 * and the gateway (FILM-1902) brings the SQS client into every handler.
 */
const SST_REQUIRE_SHIM = [
  "import { createRequire as topLevelCreateRequire } from 'node:module';",
  'const require = topLevelCreateRequire(import.meta.url);',
].join('\n');

const LLM_WORKER = path.resolve(__dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'film-1110-bundle-'));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

/**
 * Imports the bundle and runs the checkpoint with a client whose reads are
 * all empty; prints what it returned, the tables it read and any warning.
 */
const RUNNER = `
const tables = [];
const warnings = [];
console.warn = console.error = (...args) =>
  warnings.push(args.map(String).join(' '));
console.info = console.log = () => {};
const query = {
  then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
  maybeSingle: () => Promise.resolve({ data: null, error: null }),
  single: () => Promise.resolve({ data: null, error: null }),
  insert: () => Promise.resolve({ data: null, error: null }),
};
for (const m of ['select', 'eq', 'in', 'order', 'limit', 'gte', 'lt', 'range']) {
  query[m] = () => query;
}
const client = { from: (table) => { tables.push(table); return query; } };

let outcome;
try {
  const { runValidationCheckpoint } = await import('./validation-checkpoint.mjs');
  const result = await runValidationCheckpoint(
    {
      checkpoint: 'SCREENPLAY',
      enforcement: 'flexible',
      projectId: '44444444-4444-4444-8444-444444444444',
      episodeNumber: 2,
      supabase: client,
    },
    { sceneBlocks: [{ sceneNumber: 1, content: 'INT. VAULT - NIGHT' }] },
  );
  outcome = { result };
} catch (error) {
  outcome = { loadError: String(error?.message ?? error).split('\\n')[0] };
}
process.stdout.write(JSON.stringify({ ...outcome, tables, warnings }));
`;

interface CheckpointRun {
  result?: { canonAvailable: boolean };
  loadError?: string;
  tables: string[];
  warnings: string[];
}

/** Bundles the checkpoint as SST bundles the llm-worker, then runs it. */
async function bundleAndRunCheckpoint(): Promise<CheckpointRun> {
  await esbuild.build({
    entryPoints: [path.join(LLM_WORKER, 'utils/validation-checkpoint.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: SST_REQUIRE_SHIM },
    outfile: path.join(outDir, 'validation-checkpoint.mjs'),
    logLevel: 'silent',
  });
  writeFileSync(path.join(outDir, 'run.mjs'), RUNNER);

  const stdout = execFileSync(process.execPath, ['run.mjs'], {
    cwd: outDir,
    encoding: 'utf8',
  });

  return JSON.parse(stdout) as CheckpointRun;
}

describe('canon memory in the LLM Lambda bundle (FILM-1110)', () => {
  it('runs the screenplay checkpoint with canon from the injected client', async () => {
    const run = await bundleAndRunCheckpoint();

    expect(run.loadError).toBeUndefined();
    expect(run.warnings).toEqual([]);
    expect(run.result?.canonAvailable).toBe(true);
    expect(run.tables).toContain('projects');
    expect(run.tables).toContain('immutable_events');
    // FILM-1003: the run is logged
    expect(run.tables).toContain('validation_runs');
  }, 60_000);
});

/**
 * KB-71: the season outline reads the project type through `@kit/episodes/lib`
 * (a dynamic import, so a module that cannot load in plain Node fails only
 * when the handler runs). Runs the bundled handler for a documentary until it
 * has read its facts; the orchestrator after that needs an LLM and may fail.
 */
const OUTLINE_RUNNER = `
const tables = [];
console.warn = console.error = console.info = console.log = () => {};
const query = {
  then: (resolve) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
  single: () => Promise.resolve({
    data: { id: 'p', name: 'P', metadata: { projectType: 'documentary' } },
    error: null,
  }),
};
for (const m of ['select', 'eq', 'is', 'order', 'limit']) {
  query[m] = () => query;
}
const client = { from: (table) => { tables.push(table); return query; } };

let error;
try {
  const { processSeasonOutline } = await import('./season-outline.mjs');
  await processSeasonOutline(
    { projectId: '44444444-4444-4444-8444-444444444444', seasonPremise: 'x', episodeCount: 1, startingNumber: 1, accountId: '11111111-1111-4111-8111-111111111111', userId: '77777777-7777-4777-8777-777777777777' },
    client,
  );
} catch (e) {
  error = String(e?.message ?? e).split('\\n')[0];
}
process.stdout.write(JSON.stringify({ tables, error }));
`;

describe('season outline in the LLM Lambda bundle (KB-71)', () => {
  it("loads the project type helpers and reads a documentary project's facts", async () => {
    await esbuild.build({
      entryPoints: [path.join(LLM_WORKER, 'handlers/season-outline.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      banner: { js: SST_REQUIRE_SHIM },
      outfile: path.join(outDir, 'season-outline.mjs'),
      logLevel: 'silent',
    });
    writeFileSync(path.join(outDir, 'run-outline.mjs'), OUTLINE_RUNNER);

    const run = JSON.parse(
      execFileSync(process.execPath, ['run-outline.mjs'], {
        cwd: outDir,
        encoding: 'utf8',
      }),
    ) as { tables: string[]; error?: string };

    expect(run.error ?? '').not.toMatch(
      /server-only|Cannot find|is not a function/,
    );
    expect(run.tables).toContain('verified_facts');
  }, 60_000);
});
