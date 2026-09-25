import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-84, the class rather than the instance. A member's client must never
 * read `external_api_keys.encrypted_key` (or `*`, which names it), nor upsert
 * the table (an upsert reads it back through EXCLUDED). Once the column grant
 * lands, such code fails at runtime with `permission denied`; until then it is
 * the leak itself. Two rules keep it from shipping:
 *
 *  1. Only `packages/supabase/src/external-api-keys.ts` upserts a key. It
 *     checks has_account_access on the caller's client, then uses the admin
 *     client.
 *  2. Only that file and the service-key workers below select the ciphertext.
 *     Adding a file here is a decision: it must not be the user's client.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps/web/app', 'apps/web/lambda', 'apps/web/lib'];
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', '__tests__']);

const HELPER = 'packages/supabase/src/external-api-keys.ts';

const READS_CIPHERTEXT_WITH_SERVICE_ROLE = new Set([
  HELPER,
  // The workers: createClient with SUPABASE_SERVICE_ROLE_KEY (index.ts).
  'apps/web/lambda/voice-worker/voice-generation.ts',
  'apps/web/lambda/llm-worker/handlers/audio-file-generation.ts',
  'apps/web/lambda/llm-worker/handlers/dialogue-voice-generation.ts',
]);

const KEYS_CHAIN =
  /\.from\(\s*['"`]external_api_keys['"`][^)]*\)((?:(?!\.from\()[\s\S]){0,400})/g;

const SELECT_ARGUMENT = /\.select\(\s*(?:(['"`])([\s\S]*?)\1)?\s*[,)]/;
const EMBED = /external_api_keys(?:!\w+)?\s*\(([^)]*)\)/g;

function namesCiphertext(columns: string | undefined) {
  if (columns === undefined) return true; // `.select()` is `*`

  return /encrypted_key|(^|[\s,])\*($|[\s,])/.test(columns);
}

export function selectsCiphertext(source: string) {
  for (const [, chain] of source.matchAll(KEYS_CHAIN)) {
    const select = chain!.match(SELECT_ARGUMENT);

    if (select && namesCiphertext(select[2])) return true;
  }

  for (const [, columns] of source.matchAll(EMBED)) {
    if (namesCiphertext(columns)) return true;
  }

  return false;
}

export function upsertsKey(source: string) {
  return [...source.matchAll(KEYS_CHAIN)].some(([, chain]) =>
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
  (path) => ({
    path: relative(REPO, path),
    source: readFileSync(path, 'utf8'),
  }),
);

describe('who reads a vendor key’s ciphertext (KB-84)', () => {
  it('the patterns recognise the shapes they guard against (positive control)', () => {
    expect(
      selectsCiphertext(`
        const { data } = await client
          .from('external_api_keys')
          .select('encrypted_key, is_active')
          .eq('account_id', accountId);`),
    ).toBe(true);
    expect(
      selectsCiphertext(`await client.from('external_api_keys').select('*');`),
    ).toBe(true);
    expect(
      selectsCiphertext(`await client.from('external_api_keys').select();`),
    ).toBe(true);
    expect(
      selectsCiphertext(
        `client.from('accounts').select('id, external_api_keys(encrypted_key)')`,
      ),
    ).toBe(true);
    expect(
      selectsCiphertext(`
        await client
          .from('external_api_keys')
          .select('id')
          .eq('provider', providerName);
        await client.from('accounts').select('id, external_api_keys(provider)');`),
    ).toBe(false);

    expect(
      upsertsKey(`
        await client.from('external_api_keys').upsert(
          { account_id, provider, encrypted_key },
          { onConflict: 'account_id,provider' },
        );`),
    ).toBe(true);
    expect(
      upsertsKey(
        `await client.from('external_api_keys').delete().eq('provider', p);`,
      ),
    ).toBe(false);
  });

  it('scans the application source', () => {
    // A scan that found no files would pass for the wrong reason.
    expect(files.length).toBeGreaterThan(100);
  });

  it('only the helper upserts a key', () => {
    const offenders = files
      .filter(({ path, source }) => path !== HELPER && upsertsKey(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
    expect(upsertsKey(files.find(({ path }) => path === HELPER)!.source)).toBe(
      true,
    );
  });

  it('only the helper and the service-key workers select the ciphertext', () => {
    const offenders = files
      .filter(
        ({ path, source }) =>
          !READS_CIPHERTEXT_WITH_SERVICE_ROLE.has(path) &&
          selectsCiphertext(source),
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('every allow-listed file still reads the ciphertext, through an admin or service client', () => {
    for (const path of READS_CIPHERTEXT_WITH_SERVICE_ROLE) {
      const file = files.find((candidate) => candidate.path === path);

      expect(file, path).toBeDefined();
      expect(selectsCiphertext(file!.source), path).toBe(true);
      expect(file!.source, path).toMatch(
        /getSupabaseServerAdminClient|SupabaseClient<Database>/,
      );
    }
  });
});
