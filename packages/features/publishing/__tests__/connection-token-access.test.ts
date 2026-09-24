import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-43, the class rather than the instance. Members may not read a
 * connection's token columns (`access_token_encrypted`,
 * `refresh_token_encrypted`), so code running on a member's client that
 * names them — or `*`, which names them too — fails at runtime with
 * `permission denied`. Two rules keep that from shipping:
 *
 *  1. Only `apps/web/lib/platforms/store-connection.ts` upserts a
 *     connection. An upsert reads the tokens back through EXCLUDED; the
 *     helper does it with the admin client after checking has_account_access.
 *  2. Only the files below select a token column (or `*`), and each does it
 *     with the admin client or the service key. Adding a file here is a
 *     decision: it must not be the user's client.
 */

const REPO = resolve(__dirname, '../../../..');
const ROOTS = ['packages', 'apps/web/app', 'apps/web/lambda', 'apps/web/lib'];
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', '__tests__']);

const UPSERT_HELPER = 'apps/web/lib/platforms/store-connection.ts';

const READS_TOKENS_WITH_ADMIN_CLIENT = new Set([
  // Refresh: getSupabaseServerAdminClient.
  'packages/features/publishing/src/lib/token-refresh.ts',
  // Disconnect: the admin read comes after the member's own read found the row.
  'packages/features/publishing/src/server/connection-actions.ts',
  // The publish worker: createClient with the service-role key.
  'apps/web/lambda/publish-worker/token.ts',
]);

const CONNECTION_CHAIN =
  /\.from\(\s*['"`]platform_connections['"`][^)]*\)((?:(?!\.from\()[\s\S]){0,400})/g;

/** A `.select(...)` argument, or an embedded `platform_connections(...)`. */
const SELECT_ARGUMENT = /\.select\(\s*(?:(['"`])([\s\S]*?)\1)?\s*[,)]/;
const EMBED = /platform_connections(?:!\w+)?\s*\(([^)]*)\)/g;

function namesTokens(columns: string | undefined) {
  if (columns === undefined) return true; // `.select()` is `*`

  return /token_encrypted|(^|[\s,])\*($|[\s,])/.test(columns);
}

export function selectsTokens(source: string) {
  for (const [, chain] of source.matchAll(CONNECTION_CHAIN)) {
    const select = chain!.match(SELECT_ARGUMENT);

    if (select && namesTokens(select[2])) return true;
  }

  for (const [, columns] of source.matchAll(EMBED)) {
    if (namesTokens(columns)) return true;
  }

  return false;
}

export function upsertsConnection(source: string) {
  return [...source.matchAll(CONNECTION_CHAIN)].some(([, chain]) =>
    /^\s*(?:as\s+[^.]+)?\.upsert\(/.test(
      chain!.replace(/^\s*\)?/, '').replace(/^[^.]*/, ''),
    ),
  );
}

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

const files = ROOTS.flatMap((root) => sourceFiles(join(REPO, root))).map(
  (path) => ({ path: relative(REPO, path), source: readFileSync(path, 'utf8') }),
);

describe('who touches a connection’s tokens (KB-43)', () => {
  it('the patterns recognise the shapes they guard against (positive control)', () => {
    expect(
      selectsTokens(`
        await client
          .from('platform_connections')
          .select('id, platform, access_token_encrypted, disconnected_at')
          .eq('id', id);`),
    ).toBe(true);
    expect(
      selectsTokens(`await client.from('platform_connections').select('*');`),
    ).toBe(true);
    expect(
      selectsTokens(`await client.from('platform_connections').select();`),
    ).toBe(true);
    expect(
      selectsTokens(`client.from('publishes').select('id, platform_connections(*)')`),
    ).toBe(true);
    expect(
      selectsTokens(`
        await client
          .from('platform_connections')
          .select('id, platform, platform_account_name, is_active, metadata');
        await client.from('publishes').select('id, platform_connections(language)');`),
    ).toBe(false);

    expect(
      upsertsConnection(`
        await client
          .from('platform_connections')
          .upsert(connections, { onConflict: 'account_id,platform,platform_account_id' });`),
    ).toBe(true);
    expect(
      upsertsConnection(
        `await client.from('platform_connections').update({ language }).eq('id', id);`,
      ),
    ).toBe(false);
  });

  it('scans the application source', () => {
    // A scan that found no files would pass for the wrong reason.
    expect(files.length).toBeGreaterThan(100);
  });

  it('only the store-connection helper upserts a connection', () => {
    const offenders = files
      .filter(({ path, source }) => path !== UPSERT_HELPER && upsertsConnection(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
    expect(
      upsertsConnection(files.find(({ path }) => path === UPSERT_HELPER)!.source),
    ).toBe(true);
  });

  it('only admin-client files select a token column', () => {
    const offenders = files
      .filter(
        ({ path, source }) =>
          !READS_TOKENS_WITH_ADMIN_CLIENT.has(path) && selectsTokens(source),
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('every allow-listed file still reads tokens, and through an admin client', () => {
    for (const path of READS_TOKENS_WITH_ADMIN_CLIENT) {
      const file = files.find((candidate) => candidate.path === path);

      expect(file, path).toBeDefined();
      expect(selectsTokens(file!.source), path).toBe(true);
      expect(file!.source, path).toMatch(
        /getSupabaseServerAdminClient|SupabaseClient/,
      );
    }
  });
});
