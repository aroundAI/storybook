import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * KB-70. `STORAGE_PROVIDER=s3` — in the config templates, and as the SST
 * default — silently meant Supabase: the factory mapped every value it did
 * not know to `supabase`, and there is no S3 adapter. Production and staging
 * store on R2; local dev and CI on Supabase. Those are the only two.
 */

const REPO = resolve(__dirname, '../../../..');
const ORIGINAL = process.env.STORAGE_PROVIDER;

async function providerFor(value: string | undefined) {
  if (value === undefined) delete process.env.STORAGE_PROVIDER;
  else process.env.STORAGE_PROVIDER = value;
  vi.resetModules();
  const { getStorageProvider } = await import('../src/factory');
  return () => getStorageProvider();
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.STORAGE_PROVIDER;
  else process.env.STORAGE_PROVIDER = ORIGINAL;
});

describe('getStorageProvider (KB-70)', () => {
  it.each(['r2', 'supabase', 'R2', 'Supabase'])('accepts %s', async (v) => {
    expect((await providerFor(v))()).toBe(v.toLowerCase());
  });

  it.each([undefined, ''])('treats %j as supabase (local dev)', async (v) => {
    expect((await providerFor(v))()).toBe('supabase');
  });

  it.each(['s3', 'local', 'b2', 'gcs', 'r2 '])(
    'refuses %j instead of falling back to supabase',
    async (v) => {
      const get = await providerFor(v);
      expect(get).toThrow(/Unknown STORAGE_PROVIDER/);
    },
  );
});

describe('STORAGE_PROVIDER in config the repo ships (KB-70)', () => {
  it('every tracked env template names a provider the factory knows', async () => {
    const { STORAGE_PROVIDERS } = await import('../src/factory');
    const known = new Set<string>(STORAGE_PROVIDERS);
    const templates = execFileSync('git', ['ls-files', '*.env*.example'], {
      cwd: REPO,
    })
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);

    expect(templates.length).toBeGreaterThan(0);

    const unknown = templates.flatMap((file) =>
      [
        ...readFileSync(join(REPO, file), 'utf8').matchAll(
          /^\s*STORAGE_PROVIDER=([^\s#]*)/gm,
        ),
      ]
        .map((m) => m[1] ?? '')
        .filter((value) => !known.has(value.toLowerCase()))
        .map((value) => `${file}: STORAGE_PROVIDER=${value}`),
    );

    expect(unknown, 'templates naming an unknown provider').toEqual([]);
  });

  it('sst.config.ts defaults the deployed STORAGE_PROVIDER to r2', () => {
    const sst = readFileSync(join(REPO, 'sst.config.ts'), 'utf8');
    const defaults = [
      ...sst.matchAll(
        /STORAGE_PROVIDER:\s*process\.env\.STORAGE_PROVIDER\s*\|\|\s*'([^']*)'/g,
      ),
    ].map((m) => m[1]);

    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults.every((d) => d === 'r2')).toBe(true);
  });

  it('deploy.sh refuses the same values the factory does', async () => {
    const { STORAGE_PROVIDERS } = await import('../src/factory');
    const script = readFileSync(join(REPO, 'scripts/deploy.sh'), 'utf8');
    const list = /^STORAGE_PROVIDERS="([^"]*)"/m.exec(script)?.[1];

    expect(list?.split(/\s+/).sort()).toEqual([...STORAGE_PROVIDERS].sort());
  });
});
