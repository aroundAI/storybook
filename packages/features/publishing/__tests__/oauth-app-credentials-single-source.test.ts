import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-29. Refresh read app credentials from one place and connect from another,
 * and nothing noticed for eight months. The rule "where does this app's
 * client id and secret come from" now lives in `oauth-app-credentials.ts`
 * alone; this reads the source tree and fails on a second statement of it.
 */

const repo = resolve(__dirname, '../../../..');
const RESOLVER =
  'packages/features/publishing/src/server/oauth-app-credentials.ts';

const ROOTS = ['apps/web/app', 'apps/web/lib', 'packages/features'];

/** An app credential named anywhere: env variable names and the secret column. */
const ENV_NAME =
  /\b(?:TIKTOK_CLIENT_(?:KEY|SECRET)|(?:TWITTER|YOUTUBE|GOOGLE)_CLIENT_(?:ID|SECRET)|(?:FACEBOOK|META)_APP_(?:ID|SECRET))\b/;
const SECRET_READ = /select\(\s*['"`][^'"`]*client_secret_encrypted/;

/**
 * Pending, by name. Empty since KB-22 moved the disconnect flows' revoke
 * calls (`oauth/{tiktok,twitter}/revoke.ts`) onto the resolver.
 */
const PENDING: Record<string, RegExp> = {};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '__tests__' || name === '.next') {
      return [];
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

function matches(pattern: RegExp) {
  return ROOTS.flatMap((root) => sourceFiles(join(repo, root)))
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repo, path))
    .sort();
}

describe('app credentials are resolved in one place', () => {
  it('finds the resolver, so an empty scan cannot pass', () => {
    expect(matches(ENV_NAME)).toContain(RESOLVER);
    expect(matches(SECRET_READ)).toContain(RESOLVER);
  });

  it('no other file names an app credential env variable', () => {
    const others = matches(ENV_NAME).filter(
      (path) => path !== RESOLVER && PENDING[path] !== ENV_NAME,
    );

    expect(others).toEqual([]);
  });

  it('no other file reads a client secret from the database', () => {
    expect(matches(SECRET_READ).filter((path) => path !== RESOLVER)).toEqual(
      [],
    );
  });

  it('every pending entry still needs its exemption', () => {
    for (const [path, pattern] of Object.entries(PENDING)) {
      expect(matches(pattern), path).toContain(path);
    }
  });
});
