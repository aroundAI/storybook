/**
 * FILM-1728 §5: the bundle is the evidence for what ships. SST bundles the
 * publish worker with esbuild for plain Node; this builds it the same way
 * and reads the result, so the Graph version the lambda calls is counted in
 * the artefact rather than inferred from the source.
 *
 * It also proves §7.3.C's move loads: the handlers now import the providers
 * from `@kit/publishing`, and a module that reaches `server-only` would throw
 * the moment the bundle loads in Node (see canon-bundle.test.ts, FILM-1110).
 *
 * esbuild is resolved through vite, as in canon-bundle.test.ts, to keep the
 * lockfile unchanged.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { META_GRAPH_VERSION } from '@kit/shared/vendors';

interface Esbuild {
  build(options: {
    entryPoints: string[];
    bundle: boolean;
    platform: 'node';
    format: 'esm';
    target: string;
    outdir?: string;
    outfile?: string;
    logLevel: 'silent';
  }): Promise<unknown>;
}

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const esbuild = viteRequire('esbuild') as Esbuild;

const PUBLISH_WORKER = path.resolve(__dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'film-1728-bundle-'));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

/** A Graph-shaped version string, in any quote. */
const VERSION_LITERAL = /['"`]v\d{1,2}\.0['"`]/g;

describe('the publish lambda bundle (FILM-1728)', () => {
  it('carries exactly one Graph version literal, the pin', async () => {
    const outfile = path.join(outDir, 'index.mjs');

    await esbuild.build({
      entryPoints: [path.join(PUBLISH_WORKER, 'index.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outfile,
      logLevel: 'silent',
    });

    const bundle = readFileSync(outfile, 'utf8');

    expect(bundle.match(VERSION_LITERAL)).toEqual([`"${META_GRAPH_VERSION}"`]);
  }, 60_000);

  it('loads the Meta handlers, provider modules and all, in plain Node', async () => {
    await esbuild.build({
      entryPoints: [
        path.join(PUBLISH_WORKER, 'handlers/facebook.ts'),
        path.join(PUBLISH_WORKER, 'handlers/instagram.ts'),
      ],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      outdir: outDir,
      logLevel: 'silent',
    });
    writeFileSync(
      path.join(outDir, 'load.mjs'),
      `const fb = await import('./facebook.js');
const ig = await import('./instagram.js');
process.stdout.write(JSON.stringify([
  typeof fb.uploadToFacebook, typeof fb.deleteFromFacebook, typeof ig.uploadToInstagram,
]));`,
    );

    const stdout = execFileSync(process.execPath, ['load.mjs'], {
      cwd: outDir,
      encoding: 'utf8',
    });

    expect(JSON.parse(stdout)).toEqual(['function', 'function', 'function']);
  }, 60_000);
});
