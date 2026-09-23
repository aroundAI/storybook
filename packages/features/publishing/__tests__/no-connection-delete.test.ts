import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-22, the class rather than the instance. Deleting a `platform_connections`
 * row used to cascade into everything a person had attached to the channel,
 * and five code paths did it. The foreign keys now refuse most of those
 * deletes, but a connection with nothing attached yet would still go — and
 * with it the row a later reconnect should re-attach to. So no application
 * code deletes one: disconnect is `disconnect_platform_connection`, and the
 * only thing that removes the row is deleting its account.
 */

const REPO = resolve(__dirname, '../../../..');
const ROOTS = ['packages', 'apps/web/app', 'apps/web/lambda', 'apps/web/lib'];
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', '__tests__']);

/** `.from('platform_connections' …)` followed, within one chain, by `.delete(`. */
const DELETES_A_CONNECTION =
  /\.from\(\s*['"`]platform_connections['"`][^)]*\)(?:(?!\.from\()[\s\S]){0,200}?\.delete\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];

    const path = join(dir, name);

    if (statSync(path).isDirectory()) return sourceFiles(path);

    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

describe('no application code deletes a platform connection', () => {
  it('the pattern recognises the shape it guards against (positive control)', () => {
    expect(
      DELETES_A_CONNECTION.test(`
        await client
          .from('platform_connections' as 'accounts')
          .delete()
          .eq('id', connectionId);`),
    ).toBe(true);
    expect(
      DELETES_A_CONNECTION.test(`
        await client.from('platform_connections').select('id');
        await client.from('oauth_states').delete().eq('nonce', nonce);`),
    ).toBe(false);
  });

  it('matches nothing in packages/ and apps/web', () => {
    const files = ROOTS.flatMap((root) => sourceFiles(join(REPO, root)));

    // A scan that found no files would pass for the wrong reason.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files
      .filter((file) => DELETES_A_CONNECTION.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO, file));

    expect(offenders).toEqual([]);
  });
});
