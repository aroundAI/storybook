import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-203's class (KB-202 is its Lambda twin). A setting the deployed app
 * reads must be forwarded by sst.config.ts, or production runs as if it were
 * unset: the five CLICKHOUSE_* names were in production.env, deploy.sh read
 * them to run migrations, and the web app never received them, so
 * production never synced or served analytics. An explicit list, so the
 * guard is precise; add a name when the app starts depending on one.
 */

const REPO = resolve(__dirname, '../../..');

const REQUIRED = [
  'CLICKHOUSE_ENABLED',
  'CLICKHOUSE_HOST',
  'CLICKHOUSE_USER',
  'CLICKHOUSE_PASSWORD',
  'CLICKHOUSE_DB',
  'STORAGE_PROVIDER',
  'R2_PUBLIC_URL',
];

/** The StorybookWeb Nextjs function's environment block */
export function webEnvironment(config: string): string {
  const at = config.indexOf("new sst.aws.Nextjs('StorybookWeb'");
  const start = config.indexOf('environment: {', at);
  let depth = 0;
  for (let i = start + 'environment: '.length; i < config.length; i++) {
    if (config[i] === '{') depth++;
    if (config[i] === '}') depth--;
    if (depth === 0) return config.slice(start, i + 1);
  }
  throw new Error('No environment block for StorybookWeb');
}

describe('the deployed web app receives the settings it reads (KB-203)', () => {
  const env = webEnvironment(readFileSync(join(REPO, 'sst.config.ts'), 'utf8'));

  it.each(REQUIRED)('forwards %s', (name) => {
    expect(env).toMatch(new RegExp(`\\b${name}\\b`));
  });

  // KB-208: Lambda caps a function's variables at 4 KB. `next build` inlines
  // NEXT_PUBLIC_* from the deploy's environment, so the function doesn't
  // need them; only these runtime-derived or fallback ones stay.
  it('lists no NEXT_PUBLIC_* the build already inlines (KB-208)', () => {
    const listed = [...env.matchAll(/^\s*(NEXT_PUBLIC_[A-Z_]+):/gm)].map(
      (match) => match[1],
    );
    expect(listed.sort()).toEqual([
      'NEXT_PUBLIC_SITE_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_WEBSOCKET_URL',
    ]);
  });

  it('reads the ClickHouse switch the way the app does', () => {
    const client = readFileSync(
      join(REPO, 'packages', 'clickhouse', 'src', 'client.ts'),
      'utf8',
    );
    expect(client).toContain("process.env.CLICKHOUSE_ENABLED === 'true'");
  });
});
