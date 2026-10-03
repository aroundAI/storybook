import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * `@kit/generation` is `sideEffects: false` and each stage registers itself
 * when its module loads, so a bundler drops a stage whose exports nobody
 * uses, and its registration with it. vitest does not bundle, so every
 * other test sees all 14. Here a caller that imports only the run layer, as
 * extractCanonChangesAction does, is bundled the way SST bundles a worker
 * and must still find every stage: without `ALL_STAGES` it found none.
 */

interface Esbuild {
  build(options: {
    stdin: { contents: string; resolveDir: string; loader: 'ts' };
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

const outDir = mkdtempSync(path.join(tmpdir(), 'stage-registry-bundle-'));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('the stage registry in a bundle (FILM-1903)', () => {
  it('a bundle that imports only executeServerRun registers every stage', async () => {
    await esbuild.build({
      stdin: {
        contents: [
          "import { executeServerRun, registeredStageKeys } from '@kit/generation';",
          'console.log(JSON.stringify({ run: typeof executeServerRun, stages: registeredStageKeys().sort() }));',
        ].join('\n'),
        resolveDir: path.resolve(__dirname, '..'),
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile: path.join(outDir, 'registry.mjs'),
      logLevel: 'silent',
    });
    writeFileSync(path.join(outDir, 'package.json'), '{"type":"module"}');

    const out = JSON.parse(
      execFileSync(process.execPath, ['registry.mjs'], {
        cwd: outDir,
        encoding: 'utf8',
      }),
    ) as { run: string; stages: string[] };

    expect(out.run).toBe('function');
    expect(out.stages).toHaveLength(14);
  }, 60_000);
});
